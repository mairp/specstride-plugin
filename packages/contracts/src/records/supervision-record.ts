/**
 * T056 — the type and the validator of supervision record (annex B, §B.16).
 *
 * Schema id `specstride.supervision/1`, logical name `launch:<launchId>:supervision`. The type is
 * generated from `schemas/supervision-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-072.
 */
import type { SupervisionRecord } from "./generated/supervision-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { SupervisionRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.supervision/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "launch:<launchId>:supervision" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.16" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.16 is required (F100-FR-048, F100-FR-049).
 */
export function readSupervisionRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): SupervisionRecord {
  return readRecord<SupervisionRecord>(logicalName, value);
}

/** `readSupervisionRecord` that returns a result instead of throwing. */
export function tryReadSupervisionRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: SupervisionRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<SupervisionRecord>(logicalName, value);
}

/** True when the value validates against `specstride.supervision/1`. */
export function isSupervisionRecord(value: unknown): value is SupervisionRecord {
  return validate<SupervisionRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-072 — the cadence state of supervision and, with
 * `relaunch.owner: supervise`, the relaunch budget and the list of
 * relaunches are kept in the supervision record, written by the CLI. It is
 * the only file of run-related state the CLI writes after launch, apart from
 * inbox requests (annex B, §B.2, SL-5).
 */
export const WRITER = "CLI" as const;
export const FIELDS_REQUIRED_WITH_SUPERVISE_OWNER = ["relaunchBudget", "relaunches"] as const;

export function requiresRelaunchFields(relaunchOwner: string): boolean {
  return relaunchOwner === "supervise";
}

export function holdsRelaunchFields(record: SupervisionRecord): boolean {
  return FIELDS_REQUIRED_WITH_SUPERVISE_OWNER.every(
    (f) => (record as unknown as Record<string, unknown>)[f] !== undefined,
  );
}
