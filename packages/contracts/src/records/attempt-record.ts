/**
 * T002 of feature 101 — the type and the validator of the record of a phase
 * attempt (`specs/101-gate-and-verdict/data-model.md`, "Record of a phase
 * attempt").
 *
 * Schema id `specstride.attempt/1`, logical name `attempt:<N>:<k>:<n>:record`.
 * The type is generated from `schemas/attempt-record.schema.json` (the `build`
 * script of the package); this module gives the validator over it and the two
 * rules the table states beside the field list.
 */
import type { AttemptRecord } from "./generated/attempt-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";
import { kindsOfPhaseAttempt, outcomeOfTheRecordOfAPhaseAttempt } from "../enums/all-sets.ts";

export type { AttemptRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.attempt/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "attempt:<N>:<k>:<n>:record" as const;

/** The table that owns the field list. */
export const ANNEX_SECTION = 'feature 101, data-model.md, "Record of a phase attempt"' as const;

/** Read the record through its logical name (F100-FR-048, F100-FR-049). */
export function readAttemptRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): AttemptRecord {
  return readRecord<AttemptRecord>(logicalName, value);
}

/** `readAttemptRecord` that returns a result instead of throwing. */
export function tryReadAttemptRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: AttemptRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<AttemptRecord>(logicalName, value);
}

/** True when the value validates against `specstride.attempt/1`. */
export function isAttemptRecord(value: unknown): value is AttemptRecord {
  return validate<AttemptRecord>(SCHEMA_ID, value).ok;
}

/** Row 9 of annex X §X.6 — the kinds of phase attempt the field `kind` takes. */
export const kinds = kindsOfPhaseAttempt;

/** Row 278 of annex X §X.6 — the members the field `outcome` takes. */
export const outcomes = outcomeOfTheRecordOfAPhaseAttempt;

/**
 * The two members of `outcome` that have no verdict (`data-model.md`: "`outcome`
 * is a field of this record only; the verdict stays one of the three members of
 * the closed set of verdicts. `gate-failed` and `no-verdict` have no verdict").
 */
export const OUTCOMES_WITHOUT_A_VERDICT = ["gate-failed", "no-verdict"] as const;

/** True when the outcome has no verdict, so `verdictId` is absent. */
export function outcomeHasNoVerdict(outcome: string): boolean {
  return (OUTCOMES_WITHOUT_A_VERDICT as readonly string[]).includes(outcome);
}

/**
 * The record keeps the two rules of the table: an outcome without a verdict
 * carries no `verdictId`, and an archived phase attempt carries the label of
 * its archive.
 */
export function attemptRecordIsConsistent(record: AttemptRecord): boolean {
  if (outcomeHasNoVerdict(record.outcome) && record.verdictId !== undefined) return false;
  const archived = record.archived as { archived?: unknown; label?: unknown };
  if (archived.archived === true && typeof archived.label !== "string") return false;
  if (archived.archived === false && archived.label !== null) return false;
  return true;
}
