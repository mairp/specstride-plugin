/**
 * T024 of feature 140 — the INVENTORY DOCUMENT (F140-FR-021): the field
 * `schema`, the as-is field `schema_version`, the totals, `oversize`, the
 * fingerprint and the `testautomation` snapshot, validated against
 * `contracts/inventory.schema.json`.
 *
 * The document is the ground truth of a reverse run: the guard compares
 * against it, the plan quotes it, and the lint's `--baseline` resolves
 * citations against it. Three properties of it are therefore load-bearing:
 *
 *  1. **It is byte-identical across runs over the same tree** (F140-SC-003).
 *     It carries NO timestamp and no path of the machine beyond the source's
 *     own real path, every list is sorted by code point, and it is written
 *     through `serializeDocument` of `./serialize.ts`.
 *  2. **The `fingerprint` equals the baseline's.** It is the SHA-256 of the
 *     COMPACT, NON-ASCII-ESCAPED JSON of the sorted triples
 *     `(path, bytes, sha256)` over the files AND the skipped entries — a
 *     different serialization than the document's, which is why there are two
 *     (decision D-1 of `research.md`). The field `schema` is NO PART of it.
 *  3. **A reader refuses a document without `schema`.** The field carries
 *     `specstride.reverse-inventory/1` (annex B §B.20, F100-FR-227), and
 *     `schema_version` 1 stays beside it as the as-is field (register row
 *     DV-116). The key `schema` is the ONE difference of this document from
 *     the baseline's bytes, which is why a parity comparison removes it first.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contentHash } from "@specstride/kernel/hasher";

import type { FileEntry, SkippedEntry } from "./entries.ts";
import { classifyAll, readWithoutFollowing } from "./entries.ts";
import type { Limits } from "./limits.ts";
import { InventoryError, limitsOf } from "./limits.ts";
import type { SpecifyFacts } from "./project.ts";
import { readManifests, specifyFacts } from "./project.ts";
import type { JsonValue } from "./serialize.ts";
import {
  compareCodePoint,
  serializeDocument,
  serializeFingerprintInput,
  sortByCodePoint,
} from "./serialize.ts";
import type { ProjectFacts, Unit } from "./units.ts";
import { projectFactsOf, unitsOf } from "./units.ts";
import type { WalkMode } from "./walk.ts";
import { candidatePaths, gitHead, gitStatus, normalizeExcludes } from "./walk.ts";

/** The schema id of the inventory (annex B §B.20, F100-FR-227). */
export const INVENTORY_SCHEMA = "specstride.reverse-inventory/1" as const;

/** The as-is field the document keeps beside `schema` (DV-116). */
export const SCHEMA_VERSION = 1 as const;

/** The `$id` the schema file carries. */
export const INVENTORY_SCHEMA_ID = `urn:specstride:schema:${INVENTORY_SCHEMA}` as const;

/** The schema file of the inventory, copied into `data/` by T003. */
export const INVENTORY_SCHEMA_FILE = "inventory.schema.json" as const;

/** The `data/` directory of this package. */
export const DATA_DIRECTORY = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "data",
);

/** The directory whose files the document snapshots separately. */
export const TESTAUTOMATION_DIRECTORY = "testautomation" as const;

/** The totals the document records (F140-FR-021). */
export type Totals = {
  readonly files: number;
  readonly skipped: number;
  readonly text_bytes: number;
  readonly lines: number;
};

/** The inventory document (F140-FR-021). */
export type Inventory = {
  readonly schema: typeof INVENTORY_SCHEMA;
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly files: readonly FileEntry[];
  readonly skipped: readonly SkippedEntry[];
  readonly src: string;
  readonly walk: WalkMode;
  readonly excludes: readonly string[];
  readonly limits: Limits;
  readonly totals: Totals;
  readonly oversize: boolean;
  readonly project: ProjectFacts;
  readonly git_head: string | null;
  readonly git_status: readonly string[] | null;
  readonly testautomation: Readonly<Record<string, readonly [number, string]>> | null;
  readonly specify: SpecifyFacts;
  readonly units: readonly Unit[];
  readonly fingerprint: string;
};

/* ------------------------------------------------------------------------- *
 * The fingerprint (F140-FR-021)
 * ------------------------------------------------------------------------- */

/**
 * The fingerprint of a tree: the SHA-256 of the compact JSON list of the
 * sorted triples `(path, bytes, sha256)` over the files AND the skipped
 * entries (F140-FR-021).
 *
 * Both lists are in it on purpose: a binary, an oversize file and an escaping
 * link are not read as text but ARE hashed, so a change to one of them still
 * moves the fingerprint and is still caught by the guard (F140-FR-020).
 *
 * The serialization is `serializeFingerprintInput` — compact, with every
 * non-ASCII character escaped — and not the document's. A source with a
 * non-ASCII path would otherwise fingerprint differently from the baseline.
 */
export function fingerprintOf(
  files: readonly FileEntry[],
  skipped: readonly SkippedEntry[],
): string {
  const triples = [...files, ...skipped].map(
    (entry) => [entry.path, entry.bytes, entry.sha256] as const,
  );
  triples.sort((a, b) => compareCodePoint(a[0], b[0]));
  return contentHash(serializeFingerprintInput(triples as unknown as JsonValue));
}

/* ------------------------------------------------------------------------- *
 * The `testautomation` snapshot (F140-FR-021)
 * ------------------------------------------------------------------------- */

/**
 * The map from each REGULAR NON-LINK file under the source's
 * `testautomation/` to `[bytes, sha256]`, or null where the directory does not
 * exist (F140-FR-021).
 *
 * Why it is here at all: the walk DENIES `testautomation/`, so without this
 * snapshot a `testautomation/` left by an earlier run would look to the guard
 * like output the reverse run itself wrote.
 */
export function testautomationSnapshot(
  src: string,
): Readonly<Record<string, readonly [number, string]>> | null {
  const root = join(src, TESTAUTOMATION_DIRECTORY);
  try {
    if (!statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  const snapshot: Record<string, readonly [number, string]> = {};
  const visit = (directory: string): void => {
    let listing;
    try {
      listing = readdirSync(join(src, directory), { withFileTypes: true });
    } catch {
      return;
    }
    const names = sortByCodePoint(listing.map((child) => child.name));
    for (const name of names) {
      const relative = `${directory}/${name}`;
      const full = join(src, relative);
      let stat;
      try {
        stat = statSync(full, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (stat === undefined) continue;
      if (stat.isDirectory()) {
        // `os.walk` does not descend into a link to a directory.
        const child = listing.find((one) => one.name === name);
        if (child?.isSymbolicLink() === true) continue;
        visit(relative);
        continue;
      }
      const child = listing.find((one) => one.name === name);
      if (!stat.isFile() || child?.isSymbolicLink() === true) continue;
      try {
        const bytes = readWithoutFollowing(full);
        snapshot[relative] = Object.freeze([stat.size, contentHash(bytes)] as const);
      } catch {
        continue;
      }
    }
  };
  visit(TESTAUTOMATION_DIRECTORY);
  return Object.freeze(snapshot);
}

/* ------------------------------------------------------------------------- *
 * The document
 * ------------------------------------------------------------------------- */

/** What `buildInventory` was asked for. */
export type BuildInput = {
  /** The source tree. A path that is not a directory is invalid input. */
  readonly src: string;
  /** The `--exclude` paths, before normalisation. */
  readonly excludes?: readonly string[] | undefined;
  /** The environment the limits are read from; `process.env` by default. */
  readonly environ?: Readonly<Record<string, string | undefined>> | undefined;
};

/**
 * Build the inventory of a source (F140-FR-021). A source that is not a
 * directory fails with `source is not a directory: <src>` (F140-FR-015).
 *
 * `git_head` and `git_status` are read only in GIT mode; in the file-system
 * mode both are null, because a subdirectory of a repository would otherwise
 * report the whole repository's HEAD as if it were the source's.
 */
export function buildInventory(input: BuildInput): Inventory {
  const environ = input.environ ?? process.env;
  let isDirectory = false;
  try {
    isDirectory = statSync(input.src).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new InventoryError(`source is not a directory: ${input.src}`);
  const src = realpathSync(input.src);
  const limits = limitsOf(environ);
  const excludes = normalizeExcludes(input.excludes ?? []);
  const { paths, mode } = candidatePaths(src, excludes);
  const walked = classifyAll(src, paths, limits.max_file_bytes);
  const sweep = readManifests(src, walked.files);
  const project = projectFactsOf(src, walked.files, sweep);
  // In the file-system mode no git process is started at all: a
  // subdirectory of a repository must not report that repository's HEAD.
  const git =
    mode === "git" ? { head: gitHead(src), status: gitStatus(src) } : { head: null, status: null };
  return Object.freeze({
    schema: INVENTORY_SCHEMA,
    schema_version: SCHEMA_VERSION,
    files: walked.files,
    skipped: walked.skipped,
    src,
    walk: mode,
    excludes,
    limits,
    totals: Object.freeze({
      files: walked.files.length,
      skipped: walked.skipped.length,
      text_bytes: walked.textBytes,
      lines: walked.files.reduce((sum, entry) => sum + entry.lines, 0),
    }),
    oversize: walked.textBytes > limits.max_total_bytes,
    project,
    git_head: git.head,
    git_status: git.status,
    testautomation: testautomationSnapshot(src),
    specify: specifyFacts(src),
    units: unitsOf(walked.files, project.workspaces),
    fingerprint: fingerprintOf(walked.files, walked.skipped),
  });
}

/**
 * The document as bytes: sorted keys, one space of indentation, non-ASCII
 * characters kept as they are and a final line end (F140-FR-021).
 */
export function serializeInventory(inventory: Inventory): string {
  return serializeDocument(inventory as unknown as JsonValue);
}

/**
 * The document WITHOUT the key `schema` — the form a parity comparison uses,
 * because that key is the one difference from the baseline's bytes (DV-116,
 * rule N-29 of annex X §X.8, F141-FR-012).
 */
export function withoutTheSchemaKey(inventory: Inventory): Readonly<Record<string, JsonValue>> {
  const record = { ...(inventory as unknown as Record<string, JsonValue>) };
  delete record["schema"];
  return Object.freeze(record);
}

/* ------------------------------------------------------------------------- *
 * The validation against `contracts/inventory.schema.json`
 * ------------------------------------------------------------------------- */

/** The keywords `inventory.schema.json` uses, and the only ones read here. */
export const KNOWN_SCHEMA_KEYWORDS = Object.freeze([
  "$schema",
  "$id",
  "title",
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "const",
  "pattern",
] as const);

/** One way a document failed the schema. */
export type SchemaViolation = {
  /** A JSON pointer into the document. */
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
};

/** A keyword of the schema file this reader does not know. */
export class UnknownSchemaKeywordError extends Error {
  constructor(keywords: readonly string[]) {
    super(
      `${INVENTORY_SCHEMA_FILE} uses ${keywords.length} keyword(s) this reader does not know: ` +
        `${keywords.join(", ")}; teach \`checkAgainstInventorySchema\` before trusting it`,
    );
    this.name = "UnknownSchemaKeywordError";
  }
}

type Schema = Readonly<Record<string, unknown>>;

/** The shipped schema file, parsed. */
export function inventorySchema(dataDirectory: string = DATA_DIRECTORY): Schema {
  return JSON.parse(readFileSync(join(dataDirectory, INVENTORY_SCHEMA_FILE), "utf8")) as Schema;
}

/** The JSON type of a value, as a schema names it. */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  if (type === "integer") return actual === "integer";
  return actual === type;
}

/** Every keyword of the schema and of its subschemas. */
export function keywordsOf(schema: unknown): readonly string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      found.add(key);
      if (key === "properties") {
        for (const sub of Object.values(value as Record<string, unknown>)) walk(sub);
      } else if (key === "items") {
        walk(value);
      }
    }
  };
  walk(schema);
  return Object.freeze([...found].sort());
}

/**
 * Check a document against the inventory schema. The empty list means the
 * document satisfies it.
 *
 * This is a reader of the keywords THIS schema file uses and nothing wider —
 * the one JSON-schema library of the workspace is out of reach at layer L6.
 * It differs from `../plan/schema-check.ts` in one keyword that matters here:
 * `type` may be a LIST (`["string", "null"]` for `git_head`), which that
 * reader silently skips.
 */
export function checkAgainstInventorySchema(
  document: unknown,
  schema: Schema,
  path = "",
): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const here = path === "" ? "/" : path;

  const type = schema["type"];
  const types = typeof type === "string" ? [type] : Array.isArray(type) ? type.map(String) : [];
  if (types.length > 0 && !types.some((one) => matchesType(document, one))) {
    violations.push({
      path: here,
      keyword: "type",
      message: `expected ${types.join(" or ")}, found ${typeOf(document)}`,
    });
    return Object.freeze(violations);
  }

  if (schema["const"] !== undefined && document !== schema["const"]) {
    violations.push({
      path: here,
      keyword: "const",
      message: `expected ${JSON.stringify(schema["const"])}, found ${JSON.stringify(document)}`,
    });
  }

  const choices = schema["enum"];
  if (Array.isArray(choices) && !choices.includes(document)) {
    violations.push({
      path: here,
      keyword: "enum",
      message: `${JSON.stringify(document)} is not one of ${JSON.stringify(choices)}`,
    });
  }

  const pattern = schema["pattern"];
  if (
    typeof pattern === "string" &&
    typeof document === "string" &&
    !new RegExp(pattern).test(document)
  ) {
    violations.push({
      path: here,
      keyword: "pattern",
      message: `${JSON.stringify(document)} does not match ${pattern}`,
    });
  }

  if (Array.isArray(document)) {
    const items = schema["items"];
    if (items !== undefined && items !== null && typeof items === "object") {
      document.forEach((item, index) => {
        violations.push(...checkAgainstInventorySchema(item, items as Schema, `${path}/${index}`));
      });
    }
    return Object.freeze(violations);
  }

  if (document !== null && typeof document === "object") {
    const record = document as Record<string, unknown>;
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(String(key) in record)) {
          violations.push({
            path: `${path}/${String(key)}`,
            keyword: "required",
            message: `the key ${String(key)} is required and is absent`,
          });
        }
      }
    }
    const properties = (schema["properties"] ?? {}) as Record<string, Schema>;
    for (const [key, value] of Object.entries(record)) {
      const sub = properties[key];
      if (sub !== undefined) {
        violations.push(...checkAgainstInventorySchema(value, sub, `${path}/${key}`));
      }
    }
  }
  return Object.freeze(violations);
}

/**
 * Validate a document against `contracts/inventory.schema.json` as T003
 * copied it into `data/`, and throw where it does not satisfy it. The schema
 * file itself is checked first: a keyword this reader does not know fails
 * loudly instead of passing silently.
 */
export function validateInventory(document: unknown, dataDirectory: string = DATA_DIRECTORY): void {
  const schema = inventorySchema(dataDirectory);
  const known = new Set<string>(KNOWN_SCHEMA_KEYWORDS);
  const unknown = keywordsOf(schema).filter((keyword) => !known.has(keyword));
  if (unknown.length > 0) throw new UnknownSchemaKeywordError(unknown);
  if (schema["$id"] !== INVENTORY_SCHEMA_ID) {
    throw new InventoryError(
      `${INVENTORY_SCHEMA_FILE} carries the $id ${String(schema["$id"])}, not ${INVENTORY_SCHEMA_ID}`,
    );
  }
  const violations = checkAgainstInventorySchema(document, schema);
  if (violations.length > 0) {
    throw new InventoryError(
      `the inventory does not satisfy ${INVENTORY_SCHEMA}: ` +
        violations.map((one) => `${one.path} (${one.keyword}) ${one.message}`).join("; "),
    );
  }
}
