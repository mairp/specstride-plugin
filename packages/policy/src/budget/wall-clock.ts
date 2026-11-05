/**
 * T074 — the whole-run wall-clock budget of the baseline (F127-FR-026).
 *
 * It is the one budget the baseline Specstride has at run level
 * (the baseline engine script, lines 224, 888 to 896 and 1765 to 1780), and this feature ports it
 * byte for byte on FX-23. Five things make it up, and this module holds them:
 *
 *  1. **the key and its alias** — `loop.maxWallMin`, with the as-is variable
 *     `SPECSTRIDE_MAX_WALL_MIN` as its alias (B-0049, DV-027);
 *  2. **the whole-minute test** — whole minutes elapsed since THIS engine
 *     started, less the time in a pause (F127-FR-012), compared with `>=`
 *     against the limit (B-0270);
 *  3. **0 never trips** — the default is 0, which is unlimited;
 *  4. **a non-numeric value never trips** — it is ignored, exactly as the
 *     baseline ignores it, and is never read as 1 or as the default of another
 *     key (B-0270);
 *  5. **the hand-off to the pass loop** — the run start and the limit, so that
 *     the pass loop can test the same budget inside a wait on a yield
 *     (B-0068; the baseline pass-loop script, lines 1518-1540).
 *
 * What this module is NOT: it takes no decision about the END of a run. The
 * phase-boundary check, the as-is line, `run_stop` and the terminal record are
 * `./wall-boundary.ts` (T075, F127-FR-027). The outcome of a yield wait is the
 * pass loop's, not this module's (F127-FR-027, last sentence).
 *
 * It reads no clock: the caller hands the monotonic readings, as every module
 * of this package does (`../quota/ports.ts`).
 */
import { outcomesOfAWaitOnAYield } from "@specstride/contracts/enums/all-sets";

import { wallClockElapsedMs, wallClockMinutes } from "../quota/clocks.ts";
import { CEILING_OF_TIME, isActive, isOff, type Ceiling } from "./ceilings.ts";

/* ------------------------------------------------------------------ *
 * 1. The key, its alias and the default (F127-FR-026; B-0049, DV-027).
 * ------------------------------------------------------------------ */

/** The configuration key of the budget (§Q.3, row 107 of annex X §X.7). */
export const WALL_CLOCK_KEY = "loop.maxWallMin" as const;

/** The as-is variable of the baseline, kept as the key's alias (DV-027). */
export const WALL_CLOCK_ALIAS = "SPECSTRIDE_MAX_WALL_MIN" as const;

/** The default of the key: 0, which is unlimited (B-0049). */
export const WALL_CLOCK_DEFAULT_MIN = 0 as const;

/** The value that means unlimited. It is the default, and it never trips. */
export const UNLIMITED = 0 as const;

/** The unit of the key and of the alias: whole minutes (F127-FR-026). */
export const WALL_CLOCK_UNIT = "whole minutes" as const;

/** The dimension of the ceiling this budget is, in the table of §Q.3. */
export const WALL_CLOCK_DIMENSION = CEILING_OF_TIME;

/** The budget as a ceiling of `./ceilings.ts`: run scope, dimension `wallClock`. */
export function wallClockCeiling(minutes: number | null | undefined): Ceiling {
  return Object.freeze({ scope: "run" as const, dimension: CEILING_OF_TIME, limit: minutes });
}

/* ------------------------------------------------------------------ *
 * 2. Reading the value: 0 and a non-numeric value never trip.
 * ------------------------------------------------------------------ */

/** Why a configured value is ignored, so that the budget never trips. */
export const WALL_CLOCK_IGNORED_REASONS = [
  "unset",
  "non-numeric",
  "not-a-whole-number",
  "zero-is-unlimited",
  "not-positive",
] as const;
export type WallClockIgnoredReason = (typeof WALL_CLOCK_IGNORED_REASONS)[number];

/** Where the limit in force came from. */
export const WALL_CLOCK_SOURCES = ["key", "alias", "default"] as const;
export type WallClockSource = (typeof WALL_CLOCK_SOURCES)[number];

/** The limit in force, after the whole-minute test of F127-FR-026. */
export type WallClockLimit = {
  /** The whole minutes in force; 0 where the budget never trips. */
  readonly minutes: number;
  /** True only where a trip is possible at all. */
  readonly active: boolean;
  /** The source of the value that was read. */
  readonly source: WallClockSource;
  /** The reason the value was ignored, or null where it was taken. */
  readonly ignored: WallClockIgnoredReason | null;
  /** The value as it was configured, for a message and for the doctor. */
  readonly raw: unknown;
};

/**
 * F127-FR-026 — the whole-minute test. A value that is not a whole number, or
 * 0, NEVER trips; neither does a value that is not a number at all, or that is
 * not finite, or that is negative. The answer then carries `minutes: 0`,
 * `active: false` and the reason, so that a caller can say why.
 *
 * A string is accepted, because the alias is an environment variable and
 * arrives as one: `"5"` is 5 minutes, `"abc"`, `""` and `"1.5"` are ignored.
 * The baseline's own test is a numeric comparison in the shell, which fails
 * closed on a non-numeric value (B-0270, the baseline engine script, line 893).
 */
export function readWallClockMinutes(
  value: unknown,
  source: WallClockSource = "key",
): WallClockLimit {
  const ignore = (reason: WallClockIgnoredReason): WallClockLimit =>
    Object.freeze({ minutes: UNLIMITED, active: false, source, ignored: reason, raw: value });

  if (value === null || value === undefined || value === "") return ignore("unset");

  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || !/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return ignore("non-numeric");
    numeric = Number(trimmed);
  } else {
    return ignore("non-numeric");
  }

  if (!Number.isFinite(numeric)) return ignore("non-numeric");
  if (!Number.isInteger(numeric)) return ignore("not-a-whole-number");
  if (numeric === 0) return ignore("zero-is-unlimited");
  if (numeric < 0) return ignore("not-positive");

  return Object.freeze({
    minutes: numeric,
    active: true,
    source,
    ignored: null,
    raw: value,
  });
}

/** The limit when nothing is configured: the default 0, unlimited (B-0049). */
export function defaultWallClockLimit(): WallClockLimit {
  return readWallClockMinutes(WALL_CLOCK_DEFAULT_MIN, "default");
}

/**
 * The limit in force from the key and from its alias (DV-027: the as-is
 * variable stays an alias of the key). The key wins where both carry a value,
 * because the alias table resolves `SPECSTRIDE_MAX_WALL_MIN` to the single key
 * `loop.maxWallMin` and the key is the name of the setting. Where neither
 * carries one, the default 0 is in force and the budget never trips.
 */
export function resolveWallClockLimit(input: {
  readonly key?: unknown;
  readonly alias?: unknown;
}): WallClockLimit {
  const fromKey = input.key;
  if (fromKey !== null && fromKey !== undefined && fromKey !== "") {
    return readWallClockMinutes(fromKey, "key");
  }
  const fromAlias = input.alias;
  if (fromAlias !== null && fromAlias !== undefined && fromAlias !== "") {
    return readWallClockMinutes(fromAlias, "alias");
  }
  return defaultWallClockLimit();
}

/** True where this limit can never trip, whatever time has elapsed. */
export function neverTrips(limit: WallClockLimit): boolean {
  return !limit.active;
}

/* ------------------------------------------------------------------ *
 * 3. The whole-minute test against the limit (B-0270).
 * ------------------------------------------------------------------ */

/** The readings the test is made from. It is measured PER ENGINE START. */
export type WallClockReading = {
  /** The monotonic reading taken when THIS engine started (F127-FR-026). */
  readonly startedAtMonotonicMs: number;
  /** The monotonic reading now. */
  readonly nowMonotonicMs: number;
  /** The time spent in a quota pause, which is excluded (F127-FR-012). */
  readonly pausedMs?: number | undefined;
};

/** The milliseconds elapsed since this engine started, less a pause. */
export function elapsedMs(reading: WallClockReading): number {
  return wallClockElapsedMs({
    startedAtMonotonicMs: reading.startedAtMonotonicMs,
    nowMonotonicMs: reading.nowMonotonicMs,
    pausedMs: reading.pausedMs ?? 0,
  });
}

/**
 * The WHOLE minutes elapsed, as the baseline counts them: the floor of the
 * elapsed milliseconds divided by 60 000. 59 seconds is 0 minutes; 61 seconds
 * is 1 (B-0270).
 */
export function wholeMinutesElapsed(reading: WallClockReading): number {
  return wallClockMinutes({
    startedAtMonotonicMs: reading.startedAtMonotonicMs,
    nowMonotonicMs: reading.nowMonotonicMs,
    pausedMs: reading.pausedMs ?? 0,
  });
}

/**
 * B-0270 — the rule, in one place: the budget is IGNORED when the value is
 * non-numeric or 0; otherwise it TRIPS when the whole minutes elapsed are
 * GREATER THAN OR EQUAL TO the limit.
 */
export function wallClockTrips(limit: WallClockLimit, minutes: number): boolean {
  if (!limit.active) return false;
  if (!Number.isFinite(minutes)) return false;
  return minutes >= limit.minutes;
}

/** What one test of the budget answers. */
export type WallClockEvaluation = {
  readonly limit: WallClockLimit;
  /** The whole minutes elapsed at the moment of the test. */
  readonly minutes: number;
  /** The milliseconds elapsed, for a message and for the ledger. */
  readonly elapsedMs: number;
  /** True only where the budget tripped (B-0270). */
  readonly trips: boolean;
};

/** One test of the budget: read the value, count the minutes, compare. */
export function evaluateWallClock(input: {
  readonly limit: WallClockLimit;
  readonly reading: WallClockReading;
}): WallClockEvaluation {
  const minutes = wholeMinutesElapsed(input.reading);
  return Object.freeze({
    limit: input.limit,
    minutes,
    elapsedMs: elapsedMs(input.reading),
    trips: wallClockTrips(input.limit, minutes),
  });
}

/**
 * The same evaluation straight from the configured value, for a caller that
 * holds the key and the alias rather than a read limit.
 */
export function evaluateFromConfig(input: {
  readonly key?: unknown;
  readonly alias?: unknown;
  readonly reading: WallClockReading;
}): WallClockEvaluation {
  return evaluateWallClock({
    limit: resolveWallClockLimit({ key: input.key, alias: input.alias }),
    reading: input.reading,
  });
}

/** The agreement with `./ceilings.ts`: an inactive limit is an off ceiling. */
export function agreesWithCeilings(limit: WallClockLimit): boolean {
  return limit.active ? isActive(limit.minutes) : isOff(limit.minutes);
}

/* ------------------------------------------------------------------ *
 * 4. The hand-off to the pass loop (B-0068, F127-FR-026 last sentence).
 * ------------------------------------------------------------------ */

/**
 * B-0068 — the two variables the baseline engine exports so that the pass loop
 * can enforce the same budget inside a wait on a yield: the run start as epoch
 * seconds, and the limit in whole minutes.
 */
export const PASS_LOOP_VARIABLES = ["SPECSTRIDE_RUN_START_EPOCH", WALL_CLOCK_ALIAS] as const;
export type PassLoopVariable = (typeof PASS_LOOP_VARIABLES)[number];

/** What the engine hands the pass loop (B-0068). */
export type PassLoopHandoff = {
  /** The run start, epoch seconds, as `SPECSTRIDE_RUN_START_EPOCH` carries it. */
  readonly runStartEpochSec: number;
  /** The limit in whole minutes; 0 where the budget never trips. */
  readonly maxWallMin: number;
  /** The monotonic reading of the engine start, for the pass loop's own test. */
  readonly startedAtMonotonicMs: number;
  /** The two variables, as the baseline exports them (B-0068). */
  readonly variables: Readonly<Record<PassLoopVariable, string>>;
};

/**
 * The run start and the limit, handed to the pass loop (F127-FR-026, last
 * sentence). The epoch seconds are a whole number, as the baseline's
 * `SPECSTRIDE_RUN_START_EPOCH` is.
 */
export function passLoopHandoff(input: {
  readonly limit: WallClockLimit;
  readonly startedAtEpochMs: number;
  readonly startedAtMonotonicMs: number;
}): PassLoopHandoff {
  const epochSec = Math.floor(input.startedAtEpochMs / 1000);
  return Object.freeze({
    runStartEpochSec: epochSec,
    maxWallMin: input.limit.minutes,
    startedAtMonotonicMs: input.startedAtMonotonicMs,
    variables: Object.freeze({
      SPECSTRIDE_RUN_START_EPOCH: String(epochSec),
      [WALL_CLOCK_ALIAS]: String(input.limit.minutes),
    } as Record<PassLoopVariable, string>),
  });
}

/**
 * The ending of a yield wait that a tripped budget gives. It is the member
 * `wall_budget` of the closed set of the endings of a yield (row 112 of annex
 * X §X.6, owner 118). The OUTCOME of the wait, and the reason recorded for it,
 * belong to the pass loop (F127-FR-027): this module only names the member.
 */
export const YIELD_ENDING_ON_A_TRIP = "wall_budget" as const;

/** The member is the one of row 112, read from the closed set itself. */
export function yieldEndingIsAMember(): boolean {
  return (outcomesOfAWaitOnAYield.members as readonly string[]).includes(YIELD_ENDING_ON_A_TRIP);
}

/** What one tick of a yield wait answers about the budget (B-0068). */
export type YieldTick = {
  readonly trips: boolean;
  readonly minutes: number;
  /** `wall_budget` where it tripped, else null; the pass loop records it. */
  readonly ending: typeof YIELD_ENDING_ON_A_TRIP | null;
  /** This module takes no decision about the wait; the pass loop does. */
  readonly decidedBy: "pass-loop";
};

/**
 * The test the pass loop makes at EACH TICK of a wait on a yield, from the
 * hand-off alone (B-0068, F127-FR-027). It answers the member `wall_budget`
 * where the budget tripped and leaves the decision to the pass loop.
 */
export function wallClockTickInAYield(input: {
  readonly handoff: PassLoopHandoff;
  readonly nowMonotonicMs: number;
  readonly pausedMs?: number | undefined;
}): YieldTick {
  const limit = readWallClockMinutes(input.handoff.maxWallMin, "key");
  const minutes = wholeMinutesElapsed({
    startedAtMonotonicMs: input.handoff.startedAtMonotonicMs,
    nowMonotonicMs: input.nowMonotonicMs,
    pausedMs: input.pausedMs ?? 0,
  });
  const trips = wallClockTrips(limit, minutes);
  return Object.freeze({
    trips,
    minutes,
    ending: trips ? YIELD_ENDING_ON_A_TRIP : null,
    decidedBy: "pass-loop" as const,
  });
}
