/**
 * The check of a document of this feature against one of the two schema files
 * the package ships in `data/` (T002): `plan-output.schema.json` and
 * `verification-commands.schema.json`, byte-for-byte copies of
 * `specs/108-reverse/contracts/`.
 *
 * Why a checker here and not the record validator of `@specstride/contracts`:
 * that validator is keyed by the `schema` field of a record and by the schema
 * map of annex B §B.4, and neither of these two documents is a record of annex
 * B — their ids are `urn:specstride:schema:internal:108:...`. The package may
 * import contracts, kernel and spec-formats and nothing else (layer L6), so
 * the one JSON-schema library of the workspace is out of reach. This module is
 * therefore a reader of the keywords THESE TWO FILES use, and nothing wider:
 * `type`, `required`, `properties`, `items`, `enum`, `const`, `pattern` and
 * `additionalProperties`. A schema file that grows a keyword this reader does
 * not know fails loudly instead of passing silently.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The `data/` directory of this package, where T002 put the two schemas. */
export const DATA_DIRECTORY = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "data",
);

/** The keywords this reader knows; any other keyword of a schema is an error. */
export const KNOWN_KEYWORDS = Object.freeze([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "const",
  "pattern",
  "additionalProperties",
] as const);

/** A keyword of a schema file that this reader does not know. */
export class UnknownSchemaKeywordError extends Error {
  readonly keywords: readonly string[];
  constructor(file: string, keywords: readonly string[]) {
    super(
      `the schema ${file} uses ${keywords.length} keyword(s) this reader does not know: ` +
        `${keywords.join(", ")}; add them to KNOWN_KEYWORDS and to \`checkAgainstSchema\` ` +
        `before the schema is relied on`,
    );
    this.name = "UnknownSchemaKeywordError";
    this.keywords = Object.freeze([...keywords]);
  }
}

type Schema = Readonly<Record<string, unknown>>;

/** Read one of the shipped schemas by file name. */
export function readShippedSchema(fileName: string): Schema {
  const text = readFileSync(join(DATA_DIRECTORY, fileName), "utf8");
  return JSON.parse(text) as Schema;
}

/** Every keyword of a schema and of its subschemas, deduplicated and sorted. */
export function keywordsOf(schema: unknown): readonly string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      found.add(key);
      if (key === "properties") {
        for (const sub of Object.values(value as Record<string, unknown>)) walk(sub);
      } else if (key === "items" || key === "additionalProperties") {
        walk(value);
      }
    }
  };
  walk(schema);
  return Object.freeze([...found].sort());
}

/**
 * The keywords of a schema this reader does not know. A schema file that grows
 * one must not be trusted by this reader, and the caller raises
 * `UnknownSchemaKeywordError`.
 */
export function unknownKeywordsOf(schema: unknown): readonly string[] {
  const known = new Set<string>(KNOWN_KEYWORDS);
  return Object.freeze(keywordsOf(schema).filter((keyword) => !known.has(keyword)));
}

/** One violation: where in the document, and what the schema asked for. */
export type SchemaViolation = {
  /** A JSON-pointer-like path into the document, `/commands/0/timeoutSec`. */
  readonly path: string;
  /** The keyword that was not satisfied. */
  readonly keyword: string;
  readonly message: string;
};

const typeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

const matchesType = (value: unknown, type: string): boolean => {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  if (type === "object") return actual === "object";
  return actual === type;
};

/**
 * Check a document against a schema. The return value is every violation, in
 * document order; an empty list means the document satisfies the schema.
 */
export function checkAgainstSchema(
  document: unknown,
  schema: Schema,
  path = "",
): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const at = (suffix: string): string => `${path}${suffix}`;

  const type = schema["type"];
  if (typeof type === "string" && !matchesType(document, type)) {
    violations.push({
      path: path === "" ? "/" : path,
      keyword: "type",
      message: `expected ${type}, found ${typeOf(document)}`,
    });
    return Object.freeze(violations);
  }

  const constant = schema["const"];
  if (constant !== undefined && document !== constant) {
    violations.push({
      path: path === "" ? "/" : path,
      keyword: "const",
      message: `expected ${JSON.stringify(constant)}, found ${JSON.stringify(document)}`,
    });
  }

  const choices = schema["enum"];
  if (Array.isArray(choices) && !choices.includes(document)) {
    violations.push({
      path: path === "" ? "/" : path,
      keyword: "enum",
      message: `${JSON.stringify(document)} is not one of ${JSON.stringify(choices)}`,
    });
  }

  const pattern = schema["pattern"];
  if (typeof pattern === "string" && typeof document === "string") {
    if (!new RegExp(pattern).test(document)) {
      violations.push({
        path: path === "" ? "/" : path,
        keyword: "pattern",
        message: `${JSON.stringify(document)} does not match ${pattern}`,
      });
    }
  }

  if (document !== null && typeof document === "object" && !Array.isArray(document)) {
    const record = document as Record<string, unknown>;
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(String(key) in record)) {
          violations.push({
            path: at(`/${String(key)}`),
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
        violations.push(...checkAgainstSchema(value, sub, at(`/${key}`)));
        continue;
      }
      const additional = schema["additionalProperties"];
      if (additional === false) {
        violations.push({
          path: at(`/${key}`),
          keyword: "additionalProperties",
          message: `the key ${key} is not allowed`,
        });
      } else if (additional !== undefined && typeof additional === "object") {
        violations.push(...checkAgainstSchema(value, additional as Schema, at(`/${key}`)));
      }
    }
  }

  if (Array.isArray(document)) {
    const items = schema["items"];
    if (items !== undefined && typeof items === "object") {
      document.forEach((value, index) => {
        violations.push(...checkAgainstSchema(value, items as Schema, at(`/${index}`)));
      });
    }
  }

  return Object.freeze(violations);
}

/**
 * Check a document against one of the two shipped schemas, by file name. It
 * refuses a schema that grew a keyword this reader does not know, so that a
 * widened contract can never be reported as satisfied.
 */
export function checkAgainstShippedSchema(
  document: unknown,
  fileName: string,
): readonly SchemaViolation[] {
  const schema = readShippedSchema(fileName);
  const unknown = unknownKeywordsOf(schema);
  if (unknown.length > 0) throw new UnknownSchemaKeywordError(fileName, unknown);
  return checkAgainstSchema(document, schema);
}

/** One line per violation, for a message. */
export function violationLines(violations: readonly SchemaViolation[]): string {
  return violations.map((v) => `${v.path}: ${v.keyword}: ${v.message}`).join("; ");
}
