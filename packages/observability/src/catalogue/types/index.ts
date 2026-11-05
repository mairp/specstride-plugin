/**
 * T025 — the `data` schemas of the types of F111-FR-006 to F111-FR-015.
 *
 * One file per requirement, each holding the obligations that requirement
 * puts on its types; this file merges them with the schema the ROW already
 * gives (T004) and runs them.
 *
 * WHY A MERGE AND NOT A SECOND SCHEMA. The catalogue is the list of types and
 * of fields: a type has exactly the `data` fields its row names, and a field
 * that holds a member of a closed set carries that set. If this folder wrote
 * its own schemas from scratch, two lists of field names would exist and
 * would drift. So a refinement says only what the row cannot: which fields
 * are REQUIRED, what KIND of value each holds, and which pairs of fields have
 * to agree. `consistencyFindings` is the guard: it reports a refinement that
 * names a field no row has, and an `enum` that differs from the catalogue's.
 *
 * `checkRefinedData` is the whole check of one event's `data`: the keyword
 * checker of T006 against the merged schema, then the shapes, then the
 * cross-field rules. It never throws.
 */
import {
  CATALOGUE_BY_TYPE,
  DATA_SCHEMA_BASE_ID,
  closedSetMembersOf,
  dataSchemaForType,
  type DataSchema,
  type PropertySchema,
} from "../index.ts";
import { checkAgainstSchema, type SchemaFinding } from "../../writer/validate.ts";
import type { FieldRefinement, ObjectShape, TypeRefinement } from "./refinement.ts";
import { REFINEMENTS as USAGE } from "./usage.ts";
import { REFINEMENTS as PASS } from "./pass.ts";
import { REFINEMENTS as CHECKS } from "./checks.ts";
import { REFINEMENTS as BLOCKED } from "./blocked.ts";
import { REFINEMENTS as UNITS } from "./units.ts";
import { REFINEMENTS as CRITIC } from "./critic.ts";
import { REFINEMENTS as RULINGS } from "./rulings.ts";
import { REFINEMENTS as QUOTA } from "./quota.ts";
import { REFINEMENTS as STREAM } from "./stream.ts";
import { REFINEMENTS as PARALLEL } from "./parallel.ts";
import { REFINEMENTS as LAYER_CHECK } from "./layer-check.ts";
import { REFINEMENTS as CONTROL_FALLBACK_TERMS } from "./control-fallback-terms.ts";

export * from "./refinement.ts";
export * from "./layer-check.ts";
export * from "./control-fallback-terms.ts";

/** The ten requirements of T025 whose `data` schemas this folder holds. */
export const REFINED_REQUIREMENTS = [
  "F111-FR-006",
  "F111-FR-007",
  "F111-FR-008",
  "F111-FR-009",
  "F111-FR-010",
  "F111-FR-011",
  "F111-FR-012",
  "F111-FR-013",
  "F111-FR-014",
  "F111-FR-015",
] as const;

/**
 * The two requirements the repairs of 2026-09-30 added (T068, T070). They are
 * kept apart from `REFINED_REQUIREMENTS` because that list is the ten of T025
 * and is read as such; `ALL_REFINED_REQUIREMENTS` is what this folder covers.
 */
export const ADDED_REQUIREMENTS = ["F111-FR-050", "F111-FR-051"] as const;

/** Every requirement whose `data` schemas live in this folder. */
export const ALL_REFINED_REQUIREMENTS: readonly string[] = Object.freeze([
  ...REFINED_REQUIREMENTS,
  ...ADDED_REQUIREMENTS,
]);

/** Every refinement of the folder, in the order of the requirements. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  ...USAGE,
  ...PASS,
  ...CHECKS,
  ...BLOCKED,
  ...UNITS,
  ...CRITIC,
  ...RULINGS,
  ...QUOTA,
  ...STREAM,
  ...PARALLEL,
  ...LAYER_CHECK,
  ...CONTROL_FALLBACK_TERMS,
]);

/** The refinement of one type, where this folder holds one. */
export const REFINEMENT_BY_TYPE: ReadonlyMap<string, TypeRefinement> = new Map(
  REFINEMENTS.map((refinement) => [refinement.type, refinement]),
);

/** The refinements one requirement asks for. */
export function refinementsOfRequirement(requirement: string): readonly TypeRefinement[] {
  return Object.freeze(REFINEMENTS.filter((r) => r.requirement === requirement));
}

function propertyOf(field: FieldRefinement): PropertySchema {
  const property: { type?: readonly string[]; enum?: readonly string[] } = {};
  if (field.enum !== undefined) property.enum = field.enum;
  if (field.type !== undefined) property.type = field.type;
  return Object.freeze(property) as PropertySchema;
}

/**
 * The `data` schema of one type: the row's schema, with the required fields
 * and the typed properties the requirement adds (F111-FR-006 to F111-FR-015).
 * A type this folder does not refine keeps the row's schema unchanged.
 */
export function refinedDataSchemaOf(type: string): DataSchema | undefined {
  const base = dataSchemaForType(type);
  if (base === undefined) return undefined;
  const refinement = REFINEMENT_BY_TYPE.get(type);
  if (refinement === undefined) return base;
  const properties: Record<string, PropertySchema> = { ...base.properties };
  for (const [field, shape] of Object.entries(refinement.fields)) {
    properties[field] = Object.freeze({ ...properties[field], ...propertyOf(shape) });
  }
  return Object.freeze({
    ...base,
    $id: `${DATA_SCHEMA_BASE_ID}:${type}`,
    properties: Object.freeze(properties),
    required: Object.freeze([...refinement.required]),
  });
}

/** Every refined schema, by type. */
export const REFINED_DATA_SCHEMAS: ReadonlyMap<string, DataSchema> = new Map(
  [...REFINEMENT_BY_TYPE.keys()].flatMap((type) => {
    const schema = refinedDataSchemaOf(type);
    return schema === undefined ? [] : [[type, schema] as const];
  }),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check one record against a shape: the fields it must have, and no more. */
function checkShape(path: string, shape: ObjectShape, value: unknown): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  if (!isRecord(value)) {
    findings.push({
      keyword: "type",
      path,
      message: `${path} is a record of ${shape.required.join(", ")}`,
    });
    return findings;
  }
  for (const field of shape.required) {
    if (!Object.hasOwn(value, field)) {
      findings.push({
        keyword: "required",
        path: `${path}.${field}`,
        message: `${path} names ${field}`,
      });
    }
  }
  if (shape.additional === false) {
    const known = new Set([...shape.required, ...(shape.optional ?? [])]);
    for (const field of Object.keys(value)) {
      if (known.has(field)) continue;
      findings.push({
        keyword: "additionalProperties",
        path: `${path}.${field}`,
        message: `${path} holds ${field}, which is no field of it`,
      });
    }
  }
  return findings;
}

function isObjectShape(value: FieldRefinement["items"]): value is ObjectShape {
  return value !== undefined && Object.hasOwn(value, "required");
}

/** Check the shapes a refinement puts on the fields of one record. */
function checkShapes(
  refinement: TypeRefinement,
  data: Readonly<Record<string, unknown>>,
): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  for (const [field, shape] of Object.entries(refinement.fields)) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];
    if (shape.shape !== undefined && value !== null && value !== undefined) {
      findings.push(...checkShape(`data.${field}`, shape.shape, value));
    }
    if (isObjectShape(shape.items) && Array.isArray(value)) {
      for (const [index, member] of value.entries()) {
        findings.push(...checkShape(`data.${field}[${index}]`, shape.items, member));
      }
    }
  }
  return findings;
}

/** Run the cross-field rules of a refinement. */
function checkRules(
  refinement: TypeRefinement,
  data: Readonly<Record<string, unknown>>,
): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  for (const rule of refinement.rules ?? []) {
    let message: string | null = null;
    try {
      message = rule.check(data);
    } catch (error) {
      message = `the rule ${rule.name} could not be run: ${String(error)}`;
    }
    if (message !== null) {
      findings.push({ keyword: "rule", path: `data (${rule.name})`, message });
    }
  }
  return findings;
}

/**
 * Check the `data` of one event against the refined schema of its type: the
 * keywords, the shapes and the cross-field rules. Returns the findings and
 * never throws (Principle V).
 */
export function checkRefinedData(type: string, data: unknown): readonly SchemaFinding[] {
  const schema = refinedDataSchemaOf(type);
  if (schema === undefined) {
    return Object.freeze([
      { keyword: "type-not-in-catalogue", path: "type", message: `${type} has no data schema` },
    ]);
  }
  const findings = [...checkAgainstSchema(schema, data)];
  const refinement = REFINEMENT_BY_TYPE.get(type);
  if (refinement !== undefined && isRecord(data)) {
    findings.push(...checkShapes(refinement, data));
    // A rule reads fields of the record; it runs only where the fields are there.
    const missing = refinement.required.filter((field) => !Object.hasOwn(data, field));
    if (missing.length === 0) findings.push(...checkRules(refinement, data));
  }
  return Object.freeze(findings);
}

/**
 * The findings of this folder against the catalogue: a type that has no row,
 * a required field the row does not have, a field the row does not have, and
 * an `enum` that differs from the closed set the catalogue reads. Empty means
 * the refinements and the data say the same thing.
 */
export function consistencyFindings(): readonly string[] {
  const findings: string[] = [];
  for (const refinement of REFINEMENTS) {
    const entry = CATALOGUE_BY_TYPE.get(refinement.type);
    if (entry === undefined) {
      findings.push(`${refinement.type}: the catalogue holds no row for it`);
      continue;
    }
    const fields = new Set(entry.dataFields);
    for (const field of refinement.required) {
      if (!fields.has(field)) {
        findings.push(`${refinement.type}: the required field ${field} is no field of the row`);
      }
    }
    for (const [field, shape] of Object.entries(refinement.fields)) {
      if (!fields.has(field)) {
        findings.push(`${refinement.type}: ${field} is no field of the row`);
        continue;
      }
      const fromTheCatalogue = closedSetMembersOf(refinement.type, field);
      if (shape.enum !== undefined && fromTheCatalogue !== undefined) {
        const same =
          shape.enum.length === fromTheCatalogue.length &&
          shape.enum.every((member) => fromTheCatalogue.includes(member));
        if (!same) {
          findings.push(
            `${refinement.type}.${field}: the refinement names ${shape.enum.join(", ")} ` +
              `where the catalogue reads ${fromTheCatalogue.join(", ")}`,
          );
        }
      }
    }
    if (!ALL_REFINED_REQUIREMENTS.includes(refinement.requirement)) {
      findings.push(
        `${refinement.type}: ${refinement.requirement} is no requirement of this folder`,
      );
    }
  }
  return Object.freeze(findings);
}
