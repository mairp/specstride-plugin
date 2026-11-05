/**
 * N supervised workers of one group — the single-pass supervision of the
 * engine, generalized from the ONE pass of `run-feature.ts` to the N workers
 * of a parallel group (F143-FR-010, F143-FR-013, F143-FR-015, F143-FR-018;
 * step 2 of `prompts/specstride-parallel-units.md`).
 *
 * What the single pass already had, and what each worker of a group has here:
 *
 *   - the identity record `{pid, startedAtMs}` of the pass in flight becomes
 *     ONE RECORD PER WORKER, with the worker id, the run-token hash and the
 *     worker's OWN process group beside the two numbers. The start time is
 *     read ONCE at the start, and every later identity check answers to that
 *     number — never to a fresh read at kill time, which would compare a pid
 *     with itself and let a reused pid through.
 *   - the stop ladder becomes THE LADDER OF A WORKER: the sender proves the
 *     identity (the registry's run-token hash, the liveness, the start time
 *     recorded at the start) and then signals the worker's OWN GROUP — the
 *     group of F143-FR-010, which the harness started for it — so the end
 *     reaches the worker's whole tree, not its leader alone.
 *   - the pass guard becomes ONE GUARD PER WORKER, watching the same engine:
 *     a SIGKILL of the engine ends every worker, each by its own guard, and
 *     no resume is started by any of them.
 *
 * What this module does NOT decide: how many workers a group runs at once,
 * whether a worker may be restarted, what a quota pause does to the group.
 * Those are decisions of the group executor in `@specstride/core`
 * (`inSlicesOfAtMost`, `mayRestart`, `theGroupPause`); this module carries
 * them out on real processes, through the ports the composition root hands
 * in. With `loop.parallel.units` off nothing here is reached at all
 * (F142-SC-001): the single-pass door keeps its own supervision, untouched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  platformProcessTableIo,
  processGroupOf,
  signalGroup,
  signalNameOf,
  startTimeOf,
  type ProcessTableIo,
} from "@specstride/kernel";
import type {
  RegistryEntry,
  SignalRefusal,
  SignalSender,
  SignalTarget,
} from "../../../core/src/pass-supervision/ports.ts";
import { START_TIME_TOLERANCE_MS } from "../run-control/signal-owned.ts";

/* ------------------------------------------------------------------ *
 * A — the identity record of a worker in flight.
 * ------------------------------------------------------------------ */

/**
 * The record of ONE worker of a group, in flight. It is the single-pass
 * record `{pid, startedAtMs}` with the three names a worker answers for:
 * the worker id (F143-FR-010), the hash of the run token (F143-FR-018, and
 * F122-FR-024: only the hash of a token ever reaches a record) and the
 * process group of its own (F143-FR-010) that the ladder and the guard
 * signal. `startedAtMs` is the START TIME OBSERVED AT THE START, the one
 * identity number of the worker from then on.
 */
export type WorkerIdentityRecord = {
  readonly workerId: string;
  readonly pid: number;
  readonly startedAtMs: number;
  readonly processGroup: number;
  readonly runTokenHash: string;
};

/** The target the ladder and the stop of a run are given for one worker. */
export type WorkerSignalTarget = SignalTarget & {
  /** The group recorded at the start, used where the table cannot read one. */
  readonly processGroup?: number | undefined;
};

/**
 * Writes the record where the engine (and a later run, and the survivor
 * search of F143-FR-018) reads it. One file per worker, under the run's
 * control root, as the single pass writes its one `pass.pid`.
 */
export function writeWorkerIdentityRecord(path: string, record: WorkerIdentityRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record));
}

/**
 * Reads the record back, or `undefined` for a file that is absent or not a
 * record. A reader of a half-written or foreign file must never throw: the
 * survivor search reads these files after a crash, when anything may be
 * there.
 */
export function readWorkerIdentityRecord(path: string): WorkerIdentityRecord | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Partial<WorkerIdentityRecord>;
  if (typeof record.workerId !== "string" || record.workerId === "") return undefined;
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) {
    return undefined;
  }
  if (
    typeof record.startedAtMs !== "number" ||
    !Number.isInteger(record.startedAtMs) ||
    record.startedAtMs <= 0
  ) {
    return undefined;
  }
  if (
    typeof record.processGroup !== "number" ||
    !Number.isInteger(record.processGroup) ||
    record.processGroup <= 0
  ) {
    return undefined;
  }
  if (typeof record.runTokenHash !== "string" || record.runTokenHash === "") return undefined;
  return Object.freeze({
    workerId: record.workerId,
    pid: record.pid,
    startedAtMs: record.startedAtMs,
    processGroup: record.processGroup,
    runTokenHash: record.runTokenHash,
  });
}

/* ------------------------------------------------------------------ *
 * B — the worker sender: the identity check, then the worker's own group.
 * ------------------------------------------------------------------ */

/**
 * The sender of the stop ladder for ONE WORKER of a group (F100-FR-064's
 * check, F143-FR-010's group). The check is the single-pass check, facet for
 * facet: the run-token hash of the registry entry, the liveness of the pid,
 * the start time OBSERVED NOW against the one recorded at the start — and a
 * live process whose start time the host cannot observe is refused, because
 * the number alone identifies nothing (a reused pid would be signalled).
 *
 * What is different is the reach: a worker LEADS A GROUP OF ITS OWN, so a
 * proven worker is ended THROUGH ITS GROUP — `kill(-pgid)` — which reaches
 * the harness and every child of its tree, not the leader alone. The group
 * used is the one OBSERVED of the process the check just proved, and where
 * the table cannot read one, the group RECORDED AT THE START: both name the
 * group of the same proved process, and the recorded one is never used
 * before the check has passed, so a reused pid (a stranger's group) is never
 * signalled. With neither group available the leader itself is signalled.
 */
export function workerSignalSender(
  entryOf: (pid: number) => RegistryEntry | undefined,
  io: ProcessTableIo = platformProcessTableIo,
): SignalSender {
  return {
    signal(target, kind) {
      if (!Number.isInteger(target.pid) || target.pid <= 1) return "not-an-integer-above-one";
      const entry = entryOf(target.pid);
      if (entry !== undefined && entry.identity.runTokenHash !== target.runTokenHash) {
        return "run-token-mismatch";
      }
      // Liveness first, so a process that is gone keeps its precise refusal
      // even where the table cannot say anything about the rest.
      try {
        process.kill(target.pid, 0);
      } catch {
        return "no-such-process";
      }
      const startedAtMs = startTimeOf(target.pid, io);
      if (startedAtMs === null) return "start-time-unobservable";
      if (Math.abs(startedAtMs - target.startedAtMs) > START_TIME_TOLERANCE_MS) {
        return "start-time-mismatch";
      }
      // The check has passed: this IS the worker. Its group is its own
      // (F143-FR-010); observe it, and fall back to the group recorded at
      // its start where the table cannot read one.
      const observed = processGroupOf(target.pid, io);
      const group = observed ?? (target as WorkerSignalTarget).processGroup ?? undefined;
      try {
        if (group !== undefined && group > 1) {
          signalGroup(group, kind);
        } else {
          process.kill(target.pid, signalNameOf(kind));
        }
        return undefined;
      } catch {
        return "no-such-process";
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * C — the stop ladder of a worker.
 * ------------------------------------------------------------------ */

/** The default SIGTERM-to-SIGKILL grace of a worker's ladder, in ms. */
export const WORKER_KILL_GRACE_MS_DEFAULT = 5_000;

/** What the ladder did to one worker. */
export type WorkerStop = {
  /** Where the ladder stopped: the polite rung sufficed, the kill went out, or the handle took over. */
  readonly reached: "terminate" | "kill" | "handle";
  /** Every refusal the sender made, in order. Empty where it never refused. */
  readonly refusals: readonly SignalRefusal[];
};

/**
 * Whether a pid is gone — a zombie the reaper has not collected still holds
 * its pid and answers `kill(pid, 0)`, so the state is read where the host
 * shows it, as the guard reads it. Exported for the group runner, whose
 * pause and stops wait on the same state.
 */
export function processIsGone(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close >= 0 && stat.slice(close + 2).split(" ")[0] === "Z") return true;
  } catch {
    // No /proc: the kill probe above is the whole answer.
  }
  return false;
}

/**
 * THE STOP LADDER OF ONE WORKER: the polite signal to its group, then —
 * where the worker is STILL THERE after the grace — the kill. Every rung
 * goes through the sender's identity check, so a reused pid is refused and
 * never signalled. Where the sender refuses (a host that cannot read the
 * table, macOS among them), the engine ends the worker through the handle
 * it holds — `signalGroup` of the harness handle — so the kill never depends
 * on the table; the caller's `endTheChild` is that handle.
 */
export async function stopTheWorker(input: {
  readonly sender: SignalSender;
  readonly target: WorkerSignalTarget;
  readonly graceMs?: number | undefined;
  /** The engine's own handle on the worker: its last rung. */
  readonly endTheChild?: ((signal: NodeJS.Signals) => void) | undefined;
  /** Settle a test or a clock other than the real one. */
  readonly settleMs?: ((ms: number) => Promise<void>) | undefined;
}): Promise<WorkerStop> {
  const graceMs = input.graceMs ?? WORKER_KILL_GRACE_MS_DEFAULT;
  const settle =
    input.settleMs ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const refusals: SignalRefusal[] = [];
  const terminate = input.sender.signal(input.target, "terminate");
  // `polite` is true only where the sender SENT the polite signal: then, and
  // only then, may "the worker is gone after the grace" mean the polite rung
  // sufficed. Where the sender refused, the worker was never politely
  // signalled at all, and the ladder goes on to its next rung.
  const polite = terminate === undefined;
  if (!polite) {
    refusals.push(terminate);
    input.endTheChild?.("SIGTERM");
  }
  await settle(graceMs);
  // The polite rung may have sufficed; a worker that is gone gets no kill.
  if (polite && processIsGone(input.target.pid)) {
    return Object.freeze({ reached: "terminate" as const, refusals: Object.freeze(refusals) });
  }
  const kill = input.sender.signal(input.target, "kill");
  if (kill !== undefined) {
    refusals.push(kill);
    input.endTheChild?.("SIGKILL");
    return Object.freeze({ reached: "handle" as const, refusals: Object.freeze(refusals) });
  }
  return Object.freeze({ reached: "kill" as const, refusals: Object.freeze(refusals) });
}

/* ------------------------------------------------------------------ *
 * D — the guard of a worker: one per worker, watching the engine.
 * ------------------------------------------------------------------ */

/**
 * The source of a WORKER guard, a standalone Node script of the plainest
 * kind, as the pass guard of `pass-guard.ts` is: no imports of the product,
 * no arguments but numbers, so it survives the engine and every change
 * around it. It watches the engine and, when the engine is gone by identity,
 * ends ITS OWN worker THROUGH THE WORKER'S GROUP — the reach the pass guard
 * does not need and a worker does, because the group may hold the harness's
 * own children beside the leader. The rule of the stop ladder holds here
 * too: a worker whose observed start time does not match the record is a
 * stranger, and a stranger is never signalled.
 */
export function workerGuardSource(): string {
  return `#!/usr/bin/env node
// The worker guard of the Specstride engine: ends its worker's GROUP when the
// engine is gone. argv: <enginePid> <engineStartMs|0> <workerPid> <workerStartMs> <workerGroup> <pollMs> <graceMs>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [enginePid, engineStartMs, workerPid, workerStartMs, workerGroup, pollMs, graceMs] = process.argv.slice(2).map(Number);
// An engine start of 0 means the host could not observe it: the guard falls
// back to the liveness of the engine pid alone, the best identity it has.
const engineStartKnown = engineStartMs > 0;
const TOLERANCE_MS = 1000;
let ticksPerSecond = 0;
function hz() {
  if (ticksPerSecond > 0) return ticksPerSecond;
  try {
    ticksPerSecond = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
  } catch {
    ticksPerSecond = 100;
  }
  return ticksPerSecond;
}
// The start time of a pid in milliseconds, or null where it cannot be
// observed — Linux through /proc, macOS through ps, as the kernel reads them.
function startedMsOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).split(" ");
    const ticks = Number(fields[19]);
    const btime = Number(
      (fs.readFileSync("/proc/stat", "utf8").split("\\n").find((l) => l.startsWith("btime ")) || "").slice(6),
    );
    if (!Number.isFinite(ticks) || !Number.isFinite(btime) || btime <= 0) return null;
    return Math.round(btime * 1000 + (ticks / hz()) * 1000);
  } catch {
    return null;
  }
}
function startedMsThroughPs(pid) {
  try {
    const line = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
    if (line.length === 0) return null;
    const ms = Date.parse(line);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
function startOf(pid) {
  const throughProc = startedMsOf(pid);
  if (throughProc !== null) return throughProc;
  return startedMsThroughPs(pid);
}
// Alive, and not a corpse the reaper has not collected: a zombie holds its
// pid, and kill(pid, 0) answers for it the same as for the living.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const close = stat.lastIndexOf(")");
    if (close >= 0 && stat.slice(close + 2).split(" ")[0] === "Z") return false;
  } catch {
    // No /proc: the kill probe above is the whole answer.
  }
  return true;
}
function sameStart(pid, recordedMs) {
  if (recordedMs <= 0) return false;
  const observed = startOf(pid);
  return observed !== null && Math.abs(observed - recordedMs) <= TOLERANCE_MS;
}
// The group signal reaches the whole tree of the worker; a group of 1 or
// less is no group at all, and the leader itself is signalled instead.
function signalTheWorker(signal) {
  if (Number.isInteger(workerGroup) && workerGroup > 1) {
    try {
      process.kill(-workerGroup, signal);
      return;
    } catch {
      // The group is gone, or was never one; fall through to the leader.
    }
  }
  try {
    process.kill(workerPid, signal);
  } catch {
    // It ended between the check and the signal.
  }
}
function endTheWorker() {
  // Only a worker whose identity still matches the record: a reused pid is a
  // stranger, and a stranger is never signalled.
  if (!sameStart(workerPid, workerStartMs)) process.exit(0);
  signalTheWorker("SIGTERM");
  const deadline = Date.now() + (graceMs > 0 ? graceMs : 5000);
  // This interval is what holds the guard alive through the grace; it exits
  // with the process the moment the worker is gone.
  const escalate = setInterval(() => {
    if (!alive(workerPid)) process.exit(0);
    if (Date.now() < deadline) return;
    clearInterval(escalate);
    if (sameStart(workerPid, workerStartMs)) signalTheWorker("SIGKILL");
    setTimeout(() => process.exit(0), 250);
  }, Math.min(pollMs > 0 ? pollMs : 250, 200));
  setTimeout(() => process.exit(0), (graceMs > 0 ? graceMs : 5000) + 2000).unref();
}
// No process.title is set: the kernel would rewrite /proc/<pid>/cmdline with
// it, and the argument list — script, engine pid, worker pid — is exactly what
// an observer of a run needs to see (a survivor hunt scans for it).
const watch = setInterval(() => {
  if (!alive(workerPid)) {
    // The worker ended by itself; the guard retires with it.
    clearInterval(watch);
    process.exit(0);
  }
  const engineGone = engineStartKnown
    ? !alive(enginePid) || !sameStart(enginePid, engineStartMs)
    : !alive(enginePid);
  if (!engineGone) return;
  clearInterval(watch);
  endTheWorker();
}, pollMs > 0 ? pollMs : 250);
setTimeout(() => process.exit(0), 24 * 3600 * 1000).unref();
`;
}

/** Writes the worker-guard script where the engine can spawn it; cheap, so per run. */
export function writeWorkerGuardScript(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, workerGuardSource());
}

/** The knobs of one worker guard. */
export interface WorkerGuardInput {
  /** The guard script, as `writeWorkerGuardScript` wrote it. */
  readonly scriptPath: string;
  /** The engine the worker belongs to. */
  readonly enginePid: number;
  /** The engine's start time in ms, or 0 where the host cannot observe it. */
  readonly engineStartedAtMs: number;
  /** The worker in flight. */
  readonly workerPid: number;
  /** The worker's start time in ms, read at the start. */
  readonly workerStartedAtMs: number;
  /** The worker's own process group (F143-FR-010), which the guard signals. */
  readonly workerGroup: number;
  /** How often the guard looks at the engine, in ms. */
  readonly pollMs: number;
  /** The SIGTERM-to-SIGKILL grace of the guard, in ms. */
  readonly graceMs: number;
  /** The Node that runs the guard (the engine's own executable). */
  readonly nodeExecutable?: string;
}

/**
 * Starts the guard of ONE worker. One worker, one guard: a group of N holds
 * N guards, each ended by the engine when its worker ends, and each ending
 * its worker the moment the engine is gone. It never holds the engine back:
 * the child is unref'd, and the engine may end a guard by pid at any time —
 * it holds nothing.
 */
export function startWorkerGuard(input: WorkerGuardInput): ChildProcess | undefined {
  // The numbers travel as the argument list, so the guard never depends on
  // the engine's arguments; its environment it inherits once at the spawn,
  // and what happens to the engine's own copy afterwards cannot reach it.
  const guard = spawn(
    input.nodeExecutable ?? process.execPath,
    [
      input.scriptPath,
      String(input.enginePid),
      String(input.engineStartedAtMs),
      String(input.workerPid),
      String(input.workerStartedAtMs),
      String(input.workerGroup),
      String(input.pollMs),
      String(input.graceMs),
    ],
    { stdio: "ignore" },
  );
  guard.unref();
  return guard;
}

/* ------------------------------------------------------------------ *
 * E — the supervised start of one worker.
 * ------------------------------------------------------------------ */

/** What the start of one worker is handed, as the group executor starts it. */
export type SupervisedWorkerStart = {
  readonly workerId: string;
  readonly pid: number;
  /** The start time the harness handle recorded (ISO), as it is. */
  readonly startTime?: string | undefined;
  /** The group the harness started for the worker (F143-FR-010). */
  readonly processGroup?: number | undefined;
  readonly runTokenHash: string;
};

/** What a supervised start hands back to the group executor. */
export type SupervisedWorker = {
  readonly record: WorkerIdentityRecord;
  /** The guard standing beside the worker; ended by the caller at the end. */
  readonly guard: ChildProcess | undefined;
  /** The last rung of the ladder: the way to end the worker by handle. */
  readonly endTheChild: (signal: NodeJS.Signals) => void;
};

/**
 * START ONE WORKER UNDER SUPERVISION. The order is the single-pass order,
 * worker for worker: the start is made, the start time is OBSERVED ONCE, the
 * guard is planted BEFORE anything of the worker is written where an
 * observer (or a killer) can see it, then the identity record is written and
 * the process is registered — so whoever learns the worker is in flight
 * learns with it that a guard already stands beside it.
 *
 * `register` is the composition root's door into the process registry: it is
 * handed the fields of F143-FR-010 (the class `owned`, the pid, the start
 * time, the run token hash and the worker id) plus the group, and it is what
 * writes the `specstride.procs/1` entry (kind `worker-pass`, one file per
 * writer, the entry before the worker can do any work).
 */
export async function startSupervisedWorker(input: {
  /** Starts the harness process of the worker (the `startPass` door). */
  readonly start: (workerId: string) => Promise<SupervisedWorkerStart>;
  readonly workerId: string;
  /** The engine the guard watches. */
  readonly enginePid: number;
  readonly engineStartedAtMs: number;
  /** Where the identity record of the worker is written. */
  readonly recordPath: string;
  /** The guard script, as `writeWorkerGuardScript` wrote it. */
  readonly guardScriptPath: string;
  readonly guardPollMs?: number | undefined;
  readonly guardGraceMs?: number | undefined;
  /** The registry door: the `owned` entry of the worker (F143-FR-010). */
  readonly register?:
    | ((entry: {
        readonly kind: "worker-pass";
        readonly class: "owned";
        readonly pid: number;
        readonly startedAtMs: number;
        readonly runTokenHash: string;
        readonly workerId: string;
        readonly processGroup: number;
      }) => Promise<void> | void)
    | undefined;
  /** Reads a start time the host can observe; defaults to the kernel table. */
  readonly startTimeOf?: ((pid: number) => number | null) | undefined;
  /** The clock of the record where the host cannot observe a start time. */
  readonly nowMs?: (() => number) | undefined;
  /** Ends the worker by handle: the harness handle's `signalGroup`. */
  readonly endTheChild?: ((signal: NodeJS.Signals) => void) | undefined;
}): Promise<SupervisedWorker> {
  const started = await input.start(input.workerId);
  // The start time is read ONCE, at the start: every later identity check —
  // the ladder, the guard, a survivor search — answers to THIS number.
  const startedAtMs =
    (input.startTimeOf ?? startTimeOf)(started.pid) ?? (input.nowMs ?? Date.now)();
  const processGroup = started.processGroup ?? started.pid;
  const record: WorkerIdentityRecord = Object.freeze({
    workerId: started.workerId,
    pid: started.pid,
    startedAtMs,
    processGroup,
    runTokenHash: started.runTokenHash,
  });
  const guard = startWorkerGuard({
    scriptPath: input.guardScriptPath,
    enginePid: input.enginePid,
    engineStartedAtMs: input.engineStartedAtMs,
    workerPid: started.pid,
    workerStartedAtMs: startedAtMs,
    workerGroup: processGroup,
    pollMs: input.guardPollMs ?? 250,
    graceMs: input.guardGraceMs ?? WORKER_KILL_GRACE_MS_DEFAULT,
  });
  writeWorkerIdentityRecord(input.recordPath, record);
  if (input.register !== undefined) {
    await input.register({
      kind: "worker-pass",
      class: "owned",
      pid: record.pid,
      startedAtMs: record.startedAtMs,
      runTokenHash: record.runTokenHash,
      workerId: record.workerId,
      processGroup: record.processGroup,
    });
  }
  return Object.freeze({
    record,
    guard,
    endTheChild: input.endTheChild ?? (() => undefined),
  });
}

/* ------------------------------------------------------------------ *
 * F — the watchdog of a worker.
 * ------------------------------------------------------------------ */

/**
 * THE WATCHDOG OF ONE WORKER: the time ceiling of the worker's pass, ticked
 * on the same checks the single pass is ticked on (`runWatchdogTick` of the
 * pass supervision, the `hard_cap` check here), and carried out through the
 * worker's ladder. One interval per worker, held by the caller of the group;
 * `stop()` ends it when the worker ends, whichever of them ended first.
 */
export function startWorkerWatchdog(input: {
  readonly sender: SignalSender;
  readonly target: WorkerSignalTarget;
  /** The worker's pass start, in ms — the base the ceiling is measured on. */
  readonly startedAtMs: number;
  /** The ceiling of the worker's pass, in seconds. */
  readonly ceilingSec: number;
  readonly tickMs?: number | undefined;
  readonly graceMs?: number | undefined;
  /** Settle a test or a clock other than the real one (the ladder's grace). */
  readonly settleMs?: ((ms: number) => Promise<void>) | undefined;
  /** The engine's own handle on the worker: its last rung. */
  readonly endTheChild?: ((signal: NodeJS.Signals) => void) | undefined;
  /** Told once, when a kill was decided and the ladder has run. */
  readonly onKilled?: ((reason: string, elapsedSec: number) => void) | undefined;
}): {
  readonly stop: () => void;
  readonly kill: () =>
    | {
        readonly reason: "hard_cap";
        readonly elapsedSec: number;
        /** Where the ladder stopped, as the engine's classification will need it. */
        readonly reached: WorkerStop["reached"];
      }
    | undefined;
} {
  const tickMs = input.tickMs ?? 15_000;
  let ceilingReached = false;
  let killed:
    | {
        readonly reason: "hard_cap";
        readonly elapsedSec: number;
        readonly reached: WorkerStop["reached"];
      }
    | undefined;
  const tick = async (): Promise<void> => {
    if (ceilingReached) return;
    const elapsedSec = Math.round((Date.now() - input.startedAtMs) / 1000);
    if (elapsedSec < input.ceilingSec) return;
    ceilingReached = true;
    const stop = await stopTheWorker({
      sender: input.sender,
      target: input.target,
      graceMs: input.graceMs,
      settleMs: input.settleMs,
      endTheChild: input.endTheChild,
    });
    killed = Object.freeze({ reason: "hard_cap", elapsedSec, reached: stop.reached });
    input.onKilled?.(killed.reason, elapsedSec);
  };
  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  return Object.freeze({
    stop: () => clearInterval(timer),
    kill: () => {
      void tick();
      return killed;
    },
  });
}
