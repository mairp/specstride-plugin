/**
 * T052 — the type and the validator of approval record (annex B, §B.14).
 *
 * Schema id `specstride.approval/1`, logical name `gate:<N>:approved`. The type is
 * generated from `schemas/approval-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-070.
 */
import type { ApprovalRecord } from "./generated/approval-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { ApprovalRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.approval/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "gate:<N>:approved" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.14" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.14 is required (F100-FR-048, F100-FR-049).
 */
export function readApprovalRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): ApprovalRecord {
  return readRecord<ApprovalRecord>(logicalName, value);
}

/** `readApprovalRecord` that returns a result instead of throwing. */
export function tryReadApprovalRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: ApprovalRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<ApprovalRecord>(logicalName, value);
}

/** True when the value validates against `specstride.approval/1`. */
export function isApprovalRecord(value: unknown): value is ApprovalRecord {
  return validate<ApprovalRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-070 — the runtime accepts an approval only from a record it wrote
 * itself, signed with the approval key of the feature and bound to the
 * verdict, the hash of the phase evidence, the result of the verification
 * gate and the tree fingerprint.
 */
export const BINDINGS = ["verdictId", "evidenceHash", "verification", "treeFingerprint"] as const;
export type Binding = (typeof BINDINGS)[number];

export type ApprovalBindings = {
  readonly verdictId: string;
  readonly evidenceHash: string;
  readonly verificationHash: string;
  readonly treeFingerprint: string;
};

/** Every binding must match; a record that fails counts as not approved. */
export function bindingsMatch(record: ApprovalRecord, expected: ApprovalBindings): boolean {
  const verification = record.verification as { hash?: unknown } | undefined;
  return (
    String(record.verdictId) === expected.verdictId &&
    String(record.evidenceHash) === expected.evidenceHash &&
    String(verification?.hash ?? "") === expected.verificationHash &&
    String(record.treeFingerprint) === expected.treeFingerprint
  );
}

/**
 * F100-FR-070 — a record that fails, and a bare marker without a record,
 * count as not approved and raise an integrity event.
 */
export const INTEGRITY_EVENT = "integrity.approval-invalid" as const;
export function isApproved(record: ApprovalRecord | undefined, signatureIsValid: boolean): boolean {
  return record !== undefined && signatureIsValid;
}

/** Approval records survive runs (F100-FR-070). */
export const APPROVALS_SURVIVE_RUNS = true as const;
