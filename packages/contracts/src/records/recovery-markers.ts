/**
 * T002 of feature 101 — the type and the validator of the recovery markers
 * (`specs/101-gate-and-verdict/data-model.md`, "Recovery markers").
 *
 * Schema id `specstride.recovery-markers/1`, logical name
 * `phase:<N>:recovery-markers`. The type is generated from
 * `schemas/recovery-markers.schema.json` (the `build` script of the package);
 * this module gives the validator over it and the two marker names.
 */
import type { RecoveryMarkers } from "./generated/recovery-markers.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { RecoveryMarkers };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.recovery-markers/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "phase:<N>:recovery-markers" as const;

/** The table that owns the field list. */
export const ANNEX_SECTION = 'feature 101, data-model.md, "Recovery markers"' as const;

/** The two markers of the cycle, in the order of the table. */
export const MARKERS = ["diagnosed", "accelerated"] as const;
export type Marker = (typeof MARKERS)[number];

/** The record is removed at the approval of the phase. */
export const REMOVED_AT_APPROVAL = true as const;

/** Read the record through its logical name (F100-FR-048, F100-FR-049). */
export function readRecoveryMarkers(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): RecoveryMarkers {
  return readRecord<RecoveryMarkers>(logicalName, value);
}

/** `readRecoveryMarkers` that returns a result instead of throwing. */
export function tryReadRecoveryMarkers(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: RecoveryMarkers } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<RecoveryMarkers>(logicalName, value);
}

/** True when the value validates against `specstride.recovery-markers/1`. */
export function isRecoveryMarkers(value: unknown): value is RecoveryMarkers {
  return validate<RecoveryMarkers>(SCHEMA_ID, value).ok;
}

/** The signature a marker holds, or `undefined` where the marker is not set. */
export function signatureOf(record: RecoveryMarkers, marker: Marker): string | undefined {
  const value = record[marker];
  return typeof value === "string" ? value : undefined;
}
