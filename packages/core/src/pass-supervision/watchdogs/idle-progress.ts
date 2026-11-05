/**
 * T022 of feature 118 — the idle watchdog and the disk-progress watchdog
 * (F118-FR-003; C-058; B-0601, B-0603, B-0707, B-0711).
 *
 * Both are pure functions over the observations the tick loop (T025) hands
 * in: the clock, the CPU sum of the pass tree (the `ProcessList` port) and
 * the newest modification time under the progress roots (the `FileReader`
 * port). No file and no process is read here.
 *
 * Idle: the pass is ended only after the idle period in which the CPU sum of
 * the whole process tree did not change, with the kill reason `idle_timeout`
 * (default period 900 seconds).
 *
 * Progress: checked every fourth tick only; any file created or modified
 * under the progress roots resets the timer; after the progress period
 * without a change the pass is ended with the kill reason `progress_stall`
 * (default period 1,800 seconds; a period of 0 disables the watchdog).
 */

/** The default idle period of the idle watchdog, in seconds (F118-FR-001). */
export const IDLE_TIMEOUT_DEFAULT_SEC = 900;

/** The default progress period of the disk-progress watchdog, in seconds. */
export const PROGRESS_TIMEOUT_DEFAULT_SEC = 1800;

/** The disk-progress watchdog is checked every fourth tick (F118-FR-002). */
export const PROGRESS_EVERY_NTH_TICK = 4;

/** What the idle watchdog decided. */
export interface IdleKill {
  readonly reason: "idle_timeout";
  /** How long the pass had run when the idle period was judged spent. */
  readonly elapsedSec: number;
  /** How long the CPU sum had stayed unchanged, in seconds. */
  readonly idleSec: number;
}

/** The observations one idle check reads (all times in milliseconds). */
export interface IdleCheck {
  /** The time of this tick. */
  readonly nowMs: number;
  /** When the pass started. */
  readonly startedAtMs: number;
  /** The idle period in force, in seconds (0 does not disable — the pass
   *  must stay bounded; only the progress watchdog has a 0 = off). */
  readonly idleTimeoutSec: number;
  /** The CPU sum of the pass tree at this tick (`ProcessList` port). */
  readonly cpuSumMs: number;
  /** The CPU sum at the previous tick (equal means "no progress"). */
  readonly previousCpuSumMs: number;
  /** The last time the CPU sum changed. */
  readonly cpuLastChangedAtMs: number;
}

/**
 * The idle watchdog. Fires only when the CPU sum of the whole tree is
 * unchanged since the previous tick AND has been unchanged for at least the
 * whole idle period. A tree that burned CPU in between resets the clock.
 */
export function idleWatchdog(check: IdleCheck): IdleKill | undefined {
  const unchangedThisTick = check.cpuSumMs === check.previousCpuSumMs;
  if (!unchangedThisTick) return undefined;
  const unchangedForMs = check.nowMs - check.cpuLastChangedAtMs;
  if (unchangedForMs < check.idleTimeoutSec * 1000) return undefined;
  return {
    reason: "idle_timeout",
    elapsedSec: Math.round((check.nowMs - check.startedAtMs) / 1000),
    idleSec: Math.round(unchangedForMs / 1000),
  };
}

/** What the disk-progress watchdog decided. */
export interface ProgressKill {
  readonly reason: "progress_stall";
  readonly elapsedSec: number;
  /** How long nothing under the roots had changed, in seconds. */
  readonly stallSec: number;
}

/** The observations one disk-progress check reads (times in milliseconds). */
export interface ProgressCheck {
  readonly nowMs: number;
  readonly startedAtMs: number;
  /** The progress period in force, in seconds; 0 disables the watchdog. */
  readonly progressTimeoutSec: number;
  /** The newest modification time under the roots this tick observed, or
   *  the pass start when nothing exists yet. */
  readonly newestModifiedAtMs: number;
  /** The newest modification time the previous ticks observed. */
  readonly lastRecordedProgressAtMs: number;
}

/** True when the disk-progress watchdog runs on this tick (every fourth). */
export function progressDueThisTick(tick: number): boolean {
  return tick % PROGRESS_EVERY_NTH_TICK === 0;
}

/**
 * The disk-progress watchdog. A file created or modified under the roots
 * (a newer `newestModifiedAtMs`) resets the timer by being newer than the
 * recorded progress; after the progress period without a change the pass is
 * ended with `progress_stall`.
 */
export function progressWatchdog(check: ProgressCheck): ProgressKill | undefined {
  if (check.progressTimeoutSec === 0) return undefined;
  const newest = Math.max(check.newestModifiedAtMs, check.lastRecordedProgressAtMs);
  const quietForMs = check.nowMs - newest;
  if (quietForMs < check.progressTimeoutSec * 1000) return undefined;
  return {
    reason: "progress_stall",
    elapsedSec: Math.round((check.nowMs - check.startedAtMs) / 1000),
    stallSec: Math.round(quietForMs / 1000),
  };
}
