/**
 * T015 — the load of a rule table (annex X, §X.3; annex D, §D.4).
 *
 * `loadTable` parses a table against `specstride.table/1`
 * (`schemas/rule-table.schema.json`, through the lazy validator of T232) and
 * refuses at load, each with the table id, the version and the row (or the
 * decision point):
 *
 * - a table without a default row per decision point (F100-FR-204);
 * - a choice outside the choice set of the point (annex D, §D.4, unknown-value rule);
 * - an unknown signal — a signal the point does not declare it may read
 *   (annex D, §D.4, unknown-value rule);
 * - an unknown operator — one outside the closed set of nine operators of
 *   §X.3 (`equal`, `not equal`, `less`, `greater`, `member of`, `present`,
 *   `and`, `or`, `not`; closed set of row 68 of `closed-sets.json`).
 *
 * The form of a predicate (a record, per §X.3):
 *
 * - a leaf: `{ "op": "<one of the nine>", "signal": "<declared signal>",
 *   "value": <literal> }` — `value` is required for `equal`, `not equal`,
 *   `less`, `greater` and `member of`, and absent for `present`;
 * - a combinator: `{ "op": "and" | "or", "of": [<predicate>...] }` and
 *   `{ "op": "not", "of": [<one predicate>] }` — `and` of no operand holds,
 *   `or` of no operand is false.
 *
 * The default row of a decision point is the row without `when`
 * ("absent in the default row", §X.3): its predicate always holds.
 */
import { validate } from "@specstride/contracts/records/compile";
import type { SchemaError } from "@specstride/contracts/records/compile";

/** The schema id of a rule table (annex X, §X.3). */
export const TABLE_SCHEMA_ID = "specstride.table/1";

/** The closed set of nine operators of a table predicate (annex X, §X.3). */
export const OPERATORS = [
  "equal",
  "not equal",
  "less",
  "greater",
  "member of",
  "present",
  "and",
  "or",
  "not",
] as const;

/** One member of the closed set of operators. */
export type Operator = (typeof OPERATORS)[number];

/** A predicate over named signals, built from the closed set of operators. */
export type Predicate = {
  op: string;
  signal?: string;
  value?: unknown;
  of?: Predicate[];
};

/** One row of a table: the rule id, the predicate (absent in the default row) and the choice. */
export type TableRow = {
  ruleId: string;
  when?: Predicate;
  choice: string;
};

/** One decision point: the named signals it may read, with their types, and its closed choice set. */
export type Point = {
  signals?: Record<string, string>;
  choices: string[];
};

/** A rule table that passed the checks of the load. */
export type LoadedTable = {
  schema: string;
  id: string;
  version: string;
  points: Record<string, Point>;
  rows: Record<string, TableRow[]>;
};

/** A table the load refuses (annex X, §X.3; annex D, §D.4). */
export class TableLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableLoadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load a rule table: parse it against `specstride.table/1` and run the
 * structural refusals of the load. Throws `TableLoadError` with the table
 * id, the version and the row (or the decision point) for every refusal.
 */
export function loadTable(value: unknown): LoadedTable {
  const parsed = validate<Record<string, unknown>>(TABLE_SCHEMA_ID, value);
  if (!parsed.ok) {
    const table = isRecord(value) ? value : {};
    const id = typeof table.id === "string" ? table.id : "(no id)";
    const version = typeof table.version === "string" ? table.version : "(no version)";
    const first: SchemaError | undefined = parsed.errors[0];
    throw new TableLoadError(
      `table ${id} (version ${version}): invalid against ${TABLE_SCHEMA_ID}: ` +
        `${first ? `${first.keyword} at ${first.path}: ${first.message}` : "no errors reported"}`,
    );
  }
  const table = parsed.record as {
    schema: unknown;
    id: unknown;
    version: unknown;
    points: unknown;
    rows: unknown;
  };
  const fail: (what: string) => never = (what) => {
    const id = typeof table.id === "string" ? table.id : "(no id)";
    const version = typeof table.version === "string" ? table.version : "(no version)";
    throw new TableLoadError(`table ${id} (version ${version}): ${what}`);
  };
  if (typeof table.id !== "string" || table.id.length === 0) fail("the table has no id");
  if (typeof table.version !== "string" || table.version.length === 0)
    fail("the table has no version");
  const id = table.id;
  const version = table.version;
  const rawPoints = table.points;
  if (!isRecord(rawPoints) || Object.keys(rawPoints).length === 0)
    fail("the table has no decision points");
  const rawRowsOf = table.rows;
  if (!isRecord(rawRowsOf)) fail("the table has no rows");

  const points: Record<string, Point> = {};
  for (const [pointName, rawPoint] of Object.entries(rawPoints)) {
    if (!isRecord(rawPoint)) fail(`the decision point ${pointName} is not a record`);
    if (!Array.isArray(rawPoint.choices) || rawPoint.choices.length === 0)
      fail(`the decision point ${pointName} has no closed choice set`);
    for (const choice of rawPoint.choices)
      if (typeof choice !== "string") fail(`the decision point ${pointName} has a non-text choice`);
    points[pointName] = {
      signals: isRecord(rawPoint.signals)
        ? (rawPoint.signals as Record<string, string>)
        : undefined,
      choices: rawPoint.choices as string[],
    };
  }

  const rows: Record<string, TableRow[]> = {};
  for (const [pointName, rawRowsList] of Object.entries(rawRowsOf)) {
    if (!(pointName in points)) fail(`unknown decision point ${pointName}`);
    if (!Array.isArray(rawRowsList) || rawRowsList.length === 0)
      fail(`the decision point ${pointName} has no rows (and so no default row)`);
    let hasDefault = false;
    rows[pointName] = rawRowsList.map((rawRow, index) => {
      const where = `row ${index + 1} of ${pointName}`;
      if (!isRecord(rawRow)) fail(`${where}: a row is not a record`);
      if (typeof rawRow.ruleId !== "string" || rawRow.ruleId.length === 0)
        fail(`${where}: the row has no rule id`);
      if (typeof rawRow.choice !== "string") fail(`${where}: the row has no choice`);
      if (!points[pointName].choices.includes(rawRow.choice))
        fail(`${where}: the choice ${JSON.stringify(rawRow.choice)} is outside the choice set`);
      const row: TableRow = { ruleId: rawRow.ruleId, choice: rawRow.choice };
      if (rawRow.when === undefined) {
        hasDefault = true;
      } else {
        checkPredicate(
          rawRow.when,
          points[pointName],
          `${where} (rule ${rawRow.ruleId})`,
          id,
          version,
        );
        row.when = rawRow.when as Predicate;
      }
      return row;
    });
    if (!hasDefault) fail(`the decision point ${pointName} has no default row`);
  }
  for (const pointName of Object.keys(points))
    if (!(pointName in rows))
      fail(`the decision point ${pointName} has no rows (and so no default row)`);

  return {
    schema: table.schema as string,
    id,
    version,
    points,
    rows,
  };
}

/**
 * Refuse an unknown operator, an unknown signal and a missing value, each
 * with the table id, the version and the row.
 */
function checkPredicate(
  predicate: unknown,
  point: Point,
  where: string,
  id: string,
  version: string,
): void {
  const fail: (what: string) => never = (what) => {
    throw new TableLoadError(`table ${id} (version ${version}): ${where}: ${what}`);
  };
  if (!isRecord(predicate)) fail("a predicate is not a record");
  const node: Record<string, unknown> = predicate;
  if (typeof node.op !== "string" || !(OPERATORS as readonly string[]).includes(node.op)) {
    const op = typeof node.op === "string" ? JSON.stringify(node.op) : "(missing)";
    fail(`unknown operator ${op} in the predicate`);
  }
  if (node.op === "and" || node.op === "or") {
    const operands = node.of;
    if (!Array.isArray(operands)) fail(`${node.op} has no operands`);
    for (const operand of operands) checkPredicate(operand, point, where, id, version);
    return;
  }
  if (node.op === "not") {
    const operands = node.of;
    if (!Array.isArray(operands) || operands.length !== 1) fail(`not takes one operand`);
    checkPredicate(operands[0], point, where, id, version);
    return;
  }
  // a leaf: equal, not equal, less, greater, member of, present
  const signalName = node.signal;
  if (typeof signalName !== "string" || signalName.length === 0) fail("the leaf has no signal");
  const declared = point.signals ?? {};
  if (!(signalName in declared))
    fail(
      `unknown signal ${JSON.stringify(signalName)} ` +
        `(the point declares ${Object.keys(declared).join(", ") || "no signals"})`,
    );
  if (node.op !== "present" && !("value" in node)) fail(`${node.op} has no value`);
}
