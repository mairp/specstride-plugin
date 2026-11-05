/**
 * T283 — the keys of every supervisor line and every product line as data from
 * `supervisorLines` and `productLines` of `data/line-grammar.json`, with their
 * printer, and the substitution of an implementation file by its logical
 * component name through the component-name table of annex X §X.8 (annex G,
 * §G.3; F100-FR-178, F100-FR-181).
 *
 * A slice of T192: `lines.ts` gives the form and the families; this module
 * gives the keys of the two families whose lines two or more features read.
 */
import lineGrammar from "../../data/line-grammar.json" with { type: "json" };
import normalization from "../../data/normalization.json" with { type: "json" };
import { formatValue, printPairs, familyOfLabel, type Stream } from "./lines.ts";

/** The section of annex G that owns the tables of keys. */
export const ANNEX_SECTION = "annex G, §G.3" as const;

/** The section of annex X that owns the component-name table. */
export const COMPONENT_NAME_SECTION = "annex X, §X.8" as const;

/* ------------------------------------------------------------------ *
 * The keys of the supervisor lines and of the product lines.
 * ------------------------------------------------------------------ */

type RawSupervisor = { Line: string; Keys: string };
type RawProduct = { Line: string; Keys: string; "Printed by": string };

/** One key of a line, with whether the table marks it optional. */
export type LineKey = { readonly key: string; readonly optional: boolean };

/** One row of the table of keys of a line. */
export type LineKeyRow = {
  /** The `Line` cell as the annex writes it, prose and all. */
  readonly cell: string;
  /** The label, without its square brackets. */
  readonly label: string;
  /** The discriminant of a row that names one (`check=` or `decision=` of `[MOL-GATE]`). */
  readonly discriminant: string | null;
  /** The keys of the line, in the order of the table. */
  readonly keys: readonly LineKey[];
  /** The `Keys` cell as the annex writes it. */
  readonly keysCell: string;
  /** Who prints the line, where the table names it. */
  readonly printedBy: string | null;
};

/** The label a `Line` cell names: the text inside the square brackets. */
function labelOf(cell: string): string {
  const match = /\[([A-Z0-9-]+)\]/.exec(cell);
  return match === null ? "" : match[1];
}

/** The discriminant a `Line` cell names, as in "`[MOL-GATE]` with `check=`". */
function discriminantOf(cell: string): string | null {
  const match = /with `([a-z-]+)=`/.exec(cell);
  return match === null ? null : match[1];
}

/**
 * The keys a `Keys` cell names, in the order of the cell. The word "optional"
 * marks every key after it in the cell; a key in brackets after a key (the
 * values of `status` and `decision`) is not a key of its own.
 */
function keysOf(keysCell: string): readonly LineKey[] {
  const out: LineKey[] = [];
  let optional = false;
  let index = 0;
  // The cell of `[MOL-RETRO]` ends with a sentence about a COPIED line, whose
  // back-ticked word (`learn`) is no key of the line; the cell is cut there.
  const copied = keysCell.indexOf("; a copied evaluation line");
  const cell = copied < 0 ? keysCell : keysCell.slice(0, copied);
  // Walk the cell, so that "optional" applies to the keys that follow it.
  for (const match of cell.matchAll(/`([^`]+)`|\boptional\b/g)) {
    if (match[0] === "optional") {
      optional = true;
      continue;
    }
    const value = match[1].trim();
    index += 1;
    // A parenthesised list after a key gives that key's values, not new keys.
    const before = cell.slice(0, match.index ?? 0);
    const open = before.lastIndexOf("(");
    const close = before.lastIndexOf(")");
    if (open > close) continue;
    if (value === "" || /\s/.test(value)) continue;
    if (out.some((k) => k.key === value)) continue;
    out.push(Object.freeze({ key: value, optional }));
  }
  void index;
  return Object.freeze(out);
}

/** Load the keys of the supervisor lines (§G.3). */
export function loadSupervisorLines(): readonly LineKeyRow[] {
  return Object.freeze(
    (lineGrammar as { supervisorLines: RawSupervisor[] }).supervisorLines.map((row) =>
      Object.freeze({
        cell: row.Line,
        label: labelOf(row.Line),
        discriminant: discriminantOf(row.Line),
        keys: keysOf(row.Keys),
        keysCell: row.Keys,
        printedBy: null,
      }),
    ),
  );
}

/** Load the keys of the product lines (§G.3). */
export function loadProductLines(): readonly LineKeyRow[] {
  return Object.freeze(
    (lineGrammar as { productLines: RawProduct[] }).productLines.map((row) =>
      Object.freeze({
        cell: row.Line,
        label: labelOf(row.Line),
        discriminant: discriminantOf(row.Line),
        keys: keysOf(row.Keys),
        keysCell: row.Keys,
        printedBy: row["Printed by"],
      }),
    ),
  );
}

/** The rows of the table of supervisor lines, in the order of the annex. */
export const supervisorLines: readonly LineKeyRow[] = loadSupervisorLines();

/** The rows of the table of product lines, in the order of the annex. */
export const productLines: readonly LineKeyRow[] = loadProductLines();

/** Every row of both tables. */
export const lineKeyRows: readonly LineKeyRow[] = Object.freeze([
  ...supervisorLines,
  ...productLines,
]);

/** The prefix of every label of the product lines (§G.3). */
export const PRODUCT_LINE_PREFIX = "SPECSTRIDE-" as const;

/** The prefix of every label of the supervisor lines (§G.3). */
export const SUPERVISOR_LINE_PREFIX = "MOL-" as const;

/** The rows of a label; `[MOL-GATE]` has two, one per discriminant. */
export function rowsOfLabel(label: string): readonly LineKeyRow[] {
  return Object.freeze(lineKeyRows.filter((row) => row.label === label));
}

/** The row of a label and, where the label has two, a discriminant. */
export function rowOf(label: string, discriminant?: string): LineKeyRow | undefined {
  const rows = rowsOfLabel(label);
  if (rows.length <= 1) return rows[0];
  return rows.find((row) => row.discriminant === discriminant) ?? rows[0];
}

/** The keys of a label, in the order of the table. */
export function keysOfLabel(label: string, discriminant?: string): readonly LineKey[] {
  return rowOf(label, discriminant)?.keys ?? Object.freeze([]);
}

/** A key the table of a line does not hold. */
export class UnknownLineKeyError extends Error {
  readonly label: string;
  readonly key: string;
  constructor(label: string, key: string, known: readonly string[]) {
    super(
      `the line \`[${label}]\` has no key \`${key}\`; its keys are ${known.join(", ")} ` +
        "(annex G, §G.3; F100-FR-178)",
    );
    this.name = "UnknownLineKeyError";
    this.label = label;
    this.key = key;
  }
}

/**
 * The printer of a supervisor line or a product line: pairs `key=value`
 * separated by one space, in the order of the table, a text value quoted as in
 * JSON. A key the table does not hold is refused, so that a feature cannot add
 * a key to a line of the tables of §G.3 (F100-FR-178).
 */
export function printLine(
  label: string,
  values: Readonly<Record<string, string | number | boolean | null>>,
  options: { readonly discriminant?: string | undefined } = {},
): string {
  const row = rowOf(label, options.discriminant);
  const known = (row?.keys ?? []).map((k) => k.key);
  for (const key of Object.keys(values)) {
    if (!known.includes(key)) throw new UnknownLineKeyError(label, key, known);
  }
  const pairs = known
    .filter((key) => values[key] !== undefined)
    .map(
      (key) =>
        Object.freeze([key, values[key]]) as readonly [string, string | number | boolean | null],
    );
  return printPairs(label, pairs);
}

/** The keys of a line that the table marks as required (not "optional"). */
export function requiredKeysOf(label: string, discriminant?: string): readonly string[] {
  return Object.freeze(
    keysOfLabel(label, discriminant)
      .filter((k) => !k.optional)
      .map((k) => k.key),
  );
}

/** The stream a line of the two tables goes to (§G.3, through `lines.ts`). */
export function streamOf(label: string): Stream | undefined {
  const f = familyOfLabel(label);
  return f === undefined ? undefined : f.stream;
}

/* ------------------------------------------------------------------ *
 * F100-FR-181 — the component-name table.
 * ------------------------------------------------------------------ */

type RawComponent = { "As-is implementation file": string; "Logical component name": string };

/** One row of the component-name table of annex X §X.8. */
export type ComponentNameRow = {
  /** The as-is implementation file, as the table names it. */
  readonly asIs: string;
  /** The logical component name, or names where the row gives more than one. */
  readonly names: readonly string[];
};

/** Load the component-name table from `data/normalization.json` (F100-FR-181). */
export function loadComponentNames(): readonly ComponentNameRow[] {
  return Object.freeze(
    (normalization as { componentNames: RawComponent[] }).componentNames.map((row) =>
      Object.freeze({
        asIs: row["As-is implementation file"],
        names: Object.freeze(
          [...row["Logical component name"].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()),
        ),
      }),
    ),
  );
}

/** The component-name table, in the order of the annex. */
export const componentNames: readonly ComponentNameRow[] = loadComponentNames();

/** Every logical component name of the table. */
export const COMPONENT_NAMES: readonly string[] = Object.freeze(
  componentNames.flatMap((row) => [...row.names]),
);

/** True where the value is a logical component name of the table. */
export function isComponentName(value: string): boolean {
  return COMPONENT_NAMES.includes(value);
}

/**
 * §X.8 — a prefix the table does not hold is compared as written. The
 * substitution therefore leaves such a prefix alone.
 */
export const A_PREFIX_THE_TABLE_DOES_NOT_HOLD = "is compared as written" as const;

/**
 * The map from an as-is implementation file to its logical component name. The
 * callers of the substitution hand a file name; a row that gives more than one
 * name is a row of more than one file, so the owner of the line states which
 * name it uses and the map holds the first as the default.
 */
export const COMPONENT_NAME_OF: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    componentNames.flatMap((row) =>
      row.names.length === 1 ? [[row.asIs, row.names[0]]] : [[row.asIs, row.names[0]]],
    ),
  ),
);

/**
 * F100-FR-181 — the substitution of an implementation file by its logical
 * component name, leaving the text after the name EQUAL to the baseline's.
 *
 * The message is read as a name, a separator and the rest. Where the name is
 * one the table holds, it is replaced by the logical component name and the
 * rest is left byte for byte as it was. Where it is not, the message is
 * returned as written (§X.8).
 */
export function substituteComponentName(
  message: string,
  table: Readonly<Record<string, string>> = COMPONENT_NAME_OF,
): string {
  for (const [asIs, name] of Object.entries(table)) {
    if (asIs === "" || !message.startsWith(asIs)) continue;
    return `${name}${message.slice(asIs.length)}`;
  }
  return message;
}

/** The text of a message after its name: what the substitution leaves equal. */
export function textAfterTheName(
  message: string,
  table: Readonly<Record<string, string>> = COMPONENT_NAME_OF,
): string {
  for (const asIs of Object.keys(table)) {
    if (asIs !== "" && message.startsWith(asIs)) return message.slice(asIs.length);
  }
  return message;
}

/**
 * F100-FR-181 — the substitution is correct when the text after the name is
 * equal to the baseline's.
 */
export function textAfterTheNameIsEqual(
  baseline: string,
  ported: string,
  table: Readonly<Record<string, string>> = COMPONENT_NAME_OF,
): boolean {
  const after = textAfterTheName(baseline, table);
  return ported.endsWith(after);
}

export { formatValue };
