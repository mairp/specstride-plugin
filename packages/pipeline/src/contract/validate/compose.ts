/**
 * T005 — the composed validator of the launch contract (F107-FR-012).
 *
 * ONE schema is the validator, and it is COMPOSED, never copied:
 *
 * - the record schema `launch-contract.schema.json` and the record-level
 *   validator (`readLaunchContract`, the schema id check, the unknown
 *   top-level key, the ignored `x-` key) come from `@specstride/contracts`,
 *   where feature 100 generates them (T196). This module writes no rule of
 *   the record and edits no generated file;
 * - the item schemas of T003 (`src/contract/schemas/`, each with the `$id`
 *   `urn:specstride:schema:internal:107:<name>/1`) are JOINED BY REFERENCE:
 *   the composed schema holds the record schema verbatim and, at the six
 *   positions this feature owns, replaces the record schema's own words with
 *   a `$ref` to the item schema. Each rule therefore stands in exactly one
 *   of the schemas (F107-FR-012: no rule in two places) — the record schema
 *   owns the record-level rules, an item schema owns the rules of its item;
 * - the one post-schema rule is the rule of research.md row 14: the reads and
 *   writes of a verification command enter only under `configuration.scopes`
 *   with the provenance of closed set row 261 (`user-config`, `environment`,
 *   `flag`); a declaration whose source is the verification-plan source — or
 *   any source outside that closed set — is refused here and nowhere else.
 *
 * The composed validator is built on the one validator of the product, Ajv
 * draft 2020-12 (feature 100, research.md D-2), the same engine the
 * record-level validator of `@specstride/contracts` uses, so both readings of
 * the launch contract agree.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { launchContract } from "@specstride/contracts";
import {
  isLaunchContract,
  readLaunchContract,
} from "@specstride/contracts/records/launch-contract";
import { declarationSourceSet } from "../schemas/closed-sets.ts";
import { declarationSourceProblems } from "./declarations.ts";

/** The `$id` of the record schema of `@specstride/contracts` (feature 100). */
export const RECORD_SCHEMA_ID = "urn:specstride:schema:specstride.launch-contract/1" as const;

/** The schema id a launch contract carries in its field `schema` (F107-FR-012). */
export const LAUNCH_CONTRACT_SCHEMA_ID = launchContract.SCHEMA_ID;

/** The form of the `$id` of an item schema of this feature (T003, row 32). */
export function internalSchemaId(name: string): string {
  return `urn:specstride:schema:internal:107:${name}/1`;
}

/** The names of the six item schemas of T003 that the join references. */
export const ITEM_SCHEMA_NAMES = [
  "source",
  "inventory",
  "configuration",
  "coverage",
  "finding",
  "stage",
] as const;
export type ItemSchemaName = (typeof ITEM_SCHEMA_NAMES)[number];

/**
 * The positions of the record schema the join replaces with a `$ref`: the
 * property name in the record, and whether the reference lands on the array's
 * `items` (`"items"`) or on the property itself (`"self"`). `features` has no
 * item schema of this feature and keeps the record schema's own words.
 */
export const JOINED_POSITIONS: Readonly<
  Record<ItemSchemaName, { property: string; at: "items" | "self" }>
> = Object.freeze({
  source: { property: "sources", at: "items" },
  inventory: { property: "inventory", at: "self" },
  configuration: { property: "configuration", at: "self" },
  coverage: { property: "coverage", at: "items" },
  finding: { property: "findings", at: "items" },
  stage: { property: "stages", at: "items" },
});

// The schemas are read as MODULES, never by path at run time: the packed
// bundle of the CLI (one ESM file) inlines every module the graph imports,
// and a `readFileSync` of a source-tree path would look for a file the
// packed package does not carry (the item schemas of this package, the
// record schema of @specstride/contracts). The imports stand where the
// paths stood: the record schema verbatim from its package, the six item
// schemas from this package's `src/contract/schemas/`.
import recordSchemaFile from "@specstride/contracts/schemas/launch-contract.schema.json" with { type: "json" };
import sourceItemSchema from "../schemas/source.schema.json" with { type: "json" };
import inventoryItemSchema from "../schemas/inventory.schema.json" with { type: "json" };
import configurationItemSchema from "../schemas/configuration.schema.json" with { type: "json" };
import coverageItemSchema from "../schemas/coverage.schema.json" with { type: "json" };
import findingItemSchema from "../schemas/finding.schema.json" with { type: "json" };
import stageItemSchema from "../schemas/stage.schema.json" with { type: "json" };

/** The item schemas of T003 by name, as modules (inlined in the bundle). */
const ITEM_SCHEMAS: Readonly<Record<ItemSchemaName, Record<string, unknown>>> = Object.freeze({
  source: sourceItemSchema as Record<string, unknown>,
  inventory: inventoryItemSchema as Record<string, unknown>,
  configuration: configurationItemSchema as Record<string, unknown>,
  coverage: coverageItemSchema as Record<string, unknown>,
  finding: findingItemSchema as Record<string, unknown>,
  stage: stageItemSchema as Record<string, unknown>,
});

/** The record schema of `@specstride/contracts`, as a module (never edited). */
function recordSchema(): Record<string, unknown> {
  return recordSchemaFile as Record<string, unknown>;
}

/** One item schema of T003, from the module table. */
function itemSchema(name: ItemSchemaName): Record<string, unknown> {
  return ITEM_SCHEMAS[name];
}

/** A deep clone of `value` (the join never mutates the record schema). */
function clone(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : Array.isArray(value)
      ? value.map(clone)
      : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
}

/**
 * The composed schema: the record schema verbatim, with the six positions of
 * `JOINED_POSITIONS` replaced by `$ref`s to the item schemas of T003.
 */
export function composedSchema(): Record<string, unknown> {
  const root = clone(recordSchema()) as Record<string, unknown>;
  const properties = root.properties as Record<string, unknown>;
  for (const name of ITEM_SCHEMA_NAMES) {
    const { property, at } = JOINED_POSITIONS[name];
    const position = properties[property] as Record<string, unknown>;
    if (at === "items") {
      position.items = { $ref: internalSchemaId(name) };
    } else {
      properties[property] = { $ref: internalSchemaId(name) };
    }
  }
  return root;
}

let cached: ValidateFunction | undefined;

/**
 * The composed validator (F107-FR-012), built lazily and cached. The six item
 * schemas are registered under their `$id`s, so the `$ref`s of the composed
 * schema resolve to them.
 */
export function composedValidator(): ValidateFunction {
  if (cached === undefined) {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const name of ITEM_SCHEMA_NAMES) ajv.addSchema(itemSchema(name), internalSchemaId(name));
    cached = ajv.compile(composedSchema());
  }
  return cached;
}

/** One error of the composed validator. */
export type ComposedError = {
  readonly keyword: string;
  readonly path: string;
  readonly message: string;
  /** The member an `additionalProperties` refusal names (T064, the class table). */
  readonly property?: string | undefined;
};

/** The result of the composed validation. */
export type ComposedResult =
  | { readonly ok: true; readonly record: Record<string, unknown> }
  | { readonly ok: false; readonly errors: readonly ComposedError[] };

/** The composed validation of one launch contract (schema level). */
export function validateComposed(value: unknown): ComposedResult {
  const validate = composedValidator();
  if (validate(value)) return { ok: true, record: value as Record<string, unknown> };
  const errors = (validate.errors ?? []).map((error: ErrorObject) => ({
    keyword: error.keyword,
    path: error.instancePath,
    message: error.message ?? "",
    property:
      typeof (error.params as { additionalProperty?: unknown }).additionalProperty === "string"
        ? ((error.params as { additionalProperty: string }).additionalProperty as string)
        : undefined,
  }));
  return { ok: false, errors };
}

/* ------------------------------------------------------------------ *
 * The record-level validator of @specstride/contracts, handed through:
 * the schema id check, the unknown top-level key, the ignored `x-` key.
 * ------------------------------------------------------------------ */

/** The record schema and the record-level validator of feature 100, by reference. */
export const RECORD_LEVEL_VALIDATOR = {
  isLaunchContract,
  readLaunchContract,
  schemaId: LAUNCH_CONTRACT_SCHEMA_ID,
  unknownTopLevelKeyRefused: launchContract.AN_UNKNOWN_TOP_LEVEL_KEY_IS_REFUSED,
  ignoredKeyPrefix: launchContract.KEYS_UNDER_THIS_PREFIX_ARE_IGNORED,
} as const;

/* ------------------------------------------------------------------ *
 * The one post-schema rule: research.md row 14.
 * ------------------------------------------------------------------ */

/**
 * The closed set of row 261, read from `@specstride/contracts` through the
 * single reading of `schemas/closed-sets.ts` — never copied by hand here.
 */
export const DECLARED_SOURCES: readonly string[] = declarationSourceSet.members;

/**
 * The source a verification-plan source would report; research.md row 14: the
 * verification-plan source reports NO reads and writes, so a declaration
 * carrying it (or any member outside row 261) is refused.
 */
export const REFUSED_SCOPE_SOURCES: readonly string[] = ["verification-plan"];

/**
 * The post-schema rule of research.md row 14: every declaration under
 * `configuration.scopes` — the write scopes of tasks and the reads and writes
 * of verification commands — must carry its provenance, and that provenance
 * must be a member of the closed set of row 261. Nothing else about scopes is
 * stated here: the shape is the item schema's (`configuration.schema.json`).
 *
 * ONE RULE, ONE PLACE (F107-FR-012): the rule stands in
 * `validate/declarations.ts` (`declarationSourceProblems`, T054); this
 * function is the composed validator's view of it, mapping the problems into
 * the `ComposedError` shape. It adds no rule of its own.
 *
 * Returns one problem per refused declaration, empty when the scopes are
 * declared only from user configuration, the environment or a flag.
 */
export function declaredProvenanceProblems(record: unknown): readonly ComposedError[] {
  return declarationSourceProblems(record).map((one) => ({
    keyword: "post-schema",
    path: one.path,
    message: one.message,
  }));
}

/**
 * Validate one launch contract the way validation of the launch contract
 * does: the composed schema, then the one post-schema rule of row 14. The
 * record-level readings (`readLaunchContract`) stay available through
 * `RECORD_LEVEL_VALIDATOR` and are applied by the caller that also needs the
 * typed record.
 */
export function validateLaunchContract(value: unknown): ComposedResult {
  const composed = validateComposed(value);
  if (!composed.ok) return composed;
  const post = declaredProvenanceProblems(composed.record);
  if (post.length > 0) return { ok: false, errors: post };
  return composed;
}
