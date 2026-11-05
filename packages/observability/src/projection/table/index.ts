/**
 * T011 — the table reader of the compatibility projection
 * (F144-FR-002, F144-FR-003, F144-FR-004, F144-FR-005).
 *
 * The projection is TABLE-DRIVEN: it holds no `switch` on an event type. This
 * module turns the copy of `contracts/projection-table.tsv` in
 * `packages/observability/data/projection/` into rows a caller can look up by
 * type, with the condition of each row compiled into a predicate over `data`,
 * and it holds the one check of a field map that `contracts/README.md` names
 * and T002 runs.
 *
 * THE CONDITION GRAMMAR. The `condition` cell of the contract is written in
 * the prose of the specification, and the forms it uses are these — every
 * distinct cell of the copied table on 2026-09-30 is one of them:
 *
 * | Cell | Reading |
 * |---|---|
 * | (empty) | the only row of the type; it always matches |
 * | `outcome=approved` | `data.outcome` equals `approved` |
 * | `stopReason set` | `data.stopReason` is present and not null |
 * | `endCause evidence, completed or yield` | `data.endCause` is one of the three |
 * | `endCause other` | none of the sibling rows' conditions on `endCause` held |
 * | `other` | no sibling row of the type held |
 * | `reason killed at hard cap` | `data.reason` is that one value |
 * | `legacy path` / `finalizer path` | which writer produced the event (below) |
 *
 * The two `stream.result` rows do not select on a value of a field but on
 * WHICH WRITER produced the event: the baseline has two emitters of
 * `agent_result`, the older one with the cost and turn counts and the
 * finaliser with the status and the reason code. The finaliser is the writer
 * that sets `status`, so `finalizer path` reads "`data.status` is present"
 * and `legacy path` is its complement. `FINALIZER_MARKER` names that field in
 * one place.
 *
 * A single value written as a phrase (`killed at hard cap`) is matched
 * against the value as the phrase reads and against its hyphenated and
 * underscored forms, because the closed sets of the catalogue write such
 * values in one of those three ways and the contract writes them as prose.
 */
import {
  FIELDS_NEVER_PROJECTED,
  fieldMapKeys,
  readProjectionTable,
  type ProjectionTableRow,
} from "../data.ts";

export {
  FIELDS_NEVER_PROJECTED,
  fieldMapKeys,
  legacyNamesOf,
  readCatalogueTypes,
  readProjectionTable,
  carriedLegacyNames,
  PROJECTION_TABLE_FILE,
  EVENT_CATALOGUE_FILE,
  type ProjectionTableRow,
} from "../data.ts";

/** The four shapes a row may have (the closed set "Row shapes", spec.md). */
export const ROW_SHAPES = ["bash", "python", "learning", "none"] as const;
export type RowShape = (typeof ROW_SHAPES)[number];

/** The four writer classes, in the order order is compared in (F144-FR-011). */
export const WRITER_CLASSES = ["engine", "stream-tap", "critic", "learning"] as const;
export type WriterClass = (typeof WRITER_CLASSES)[number];

/** The unknown value of the closed set of writer classes (spec.md). */
export const WRITER_CLASS_WHEN_UNKNOWN: WriterClass = "engine";

/** The cell that means "this row writes nothing". */
export const NOTHING = "-" as const;

/** The field whose presence marks the finaliser's `stream.result`. */
export const FINALIZER_MARKER = "status" as const;

/** The condition of a row, compiled. */
export type Condition =
  /** An empty cell: the only row of its type. */
  | { readonly kind: "always" }
  /** `<field>=<value>` or `<field> <value>` with one value. */
  | { readonly kind: "equals"; readonly field: string; readonly values: readonly string[] }
  /** `<field> a, b or c`. */
  | { readonly kind: "one-of"; readonly field: string; readonly values: readonly string[] }
  /** `<field> set`. */
  | { readonly kind: "set"; readonly field: string }
  /** `other` and `<field> other`: the complement of the sibling rows. */
  | { readonly kind: "otherwise"; readonly field: string | null }
  /** `legacy path` and `finalizer path`. */
  | { readonly kind: "writer-path"; readonly finalizer: boolean };

/* ------------------------------------------------------------------ *
 * The field map, read as a plan.
 * ------------------------------------------------------------------ */

/**
 * The `field_map_and_notes` cell of the contract is a KEY LIST WITH NOTES, and
 * the notes carry structure the keys alone do not. Three forms appear in the
 * copied table, and `fieldMapPlan` is the reader of all three:
 *
 *  1. **A plain key.** `phase`, `attempt`, `iter`. It is written when the
 *     event's `data` holds it.
 *  2. **A key with the baseline's literal**, written `key=value`:
 *     `evidence=missing`, `yielded=true`. The literal records what the
 *     baseline writes there; the key is still filled from the event, so a
 *     value the port knows is never overwritten by the note.
 *  3. **A clause per stop reason**, opened by `plus` or `plus per reason:` and
 *     separated by `/` or `;`, each clause naming its reasons in brackets:
 *     `kill_reason,consec (proposer_cap_exhausted) / consec
 *     (proposer_no_progress)`. ONE clause applies to one line — the one whose
 *     bracket names the stop reason of the event — and the order of the keys
 *     inside that clause is the order the baseline's own call writes them in
 *     (`proposer.sh:2318`, `:2333`). Taking the union of the clauses instead
 *     would put the keys of `proposer_consecutive_errors` in the wrong order,
 *     which is a difference of bytes.
 *
 * A clause of prose rather than of keys is dropped: the three the table uses
 * are "filled from ... of the type", "through the accessor" and "... are not
 * projected", which name the fields of the CATALOGUE TYPE a key is filled
 * from and are notes about the mechanism, not keys of the line.
 */
export type FieldMapClause = {
  /** The as-is keys of the clause, in the order of the cell. */
  readonly keys: readonly string[];
  /** The stop reasons the clause applies to; empty for the base clause. */
  readonly reasons: readonly string[];
};

/** The field map of a row, read as a plan. */
export type FieldMapPlan = {
  /** The keys every line of the row carries, in the order of the cell. */
  readonly base: readonly string[];
  /** The literal the cell records for a key, where it records one. */
  readonly literals: Readonly<Record<string, string>>;
  /** The clauses that apply to one stop reason each. */
  readonly perReason: readonly FieldMapClause[];
};

/** The prose clauses of a cell: notes about the mechanism, never keys. */
const PROSE_CLAUSE = /filled from|through the accessor|not projected/i;

/** The words that open the per-reason part of a cell. */
const OPENS_THE_CLAUSES = /,?\s*plus(?:\s+per\s+reason:)?\s*/;

/** One token of a key list, cleaned: the key, and the literal where there is one. */
function keyOfToken(raw: string): { readonly key: string; readonly literal?: string } | null {
  // A trailing note of the cell — `waited_sec on yield`, `reason when
  // finished by the end of the stream` — names the key and the occasion; the
  // occasion is prose and the key is the key.
  const token = raw
    .trim()
    .replace(/\s+(?:on|when)\s+.*$/i, "")
    .replace(/^(?:as-is keys|ambient)\s*/i, "")
    .trim();
  if (token === "") return null;
  const withLiteral = /^([a-z_][a-z0-9_]*)=(\S+)$/.exec(token);
  if (withLiteral !== null) {
    return { key: withLiteral[1] as string, literal: withLiteral[2] as string };
  }
  if (/\s/.test(token) || token.includes("=")) return null;
  return { key: token };
}

/** The keys and the literals of one key list. */
function keysOfList(text: string): {
  readonly keys: readonly string[];
  readonly literals: Readonly<Record<string, string>>;
} {
  const keys: string[] = [];
  const literals: Record<string, string> = {};
  for (const piece of text.split(/[,/;]/)) {
    const read = keyOfToken(piece);
    if (read === null) continue;
    if (!keys.includes(read.key)) keys.push(read.key);
    if (read.literal !== undefined) literals[read.key] = read.literal;
  }
  return { keys: Object.freeze(keys), literals: Object.freeze(literals) };
}

/** The reasons a bracket names: the first word of each item. */
function reasonsOfBracket(text: string): readonly string[] {
  return Object.freeze(
    text
      .split(",")
      .map((piece) => piece.trim().split(/\s+/)[0] ?? "")
      .filter((piece) => /^[a-z_][a-z0-9_]*$/.test(piece)),
  );
}

/** Every parenthesised group of a cell, removed; the groups may be repeated. */
function withoutBrackets(text: string): string {
  let out = text;
  for (let round = 0; round < 8; round += 1) {
    const stripped = out.replace(/\([^()]*\)/g, " ");
    if (stripped === out) break;
    out = stripped;
  }
  return out;
}

/** Read the `field_map_and_notes` cell of a row as a plan. */
export function fieldMapPlan(fieldMap: string): FieldMapPlan {
  const opens = OPENS_THE_CLAUSES.exec(fieldMap);
  if (opens === null || opens.index === undefined) {
    // No per-reason part: the brackets of the cell are notes, so they go
    // first — a `;` INSIDE a bracket must not cut the key list in two — and
    // the prose clauses go after them.
    const kept = withoutBrackets(fieldMap)
      .split(";")
      .filter((clause) => !PROSE_CLAUSE.test(clause))
      .join(";");
    const read = keysOfList(kept);
    return Object.freeze({
      base: read.keys,
      literals: read.literals,
      perReason: Object.freeze([]),
    });
  }
  const base = keysOfList(withoutBrackets(fieldMap.slice(0, opens.index)));
  const literals: Record<string, string> = { ...base.literals };
  const perReason: FieldMapClause[] = [];
  for (const clause of fieldMap.slice(opens.index + opens[0].length).split(/[;/]/)) {
    if (PROSE_CLAUSE.test(clause)) continue;
    const bracket = /\(([^()]*)\)/.exec(clause);
    if (bracket === null) continue;
    const reasons = reasonsOfBracket(bracket[1] as string);
    if (reasons.length === 0) continue;
    const read = keysOfList(clause.slice(0, bracket.index));
    if (read.keys.length === 0) continue;
    for (const [key, literal] of Object.entries(read.literals)) literals[key] = literal;
    perReason.push(Object.freeze({ keys: read.keys, reasons }));
  }
  return Object.freeze({
    base: base.keys,
    literals: Object.freeze(literals),
    perReason: Object.freeze(perReason),
  });
}

/**
 * The keys one LINE of a row carries: the base keys, and the keys of the
 * clause whose bracket names the stop reason of the event. A row with no
 * per-reason clause carries its base keys and nothing else.
 */
export function keysOfLine(
  plan: FieldMapPlan,
  reason: string | undefined | null,
): readonly string[] {
  if (plan.perReason.length === 0) return plan.base;
  const clause =
    reason === undefined || reason === null
      ? undefined
      : plan.perReason.find((candidate) => candidate.reasons.includes(String(reason)));
  return Object.freeze([...plan.base, ...(clause?.keys ?? [])]);
}

/** Every key a plan can name, over all of its clauses. */
export function allKeysOfPlan(plan: FieldMapPlan): readonly string[] {
  const keys = [...plan.base];
  for (const clause of plan.perReason) {
    for (const key of clause.keys) if (!keys.includes(key)) keys.push(key);
  }
  return Object.freeze(keys);
}

/** One row of the table with its condition compiled and its keys read. */
export type ProjectionRow = ProjectionTableRow & {
  readonly shapeOfRow: RowShape;
  readonly classOfRow: WriterClass;
  readonly condition_: Condition;
  /** The as-is keys the field map names, in the order of the cell. */
  readonly keys: readonly string[];
  /** The field map read as a plan: the base keys and the clauses per reason. */
  readonly plan: FieldMapPlan;
  /** The old names the row targets; empty where it writes nothing. */
  readonly targets: readonly string[];
  /** True where the row writes no line at all (F144-FR-009). */
  readonly writesNothing: boolean;
  /** True where the target names a file instead of an old event name. */
  readonly targetsAFile: boolean;
  /**
   * True where the row's shape is `none` and its target names a FILE: the
   * mechanism of F144-FR-010, which writes a line of the pipeline runtime or
   * of the supervisor and not an as-is event. Such a row does not "project to
   * nothing"; the rows that do have the target `-`.
   */
  readonly writesAPipelineFile: boolean;
};

/** A cell the grammar above does not hold. */
export class UnreadableConditionError extends Error {
  readonly condition: string;
  constructor(condition: string, where: string) {
    super(
      `the condition ${JSON.stringify(condition)} of ${where} is outside the grammar of ` +
        `the projection table (F144-FR-002)`,
    );
    this.name = "UnreadableConditionError";
    this.condition = condition;
  }
}

/** The forms a value written as a phrase may take in the catalogue. */
export function valueForms(value: string): readonly string[] {
  const trimmed = value.trim();
  return Object.freeze([
    ...new Set([trimmed, trimmed.split(" ").join("-"), trimmed.split(" ").join("_")]),
  ]);
}

/** The values of a list cell: `a, b or c`, `a, b, c or d`, `a or b`. */
function valuesOfList(text: string): readonly string[] {
  return Object.freeze(
    text
      .split(/,| or /)
      .map((piece) => piece.trim())
      .filter((piece) => piece !== ""),
  );
}

/** Compile one `condition` cell (the grammar of the module comment). */
export function parseCondition(condition: string, where = "a row"): Condition {
  const cell = condition.trim();
  if (cell === "") return Object.freeze({ kind: "always" as const });
  if (cell === "other") return Object.freeze({ kind: "otherwise" as const, field: null });
  if (cell === "legacy path") {
    return Object.freeze({ kind: "writer-path" as const, finalizer: false });
  }
  if (cell === "finalizer path") {
    return Object.freeze({ kind: "writer-path" as const, finalizer: true });
  }
  const equals = /^([A-Za-z][A-Za-z0-9_]*)=(.+)$/.exec(cell);
  if (equals !== null) {
    return Object.freeze({
      kind: "equals" as const,
      field: equals[1] as string,
      values: valueForms(equals[2] as string),
    });
  }
  const spaced = /^([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/.exec(cell);
  if (spaced === null) throw new UnreadableConditionError(condition, where);
  const field = spaced[1] as string;
  const rest = (spaced[2] as string).trim();
  if (rest === "set") return Object.freeze({ kind: "set" as const, field });
  if (rest === "other") return Object.freeze({ kind: "otherwise" as const, field });
  if (rest.includes(",") || / or /.test(rest)) {
    return Object.freeze({ kind: "one-of" as const, field, values: valuesOfList(rest) });
  }
  return Object.freeze({ kind: "equals" as const, field, values: valueForms(rest) });
}

/** The old names a target cell holds; a cell with a space names a FILE. */
function targetsOf(cell: string): { readonly names: readonly string[]; readonly file: boolean } {
  if (cell === NOTHING) return { names: Object.freeze([]), file: false };
  const names = cell
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
  const file = names.some((name) => /\s/.test(name));
  return { names: Object.freeze(file ? [] : names), file };
}

/** The shape of a cell, with the table refused where the cell is not one. */
export function shapeOf(row: ProjectionTableRow): RowShape {
  if ((ROW_SHAPES as readonly string[]).includes(row.shape)) return row.shape as RowShape;
  throw new Error(
    `projection-table.tsv:${String(row.line)} has the shape ${JSON.stringify(row.shape)}; ` +
      `the table is invalid (the closed set "Row shapes of the projection")`,
  );
}

/** The writer class of a cell; the unknown value is `engine` (spec.md). */
export function writerClassOf(row: ProjectionTableRow): WriterClass {
  if ((WRITER_CLASSES as readonly string[]).includes(row.writerClass)) {
    return row.writerClass as WriterClass;
  }
  return WRITER_CLASS_WHEN_UNKNOWN;
}

/** Compile one row of the copied table. */
export function compileRow(row: ProjectionTableRow): ProjectionRow {
  const { names, file } = targetsOf(row.legacyTarget);
  const shape = shapeOf(row);
  return Object.freeze({
    ...row,
    shapeOfRow: shape,
    classOfRow: writerClassOf(row),
    condition_: parseCondition(row.condition, `projection-table.tsv:${String(row.line)}`),
    keys: shape === "none" ? Object.freeze([]) : fieldMapKeys(row.fieldMap),
    plan:
      shape === "none"
        ? Object.freeze({
            base: Object.freeze([]),
            literals: Object.freeze({}),
            perReason: Object.freeze([]),
          })
        : fieldMapPlan(row.fieldMap),
    targets: names,
    writesNothing: shape === "none" && !file,
    targetsAFile: file,
    writesAPipelineFile: shape === "none" && file,
  });
}

/** The whole table, compiled, in the order of the file. */
export function compileTable(
  rows: readonly ProjectionTableRow[] = readProjectionTable(),
): readonly ProjectionRow[] {
  return Object.freeze(rows.map(compileRow));
}

/** The compiled table of the copy that ships with this package. */
export const projectionRows: readonly ProjectionRow[] = compileTable();

/** The rows of one event type, in the order of the table. */
export function rowsOfType(
  type: string,
  rows: readonly ProjectionRow[] = projectionRows,
): readonly ProjectionRow[] {
  return Object.freeze(rows.filter((row) => row.type === type));
}

/** True where the compiled condition holds for the `data` of an event. */
export function conditionHolds(
  condition: Condition,
  data: Readonly<Record<string, unknown>>,
): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "set": {
      const value = data[condition.field];
      return value !== undefined && value !== null && value !== "";
    }
    case "equals":
    case "one-of": {
      const value = data[condition.field];
      if (value === undefined || value === null) return false;
      return condition.values.includes(String(value));
    }
    case "writer-path": {
      const marked = data[FINALIZER_MARKER] !== undefined && data[FINALIZER_MARKER] !== null;
      return condition.finalizer ? marked : !marked;
    }
    case "otherwise":
      // Decided by `selectRow`, which knows the sibling rows.
      return false;
  }
}

/**
 * The row of an event: the first row of its type whose condition holds, and
 * the row of the fallback condition (`other`, `<field> other`) where none
 * does. `undefined` where the type has no row at all — which the check of
 * T002 forbids, so it can only be an event type the catalogue does not hold.
 */
export function selectRow(
  type: string,
  data: Readonly<Record<string, unknown>> = {},
  rows: readonly ProjectionRow[] = projectionRows,
): ProjectionRow | undefined {
  const candidates = rowsOfType(type, rows);
  if (candidates.length === 0) return undefined;
  for (const row of candidates) {
    if (row.condition_.kind === "otherwise") continue;
    if (conditionHolds(row.condition_, data)) return row;
  }
  return candidates.find((row) => row.condition_.kind === "otherwise");
}

/* ------------------------------------------------------------------ *
 * The one check of a field map (`contracts/README.md`, check 2).
 * ------------------------------------------------------------------ */

/**
 * The check of `contracts/README.md`: *every field map names the keys of the
 * as-is line, never a field of the catalogue type that the baseline line
 * lacks.* The old vocabulary writes snake_case keys, so a camelCase token in a
 * key list is a field of the catalogue TYPE and not a key of the LINE, and a
 * token of the four fields of F144-FR-009 is never projected at all.
 *
 * This is the function T002's check calls, and it is the function T011 calls
 * with a DOCTORED table to show that the check fails on the pre-repair rows
 * `tool.call` and `pass.halted`, which named `toolId`, `killReason`, `jobPid`
 * and `jobLogRef` of the type before the repair of 2026-09-30.
 */
export function fieldMapOffences(
  rows: readonly ProjectionTableRow[] = readProjectionTable(),
): readonly string[] {
  const offences: string[] = [];
  const where = (row: ProjectionTableRow): string =>
    `projection-table.tsv:${String(row.line)} ${row.type} ` +
    `[${row.condition === "" ? "(no condition)" : row.condition}]`;
  for (const row of rows) {
    if (row.shape === "none") continue;
    // Both readings of the cell are checked: the key list of T002 and the plan
    // of T011, so neither can carry a field of the type past the other.
    const keys = [
      ...new Set([...fieldMapKeys(row.fieldMap), ...allKeysOfPlan(fieldMapPlan(row.fieldMap))]),
    ];
    if (keys.length === 0) {
      offences.push(`${where(row)}: a projected row names no key`);
      continue;
    }
    for (const key of keys) {
      if (/^[a-z][a-z0-9]*[A-Z]/.test(key)) {
        offences.push(`${where(row)}: "${key}" is a field of the type, not a key of the line`);
      } else if (!/^[a-z_][a-z0-9_]*$/.test(key)) {
        offences.push(`${where(row)}: "${key}" is not the shape of an as-is key`);
      }
      if (FIELDS_NEVER_PROJECTED.includes(key)) {
        offences.push(`${where(row)}: "${key}" is never projected (F144-FR-009)`);
      }
    }
  }
  return Object.freeze(offences);
}

/**
 * The two rows the repair of 2026-09-30 corrected, and the as-is keys each
 * names since, each once and in alphabetical order (the cell of `pass.halted`
 * repeats `kill_reason` and `consec`, once per stop reason). A test holds the
 * table to them, so that a later edit that puts a field of the type back in
 * either cell is caught by name and not only by the shape of the token (T011).
 */
export const ROWS_REPAIRED_ON_2026_09_30 = Object.freeze({
  "tool.call": Object.freeze([
    "original_bytes",
    "redacted",
    "retained_bytes",
    "target",
    "targets",
    "tool",
    "tool_id",
    "truncated",
  ]),
  "pass.halted": Object.freeze([
    "consec",
    "iter",
    "job_log",
    "job_pid",
    "kill_class",
    "kill_reason",
    "max",
    "reason",
    "subtype",
    "yield",
    "yields",
  ]),
});

/**
 * The same two rows as the copied table had them BEFORE that repair: the
 * field maps named the fields of the catalogue type. `fieldMapOffences` must
 * refuse them — that is what "the check of T002 fails" means (F144-FR-009).
 */
export function rowsBeforeTheRepairOf2026_09_30(
  rows: readonly ProjectionTableRow[] = readProjectionTable(),
): readonly ProjectionTableRow[] {
  const before: Readonly<Record<string, string>> = Object.freeze({
    "tool.call":
      "tool,toolId,target,targets,redacted,truncated,originalBytes,retainedBytes " +
      "(target and targets through the accessor)",
    "pass.halted": "reason,iter,yields,killReason,killClass,jobPid,jobLogRef",
  });
  return Object.freeze(
    rows.map((row) => {
      const doctored = before[row.type];
      if (doctored === undefined || row.shape === "none") return row;
      return Object.freeze({ ...row, fieldMap: doctored });
    }),
  );
}
