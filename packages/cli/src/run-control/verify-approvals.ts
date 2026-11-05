/**
 * T032 — the verification of the approval records on `resume` (F102-FR-022).
 *
 * `resume` verifies every approval record of the feature: the signature and
 * every binding of annex B §B.14 (`verdictId`, `evidenceHash`, the hash in
 * `verification`, `treeFingerprint`). It continues at the FIRST phase
 * without a valid record. A phase with no record and no marker — a phase
 * never attempted — counts as the place the run goes on and raises nothing;
 * a BARE APPROVAL MARKER without a record, and a record that fails, count as
 * not approved and raise the integrity event `integrity.noted` with, in
 * `data`, the phase, the logical name of the record or the marker, and which
 * failed: the signature, a named binding of annex B §B.14, or the absence of
 * a record (the bare-marker case). Whether the finding is also a breach of
 * the phase gate that trips the tripwire is the phase gate's to decide
 * (feature 101); this module raises the event data only.
 *
 * THE CLI WRITES NO EVENT (LR-3, LR-4). The events come back as `data`
 * payloads; the process that becomes the writer of the event file for the
 * continued launch writes them.
 *
 * The signature is HMAC-SHA-256 (feature 101) over the canonical record hash
 * of every field but `sig`; the hash itself is the kernel's canonical record
 * hash (annex X §X.5). Every dependency the module cannot hold — the bytes of
 * the records, the key material, the bindings expected — is a port the caller
 * injects, so the module stays hermetic under test.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalRecordHash } from "@specstride/kernel";
import {
  BINDINGS,
  SCHEMA_ID as APPROVAL_SCHEMA_ID,
  tryReadApprovalRecord,
  type ApprovalRecord,
} from "@specstride/contracts/records/approval-record";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-022"] as const;

/** The event type an integrity finding asks for (annex X §X.1, feature 111). */
export const INTEGRITY_EVENT_TYPE = "integrity.noted" as const;

/** The signature algorithm of the approval record (feature 101, data-model). */
export const SIGNATURE_ALGORITHM = "HMAC-SHA-256" as const;

/** The one field the signature does not cover (annex B §B.14). */
export const FIELD_THE_SIGNATURE_DOES_NOT_COVER = "sig" as const;

/** What one integrity finding says failed (F102-FR-022). */
export type IntegrityFailure =
  "signature" | `binding:${(typeof BINDINGS)[number]}` | "absence-of-a-record";

/** The `data` payload of one `integrity.noted` event (F102-FR-036). */
export type IntegrityNote = {
  readonly type: typeof INTEGRITY_EVENT_TYPE;
  readonly data: {
    readonly phase: number;
    /** The logical name of the record, or of the bare marker. */
    readonly logicalName: string;
    /** Which check failed. */
    readonly failed: IntegrityFailure;
  };
};

/** One phase counted as not approved, with its findings. */
export type UnapprovedPhase = {
  readonly phase: number;
  readonly failures: readonly IntegrityFailure[];
};

/** What the verification of a resume reports. */
export type ApprovalVerification = {
  /**
   * F102-FR-011, F102-FR-022 — the first phase of the feature without a
   * valid approval record; the phase the continued run goes on at. `null`
   * when every phase of the list holds a valid record.
   */
  readonly firstUnapprovedPhase: number | null;
  /** The phases that counted as not approved, in phase order. */
  readonly unapproved: readonly UnapprovedPhase[];
  /** The `integrity.noted` data payloads for the next event writer. */
  readonly integrityNotes: readonly IntegrityNote[];
  /** Phases whose record verified: signature AND every binding. */
  readonly approved: readonly number[];
};

/** The approval key material, as the port hands it over. */
export type ApprovalKeyMaterial = {
  readonly keyId: string;
  /** The key material, hex; never logged, never in an event (F100-FR-052). */
  readonly key: string;
};

/** What the caller of `verifyApprovals` injects. */
export type ApprovalPort = {
  /** The phases of the feature to verify, in order. */
  readonly phases: readonly number[];
  /** The approval record of a phase, read from disk; `undefined` when none. */
  readonly readRecordAt: (phase: number) => unknown | undefined;
  /** Whether a bare approval marker stands for a phase (no record behind it). */
  readonly markerAt: (phase: number) => boolean;
  /** The logical name of the marker of a phase (for the event data). */
  readonly markerNameAt?: (phase: number) => string | undefined;
  /** The bindings the record of a phase must match; `undefined` = do not check. */
  readonly bindingsAt?: (phase: number) => Record<string, string> | undefined;
  /** The approval key of the feature; `null` = no key, every signature fails. */
  readonly keyOf: () => ApprovalKeyMaterial | null;
  /** The hash over the record without `sig`; the kernel's canonical hash. */
  readonly canonicalRecordHashOf?: (record: unknown) => string;
};

const logicalNameOf = (phase: number): string => `gate:${phase}:approved`;

/** HMAC-SHA-256 over the canonical hash, hex (feature 101, F101-FR-029). */
function signatureOf(key: ApprovalKeyMaterial, canonicalHash: string): string {
  return createHmac("sha256", Buffer.from(key.key, "hex")).update(canonicalHash).digest("hex");
}

/** Constant-time comparison; a signature of the wrong shape fails first. */
function signaturesMatch(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

/** Which bindings of a valid record do not match the expected values. */
function failingBindings(
  record: ApprovalRecord,
  expected: Record<string, string>,
): `binding:${(typeof BINDINGS)[number]}`[] {
  const verification = record.verification as { hash?: unknown } | undefined;
  const actual: Record<string, unknown> = {
    verdictId: record.verdictId,
    evidenceHash: record.evidenceHash,
    verification: verification?.hash ?? "",
    treeFingerprint: record.treeFingerprint,
  };
  const failures: `binding:${(typeof BINDINGS)[number]}`[] = [];
  for (const binding of BINDINGS) {
    const wanted = expected[binding];
    if (wanted !== undefined && String(actual[binding] ?? "") !== wanted) {
      failures.push(`binding:${binding}`);
    }
  }
  return failures;
}

/**
 * Verify every approval record of the feature (F102-FR-022). Pure over the
 * port: no clock, no file system, no event file.
 */
export function verifyApprovals(port: ApprovalPort): ApprovalVerification {
  const hashOf = port.canonicalRecordHashOf ?? canonicalRecordHash;
  const key = port.keyOf();
  const unapproved: UnapprovedPhase[] = [];
  const approved: number[] = [];
  const notes: IntegrityNote[] = [];

  for (const phase of port.phases) {
    const raw = port.readRecordAt(phase);
    const failures: IntegrityFailure[] = [];

    if (raw === undefined) {
      // No record. A phase with NEITHER record nor marker is simply where
      // the run continues: it counts as not approved and raises nothing. A
      // BARE MARKER counts as not approved too and raises the event with
      // the absence of a record (F102-FR-022).
      if (port.markerAt(phase)) {
        failures.push("absence-of-a-record");
        notes.push(
          Object.freeze({
            type: INTEGRITY_EVENT_TYPE,
            data: Object.freeze({
              phase,
              logicalName: port.markerNameAt?.(phase) ?? `approval-marker:${phase}`,
              failed: "absence-of-a-record" as const,
            }),
          }),
        );
      } else {
        failures.push("absence-of-a-record");
      }
    } else {
      const read = tryReadApprovalRecord(raw, logicalNameOf(phase));
      if (!read.ok) {
        // A record that does not validate cannot have its signature verified:
        // it counts as not approved, and the signature is what failed.
        failures.push("signature");
        notes.push(
          Object.freeze({
            type: INTEGRITY_EVENT_TYPE,
            data: Object.freeze({
              phase,
              logicalName: logicalNameOf(phase),
              failed: "signature" as const,
            }),
          }),
        );
      } else {
        const record = read.record;
        const unsigned: Record<string, unknown> = { ...record };
        delete unsigned[FIELD_THE_SIGNATURE_DOES_NOT_COVER];
        const expected = key === null ? null : signatureOf(key, hashOf(unsigned));
        if (expected === null || !signaturesMatch(expected, record.sig)) {
          failures.push("signature");
          notes.push(
            Object.freeze({
              type: INTEGRITY_EVENT_TYPE,
              data: Object.freeze({
                phase,
                logicalName: logicalNameOf(phase),
                failed: "signature" as const,
              }),
            }),
          );
        }
        const bindings = port.bindingsAt?.(phase);
        if (bindings !== undefined) {
          for (const failed of failingBindings(record, bindings)) {
            failures.push(failed);
            notes.push(
              Object.freeze({
                type: INTEGRITY_EVENT_TYPE,
                data: Object.freeze({ phase, logicalName: logicalNameOf(phase), failed }),
              }),
            );
          }
        }
      }
    }

    if (failures.length > 0) {
      unapproved.push(Object.freeze({ phase, failures: Object.freeze(failures) }));
    } else {
      approved.push(phase);
    }
  }

  const firstUnapprovedPhase = unapproved.length > 0 ? unapproved[0]!.phase : null;
  return Object.freeze({
    firstUnapprovedPhase,
    unapproved: Object.freeze(unapproved),
    approved: Object.freeze(approved),
    integrityNotes: Object.freeze(notes),
  });
}

/** True when the record of a phase is a schema-valid `specstride.approval/1`. */
export function isSchemaValidApprovalRecord(value: unknown): boolean {
  return (
    tryReadApprovalRecord(value, logicalNameOf(0)).ok &&
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === APPROVAL_SCHEMA_ID
  );
}
