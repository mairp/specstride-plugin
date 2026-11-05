/**
 * T025 of feature 118 — the tick loop and the order of the watchdogs
 * (F118-FR-001, F118-FR-002; C-058; B-0704, B-0706, B-0766).
 *
 * The watchdogs run while the pass runs in the background of the pass loop
 * and tick every 15 seconds by default. On each tick they check, in this
 * order: idle, process-level repetition, tool-level repetition, disk
 * progress (every fourth tick only), hard cap. The first watchdog that
 * decides a kill wins; the later ones are not consulted on that tick. Only
 * the stream records that arrived after the pass started are read — the
 * callers hand in exactly those records.
 */

import { progressDueThisTick } from "./idle-progress.ts";

/** The default tick of the watchdogs, in seconds (F118-FR-001). */
export const TICK_DEFAULT_SEC = 15;

/** The names of the five checks, in the order of F118-FR-002. */
export const WATCHDOG_ORDER = [
  "idle",
  "repeat-process",
  "repeat-tool",
  "progress",
  "hard_cap",
] as const;

/** One name of `WATCHDOG_ORDER`. */
export type WatchdogName = (typeof WATCHDOG_ORDER)[number];

/** What one watchdog decided (the union of the kill shapes of this module). */
export type WatchdogKill =
  | { reason: "idle_timeout"; elapsedSec: number; idleSec?: number }
  | { reason: "repeat_stall"; check: "process" | "tool"; offender?: unknown }
  | { reason: "progress_stall"; elapsedSec: number; stallSec?: number }
  | { reason: "hard_cap"; elapsedSec: number };

/** A check: a pure observation that returns a kill, or `undefined`, to go on. */
export type WatchdogCheck = () => WatchdogKill | undefined;

/** The result of one tick. */
export interface TickResult {
  /** The kill of the first watchdog that decided one, or `undefined`. */
  readonly kill: WatchdogKill | undefined;
  /** The checks that ran, in the order of F118-FR-002. */
  readonly invoked: readonly WatchdogName[];
  /** The tick number this result belongs to (1-based). */
  readonly tick: number;
}

/**
 * One tick of the watchdogs. `checks` names the check that supplies each
 * watchdog's decision; the disk-progress check is consulted only on every
 * fourth tick. The checks run in the order of F118-FR-002 and stop at the
 * first kill.
 */
export function runWatchdogTick(
  tick: number,
  checks: Partial<Record<WatchdogName, WatchdogCheck>>,
): TickResult {
  const invoked: WatchdogName[] = [];
  for (const name of WATCHDOG_ORDER) {
    const check = checks[name];
    if (check === undefined) continue;
    if (name === "progress" && !progressDueThisTick(tick)) continue;
    invoked.push(name);
    const kill = check();
    if (kill !== undefined) return { kill, invoked, tick };
  }
  return { kill: undefined, invoked, tick };
}

/** How many milliseconds the pass loop sleeps between two ticks. */
export function tickIntervalMs(tickSec: number): number {
  return tickSec * 1000;
}
