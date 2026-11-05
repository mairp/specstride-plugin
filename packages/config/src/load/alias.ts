/**
 * T026 — the environment aliases and the conflict error (F110-FR-020).
 *
 * F110-FR-020 states six things, and each is a named export here:
 *
 * 1. The as-is environment variables stay as aliases of keys, through the
 *    table of annex X §X.8 and §K.8 — `ALIAS_TABLE`, shipped as
 *    `packages/config/data/alias-table.json` and generated from
 *    `specs/110-config-and-terms/contracts/alias-table.tsv` by
 *    `packages/config/tools/alias-table-gen.ts`.
 * 2. They are read at rank 4 only — `ALIAS_RANK`.
 * 3. A variable named in the table reaches the key or the keys named there —
 *    `keysOfVariable`, which resolves an exact row, a pattern row
 *    (`SPECSTRIDE_<HARNESS>_CRITIC_MODEL`) and a family row
 *    (`SPECSTRIDE_REVERSE_*`).
 * 4. When two environment names reach one key and their values differ, the
 *    launch is refused with both names in the message — `AliasConflictError`,
 *    raised by `aliasOffers`.
 * 5. The `WIGGUM_*` family is not read and no deprecation line is printed —
 *    `WIGGUM_FAMILY_IS_READ`, `isWiggumName`, and `aliasOffers`, which drops
 *    such a name without a message of any kind.
 * 6. The prime launcher pair is the one exception: the two names reach one key
 *    and do not refuse the launch when they differ; the first set wins, and an
 *    empty first variable is read as unset — the `ordered` resolution of
 *    `harnesses.prime.launcher` and the row flag `emptyIsUnset`.
 *
 * Nothing of the table is restated here: the rows, the order relations the
 * notes state in prose, and the resolution of every key that more than one
 * variable reaches are all read out of the shipped data.
 */
import type { RankLayer } from "@specstride/contracts/envelope/config";

import { CATALOGUE } from "../schema/catalogue.ts";
import { derivedEnvironmentName } from "../schema/spelling.ts";
import { validateKeyValue } from "../schema/validate.ts";
import { ConfigValueError, UnknownKeyError } from "../schema/types.ts";
import type { ConfigOffer } from "./merge.ts";

import ALIAS_TABLE_DATA from "../../data/alias-table.json" with { type: "json" };

/** What a row of the table says about its variable. */
export type AliasRowKind = "key" | "family" | "no-key" | "not-carried";

/** One row of the alias table (§K.8, annex X §X.8). */
export interface AliasRow {
  readonly variable: string;
  readonly kind: AliasRowKind;
  readonly keys: readonly string[];
  readonly keyPattern?: string | undefined;
  readonly variableIsPattern: boolean;
  readonly emptyIsUnset?: true | undefined;
  readonly secondsToMilliseconds?: true | undefined;
  readonly acceptedWithoutEffect?: true | undefined;
  readonly note: string;
}

/** One order relation between two variables, as a note of the table states it. */
export interface AliasRelation {
  readonly before: string;
  readonly after: string;
  readonly pattern: string;
  readonly statedBy: string;
}

/** How the variables that reach one key are resolved against each other. */
export type AliasResolution = "single" | "ordered" | "conflict";

/** One key of the table, with the variables that reach it. */
export interface AliasKeyEntry {
  readonly key: string;
  readonly variables: readonly string[];
  readonly resolution: AliasResolution;
  readonly order?: readonly string[] | undefined;
}

/** The whole shipped alias table. */
export interface AliasTable {
  readonly schema: string;
  readonly source: string;
  readonly rank: number;
  readonly rowCount: number;
  readonly rows: readonly AliasRow[];
  readonly relations: readonly AliasRelation[];
  readonly keys: readonly AliasKeyEntry[];
}

/** The alias table of §K.8 and annex X §X.8, as the package ships it. */
export const ALIAS_TABLE = ALIAS_TABLE_DATA as unknown as AliasTable;

/** Every row of the table, one per as-is variable. */
export const ALIAS_ROWS: readonly AliasRow[] = Object.freeze([...ALIAS_TABLE.rows]);

/** Every order relation the notes of the table state. */
export const ALIAS_RELATIONS: readonly AliasRelation[] = Object.freeze([...ALIAS_TABLE.relations]);

/** Every key the table names, with the variables that reach it. */
export const ALIAS_KEYS: readonly AliasKeyEntry[] = Object.freeze([...ALIAS_TABLE.keys]);

/**
 * F110-FR-020, second sentence — an as-is name is read at rank 4 only. The
 * rank itself is feature 100's contract; this is the layer the alias stands at.
 */
export const ALIAS_RANK = 4 as const;
export const ALIAS_LAYER: RankLayer = "environment";

/** F110-FR-020, fourth sentence — the `WIGGUM_*` family is never read. */
export const WIGGUM_FAMILY_IS_READ = false as const;

/** F110-FR-020, fourth sentence — and no deprecation line is printed for it. */
export const WIGGUM_DEPRECATION_LINE_IS_PRINTED = false as const;

/** True where a name belongs to the `WIGGUM_*` family (DV-036, B-0346). */
export function isWiggumName(name: string): boolean {
  return name.startsWith("WIGGUM_");
}

/* ------------------------------------------------------------------ *
 * Reading one variable name into the row and the keys it reaches.
 * ------------------------------------------------------------------ */

/** A row whose variable cell is written with parentheses names no name. */
function isParenthetical(variable: string): boolean {
  return variable.startsWith("(");
}

/**
 * The regular expression a pattern row matches a concrete name with. A
 * parameter segment (`<HARNESS>`, `<N>`, `<X>`) stands for one segment of the
 * name and never crosses an underscore; a `*` tail stands for the rest.
 */
function patternOf(variable: string): RegExp {
  const source = variable
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/<[A-Z_]+>/g, "([A-Z0-9]+)")
    .replace(/\*/g, "([A-Z0-9_]*)");
  return new RegExp(`^${source}$`);
}

/** One row of the table matched against a concrete variable name. */
export interface AliasMatch {
  readonly row: AliasRow;
  /** The parameters the pattern captured, in the order they appear. */
  readonly parameters: readonly string[];
  /** The keys the match reaches, with every parameter substituted. */
  readonly keys: readonly string[];
}

/**
 * The keys of a family row for one concrete name: the keys of the named
 * namespace whose derived environment name (§K.2 rule 3) is that name. This is
 * what the note "each the key of the same meaning" means mechanically, and it
 * resolves `SPECSTRIDE_REVERSE_*`. A family whose variable tail is not the key
 * tail — the catch-all row `loop.yield.<key>` of §K.8 — resolves to nothing,
 * and `unresolvedFamilyNames` reports it rather than guessing.
 */
function familyKeysFor(row: AliasRow, name: string): readonly string[] {
  const namespace = (row.keyPattern ?? "").replace(/[*]$|<key>$/, "");
  const found = CATALOGUE.filter(
    (entry) => entry.key.startsWith(namespace) && derivedEnvironmentName(entry.key) === name,
  ).map((entry) => entry.key);
  return Object.freeze(found);
}

/** Substitute the captured parameters into a key template of the table. */
function substitute(key: string, parameters: readonly string[]): string {
  let index = 0;
  return key.replace(/<[A-Za-z]+>/g, (token) => {
    const value = parameters[index];
    index += 1;
    if (value === undefined) return token;
    // The key of a harness carries the id in lower case (`harnesses.dsh.bin`);
    // the key of a phase carries the number as written.
    return /^[0-9]+$/.test(value) ? value : value.toLowerCase();
  });
}

const EXACT_ROWS: ReadonlyMap<string, AliasRow> = new Map(
  ALIAS_ROWS.filter((row) => !row.variableIsPattern).map((row) => [row.variable, row]),
);

const PATTERN_ROWS: readonly { readonly row: AliasRow; readonly regex: RegExp }[] = Object.freeze(
  ALIAS_ROWS.filter((row) => row.variableIsPattern && !isParenthetical(row.variable)).map((row) =>
    Object.freeze({ row, regex: patternOf(row.variable) }),
  ),
);

/**
 * The row of the table that covers a concrete variable name: the exact row
 * first, then a pattern row. A name no row covers is not an alias.
 */
export function aliasMatchFor(name: string): AliasMatch | undefined {
  const exact = EXACT_ROWS.get(name);
  if (exact !== undefined) {
    return Object.freeze({
      row: exact,
      parameters: Object.freeze([]),
      keys: exact.kind === "family" ? familyKeysFor(exact, name) : exact.keys,
    });
  }
  for (const candidate of PATTERN_ROWS) {
    const match = name.match(candidate.regex);
    if (match === null) continue;
    const parameters = Object.freeze(match.slice(1));
    return Object.freeze({
      row: candidate.row,
      parameters,
      keys:
        candidate.row.kind === "family"
          ? familyKeysFor(candidate.row, name)
          : Object.freeze(candidate.row.keys.map((key) => substitute(key, parameters))),
    });
  }
  return undefined;
}

/** The row of the table for a variable, by its own spelling. */
export function aliasRow(variable: string): AliasRow | undefined {
  return EXACT_ROWS.get(variable) ?? ALIAS_ROWS.find((row) => row.variable === variable);
}

/**
 * F110-FR-020, third sentence — the key or the keys a variable named in the
 * table reaches. A variable of the kind `no-key` or `not-carried` reaches none.
 */
export function keysOfVariable(name: string): readonly string[] {
  const match = aliasMatchFor(name);
  if (match === undefined) return Object.freeze([]);
  if (match.row.kind === "no-key" || match.row.kind === "not-carried") return Object.freeze([]);
  return match.keys;
}

/** Every variable of the table that names a key, in the table's order. */
export function variablesOfKey(key: string): readonly string[] {
  return ALIAS_KEYS.find((entry) => entry.key === key)?.variables ?? Object.freeze([]);
}

/** How the variables that reach one key are resolved (`single` where it has one). */
export function resolutionOfKey(key: string): AliasResolution | undefined {
  return ALIAS_KEYS.find((entry) => entry.key === key)?.resolution;
}

/** True where the table states that `before` is read before `after`. */
export function isReadBefore(before: string, after: string): boolean {
  return ALIAS_RELATIONS.some((r) => r.before === before && r.after === after);
}

/**
 * §K.2 rule 3, second sentence — the as-is name replaces the derived name
 * where the baseline has one. The map is key to as-is name, which is what
 * `environmentNameOf` of `src/schema/spelling.ts` takes. Where a key has more
 * than one as-is name the first of its chain is the name, and for a key the
 * table resolves as a conflict the first name of the table's own order.
 */
export function aliasMap(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of ALIAS_KEYS) {
    const names = entry.order ?? entry.variables;
    const concrete = names.find((name) => !/[*<]/.test(name));
    if (concrete !== undefined) out.set(entry.key, concrete);
  }
  return out;
}

/** The names of the table that reach no key but are names of the platform. */
export function platformNames(): readonly string[] {
  return Object.freeze(ALIAS_ROWS.filter((r) => r.kind === "no-key").map((r) => r.variable));
}

/** The names of the table that the port does not carry (DV-036, DV-064). */
export function notCarriedNames(): readonly string[] {
  return Object.freeze(ALIAS_ROWS.filter((r) => r.kind === "not-carried").map((r) => r.variable));
}

/**
 * A family row of the table that no mechanical rule resolves to a key: the
 * variable tail is not the key tail. Reported, never guessed.
 */
export function unresolvedFamilyNames(): readonly string[] {
  return Object.freeze(
    ALIAS_ROWS.filter(
      (row) =>
        row.kind === "family" &&
        !isParenthetical(row.variable) &&
        !row.variableIsPattern &&
        familyKeysFor(row, row.variable).length === 0,
    ).map((row) => row.variable),
  );
}

/* ------------------------------------------------------------------ *
 * F110-FR-020, fourth sentence — the conflict error.
 * ------------------------------------------------------------------ */

/**
 * Two environment names reach one key and their values differ. The launch is
 * refused and both names are in the message (F110-FR-020).
 */
export class AliasConflictError extends Error {
  readonly reason = "alias-conflict" as const;
  readonly key: string;
  /** Both names, in the order the table lists them. */
  readonly names: readonly string[];
  /** The text of each name, in the same order; never a secret value. */
  readonly values: readonly string[];
  constructor(fields: { key: string; names: readonly string[]; values: readonly string[] }) {
    super(
      `the environment names \`${fields.names.join("` and `")}\` both reach the key ` +
        `\`${fields.key}\` and their values differ. ` +
        `Set one of them, or set the key with \`--set ${fields.key}=<value>\``,
    );
    this.name = "AliasConflictError";
    this.key = fields.key;
    this.names = Object.freeze([...fields.names]);
    this.values = Object.freeze([...fields.values]);
  }
}

/** A variable of the table that is accepted and has no effect (CQ-120). */
export function acceptedWithoutEffectNames(): readonly string[] {
  return Object.freeze(
    ALIAS_ROWS.filter((r) => r.acceptedWithoutEffect === true).map((r) => r.variable),
  );
}

/** §K.8 — the as-is value of the two shipper timeouts is decimal seconds. */
export function convertedText(row: AliasRow, text: string): string {
  if (row.secondsToMilliseconds !== true) return text;
  const seconds = Number(text);
  if (!Number.isFinite(seconds)) return text;
  return String(Math.round(seconds * 1000));
}

/** One name of the environment that reaches a key, after the table read it. */
interface Candidate {
  readonly name: string;
  readonly text: string;
  readonly row: AliasRow;
}

/** What `aliasOffers` found in one environment. */
export interface AliasReading {
  /** The offers of rank 4, one per key one name reached. */
  readonly offers: readonly ConfigOffer[];
  /** Type and range errors, and one `AliasConflictError` per conflicting key. */
  readonly errors: readonly (ConfigValueError | UnknownKeyError | AliasConflictError)[];
  /** The conflicts, also listed on their own (F110-FR-020). */
  readonly conflicts: readonly AliasConflictError[];
  /** The `SPECSTRIDE_` names that reach no key of the catalogue. */
  readonly unknownNames: readonly string[];
  /** The names a higher name of the same key shadowed, with the winner. */
  readonly shadowedNames: readonly {
    readonly key: string;
    readonly name: string;
    readonly by: string;
  }[];
  /** The `WIGGUM_*` names present, which are dropped without any message. */
  readonly wiggumNamesIgnored: readonly string[];
  /** Launch messages the table itself asks for (CQ-120). */
  readonly launchMessages: readonly string[];
}

/**
 * F110-FR-020 — read an environment through the alias table.
 *
 * Every name is looked up in the table. A name of the kind `no-key` or
 * `not-carried` reaches no key and is silent; a `WIGGUM_*` name is dropped with
 * no message of any kind; a `SPECSTRIDE_` name that no row covers and that is
 * not the derived name of a key is reported as unknown. For a key that several
 * names reached, the order relations of the table decide: a name another set
 * name is read before is shadowed, and if more than one name survives with
 * differing texts the launch is refused with both names.
 */
export function aliasOffers(
  environment: Readonly<Record<string, string | undefined>>,
): AliasReading {
  const offers: ConfigOffer[] = [];
  const errors: (ConfigValueError | UnknownKeyError | AliasConflictError)[] = [];
  const conflicts: AliasConflictError[] = [];
  const unknownNames: string[] = [];
  const shadowedNames: { key: string; name: string; by: string }[] = [];
  const wiggumNamesIgnored: string[] = [];
  const launchMessages: string[] = [];

  const byKey = new Map<string, Candidate[]>();
  for (const [name, text] of Object.entries(environment)) {
    if (text === undefined) continue;
    if (isWiggumName(name)) {
      // F110-FR-020: not read, and no deprecation line.
      wiggumNamesIgnored.push(name);
      continue;
    }
    const match = aliasMatchFor(name);
    if (match !== undefined) {
      if (match.row.acceptedWithoutEffect === true) {
        launchMessages.push(
          `\`${name}\` is accepted and has no effect in this product (§K.8, CQ-120)`,
        );
      }
      if (match.row.kind === "no-key" || match.row.kind === "not-carried") continue;
      // §K.8, the prime launcher pair: an empty first variable is read as unset.
      if (match.row.emptyIsUnset === true && text === "") continue;
      if (match.keys.length === 0) continue;
      for (const key of match.keys) {
        byKey.set(key, [
          ...(byKey.get(key) ?? []),
          { name, text: convertedText(match.row, text), row: match.row },
        ]);
      }
      continue;
    }
    if (!name.startsWith("SPECSTRIDE_")) continue;
    // Not an as-is name: it may still be the derived name of a key (§K.2 rule 3).
    const derived = CATALOGUE.find(
      (entry) => !entry.isTemplate && derivedEnvironmentName(entry.key) === name,
    );
    if (derived === undefined) {
      unknownNames.push(name);
      continue;
    }
    byKey.set(derived.key, [
      ...(byKey.get(derived.key) ?? []),
      { name, text, row: { ...(aliasRow(name) ?? EMPTY_ROW), variable: name } },
    ]);
  }

  for (const [key, candidates] of byKey) {
    // A name that another present name is read before is shadowed.
    const surviving = candidates.filter(
      (candidate) => !candidates.some((other) => isReadBefore(other.name, candidate.name)),
    );
    for (const candidate of candidates) {
      if (surviving.includes(candidate)) continue;
      const winner = candidates.find((other) => isReadBefore(other.name, candidate.name));
      shadowedNames.push({ key, name: candidate.name, by: winner?.name ?? "" });
    }
    const texts = [...new Set(surviving.map((c) => c.text))];
    if (surviving.length > 1 && texts.length > 1) {
      const conflict = new AliasConflictError({
        key,
        names: surviving.map((c) => c.name),
        values: surviving.map((c) => c.text),
      });
      conflicts.push(conflict);
      errors.push(conflict);
      continue;
    }
    const winner = surviving[0];
    if (winner === undefined) continue;
    const verdict = validateKeyValue(key, winner.text, "E", {
      place: winner.name,
      fromText: true,
    });
    if (verdict.ok) {
      offers.push(
        Object.freeze({
          key,
          layer: ALIAS_LAYER,
          value: verdict.value,
          place: winner.name,
        }),
      );
    } else {
      errors.push(verdict.error);
    }
  }

  return Object.freeze({
    offers: Object.freeze(offers),
    errors: Object.freeze(errors),
    conflicts: Object.freeze(conflicts),
    unknownNames: Object.freeze(unknownNames),
    shadowedNames: Object.freeze(shadowedNames.map((s) => Object.freeze(s))),
    wiggumNamesIgnored: Object.freeze(wiggumNamesIgnored),
    launchMessages: Object.freeze(launchMessages),
  });
}

/** The row a derived name stands in, where the table has none for it. */
const EMPTY_ROW: AliasRow = Object.freeze({
  variable: "",
  kind: "key",
  keys: Object.freeze([]),
  variableIsPattern: false,
  note: "",
});
