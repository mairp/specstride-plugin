/**
 * A valid sample record for a schema of the package, built from the schema
 * itself: every required property gets a value of its type. The record tests
 * of annex B §B.6 to §B.18 use it, so that a sample cannot drift from the
 * schema it is a sample of.
 */
import { schemaMap } from "../src/records/schema-map.ts";

type Property = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
};

type Schema = {
  properties?: Record<string, Property>;
  required?: string[];
};

const valueFor = (type: string | string[] | undefined, name: string): unknown => {
  const t = Array.isArray(type) ? (type.find((x) => x !== "null") ?? "string") : (type ?? "string");
  switch (t) {
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return /At$|^ts$|^since$|^raisedAt$/.test(name) ? "2026-09-30T00:00:00.000Z" : `${name}-1`;
  }
};

/**
 * The value a sample gives one property: the first member where the schema
 * closes the property, the schema id where the property carries it, and a
 * value of the declared type otherwise.
 */
function sampleValue(schemaId: string, name: string, property: Property | undefined): unknown {
  if (property?.const !== undefined) return property.const;
  if (Array.isArray(property?.enum) && property.enum.length > 0) return property.enum[0];
  const description = String(property?.description ?? "").trim();
  if (description === "Schema id") {
    // The config envelope carries the major of the schema as a whole number.
    return property?.type === "integer" ? 1 : schemaId;
  }
  const constant = /^The constant `([^`]+)`$/.exec(description);
  if (constant !== null) return constant[1];
  if (/^Major of the schema/.test(description)) return 1;
  return valueFor(property?.type, name);
}

/** A valid sample of the schema id: every required property, none other. */
export function sampleOf(schemaId: string): Record<string, unknown> {
  const schema = schemaMap[schemaId] as Schema | undefined;
  if (schema === undefined) throw new Error(`no schema for ${schemaId}`);
  const out: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    out[name] = sampleValue(schemaId, name, schema.properties?.[name]);
  }
  return out;
}

/** The required properties of a schema id. */
export function requiredOf(schemaId: string): readonly string[] {
  return Object.freeze([...((schemaMap[schemaId] as Schema | undefined)?.required ?? [])]);
}

/** The schema id with its major raised by one. */
export function withNextMajor(schemaId: string): string {
  const slash = schemaId.lastIndexOf("/");
  const base = schemaId.slice(0, slash);
  const major = schemaId.slice(slash + 1);
  const numeric = /^v?(\d+)$/.exec(major);
  if (numeric === null) return `${base}/${major}x`;
  return `${base}/${major.startsWith("v") ? "v" : ""}${Number(numeric[1]) + 1}`;
}
