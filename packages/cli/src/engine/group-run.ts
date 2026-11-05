/**
 * THE RUN OF N SUPERVISED WORKERS OF ONE GROUP, at the engine level (step 2
 * of `prompts/specstride-parallel-units.md`; F143-FR-010, F143-FR-013,
 * F143-FR-015, F143-FR-016, F143-FR-018).
 *
 * The primitives live in `worker-supervisor.ts` (the identity record, the
 * sender, the ladder, the guard, the supervised start, the watchdog); the
 * decisions live in `@specstride/core`'s parallel module (`inSlicesOfAtMost`,
 * `mayRestart`, `theGroupPause`, `evaluateTheCap`, `outcomeOfWorker`). What
 * this module owns is the piece between them — the one place where the
 * engine carries the core's decisions OUT on real processes and real files:
 *
 *   - the start of the group's workers, AT MOST `workers` AT A TIME (core
 *     `inSlicesOfAtMost` decides the slices; the supervised start plants one
 *     guard per worker, writes one identity record per worker and hands the
 *     process registry the `owned` entry of F143-FR-010);
 *   - ONE WATCHDOG PER WORKER, from the pass ceiling of the run, whose kill
 *     marks the worker's end `killed` (the data model's mapping of a
 *     watchdog/timeout end) — and a watchdog kill is NOT a restart, which is
 *     the gate-tension decision recorded in `results/par-2.progress`;
 *   - the GROUP PAUSE carried out (F143-FR-015): core `theGroupPause` counts
 *     and decides, and the real ports of the pause are the polite send of
 *     each live worker plus the doors the caller hands in for the one pause
 *     record and the one pause event;
 *   - the SPENDING-LIMIT CAP carried out (F143-FR-016): at every usage
 *     record core `evaluateTheCap` sums over the live workers, and where the
 *     sum crosses the cap the ladder ends EVERY worker of the group;
 *   - THE SURVIVOR SEARCH at engine start and at `resume` (F143-FR-018):
 *     the identity records left under this run's token by an engine that
 *     died, each ended after the identity check — a reused pid whose start
 *     time differs is refused and NEVER signalled — and no resume started.
 *
 * What this module does NOT own, and must not grow into: the trees, the
 * workspace parts, the handoffs and the snapshots of a group (the tree store
 * and the composition root, step 3), the parallel ledger and its events (the
 * queue, step 3 — the pause's record and event reach it through the doors
 * handed in), the persistence of a worker's `restartsUsed` across a relaunch
 * (the 8-state resume, F143-FR-025, step 4 — here the plan the caller hands
 * a fresh runner carries it), and the sweep of a tree, which waits until
 * every process of the tree is ended (F143-FR-018, last clause). The runner
 * holds no harness handle of its own beyond the `start` and `endTheChild`
 * it is handed: the door the composition root passes in is the worker pass
 * door of `worker-pass.ts` (the real drive) or a stub (the tests).
 */
import type { ChildProcess } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { sessionOf } from "@specstride/kernel";
import type { ProcessTableIo } from "@specstride/kernel";
import type {
  RegistryAccess,
  RegistryEntry,
  SignalRefusal,
  SignalSender,
} from "../../../core/src/pass-supervision/ports.ts";
import {
  evaluateTheCap,
  inSlicesOfAtMost,
  mayRestart,
  theGroupPause,
  type CapEvaluation,
  type InterruptionNotItsOwn,
  type LiveWorker,
  type PlannedWorker,
  type QuotaSignal,
  type RestartRefusal,
  type UsageRecord,
} from "../../../core/src/parallel/group-executor.ts";
import {
  outcomeOfWorker,
  type DerivedOutcome,
  type WorkerEnd,
} from "../../../core/src/parallel/barrier.ts";
import {
  processIsGone,
  readWorkerIdentityRecord,
  startSupervisedWorker,
  startWorkerWatchdog,
  stopTheWorker,
  workerSignalSender,
  type SupervisedWorkerStart,
  type WorkerIdentityRecord,
  type WorkerSignalTarget,
} from "./worker-supervisor.ts";

/* ------------------------------------------------------------------ *
 * Where a group's records live, and what the registry is told.
 * ------------------------------------------------------------------ */

/**
 * The directory of the identity records of a feature's workers, under the
 * control root, as the single pass writes its `pass.pid` beside the feature's
 * own files: the records outlive the engine that wrote them, which is what
 * the survivor search of F143-FR-018 reads after a crash.
 */
export function workersDirectoryOf(controlRoot: string, slug: string): string {
  return join(controlRoot, "features", slug, "workers");
}

/** The record of one worker, by its worker id. */
export function workerRecordPathOf(workersDir: string, workerId: string): string {
  return join(workersDir, `${workerId}.pid`);
}

/**
 * The registry entry of one worker (F143-FR-010): the class `pass` of a
 * process in flight of the run — a worker is never `adoptable` and does not
 * survive a stop — under the logical name `worker:<workerId>`, with the
 * worker's own group as the entry's process group and the start time
 * OBSERVED ONCE at the start as the identity's start time.
 */
export function workerRegistryEntryOf(record: WorkerIdentityRecord): RegistryEntry {
  return {
    logicalName: `worker:${record.workerId}`,
    identity: {
      pid: record.pid,
      groupId: record.processGroup,
      sessionId: sessionOf(record.pid) ?? record.pid,
      startedAtMs: record.startedAtMs,
      runTokenHash: record.runTokenHash,
    },
    registryClass: "pass",
    survivesStop: false,
  };
}

/** One identity record found on disk, with the file it was read from. */
export type LocatedWorkerRecord = {
  readonly path: string;
  readonly record: WorkerIdentityRecord;
};

/**
 * Every VALID identity record of a workers directory, one per file. A file
 * that is absent, half-written or foreign is skipped, never thrown over —
 * this runs after a crash, when anything may be in the directory.
 */
export function workerRecordsOf(workersDir: string): readonly LocatedWorkerRecord[] {
  let names: string[];
  try {
    names = readdirSync(workersDir);
  } catch {
    return [];
  }
  const found: LocatedWorkerRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".pid")) continue;
    const path = join(workersDir, name);
    const record = readWorkerIdentityRecord(path);
    if (record !== undefined) found.push({ path, record });
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * F143-FR-018 — the survivor search at engine start and at resume.
 * ------------------------------------------------------------------ */

/** What the survivor search found, for the caller to say and report. */
export type LeftoverWorkersReport = {
  /** The valid records read from the directory (and handed in beside it). */
  readonly searched: number;
  /** The records under THIS run's token: the holders of the run token. */
  readonly holders: readonly { readonly workerId: string; readonly pid: number }[];
  /** The holders the search ended through their groups; records removed. */
  readonly ended: readonly { readonly workerId: string; readonly pid: number }[];
  /** The holders already gone by themselves; their stale records removed. */
  readonly alreadyGone: readonly { readonly workerId: string; readonly pid: number }[];
  /**
   * The holders the identity check refused, with the reason — A REUSED PID
   * whose start time differs is one of these, and is NEVER signalled. Their
   * records are KEPT, so the next start asks again.
   */
  readonly refused: readonly {
    readonly workerId: string;
    readonly pid: number;
    readonly because: SignalRefusal;
  }[];
  /** A holder the ladder ran against that is STILL there. Record kept. */
  readonly stillAlive: readonly { readonly workerId: string; readonly pid: number }[];
  /** The records of OTHER run tokens, left for the runs that own them. */
  readonly leftForAnotherToken: number;
};

/**
 * THE SURVIVOR SEARCH OF THE RUN TOKEN (F143-FR-018): at engine start and at
 * `resume`, read the identity records of the workers directory, keep the
 * holders of THIS run's token, and end each after the identity check — the
 * same check the ladder uses, so a live process whose start time differs
 * from its record (a reused pid) is refused and never signalled, and a
 * holder that ended by itself leaves only a stale record, which is removed.
 * No resume is started: the workers of a dead engine have no checkpoint to
 * carry (a worker pass makes one proposal, F143-FR-011), and what returns to
 * the main line returns through the resume states of F143-FR-025, not
 * through a process that outlived its engine.
 *
 * Records of ANOTHER run's token are not ours to end and are left where they
 * are; `status` and the doctor report the whole answer from this return
 * value (the wiring of those commands joins them through it).
 */
export async function endTheLeftoverWorkers(input: {
  readonly workersDir: string;
  /** The hash of THIS run's token — the hash, never the token (F122-FR-024). */
  readonly runTokenHash: string;
  /** Records read from beside the directory (a registry, say), united in. */
  readonly also?: readonly WorkerIdentityRecord[] | undefined;
  readonly graceMs?: number | undefined;
  readonly settleMs?: ((ms: number) => Promise<void>) | undefined;
  readonly io?: ProcessTableIo | undefined;
  readonly sender?: SignalSender | undefined;
  readonly say?: ((line: string) => void) | undefined;
}): Promise<LeftoverWorkersReport> {
  const located = workerRecordsOf(input.workersDir);
  const seen = new Set<string>();
  const holders: WorkerIdentityRecord[] = [];
  let leftForAnotherToken = 0;
  for (const record of [...located.map((l) => l.record), ...(input.also ?? [])]) {
    const key = `${String(record.pid)}:${String(record.startedAtMs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (record.runTokenHash !== input.runTokenHash) {
      leftForAnotherToken += 1;
      continue;
    }
    holders.push(record);
  }
  const sender =
    input.sender ??
    // The records were already filtered by the token, so the sender's own
    // registry check has nothing to add here: liveness and the start time
    // observed once at the worker's start are the identity that survives a
    // crash. (On a host with no readable table EVERY live holder is refused
    // `start-time-unobservable` — a process the sender cannot identify is
    // never signalled, and its record stays for the next start.)
    workerSignalSender(() => undefined, input.io);
  const ended: { workerId: string; pid: number }[] = [];
  const alreadyGone: { workerId: string; pid: number }[] = [];
  const refused: { workerId: string; pid: number; because: SignalRefusal }[] = [];
  const stillAlive: { workerId: string; pid: number }[] = [];
  const locatedByPid = new Map(located.map((l) => [l.record.pid, l]));
  for (const holder of holders) {
    const target: WorkerSignalTarget = {
      pid: holder.pid,
      startedAtMs: holder.startedAtMs,
      runTokenHash: holder.runTokenHash,
      processGroup: holder.processGroup,
    };
    const stop = await stopTheWorker({
      sender,
      target,
      graceMs: input.graceMs,
      settleMs: input.settleMs,
    });
    const last = stop.refusals[stop.refusals.length - 1];
    const gone = processIsGone(holder.pid);
    if (gone) {
      // Gone — by the search, or before it. The record has outlived its
      // worker either way, and comes off the disk.
      if (last === "no-such-process") {
        alreadyGone.push({ workerId: holder.workerId, pid: holder.pid });
      } else {
        ended.push({ workerId: holder.workerId, pid: holder.pid });
        input.say?.(
          `ended the worker ${holder.workerId} left over from an earlier engine (pid ${String(holder.pid)})`,
        );
      }
      const file = locatedByPid.get(holder.pid);
      if (file !== undefined) rmSync(file.path, { force: true });
      continue;
    }
    if (last === undefined) {
      // The ladder sent everything it has and the worker is still there.
      stillAlive.push({ workerId: holder.workerId, pid: holder.pid });
      continue;
    }
    if (last === "no-such-process") {
      // The sender could not identify it an instant ago and the probe now
      // says it is there: the answer is not settled, and the record stays.
      refused.push({ workerId: holder.workerId, pid: holder.pid, because: last });
      continue;
    }
    // A stranger holds the pid now, or the host cannot identify the process:
    // NEVER signalled, and the record stays for the next start to ask again.
    refused.push({ workerId: holder.workerId, pid: holder.pid, because: last });
  }
  return Object.freeze({
    searched: located.length + (input.also?.length ?? 0),
    holders: Object.freeze(holders.map((h) => ({ workerId: h.workerId, pid: h.pid }))),
    ended: Object.freeze(ended),
    alreadyGone: Object.freeze(alreadyGone),
    refused: Object.freeze(refused),
    stillAlive: Object.freeze(stillAlive),
    leftForAnotherToken,
  });
}

/* ------------------------------------------------------------------ *
 * The group: N workers started, watched, paused, capped, ended.
 * ------------------------------------------------------------------ */

/**
 * One planned worker of a group, as the supervision of step 2 needs it. The
 * tree arrives with the tree store (step 3); until then it is optional and
 * the empty string stands for "no tree of its own yet".
 */
export type PlannedGroupWorker = {
  readonly workerId: string;
  readonly task: string;
  /** Its position in the order of the tasks at launch, from 1. */
  readonly taskPosition: number;
  readonly tree?: string | undefined;
  /** How many restarts the plan says it has already used (F143-FR-013). */
  readonly restartsUsed?: number | undefined;
};

/** One worker of the group, as the runner holds it in flight. */
export type GroupWorkerRow = {
  readonly workerId: string;
  readonly task: string;
  readonly taskPosition: number;
  readonly tree: string;
  readonly pid: number;
  readonly processGroup: number;
  /** The start time OBSERVED ONCE at the start — the worker's identity. */
  readonly startedAtMs: number;
  readonly restartsUsed: number;
  /** The end the runner observed, once it has observed one. */
  readonly end?: WorkerEnd | undefined;
};

/** The doors the pause's one record and one event go through (F143-FR-015). */
export type GroupPauseDoors = {
  /** The one pause record (`pause.record`), as core `theGroupPause` writes it. */
  readonly pauseRecord: (record: Readonly<Record<string, unknown>>) => Promise<void> | void;
  /** The one pause event (`run.paused`), as core `theGroupPause` emits it. */
  readonly emitEvent: (event: Readonly<Record<string, unknown>>) => Promise<void> | void;
};

/** What the runner is, once the group's workers are started. */
export type WorkerGroup = {
  /** Every row still in flight, in the order they were started. */
  readonly rows: () => readonly GroupWorkerRow[];
  /** The rows still live, as the pause and the cap see them. */
  readonly liveWorkers: () => readonly LiveWorker[];
  /** The observed end of one worker, or `undefined` where it still runs. */
  readonly theEndOf: (workerId: string) => WorkerEnd | undefined;
  /** The outcome the barrier will derive from a row's end, with no checkpoint. */
  readonly outcomeOfTheEnd: (workerId: string) => DerivedOutcome;
  /**
   * F143-FR-013 — may this worker be restarted, after an interruption it did
   * not cause (a crash of the engine, a relaunch, a quota pause)? A WATCHDOG
   * KILL IS NOT ONE OF THEM — the end `killed` is refused — and the answer
   * spends the worker's one restart: the second ask is refused, and the
   * task's second failure stays on the main line.
   */
  readonly mayRestartTheWorker: (
    workerId: string,
    interruption: InterruptionNotItsOwn | WorkerEnd,
  ) =>
    | {
        readonly restart: true;
        readonly inItsTree: string;
        readonly session: "fresh";
        readonly restartIndex: number;
      }
    | { readonly restart: false; readonly because: RestartRefusal };
  /**
   * F143-FR-015 — carry out the group pause: the polite stop to every live
   * worker, the trees kept, THE ONE record and THE ONE event through the
   * doors. A sibling's second signal changes nothing (F143-SC-003).
   */
  readonly carryOutTheGroupPause: (input: {
    readonly signal: QuotaSignal;
    readonly groupId: string;
    readonly doors: GroupPauseDoors;
  }) => Promise<{
    readonly politelyStopped: readonly string[];
    readonly recordsWritten: number;
    readonly eventsEmitted: number;
    readonly treesKept: readonly string[];
  }>;
  /**
   * F143-FR-016 — one usage record: the cap is evaluated ON THE SUM OVER THE
   * LIVE WORKERS, and where the sum crosses it, EVERY worker of the group
   * ends through the ladder.
   */
  readonly recordUsage: (workerId: string, spent: number, cap: number) => Promise<CapEvaluation>;
  /** The end of every live worker through the ladder (`stop --now`, the cap). */
  readonly endAllOfTheGroup: (end: WorkerEnd) => Promise<readonly string[]>;
  /** An end the caller observed and hands in (`ended`, `harness-error`). */
  readonly markTheEnd: (workerId: string, end: WorkerEnd) => void;
  /**
   * The bookkeeping of a run that closes: the watchdogs stop and the guards
   * are ended. Live workers are NOT ended here — an ordinary stop lets the
   * group close (F143-FR-026); the caller that ends them says so through
   * `endAllOfTheGroup`.
   */
  readonly retire: () => void;
};

/** How long an ended worker is given to be gone before the runner moves on. */
const THE_WORKER_SETTLE_MS = 3_000;

/** A pause settle of tests, and of nothing else: the polite send returns at once. */
const settleOf = (
  settleMs: ((ms: number) => Promise<void>) | undefined,
): ((ms: number) => Promise<void>) =>
  settleMs ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

/**
 * START THE WORKERS OF A GROUP UNDER SUPERVISION. The slices are core's
 * (`inSlicesOfAtMost`, at most `workers` of them at a time, in the order of
 * the plan); each worker is started through the supervised start — guard
 * first, then the identity record, then the registry's `owned` entry — and
 * given ITS OWN watchdog, ticked from its pass start against the pass
 * ceiling of the run. A watchdog kill runs the worker's ladder through the
 * sender and ends the row: the end is `killed`, and the task returns to the
 * main line (F143-FR-014) — the restart of F143-FR-013 belongs to a
 * relaunch, never to the kill itself.
 */
export async function startGroupWorkers(input: {
  readonly planned: readonly PlannedGroupWorker[];
  readonly workersAtATime: number;
  /** The hash of the run token — the hash, never the token (F122-FR-024). */
  readonly runTokenHash: string;
  readonly enginePid: number;
  readonly engineStartedAtMs: number;
  readonly workersDir: string;
  readonly guardScriptPath: string;
  readonly guardPollMs?: number | undefined;
  readonly guardGraceMs?: number | undefined;
  /** The pass ceiling of the group's workers, in seconds. */
  readonly ceilingSec: number;
  readonly watchdogTickMs?: number | undefined;
  /** The ladder's SIGTERM-to-SIGKILL grace, in ms. */
  readonly graceMs?: number | undefined;
  readonly settleMs?: ((ms: number) => Promise<void>) | undefined;
  /** Starts the harness process of one worker (the `startPass` door). */
  readonly start: (workerId: string) => Promise<SupervisedWorkerStart>;
  readonly registry: RegistryAccess;
  readonly say?: ((line: string) => void) | undefined;
}): Promise<WorkerGroup> {
  type InFlight = {
    readonly planned: PlannedGroupWorker;
    readonly record: WorkerIdentityRecord;
    readonly watchdog: ReturnType<typeof startWorkerWatchdog>;
    readonly guard: ChildProcess | undefined;
    readonly endTheChild: (signal: NodeJS.Signals) => void;
    end: WorkerEnd | undefined;
    restartsUsed: number;
    finished: boolean;
  };
  const rows: InFlight[] = [];
  const pauseState = theGroupPause();
  const usage = new Map<string, number>();
  const settle = settleOf(input.settleMs);

  // The sender of the group's ladder answers to the registry entries the
  // runner itself wrote: a pid that was never one of this group's workers
  // has no entry, and a worker's entry carries the token hash of its start.
  const entryOf = (pid: number): RegistryEntry | undefined => {
    const row = rows.find((r) => r.record.pid === pid);
    return row === undefined ? undefined : workerRegistryEntryOf(row.record);
  };
  const sender = workerSignalSender(entryOf);

  const finishRow = (row: InFlight): void => {
    if (row.finished) return;
    row.finished = true;
    row.watchdog.stop();
    rmSync(workerRecordPathOf(input.workersDir, row.record.workerId), { force: true });
    input.registry.remove(`worker:${row.record.workerId}`);
    if (row.guard !== undefined) {
      try {
        row.guard.kill("SIGKILL");
      } catch {
        // The guard retired with its worker already.
      }
    }
  };

  const waitUntilGone = async (pid: number): Promise<void> => {
    const deadline = Date.now() + THE_WORKER_SETTLE_MS;
    while (!processIsGone(pid) && Date.now() < deadline) {
      await settle(50);
    }
  };

  for (const slice of inSlicesOfAtMost(input.planned, input.workersAtATime)) {
    for (const planned of slice) {
      const supervised = await startSupervisedWorker({
        start: input.start,
        workerId: planned.workerId,
        enginePid: input.enginePid,
        engineStartedAtMs: input.engineStartedAtMs,
        recordPath: workerRecordPathOf(input.workersDir, planned.workerId),
        guardScriptPath: input.guardScriptPath,
        guardPollMs: input.guardPollMs,
        guardGraceMs: input.guardGraceMs,
        register: (entry) => {
          input.registry.put({
            logicalName: `worker:${entry.workerId}`,
            identity: {
              pid: entry.pid,
              groupId: entry.processGroup,
              sessionId: sessionOf(entry.pid) ?? entry.pid,
              startedAtMs: entry.startedAtMs,
              runTokenHash: entry.runTokenHash,
            },
            registryClass: "pass",
            survivesStop: false,
          });
        },
      });
      const row: InFlight = {
        planned,
        record: supervised.record,
        guard: supervised.guard,
        endTheChild: supervised.endTheChild,
        end: undefined,
        restartsUsed: planned.restartsUsed ?? 0,
        finished: false,
        watchdog: startWorkerWatchdog({
          sender,
          target: {
            pid: supervised.record.pid,
            startedAtMs: supervised.record.startedAtMs,
            runTokenHash: supervised.record.runTokenHash,
            processGroup: supervised.record.processGroup,
          },
          startedAtMs: supervised.record.startedAtMs,
          ceilingSec: input.ceilingSec,
          tickMs: input.watchdogTickMs,
          graceMs: input.graceMs,
          settleMs: input.settleMs,
          endTheChild: supervised.endTheChild,
          onKilled: () => {
            // THE RUNTIME ended the worker: the end is `killed` (the data
            // model's mapping of a watchdog/timeout end), the row closes,
            // and the task returns to the main line. This is NOT a restart
            // (F143-FR-013): a restart belongs to a relaunch.
            row.end = "killed";
            finishRow(row);
            input.say?.(
              `[${planned.workerId}] the watchdog ended the worker over its ceiling (${String(input.ceilingSec)}s); its task returns to the main line`,
            );
          },
        }),
      };
      rows.push(row);
    }
  }

  const rowOf = (workerId: string): InFlight => {
    const row = rows.find((r) => r.record.workerId === workerId);
    if (row === undefined) throw new Error(`no worker \`${workerId}\` of this group`);
    return row;
  };
  const viewOf = (row: InFlight): GroupWorkerRow =>
    Object.freeze({
      workerId: row.record.workerId,
      task: row.planned.task,
      taskPosition: row.planned.taskPosition,
      tree: row.planned.tree ?? "",
      pid: row.record.pid,
      processGroup: row.record.processGroup,
      startedAtMs: row.record.startedAtMs,
      restartsUsed: row.restartsUsed,
      ...(row.end === undefined ? {} : { end: row.end }),
    });

  /** The full ladder against one live row, then the row's close. */
  const endTheWorker = async (row: InFlight, end: WorkerEnd): Promise<void> => {
    if (row.finished) return;
    await stopTheWorker({
      sender,
      target: {
        pid: row.record.pid,
        startedAtMs: row.record.startedAtMs,
        runTokenHash: row.record.runTokenHash,
        processGroup: row.record.processGroup,
      },
      graceMs: input.graceMs,
      settleMs: input.settleMs,
      endTheChild: row.endTheChild,
    });
    row.end = end;
    finishRow(row);
    await waitUntilGone(row.record.pid);
  };

  // The literal is typed FIRST and frozen AFTER: the contextual type of
  // `WorkerGroup` does not reach the members through `Object.freeze`, and
  // the method parameters were falling back to implicit `any`.
  const group: WorkerGroup = {
    rows: () => Object.freeze(rows.filter((r) => !r.finished).map(viewOf)),
    liveWorkers: () =>
      Object.freeze(
        rows
          .filter((r) => !r.finished)
          .map((r): LiveWorker =>
            Object.freeze({
              workerId: r.record.workerId,
              pid: r.record.pid,
              processGroup: r.record.processGroup,
              tree: r.planned.tree ?? "",
            }),
          ),
      ),
    theEndOf: (workerId) => rowOf(workerId).end,
    outcomeOfTheEnd: (workerId) => {
      const row = rowOf(workerId);
      if (row.end === undefined) throw new Error(`the worker \`${workerId}\` has not ended yet`);
      // The barrier derives the full outcome from the checkpoint too; this
      // bridge carries the END half of it, with no checkpoint in hand.
      return outcomeOfWorker({
        workerId,
        assignedTask: row.planned.task,
        end: row.end,
        checkpoint: undefined,
      });
    },
    mayRestartTheWorker: (workerId, interruption) => {
      const row = rowOf(workerId);
      const candidate: PlannedWorker = {
        workerId,
        task: row.planned.task,
        scope: [],
        // The tree is the tree store's to make (step 3); the restart happens
        // in it, and the empty string is what step 2 has instead.
        tree: row.planned.tree ?? "",
        temporaryDirectory: "",
        token: "",
        taskPosition: row.planned.taskPosition,
        restartsUsed: row.restartsUsed,
      };
      const answer = mayRestart({ worker: candidate, interruption });
      if (answer.restart) row.restartsUsed = answer.restartIndex;
      return answer;
    },
    carryOutTheGroupPause: async ({ signal, groupId, doors }) => {
      const live = rows.filter((r) => !r.finished);
      const pause = await pauseState.pauseTheGroup(
        {
          politeStop: async (worker) => {
            const row = rows.find((r) => r.record.workerId === worker.workerId);
            if (row === undefined) return false;
            // THE POLITE STOP, and nothing more (F143-FR-015): the terminate
            // rung of the worker's ladder, through the identity check. The
            // trees are kept; the passes close with the cause of the pause.
            const target: WorkerSignalTarget = {
              pid: row.record.pid,
              startedAtMs: row.record.startedAtMs,
              runTokenHash: row.record.runTokenHash,
              processGroup: row.record.processGroup,
            };
            return sender.signal(target, "terminate") === undefined;
          },
          // The doors of the engine may be sync; core's PausePorts want
          // promises — the hand-over normalizes, the door contract stays.
          pauseRecord: async (record) => {
            await doors.pauseRecord(record);
          },
          emitEvent: async (event) => {
            await doors.emitEvent(event);
          },
        },
        {
          signal,
          groupId,
          liveWorkers: live.map((r): LiveWorker =>
            Object.freeze({
              workerId: r.record.workerId,
              pid: r.record.pid,
              processGroup: r.record.processGroup,
              tree: r.planned.tree ?? "",
            }),
          ),
        },
      );
      for (const workerId of pause.politelyStopped) {
        const row = rowOf(workerId);
        row.end = "paused";
        finishRow(row);
        await waitUntilGone(row.record.pid);
      }
      return Object.freeze({
        politelyStopped: Object.freeze([...pause.politelyStopped]),
        recordsWritten: pause.recordsWritten,
        eventsEmitted: pause.eventsEmitted,
        treesKept: Object.freeze([...pause.treesKept]),
      });
    },
    recordUsage: async (workerId, spent, cap) => {
      usage.set(workerId, spent);
      const records: UsageRecord[] = [...usage].map(([id, value]) => ({
        workerId: id,
        spent: value,
      }));
      const evaluation = evaluateTheCap({
        cap,
        usage: records,
        liveWorkers: rows.filter((r) => !r.finished).map((r) => r.record.workerId),
        workersOfTheGroup: rows.map((r) => r.record.workerId),
      });
      if (evaluation.crossed) {
        for (const id of evaluation.endTheseWorkers) {
          const row = rows.find((r) => r.record.workerId === id);
          if (row !== undefined) await endTheWorker(row, "killed");
        }
      }
      return evaluation;
    },
    endAllOfTheGroup: async (end) => {
      const endedNow: string[] = [];
      for (const row of rows) {
        if (row.finished) continue;
        await endTheWorker(row, end);
        endedNow.push(row.record.workerId);
      }
      return Object.freeze(endedNow);
    },
    markTheEnd: (workerId, end) => {
      const row = rowOf(workerId);
      if (row.finished) return;
      row.end = end;
      finishRow(row);
    },
    retire: () => {
      for (const row of rows) {
        row.watchdog.stop();
        if (row.guard !== undefined) {
          try {
            row.guard.kill("SIGKILL");
          } catch {
            // Already retired.
          }
        }
      }
    },
  };
  return Object.freeze(group);
}
