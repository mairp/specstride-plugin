/**
 * T066 of feature 101 — the oscillation halt, with the window keyed by the
 * SEQUENCE OF PHASE ATTEMPTS (F101-FR-016).
 *
 * After a rejection the engine looks for a criterion that keeps coming back.
 * The rules of the requirement, in the order it gives them:
 *
 * | Rule | Here |
 * |---|---|
 * | a criterion is a task id in the as-is form found in feedback | `criteriaOfTheRecords`, through the one grammar owner |
 * | feedback without such an id can never trip the halt | a record with no criterion contributes nothing |
 * | the check is skipped unless at least four feedback records exist for the phase, the archived ones and the live one together | `MINIMUM_FEEDBACK_RECORDS`, `theCheckRuns` |
 * | over the records of the window, in order, a criterion oscillates when it is present, absent and present again MORE OFTEN than the threshold | `reappearancesOf`, `OSCILLATION_THRESHOLD_DEFAULT` |
 * | the window is keyed by the sequence of phase attempts of the phase since the counts were last reset | `oscillationWindow`, `WINDOW_KEY` |
 * | on an oscillation: archive first, emit the as-is event, record the stop reason, exit 2 | `oscillationHalt`, `ORDER_ON_AN_OSCILLATION` |
 *
 * ## Why this module holds no task-line grammar
 *
 * F104-SC-001 keeps the grammar of a specification in ONE package, and a core
 * package may not import that package. So the criteria of a feedback are not
 * DISCOVERED here: `./feedback.ts` recognises the ids the grammar owner already
 * parsed, and this module calls it. The form of a task id therefore stands in
 * exactly one place in the product, and the window here is a question about
 * sets of ids and nothing else.
 */
import { taskIdsOf, type TaskIdSource } from "./feedback.ts";

/** F101-FR-016 — the default of the threshold of oscillation (B-0074). */
export const OSCILLATION_THRESHOLD_DEFAULT = 2 as const;

/** F101-FR-016 — the threshold comes from configuration (B-0074). */
export const THRESHOLD_COMES_FROM_CONFIGURATION = true as const;

/**
 * F101-FR-016 — the check is skipped unless at least this many feedback
 * records exist for the phase, the archived ones and the live one together.
 */
export const MINIMUM_FEEDBACK_RECORDS = 4 as const;

/**
 * F101-FR-016 — what the window is keyed by, so that it continues across a
 * resume and a relaunch: the sequence of phase attempts of the phase since the
 * counts were last reset, and never the files that happen to lie in a
 * directory.
 */
export const WINDOW_KEY =
  "the sequence of phase attempts of the phase since the counts were last reset" as const;

/** F101-FR-016 — the halt of an oscillation (the table of halts). */
export const OSCILLATION_EXIT_CODE = 2 as const;
export const OSCILLATION_STOP_REASON = "gate_oscillation" as const;

/** F101-FR-016 — the phase attempt is archived BEFORE the halt. */
export const ARCHIVED_BEFORE_THE_HALT = true as const;

/** F101-FR-016 — the order of the steps on an oscillation. */
export const ORDER_ON_AN_OSCILLATION = [
  "archive the phase attempt",
  "emit the as-is event with the criterion and the number of reappearances",
  "record the stop reason with the phase and the count of phase attempts",
  "exit 2",
] as const;

/** The as-is name of the event and its fields (B-0107). */
export const AS_IS_EVENT_OF_AN_OSCILLATION = "gate_oscillation" as const;
export const AS_IS_EVENT_FIELDS_OF_AN_OSCILLATION = [
  "phase",
  "attempt",
  "criterion",
  "reappears",
] as const;

/* ------------------------------------------------------------------ *
 * The window.
 * ------------------------------------------------------------------ */

/**
 * One feedback record of the phase, as the window reads it: the ordinal of the
 * phase attempt it belongs to, and its text. Where the record was archived the
 * text is the archived one; the live feedback of the phase attempt that was
 * just rejected is the last member.
 */
export type FeedbackRecordOfThePhase = {
  /** The ordinal of the phase attempt of the record. */
  readonly ordinal: number;
  /** The text of the feedback, as it was written. */
  readonly text: string;
  /** True for the record of the phase attempt that was just rejected. */
  readonly live?: boolean | undefined;
};

/**
 * F101-FR-016 — the window: the feedback records of the phase in the order of
 * the SEQUENCE OF PHASE ATTEMPTS since the counts were last reset.
 *
 * `sinceTheCountsWereReset` is the ordinal of the first phase attempt of the
 * sequence; a record of an earlier sequence is outside the window. The order is
 * the order of the ordinals and never the order in which the records were
 * found, so a window read from a tree after a relaunch is the same window.
 */
export function oscillationWindow(
  records: readonly FeedbackRecordOfThePhase[],
  sinceTheCountsWereReset = 1,
): readonly FeedbackRecordOfThePhase[] {
  return Object.freeze(
    [...records]
      .filter((record) => record.ordinal >= sinceTheCountsWereReset)
      .sort((a, b) => a.ordinal - b.ordinal),
  );
}

/**
 * F101-FR-016 — the check is skipped unless at least four feedback records
 * exist for the phase, the archived ones and the live one together.
 */
export function theCheckRuns(window: readonly FeedbackRecordOfThePhase[]): boolean {
  return window.length >= MINIMUM_FEEDBACK_RECORDS;
}

/**
 * The criteria of each record of the window, in the order of the window. A
 * criterion is a task id in the as-is form; the ids come from the one grammar
 * owner through `./feedback.ts`, so this module names no form of its own.
 */
export function criteriaOfTheRecords(
  window: readonly FeedbackRecordOfThePhase[],
  source: TaskIdSource = {},
): readonly (readonly string[])[] {
  return Object.freeze(window.map((record) => taskIdsOf(record.text, source)));
}

/* ------------------------------------------------------------------ *
 * The count of reappearances.
 * ------------------------------------------------------------------ */

/**
 * F101-FR-016 — how often a criterion is present, absent and present AGAIN
 * over the records of the window, in order.
 *
 * A reappearance is a record in which the criterion stands after a record in
 * which it did not, and only once it has stood before: the first appearance is
 * no reappearance. `T1` present, absent, present counts ONE reappearance; a
 * criterion that stands in every record counts none, however long the window.
 */
export function reappearancesOf(
  criterion: string,
  criteriaPerRecord: readonly (readonly string[])[],
): number {
  let seen = false;
  let absentSince = false;
  let reappears = 0;
  for (const criteria of criteriaPerRecord) {
    const present = criteria.includes(criterion);
    if (present) {
      if (seen && absentSince) reappears += 1;
      seen = true;
      absentSince = false;
    } else if (seen) {
      absentSince = true;
    }
  }
  return reappears;
}

/** Every criterion that stands in any record of the window, sorted. */
export function criteriaOfTheWindow(
  criteriaPerRecord: readonly (readonly string[])[],
): readonly string[] {
  return Object.freeze([...new Set(criteriaPerRecord.flat())].sort());
}

/** One oscillating criterion, with how often it came back. */
export type OscillatingCriterion = {
  readonly criterion: string;
  readonly reappears: number;
};

/**
 * F101-FR-016 — the criteria of the window that oscillate: those that came
 * back MORE OFTEN than the threshold. Equal to the threshold is not an
 * oscillation; the requirement says "more often than".
 *
 * Several criteria may oscillate at once; they are returned sorted by the
 * criterion, so the one the halt names is a function of the window and not of
 * the order in which a map happened to be walked.
 */
export function oscillatingCriteria(
  criteriaPerRecord: readonly (readonly string[])[],
  threshold: number = OSCILLATION_THRESHOLD_DEFAULT,
): readonly OscillatingCriterion[] {
  const out: OscillatingCriterion[] = [];
  for (const criterion of criteriaOfTheWindow(criteriaPerRecord)) {
    const reappears = reappearancesOf(criterion, criteriaPerRecord);
    if (reappears > threshold) out.push({ criterion, reappears });
  }
  return Object.freeze(out.map((entry) => Object.freeze(entry)));
}

/* ------------------------------------------------------------------ *
 * The halt.
 * ------------------------------------------------------------------ */

/** The as-is event of an oscillation, as the emitter receives it (B-0107). */
export type GateOscillationEvent = {
  readonly phase: number;
  readonly attempt: number;
  readonly criterion: string;
  readonly reappears: number;
};

/** What the check of the oscillation halt is handed. */
export type OscillationInputs = {
  readonly phase: number;
  /** The ordinal of the phase attempt that was just rejected. */
  readonly ordinal: number;
  /** Every feedback record of the phase: the archived ones and the live one. */
  readonly records: readonly FeedbackRecordOfThePhase[];
  /** The ordinal of the first phase attempt of the sequence (the window key). */
  readonly sinceTheCountsWereReset?: number | undefined;
  /** The threshold, from configuration; 2 by default (B-0074). */
  readonly threshold?: number | undefined;
  /** The ids of the one grammar owner, as `./feedback.ts` needs them. */
  readonly taskIds?: TaskIdSource | undefined;
};

/** What the check reports back. */
export type OscillationOutcome =
  | {
      readonly halts: false;
      /** Why it does not halt: the check was skipped, or nothing oscillates. */
      readonly because: "too-few-feedback-records" | "nothing-oscillates";
      readonly window: readonly FeedbackRecordOfThePhase[];
      readonly criteriaPerRecord: readonly (readonly string[])[];
    }
  | {
      readonly halts: true;
      /** The criterion the halt names, and how often it came back. */
      readonly criterion: string;
      readonly reappears: number;
      /** Every criterion that oscillates, where more than one does. */
      readonly oscillating: readonly OscillatingCriterion[];
      readonly exitCode: typeof OSCILLATION_EXIT_CODE;
      readonly stopReason: typeof OSCILLATION_STOP_REASON;
      /** The as-is event of the halt (B-0107). */
      readonly event: GateOscillationEvent;
      /** F101-FR-016 — the phase attempt is archived BEFORE the halt. */
      readonly archiveFirst: true;
      readonly window: readonly FeedbackRecordOfThePhase[];
      readonly criteriaPerRecord: readonly (readonly string[])[];
    };

/**
 * F101-FR-016 — look for an oscillating criterion after a rejection.
 *
 * The check is skipped where fewer than four feedback records exist for the
 * phase, and a window whose records hold no task id can never trip it: with no
 * criterion there is nothing that could be present, absent and present again.
 */
export function checkForOscillation(inputs: OscillationInputs): OscillationOutcome {
  const window = oscillationWindow(inputs.records, inputs.sinceTheCountsWereReset ?? 1);
  const criteriaPerRecord = criteriaOfTheRecords(window, inputs.taskIds ?? {});
  if (!theCheckRuns(window)) {
    return Object.freeze({
      halts: false as const,
      because: "too-few-feedback-records" as const,
      window,
      criteriaPerRecord,
    });
  }
  const oscillating = oscillatingCriteria(
    criteriaPerRecord,
    inputs.threshold ?? OSCILLATION_THRESHOLD_DEFAULT,
  );
  const first = oscillating[0];
  if (first === undefined) {
    return Object.freeze({
      halts: false as const,
      because: "nothing-oscillates" as const,
      window,
      criteriaPerRecord,
    });
  }
  return Object.freeze({
    halts: true as const,
    criterion: first.criterion,
    reappears: first.reappears,
    oscillating,
    exitCode: OSCILLATION_EXIT_CODE,
    stopReason: OSCILLATION_STOP_REASON,
    event: Object.freeze({
      phase: inputs.phase,
      attempt: inputs.ordinal,
      criterion: first.criterion,
      reappears: first.reappears,
    }),
    archiveFirst: true as const,
    window,
    criteriaPerRecord,
  });
}
