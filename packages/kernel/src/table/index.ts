/**
 * T237 — the table evaluator of the kernel (annex X, §X.3, F100-FR-204).
 *
 * One evaluator for every pure table of the product: the router, the quota
 * classifier, both relaunch classifier tables, lane derivation, the terms
 * gate and the attempt planner (whose bump table has the same form, with the
 * one decision point `attempt-tier`). It is a pure function over a loaded
 * table and a vector of signals: no I/O, no clock, no randomness, no model.
 *
 * Rows are tried in order and the first whose predicate holds fires; the
 * default row (the row without `when`) fires when no row matches, so for
 * every vector of signals exactly one row fires. Every decision is recorded
 * with the rule id, the table id and the table version.
 *
 * Re-exports the loader of T015 (`loadTable`, `TABLE_SCHEMA_ID`,
 * `OPERATORS`, the types).
 */
export * from "./load.ts";
import type { LoadedTable, Predicate, TableRow } from "./load.ts";
import { TableLoadError } from "./load.ts";

/** The record of one decision (annex X, §X.3). */
export type Decision = {
  tableId: string;
  tableVersion: string;
  point: string;
  ruleId: string;
  choice: string;
  /** The signals the rule that fired read, mapped to the values of the vector. */
  signals: Record<string, unknown>;
};

/**
 * Evaluate one predicate node over the vector of signals. Pure: it reads
 * only its arguments.
 */
function evalPredicate(node: Predicate, signals: Record<string, unknown>): boolean {
  switch (node.op) {
    case "and":
      return (node.of ?? []).every((operand) => evalPredicate(operand, signals));
    case "or":
      return (node.of ?? []).some((operand) => evalPredicate(operand, signals));
    case "not":
      return node.of && node.of.length === 1 ? !evalPredicate(node.of[0], signals) : false;
    case "present": {
      const value = node.signal !== undefined ? signals[node.signal] : undefined;
      return value !== undefined && value !== null;
    }
    case "equal": {
      const value = node.signal !== undefined ? signals[node.signal] : undefined;
      return value !== undefined && value === node.value;
    }
    case "not equal": {
      const value = node.signal !== undefined ? signals[node.signal] : undefined;
      return value !== undefined && value !== node.value;
    }
    case "less":
      return (
        typeof signals[node.signal ?? ""] === "number" &&
        typeof node.value === "number" &&
        (signals[node.signal ?? ""] as number) < (node.value as number)
      );
    case "greater":
      return (
        typeof signals[node.signal ?? ""] === "number" &&
        typeof node.value === "number" &&
        (signals[node.signal ?? ""] as number) > (node.value as number)
      );
    case "member of": {
      const value = node.signal !== undefined ? signals[node.signal] : undefined;
      return Array.isArray(node.value) && node.value.includes(value);
    }
    default:
      // The load refuses every other operator; this is unreachable.
      return false;
  }
}

/** The signal names a predicate reads, in first-seen order. */
function signalsOf(node: Predicate): string[] {
  const out: string[] = [];
  const walk = (predicate: Predicate): void => {
    if (predicate.of) for (const operand of predicate.of) walk(operand);
    if (predicate.signal !== undefined && !out.includes(predicate.signal))
      out.push(predicate.signal);
  };
  walk(node);
  return out;
}

/**
 * Evaluate the table at one decision point over a vector of signals.
 *
 * First match in row order; the default row when no row matches. Returns
 * the decision record with the rule id, the table id and the table version
 * (F100-FR-204). Pure: no I/O, no clock, no randomness, no model.
 */
export function evaluateTable(
  table: LoadedTable,
  point: string,
  signals: Record<string, unknown>,
): Decision {
  const rows: TableRow[] | undefined = table.rows[point];
  if (!rows || rows.length === 0) {
    throw new TableLoadError(
      `table ${table.id} (version ${table.version}): the decision point ${point} has no rows`,
    );
  }
  let fired: TableRow = rows[rows.length - 1];
  for (const row of rows) {
    if (row.when === undefined || evalPredicate(row.when, signals)) {
      fired = row;
      break;
    }
  }
  const read = fired.when === undefined ? [] : signalsOf(fired.when);
  const signalsRead: Record<string, unknown> = {};
  for (const name of read) signalsRead[name] = signals[name];
  return {
    tableId: table.id,
    tableVersion: table.version,
    point,
    ruleId: fired.ruleId,
    choice: fired.choice,
    signals: signalsRead,
  };
}
