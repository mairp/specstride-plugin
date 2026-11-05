/**
 * The pass guard: the sibling that ends a pass when its engine dies
 * (reviewer's note 1 of `results/step-1.done` — the step-1 gate clause
 * "SIGKILL of the engine leaves no survivor").
 *
 * The engine supervises every pass it starts, but a SIGKILL ends the engine
 * itself in mid-tick, and the pass — a child like any other — survives it.
 * Nothing ends that survivor while no resume runs, so the engine plants a
 * GUARD for every pass in flight: a tiny standalone process, a sibling of the
 * pass, that watches the engine and ends the pass the moment the engine is
 * gone. The rule of the stop ladder holds in the guard too: it never signals
 * a process whose observed start time does not match the record it was given
 * (a reused pid names a stranger), and it does nothing at all while the
 * engine lives its normal life — when the pass ends by itself, the guard
 * retires with it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The source of the guard, a standalone Node script of the plainest kind: no
 * imports of the product, no arguments but numbers, so it survives the engine
 * and every change around it. Kept here as the one place that owns it.
 */
export function passGuardSource(): string {
  return `#!/usr/bin/env node
// The pass guard of the Specstride engine: ends the pass when its engine is
// gone. argv: <enginePid> <engineStartMs|0> <passPid> <passStartMs> <pollMs> <graceMs>
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [enginePid, engineStartMs, passPid, passStartMs, pollMs, graceMs] = process.argv.slice(2).map(Number);
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
function endThePass() {
  // Only a pass whose identity still matches the record: a reused pid is a
  // stranger, and a stranger is never signalled.
  if (!sameStart(passPid, passStartMs)) process.exit(0);
  try {
    process.kill(passPid, "SIGTERM");
  } catch {
    process.exit(0);
  }
  const deadline = Date.now() + (graceMs > 0 ? graceMs : 5000);
  // This interval is what holds the guard alive through the grace; it exits
  // with the process the moment the pass is gone.
  const escalate = setInterval(() => {
    if (!alive(passPid)) process.exit(0);
    if (Date.now() < deadline) return;
    clearInterval(escalate);
    if (sameStart(passPid, passStartMs)) {
      try {
        process.kill(passPid, "SIGKILL");
      } catch {
        // It ended between the check and the signal.
      }
    }
    setTimeout(() => process.exit(0), 250);
  }, Math.min(pollMs > 0 ? pollMs : 250, 200));
  setTimeout(() => process.exit(0), (graceMs > 0 ? graceMs : 5000) + 2000).unref();
}
// No process.title is set: the kernel would rewrite /proc/<pid>/cmdline with
// it, and the argument list — script, engine pid, pass pid — is exactly what
// an observer of a run needs to see (a survivor hunt scans for it).
const watch = setInterval(() => {
  if (!alive(passPid)) {
    // The pass ended by itself; the guard retires with it.
    clearInterval(watch);
    process.exit(0);
  }
  const engineGone = engineStartKnown
    ? !alive(enginePid) || !sameStart(enginePid, engineStartMs)
    : !alive(enginePid);
  if (!engineGone) return;
  clearInterval(watch);
  endThePass();
}, pollMs > 0 ? pollMs : 250);
setTimeout(() => process.exit(0), 24 * 3600 * 1000).unref();
`;
}

/** Writes the guard script where the engine can spawn it; cheap, so per run. */
export function writePassGuardScript(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, passGuardSource());
}

/** The knobs of one guard. */
export interface PassGuardInput {
  /** The guard script, as `writePassGuardScript` wrote it. */
  readonly scriptPath: string;
  /** The engine the pass belongs to. */
  readonly enginePid: number;
  /** The engine's start time in ms, or 0 where the host cannot observe it. */
  readonly engineStartedAtMs: number;
  /** The pass in flight. */
  readonly passPid: number;
  /** The pass's start time in ms, read at the spawn. */
  readonly passStartedAtMs: number;
  /** How often the guard looks at the engine, in ms. */
  readonly pollMs: number;
  /** The SIGTERM-to-SIGKILL grace of the guard, in ms. */
  readonly graceMs: number;
  /** The Node that runs the guard (the engine's own executable). */
  readonly nodeExecutable?: string;
}

/**
 * Starts the guard of one pass. It never holds the engine back: the child is
 * unref'd, the guard retires when the pass ends, and the engine may end the
 * guard by pid at any time — it holds nothing.
 */
export function startPassGuard(input: PassGuardInput): ChildProcess | undefined {
  // The numbers travel as the argument list, so the guard never depends on
  // the engine's arguments; its environment it inherits once at the spawn,
  // and what happens to the engine's own copy afterwards cannot reach it.
  const guard = spawn(
    input.nodeExecutable ?? process.execPath,
    [
      input.scriptPath,
      String(input.enginePid),
      String(input.engineStartedAtMs),
      String(input.passPid),
      String(input.passStartedAtMs),
      String(input.pollMs),
      String(input.graceMs),
    ],
    { stdio: "ignore" },
  );
  guard.unref();
  return guard;
}
