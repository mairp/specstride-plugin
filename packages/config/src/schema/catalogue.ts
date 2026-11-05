/**
 * T009 — the catalogue of configuration keys (F110-FR-001, F110-FR-009,
 * F110-FR-010).
 *
 * `catalogue-data.ts` carries the cells of `contracts/config-keys.tsv`
 * verbatim; this module reads them into `KeyEntry` and offers the lookups the
 * loader and the validators need. The reading happens once, at import.
 *
 * A key exists in the schema only with all seven columns of §K.1
 * (F110-FR-001), and `buildEntry` refuses a row that lacks a trust class, a
 * snapshot class or an owner, so a row without them cannot reach a run at all
 * (F110-FR-010); `tests/unit/catalogue.test.ts` reports the same over the whole
 * catalogue as the static test CT-110-108 asks.
 */
import { CATALOGUE_DATA, CATALOGUE_SIZE, type CatalogueDataRow } from "./catalogue-data.ts";
import { parseDefault, parseParity, parseValueSpec } from "./type-parse.ts";
import {
  LAYER_CODES,
  type KeyEntry,
  type LayerCode,
  type NarrowingDirection,
  type SnapshotCode,
  type TrustCode,
} from "./types.ts";

export { CATALOGUE_SIZE };
export type { CatalogueDataRow };

/** A row of the catalogue that cannot be read into a key of the schema. */
export class CatalogueRowError extends Error {
  readonly key: string;
  readonly column: string;
  constructor(key: string, column: string, message: string) {
    super(`the catalogue row of \`${key}\` is not a key of the schema: ${message}`);
    this.name = "CatalogueRowError";
    this.key = key;
    this.column = column;
  }
}

/** Read the column "Layers" of a row: the codes, and the note it adds. */
export function parseLayers(cell: string): { layers: LayerCode[]; note: string } {
  const [head = "", ...rest] = cell.split(";");
  const note = rest.join(";").trim();
  // `C only` names the contract pin and no other layer.
  const codes = head
    .replace(/\bonly\b/gi, "")
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
  const layers: LayerCode[] = [];
  for (const code of codes) {
    const found = LAYER_CODES.find((l) => l === code);
    if (found === undefined) {
      throw new CatalogueRowError("(layers)", "layers", `\`${code}\` is not a layer of §K.1`);
    }
    if (!layers.includes(found)) layers.push(found);
  }
  return { layers, note };
}

/** Read the column "Class": the trust class, what "stricter" means, and `(snap …)`. */
export function parseTrustCell(cell: string): {
  trust: TrustCode;
  narrowing?: NarrowingDirection | undefined;
  narrowingNote?: string | undefined;
  snapshot: SnapshotCode;
} {
  const snap = /\(snap\s+([pt-])\)/.exec(cell);
  if (snap === null) {
    throw new CatalogueRowError(
      "(class)",
      "trust_class",
      `it names no snapshot class: \`${cell}\``,
    );
  }
  const snapshot = snap[1] as SnapshotCode;
  const head = cell.slice(0, snap.index).trim();
  const first = head.split(/[\s;]+/)[0] ?? "";
  if (first === "W") {
    return { trust: "W", snapshot };
  }
  if (first === "-") {
    return { trust: "-", snapshot };
  }
  if (first !== "N") {
    throw new CatalogueRowError(
      "(class)",
      "trust_class",
      `\`${first}\` is not a trust class of §K.1`,
    );
  }
  const rest = head.slice(1).trim();
  const direct: Record<string, NarrowingDirection> = {
    lo: "lo",
    lo0: "lo0",
    on: "on",
    off: "off",
    sub: "sub",
  };
  const word = rest.split(/[\s;]+/)[0] ?? "";
  const narrowing = direct[word];
  if (narrowing !== undefined) return { trust: "N", narrowing, snapshot };
  // A rule the annex writes in prose: `N (required is stricter than plan, …)`.
  return {
    trust: "N",
    narrowing: "prose",
    narrowingNote: rest.replace(/^\(|\)$/g, "").trim(),
    snapshot,
  };
}

const PARAMETER = /<[A-Za-z]+>/g;

/** The parameters of a template key, in the order they appear (`<N>`, `<id>`, `<role>`). */
export function parametersOf(key: string): readonly string[] {
  return Object.freeze(key.match(PARAMETER) ?? []);
}

/** Read one row of the contract into a key of the schema. */
export function buildEntry(row: CatalogueDataRow): KeyEntry {
  if (row.key.trim() === "") throw new CatalogueRowError("(empty)", "key", "the key is empty");
  const type = parseValueSpec(row.typeAndRange);
  const def = parseDefault(row.default, type);
  const parity = parseParity(row.valueUnderParity, type, def);
  if (parity === undefined) {
    throw new CatalogueRowError(
      row.key,
      "value_under_parity",
      `the cell \`${row.valueUnderParity}\` is neither a value of \`${row.typeAndRange}\` ` +
        `nor a reserved literal of closed set 239 (F110-FR-008)`,
    );
  }
  let layers: LayerCode[];
  let layerNote: string;
  try {
    ({ layers, note: layerNote } = parseLayers(row.layers));
  } catch (error) {
    throw new CatalogueRowError(row.key, "layers", (error as Error).message);
  }
  if (layers.length === 0) {
    throw new CatalogueRowError(row.key, "layers", "it names no layer that may set the key");
  }
  let trust: ReturnType<typeof parseTrustCell>;
  try {
    trust = parseTrustCell(row.trustClass);
  } catch (error) {
    throw new CatalogueRowError(row.key, "trust_class", (error as Error).message);
  }
  const owners = row.ownerFeature
    .split(/[,\s]+/)
    .map((o) => o.trim())
    .filter((o) => /^\d{3}$/.test(o));
  if (owners.length === 0) {
    throw new CatalogueRowError(row.key, "owner_feature", "it names no owning feature");
  }
  const profileRows = row.profileRow
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "")
    .map((n) => Number(n));
  if (profileRows.some((n) => !Number.isInteger(n))) {
    throw new CatalogueRowError(
      row.key,
      "profile_row",
      `\`${row.profileRow}\` is not a row number of annex X §X.7`,
    );
  }
  const parameters = parametersOf(row.key);
  return Object.freeze({
    key: row.key,
    type,
    default: def,
    parity,
    layers: Object.freeze(layers),
    layerNote,
    trust: trust.trust,
    ...(trust.narrowing === undefined ? {} : { narrowing: trust.narrowing }),
    ...(trust.narrowingNote === undefined ? {} : { narrowingNote: trust.narrowingNote }),
    snapshot: trust.snapshot,
    owners: Object.freeze(owners),
    profileRows: Object.freeze(profileRows),
    isTemplate: parameters.length > 0,
    parameters,
    cells: Object.freeze({
      typeAndRange: row.typeAndRange,
      default: row.default,
      valueUnderParity: row.valueUnderParity,
      trustClass: row.trustClass,
      layers: row.layers,
      ownerFeature: row.ownerFeature,
    }),
  });
}

/** Every key of the catalogue, read into `KeyEntry`, in the order of §K.3 to §K.6b. */
export const CATALOGUE: readonly KeyEntry[] = Object.freeze(CATALOGUE_DATA.map(buildEntry));

/** The exact spellings of the catalogue, in the order of the tables. */
export const CATALOGUE_KEYS: readonly string[] = Object.freeze(CATALOGUE.map((e) => e.key));

const BY_KEY: ReadonlyMap<string, KeyEntry> = new Map(CATALOGUE.map((e) => [e.key, e]));

/** The entry of an exact spelling, or `undefined`. Templates match literally only. */
export function catalogueEntry(key: string): KeyEntry | undefined {
  return BY_KEY.get(key);
}

/** The template entries, which a concrete key matches through its parameters. */
export const TEMPLATE_ENTRIES: readonly KeyEntry[] = Object.freeze(
  CATALOGUE.filter((e) => e.isTemplate),
);

const templatePattern = (key: string): RegExp =>
  new RegExp(
    `^${key
      .split(PARAMETER)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("([^.]+)")}$`,
  );

const TEMPLATE_PATTERNS: readonly { entry: KeyEntry; pattern: RegExp }[] = Object.freeze(
  TEMPLATE_ENTRIES.map((entry) => ({ entry, pattern: templatePattern(entry.key) })),
);

/** The key the schema matched, with the parameters a template key bound. */
export interface KeyMatch {
  readonly entry: KeyEntry;
  /** The key as the consumer wrote it. */
  readonly key: string;
  /** The parameters a template bound, keyed by `<N>`, `<id>`, `<role>`, …. */
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * The entry of a key the consumer wrote. An exact spelling wins; otherwise the
 * key is matched against the template keys of the catalogue, whose parameters
 * (`<N>` a phase number, `<id>` a harness id, `<role>` a role id) stand for one
 * segment each (§K.1).
 *
 * `phases.<N>.budget.*` is the one template whose last segment is itself a
 * family: it stands for the keys of the same last segment under `budget.run`
 * and `budget.role.<role>` (§K.4), so a key under `phases.<N>.budget.` matches
 * it when that last segment is one of them.
 */
export function matchCatalogueKey(key: string): KeyMatch | undefined {
  const exact = BY_KEY.get(key);
  if (exact !== undefined) {
    return Object.freeze({ entry: exact, key, parameters: Object.freeze({}) });
  }
  for (const { entry, pattern } of TEMPLATE_PATTERNS) {
    const m = pattern.exec(key);
    if (m === null) continue;
    const parameters: Record<string, string> = {};
    entry.parameters.forEach((p, i) => {
      parameters[p] = m[i + 1] ?? "";
    });
    return Object.freeze({ entry, key, parameters: Object.freeze(parameters) });
  }
  const phaseBudget = /^phases\.([^.]+)\.budget\.(.+)$/.exec(key);
  if (phaseBudget !== null) {
    const entry = BY_KEY.get("phases.<N>.budget.*");
    const tail = phaseBudget[2] ?? "";
    const named =
      BY_KEY.get(`budget.run.${tail}`) ?? BY_KEY.get(`budget.role.<role>.${tail}`) ?? undefined;
    if (entry !== undefined && named !== undefined) {
      return Object.freeze({
        entry,
        key,
        parameters: Object.freeze({ "<N>": phaseBudget[1] ?? "", "<key>": tail }),
      });
    }
  }
  return undefined;
}

/** True where the schema knows the key (F110-FR-009: a key not here is never read). */
export function isKnownKey(key: string): boolean {
  return matchCatalogueKey(key) !== undefined;
}

/** The first segment of every key of the catalogue: the namespaces of the schema. */
export const CATALOGUE_NAMESPACES: readonly string[] = Object.freeze([
  ...new Set(CATALOGUE_KEYS.map((k) => k.split(".")[0] ?? k)),
]);

/**
 * A switch of the schema: a key whose cell "Under `parity`" is not `as default`
 * (§K.1). A key that is not a switch has, under `parity`, the value it has at
 * the baseline, which is its default here, so the profile needs no row for it.
 */
export const SWITCH_KEYS: readonly string[] = Object.freeze(
  CATALOGUE.filter((e) => e.parity.kind !== "as-default").map((e) => e.key),
);
