/**
 * T075 — the checks of the wall-clock budget at a phase boundary, and the
 * exit-4 path the baseline takes when it trips (F127-FR-027).
 *
 * `./wall-clock.ts` (T074) holds the budget itself: the key, the whole-minute
 * test, and the values that never trip. This module holds what the ENGINE does
 * with it:
 *
 *  1. **where** — at each phase-boundary step of a phase attempt, AFTER the
 *     stop request is tested (F127-FR-027; the steps are the boundaries at
 *     which the engine reads the stop request, F101-FR-040, F102-FR-003);
 *  2. **the as-is line** — `>>> wall-clock budget (<m>min) exceeded — halting
 *     (exit 4).`, byte for byte (B-0210, the baseline engine script, line 1774), printed in
 *     both output modes as the engine lines of the baseline are;
 *  3. **`run_stop`** — the reason `wall_budget` with the field `phase`
 *     (B-0143, the baseline engine script, line 1775);
 *  4. **exit 4** — at the top of a phase attempt (B-0127,
 *     the baseline engine script, line 1776);
 *  5. **the terminal record** — `retryable: true` and NO blocked reason; no
 *     `blocked` event, and no rest in `blocked-on-human` (F127-FR-027,
 *     CQ-192).
 *
 * The stop is therefore one that the relaunch classifier tables MAY relaunch,
 * as at the baseline. That is the whole point of CQ-192, and it is why this
 * path is NOT the hard-cap path of `./cap-stop.ts`: a reading of the dimension
 * `wallClock` is refused there and handed here.
 *
 * The outcome of a wait on a yield, and the reason recorded for it, belong to
 * the pass loop (F127-FR-027, last sentence); `wallClockTickInAYield` of
 * `./wall-clock.ts` gives the pass loop the test and nothing more.
 */
import { retryableFor } from "@specstride/contracts/codes/stop-reasons";
import {
  OUTPUT_MODES,
  mayBeWritten,
  type ComparedStream,
  type OutputMode,
} from "@specstride/contracts/grammar/output-modes";
import { EVENTS_LEGACY_PER_START } from "@specstride/contracts/ids/logical-names-amendments";

import { WALL_CLOCK_IS_NOT_BLOCKED } from "../quota/blocked.ts";
import type { EventWriter } from "../quota/ports.ts";
import { wallClockStop, type WallClockStopOutcome } from "./cap-stop.ts";
import type { CeilingReading } from "./ceilings.ts";
import {
  evaluateWallClock,
  type WallClockEvaluation,
  type WallClockLimit,
  type WallClockReading,
} from "./wall-clock.ts";

/* ------------------------------------------------------------------ *
 * 1. Where the budget is tested: the phase-boundary steps, after the
 *    stop request (F127-FR-027).
 * ------------------------------------------------------------------ */

/**
 * The phase-boundary steps of a phase attempt. They are exactly the boundaries
 * at which the engine reads the stop request (F101-FR-040: "before a phase
 * starts, before a phase attempt starts, before the verification gate, before
 * a critic-class call, before the approval record is written and before the
 * steps after an approval"), because F127-FR-027 puts the budget's test AFTER
 * that read at each of them.
 */
export const PHASE_BOUNDARY_STEPS = [
  "before-a-phase",
  "before-a-phase-attempt",
  "before-the-verification-gate",
  "before-a-critic-class-call",
  "before-the-approval-record",
  "after-an-approval",
] as const;
export type PhaseBoundaryStep = (typeof PHASE_BOUNDARY_STEPS)[number];

/**
 * The step at which the baseline's own test lives and at which exit 4 is taken
 * (B-0127, the baseline engine script, line 1776): the top of a phase attempt.
 */
export const STEP_OF_THE_BASELINE: PhaseBoundaryStep = "before-a-phase-attempt";

/**
 * The order at one boundary (F127-FR-027: "after the stop request is tested";
 * F100-FR-147: the lease is verified at every boundary that reads the stop
 * request). The budget is tested LAST, so that a stop request already in the
 * inbox wins and ends the run with `stop_flag` rather than `wall_budget`.
 */
export const CHECK_ORDER = ["stop-request", "lease", "wall-clock-budget"] as const;
export type BoundaryCheck = (typeof CHECK_ORDER)[number];

/** The index of the budget's own check in the order. It is never 0. */
export const WALL_CLOCK_CHECK_INDEX = CHECK_ORDER.indexOf("wall-clock-budget");

/** A step outside the six is refused rather than read as another one. */
export class PhaseBoundaryStepError extends Error {
  constructor(step: string) {
    super(
      `the phase-boundary step ${JSON.stringify(step)} is not one of the six of F127-FR-027 ` +
        `(${PHASE_BOUNDARY_STEPS.join(", ")}); the wall-clock budget is tested at each of ` +
        `them after the stop request and nowhere else in a phase attempt`,
    );
    this.name = "PhaseBoundaryStepError";
  }
}

/** Read a step; one outside the six throws. */
export function readPhaseBoundaryStep(step: string): PhaseBoundaryStep {
  if (!(PHASE_BOUNDARY_STEPS as readonly string[]).includes(step)) {
    throw new PhaseBoundaryStepError(step);
  }
  return step as PhaseBoundaryStep;
}

/** True where the stop request was tested before the budget at this boundary. */
export function stopRequestCameFirst(order: readonly string[]): boolean {
  const stop = order.indexOf("stop-request");
  const wall = order.indexOf("wall-clock-budget");
  return stop !== -1 && wall !== -1 && stop < wall;
}

/* ------------------------------------------------------------------ *
 * 2. The as-is line (B-0210), byte for byte.
 * ------------------------------------------------------------------ */

/**
 * The line of the baseline, with its placeholder, as B-0210 records it
 * (the baseline engine script, line 1774). The dash is an EM DASH (U+2014), as at the
 * baseline, and there is no space between the number and `min`.
 */
export const WALL_BUDGET_LINE_TEMPLATE =
  ">>> wall-clock budget (<m>min) exceeded — halting (exit 4)." as const;

/** The pattern that recognises the line and yields the minutes. */
export const WALL_BUDGET_LINE_PATTERN =
  /^>>> wall-clock budget \((\d+)min\) exceeded — halting \(exit 4\)\.$/;

/** The line for a limit of `m` whole minutes (B-0210). */
export function wallBudgetLine(minutes: number): string {
  return WALL_BUDGET_LINE_TEMPLATE.replace("<m>", String(minutes));
}

/** The minutes a line carries, or null where the line is not this one. */
export function minutesOfLine(line: string): number | null {
  const match = WALL_BUDGET_LINE_PATTERN.exec(line);
  if (match === null) return null;
  return Number(match[1]);
}

/**
 * B-0261 (the baseline engine script, line 710) — the baseline's `log()` tees to stdout and
 * `run.log`. The line is therefore an stdout line and never an stderr line.
 */
export const WALL_BUDGET_LINE_STREAM: ComparedStream = "stdout";

/** The line is an engine line of the baseline: it HAS an as-is equivalent. */
export const WALL_BUDGET_LINE_HAS_AN_AS_IS_EQUIVALENT = true as const;

/**
 * F127-FR-027 — "printed in both output modes as the engine lines of the
 * baseline are". The predicate of annex G §G.2 (F100-FR-176) allows a line
 * with an as-is equivalent on a compared stream under every profile, so the
 * answer is `true` for `default` and for `compat`, and under `parity` too.
 */
export function linePrintedIn(mode: OutputMode, profile?: string): boolean {
  void mode;
  const verdict = mayBeWritten(
    {
      stream: WALL_BUDGET_LINE_STREAM,
      hasAnAsIsEquivalent: WALL_BUDGET_LINE_HAS_AN_AS_IS_EQUIVALENT,
      featureIsOn: true,
    },
    profile,
  );
  return verdict.allowed;
}

/** The two modes the line is printed in, measured through the predicate. */
export function modesTheLineIsPrintedIn(profile?: string): readonly OutputMode[] {
  return Object.freeze(OUTPUT_MODES.filter((mode) => linePrintedIn(mode, profile)));
}

/* ------------------------------------------------------------------ *
 * 3. `run_stop` with the reason `wall_budget` and the field `phase`
 *    (B-0143).
 * ------------------------------------------------------------------ */

/** The event name of the compatibility projection the baseline writes. */
export const RUN_STOP_EVENT = "run_stop" as const;

/** The stop reason of a tripped budget, a member of annex E §E.3. */
export const WALL_BUDGET_REASON = "wall_budget" as const;

/** Where the projection line lands; feature 144 owns the writer. */
export const RUN_STOP_LOGICAL_NAME = EVENTS_LEGACY_PER_START;

/** The `run_stop` line of a tripped budget (B-0143). */
export type RunStopRecord = {
  readonly event: typeof RUN_STOP_EVENT;
  readonly reason: typeof WALL_BUDGET_REASON;
  /** The field B-0143 names beside the reason. */
  readonly phase: string;
};

/**
 * B-0143 (the baseline engine script, line 1775) — `run_stop reason=wall_budget` with the
 * field `phase`. The phase is carried as the engine has it, as a string.
 */
export function runStopRecord(phase: string | number): RunStopRecord {
  return Object.freeze({
    event: RUN_STOP_EVENT,
    reason: WALL_BUDGET_REASON,
    phase: String(phase),
  });
}

/* ------------------------------------------------------------------ *
 * 4. Exit 4 and the terminal record (B-0127; F127-FR-027, CQ-192).
 * ------------------------------------------------------------------ */

/** The engine exit code of a tripped budget (B-0127). */
export const WALL_BUDGET_EXIT = 4 as const;

/** The terminal record values of a tripped budget (F127-FR-027, CQ-192). */
export type WallBudgetTerminal = {
  readonly stopReason: typeof WALL_BUDGET_REASON;
  readonly exitCode: typeof WALL_BUDGET_EXIT;
  /** `retryable: true` — the tables MAY relaunch it (F127-FR-027). */
  readonly retryable: true;
  /** No blocked reason (F127-FR-027). */
  readonly blockedReason: null;
  /** No `blocked` event is emitted (F127-FR-027). */
  readonly emitsBlocked: false;
  /** The run does not rest in `blocked-on-human` (F127-FR-027). */
  readonly restsIn: null;
};

/**
 * The terminal record of a tripped budget. The two values F127-FR-027 names —
 * `retryable: true` and no blocked reason — are not restated here: they are
 * read from feature 100's own rule (`retryableFor` of annex E §E.3) and from
 * `WALL_CLOCK_IS_NOT_BLOCKED` of `../quota/blocked.ts`, so that this module
 * and feature 100 cannot drift apart.
 */
export function wallBudgetTerminal(): WallBudgetTerminal {
  const retryable = retryableFor(WALL_BUDGET_REASON);
  if (retryable !== true) {
    throw new Error(
      `annex E §E.3 must make \`${WALL_BUDGET_REASON}\` retryable where no blocked reason is ` +
        `carried (F127-FR-027, CQ-192); \`retryableFor\` answered ${String(retryable)}`,
    );
  }
  if (WALL_CLOCK_IS_NOT_BLOCKED.blockedReason !== null) {
    throw new Error(`a tripped wall-clock budget carries NO blocked reason (F127-FR-027, CQ-192)`);
  }
  return Object.freeze({
    stopReason: WALL_BUDGET_REASON,
    exitCode: WALL_BUDGET_EXIT,
    retryable: true as const,
    blockedReason: null,
    emitsBlocked: false as const,
    restsIn: null,
  });
}

/* ------------------------------------------------------------------ *
 * 5. One boundary, and the halt.
 * ------------------------------------------------------------------ */

/** What the engine knows at one phase-boundary step. */
export type BoundaryInput = {
  readonly step: PhaseBoundaryStep | string;
  /** The phase the attempt belongs to; `run_stop` carries it (B-0143). */
  readonly phase: string | number;
  readonly limit: WallClockLimit;
  readonly reading: WallClockReading;
  /** True where a stop request was found at this boundary and honoured. */
  readonly stopRequestFound?: boolean | undefined;
};

/** What one boundary check answers. */
export type BoundaryOutcome = {
  readonly step: PhaseBoundaryStep;
  /** The order the checks were made in; the budget is never first. */
  readonly order: readonly BoundaryCheck[];
  /** True where the stop request was tested before the budget. */
  readonly stopRequestTestedFirst: boolean;
  /** Null where the stop request won the boundary and the budget was not read. */
  readonly evaluation: WallClockEvaluation | null;
  /** True only where the budget tripped AND no stop request won first. */
  readonly trips: boolean;
  /** The halt, where it tripped; else null. */
  readonly halt: WallBudgetHalt | null;
};

/**
 * One phase-boundary step (F127-FR-027). The stop request is tested first: a
 * boundary at which one was found yields `trips: false` and no halt, whatever
 * the clock says, because the run is already `stopping`.
 */
export function checkAtBoundary(input: BoundaryInput, writer?: EventWriter): BoundaryOutcome {
  const step = readPhaseBoundaryStep(String(input.step));
  const order = CHECK_ORDER;
  if (input.stopRequestFound === true) {
    return Object.freeze({
      step,
      order,
      stopRequestTestedFirst: true,
      evaluation: null,
      trips: false,
      halt: null,
    });
  }
  const evaluation = evaluateWallClock({ limit: input.limit, reading: input.reading });
  return Object.freeze({
    step,
    order,
    stopRequestTestedFirst: true,
    evaluation,
    trips: evaluation.trips,
    halt: evaluation.trips
      ? haltOnWallBudget({ step, phase: input.phase, evaluation }, writer)
      : null,
  });
}

/** Every one of the six steps, for a caller that walks a whole attempt. */
export function checkEveryStep(
  input: Omit<BoundaryInput, "step">,
  writer?: EventWriter,
): readonly BoundaryOutcome[] {
  return Object.freeze(
    PHASE_BOUNDARY_STEPS.map((step) => checkAtBoundary({ ...input, step }, writer)),
  );
}

/** Everything the engine does when the budget trips (F127-FR-027). */
export type WallBudgetHalt = {
  readonly step: PhaseBoundaryStep;
  /** The as-is line, byte for byte (B-0210). */
  readonly line: string;
  /** The stream the line is written to (B-0261): stdout, never stderr. */
  readonly stream: ComparedStream;
  /** The modes the line is printed in (F127-FR-027): both. */
  readonly modes: readonly OutputMode[];
  /** `run_stop reason=wall_budget` with the field `phase` (B-0143). */
  readonly runStop: RunStopRecord;
  /** Exit 4 (B-0127). */
  readonly exitCode: typeof WALL_BUDGET_EXIT;
  /** `retryable: true`, no blocked reason (F127-FR-027, CQ-192). */
  readonly terminal: WallBudgetTerminal;
  /** The exempt stop of `./cap-stop.ts`: never the hard-cap path. */
  readonly stop: WallClockStopOutcome;
  /** The whole minutes the line names. */
  readonly minutes: number;
};

/**
 * The exit-4 path of F127-FR-027: the as-is line, `run_stop` with the reason
 * `wall_budget` and the field `phase`, exit 4, and a terminal record that
 * carries `retryable: true` and no blocked reason.
 *
 * No `blocked` event is emitted and the run does not rest in
 * `blocked-on-human`: `wallClockStop` of `./cap-stop.ts` is the one stop this
 * path takes, and it answers `emitsBlocked: false` and `restsIn: null`.
 */
export function haltOnWallBudget(
  input: {
    readonly step: PhaseBoundaryStep;
    readonly phase: string | number;
    readonly evaluation: WallClockEvaluation;
    readonly reading?: CeilingReading | undefined;
  },
  writer?: EventWriter,
): WallBudgetHalt {
  const minutes = input.evaluation.limit.minutes;
  const stop = wallClockStop(writer, input.reading);
  if (stop.emitsBlocked || stop.blockedReason !== null || stop.restsIn !== null) {
    throw new Error(
      `a tripped wall-clock budget emits no \`blocked\` event and rests in no state ` +
        `(F127-FR-027, CQ-192)`,
    );
  }
  return Object.freeze({
    step: input.step,
    line: wallBudgetLine(minutes),
    stream: WALL_BUDGET_LINE_STREAM,
    modes: modesTheLineIsPrintedIn(),
    runStop: runStopRecord(input.phase),
    exitCode: WALL_BUDGET_EXIT,
    terminal: wallBudgetTerminal(),
    stop,
    minutes,
  });
}
