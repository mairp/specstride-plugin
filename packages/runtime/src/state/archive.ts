/**
 * T063 — the state archive of one feature: manifest, members, signature,
 * compression (F122-FR-033, F122-FR-034; research D-11, CQ-139).
 *
 * The form is `specs/122-detached-runtime/contracts/state-archive.schema.json`,
 * schema id `specstride.state-archive/1` (feature 100, annex B §B.20). The
 * decompressed document is
 *
 *     { schema, manifest: { feature, workspaceId, productVersion, createdAt,
 *                           hashes },
 *       members: { approvals, ledger, learning, keys? },
 *       sig }
 *
 * and the file on disk is that document, compressed. Research D-11: *one file:
 * a compressed JSON document with a manifest ... followed by a signature over
 * the manifest made with the approval key*. Compression comes from the runtime
 * platform (`node:zlib`), so no archive library is needed and no platform tool
 * is called.
 *
 * WHY THE SIGNATURE IS OVER THE MANIFEST AND THE MANIFEST HOLDS THE HASHES.
 * F122-FR-033 asks for *a manifest of the hash of every member* and that the
 * archive *MUST be signed*; F122-FR-034 asks `import` to verify *the signature
 * of the archive, the hash of every member and the signature of every approval
 * record before it writes anything*. One signature over the manifest therefore
 * covers every member, because changing a member changes its hash and so
 * changes the manifest the signature was made over. That is why
 * `verifyArchive` below checks the hashes AND the signature: either alone
 * would leave a hole.
 *
 * Every hash and every signed text comes from the canonical hasher of annex X
 * §X.5 (`canonicalRecordHash`, `canonicalRecordText` of `@specstride/kernel`),
 * so that a reader on another machine computes the same value over the same
 * record whatever order its keys arrive in. No feature builds a record text of
 * its own.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { canonicalRecordHash, canonicalRecordText, contentHash } from "@specstride/kernel";

/* ------------------------------------------------------------------ *
 * What the schema fixes.
 * ------------------------------------------------------------------ */

/** The schema id the archive carries in its field `schema` (F100-FR-048). */
export const ARCHIVE_SCHEMA_ID = "specstride.state-archive/1" as const;

/** The contract this module is written from; a test compares the two. */
export const ARCHIVE_SCHEMA_FILE =
  "specs/122-detached-runtime/contracts/state-archive.schema.json" as const;

/** The section of annex B that owns the record, and the research decision. */
export const ARCHIVE_ANNEX_SECTION = "annex B, §B.20" as const;
export const ARCHIVE_DECISION = "D-11" as const;

/** The top-level fields the schema marks required, in its order. */
export const ARCHIVE_REQUIRED_FIELDS = ["schema", "manifest", "members", "sig"] as const;

/** The fields of the manifest the schema marks required, in its order. */
export const MANIFEST_REQUIRED_FIELDS = [
  "feature",
  "workspaceId",
  "productVersion",
  "createdAt",
  "hashes",
] as const;

/** The members the schema marks required, in its order; `keys` is optional. */
export const MEMBER_NAMES_REQUIRED = ["approvals", "ledger", "learning"] as const;

/** Every member name, the optional one included (CQ-139). */
export const MEMBER_NAMES = ["approvals", "ledger", "learning", "keys"] as const;
export type MemberName = (typeof MEMBER_NAMES)[number];

/**
 * F122-FR-033 — *the archive MUST be readable and writable by its owner only*.
 * The mode is given at the open, not set afterwards, so the file never exists
 * with wider bits for even a moment.
 */
export const ARCHIVE_FILE_MODE = 0o600 as const;

/** The archive is one file; nothing of it is a directory (D-11). */
export const ARCHIVE_IS_ONE_FILE = true as const;

/** Compression comes from the runtime platform, not from a dependency (D-11). */
export const COMPRESSION = "gzip" as const;
export const COMPRESSION_COMES_FROM = "node:zlib" as const;

/* ------------------------------------------------------------------ *
 * The types.
 * ------------------------------------------------------------------ */

/** The manifest: what the archive is of, and the hash of every member. */
export type ArchiveManifest = {
  readonly feature: string;
  readonly workspaceId: string;
  readonly productVersion: string;
  readonly createdAt: string;
  /** Member name to its canonical record hash. */
  readonly hashes: Readonly<Record<string, string>>;
};

/**
 * The members. `approvals` are records of `specstride.approval/1`, `ledger`
 * records of `specstride.ledger/1` in order, `learning` the decision log and
 * the learning events of the feature as text, `keys` the approval key and the
 * ledger keys (CQ-139: *the archive holds the approval key and the ledger key
 * of the feature and is signed with the approval key*).
 */
export type ArchiveMembers = {
  readonly approvals: readonly Record<string, unknown>[];
  readonly ledger: readonly Record<string, unknown>[];
  readonly learning: Readonly<Record<string, string>>;
  readonly keys?: ArchiveKeys;
};

/** The keys the archive carries (CQ-139). */
export type ArchiveKeys = {
  /** The approval key of the feature; the key the archive is signed with. */
  readonly approval?: string;
  /** The ledger key of each run, by run id. */
  readonly ledger?: Readonly<Record<string, string>>;
};

/** The decompressed archive. */
export type StateArchive = {
  readonly schema: typeof ARCHIVE_SCHEMA_ID;
  readonly manifest: ArchiveManifest;
  readonly members: ArchiveMembers;
  readonly sig: string;
};

/* ------------------------------------------------------------------ *
 * Hashes and the signature.
 * ------------------------------------------------------------------ */

/** The algorithm of the signature; a shared secret, not a key pair (D-11). */
export const SIGNATURE_ALGORITHM = "hmac-sha256" as const;

/** The canonical text a member hash is taken over (annex X §X.5). */
export function memberText(member: unknown): string {
  return canonicalRecordText(member);
}

/** The hash of one member (annex X §X.5, "Canonical record hash"). */
export function memberHash(member: unknown): string {
  return canonicalRecordHash(member);
}

/**
 * The hash of every member, as the manifest carries it. A member the archive
 * does not hold gets no entry, so `hashes` and `members` always agree on which
 * members exist — an absent member cannot be smuggled in by leaving its hash
 * out, because `verifyArchive` compares the two sets both ways.
 */
export function memberHashesOf(members: ArchiveMembers): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of MEMBER_NAMES) {
    const value = (members as Record<string, unknown>)[name];
    if (value === undefined) continue;
    out[name] = memberHash(value);
  }
  return Object.freeze(out);
}

/**
 * The text the signature is made over: the canonical text of the manifest.
 * The manifest holds the hash of every member, so this one text binds the
 * whole archive.
 */
export function signedText(manifest: ArchiveManifest): string {
  return canonicalRecordText(manifest);
}

/** Sign a text with a key. The key is a secret and never printed. */
export function signWithKey(text: string, key: string): string {
  return createHmac("sha256", key).update(text, "utf8").digest("hex");
}

/** Compare two signatures without leaking where they first differ. */
export function signaturesAgree(a: string, b: string): boolean {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The signature over the manifest, made with the approval key (CQ-139). */
export function signManifest(manifest: ArchiveManifest, approvalKey: string): string {
  return signWithKey(signedText(manifest), approvalKey);
}

/** True where the signature of the archive was made with this key. */
export function manifestSignatureIsValid(archive: StateArchive, approvalKey: string): boolean {
  return signaturesAgree(archive.sig, signManifest(archive.manifest, approvalKey));
}

/* ------------------------------------------------------------------ *
 * The signature of an approval record.
 * ------------------------------------------------------------------ */

/**
 * The fields of an approval record the signature is made over: *every field
 * above* (§B.14), which is every field of the record but `sig` itself. Taking
 * it over the record MINUS `sig` rather than over a fixed list means a field a
 * later minor version adds is signed too (F100-FR-049).
 */
export function approvalSignedText(record: Record<string, unknown>): string {
  const withoutSignature: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "sig") continue;
    withoutSignature[key] = value;
  }
  return canonicalRecordText(withoutSignature);
}

/** Sign an approval record with the approval key of its feature (F100-FR-070). */
export function signApprovalRecord(
  record: Record<string, unknown>,
  approvalKey: string,
): Record<string, unknown> {
  return Object.freeze({ ...record, sig: signWithKey(approvalSignedText(record), approvalKey) });
}

/**
 * F122-FR-034 — *the signature of every approval record*. A record without a
 * `sig`, or one signed with another key, is not valid: there is no path on
 * which an absent signature counts as one.
 */
export function approvalSignatureIsValid(
  record: Record<string, unknown>,
  approvalKey: string,
): boolean {
  const signature = record["sig"];
  if (typeof signature !== "string" || signature === "") return false;
  return signaturesAgree(signature, signWithKey(approvalSignedText(record), approvalKey));
}

/** Sign a ledger record with the ledger key; never with the approval key (§B.13). */
export function signLedgerRecord(
  record: Record<string, unknown>,
  ledgerKey: string,
): Record<string, unknown> {
  return Object.freeze({ ...record, sig: signWithKey(approvalSignedText(record), ledgerKey) });
}

/** True where the ledger record was signed with this ledger key. */
export function ledgerSignatureIsValid(
  record: Record<string, unknown>,
  ledgerKey: string,
): boolean {
  const signature = record["sig"];
  if (typeof signature !== "string" || signature === "") return false;
  return signaturesAgree(signature, signWithKey(approvalSignedText(record), ledgerKey));
}

/* ------------------------------------------------------------------ *
 * Build.
 * ------------------------------------------------------------------ */

/** What `buildArchive` needs to know. */
export type BuildArchiveInput = {
  readonly feature: string;
  readonly workspaceId: string;
  readonly productVersion: string;
  readonly createdAt: Date | string;
  readonly members: ArchiveMembers;
  /** The approval key of the feature; the archive is signed with it (CQ-139). */
  readonly approvalKey: string;
};

/**
 * Build the archive: the manifest with the hash of every member, then the
 * signature over that manifest. The hashes are computed HERE and never taken
 * from the caller, so a manifest whose hashes do not describe its members
 * cannot be built by mistake.
 */
export function buildArchive(input: BuildArchiveInput): StateArchive {
  const manifest: ArchiveManifest = Object.freeze({
    feature: input.feature,
    workspaceId: input.workspaceId,
    productVersion: input.productVersion,
    createdAt:
      typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString(),
    hashes: memberHashesOf(input.members),
  });
  return Object.freeze({
    schema: ARCHIVE_SCHEMA_ID,
    manifest,
    members: Object.freeze({ ...input.members }),
    sig: signManifest(manifest, input.approvalKey),
  });
}

/* ------------------------------------------------------------------ *
 * Validate against the schema.
 * ------------------------------------------------------------------ */

/** Why a value is no archive of `specstride.state-archive/1`. */
export const ARCHIVE_REFUSALS = [
  "not-an-object",
  "missing-schema",
  "different-major",
  "missing-field",
  "additional-property",
  "wrong-type",
] as const;
export type ArchiveRefusal = (typeof ARCHIVE_REFUSALS)[number];

/** What a validation answers. */
export type ArchiveValidation =
  | { readonly ok: true; readonly archive: StateArchive }
  | { readonly ok: false; readonly refusal: ArchiveRefusal; readonly detail: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a decompressed document against the schema of the contract:
 * `schema` is the const of the schema id, the four top-level fields are
 * required, `additionalProperties` is false at the top level, the five
 * manifest fields are required, and the three required members are there with
 * the kind the schema gives them.
 */
export function validateArchive(value: unknown): ArchiveValidation {
  if (!isObject(value)) {
    return Object.freeze({
      ok: false as const,
      refusal: "not-an-object" as const,
      detail: "the archive is no object",
    });
  }
  if (value["schema"] === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: "missing-schema" as const,
      detail: "the field `schema` is missing",
    });
  }
  if (value["schema"] !== ARCHIVE_SCHEMA_ID) {
    return Object.freeze({
      ok: false as const,
      refusal: "different-major" as const,
      detail: `the archive carries \`${String(value["schema"])}\` and not \`${ARCHIVE_SCHEMA_ID}\``,
    });
  }
  for (const field of ARCHIVE_REQUIRED_FIELDS) {
    if (value[field] === undefined) {
      return Object.freeze({
        ok: false as const,
        refusal: "missing-field" as const,
        detail: `the field \`${field}\` is missing`,
      });
    }
  }
  for (const key of Object.keys(value)) {
    if (!(ARCHIVE_REQUIRED_FIELDS as readonly string[]).includes(key)) {
      return Object.freeze({
        ok: false as const,
        refusal: "additional-property" as const,
        detail: `the archive carries the field \`${key}\`, which the schema does not allow`,
      });
    }
  }
  if (typeof value["sig"] !== "string") {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`sig` is no text",
    });
  }
  const manifest = value["manifest"];
  if (!isObject(manifest)) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`manifest` is no object",
    });
  }
  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (manifest[field] === undefined) {
      return Object.freeze({
        ok: false as const,
        refusal: "missing-field" as const,
        detail: `the manifest lacks \`${field}\``,
      });
    }
  }
  if (!isObject(manifest["hashes"])) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`manifest.hashes` is no object",
    });
  }
  const members = value["members"];
  if (!isObject(members)) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`members` is no object",
    });
  }
  for (const name of MEMBER_NAMES_REQUIRED) {
    if (members[name] === undefined) {
      return Object.freeze({
        ok: false as const,
        refusal: "missing-field" as const,
        detail: `the members lack \`${name}\``,
      });
    }
  }
  if (!Array.isArray(members["approvals"])) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`members.approvals` is no array",
    });
  }
  if (!Array.isArray(members["ledger"])) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`members.ledger` is no array",
    });
  }
  if (!isObject(members["learning"])) {
    return Object.freeze({
      ok: false as const,
      refusal: "wrong-type" as const,
      detail: "`members.learning` is no object",
    });
  }
  return Object.freeze({ ok: true as const, archive: value as unknown as StateArchive });
}

/* ------------------------------------------------------------------ *
 * Verify.
 * ------------------------------------------------------------------ */

/** Why an archive fails verification (F122-FR-034). */
export const VERIFICATION_FAILURES = [
  "schema",
  "signature",
  "member-hash",
  "hash-without-a-member",
  "member-without-a-hash",
  "approval-signature",
  "no-key",
] as const;
export type VerificationFailure = (typeof VERIFICATION_FAILURES)[number];

/** What a verification answers; nothing is written on either path. */
export type ArchiveVerification = {
  readonly ok: boolean;
  readonly failures: readonly { readonly failure: VerificationFailure; readonly detail: string }[];
  /** How many approval records the archive holds. */
  readonly approvals: number;
};

/**
 * F122-FR-034 — verify *the signature of the archive, the hash of every member
 * and the signature of every approval record*, in that order and all of them,
 * so that the report names everything that is wrong and not only the first
 * thing. The key is the one the archive carries (CQ-139) unless the caller
 * names another.
 */
export function verifyArchive(
  value: unknown,
  options: { readonly approvalKey?: string | undefined } = {},
): ArchiveVerification {
  const failures: { failure: VerificationFailure; detail: string }[] = [];
  const read = validateArchive(value);
  if (!read.ok) {
    return Object.freeze({
      ok: false,
      failures: Object.freeze([{ failure: "schema" as const, detail: read.detail }]),
      approvals: 0,
    });
  }
  const archive = read.archive;
  const approvals = archive.members.approvals;
  const key = options.approvalKey ?? archive.members.keys?.approval;
  if (key === undefined || key === "") {
    failures.push({
      failure: "no-key",
      detail: "no approval key: neither the archive nor the caller names one (CQ-139)",
    });
  } else {
    if (!manifestSignatureIsValid(archive, key)) {
      failures.push({
        failure: "signature",
        detail: "the signature over the manifest does not match",
      });
    }
    approvals.forEach((record, index) => {
      if (!approvalSignatureIsValid(record as Record<string, unknown>, key)) {
        failures.push({
          failure: "approval-signature",
          detail: `the approval record at ${index} (phase ${String((record as Record<string, unknown>)["phase"] ?? "?")}) is not signed with the approval key`,
        });
      }
    });
  }
  const computed = memberHashesOf(archive.members);
  for (const [name, hash] of Object.entries(computed)) {
    const recorded = archive.manifest.hashes[name];
    if (recorded === undefined) {
      failures.push({
        failure: "member-without-a-hash",
        detail: `the manifest has no hash for \`${name}\``,
      });
    } else if (recorded !== hash) {
      failures.push({
        failure: "member-hash",
        detail: `the hash of \`${name}\` does not match the manifest`,
      });
    }
  }
  for (const name of Object.keys(archive.manifest.hashes)) {
    if (computed[name] === undefined) {
      failures.push({
        failure: "hash-without-a-member",
        detail: `the manifest hashes \`${name}\`, which the archive does not hold`,
      });
    }
  }
  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures.map((one) => Object.freeze(one))),
    approvals: approvals.length,
  });
}

/* ------------------------------------------------------------------ *
 * Compression: the bytes of the file.
 * ------------------------------------------------------------------ */

/**
 * The bytes of the archive file: the canonical text of the document, gzipped.
 * The canonical text, and not `JSON.stringify` of the object as it stands, so
 * that two exports of the same state give the same bytes.
 */
export function compressArchive(archive: StateArchive): Buffer {
  return gzipSync(Buffer.from(canonicalRecordText(archive), "utf8"));
}

/** What a reading of the bytes answers. */
export type ArchiveReading =
  | { readonly ok: true; readonly archive: StateArchive }
  | {
      readonly ok: false;
      readonly refusal: "not-compressed" | "not-json" | ArchiveRefusal;
      readonly detail: string;
    };

/**
 * Read the bytes back: decompress, parse, validate. A file that is not gzip at
 * all, and a gzip whose content is not JSON, are both refusals and never a
 * throw, because `state import` must answer them with exit 1 and not with a
 * stack.
 */
export function decompressArchive(bytes: Uint8Array): ArchiveReading {
  let text: string;
  try {
    text = gunzipSync(bytes).toString("utf8");
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      refusal: "not-compressed" as const,
      detail: `the file is not a ${COMPRESSION} archive (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      refusal: "not-json" as const,
      detail: `the archive is no JSON document (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  const read = validateArchive(parsed);
  if (!read.ok)
    return Object.freeze({ ok: false as const, refusal: read.refusal, detail: read.detail });
  return Object.freeze({ ok: true as const, archive: read.archive });
}

/** The content hash of the bytes of an archive file, for a report. */
export function archiveFingerprint(bytes: Uint8Array): string {
  return contentHash(bytes);
}
