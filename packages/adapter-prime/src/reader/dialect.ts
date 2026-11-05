/**
 * The dialect table of the JSONL reader (T007; covers F138-FR-023 and
 * F138-FR-024).
 *
 * One reader serves a family of harnesses; what differs per harness is a row
 * of this table (`specstride.stream-dialect/1`, feature 100 annex C §C.5).
 * The rows are data under `packages/adapter-prime/data/dialects/`, one file
 * per row, each checked against the stream-dialect-row schema of feature 100
 * at load. The table is built from the data directory: no row name is written
 * in this module, so the reader never branches on a dialect name (T010 proves
 * that). A dialect name the table does not hold refuses the stream.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "@specstride/contracts/records/compile";

/** The schema id of a row of the dialect table (`specstride.stream-dialect/1`). */
export const DIALECT_ROW_SCHEMA_ID = "specstride.stream-dialect/1";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The package data directory that holds one dialect row per JSON file. */
export const DIALECTS_DATA_DIR = join(HERE, "..", "..", "data", "dialects");

/** One row of the dialect table, validated (`specstride.stream-dialect/1`). */
export type DialectRow = {
  schema: string;
  dialect: string;
  schemaVersions: number[];
  providerFormat: string;
  telemetryOff: Record<string, unknown>;
  sessionControl: Record<string, unknown>;
  extraRecords: Record<string, unknown>;
  usageNames: Record<string, unknown>;
  terminalDecides: boolean;
  [key: string]: unknown;
};

/** One refusal to load a dialect row: the schema errors of the check. */
export class DialectRowRefusedError extends Error {
  readonly errors: { keyword: string; path: string; message: string }[];
  constructor(errors: { keyword: string; path: string; message: string }[]) {
    super(
      `the dialect row does not satisfy ${DIALECT_ROW_SCHEMA_ID}: ` +
        errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    );
    this.name = "DialectRowRefusedError";
    this.errors = errors;
  }
}

/**
 * One refusal of a stream whose dialect the table does not hold: the stream
 * is refused, not guessed (F138-FR-023).
 */
export class DialectUnknownError extends Error {
  readonly dialect: string;
  readonly known: readonly string[];
  constructor(dialect: string, known: readonly string[]) {
    super(
      `unknown stream dialect ${JSON.stringify(dialect)}: the dialect table ` +
        `holds [${known.join(", ")}]; the stream is refused`,
    );
    this.name = "DialectUnknownError";
    this.dialect = dialect;
    this.known = known;
  }
}

/** Read and validate a dialect row from a path. */
export function loadDialectRow(path: string): DialectRow {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseDialectRow(value);
}

/** Validate a dialect row already parsed from data. */
export function parseDialectRow(value: unknown): DialectRow {
  const result = validate(DIALECT_ROW_SCHEMA_ID, value);
  if (!result.ok) throw new DialectRowRefusedError(result.errors);
  return result.record as DialectRow;
}

/**
 * The dialect table, built from the data directory, keyed by the dialect name
 * each row itself carries. A third harness of the family adds a file and no
 * code.
 */
function buildTable(): Readonly<Record<string, DialectRow>> {
  const table: Record<string, DialectRow> = {};
  for (const entry of readdirSync(DIALECTS_DATA_DIR).sort()) {
    if (!entry.endsWith(".json")) continue;
    const row = loadDialectRow(join(DIALECTS_DATA_DIR, entry));
    if (table[row.dialect] !== undefined) {
      throw new Error(`duplicate dialect row for ${row.dialect} in ${DIALECTS_DATA_DIR}`);
    }
    table[row.dialect] = row;
  }
  return table;
}

export const dialectTable: Readonly<Record<string, DialectRow>> = buildTable();

/** The names the table holds, in file order. */
export function dialectNames(): readonly string[] {
  return Object.keys(dialectTable);
}

/**
 * Register one dialect row with the table (feature 134 T028). Another
 * adapter of the family hands over its row as data, re-validated here
 * against the same schema; the table gains the row and no code changes. A
 * dialect the table already holds is refused, as a duplicate file is. The
 * function is generic in the row: no dialect name is written here, so the
 * reader keeps no branch for any harness.
 */
export function registerDialectRow(row: unknown): DialectRow {
  const parsed = parseDialectRow(row);
  if (dialectTable[parsed.dialect] !== undefined) {
    throw new Error(`duplicate dialect row for ${parsed.dialect}: the table already holds it`);
  }
  (dialectTable as Record<string, DialectRow>)[parsed.dialect] = parsed;
  return parsed;
}

/** Read, validate and register the dialect row at a path. */
export function registerDialectRowFile(path: string): DialectRow {
  return registerDialectRow(loadDialectRow(path));
}

/** The row of a dialect name; `undefined` when the table does not hold it. */
export function dialectRowFor(dialect: string): DialectRow | undefined {
  return dialectTable[dialect];
}

/**
 * The row of a dialect name; a name the table does not hold refuses the
 * stream with `DialectUnknownError` (F138-FR-023).
 */
export function requireDialectRow(dialect: string): DialectRow {
  const row = dialectTable[dialect];
  if (row === undefined) throw new DialectUnknownError(dialect, dialectNames());
  return row;
}
