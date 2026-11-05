/**
 * T043 of feature 101 — the approval key (F101-FR-030).
 *
 * The key that signs approval records is a key OF THE FEATURE, kept in the
 * control plane at the logical name `feature:<slug>:approval-key`, whose row of
 * `packages/contracts/data/layout.json` gives the place (T105: a source names
 * state by logical name and never by the path of the row).
 * It is not the key that signs the ledger (`run:<runId>:ledger-key`), it is
 * never in the environment of a harness call or of a check, and it is never on
 * a path that the containment level of a pass or of a check may read.
 *
 * The primitive is HMAC-SHA-256 over the canonical record hash (research.md
 * D2): writer and verifier are the same runtime, so a key pair adds nothing,
 * and `node:crypto` ships the primitive, so no native module is needed.
 *
 * The runtime creates the key when the FIRST approval record of a feature is
 * written (F101-FR-030), which is what `approvalKeyOf` does: it reads the key
 * of the feature and makes one only where none exists.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The schema id of the record that holds the key (data-model.md, "Approval key"). */
export const SCHEMA_ID = "specstride.approval-key/1" as const;

/** The logical name of the key (annex B §B.5; `layout.json`). */
export const LOGICAL_NAME = "feature:<slug>:approval-key" as const;

/** The path of the key under the control root, as `layout.json` gives it. */
export function approvalKeyPath(slug: string): string {
  return `features/${slug}/keys/approval.key`;
}

/** F101-FR-030 — the approval key is NEVER the key that signs the ledger. */
export const THE_APPROVAL_KEY_IS_THE_LEDGER_KEY = false as const;

/** The logical name of the key this one is never equal to. */
export const LEDGER_KEY_LOGICAL_NAME = "run:<runId>:ledger-key" as const;

/** F101-FR-030 — where the key material never is. */
export const PLACES_THE_KEY_IS_NEVER_IN = Object.freeze([
  "the environment of a harness call",
  "the environment of a check",
  "a path the containment level of a pass may read",
  "a path the containment level of a check may read",
]);

/** research.md D2 — the signature primitive. */
export const SIGNATURE_ALGORITHM = "HMAC-SHA-256" as const;

/** The key material is 32 bytes of the secure random source. */
export const KEY_BYTES = 32 as const;

/** The record that holds the key (`specstride.approval-key/1`). */
export type ApprovalKeyRecord = {
  readonly schema: typeof SCHEMA_ID;
  /** The identity of the key: a hash of the key material, never the material. */
  readonly keyId: string;
  readonly createdAt: string;
  readonly feature: string;
  /** The key material, hex. It never leaves the control plane. */
  readonly key: string;
};

/**
 * The identity of a key: the SHA-256 of its material, in hex. The identity may
 * stand in an approval record, which names the key that signed it
 * (F101-FR-029, F101-FR-030); the material may not.
 */
export function keyIdOf(material: string): string {
  return createHash("sha256").update(material, "hex").digest("hex");
}

/** A new approval key of a feature. The material is never logged. */
export function newApprovalKey(feature: string, createdAt: string): ApprovalKeyRecord {
  const key = randomBytes(KEY_BYTES).toString("hex");
  return Object.freeze({
    schema: SCHEMA_ID,
    keyId: keyIdOf(key),
    createdAt,
    feature,
    key,
  });
}

/**
 * The store of the key, as the core sees it: the composition root implements it
 * over the control plane, with directories 0700 and files 0600 (annex B §B.1).
 * A core package reads and writes no file itself (F100-FR-012, F100-FR-234).
 */
export type ApprovalKeyStore = {
  /** The key of the feature, or `undefined` where none was made yet. */
  read(feature: string): ApprovalKeyRecord | undefined;
  /** Write the key of the feature, through the atomic write (F101-FR-028). */
  write(record: ApprovalKeyRecord): void;
};

/**
 * F101-FR-030 — the key of the feature, made on first use. This is the one
 * place a key is created, and it is called from the writer of the approval
 * record, so "the runtime creates the key when the first approval record of a
 * feature is written" holds by construction.
 */
export function approvalKeyOf(
  store: ApprovalKeyStore,
  feature: string,
  now: string,
): { readonly key: ApprovalKeyRecord; readonly created: boolean } {
  const held = store.read(feature);
  if (held !== undefined) return { key: held, created: false };
  const made = newApprovalKey(feature, now);
  store.write(made);
  return { key: made, created: true };
}

/** The signature over a canonical record hash, hex (F101-FR-029). */
export function signWithTheApprovalKey(key: ApprovalKeyRecord, canonicalHash: string): string {
  return createHmac("sha256", Buffer.from(key.key, "hex")).update(canonicalHash).digest("hex");
}

/**
 * Whether a signature verifies under a key. The comparison is constant-time,
 * and a signature of the wrong shape is refused before the comparison rather
 * than making `timingSafeEqual` throw.
 */
export function approvalSignatureIsValid(
  key: ApprovalKeyRecord,
  canonicalHash: string,
  signature: string,
): boolean {
  const expected = signWithTheApprovalKey(key, canonicalHash);
  if (typeof signature !== "string" || signature.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
