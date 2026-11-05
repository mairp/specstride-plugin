#!/usr/bin/env node
/**
 * T026 — the generator of `packages/config/data/alias-table.json` (F110-FR-020).
 *
 *     node packages/config/tools/alias-table-gen.ts            write the data
 *     node packages/config/tools/alias-table-gen.ts --check     compare with it
 *
 * `specs/110-config-and-terms/contracts/alias-table.tsv` is the contract that
 * task T005 completed from annex X §X.8 and `spec.md` §K.8: 159 rows, one per
 * as-is variable. The product cannot read that file at run time — it lives
 * outside the published package — so the table ships as JSON data inside
 * `packages/config/data/`, one entry per row, with the three columns of the
 * contract carried verbatim.
 *
 * Three things are derived here rather than hand-written, so that neither can
 * drift from the contract:
 *
 * 1. **The kind of each row.** A row reaches a key, a family of keys, no key
 *    (a variable of the platform or of the run context), or is not carried.
 * 2. **The order relations** between two variables that one note states in
 *    prose ("read first; `X` only when it is unset", "the fallback after `X`",
 *    …). Each relation records the pattern that produced it, so a note whose
 *    wording changes stops producing it and the check fails.
 * 3. **The resolution of every key more than one variable reaches**: `ordered`
 *    where the relations put the variables in one chain, and `conflict`
 *    otherwise — which is the general rule of F110-FR-020 ("when two
 *    environment names reach one key and their values differ, the launch MUST
 *    be refused with both names in the message").
 *
 * `--check` exits 1 when the data and the contract differ, and
 * `tests/parity/alias.test.ts` runs that comparison.
 *
 * It writes nothing outside `packages/config/data/alias-table.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The three columns of `contracts/alias-table.tsv`, in order. */
export const COLUMNS = ["as-is variable", "key", "note"] as const;

/** The number of rows the contract holds, one per as-is variable (T005). */
export const ALIAS_ROW_COUNT = 159 as const;

/** The rank the environment stands at; an as-is name is read there only. */
export const ALIAS_RANK = 4 as const;

/** The cell of the key column that says the variable reaches no key. */
const NO_KEY = "(no key)";
/** The cell of the key column that says the variable is not carried. */
const NOT_CARRIED = "(not carried)";

/** What a row of the table says about its variable. */
export type AliasRowKind = "key" | "family" | "no-key" | "not-carried";

/** One row of the alias table, as the shipped data carries it. */
export interface AliasDataRow {
  /** The as-is variable, as the contract spells it. */
  readonly variable: string;
  readonly kind: AliasRowKind;
  /** The keys the row names, for a row of the kind `key`. */
  readonly keys: readonly string[];
  /** The pattern of keys the row names, for a row of the kind `family`. */
  readonly keyPattern?: string;
  /** True where the variable itself is a pattern (`<HARNESS>`, `<N>`, `*`). */
  readonly variableIsPattern: boolean;
  /** True where a set-but-empty value is read as unset (§K.8, CQ-196). */
  readonly emptyIsUnset?: true;
  /** True where the as-is value is decimal seconds and the key holds milliseconds (§K.8). */
  readonly secondsToMilliseconds?: true;
  /** True where the variable is accepted without effect and a launch message says so. */
  readonly acceptedWithoutEffect?: true;
  /** The note of the contract, verbatim. */
  readonly note: string;
}

/** One order relation between two variables, derived from a note. */
export interface AliasRelation {
  /** The variable that is read first. */
  readonly before: string;
  /** The variable that is read only when the first one is unset. */
  readonly after: string;
  /** The name of the prose pattern that produced the relation. */
  readonly pattern: string;
  /** The variable whose note holds the prose. */
  readonly statedBy: string;
}

/** How the variables that reach one key are resolved against each other. */
export type AliasResolution = "single" | "ordered" | "conflict";

/** One key of the table, with the variables that reach it. */
export interface AliasKeyEntry {
  readonly key: string;
  /** Every variable of the table that names the key, in the table's order. */
  readonly variables: readonly string[];
  readonly resolution: AliasResolution;
  /** For `ordered`, the chain highest first. */
  readonly order?: readonly string[];
}

/** The whole shipped alias table. */
export interface AliasTableData {
  readonly schema: string;
  readonly source: string;
  readonly rank: number;
  readonly rowCount: number;
  readonly rows: readonly AliasDataRow[];
  readonly relations: readonly AliasRelation[];
  readonly keys: readonly AliasKeyEntry[];
}

/** The schema id of the shipped data. */
export const ALIAS_TABLE_SCHEMA_ID = "specstride.config.alias-table/1";

/**
 * The prose forms a note uses to order two variables. Each names the pattern
 * and says which of the two is read first; `self` is the variable whose note
 * holds the prose. The forms are those that the notes of the contract actually
 * use: a note that drops one stops producing its relation, and the count
 * asserted by `tests/parity/alias.test.ts` then fails.
 */
export const ORDER_PATTERNS: readonly {
  readonly name: string;
  readonly regex: RegExp;
  /** `self-first` puts the row's own variable before the matched name. */
  readonly direction: "self-first" | "other-first";
}[] = Object.freeze([
  Object.freeze({
    name: "read-first-only-when-unset",
    regex: /read first; `?([A-Z][A-Z0-9_]*)`? only when it is unset/g,
    direction: "self-first" as const,
  }),
  Object.freeze({
    name: "the-fallback-after",
    regex: /the fallback after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
  Object.freeze({
    name: "the-second-choice-after",
    regex: /the second choice after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
  Object.freeze({
    name: "preferred-over",
    regex: /preferred over `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "self-first" as const,
  }),
  Object.freeze({
    name: "reads-it-after",
    regex: /reads? it after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
  Object.freeze({
    name: "is-the-fallback",
    regex: /`?([A-Z][A-Z0-9_]*)`? is the fallback/g,
    direction: "self-first" as const,
  }),
  Object.freeze({
    name: "read-before-the-inherited",
    regex: /read before the inherited `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "self-first" as const,
  }),
  Object.freeze({
    name: "and-before",
    regex: /and before `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "self-first" as const,
  }),
  Object.freeze({
    name: "checked-after",
    regex: /checked after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
  Object.freeze({
    name: "read-after",
    regex: /read after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
  Object.freeze({
    name: "comma-after",
    regex: /, after `?([A-Z][A-Z0-9_]*)`?/g,
    direction: "other-first" as const,
  }),
]);

/**
 * §K.8, the prime launcher pair: an empty first variable is read as unset, the
 * narrowest reading (`assumption: CQ-196`). The note of the row states it, and
 * the generator reads the flag off that sentence rather than off a list.
 */
const EMPTY_IS_UNSET = /An empty first variable is read as unset/;

/**
 * §K.8, the two standalone shipper timeouts: the as-is value is decimal
 * seconds and the key holds milliseconds. The note of the row states it.
 */
const SECONDS_TO_MILLISECONDS = /converted to milliseconds/;

/**
 * §K.8 with CQ-120: `SPECSTRIDE_OTEL_STATE_DIR` is accepted without effect and
 * a launch message says so. The note of the row states it.
 */
const ACCEPTED_WITHOUT_EFFECT = /accepted, without effect/;

/** One row of the contract. */
export interface RawAliasRow {
  readonly variable: string;
  readonly key: string;
  readonly note: string;
}

/** Read the contract into rows. The header must be the three columns of T005. */
export function parseTsv(text: string): RawAliasRow[] {
  const lines = text.replace(/\n$/, "").split("\n");
  const header = (lines[0] ?? "").split("\t");
  if (header.length !== COLUMNS.length || header.some((h, i) => h !== COLUMNS[i])) {
    throw new Error(
      `contracts/alias-table.tsv: the header is not the three columns of T005: ${header.join(", ")}`,
    );
  }
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return {
      variable: cells[0] ?? "",
      key: cells[1] ?? "",
      note: cells[2] ?? "",
    };
  });
}

/** True where a cell holds a pattern rather than one name. */
export function isPattern(cell: string): boolean {
  return /[*<]/.test(cell) || cell.startsWith("(");
}

/** Read one row of the contract into the row the data carries. */
export function buildRow(raw: RawAliasRow): AliasDataRow {
  const base = {
    variable: raw.variable,
    variableIsPattern: isPattern(raw.variable),
    note: raw.note,
  } as const;
  if (raw.key === NO_KEY) {
    return Object.freeze({
      ...base,
      kind: "no-key" as const,
      keys: Object.freeze([]),
      ...(ACCEPTED_WITHOUT_EFFECT.test(raw.note) ? { acceptedWithoutEffect: true as const } : {}),
    });
  }
  if (raw.key === NOT_CARRIED) {
    return Object.freeze({ ...base, kind: "not-carried" as const, keys: Object.freeze([]) });
  }
  if (raw.key.includes("*")) {
    return Object.freeze({
      ...base,
      kind: "family" as const,
      keys: Object.freeze([]),
      keyPattern: raw.key,
    });
  }
  // `loop.yield.<key>` is the catch-all row of §K.8 for the further yield
  // variables: the tail of the variable is not the tail of the key, so the row
  // is a family that no mechanical rule resolves. A key template of the
  // catalogue (`harnesses.<id>.overlay`, `phases.<N>.proposer.timeoutSec`) is
  // not a family: the catalogue itself carries it.
  if (raw.key.includes("<key>")) {
    return Object.freeze({
      ...base,
      kind: "family" as const,
      keys: Object.freeze([]),
      keyPattern: raw.key,
    });
  }
  const keys = Object.freeze(raw.key.split("; ").map((k) => k.trim()));
  return Object.freeze({
    ...base,
    kind: "key" as const,
    keys,
    ...(EMPTY_IS_UNSET.test(raw.note) ? { emptyIsUnset: true as const } : {}),
    ...(SECONDS_TO_MILLISECONDS.test(raw.note) ? { secondsToMilliseconds: true as const } : {}),
  });
}

/** Every order relation the notes of the contract state. */
export function buildRelations(rows: readonly RawAliasRow[]): AliasRelation[] {
  const seen = new Set<string>();
  const out: AliasRelation[] = [];
  for (const row of rows) {
    for (const pattern of ORDER_PATTERNS) {
      for (const match of row.note.matchAll(pattern.regex)) {
        const other = match[1] as string;
        if (other === row.variable) continue;
        const before = pattern.direction === "self-first" ? row.variable : other;
        const after = pattern.direction === "self-first" ? other : row.variable;
        const id = `${before}>${after}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(Object.freeze({ before, after, pattern: pattern.name, statedBy: row.variable }));
      }
    }
  }
  return out.sort((a, b) => `${a.before}>${a.after}`.localeCompare(`${b.before}>${b.after}`));
}

/**
 * The chain of a key, or `undefined` where the relations do not put every
 * variable of the key in one chain. A chain is total: each variable but the
 * last has a relation to the next.
 */
export function chainOf(
  variables: readonly string[],
  relations: readonly AliasRelation[],
): readonly string[] | undefined {
  if (variables.length < 2) return undefined;
  const before = new Set(relations.map((r) => `${r.before}>${r.after}`));
  const sorted = [...variables].sort((a, b) => {
    if (before.has(`${a}>${b}`)) return -1;
    if (before.has(`${b}>${a}`)) return 1;
    return 0;
  });
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    if (!before.has(`${sorted[i]}>${sorted[i + 1]}`)) return undefined;
  }
  return Object.freeze(sorted);
}

/** Every key the table names, with the variables that reach it. */
export function buildKeys(
  rows: readonly AliasDataRow[],
  relations: readonly AliasRelation[],
): AliasKeyEntry[] {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind !== "key") continue;
    for (const key of row.keys) {
      byKey.set(key, [...(byKey.get(key) ?? []), row.variable]);
    }
  }
  const out: AliasKeyEntry[] = [];
  for (const [key, variables] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (variables.length === 1) {
      out.push(
        Object.freeze({ key, variables: Object.freeze([...variables]), resolution: "single" }),
      );
      continue;
    }
    // A chain is built from the concrete names only: a pattern row
    // (`SPECSTRIDE_<HARNESS>_CRITIC_MODEL`) stands for a name per harness and
    // is resolved against the concrete names at read time.
    const concrete = variables.filter((v) => !isPattern(v));
    const chain = chainOf(concrete, relations);
    out.push(
      Object.freeze({
        key,
        variables: Object.freeze([...variables]),
        resolution: chain === undefined ? "conflict" : "ordered",
        ...(chain === undefined ? {} : { order: chain }),
      }),
    );
  }
  return out;
}

/** Build the whole shipped data from the contract. */
export function build(tsvText: string): AliasTableData {
  const raw = parseTsv(tsvText);
  if (raw.length !== ALIAS_ROW_COUNT) {
    throw new Error(
      `contracts/alias-table.tsv: ${raw.length} rows, not the ${ALIAS_ROW_COUNT} of T005`,
    );
  }
  const rows = raw.map(buildRow);
  const relations = buildRelations(raw);
  return Object.freeze({
    schema: ALIAS_TABLE_SCHEMA_ID,
    source:
      "specs/110-config-and-terms/contracts/alias-table.tsv, from annex X §X.8 and spec.md §K.8; " +
      "generated by packages/config/tools/alias-table-gen.ts",
    rank: ALIAS_RANK,
    rowCount: rows.length,
    rows: Object.freeze(rows),
    relations: Object.freeze(relations),
    keys: Object.freeze(buildKeys(rows, relations)),
  });
}

/** The places of this repository. */
export function defaultPlaces(): { contractPath: string; dataPath: string } {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/config/tools
  const pkg = join(here, "..");
  const root = join(pkg, "..", "..");
  return {
    contractPath: join(root, "specs", "110-config-and-terms", "contracts", "alias-table.tsv"),
    dataPath: join(pkg, "data", "alias-table.json"),
  };
}

/** The data as it is written to disk. */
export function render(data: AliasTableData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Build the data from the contract of this repository. */
export function buildFromRepository(): AliasTableData {
  return build(readFileSync(defaultPlaces().contractPath, "utf8"));
}

/** The difference between the data on disk and the data the contract gives. */
export function check(): { ok: boolean; message: string } {
  const places = defaultPlaces();
  const expected = render(buildFromRepository());
  let actual: string;
  try {
    actual = readFileSync(places.dataPath, "utf8");
  } catch {
    return { ok: false, message: "packages/config/data/alias-table.json is missing" };
  }
  if (actual === expected)
    return { ok: true, message: "data/alias-table.json matches the contract" };
  return {
    ok: false,
    message:
      "packages/config/data/alias-table.json differs from " +
      "specs/110-config-and-terms/contracts/alias-table.tsv. " +
      "Run `node packages/config/tools/alias-table-gen.ts` to regenerate it.",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const verdict = check();
    process.stdout.write(`${verdict.message}\n`);
    process.exit(verdict.ok ? 0 : 1);
  }
  const data = buildFromRepository();
  writeFileSync(defaultPlaces().dataPath, render(data), "utf8");
  process.stdout.write(
    `wrote packages/config/data/alias-table.json: ${data.rows.length} rows, ` +
      `${data.relations.length} relations, ${data.keys.length} keys\n`,
  );
}
