/**
 * T038 — the type and the validator of launch record (annex B, §B.7).
 *
 * Schema id `specstride.launch/1`, logical name `launch:<launchId>:record`. The type is
 * generated from `schemas/launch-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-060.
 */
import type { LaunchRecord } from "./generated/launch-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { LaunchRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.launch/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "launch:<launchId>:record" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.7" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.7 is required (F100-FR-048, F100-FR-049).
 */
export function readLaunchRecord(value: unknown, logicalName: string = LOGICAL_NAME): LaunchRecord {
  return readRecord<LaunchRecord>(logicalName, value);
}

/** `readLaunchRecord` that returns a result instead of throwing. */
export function tryReadLaunchRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: LaunchRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<LaunchRecord>(logicalName, value);
}

/** True when the value validates against `specstride.launch/1`. */
export function isLaunchRecord(value: unknown): value is LaunchRecord {
  return validate<LaunchRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-060 — the launch record is written before the detach strategy is
 * called. A launch record older than the handshake limit that has no
 * `outcome` and no lease with its nonce is derived by readers as
 * `launch-abandoned`, shown as an attention item, and closed by the next
 * launch (annex X §X.6 row 2: a derived run condition).
 */
export const DERIVED_CONDITION_ABANDONED = "launch-abandoned" as const;

export function isAbandoned(
  record: LaunchRecord,
  now: Date,
  handshakeLimitSeconds: number,
  leaseWithNonceExists: boolean,
): boolean {
  if (record.outcome !== undefined && record.outcome !== null) return false;
  if (leaseWithNonceExists) return false;
  const created = Date.parse(String(record.createdAt));
  if (Number.isNaN(created)) return false;
  return now.getTime() - created > handshakeLimitSeconds * 1000;
}

/** The mode `dry-run` writes no launch record and no run state (§B.7). */
export const MODES_THAT_WRITE_A_LAUNCH_RECORD = ["run"] as const;
