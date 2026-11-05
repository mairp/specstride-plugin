/**
 * T054 — the batch fields of the check events (F148-FR-017).
 *
 * F148-FR-017 is two claims:
 *
 *  1. `check.started` and `check.ended` of a command that ran IN A BATCH
 *     carry the batch (`batch`), the slot (`slot`), the duration
 *     (`durationMs`) and the result (`result`). The two `data` builders of
 *     `check-events.ts` already name the four; this module is where the
 *     values come from, so that the batch fields of an event and the batch
 *     fields of the result can never disagree: `withBatchFields` puts them on
 *     the RESULT, and `checkEndedData` reads them from there.
 *  2. A duration measured in a batch of MORE THAN ONE COMMAND is flagged
 *     `concurrent` (the field `concurrent` of `check.ended`) and is never
 *     used for the exclusion `slow` or as a learned duration.
 *     `mayBeExcludedAsSlow` and `mayBeUsedAsALearnedDuration` are that rule,
 *     and they are the only readers a caller needs: a duration that is
 *     flagged says no to both.
 *
 * A command that ran alone carries `batch: null`, `slot: null` and
 * `concurrent: false`, which is what `emptyResult` and `resultOf` already
 * give it; a batch of ONE is not concurrent, because nothing ran beside it.
 */
import type { RunnerResult } from "../result/result.ts";
import { CHECK_ENDED, CHECK_STARTED } from "./check-events.ts";

/** F148-FR-017 — the three fields a batch adds to a check event. */
export const BATCH_FIELDS = Object.freeze(["batch", "slot", "concurrent"] as const);
export type BatchField = (typeof BATCH_FIELDS)[number];

/** The two of the three that `check.started` carries (feature 100, annex X §X.1). */
export const BATCH_FIELDS_OF_CHECK_STARTED = Object.freeze(["batch", "slot"] as const);

/** The three that `check.ended` carries. */
export const BATCH_FIELDS_OF_CHECK_ENDED = Object.freeze(["batch", "slot", "concurrent"] as const);

/** The event types that carry the batch fields. */
export const EVENTS_WITH_BATCH_FIELDS = Object.freeze([CHECK_STARTED, CHECK_ENDED] as const);

/** The batch a command ran in, as the three fields spell it. */
export type BatchFields = {
  readonly batch: number | null;
  readonly slot: number | null;
  readonly concurrent: boolean;
};

/** F148-FR-017 — the fields of a command that ran ALONE, outside any batch. */
export const NO_BATCH: BatchFields = Object.freeze({
  batch: null,
  slot: null,
  concurrent: false,
});

/**
 * F148-FR-017 — true where a duration measured in this batch is `concurrent`:
 * the batch held MORE THAN ONE command. A batch of one measured a duration
 * nothing ran beside.
 */
export function concurrentInABatchOf(members: number): boolean {
  return members > 1;
}

/**
 * F148-FR-017 — put the batch, the slot and the flag on a result. The exit
 * result is copied across untouched; only the three fields are set.
 */
export function withBatchFields(result: RunnerResult, fields: BatchFields): RunnerResult {
  return Object.freeze({
    ...result,
    batch: fields.batch,
    slot: fields.slot,
    concurrent: fields.concurrent,
  }) as RunnerResult;
}

/** The three fields of a result, read back. */
export function batchFieldsOf(result: RunnerResult): BatchFields {
  return Object.freeze({
    batch: result.batch,
    slot: result.slot,
    concurrent: result.concurrent,
  });
}

/** The three fields of the `data` of an event, read back. */
export function batchFieldsOfAnEvent(data: Readonly<Record<string, unknown>>): BatchFields {
  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) ? value : null;
  return Object.freeze({
    batch: number(data["batch"]),
    slot: number(data["slot"]),
    concurrent: data["concurrent"] === true,
  });
}

/* ------------------------------------------------------------------ *
 * What a concurrent duration may never be used for.
 * ------------------------------------------------------------------ */

/** F148-FR-017 — the two uses a concurrent duration is kept out of. */
export const USES_A_CONCURRENT_DURATION_IS_KEPT_OUT_OF: readonly string[] = Object.freeze([
  "the exclusion `slow`",
  "a learned duration",
]);

/**
 * F148-FR-017 — a duration measured in a batch of more than one command MUST
 * never be used for the exclusion `slow`.
 */
export function mayBeExcludedAsSlow(result: RunnerResult): boolean {
  return !result.concurrent;
}

/**
 * F148-FR-017 — a duration measured in a batch of more than one command MUST
 * never be used as a learned duration.
 */
export function mayBeUsedAsALearnedDuration(result: RunnerResult): boolean {
  return !result.concurrent;
}

/** The duration a learner may take from a result, or null where it may take none. */
export function learnableDurationOf(result: RunnerResult): number | null {
  return mayBeUsedAsALearnedDuration(result) ? result.durationMs : null;
}

/**
 * F148-FR-017 — the findings of a reader that used a concurrent duration
 * where it may not. An empty list is the whole of the second claim, read
 * back from the values a caller actually used.
 */
export function concurrentDurationFindings(input: {
  readonly result: RunnerResult;
  readonly excludedAsSlow?: boolean;
  readonly learnedDuration?: number | null;
}): readonly string[] {
  const findings: string[] = [];
  if (input.excludedAsSlow === true && !mayBeExcludedAsSlow(input.result)) {
    findings.push(
      `\`${input.result.commandId}\` ran beside another command, so its duration is ` +
        "`concurrent` and is never used for the exclusion `slow` (F148-FR-017)",
    );
  }
  if (
    input.learnedDuration !== undefined &&
    input.learnedDuration !== null &&
    !mayBeUsedAsALearnedDuration(input.result)
  ) {
    findings.push(
      `\`${input.result.commandId}\` ran beside another command, so its duration is ` +
        "`concurrent` and is never used as a learned duration (F148-FR-017)",
    );
  }
  return Object.freeze(findings);
}
