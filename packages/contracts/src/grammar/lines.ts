/**
 * T192 — the parser and the formatter of a labelled line (annex G, §G.3;
 * F100-FR-178).
 *
 * The form of a labelled line is: an opening square bracket, a label, a
 * closing square bracket, one space, a body, the end of the line. A label is
 * made of upper-case letters, digits and hyphens.
 *
 * One family per row of `families` of `data/line-grammar.json`, with its
 * labels, its body form, its printer and its stream. A label of one family
 * never appears in another: `familyOfLabel` is a function, and
 * `assertLabelsAreDisjoint` proves it at load.
 *
 * Row 81 of `data/closed-sets.json` ("Labels of output lines") takes its
 * members from this module.
 */
import lineGrammar from "../../data/line-grammar.json" with { type: "json" };

/** The section of annex G that owns the grammar. */
export const ANNEX_SECTION = "annex G, §G.3" as const;

/** The form of a labelled line, as `data/line-grammar.json` states it. */
export const FORM: string = (lineGrammar as { form: string }).form;

/** The pattern of a label, as `data/line-grammar.json` states it. */
export const LABEL_PATTERN_SOURCE: string = (lineGrammar as { label: string }).label;

/** The pattern of a label: upper-case letters, digits and hyphens. */
export const LABEL_PATTERN = new RegExp(LABEL_PATTERN_SOURCE);

/** The one separator between the label and the body: one space. */
export const SEPARATOR = " " as const;

/** The pattern of a whole labelled line: `[LABEL] body`. */
export const LINE_PATTERN = /^\[([A-Z0-9-]+)\] (.*)$/;

/** Row 81 of annex X §X.6, whose members are the families of §G.3. */
export const CLOSED_SET_ROW = 81 as const;

/** Row 81 — a parser ignores a line whose label it does not know. */
export const LABEL_WHEN_UNKNOWN = Object.freeze({ outcome: "ignored-by-the-parser" as const });

/** The streams a line may be written to. */
export const STREAMS = ["stdout", "stderr"] as const;
export type Stream = (typeof STREAMS)[number];

type RawFamily = {
  Family: string;
  Label: string;
  Body: string;
  "Printed by": string;
  Stream: string;
};

/** One family of the table of §G.3. */
export type LineFamily = {
  /** The name of the family, as the table writes it. */
  readonly family: string;
  /** The `Label` cell as the annex writes it, prose and all. */
  readonly labelCell: string;
  /** The labels of the family, each without its back-ticks. */
  readonly labels: readonly string[];
  /**
   * The prefix a family names instead of a list of labels: `SPECSTRIDE-` for
   * the product lines. `null` where the family lists its labels, has none, or
   * is the family of the baselines' own lines.
   */
  readonly labelPrefix: string | null;
  /** The form of the body, as the table states it. */
  readonly body: string;
  /** Who prints a line of the family. */
  readonly printedBy: string;
  /** The `Stream` cell as the annex writes it. */
  readonly streamCell: string;
  /** The stream of the family; `stdout` unless the cell says otherwise. */
  readonly stream: Stream;
  /** The labels of the family that go to standard error instead. */
  readonly onStandardError: readonly string[];
  /** True for the family the table marks as default output only. */
  readonly defaultOutputOnly: boolean;
  /** True for the family whose lines carry no label at all (the status line). */
  readonly unlabelled: boolean;
};

const labelsOf = (cell: string): readonly string[] =>
  Object.freeze([...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((l) => l !== ""));

/** Load the families of §G.3 from `data/line-grammar.json` (F100-FR-178). */
export function loadFamilies(): readonly LineFamily[] {
  return Object.freeze(
    (lineGrammar as { families: RawFamily[] }).families.map((row) => {
      const labelCell = row.Label;
      const prefixMatch = /starts with `([^`]+)`/.exec(labelCell);
      const unlabelled = labelCell.trim() === "None";
      const listed = prefixMatch === null && !unlabelled ? labelsOf(labelCell) : Object.freeze([]);
      const streamCell = row.Stream;
      // The labels of THIS family that the `Stream` cell sends to standard
      // error instead. The cell of the digest names `STALE` and `INVALID`,
      // which are labels of the runtime lines, so the list is narrowed to the
      // family's own labels.
      const onStandardError = /standard error/i.test(streamCell)
        ? Object.freeze(labelsOf(streamCell).filter((l) => listed.includes(l)))
        : Object.freeze([]);
      return Object.freeze({
        family: row.Family,
        labelCell,
        labels: listed,
        labelPrefix: prefixMatch === null ? null : prefixMatch[1],
        body: row.Body,
        printedBy: row["Printed by"],
        streamCell,
        stream: "stdout" as Stream,
        onStandardError,
        defaultOutputOnly: /default output only/i.test(streamCell),
        unlabelled,
      });
    }),
  );
}

/** The families of §G.3, in the order of the annex. */
export const families: readonly LineFamily[] = loadFamilies();

/** The names of the seven families of §G.3. */
export const FAMILY_NAMES: readonly string[] = Object.freeze(families.map((f) => f.family));

/** Every label the table lists, in the order of the annex (row 81 of §X.6). */
export const LABELS: readonly string[] = Object.freeze(families.flatMap((f) => [...f.labels]));

/** The family of a name, or `undefined`. */
export function family(name: string): LineFamily | undefined {
  return families.find((f) => f.family === name);
}

/** A label listed by more than one family: the grammar forbids it. */
export class LabelInTwoFamiliesError extends Error {
  readonly label: string;
  readonly inFamilies: readonly string[];
  constructor(label: string, inFamilies: readonly string[]) {
    super(
      `the label \`${label}\` is listed by more than one family of annex G §G.3 ` +
        `(${inFamilies.join(", ")}); a label of one family is never used by another ` +
        "(F100-FR-178)",
    );
    this.name = "LabelInTwoFamiliesError";
    this.label = label;
    this.inFamilies = Object.freeze([...inFamilies]);
  }
}

/**
 * F100-FR-178 — a label of one family is never used by another. The check runs
 * at load and throws on a label two families list.
 */
export function assertLabelsAreDisjoint(list: readonly LineFamily[] = families): void {
  const seen = new Map<string, string[]>();
  for (const f of list) {
    for (const label of f.labels) {
      const at = seen.get(label) ?? [];
      at.push(f.family);
      seen.set(label, at);
    }
  }
  for (const [label, inFamilies] of seen) {
    if (inFamilies.length > 1) throw new LabelInTwoFamiliesError(label, inFamilies);
  }
}

assertLabelsAreDisjoint();

/** The family a label belongs to, or `undefined` where no family holds it. */
export function familyOfLabel(label: string): LineFamily | undefined {
  const listed = families.find((f) => f.labels.includes(label));
  if (listed !== undefined) return listed;
  return families.find((f) => f.labelPrefix !== null && label.startsWith(f.labelPrefix));
}

/** True where the label is one the grammar knows. */
export function isKnownLabel(label: string): boolean {
  return familyOfLabel(label) !== undefined;
}

/** The stream a line of a label goes to (§G.3, the `Stream` cell). */
export function streamOfLabel(label: string): Stream | undefined {
  const f = familyOfLabel(label);
  if (f === undefined) return undefined;
  return f.onStandardError.includes(label) ? "stderr" : f.stream;
}

/* ------------------------------------------------------------------ *
 * The parser and the formatter.
 * ------------------------------------------------------------------ */

/** A labelled line, parsed (§G.3). */
export type LabelledLine = {
  /** The label, without its square brackets. */
  readonly label: string;
  /** The body, everything after the one space. */
  readonly body: string;
  /** The family the label belongs to, or `undefined` where none holds it. */
  readonly family: LineFamily | undefined;
};

/** Why a line is not a labelled line of §G.3. */
export type LineParseRefusal = "not-a-labelled-line" | "label-outside-the-pattern";

/** A line that does not follow the grammar of §G.3. */
export class LineRefusedError extends Error {
  readonly reason: LineParseRefusal;
  readonly line: string;
  constructor(reason: LineParseRefusal, line: string, message: string) {
    super(message);
    this.name = "LineRefusedError";
    this.reason = reason;
    this.line = line;
  }
}

/**
 * Parse a labelled line (§G.3). The form is checked first, then the label
 * against its pattern. A label no family holds parses: row 81 of §X.6 says a
 * parser IGNORES a line whose label it does not know, so `family` is
 * `undefined` and the caller decides.
 */
export function parseLine(line: string): LabelledLine {
  const match = LINE_PATTERN.exec(line);
  if (match === null) {
    throw new LineRefusedError(
      "not-a-labelled-line",
      line,
      `the line does not follow the form of annex G §G.3 (${FORM}): ${JSON.stringify(line)}`,
    );
  }
  const label = match[1];
  if (!LABEL_PATTERN.test(label)) {
    throw new LineRefusedError(
      "label-outside-the-pattern",
      line,
      `the label \`${label}\` is outside the pattern ${LABEL_PATTERN_SOURCE} of annex G ` +
        "§G.3 (F100-FR-178)",
    );
  }
  return Object.freeze({ label, body: match[2], family: familyOfLabel(label) });
}

/** `parseLine` that returns a result instead of throwing. */
export function tryParseLine(
  line: string,
): { ok: true; line: LabelledLine } | { ok: false; error: LineRefusedError } {
  try {
    return { ok: true, line: parseLine(line) };
  } catch (err) {
    if (err instanceof LineRefusedError) return { ok: false, error: err };
    throw err;
  }
}

/**
 * Format a labelled line (§G.3): the label in square brackets, one space, the
 * body. A label outside the pattern is refused.
 */
export function formatLine(label: string, body: string): string {
  if (!LABEL_PATTERN.test(label)) {
    throw new LineRefusedError(
      "label-outside-the-pattern",
      label,
      `the label \`${label}\` is outside the pattern ${LABEL_PATTERN_SOURCE} of annex G ` +
        "§G.3 (F100-FR-178)",
    );
  }
  return `[${label}]${SEPARATOR}${body}`;
}

/** Parsing a line the formatter made gives the label and the body back. */
export function roundTrips(label: string, body: string): boolean {
  const parsed = parseLine(formatLine(label, body));
  return parsed.label === label && parsed.body === body;
}

/* ------------------------------------------------------------------ *
 * The printer of a family: pairs `key=value` separated by one space.
 * ------------------------------------------------------------------ */

/** The body form the table of §G.3 gives four of its families. */
export const PAIR_BODY = "pairs `key=value` separated by one space" as const;

/** True where the body of the family is pairs `key=value` (§G.3). */
export function bodyIsPairs(f: LineFamily): boolean {
  return /pairs `key=value`/i.test(f.body);
}

/** A text value of a pair is quoted as in JSON (§G.3). */
export function formatValue(value: string | number | boolean | null): string {
  if (value === null) return "none";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return /^[A-Za-z0-9._:/@+-]+$/.test(value) ? value : JSON.stringify(value);
}

/** The body of a line of pairs: the keys in the order they are given. */
export function formatPairs(
  pairs: readonly (readonly [string, string | number | boolean | null])[],
): string {
  return pairs.map(([key, value]) => `${key}=${formatValue(value)}`).join(SEPARATOR);
}

/** The printer of a family: the label and the pairs, as one line. */
export function printPairs(
  label: string,
  pairs: readonly (readonly [string, string | number | boolean | null])[],
): string {
  return formatLine(label, formatPairs(pairs));
}

/** The pairs of a body of pairs, in the order they were written. */
export function parsePairs(body: string): readonly (readonly [string, string])[] {
  const out: [string, string][] = [];
  for (const piece of body.split(SEPARATOR)) {
    if (piece === "") continue;
    const at = piece.indexOf("=");
    if (at <= 0) continue;
    out.push([piece.slice(0, at), piece.slice(at + 1)]);
  }
  return Object.freeze(out.map((p) => Object.freeze(p) as readonly [string, string]));
}

/* ------------------------------------------------------------------ *
 * F100-FR-178 — who owns what.
 * ------------------------------------------------------------------ */

/** Feature 100 owns the grammar; each line belongs to the feature that prints it. */
export const GRAMMAR_OWNER = "100" as const;
export const A_LINE_BELONGS_TO = "the feature that prints it" as const;
export const A_FEATURE_SPECIFIES = "its keys and values, inside the grammar" as const;
