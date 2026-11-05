/**
 * T002 of feature 101 — the type and the validator of the approval key
 * (`specs/101-gate-and-verdict/data-model.md`, "Approval key").
 *
 * Schema id `specstride.approval-key/1`, logical name
 * `feature:<slug>:approval-key`. The type is generated from
 * `schemas/approval-key.schema.json` (the `build` script of the package); this
 * module gives the validator over it and the rule of F100-FR-052: the key
 * material is never in an event, a log, an export without signature, or an
 * environment.
 */
import type { ApprovalKey } from "./generated/approval-key.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { ApprovalKey };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.approval-key/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "feature:<slug>:approval-key" as const;

/** The table that owns the field list. */
export const ANNEX_SECTION = 'feature 101, data-model.md, "Approval key"' as const;

/** The one field that carries key material; the others are identity. */
export const FIELD_WITH_THE_KEY_MATERIAL = "key" as const;

/** The three fields that may leave the control plane: identity only. */
export const FIELDS_THAT_MAY_BE_SHOWN = ["keyId", "createdAt", "feature"] as const;

/** Read the record through its logical name (F100-FR-048, F100-FR-049). */
export function readApprovalKey(value: unknown, logicalName: string = LOGICAL_NAME): ApprovalKey {
  return readRecord<ApprovalKey>(logicalName, value);
}

/** `readApprovalKey` that returns a result instead of throwing. */
export function tryReadApprovalKey(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: ApprovalKey } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<ApprovalKey>(logicalName, value);
}

/** True when the value validates against `specstride.approval-key/1`. */
export function isApprovalKey(value: unknown): value is ApprovalKey {
  return validate<ApprovalKey>(SCHEMA_ID, value).ok;
}

/**
 * The record without its key material, for anything that leaves the control
 * plane: an event, a log, an export without signature (F100-FR-052).
 */
export function withoutTheKeyMaterial(record: ApprovalKey): Omit<ApprovalKey, "key"> {
  const { key: _key, ...rest } = record;
  return rest;
}
