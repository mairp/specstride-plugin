/**
 * T005 — the data of feature 123, loaded and validated against its schema at
 * load (F123-FR-010 context; the data files of `packages/pipeline/data/`).
 *
 * The data files are a copy of the contract data of
 * `specs/123-pipeline-runtime-and-supervisor/contracts/`:
 *
 * - `relaunch-observe.table.json` and `relaunch-root.table.json`, each
 *   validated against `specs/123-pipeline-runtime-and-supervisor/contracts/
 *   schemas/relaunch-table.schema.json`, the schema of a classifier table of
 *   annex X §X.3 — the only schema `contracts/schemas/` holds;
 * - `lines.json`, written from `pipeline-lines.json` (§R.2) and
 *   `supervise-verbs.json` (§R.7), validated against
 *   `packages/pipeline/data/schemas/lines.schema.json`;
 * - `stage-kinds.json`, written from the lists `stageKinds` and
 *   `preconditionChecks` of `contracts/closed-sets.json` (§R.3), validated
 *   against `packages/pipeline/data/schemas/stage-kinds.schema.json`.
 *
 * Validation is at load: a file that does not match its schema throws a
 * `DataLoadError` before the caller sees any value. The two tables are then
 * loaded through the kernel's table evaluator (`loadTable`), which runs the
 * structural refusals of annex X §X.3, so the executor evaluates them with
 * the one evaluator of the product.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTable, TableLoadError, type LoadedTable } from "@specstride/kernel";
import { toKernelTableJson } from "../relaunch/root-table.ts";

/** The compact-to-kernel predicate conversion, under one name for the reader. */
const relaunchTables = { toKernelTableJson };

/** The directory that holds the data files of this package. */
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

/** The schema of a classifier table, read from the contracts of feature 123. */
const RELAUNCH_TABLE_SCHEMA_PATH = resolve(
  DATA_DIR,
  "..",
  "..",
  "..",
  "specs",
  "123-pipeline-runtime-and-supervisor",
  "contracts",
  "schemas",
  "relaunch-table.schema.json",
);

/** A data file that does not match its schema, or a table the load refuses. */
export class DataLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataLoadError";
  }
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new DataLoadError(`cannot read the data file ${path}: ${String(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DataLoadError(`the data file ${path} is not JSON: ${String(error)}`);
  }
}

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  uniqueItems?: boolean;
  minItems?: number;
  minLength?: number;
  const?: unknown;
  enum?: unknown[];
};

/**
 * Validate a JSON value against the subset of JSON Schema the schemas of
 * this feature use (`type`, `required`, `properties`, `additionalProperties`,
 * `items`, `uniqueItems`, `minItems`, `minLength`, `const`, `enum`). Pure.
 */
export function validateAgainstSchema(schema: Schema, value: unknown, at = "$"): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${at}: expected an object`];
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${at}: the required key ${key} is missing`);
    }
    for (const [key, subschema] of Object.entries(schema.properties ?? {})) {
      if (key in record)
        errors.push(...validateAgainstSchema(subschema, record[key], `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in (schema.properties ?? {}))) {
          errors.push(`${at}: the key ${key} is not in the schema`);
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${at}: expected a list`];
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: holds ${value.length} items, at least ${schema.minItems} are required`);
    }
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    ) {
      errors.push(`${at}: the items are not unique`);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        errors.push(...validateAgainstSchema(schema.items as Schema, item, `${at}[${index}]`)),
      );
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") return [`${at}: expected text`];
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength} characters`);
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: expected the literal ${JSON.stringify(schema.const)}`);
  }
  if (
    schema.enum !== undefined &&
    !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
  ) {
    errors.push(`${at}: ${JSON.stringify(value)} is outside the closed set`);
  }
  return errors;
}

function validated<T>(path: string, schemaPath: string): T {
  const value = readJson(path);
  const schema = readJson(schemaPath) as Schema;
  const errors = validateAgainstSchema(schema, value);
  if (errors.length > 0) {
    throw new DataLoadError(`the data file ${path} is invalid against ${schemaPath}: ${errors[0]}`);
  }
  return value as T;
}

function table(name: string): LoadedTable {
  const path = join(DATA_DIR, name);
  const raw = validated<Record<string, unknown>>(path, RELAUNCH_TABLE_SCHEMA_PATH);
  // The data files hold the compact contract form of a predicate (one
  // operator key; a pair `[signal, value]` for the comparison operators);
  // the kernel's evaluator takes the predicate records of annex X §X.3.
  const { toKernelTableJson } = relaunchTables;
  try {
    return loadTable(toKernelTableJson(raw));
  } catch (error) {
    if (error instanceof TableLoadError) throw new DataLoadError(error.message);
    throw error;
  }
}

/** The lines table of §R.2 and §R.7 (`lines.json`). */
export type LinesData = {
  schema: string;
  mode: string;
  pipelineLines: Array<{ line: string; when: string; stream: string; hue: string }>;
  superviseVerbs: Array<{ verb: string; does: string; exit: string }>;
  /** The four labels of `supervise` (F123-FR-039), as the line table holds them. */
  superviseLabels?: Array<{ line: string }>;
};

/** The members of the two open registries of EP-19, Wave 1 (`stage-kinds.json`). */
export type StageKindsData = {
  schema: string;
  stageKinds: string[];
  preconditionChecks: string[];
};

/** Load and validate the table `relaunch-observe` (table 1, §R.6). */
export function loadRelaunchObserveTable(): LoadedTable {
  return table("relaunch-observe.table.json");
}

/** Load and validate the table `relaunch-root` (table 2, §R.6). */
export function loadRelaunchRootTable(): LoadedTable {
  return table("relaunch-root.table.json");
}

/** Load and validate the line table (`lines.json`). */
export function loadLines(): LinesData {
  return validated<LinesData>(
    join(DATA_DIR, "lines.json"),
    join(DATA_DIR, "schemas", "lines.schema.json"),
  );
}

/** Load and validate the Wave 1 members of the two registries (`stage-kinds.json`). */
export function loadStageKinds(): StageKindsData {
  return validated<StageKindsData>(
    join(DATA_DIR, "stage-kinds.json"),
    join(DATA_DIR, "schemas", "stage-kinds.schema.json"),
  );
}
