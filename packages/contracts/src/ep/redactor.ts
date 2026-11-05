/**
 * T200 — the interface type of the redactor (`register`, `redact`) and the
 * validator of the pattern set from `schemas/redaction-pattern-set.schema.json`
 * (annex X, §X.4; F100-FR-205). The redactor itself belongs to feature 111.
 *
 * The two operations come from the key `redactor` of
 * `data/kernel-operations.json`; the field list of the pattern set is the
 * second table of §X.4 and its schema id is `specstride.redaction/1`.
 */
import kernelOperations from "../../data/kernel-operations.json" with { type: "json" };
import type { RedactionPatternSet as Generated } from "../records/generated/redaction-pattern-set.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "../records/validate.ts";
import { validate } from "../records/compile.ts";

/** The section of annex X that owns the redactor. */
export const ANNEX_SECTION = "annex X, §X.4" as const;

/** The schema id of the pattern set (§X.4). */
export const SCHEMA_ID = "specstride.redaction/1" as const;

/**
 * The pattern set has no logical name of the control plane: it is versioned
 * DATA that feature 111 ships with the product (§X.4, "which is data"). The
 * subject is what the refusal message names in its place.
 */
export const SUBJECT = "the redaction pattern set (annex X, §X.4)" as const;

/** The feature that owns the redactor, the pattern set and its canary test. */
export const CONTENT_OWNER = "111" as const;

type RawOperation = { Operation: string; Input: string; Output: string };

/** One operation of the table of §X.4. */
export type RedactorOperation = {
  readonly operation: string;
  readonly input: string;
  readonly output: string;
};

/** The operations of the redactor, from `data/kernel-operations.json`. */
export const redactorOperations: readonly RedactorOperation[] = Object.freeze(
  (kernelOperations as { redactor: RawOperation[] }).redactor.map((row) =>
    Object.freeze({
      operation: row.Operation.replace(/`/g, "").trim(),
      input: row.Input,
      output: row.Output,
    }),
  ),
);

/** The names of the two operations of §X.4, and no other. */
export const OPERATIONS = ["register", "redact"] as const;
export type OperationName = (typeof OPERATIONS)[number];

/** The row of an operation, or `undefined`. */
export function operationOf(name: string): RedactorOperation | undefined {
  return redactorOperations.find((row) => row.operation === name);
}

/* ------------------------------------------------------------------ *
 * The pattern set.
 * ------------------------------------------------------------------ */

/** The versioned pattern set of the redactor (annex X, §X.4). */
export type RedactionPatternSet = Generated;

/**
 * Read the pattern set: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §X.4 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readRedactionPatternSet(
  value: unknown,
  logicalName: string = SUBJECT,
): RedactionPatternSet {
  return readRecord<RedactionPatternSet>(logicalName, value);
}

/** `readRedactionPatternSet` that returns a result instead of throwing. */
export function tryReadRedactionPatternSet(
  value: unknown,
  logicalName: string = SUBJECT,
): { ok: true; record: RedactionPatternSet } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<RedactionPatternSet>(logicalName, value);
}

/** True when the value validates against `specstride.redaction/1`. */
export function isRedactionPatternSet(value: unknown): value is RedactionPatternSet {
  return validate<RedactionPatternSet>(SCHEMA_ID, value).ok;
}

/** The two lists of patterns of the set (§X.4). */
export const PATTERN_LISTS = ["keyNames", "values"] as const;

/** What the `values` list of the set covers (§X.4). */
export const VALUE_PATTERNS_COVER = [
  "private-key blocks",
  "signed tokens",
  "access key ids of clouds",
  "addresses with embedded credentials",
  "prefixes of provider keys",
] as const;

/** The version of the set is recorded in every run record (§X.4). */
export const VERSION_IS_RECORDED_IN = "the run record" as const;

/* ------------------------------------------------------------------ *
 * The interface of the redactor.
 * ------------------------------------------------------------------ */

/** What `redact` returns (§X.4, the `redact` row). */
export type RedactResult = {
  /** The redacted, cut text. */
  readonly text: string;
  /** How many replacements were made. */
  readonly replacements: number;
  /** The version of the pattern set. */
  readonly patternSetVersion: string;
  /**
   * F100-FR-205 — the redactor fails closed: when it cannot run, the content
   * is DROPPED and the record says so. `dropped` is true in that case and
   * `text` is empty.
   */
  readonly dropped?: boolean | undefined;
  /** Why the content was dropped, where it was. */
  readonly reason?: string | undefined;
};

/**
 * The interface of the redactor (annex X, §X.4). There is ONE redactor and ONE
 * point of redaction, at the ingress of annex A F100-FR-009; feature 111
 * implements it.
 */
export type Redactor = {
  /**
   * `register` — a secret value that the runtime resolved. Nothing is
   * returned; the value is matched exactly from then on.
   */
  register(secret: string): void;
  /**
   * `redact` — a text and a size cap. The redacted, cut text; how many
   * replacements were made; the version of the pattern set.
   */
  redact(text: string, sizeCap: number): RedactResult;
};

/** The one point of redaction (F100-FR-205). */
export const ONE_POINT_OF_REDACTION = "the ingress of annex A, F100-FR-009" as const;

/** Every sink receives the redacted form (F100-FR-205). */
export const SINKS = ["event file", "exporters", "digest", "status", "read model"] as const;
export type Sink = (typeof SINKS)[number];

/** F100-FR-205 — the redactor fails closed. */
export const FAILS_CLOSED = true as const;
export const WHEN_IT_CANNOT_RUN = Object.freeze({
  contentIsDropped: true as const,
  theRecordSaysSo: true as const,
});

/** F100-FR-205 — the consumer's comment passes the redactor before it is recorded. */
export const THE_COMMENT_PASSES_THE_REDACTOR = true as const;

/** What the redactor replaces (F100-FR-205). */
export const REPLACES = [
  "every exact occurrence of a registered secret value",
  "every match of the versioned pattern set, which is data",
] as const;

/* ------------------------------------------------------------------ *
 * F100-FR-206 — the scan before a commit.
 * ------------------------------------------------------------------ */

/** One hit of the pre-commit scan (F100-FR-206). */
export type PreCommitHit = {
  /** The file of the commit the hit is in, relative to the repository root. */
  readonly file: string;
  /** The line, 1-indexed. */
  readonly line: number;
  /** Whether a registered secret or a pattern of the set matched. */
  readonly matched: "registered-secret" | "pattern";
  /** The name of the pattern, where a pattern matched. */
  readonly pattern?: string | undefined;
};

/** What the pre-commit scan returns (F100-FR-206). */
export type PreCommitScanResult = {
  /** The hits, if any. */
  readonly hits: readonly PreCommitHit[];
  /** True where a hit blocks the commit. */
  readonly blocked: boolean;
  /** The event the scan raises on a hit. */
  readonly event?: { readonly type: string; readonly fileCount: number } | undefined;
};

/**
 * The interface of the scan before a commit (annex X, §X.4; F100-FR-206). The
 * files the RUNTIME wrote are scanned for registered secrets and for the
 * patterns; a hit blocks the commit and raises an event. Feature 111
 * implements it.
 */
export type PreCommitScan = {
  /**
   * Scan the files of the commit that the runtime wrote. `files` are paths
   * relative to the repository root; the scan reads them and returns the hits.
   */
  scan(files: readonly string[]): PreCommitScanResult;
};

/** The event a hit raises (F100-FR-206). */
export const PRE_COMMIT_EVENT_TYPE = "integrity.secret_in_commit" as const;

/** A hit blocks the commit (F100-FR-206). */
export const A_HIT_BLOCKS_THE_COMMIT = true as const;

/** The subject of the scan: the files of the commit the RUNTIME wrote. */
export const SCAN_SUBJECT = "the files of the commit that the runtime wrote" as const;

/** What the scan looks for (F100-FR-206). */
export const SCAN_LOOKS_FOR = ["registered secrets", "the patterns"] as const;
