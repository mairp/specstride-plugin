/**
 * T009 — the validators of the schema (F110-FR-001, F110-FR-002, F110-FR-007).
 *
 * F110-FR-001: a value is validated against its type and range when the layers
 * are merged, and an invalid value refuses the launch with the key, the value,
 * the layer and the range in the message. `ConfigValueError` carries all four
 * as properties as well, so that a caller builds its own message without
 * parsing this one.
 *
 * F110-FR-002: an unknown key refuses the launch with the file, the key and the
 * nearest known key; a key under `x-` is ignored.
 *
 * F110-FR-007: `loop.parallel.workers` above 4 and `verification.parallelism`
 * above 4 are configuration errors. Neither is a constant here: the first is
 * bounded by `loop.parallel.workersMax`, whose default the catalogue gives as 4,
 * and the second by its own cell `1 to 4`.
 */
import { catalogueEntry, matchCatalogueKey, type KeyMatch } from "./catalogue.ts";
import { classifyKey } from "./spelling.ts";
import {
  ConfigValueError,
  LAYER_OF_CODE,
  UnknownKeyError,
  type KeyEntry,
  type LayerCode,
  type ValueSpec,
} from "./types.ts";

/**
 * The keys whose upper bound is the value of another key (§K.5). The loader
 * passes the resolved value of the bounding key; with none, the catalogue's own
 * default of that key stands, which is what makes `loop.parallel.workers` above
 * 4 an error out of the box (F110-FR-007).
 */
export const BOUNDED_BY_KEY: Readonly<Record<string, string>> = Object.freeze({
  "loop.parallel.workers": "loop.parallel.workersMax",
});

/** The default of a bounding key, as the catalogue states it. */
export function defaultBound(boundingKey: string): number | undefined {
  const entry = catalogueEntry(boundingKey);
  if (entry === undefined || entry.default.kind !== "value") return undefined;
  const value = entry.default.value;
  return typeof value === "number" ? value : undefined;
}

/** What the caller knows while it validates one value. */
export interface ValidateOptions {
  /** The file, the variable or the flag the value came from, for the message. */
  readonly place?: string | undefined;
  /** The resolved value of a key that bounds another, where the loader has it. */
  readonly valueOf?: ((key: string) => unknown) | undefined;
  /** False to take the value as already typed (a parsed file) rather than text. */
  readonly fromText?: boolean | undefined;
}

const layerName = (layer: LayerCode): string => LAYER_OF_CODE[layer];

/**
 * F110-FR-001, third sentence — a layer that the column "Layers" does not list
 * is refused for the key. `profile` is the case F110-FR-013 names: its layers
 * are `F E U`, so a project file cannot select the profile.
 */
export function layerIsAllowed(entry: KeyEntry, layer: LayerCode): boolean {
  return entry.layers.includes(layer);
}

/** The bound of a value a cell states, as the message of a range error prints it. */
function rangeText(spec: ValueSpec, max: number | undefined): string {
  if (max !== undefined && spec.max === undefined) return `${spec.text} (at most ${max})`;
  return spec.text;
}

/** Read text from the environment or a flag into the type the key holds. */
export function coerceText(text: string, spec: ValueSpec): unknown {
  switch (spec.kind) {
    case "boolean": {
      const low = text.trim().toLowerCase();
      if (low === "true" || low === "on" || low === "1" || low === "yes") return true;
      if (low === "false" || low === "off" || low === "0" || low === "no") return false;
      return text;
    }
    case "integer":
    case "number": {
      const t = text.trim();
      if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return text;
      return Number(t);
    }
    case "list": {
      if (text.trim() === "") return [];
      const items = text.split(",").map((p) => p.trim());
      if (spec.elementKind === "integer") {
        return items.map((i) => (/^-?\d+$/.test(i) ? Number(i) : i));
      }
      return items;
    }
    case "table": {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    case "enum":
    case "text":
    case "secret-ref":
      return text;
  }
}

/** The delegate of `phases.<N>.budget.*`: the key of the same last segment (§K.4). */
export function delegateOf(match: KeyMatch): KeyEntry | undefined {
  if (match.entry.key !== "phases.<N>.budget.*") return undefined;
  const tail = /^phases\.[^.]+\.budget\.(.+)$/.exec(match.key)?.[1];
  if (tail === undefined || tail === "*") return undefined;
  return catalogueEntry(`budget.run.${tail}`) ?? catalogueEntry(`budget.role.<role>.${tail}`);
}

/** The result of validating one value. */
export type Validation =
  | { readonly ok: true; readonly key: string; readonly entry: KeyEntry; readonly value: unknown }
  | { readonly ok: false; readonly error: ConfigValueError | UnknownKeyError };

/**
 * Validate one value of one key, offered by one layer (F110-FR-001).
 *
 * The order is the order of the requirement: the key must be in the schema
 * (F110-FR-002), the layer must be one the column "Layers" lists, the value must
 * be of the key's type, and it must be inside the range the cell states.
 */
export function validateKeyValue(
  key: string,
  value: unknown,
  layer: LayerCode,
  options: ValidateOptions = {},
): Validation {
  const place = options.place ?? layerName(layer);
  const verdict = classifyKey(key);
  if (verdict.kind === "unknown") {
    return {
      ok: false,
      error: new UnknownKeyError({ key, file: place, nearest: verdict.nearest }),
    };
  }
  const match = matchCatalogueKey(key);
  if (match === undefined) {
    // An `x-` key is ignored, never refused (§K.2 rule 5).
    return { ok: false, error: new UnknownKeyError({ key, file: place, nearest: undefined }) };
  }
  const entry = match.entry;
  if (!layerIsAllowed(entry, layer)) {
    return {
      ok: false,
      error: new ConfigValueError({
        reason: "layer-not-allowed",
        key,
        value,
        layer: place,
        range: entry.cells.layers,
        message:
          `${place}: the key \`${key}\` may not be set by the layer ` +
          `\`${layerName(layer)}\`. The catalogue lists the layers \`${entry.cells.layers}\` ` +
          `for it (§K.1); a layer not listed is refused for the key`,
      }),
    };
  }

  const spec = delegateOf(match)?.type ?? entry.type;
  const typed = options.fromText === true ? coerceText(String(value), spec) : value;

  const typeProblem = typeProblemOf(typed, spec);
  if (typeProblem !== undefined) {
    return {
      ok: false,
      error: new ConfigValueError({
        reason: "type",
        key,
        value,
        layer: place,
        range: spec.text,
        message:
          `${place}: the key \`${key}\` was set to ${render(value)}, which is not ` +
          `a value of its type \`${spec.text}\`: ${typeProblem}`,
      }),
    };
  }

  const bounding = BOUNDED_BY_KEY[key] ?? BOUNDED_BY_KEY[entry.key];
  let max = spec.max;
  if (bounding !== undefined) {
    const offered = options.valueOf?.(bounding);
    const bound = typeof offered === "number" ? offered : defaultBound(bounding);
    if (bound !== undefined) max = max === undefined ? bound : Math.min(max, bound);
  }
  const rangeProblem = rangeProblemOf(typed, spec, max, bounding);
  if (rangeProblem !== undefined) {
    return {
      ok: false,
      error: new ConfigValueError({
        reason: "range",
        key,
        value,
        layer: place,
        range: rangeText(spec, max),
        message:
          `${place}: the key \`${key}\` was set to ${render(value)}, which is outside ` +
          `its range \`${rangeText(spec, max)}\`: ${rangeProblem}`,
      }),
    };
  }
  return { ok: true, key, entry, value: typed };
}

const render = (value: unknown): string =>
  typeof value === "string" ? `\`${value}\`` : `\`${JSON.stringify(value) ?? String(value)}\``;

/** Why a value is not of the key's type, or `undefined` where it is. */
export function typeProblemOf(value: unknown, spec: ValueSpec): string | undefined {
  if (value === null || value === undefined) return undefined; // the absent value
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `the cell names the two values \`${(spec.booleanLiterals ?? []).join("`, `")}\``;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? undefined
        : "the cell names a whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : "the cell names a number";
    case "enum": {
      if (typeof value !== "string") return "the cell names a closed set of literals";
      return (spec.members ?? []).includes(value)
        ? undefined
        : `the members are \`${(spec.members ?? []).join("`, `")}\``;
    }
    case "list": {
      if (!Array.isArray(value)) return "the cell names a list";
      const members = spec.elementMembers;
      if (members !== undefined) {
        const bad = value.find((v) => typeof v !== "string" || !members.includes(v));
        if (bad !== undefined) {
          return `the members are \`${members.join("`, `")}\`, and the list holds ${render(bad)}`;
        }
      }
      if (spec.elementKind === "integer") {
        const bad = value.find((v) => typeof v !== "number" || !Number.isInteger(v));
        if (bad !== undefined)
          return `every element is a whole number, and the list holds ${render(bad)}`;
      }
      return undefined;
    }
    case "table":
      return typeof value === "object" && !Array.isArray(value)
        ? undefined
        : "the cell names a table";
    case "secret-ref":
      return typeof value === "string" ? undefined : "the cell names a reference of §K.7";
    case "text":
      return typeof value === "string" ? undefined : "the cell names a text value";
  }
}

/** Why a value is outside the range the cell states, or `undefined` where it is not. */
export function rangeProblemOf(
  value: unknown,
  spec: ValueSpec,
  max: number | undefined,
  boundingKey: string | undefined,
): string | undefined {
  if (typeof value !== "number") return undefined;
  if (spec.zeroEscapes === true && value === 0) return undefined;
  if (spec.min !== undefined && value < spec.min) {
    return `the smallest accepted value is ${spec.min}`;
  }
  if (max !== undefined && value > max) {
    return boundingKey === undefined
      ? `the largest accepted value is ${max}`
      : `the largest accepted value is ${max}, the value of \`${boundingKey}\``;
  }
  return undefined;
}

export { ConfigValueError, UnknownKeyError };
