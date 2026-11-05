/**
 * T042 — the type and the validator of owner record (annex B, §B.9).
 *
 * Schema id `specstride.lease/1:owner`, logical name `(part of the lease, the lock and the advisory marker)`. The type is
 * generated from `schemas/owner-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-062.
 */
import type { OwnerRecord } from "./generated/owner-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { OwnerRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.lease/1:owner" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "(part of the lease, the lock and the advisory marker)" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.9" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.9 is required (F100-FR-048, F100-FR-049).
 */
export function readOwnerRecord(value: unknown, logicalName: string = LOGICAL_NAME): OwnerRecord {
  return readRecord<OwnerRecord>(logicalName, value);
}

/** `readOwnerRecord` that returns a result instead of throwing. */
export function tryReadOwnerRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: OwnerRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<OwnerRecord>(logicalName, value);
}

/** True when the value validates against `specstride.lease/1:owner`. */
export function isOwnerRecord(value: unknown): value is OwnerRecord {
  return validate<OwnerRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-062 — the owner record is part of the lease, of the lock and of the
 * advisory marker. A lock never exists without an owner record.
 */
export const OWNER_RECORD_IS_PART_OF = ["lease", "lock", "advisory marker"] as const;

export function lockHasOwner(lock: { owner?: unknown }): boolean {
  return lock.owner !== undefined && lock.owner !== null;
}
