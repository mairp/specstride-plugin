/**
 * T004 of feature 108 (phase 2, Foundational) — the ONE call that the plan and
 * the guard make into the inventory, and the reader of the inventory fields
 * they use.
 *
 * Feature 108 owns no walk. Group G-B of the original specification (the
 * inventory, the lint and the shipped templates) is feature 140, and the only
 * way into it is the CLI command `reverse inventory` of annex G §G.1
 * (`data-model.md`, "Relations"; `plan.md`, the summary). This module is that
 * seam, in two halves:
 *
 *  1. **the adapter** — `callReverseInventory` runs the CLI command
 *     `reverse inventory <SRC> --out <inventory> [--md <summary>]
 *     [--exclude <path>]...` as a process with a FIXED argument list and no
 *     shell (F140-FR-015), and then reads the file the command wrote back from
 *     the file system. The exit status is the one this module OBSERVED and the
 *     inventory is the bytes it READ: the command's own report of success is
 *     never the proof;
 *  2. **the reader** — `readInventory` reads a document by its path (the
 *     resolved location of the logical name `reverse:<slug>:inventory`, annex B
 *     §B.5) and through its schema `specstride.reverse-inventory/1` (annex B
 *     §B.20), refuses it as F108-FR-027 and F100-FR-049 say, and exposes the
 *     twelve fields of `READ_FIELDS` and nothing else.
 *
 * What the halves serve:
 *
 * | Requirement | What this module gives it |
 * |---|---|
 * | F108-FR-014 | The call that writes `reverse:<slug>:inventory` with the output directory, relative to the source, as its only exclusion, and `reverse:<slug>:inventory-summary` through `--md` |
 * | F108-FR-015 | `files`, `skipped`, `oversize`, `units`, `project` (languages, frameworks) and `specify` (the constitution) for the plan JSON |
 * | F108-FR-027 | `fingerprint`, `files`, `skipped`, `excludes`, `walk` as the guard's baseline, read by logical name and through the schema, with the two refusal messages |
 * | F108-FR-029 | `testautomation` as the baseline's snapshot |
 * | F108-FR-030 | `git_head` and `git_status`, and `walk` as the condition of the git checks |
 *
 * The rule of F100-FR-227 — "a feature that reads such a record MUST read it by
 * its logical name and through its schema, and MUST NOT depend on a field that
 * the owner's specification does not list" — is enforced at LOAD: the schema
 * id, the logical name and the owner are checked against the table of annex
 * B §B.20 through `@specstride/contracts`, and every field this module reads is
 * checked against `OWNER_LISTED_FIELDS`, the seventeen keys that F140-FR-021
 * lists. A field this module invents fails at import, not at run time.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import process from "node:process";
import { contentHash } from "@specstride/kernel/hasher";
import {
  holdsSchemaId,
  logicalNameOfSchemaId,
  majorOfSchemaId,
  ownerOf,
} from "@specstride/contracts/ids/further-schema-ids";
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";

/* ------------------------------------------------------------------------- *
 * The record: its schema id, its logical name and its owner
 * ------------------------------------------------------------------------- */

/** The schema id of the inventory document (annex B §B.20; F140-FR-021). */
export const INVENTORY_SCHEMA_ID = "specstride.reverse-inventory/1" as const;

/** The major of that id the guard and the plan know. Any other is refused. */
export const INVENTORY_SCHEMA_MAJOR = 1 as const;

/** The id without its major, for the refusal of an unknown major. */
export const INVENTORY_SCHEMA_NAME = "specstride.reverse-inventory" as const;

/** The logical name by which the baseline is read (annex B §B.5, §B.20). */
export const INVENTORY_LOGICAL_NAME = "reverse:<slug>:inventory" as const;

/** The logical name of the summary the call writes through `--md`. */
export const INVENTORY_SUMMARY_LOGICAL_NAME = "reverse:<slug>:inventory-summary" as const;

/** The feature that owns the fields of the record and ships its schema file. */
export const INVENTORY_OWNER = "140" as const;

/**
 * The seventeen keys F140-FR-021 lists for the document. This module may read
 * these and no others (F100-FR-227), and `READ_FIELDS` is checked against them
 * at load.
 */
export const OWNER_LISTED_FIELDS = Object.freeze([
  "schema",
  "schema_version",
  "files",
  "skipped",
  "src",
  "walk",
  "excludes",
  "limits",
  "totals",
  "oversize",
  "project",
  "git_head",
  "git_status",
  "testautomation",
  "specify",
  "units",
  "fingerprint",
] as const);

/**
 * The fields the plan and the guard use, in the order T004 names them. The
 * reader exposes exactly these twelve as `InventoryFields`.
 */
export const READ_FIELDS = Object.freeze([
  "fingerprint",
  "files",
  "skipped",
  "excludes",
  "walk",
  "git_head",
  "git_status",
  "testautomation",
  "oversize",
  "units",
  "project",
  "specify",
] as const);

/** One of the twelve fields of `READ_FIELDS`. */
export type ReadField = (typeof READ_FIELDS)[number];

/** The subset the plan reads for its JSON and its driver (F108-FR-014, F108-FR-015). */
export const PLAN_FIELDS: readonly ReadField[] = Object.freeze([
  "files",
  "skipped",
  "walk",
  "git_head",
  "oversize",
  "units",
  "project",
  "specify",
] as const);

/** The subset the guard reads as its baseline (F108-FR-027 to F108-FR-030). */
export const GUARD_FIELDS: readonly ReadField[] = Object.freeze([
  "fingerprint",
  "files",
  "skipped",
  "excludes",
  "walk",
  "git_head",
  "git_status",
  "testautomation",
] as const);

/** A field this module reads that the owner's specification does not list. */
export class InventoryFieldNotListedError extends Error {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(
      `F140-FR-021 does not list ${fields.length} field(s) that @specstride/reverse reads from ${INVENTORY_SCHEMA_ID}: ${fields.join(", ")}`,
    );
    this.name = "InventoryFieldNotListedError";
    this.fields = Object.freeze([...fields]);
  }
}

/** The record of annex B §B.20 does not hold the id, the name or the owner. */
export class InventoryRecordNotInTheTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryRecordNotInTheTableError";
  }
}

/** The fields of `READ_FIELDS` and `OWNER_LISTED_FIELDS` that do not agree. */
export function fieldsNotListedByTheOwner(): readonly string[] {
  const listed = new Set<string>(OWNER_LISTED_FIELDS);
  return Object.freeze(READ_FIELDS.filter((field) => !listed.has(field)));
}

/** What `@specstride/contracts` says the table of §B.20 holds for the record. */
export function recordDisagreesWithTheTable(): string | undefined {
  if (!holdsSchemaId(INVENTORY_SCHEMA_ID)) {
    return `annex B §B.20 does not hold the schema id ${INVENTORY_SCHEMA_ID}`;
  }
  if (majorOfSchemaId(INVENTORY_SCHEMA_ID) !== INVENTORY_SCHEMA_MAJOR) {
    return `the major of ${INVENTORY_SCHEMA_ID} is ${majorOfSchemaId(INVENTORY_SCHEMA_ID)}, not ${INVENTORY_SCHEMA_MAJOR}`;
  }
  if (logicalNameOfSchemaId(INVENTORY_SCHEMA_ID) !== INVENTORY_LOGICAL_NAME) {
    return `annex B §B.20 reads ${INVENTORY_SCHEMA_ID} by ${String(logicalNameOfSchemaId(INVENTORY_SCHEMA_ID))}, not by ${INVENTORY_LOGICAL_NAME}`;
  }
  if (ownerOf(INVENTORY_SCHEMA_ID) !== INVENTORY_OWNER) {
    return `annex B §B.20 names feature ${ownerOf(INVENTORY_SCHEMA_ID)} as owner of ${INVENTORY_SCHEMA_ID}, not ${INVENTORY_OWNER}`;
  }
  for (const name of [INVENTORY_LOGICAL_NAME, INVENTORY_SUMMARY_LOGICAL_NAME]) {
    if (!holdsLogicalName(name)) return `the layout table of annex B §B.5 does not hold ${name}`;
  }
  return undefined;
}

const disagreementAtLoad = recordDisagreesWithTheTable();
if (disagreementAtLoad !== undefined) {
  throw new InventoryRecordNotInTheTableError(disagreementAtLoad);
}
const notListedAtLoad = fieldsNotListedByTheOwner();
if (notListedAtLoad.length > 0) throw new InventoryFieldNotListedError(notListedAtLoad);

/* ------------------------------------------------------------------------- *
 * The shape of the document, as F140-FR-020 to F140-FR-024 list it
 * ------------------------------------------------------------------------- */

/** The walk mode the inventory reports (F140-FR-017). */
export type InventoryWalkMode = "git" | "walk";

/** A file entry of the inventory (F140-FR-020). */
export type InventoryFileEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly sha256: string;
  readonly language: string;
  readonly role: string;
  /** Present and true for a link that resolves inside the source. */
  readonly symlink?: boolean;
  /** The link target, for such an entry. */
  readonly target?: string;
};

/** Why an entry was skipped (F140-FR-020). */
export type InventorySkipReason = "binary" | "oversize" | "symlink-escape";

/** A skipped entry: it still carries `bytes` and `sha256`, so the guard sees it. */
export type InventorySkippedEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly reason: InventorySkipReason;
  /** The per-file limit, for the reason `oversize`. */
  readonly limit?: number;
};

/** A unit: a workspace package, or a top-level directory (F140-FR-023). */
export type InventoryUnit = {
  readonly path: string;
  readonly files: number;
  readonly bytes: number;
};

/** The project facts read from the manifests (F140-FR-022, F140-FR-023). */
export type InventoryProject = {
  readonly manifests?: readonly unknown[];
  readonly languages?: Readonly<Record<string, number>>;
  readonly frameworks?: readonly string[];
  readonly entry_points?: readonly unknown[];
  readonly workspaces?: readonly string[];
};

/** The Spec Kit facts of the source (F140-FR-024). */
export type InventorySpecify = {
  readonly present?: boolean;
  readonly constitution?: boolean;
  readonly templates?: boolean;
  readonly feature_json?: unknown;
  readonly spec_numbers?: readonly string[];
};

/**
 * The snapshot of the source's `testautomation/`: each regular non-link file
 * mapped to `[bytes, sha256]`, or null where the directory does not exist
 * (F140-FR-021). The walk never enters it; the guard compares it (F108-FR-029).
 */
export type InventoryTestAutomation = Readonly<Record<string, readonly [number, string]>> | null;

/** The per-file and total byte limits the inventory was built under. */
export type InventoryLimits = {
  readonly max_file_bytes?: number;
  readonly max_total_bytes?: number;
};

/** The counts of the inventory. */
export type InventoryTotals = {
  readonly files?: number;
  readonly skipped?: number;
  readonly text_bytes?: number;
  readonly lines?: number;
};

/**
 * The inventory document, with the seventeen keys of `OWNER_LISTED_FIELDS` and
 * no others.
 */
export type Inventory = {
  readonly schema: string;
  readonly schema_version: number;
  readonly files: readonly InventoryFileEntry[];
  readonly skipped: readonly InventorySkippedEntry[];
  readonly src: string;
  readonly walk: InventoryWalkMode;
  readonly excludes: readonly string[];
  readonly limits: InventoryLimits;
  readonly totals: InventoryTotals;
  readonly oversize: boolean;
  readonly project: InventoryProject;
  readonly git_head: string | null;
  readonly git_status: readonly string[] | null;
  readonly testautomation: InventoryTestAutomation;
  readonly specify: InventorySpecify;
  readonly units: readonly InventoryUnit[];
  readonly fingerprint: string;
};

/** The twelve fields of `READ_FIELDS`, projected out of a document. */
export type InventoryFields = {
  readonly fingerprint: string;
  readonly files: readonly InventoryFileEntry[];
  readonly skipped: readonly InventorySkippedEntry[];
  readonly excludes: readonly string[];
  readonly walk: InventoryWalkMode;
  readonly git_head: string | null;
  readonly git_status: readonly string[] | null;
  readonly testautomation: InventoryTestAutomation;
  readonly oversize: boolean;
  readonly units: readonly InventoryUnit[];
  readonly project: InventoryProject;
  readonly specify: InventorySpecify;
};

/* ------------------------------------------------------------------------- *
 * The errors and their messages (F108-FR-027, F108-FR-031; F140-FR-001)
 * ------------------------------------------------------------------------- */

/** The exit code of a refusal of the inventory (annex G §G.4; F140-FR-001). */
export const REFUSED_EXIT_CODE = 3 as const;

/** The exit code of a usage error, e.g. a guard called with no baseline. */
export const USAGE_EXIT_CODE = 2 as const;

/** Why a document was refused. Each reason is one line of F108-FR-027. */
export const REFUSALS = Object.freeze([
  "unreadable",
  "not-an-object",
  "missing-schema",
  "unknown-schema",
] as const);

/** One reason of `REFUSALS`. */
export type InventoryRefusal = (typeof REFUSALS)[number];

/**
 * An error of the inventory. F108-FR-031: an `InventoryError` in any verb is
 * written to standard error as `reverse: <message>` and exits 3.
 */
export class InventoryError extends Error {
  /** The code the verb exits with. */
  readonly exitCode: number;
  /** The document the error is about, where there is one. */
  readonly path: string | undefined;
  /** Which line of F108-FR-027 refused it, for output that is not compatibility output. */
  readonly refusal: InventoryRefusal | undefined;
  constructor(
    message: string,
    options: {
      readonly exitCode?: number;
      readonly path?: string;
      readonly refusal?: InventoryRefusal;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "InventoryError";
    this.exitCode = options.exitCode ?? REFUSED_EXIT_CODE;
    this.path = options.path;
    this.refusal = options.refusal;
  }
}

/** The call of the CLI command did not produce an inventory. */
export class InventoryCallError extends InventoryError {
  /** The argument list that was run, so that a failure can be reproduced. */
  readonly argv: readonly string[];
  /** The exit status of the command, or null where it never ran. */
  readonly status: number | null;
  /** What the command wrote to standard error, uncut. */
  readonly stderr: string;
  constructor(
    message: string,
    options: {
      readonly argv: readonly string[];
      readonly status: number | null;
      readonly stderr: string;
      readonly exitCode?: number;
      readonly cause?: unknown;
    },
  ) {
    super(message, { exitCode: options.exitCode, cause: options.cause });
    this.name = "InventoryCallError";
    this.argv = Object.freeze([...options.argv]);
    this.status = options.status;
    this.stderr = options.stderr;
  }
}

/** F108-FR-027 — a baseline that cannot be read. */
export function cannotReadInventoryMessage(path: string, error: string): string {
  return `cannot read inventory ${path}: ${error}`;
}

/**
 * F108-FR-027 — a document that is not an object with `fingerprint` and
 * `files`, and (in compatibility output) one whose `schema` is absent, unknown
 * or of another major, as F100-FR-049 says.
 */
export function notAnInventoryMessage(path: string): string {
  return `not an inventory: ${path}`;
}

/** F108-FR-031 — how an `InventoryError` reaches standard error. */
export function reverseErrorLine(message: string): string {
  return `reverse: ${message}`;
}

/** F140-FR-001 — the prefix the verb `inventory` writes on standard error. */
export const INVENTORY_ERROR_PREFIX = "reverse-inventory: " as const;

/**
 * The message of a failed call, taken from what the command wrote: the last
 * line that carries the prefix of F140-FR-001, with the prefix removed, else
 * the last non-empty line. Returns undefined when the command said nothing, so
 * that the caller can fall back to a message of its own.
 */
export function messageOfStandardError(stderr: string): string | undefined {
  const lines = stderr.split("\n").map((line) => line.trimEnd());
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  if (nonEmpty.length === 0) return undefined;
  for (let i = nonEmpty.length - 1; i >= 0; i -= 1) {
    const line = nonEmpty[i] as string;
    if (line.startsWith(INVENTORY_ERROR_PREFIX)) {
      return line.slice(INVENTORY_ERROR_PREFIX.length);
    }
  }
  return nonEmpty[nonEmpty.length - 1];
}

/* ------------------------------------------------------------------------- *
 * The reader
 * ------------------------------------------------------------------------- */

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * F108-FR-027 — the document is an object that holds `fingerprint` and
 * `files`. Exactly the baseline's test, and nothing beyond it.
 */
export function isAnInventoryDocument(document: unknown): boolean {
  return isObject(document) && "fingerprint" in document && "files" in document;
}

/**
 * Whether the field `schema` is one the reader knows: present, the id
 * `specstride.reverse-inventory`, and the major `1`. Returns the refusal, or
 * undefined where the schema is known (F100-FR-049; F140-FR-021).
 */
export function refusalOfSchema(schema: unknown): "missing-schema" | "unknown-schema" | undefined {
  if (schema === undefined || schema === null || schema === "") return "missing-schema";
  if (typeof schema !== "string") return "unknown-schema";
  const slash = schema.lastIndexOf("/");
  if (slash < 0) return "unknown-schema";
  if (schema.slice(0, slash) !== INVENTORY_SCHEMA_NAME) return "unknown-schema";
  const major = Number(schema.slice(slash + 1));
  if (!Number.isInteger(major) || major !== INVENTORY_SCHEMA_MAJOR) return "unknown-schema";
  return undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((item): item is string => typeof item === "string"));
}

function objectList<T>(value: unknown): readonly T[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((item) => isObject(item)) as T[]);
}

/**
 * Projects the twelve fields of `READ_FIELDS` out of a document that
 * `isAnInventoryDocument` accepted. An absent optional field becomes its empty
 * form — null for `git_head`, `git_status` and `testautomation`, false for
 * `oversize`, an empty list or map elsewhere — so that no reader of this seam
 * ever sees `undefined`. `walk` is `git` only where the document says `git`
 * exactly, which is the condition of the git checks of F108-FR-030.
 */
export function inventoryFieldsOf(document: Readonly<Record<string, unknown>>): InventoryFields {
  const testautomation = document["testautomation"];
  return Object.freeze({
    fingerprint: typeof document["fingerprint"] === "string" ? document["fingerprint"] : "",
    files: objectList<InventoryFileEntry>(document["files"]),
    skipped: objectList<InventorySkippedEntry>(document["skipped"]),
    excludes: stringList(document["excludes"]),
    walk: document["walk"] === "git" ? "git" : "walk",
    git_head: stringOrNull(document["git_head"]),
    git_status: Array.isArray(document["git_status"]) ? stringList(document["git_status"]) : null,
    testautomation: isObject(testautomation)
      ? (Object.freeze({ ...testautomation }) as InventoryTestAutomation)
      : null,
    oversize: document["oversize"] === true,
    units: objectList<InventoryUnit>(document["units"]),
    project: isObject(document["project"]) ? (document["project"] as InventoryProject) : {},
    specify: isObject(document["specify"]) ? (document["specify"] as InventorySpecify) : {},
  });
}

/** What the reader returns: the bytes it read, their hash, and the fields. */
export type ReadInventory = {
  /** The path that was read. */
  readonly path: string;
  /** How many bytes the document holds. */
  readonly bytes: number;
  /**
   * The content hash of the bytes as they lie on disk, from the canonical
   * hasher of annex X §X.5. A durable identity of the document, independent of
   * anything the writer reported.
   */
  readonly documentHash: string;
  /** The document itself. */
  readonly inventory: Inventory;
  /** Its fingerprint, the identity of the source the inventory was taken of. */
  readonly fingerprint: string;
  /** The twelve fields of `READ_FIELDS`. */
  readonly fields: InventoryFields;
};

/**
 * Reads a document that is already in memory. `path` is only used in the
 * messages, which are F108-FR-027's byte for byte.
 */
export function parseInventory(bytes: Uint8Array | string, path: string): ReadInventory {
  const text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (error) {
    throw new InventoryError(
      cannotReadInventoryMessage(path, error instanceof Error ? error.message : String(error)),
      { path, refusal: "unreadable", cause: error },
    );
  }
  if (!isAnInventoryDocument(document)) {
    throw new InventoryError(notAnInventoryMessage(path), { path, refusal: "not-an-object" });
  }
  const object = document as Readonly<Record<string, unknown>>;
  const schemaRefusal = refusalOfSchema(object["schema"]);
  if (schemaRefusal !== undefined) {
    throw new InventoryError(notAnInventoryMessage(path), { path, refusal: schemaRefusal });
  }
  const fields = inventoryFieldsOf(object);
  return Object.freeze({
    path,
    bytes: Buffer.byteLength(text),
    documentHash: contentHash(text),
    inventory: object as unknown as Inventory,
    fingerprint: fields.fingerprint,
    fields,
  });
}

/**
 * Reads the baseline inventory from the file system: the resolved location of
 * the logical name `reverse:<slug>:inventory`, through the schema
 * `specstride.reverse-inventory/1`. A read that fails gives
 * `cannot read inventory <path>: <error>`; a document that is not an object
 * with `fingerprint` and `files`, and one whose `schema` is absent, unknown or
 * of another major, gives `not an inventory: <path>`; both exit 3
 * (F108-FR-027, F100-FR-049).
 */
export function readInventory(path: string): ReadInventory {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new InventoryError(
      cannotReadInventoryMessage(path, error instanceof Error ? error.message : String(error)),
      { path, refusal: "unreadable", cause: error },
    );
  }
  return parseInventory(bytes, path);
}

/* ------------------------------------------------------------------------- *
 * The fields, as the plan and the guard ask for them
 * ------------------------------------------------------------------------- */

/** The file entries by path, for the guard's comparison (F108-FR-027). */
export function fileEntriesByPath(
  fields: InventoryFields,
): ReadonlyMap<string, InventoryFileEntry> {
  const byPath = new Map<string, InventoryFileEntry>();
  for (const entry of fields.files)
    if (typeof entry.path === "string") byPath.set(entry.path, entry);
  return byPath;
}

/** The skipped entries by path: a changed binary or oversize file is a change too. */
export function skippedEntriesByPath(
  fields: InventoryFields,
): ReadonlyMap<string, InventorySkippedEntry> {
  const byPath = new Map<string, InventorySkippedEntry>();
  for (const entry of fields.skipped) {
    if (typeof entry.path === "string") byPath.set(entry.path, entry);
  }
  return byPath;
}

/** True where the baseline was walked in git mode, the condition of F108-FR-030. */
export function wasWalkedInGitMode(fields: InventoryFields): boolean {
  return fields.walk === "git";
}

/** The languages of `project`, for the plan's summary (F108-FR-015). */
export function languagesOf(fields: InventoryFields): Readonly<Record<string, number>> {
  const languages = fields.project.languages;
  return languages === undefined ? Object.freeze({}) : languages;
}

/** The frameworks of `project`, for the plan's summary (F108-FR-015). */
export function frameworksOf(fields: InventoryFields): readonly string[] {
  return fields.project.frameworks ?? Object.freeze([]);
}

/** The count of units, which is what the plan's summary carries (F108-FR-015). */
export function unitCountOf(fields: InventoryFields): number {
  return fields.units.length;
}

/**
 * The plan's `constitution`: `existing` where the source already has one, else
 * `to be written` (F108-FR-014, F108-FR-015). Read from `specify`.
 */
export function constitutionOf(fields: InventoryFields): "existing" | "to be written" {
  return fields.specify.constitution === true ? "existing" : "to be written";
}

/* ------------------------------------------------------------------------- *
 * The adapter: the CLI command `reverse inventory`
 * ------------------------------------------------------------------------- */

/** The command of annex G §G.1 this seam calls. */
export const COMMAND = "reverse" as const;

/** Its verb, which feature 140 owns (annex G §G.1; F140-FR-015). */
export const VERB = "inventory" as const;

/** The command as the annex writes it, for a message or a dry-run line. */
export const INVENTORY_COMMAND = `${COMMAND} ${VERB}` as const;

/** The flags of `reverse inventory` (F140-FR-015). */
export const FLAGS = Object.freeze({
  /** Where to write the inventory. */
  out: "--out",
  /** Also write the summary there. */
  md: "--md",
  /** A source-relative path never walked; repeatable. */
  exclude: "--exclude",
} as const);

/** The name of the product's executable, where the caller names none. */
export const DEFAULT_EXECUTABLE = "specstride" as const;

/**
 * The spawn options that are fixed for the call: no shell, a fixed argument
 * list, standard input closed, both streams captured.
 */
export const FIXED_SPAWN_OPTIONS = Object.freeze({
  shell: false as const,
  stdio: Object.freeze(["ignore", "pipe", "pipe"] as const),
  encoding: "utf8" as const,
});

/** How long the call may take before it is given up on. */
export const DEFAULT_TIMEOUT_SEC = 300;

/**
 * Normalises exclusions the way F140-FR-017 says the inventory does: the
 * leading and trailing `/` stripped, de-duplicated, sorted by code point. The
 * call sends them already normalised, so that two plans over one tree build the
 * same argument list.
 */
export function normalisedExcludes(excludes: readonly string[] = []): readonly string[] {
  const seen = new Set<string>();
  for (const raw of excludes) {
    const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmed !== "") seen.add(trimmed);
  }
  return Object.freeze([...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** What the plan hands the adapter. */
export type InventoryCall = {
  /** The source directory, the positional argument of the verb. */
  readonly src: string;
  /** Where the inventory goes: the location of `reverse:<slug>:inventory`. */
  readonly out: string;
  /** Where the summary goes: the location of `reverse:<slug>:inventory-summary`. */
  readonly md?: string;
  /**
   * The exclusions. F108-FR-014: at `plan` this is the output directory,
   * relative to the source, and nothing else.
   */
  readonly excludes?: readonly string[];
  /** The product's executable; `DEFAULT_EXECUTABLE` where none is named. */
  readonly executable?: string;
  /** Arguments before the command, e.g. a script path for a `node` executable. */
  readonly prefixArgs?: readonly string[];
  /** The working directory of the call. */
  readonly cwd?: string;
  /** An overlay on the environment, never a replacement for it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The time limit, in seconds. */
  readonly timeoutSec?: number;
  /** The runner, for a test that needs no process. */
  readonly run?: InventoryCallRunner;
};

/** What a runner reports back. The exit status is observed, never declared. */
export type InventoryCallRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set where the process could not be started or was ended by the limit. */
  readonly error?: Error;
};

/** The seam a test replaces to run the call without a process. */
export type InventoryCallRunner = (
  executable: string,
  argv: readonly string[],
  options: {
    readonly cwd: string | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly timeoutSec: number;
  },
) => InventoryCallRun;

/**
 * The argument list of the call: `reverse inventory <SRC> --out <inventory>`,
 * then `--md <summary>` where a summary is wanted, then one `--exclude <path>`
 * per normalised exclusion (F140-FR-015). A fixed list, in a fixed order, so
 * that the dry run of F108-FR-005 can print it and the oracle can compare it.
 */
export function inventoryArgv(call: InventoryCall): readonly string[] {
  const argv: string[] = [...(call.prefixArgs ?? []), COMMAND, VERB, call.src, FLAGS.out, call.out];
  if (call.md !== undefined) argv.push(FLAGS.md, call.md);
  for (const exclude of normalisedExcludes(call.excludes)) argv.push(FLAGS.exclude, exclude);
  return Object.freeze(argv);
}

/** The default runner: one process, no shell, the fixed argument list. */
export const spawnRunner: InventoryCallRunner = (executable, argv, options) => {
  const result = spawnSync(executable, [...argv], {
    ...FIXED_SPAWN_OPTIONS,
    stdio: [...FIXED_SPAWN_OPTIONS.stdio],
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    timeout: options.timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
};

/** What the adapter gives the plan back. */
export type InventoryCallResult = {
  /** The executable that was run. */
  readonly executable: string;
  /** The argument list it was run with. */
  readonly argv: readonly string[];
  /** The exit status that was OBSERVED. */
  readonly exitCode: number;
  /** The absolute path the command printed (F140-FR-015). */
  readonly printedPath: string;
  /** What the command wrote to standard error, kept for a message. */
  readonly stderr: string;
  /** The inventory, READ BACK from the path and through its schema. */
  readonly read: ReadInventory;
};

/**
 * The adapter. Runs the CLI command `reverse inventory` as a process, then
 * READS the file it wrote and validates it through its schema, and returns
 * both the observed exit status and the content hash of the bytes on disk. The
 * command's own report of success never stands on its own: a status of 0 with
 * no readable inventory at the path is an `InventoryCallError`, so a
 * successful-looking response without a durable effect is refused.
 */
export function callReverseInventory(call: InventoryCall): InventoryCallResult {
  const executable = call.executable ?? DEFAULT_EXECUTABLE;
  const argv = inventoryArgv(call);
  const run = call.run ?? spawnRunner;
  const outcome = run(executable, argv, {
    cwd: call.cwd,
    env: call.env ?? {},
    timeoutSec: call.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
  });
  const stderr = outcome.stderr;
  if (outcome.error !== undefined || outcome.status === null) {
    const detail =
      messageOfStandardError(stderr) ??
      (outcome.error === undefined ? "the command did not end" : outcome.error.message);
    throw new InventoryCallError(`${INVENTORY_COMMAND} did not run: ${detail}`, {
      argv,
      status: outcome.status,
      stderr,
      cause: outcome.error,
    });
  }
  if (outcome.status !== 0) {
    const detail =
      messageOfStandardError(stderr) ?? `${INVENTORY_COMMAND} exited ${outcome.status}`;
    throw new InventoryCallError(detail, {
      argv,
      status: outcome.status,
      stderr,
      // F140-FR-001: as an internal call the verb returns its own code; a
      // usage error stays 2, every other failure is the 3 of F108-FR-031.
      exitCode: outcome.status === USAGE_EXIT_CODE ? USAGE_EXIT_CODE : REFUSED_EXIT_CODE,
    });
  }
  const printedPath = printedInventoryPath(outcome.stdout);
  if (printedPath === undefined) {
    throw new InventoryCallError(`${INVENTORY_COMMAND} printed no inventory path for ${call.src}`, {
      argv,
      status: outcome.status,
      stderr,
    });
  }
  // Both paths are made absolute against the working directory of the CALL,
  // which is where the command resolved its own `--out`, and not against the
  // directory this process happens to stand in.
  const base = call.cwd ?? process.cwd();
  const wanted = resolvePath(base, call.out);
  if (resolvePath(base, printedPath) !== wanted) {
    throw new InventoryCallError(`${INVENTORY_COMMAND} wrote ${printedPath}, not ${wanted}`, {
      argv,
      status: outcome.status,
      stderr,
    });
  }
  // The independent read path: the bytes on disk, through the schema. A
  // refusal of F108-FR-027 is raised from here, with its own message.
  const read = readInventory(wanted);
  return Object.freeze({
    executable,
    argv,
    exitCode: outcome.status,
    printedPath,
    stderr,
    read,
  });
}

/**
 * The absolute path the verb prints (F140-FR-015): the last non-empty line of
 * standard output, where it is absolute. Undefined where the command printed
 * nothing or printed no absolute path.
 */
export function printedInventoryPath(stdout: string): string | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines[lines.length - 1];
  if (last === undefined || !isAbsolute(last)) return undefined;
  return last;
}
