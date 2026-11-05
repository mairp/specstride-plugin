/**
 * T027 — the clocks of a pause (F127-FR-012).
 *
 * A pause of five hours must not look like five hours of work. Three clocks
 * therefore EXCLUDE the time in a pause:
 *
 *  - the WALL-CLOCK BUDGET of the run (`loop.maxWallMin`, F127-FR-026): it is
 *    measured per engine start, less the paused time;
 *  - the TIMEOUT OF A PASS: a pass that waited three hours for a window has
 *    not been running for three hours;
 *  - the STALL WATCHDOG: a paused run is not a stalled run, and a watchdog
 *    that counted the pause would kill the very thing the pause protects.
 *
 * The excluded time is recorded as `pausedMs` ON THE PHASE ATTEMPT AND ON THE
 * RUN; the run's figure lives in the spend ledger under `run.pausedMs`
 * (`../budget/ledger.ts`).
 *
 * And the last sentence of F127-FR-012: a quota signal inside a UNIT OF WORK
 * of the micro-loop layer pauses like any pass and uses NO INNER CAP — the one
 * pause of the run covers it, and the unit is given back when the run resumes.
 *
 * Every duration here is measured on the MONOTONIC reading of the clock port,
 * which a clock change does not move (annex A §A.3). F127-FR-015 asks for the
 * remaining WAIT to be computed from the record and never from a timer; that
 * is `./recover.ts`. The two are different questions: how long the run has
 * worked (monotonic, here) and when the window reopens (the record, there).
 */
import type { Clock } from "./ports.ts";

/* ------------------------------------------------------------------ *
 * The accumulated paused time.
 * ------------------------------------------------------------------ */

/** The paused time of one phase attempt and of the run (F127-FR-012). */
export type PausedTime = {
  /** The milliseconds this PHASE ATTEMPT has spent in a pause. */
  readonly attemptPausedMs: number;
  /** The milliseconds the RUN has spent in a pause (ledger `run.pausedMs`). */
  readonly runPausedMs: number;
};

/** No pause yet. */
export function noPausedTime(): PausedTime {
  return Object.freeze({ attemptPausedMs: 0, runPausedMs: 0 });
}

/** A pause that has begun and not yet ended. */
export type OpenPause = {
  /** The monotonic reading at the start of the pause. */
  readonly openedAtMonotonicMs: number;
  /** The wall reading at the start, for the record's `since`. */
  readonly openedAtMs: number;
};

/** Open a pause: take the readings the close will measure against. */
export function openPause(clock: Clock): OpenPause {
  return Object.freeze({
    openedAtMonotonicMs: clock.monotonicMs(),
    openedAtMs: clock.nowMs(),
  });
}

/**
 * Close a pause and add its milliseconds to the attempt and to the run
 * (F127-FR-012). The duration comes from the MONOTONIC reading, so a clock
 * change during the pause cannot make `pausedMs` negative or absurd.
 */
export function closePause(
  clock: Clock,
  open: OpenPause,
  before: PausedTime,
): { readonly pausedMs: number; readonly after: PausedTime } {
  const pausedMs = Math.max(0, clock.monotonicMs() - open.openedAtMonotonicMs);
  return Object.freeze({
    pausedMs,
    after: Object.freeze({
      attemptPausedMs: before.attemptPausedMs + pausedMs,
      runPausedMs: before.runPausedMs + pausedMs,
    }),
  });
}

/** Add a known number of paused milliseconds, for a recovered pause. */
export function addPausedMs(before: PausedTime, pausedMs: number): PausedTime {
  const add = Number.isFinite(pausedMs) && pausedMs > 0 ? pausedMs : 0;
  return Object.freeze({
    attemptPausedMs: before.attemptPausedMs + add,
    runPausedMs: before.runPausedMs + add,
  });
}

/** A new phase attempt: the attempt's figure starts at 0, the run's carries. */
export function nextAttempt(before: PausedTime): PausedTime {
  return Object.freeze({ attemptPausedMs: 0, runPausedMs: before.runPausedMs });
}

/* ------------------------------------------------------------------ *
 * The three clocks that exclude it.
 * ------------------------------------------------------------------ */

/** The three clocks of F127-FR-012 that exclude the time in a pause. */
export const CLOCKS_THAT_EXCLUDE_A_PAUSE = Object.freeze([
  "wall-clock-budget",
  "pass-timeout",
  "stall-watchdog",
] as const);
export type ClockThatExcludesAPause = (typeof CLOCKS_THAT_EXCLUDE_A_PAUSE)[number];

/** Elapsed time less the time in a pause; never negative (F127-FR-012). */
export function excludePaused(elapsedMs: number, pausedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const paused = Number.isFinite(pausedMs) && pausedMs > 0 ? pausedMs : 0;
  return Math.max(0, elapsed - paused);
}

/**
 * The wall-clock budget of the run, as the baseline measures it, less the time
 * in a pause (F127-FR-012, F127-FR-026). It is measured PER ENGINE START, so
 * the caller hands the monotonic reading at the start of this engine.
 */
export function wallClockElapsedMs(input: {
  readonly startedAtMonotonicMs: number;
  readonly nowMonotonicMs: number;
  readonly pausedMs: number;
}): number {
  return excludePaused(input.nowMonotonicMs - input.startedAtMonotonicMs, input.pausedMs);
}

/** The whole minutes of the wall-clock budget, as the baseline counts them. */
export function wallClockMinutes(input: {
  readonly startedAtMonotonicMs: number;
  readonly nowMonotonicMs: number;
  readonly pausedMs: number;
}): number {
  return Math.floor(wallClockElapsedMs(input) / 60_000);
}

/**
 * The milliseconds a pass has left of its timeout, with the time in a pause
 * excluded (F127-FR-012). A limit of 0 or a non-finite limit is no timeout and
 * answers `null`.
 */
export function passTimeoutRemainingMs(input: {
  readonly limitMs: number | null | undefined;
  readonly elapsedMs: number;
  readonly pausedMs: number;
}): number | null {
  const limit = input.limitMs;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.max(0, limit - excludePaused(input.elapsedMs, input.pausedMs));
}

/**
 * The milliseconds the stall watchdog has left, with the time in a pause
 * excluded (F127-FR-012). A paused run is not a stalled run: a watchdog that
 * counted the pause would kill the run the pause exists to keep alive.
 */
export function stallWatchdogRemainingMs(input: {
  readonly limitMs: number | null | undefined;
  readonly sinceLastOutputMs: number;
  readonly pausedMs: number;
}): number | null {
  const limit = input.limitMs;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.max(0, limit - excludePaused(input.sinceLastOutputMs, input.pausedMs));
}

/** True where the pass timeout has tripped, with the pause excluded. */
export function passTimedOut(input: {
  readonly limitMs: number | null | undefined;
  readonly elapsedMs: number;
  readonly pausedMs: number;
}): boolean {
  const left = passTimeoutRemainingMs(input);
  return left !== null && left === 0;
}

/** True where the stall watchdog has fired, with the pause excluded. */
export function watchdogFired(input: {
  readonly limitMs: number | null | undefined;
  readonly sinceLastOutputMs: number;
  readonly pausedMs: number;
}): boolean {
  const left = stallWatchdogRemainingMs(input);
  return left !== null && left === 0;
}

/* ------------------------------------------------------------------ *
 * `pausedMs` as the records carry it.
 * ------------------------------------------------------------------ */

/** The field the ledger carries the run's figure in (annex B §B.20). */
export const LEDGER_FIELD = "run.pausedMs" as const;

/** The figure as the phase attempt and the run record carry it. */
export function pausedMsOf(time: PausedTime): {
  readonly attempt: { readonly pausedMs: number };
  readonly run: { readonly pausedMs: number };
} {
  return Object.freeze({
    attempt: Object.freeze({ pausedMs: time.attemptPausedMs }),
    run: Object.freeze({ pausedMs: time.runPausedMs }),
  });
}

/* ------------------------------------------------------------------ *
 * A quota signal inside a unit of work of the micro-loop layer.
 * ------------------------------------------------------------------ */

/** What a quota signal inside a unit of work does (F127-FR-012). */
export type UnitOfWorkPause = {
  /** True: it pauses like any pass. */
  readonly pausesLikeAPass: true;
  /** False: it uses NO inner cap of the micro-loop layer. */
  readonly usesAnInnerCap: false;
  /** True: the unit is given back when the run resumes. */
  readonly unitGivenBackAtTheResume: true;
  /** The `endCause` of the unit, which is the one of the pass that holds it. */
  readonly endCause: "quota_pause";
  readonly note: string;
};

/**
 * F127-FR-012 — a quota signal inside a unit of work of the micro-loop layer
 * pauses like any pass and uses NO inner cap.
 *
 * There is one pause of the run (F127-FR-010), so a unit of work has no pause
 * of its own and no cap of its own to spend: it ends with `quota_pause` with
 * the pass that holds it and is given back at the resume.
 */
export function pauseInsideAUnitOfWork(unitId: string): UnitOfWorkPause {
  return Object.freeze({
    pausesLikeAPass: true as const,
    usesAnInnerCap: false as const,
    unitGivenBackAtTheResume: true as const,
    endCause: "quota_pause" as const,
    note:
      `the quota signal inside the unit of work ${unitId} pauses the run like any pass; the ` +
      `unit uses no inner cap of the micro-loop layer and is given back at the resume ` +
      `(F127-FR-012)`,
  });
}
