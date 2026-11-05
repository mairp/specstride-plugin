/**
 * T246 — the further rules of records (annex B, §B.4; F100-FR-050,
 * F100-FR-051, F100-FR-052).
 *
 * An unknown field is ignored by the reader and kept by a writer that copies
 * (`copyRecord`); a record holds no secret value, no nonce before its call
 * returned and no content (`holdsNoSecret`); every state file has exactly one
 * writing process (`oneWriter`); and the run record holds one list
 * `productVersions` — the version that started the run, then the version of
 * every later engine start; a difference is recorded as an event and shown by
 * the doctor (F100-FR-050).
 */
import layout from "../../data/layout.json" with { type: "json" };

type RawName = { logicalName: string; root: string; writer: string };

const NAMES = (layout as { logicalNames: RawName[] }).logicalNames;

/* ------------------------------------------------------------------ *
 * F100-FR-049 / §B.4: an unknown field is ignored by the reader and
 * kept by a writer that copies.
 * ------------------------------------------------------------------ */

/**
 * Copy a record, keeping every field — the ones this version of the reader
 * knows and the ones it does not. `changes` is applied on top. A writer that
 * copies a record uses this, so that a field added inside the major by a
 * newer writer survives a read-modify-write (annex B, §B.4).
 */
export function copyRecord<T extends Record<string, unknown>>(
  record: T,
  changes: Partial<T> = {},
): T {
  return { ...record, ...changes };
}

/** The fields of a record that the given list of known fields does not hold. */
export function unknownFields(
  record: Record<string, unknown>,
  knownFields: readonly string[],
): readonly string[] {
  return Object.freeze(Object.keys(record).filter((k) => !knownFields.includes(k)));
}

/* ------------------------------------------------------------------ *
 * F100-FR-052: no secret value, no nonce before its call returned,
 * no prompt or reply content.
 * ------------------------------------------------------------------ */

/** What `holdsNoSecret` found, and what the annex asks for instead. */
export type SecretFinding = {
  /** The path of the field inside the record, `/critic/apiKey`. */
  readonly path: string;
  /** Why it is refused. */
  readonly kind: "secret-value" | "open-nonce" | "content";
  /** What the record must carry instead (annex B, §B.4, F100-FR-052). */
  readonly asks: string;
};

/** Field names that name a secret value (annex B, §B.4). */
const SECRET_FIELD = /(^|[^a-z])(secret|password|passwd|apikey|api_key|token|credential|bearer)/i;
/** A field that names a reference, a hash or a size is the allowed form. */
const ALLOWED_SUFFIX = /(Ref|Reference|Hash|Id|Size|Bytes|Name|Provider|Scheme)$/;
/** Field names that name prompt or reply content (annex B, §B.4). */
const CONTENT_FIELD = /^(prompt|reply|response|body|text|output|stdout|stderr|content|message)$/i;

/**
 * F100-FR-052 — refuse a secret value, a nonce before its call returned, or
 * content; ask for the reference, the hash, or the logical name with hash and
 * size. `openNonces` names the nonces whose call has not returned.
 */
export function holdsNoSecret(
  record: unknown,
  options: { readonly openNonces?: readonly string[] } = {},
): readonly SecretFinding[] {
  const open = options.openNonces ?? [];
  const findings: SecretFinding[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}/${i}`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = `${path}/${key}`;
      const isText = typeof v === "string" && v !== "";
      if (isText && SECRET_FIELD.test(key) && !ALLOWED_SUFFIX.test(key)) {
        findings.push({
          path: here,
          kind: "secret-value",
          asks: "the reference of the secret, never its value (F100-FR-052)",
        });
      } else if (isText && /nonce$/i.test(key) && !/hash$/i.test(key)) {
        if (open.includes(String(v)) || open.length === 0) {
          findings.push({
            path: here,
            kind: "open-nonce",
            asks: "the hash of the nonce until its call has returned (F100-FR-052)",
          });
        }
      } else if (isText && CONTENT_FIELD.test(key)) {
        findings.push({
          path: here,
          kind: "content",
          asks: "the logical name of the content with its hash and size (F100-FR-052)",
        });
      }
      walk(v, here);
    }
  };
  walk(record, "");
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * F100-FR-051: exactly one writing process per state file.
 * ------------------------------------------------------------------ */

/** A logical name whose `Writer` column names more than one process. */
export type WriterFinding = {
  readonly logicalName: string;
  readonly writers: readonly string[];
  readonly message: string;
};

/**
 * A part of a `Writer` cell that begins with one of these is a qualification
 * of the writer before it ("the job, through the engine"), not a second one.
 */
const QUALIFICATION = /^(through|on|at|in|for|by|after|with|from|when|where)\b/i;

/**
 * The consumer is not a process of the product: a file the consumer edits and
 * the CLI writes on request has one writing process, the CLI (annex B, §B.1).
 */
const NOT_A_PROCESS = /^(the )?consumer$/i;

/** The `Writer` cell of a name, split into the writing processes it names. */
export function writersOf(cell: string): readonly string[] {
  const head = cell.split("(")[0] ?? cell;
  return Object.freeze(
    head
      .split(/[,;]| and /)
      .map((w) => w.trim().replace(/\.$/, ""))
      .filter((w) => w !== "" && w !== "—")
      .filter((w) => !QUALIFICATION.test(w))
      .filter((w) => !NOT_A_PROCESS.test(w)),
  );
}

/** A writer that names the occasion on which it writes is sequenced, not concurrent. */
const SEQUENCED = /\s(at|for|when|after|before|on|during)\s/i;

/** The table of §B.5 as `oneWriter` reads it. */
export type LayoutForWriters = readonly { logicalName: string; root: string; writer: string }[];

/**
 * F100-FR-051 — fail when two processes write one logical name. A cell that
 * names two processes and says "one file per writer" is not a finding: each
 * process has its own file, which is what the rule asks for.
 */
export function oneWriter(layoutTable: LayoutForWriters = NAMES): readonly WriterFinding[] {
  const findings: WriterFinding[] = [];
  for (const row of layoutTable) {
    if (/one file per writer/i.test(row.writer)) continue;
    const writers = writersOf(row.writer);
    // A cell whose every part names the occasion on which that process writes
    // ("CLI at launch; engine for an accepted change") declares a handover in
    // time, not two processes writing at once (annex B, §B.5, §B.12).
    if (writers.length > 1 && writers.every((w) => SEQUENCED.test(w))) continue;
    if (writers.length > 1) {
      findings.push({
        logicalName: row.logicalName,
        writers,
        message:
          `the logical name "${row.logicalName}" names ${writers.length} writing processes ` +
          `(${writers.join(", ")}); every state file has exactly one (F100-FR-051)`,
      });
    }
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * F100-FR-050: `productVersions` of the run record.
 * ------------------------------------------------------------------ */

/** The rule of `productVersions`: one list, in the order of the engine starts. */
export type ProductVersions = readonly string[];

/**
 * The list as it stands after an engine start with `version` (F100-FR-050):
 * the version that started the run first, then the version of every later
 * engine start. The list keeps every start, so that a difference is visible.
 */
export function appendProductVersion(
  productVersions: ProductVersions | undefined,
  version: string,
): ProductVersions {
  return Object.freeze([...(productVersions ?? []), version]);
}

/** What a reader of `productVersions` reports (F100-FR-050). */
export type ProductVersionDifference = {
  /** The version that started the run. */
  readonly startedWith: string;
  /** The version of the newest engine start. */
  readonly now: string;
  /** True when they differ: an event is recorded and the doctor shows it. */
  readonly differs: boolean;
  /** The event the engine emits on a difference. */
  readonly event: "run.product-version-changed";
  /** The doctor shows the difference (F100-FR-050). */
  readonly shownByDoctor: boolean;
};

/** Read `productVersions` of a run record (F100-FR-050). */
export function productVersionDifference(
  productVersions: ProductVersions,
): ProductVersionDifference | undefined {
  if (productVersions.length === 0) return undefined;
  const startedWith = productVersions[0] as string;
  const now = productVersions[productVersions.length - 1] as string;
  const differs = startedWith !== now;
  return Object.freeze({
    startedWith,
    now,
    differs,
    event: "run.product-version-changed" as const,
    shownByDoctor: differs,
  });
}
