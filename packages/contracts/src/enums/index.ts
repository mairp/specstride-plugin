/**
 * T070 — the mechanism of the closed sets (annex X, §X.6; F100-FR-208,
 * F100-FR-209; annex A §A.4, F100-FR-021).
 *
 * Every closed set of the product has a row in the table of §X.6, with its
 * owner, whether an owner decision or the design closes it, and what a reader
 * does with an unknown value. This module reads the table, gives the type of
 * a row and the type `ClosedSet<M>`, turns the column "unknown value" into
 * one of four rules, each a function, and holds the registration by which the
 * seven batch files of T250 to T256 add their sets to one map, assembled by
 * T257.
 */
import closedSetsData from "../../data/closed-sets.json" with { type: "json" };

/** One row of the table of §X.6, as `data/closed-sets.json` holds it. */
export type ClosedSetRow = {
  /** The number of the row; a set is identified by it (§X.6). */
  readonly number: number;
  /** The name of the set. */
  readonly name: string;
  /** The "Members, or where the list is" cell. */
  readonly members: string;
  /** The members, where the cell gives them as literals; else empty. */
  readonly literals: readonly string[];
  /** The feature that owns the set. */
  readonly owner: string;
  /** `Design`, `Owner decision` or `Open`. */
  readonly closedBy: string;
  /** What a reader does with a value outside the set. */
  readonly unknownValue: string;
};

type RawRow = {
  number: number;
  name: string;
  members: string;
  literals: string[];
  owner: string;
  closedBy: string;
  unknownValue: string;
};

/** The loader of `data/closed-sets.json` (F100-FR-208). */
export function loadClosedSetRows(): readonly ClosedSetRow[] {
  return Object.freeze(
    (closedSetsData as { closedSets: RawRow[] }).closedSets.map((row) =>
      Object.freeze({
        number: row.number,
        name: row.name,
        members: row.members,
        literals: Object.freeze([...row.literals]),
        owner: row.owner,
        closedBy: row.closedBy,
        unknownValue: row.unknownValue,
      }),
    ),
  );
}

/** Every row of the table of §X.6, in the order of the annex. */
export const closedSetRows: readonly ClosedSetRow[] = loadClosedSetRows();

const ROW_BY_NUMBER = new Map(closedSetRows.map((r) => [r.number, r]));

/** The row of a set number, or `undefined` where the table holds none. */
export function rowOf(number: number): ClosedSetRow | undefined {
  return ROW_BY_NUMBER.get(number);
}

/**
 * The feature number an owner cell names first. A compound owner such as
 * `100; 102` goes with its first number (T250 to T256).
 */
export function firstOwnerNumber(owner: string): number {
  const m = /\d+/.exec(owner);
  return m === null ? 0 : Number(m[0]);
}

/* ------------------------------------------------------------------ *
 * The kinds of unknown-value rule (annex X, §X.6, the column
 * "unknown value"), each as a function.
 * ------------------------------------------------------------------ */

/** The four kinds of rule the column uses. */
export const UNKNOWN_VALUE_KINDS = ["refuse", "show-as-unknown", "ignore", "default"] as const;
export type UnknownValueKind = (typeof UNKNOWN_VALUE_KINDS)[number];

/** What a reader does with a value outside the set. */
export type UnknownValueOutcome = {
  readonly kind: UnknownValueKind;
  /** The value the reader saw. */
  readonly value: string;
  /** The set it was read against. */
  readonly set: string;
  /** For `default`: the member the value is treated as. */
  readonly treatedAs?: string | undefined;
  /** For `show-as-unknown`: the reader raises an attention item. */
  readonly attentionItem?: boolean | undefined;
  /** The message a reader shows or records; it names the set and the value. */
  readonly message: string;
  /** The cell of the annex, verbatim. */
  readonly cell: string;
};

/** A rule of the column "unknown value", as a function. */
export type UnknownValueRule = (value: string, setName: string) => UnknownValueOutcome;

/** Refuse the record, naming the set and the value. */
export function refuse(cell: string): UnknownValueRule {
  return (value, set) => ({
    kind: "refuse",
    value,
    set,
    message: `refused: "${value}" is not a member of the closed set "${set}" (${cell})`,
    cell,
  });
}

/** Show the value as `unknown`, with an attention item. */
export function showAsUnknown(cell: string): UnknownValueRule {
  return (value, set) => ({
    kind: "show-as-unknown",
    value,
    set,
    attentionItem: true,
    message: `"${value}" is not a member of the closed set "${set}"; shown as \`unknown\` (${cell})`,
    cell,
  });
}

/** Ignore the value. */
export function ignore(cell: string): UnknownValueRule {
  return (value, set) => ({
    kind: "ignore",
    value,
    set,
    message: `"${value}" is not a member of the closed set "${set}"; ignored (${cell})`,
    cell,
  });
}

/** Treat the value as the named default. */
export function treatAs(member: string, cell: string): UnknownValueRule {
  return (value, set) => ({
    kind: "default",
    value,
    set,
    treatedAs: member,
    message: `"${value}" is not a member of the closed set "${set}"; read as \`${member}\` (${cell})`,
    cell,
  });
}

/** A member the cell names, where it gives one as a literal in back-ticks. */
function namedDefault(cell: string): string | undefined {
  const m = /`([^`]+)`/.exec(cell);
  return m?.[1];
}

/**
 * The rule of a row, read from its column "unknown value" (annex X, §X.6).
 * The four kinds are the ones the column uses: refuse the record naming the
 * set and the value; show as `unknown` with an attention item; ignore; treat
 * as the named default.
 */
export function unknownValueRuleOf(cell: string): UnknownValueRule {
  const text = cell.trim();
  if (/^not applicable/i.test(text)) return ignore(text);
  if (/\bignored?\b/i.test(text) && !/refus/i.test(text)) return ignore(text);
  if (/`unknown`/.test(text)) return showAsUnknown(text);
  const named = namedDefault(text);
  if (named !== undefined && /^(read as|treated as|class|shown as|the class)/i.test(text)) {
    return treatAs(named, text);
  }
  if (/refus|invalid|error|fails|withheld|dropped|halt|exit \d|is a crash|gives 1/i.test(text)) {
    return refuse(text);
  }
  if (named !== undefined) return treatAs(named, text);
  return refuse(text);
}

/* ------------------------------------------------------------------ *
 * The type `ClosedSet<M>` and the registration.
 * ------------------------------------------------------------------ */

/** A closed set of the product (annex X, §X.6). */
export type ClosedSet<M extends string = string> = {
  /** The name of the set, as the row writes it. */
  readonly name: string;
  /** The number of the row of §X.6. */
  readonly number: number;
  /** The feature that owns the set. */
  readonly owner: string;
  /** The members, as a readonly tuple. Empty where the row points elsewhere. */
  readonly members: readonly M[];
  /** True when the value is a member. */
  has(value: string): value is M;
  /** What a reader does with a value outside the set. */
  onUnknown(value: string): UnknownValueOutcome;
};

/** A set whose row gives no literals: it refers to another table of the package. */
export type SetByReference<M extends string = string> = ClosedSet<M> & {
  readonly byReference: true;
};

/** The map every batch registers into; T257 assembles it. */
const REGISTRY = new Map<number, ClosedSet>();

/** A registration whose number the table does not hold, or that is a duplicate. */
export class ClosedSetRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedSetRegistrationError";
  }
}

/**
 * Build a closed set from its row and its members, and register it in the map
 * (F100-FR-208). `members` is the `literals` of the row, or the members of
 * the export a row without literals refers to.
 */
export function defineClosedSet<const M extends readonly string[]>(
  number: number,
  members: M,
): ClosedSet<M[number]> {
  const row = rowOf(number);
  if (row === undefined) {
    throw new ClosedSetRegistrationError(
      `the table of annex X §X.6 holds no row ${number}; a feature that introduces a ` +
        `closed set states its facts in its own specification so that the row can be ` +
        `added (F100-FR-208)`,
    );
  }
  const rule = unknownValueRuleOf(row.unknownValue);
  const list = Object.freeze([...members]) as readonly M[number][];
  const set: ClosedSet<M[number]> = Object.freeze({
    name: row.name,
    number: row.number,
    owner: row.owner,
    members: list,
    has(value: string): value is M[number] {
      return (list as readonly string[]).includes(value);
    },
    onUnknown(value: string): UnknownValueOutcome {
      return rule(value, row.name);
    },
  });
  register(set);
  return set;
}

/** Register a set in the one map (T257 asserts the map is complete). */
export function register(set: ClosedSet): void {
  const seen = REGISTRY.get(set.number);
  if (seen !== undefined && seen !== set) {
    throw new ClosedSetRegistrationError(
      `the closed set ${set.number} ("${set.name}") is registered twice (F100-FR-208)`,
    );
  }
  REGISTRY.set(set.number, set);
}

/**
 * A row without literals refers to another table of the package: it registers
 * by reference to that export (T250 to T256).
 */
export function defineByReference<const M extends readonly string[]>(
  number: number,
  members: M,
): SetByReference<M[number]> {
  const set = defineClosedSet(number, members);
  return Object.freeze({ ...set, byReference: true as const });
}

/** The map as it stands; T257 exports the assembled one as `closedSets`. */
export function registeredSets(): ReadonlyMap<number, ClosedSet> {
  return REGISTRY;
}

/** The numbers of every row of §X.6, in the order of the annex. */
export const ALL_SET_NUMBERS: readonly number[] = Object.freeze(closedSetRows.map((r) => r.number));

/**
 * F100-FR-209 — a reader without a branch for an unknown value fails. A
 * reader gives its branches; `readMember` refuses when the value is outside
 * the set and no branch for the unknown value was given.
 */
export class NoUnknownBranchError extends Error {
  constructor(setName: string, value: string) {
    super(
      `the reader of the closed set "${setName}" has no branch for the unknown value ` +
        `"${value}" (F100-FR-209)`,
    );
    this.name = "NoUnknownBranchError";
  }
}

export function readMember<M extends string>(
  set: ClosedSet<M>,
  value: string,
  onUnknown?: (outcome: UnknownValueOutcome) => M,
): M {
  if (set.has(value)) return value;
  if (onUnknown === undefined) throw new NoUnknownBranchError(set.name, value);
  return onUnknown(set.onUnknown(value));
}
