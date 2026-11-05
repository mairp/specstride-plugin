/**
 * T074 of feature 101 — the verification of an approval record (F101-FR-031).
 *
 * WHEREVER the engine reads whether a phase is approved — when it derives the
 * start position (T036, F101-FR-002), at `resume`, at a relaunch, at phase
 * entry — it reads it THROUGH THIS MODULE and never through a bare existence
 * check. Five bindings are checked:
 *
 * | Binding | What must hold |
 * |---|---|
 * | the schema | the record validates against `specstride.approval/1` |
 * | the signature | it verifies under the key the record NAMES |
 * | the verdict record | it is the one the record names, its verdict is APPROVED, and its hash of the nonce is the record's |
 * | the hash of the phase evidence | it equals the hash of the phase evidence set aside in the control plane |
 * | the hash of the result of the verification gate | it equals the hash of the stored result |
 *
 * A record that fails any of them, a MISSING record, and a BARE MARKER without
 * a record each count as NOT APPROVED and raise an integrity event that names
 * the phase and what failed. The failure is a member of row 255 of annex X
 * §X.6 (`packages/contracts/src/enums/gate.ts`, `approvalFailures`).
 *
 * The fingerprint of the tree is deliberately NOT checked here: F101-FR-031
 * and feature 100 F100-FR-136 compare it at phase entry, and it never makes a
 * record fail.
 */
import { validate } from "@specstride/contracts/records/compile";
import type { ApprovalFailure } from "@specstride/contracts/enums/gate";
import { typeOf } from "../gate/events.ts";
import { approvalSignatureIsValid, type ApprovalKeyRecord } from "./key.ts";
import {
  APPROVAL_SCHEMA_ID,
  unsignedApprovalRecord,
  type ApprovalRecordOfThePhase,
  type CanonicalRecordHash,
} from "./record.ts";

/** F101-FR-031 — the five bindings, in the order the requirement gives them. */
export const BINDINGS_CHECKED = Object.freeze([
  "schema",
  "signature",
  "verdict record",
  "hash of the phase evidence set aside",
  "hash of the stored result of the verification gate",
]);

/** F101-FR-031 — the tree fingerprint never makes a record fail. */
export const THE_TREE_FINGERPRINT_MAKES_A_RECORD_FAIL = false as const;

/** Where the tree fingerprint IS compared (F100-FR-136). */
export const THE_TREE_FINGERPRINT_IS_COMPARED_AT = "phase entry" as const;

/**
 * The type of the integrity event an approval that fails raises: the integrity
 * NOTE of this feature's event table, whose family is `integrity` and whose
 * event is `noted`, with the fields `kind` and `detail`. The type is a row of
 * feature 111's catalogue (`packages/observability/data/event-catalogue.tsv`)
 * and projects to no as-is event of the baseline.
 *
 * The two parts are JOINED by `typeOf` rather than written as one dotted
 * literal, because `integrity` is also a namespace of the configuration
 * schema, and CT-110-109 of feature 110 reads a quoted dotted literal in such
 * a namespace as a configuration key with no row.
 */
export const INTEGRITY_EVENT_TYPE = typeOf({ family: "integrity", event: "noted" });

/** The `kind` the integrity note of a failed approval carries. */
export const INTEGRITY_EVENT_KIND = "approval-invalid" as const;

/** The verdict record as this module needs to read it (data-model.md). */
export type VerdictRecordForVerification = {
  readonly verdictId: string;
  readonly verdict: string;
  readonly nonceHash: string;
};

/** What the engine hands in to verify one approval record. */
export type ApprovalVerificationInputs = {
  readonly phase: number;
  /** The record as it was read, or `undefined` where none exists. */
  readonly record: unknown;
  /**
   * Whether a bare approval marker of an as-is system stands in the workspace
   * part. With no record beside it, the phase counts as NOT approved and the
   * failure is `marker-only` rather than `missing` (F101-FR-031).
   */
  readonly markerStands?: boolean;
  /** The approval key the record names, or `undefined` where it is unknown. */
  readonly key: ApprovalKeyRecord | undefined;
  /** The verdict record the approval names, or `undefined`. */
  readonly verdictRecord: VerdictRecordForVerification | undefined;
  /** The hash of the phase evidence set aside in the control plane. */
  readonly evidenceHashSetAside: string | undefined;
  /** The hash of the stored result of the verification gate. */
  readonly storedVerificationHash: string | undefined;
  readonly canonicalRecordHash: CanonicalRecordHash;
};

/** The integrity event an approval that failed raises (F101-FR-031). */
export type ApprovalIntegrityEvent = {
  readonly type: typeof INTEGRITY_EVENT_TYPE;
  readonly kind: typeof INTEGRITY_EVENT_KIND;
  /** The event NAMES the phase (F101-FR-031). */
  readonly phase: number;
  /** What failed: a member of row 255 of annex X §X.6. */
  readonly failed: ApprovalFailure;
  /** The same two facts as one line, for a reader of the event stream. */
  readonly detail: string;
  /** The record's own id of the key, where the record carried one. */
  readonly keyId?: string;
};

/** The result of verifying one approval record. */
export type ApprovalVerificationResult =
  | {
      readonly approved: true;
      readonly record: ApprovalRecordOfThePhase;
      readonly failed?: undefined;
      readonly integrityEvent?: undefined;
    }
  | {
      readonly approved: false;
      readonly record?: undefined;
      readonly failed: ApprovalFailure;
      readonly integrityEvent: ApprovalIntegrityEvent;
    };

function notApproved(
  phase: number,
  failed: ApprovalFailure,
  keyId?: string,
): ApprovalVerificationResult {
  return Object.freeze({
    approved: false as const,
    failed,
    integrityEvent: Object.freeze({
      type: INTEGRITY_EVENT_TYPE,
      kind: INTEGRITY_EVENT_KIND,
      phase,
      failed,
      detail: `phase ${String(phase)}: ${failed}`,
      ...(keyId === undefined ? {} : { keyId }),
    }),
  });
}

/**
 * F101-FR-031 — verify one approval record. The first binding that fails is
 * the one the integrity event names, so that a reader sees the EARLIEST cause
 * and not a cascade of consequences.
 */
export function verifyApprovalRecord(
  inputs: ApprovalVerificationInputs,
): ApprovalVerificationResult {
  const { phase } = inputs;

  // A missing record, and a bare marker without a record, are the two shapes
  // of "nothing to verify". They are told apart so that a planted marker is
  // reported as what it is (threat T-02).
  if (inputs.record === undefined || inputs.record === null) {
    return notApproved(phase, inputs.markerStands === true ? "marker-only" : "missing");
  }

  // 1 — the schema.
  if (!validate(APPROVAL_SCHEMA_ID, inputs.record).ok) return notApproved(phase, "schema");
  const record = inputs.record as ApprovalRecordOfThePhase;

  // 2 — the signature, with the key the record NAMES. A key that is not known
  // is `key-unknown`: the record names a key the runtime does not hold, so no
  // signature can be checked at all.
  if (inputs.key === undefined) return notApproved(phase, "key-unknown", record.keyId);
  if (inputs.key.keyId !== record.keyId) {
    return notApproved(phase, "key-unknown", record.keyId);
  }
  const canonical = inputs.canonicalRecordHash(unsignedApprovalRecord(record, record.keyId));
  if (!approvalSignatureIsValid(inputs.key, canonical, record.sig)) {
    return notApproved(phase, "signature", record.keyId);
  }

  // 3 — the verdict record it names, with the verdict APPROVED and the same
  // hash of the nonce.
  const verdict = inputs.verdictRecord;
  if (
    verdict === undefined ||
    verdict.verdictId !== record.verdictId ||
    verdict.verdict !== "APPROVED" ||
    verdict.nonceHash !== record.nonceHash
  ) {
    return notApproved(phase, "verdict", record.keyId);
  }

  // 4 — the hash of the phase evidence against the phase evidence set aside.
  if (
    inputs.evidenceHashSetAside === undefined ||
    inputs.evidenceHashSetAside !== record.evidenceHash
  ) {
    return notApproved(phase, "evidence-hash", record.keyId);
  }

  // 5 — the hash of the result of the verification gate against the stored one.
  if (
    inputs.storedVerificationHash === undefined ||
    inputs.storedVerificationHash !== record.verification.hash
  ) {
    return notApproved(phase, "verification-hash", record.keyId);
  }

  return Object.freeze({ approved: true as const, record });
}

/**
 * The reader of approvals the rest of the engine uses: a phase number in, a
 * verified result out. T036 takes one of these, so the start position can
 * never be derived from an unverified record.
 */
export type VerifiedApprovalReader = (phase: number) => ApprovalVerificationResult;
