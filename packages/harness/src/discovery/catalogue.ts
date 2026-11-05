/**
 * T023 — the reader of the catalogue (F146-FR-013, F146-FR-016; annex
 * B §B.5).
 *
 * The catalogue is a DATED SNAPSHOT of models with context windows,
 * output caps and prices, read OFFLINE. The product ships one under the
 * root `package`, at `data/catalogue/catalogue.snapshot.json`, and reads
 * it only under the logical name `package:catalogue`. A newer copy that
 * the consumer asked the CLI for stands at the logical name
 * `user:catalogue`; where one exists and validates, it replaces the
 * bundled snapshot. The catalogue is never fetched at launch (R20 open
 * question 5, D-1).
 *
 * EVERY read — bundled or user — is validated against the schema at
 * `data/catalogue.schema.json` (`$id`
 * `urn:specstride:schema:specstride.catalogue-snapshot/1`) before any
 * value of it is used. An invalid snapshot is refused whole, with a
 * finding: no entry of an invalid catalogue is ever read.
 *
 * The catalogue of EVENT types is feature 111's; this is the catalogue of
 * MODELS and it holds no event type.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CandidateFinding } from "./types.ts";

/** The requirement this module carries. */
export const CATALOGUE_REQUIREMENT = "F146-FR-016" as const;

/** The logical names of the catalogue (annex B §B.5). */
export const BUNDLED_CATALOGUE_LOGICAL_NAME = "package:catalogue" as const;
export const USER_CATALOGUE_LOGICAL_NAME = "user:catalogue" as const;

/** The schema the snapshot is validated against, on every read. */
export const CATALOGUE_SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "catalogue.schema.json",
);

/** The bundled snapshot, shipped under the root `package`. */
export const BUNDLED_CATALOGUE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "catalogue",
  "catalogue.snapshot.json",
);

/** The schema identifier of a snapshot. */
export const CATALOGUE_SNAPSHOT_SCHEMA = "specstride.catalogue-snapshot/1" as const;

/** One model of the catalogue. */
export type CatalogueModel = {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputCapTokens: number | null;
  readonly usdPerMillionInput: number | null;
  readonly usdPerMillionOutput: number | null;
  readonly note: string | null;
};

/** A catalogue that validated, with the logical name it was read under. */
export type Catalogue = {
  /** The date of the snapshot; every value of it is marked with it. */
  readonly date: string;
  /** `package:catalogue` or `user:catalogue` — never a physical path. */
  readonly logicalName: typeof BUNDLED_CATALOGUE_LOGICAL_NAME | typeof USER_CATALOGUE_LOGICAL_NAME;
  readonly models: Readonly<Record<string, CatalogueModel>>;
};

/** What a read answered. A refused catalogue comes back as null. */
export type CatalogueRead = {
  readonly catalogue: Catalogue | null;
  readonly findings: readonly CandidateFinding[];
};

/**
 * Validate `value` against a JSON Schema of the subset this feature
 * states: `type`, `const`, `enum`, `required`, `properties`, `items`,
 * `minimum`. The schema is read from disk by the caller; this function
 * holds no rule of the snapshot in code — the schema file is the rule.
 */
export function validateAgainstSchema(value: unknown, schema: unknown): readonly string[] {
  const reasons: string[] = [];
  validateNode(value, schema, "", reasons);
  return reasons;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

function validateNode(value: unknown, schema: unknown, at: string, reasons: string[]): void {
  if (typeof schema !== "object" || schema === null) return;
  const node = schema as Record<string, unknown>;
  const types = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
  if (
    types.length > 0 &&
    !types.some((expected) => typeof expected === "string" && typeMatches(value, expected))
  ) {
    reasons.push(
      `${at || "the snapshot"}: expected type ${types.join("|")}, found ${typeOf(value)}`,
    );
    return;
  }
  if (typeof node.const === "string" && value !== node.const) {
    reasons.push(`${at || "the snapshot"}: expected the constant ${JSON.stringify(node.const)}`);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    reasons.push(`${at || "the snapshot"}: outside the enumerated values`);
  }
  if (typeof node.minimum === "number" && typeof value === "number" && value < node.minimum) {
    reasons.push(`${at || "the snapshot"}: ${value} is below the minimum ${node.minimum}`);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const required = Array.isArray(node.required) ? (node.required as unknown[]) : [];
    for (const name of required) {
      if (typeof name === "string" && !(name in value)) {
        reasons.push(`${at || "the snapshot"}: the required field \`${name}\` is absent`);
      }
    }
    const properties =
      typeof node.properties === "object" && node.properties !== null
        ? (node.properties as Record<string, unknown>)
        : {};
    for (const [name, child] of Object.entries(value)) {
      if (name in properties) {
        validateNode(child, properties[name], at === "" ? name : `${at}.${name}`, reasons);
      }
    }
  }
  if (Array.isArray(value) && node.items !== undefined) {
    value.forEach((item, index) => {
      validateNode(item, node.items, `${at}[${index}]`, reasons);
    });
  }
}

/** Read one snapshot file, validate it, and build the catalogue. */
function readOne(path: string, logicalName: Catalogue["logicalName"]): CatalogueRead {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      catalogue: null,
      findings: [
        {
          code: "catalogue-unreadable",
          message: `catalogue ${logicalName}: not readable JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(CATALOGUE_SCHEMA_PATH, "utf8"));
  } catch (error) {
    return {
      catalogue: null,
      findings: [
        {
          code: "catalogue-schema-unreadable",
          message: `catalogue schema: not readable JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
  const reasons: string[] = [...validateAgainstSchema(raw, schema)];
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (reasons.length === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(String(record.date))) {
    reasons.push("date: not a date of the form YYYY-MM-DD — the snapshot must be dated");
  }
  if (reasons.length > 0) {
    return {
      catalogue: null,
      findings: [
        {
          code: "catalogue-invalid",
          message: `catalogue ${logicalName}: refused against the schema: ${reasons.join("; ")}`,
        },
      ],
    };
  }
  const models: Record<string, CatalogueModel> = {};
  for (const entry of record.models as readonly Record<string, unknown>[]) {
    const model = String(entry.model);
    models[model] = {
      model,
      contextWindowTokens: entry.contextWindowTokens as number,
      outputCapTokens: typeof entry.outputCapTokens === "number" ? entry.outputCapTokens : null,
      usdPerMillionInput:
        typeof entry.usdPerMillionInput === "number" ? entry.usdPerMillionInput : null,
      usdPerMillionOutput:
        typeof entry.usdPerMillionOutput === "number" ? entry.usdPerMillionOutput : null,
      note: typeof entry.note === "string" ? entry.note : null,
    };
  }
  return {
    catalogue: {
      date: String(record.date),
      logicalName,
      models: Object.freeze(models),
    },
    findings: [],
  };
}

/**
 * Read the bundled snapshot as `package:catalogue`, validated against the
 * schema. Where the read fails, the catalogue is null and one finding
 * names the reason; discovery never guesses a window from a broken
 * catalogue.
 */
export function readBundledCatalogue(path: string = BUNDLED_CATALOGUE_PATH): CatalogueRead {
  return readOne(path, BUNDLED_CATALOGUE_LOGICAL_NAME);
}

/**
 * Read the consumer's newer copy as `user:catalogue`, validated against
 * the schema. The physical path is handed in by the composition root; no
 * default path is built here. An invalid or unreadable user catalogue is
 * refused with a finding and never falls back silently — the caller
 * decides to read the bundled one instead, and the finding stays.
 */
export function readUserCatalogue(path: string): CatalogueRead {
  return readOne(path, USER_CATALOGUE_LOGICAL_NAME);
}

/**
 * Select the catalogue of a run: the consumer's copy at `user:catalogue`
 * where one exists and validates, else the bundled snapshot at
 * `package:catalogue`. A user copy that does not validate leaves the
 * finding in place AND falls back to the bundled snapshot: a broken
 * newer copy does not blind the product, and the finding says so.
 */
export function selectCatalogue(deps: {
  readonly userPath?: string;
  readonly bundledPath?: string;
}): CatalogueRead {
  const bundled = readBundledCatalogue(deps.bundledPath);
  if (deps.userPath === undefined) return bundled;
  const user = readUserCatalogue(deps.userPath);
  if (user.catalogue !== null) return user;
  return {
    catalogue: bundled.catalogue,
    findings: [...user.findings, ...bundled.findings],
  };
}

/**
 * The window (and the other stated values) of one model, marked with the
 * date of the snapshot it came from (the step `catalogue` of the ladder).
 * A model the catalogue does not name gives null — there is no default.
 */
export function catalogueEntryOf(
  catalogue: Catalogue | null,
  model: string,
): { readonly entry: CatalogueModel | null; readonly date: string | null } {
  if (catalogue === null) return { entry: null, date: null };
  const entry = catalogue.models[model];
  return entry === undefined ? { entry: null, date: null } : { entry, date: catalogue.date };
}
