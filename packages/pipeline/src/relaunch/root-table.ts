/**
 * T027 — table 2, `relaunch-root`, the only classifier of the runtime root
 * (F123-FR-029).
 *
 * The table is versioned data of the kernel's table evaluator (annex X
 * §X.3): the file `packages/pipeline/data/relaunch-root.table.json` holds it
 * in the compact contract form — a predicate is a JSON object with one
 * operator key, and `equal`, `notEqual`, `less` and `greater` take a pair
 * `[signal, value]` (`specs/.../contracts/README.md`). This module converts
 * that form into the predicate records of the evaluator, loads the table
 * through `loadTable`, builds the named signals of the decision point from
 * the records the root holds, and evaluates the table: the first row whose
 * predicate holds fires, the last row has no predicate, so exactly one row
 * fires for every vector of signals. Every decision records the rule id and
 * the table version.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateTable,
  loadTable,
  TableLoadError,
  type LoadedTable,
  type Predicate,
} from "@specstride/kernel";

/** The id and version of table 2 as the data file holds them. */
export const ROOT_TABLE_ID = "relaunch-root";
export const ROOT_TABLE_VERSION = "1.0.0";

/** The data file of table 2. */
const ROOT_TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "relaunch-root.table.json",
);

/** The named signals of the decision point `relaunch` of table 2 (§R.6). */
export type RelaunchSignals = {
  stopRequested: boolean;
  interrupted: boolean;
  blocked: boolean;
  /** `normal`, `crash` or `owner-lost`, from the terminal record. */
  cause: "normal" | "crash" | "owner-lost";
  exitCode: number;
  retryable: boolean;
  stageReasonClass: string;
  childExitListed: boolean;
  reasonAllowed: boolean;
  contractChanged: boolean;
  learningChanged: boolean;
  launcherEdited: boolean;
  budgetRemaining: number;
  deadlinePassed: boolean;
  held: boolean;
};

type CompactNode = Record<string, unknown>;

/** Convert one compact leaf of the contract form into a predicate of the evaluator. */
function compactLeaf(operator: string, raw: unknown): Predicate {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string") {
    throw new TableLoadError(
      `table ${ROOT_TABLE_ID}: the operator ${operator} takes a pair [signal, value]`,
    );
  }
  const [signal, value] = raw as [string, unknown];
  return { op: operator, signal, value };
}

/**
 * Convert one compact predicate of the contract form — a JSON object with
 * one operator key — into a predicate of the kernel's table evaluator.
 */
export function toKernelPredicate(compact: unknown): Predicate {
  if (typeof compact !== "object" || compact === null || Array.isArray(compact)) {
    throw new TableLoadError(`table ${ROOT_TABLE_ID}: a predicate is not a record`);
  }
  const node = compact as CompactNode;
  const operators = Object.keys(node);
  if (operators.length !== 1) {
    throw new TableLoadError(
      `table ${ROOT_TABLE_ID}: a predicate holds exactly one operator key, got ${operators.join(", ")}`,
    );
  }
  const operator = operators[0] as string;
  const body = node[operator];
  switch (operator) {
    case "equal":
      return compactLeaf("equal", body);
    case "notEqual":
      return compactLeaf("not equal", body);
    case "less":
      return compactLeaf("less", body);
    case "greater":
      return compactLeaf("greater", body);
    case "memberOf":
      return compactLeaf("member of", body);
    case "present":
      return { op: "present", signal: typeof body === "string" ? body : "" };
    case "not": {
      if (Array.isArray(body) || typeof body !== "object" || body === null) {
        throw new TableLoadError(`table ${ROOT_TABLE_ID}: not takes one operand`);
      }
      return { op: "not", of: [toKernelPredicate(body)] };
    }
    case "and":
    case "or": {
      if (!Array.isArray(body)) {
        throw new TableLoadError(`table ${ROOT_TABLE_ID}: ${operator} takes a list of operands`);
      }
      return { op: operator, of: body.map((operand) => toKernelPredicate(operand)) };
    }
    default:
      throw new TableLoadError(`table ${ROOT_TABLE_ID}: unknown operator ${operator}`);
  }
}

/** Convert a whole table in the compact contract form into the evaluator's form. */
export function toKernelTableJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new TableLoadError(`table ${ROOT_TABLE_ID}: the table is not a record`);
  }
  const table = raw as Record<string, unknown>;
  const rows = table["rows"];
  if (typeof rows !== "object" || rows === null) {
    throw new TableLoadError(`table ${ROOT_TABLE_ID}: the table has no rows`);
  }
  const convertedRows: Record<string, unknown> = {};
  for (const [point, rowList] of Object.entries(rows as Record<string, unknown>)) {
    if (!Array.isArray(rowList)) {
      throw new TableLoadError(`table ${ROOT_TABLE_ID}: the rows of ${point} are not a list`);
    }
    convertedRows[point] = rowList.map((row) => {
      if (typeof row !== "object" || row === null) {
        throw new TableLoadError(`table ${ROOT_TABLE_ID}: a row of ${point} is not a record`);
      }
      const record = row as Record<string, unknown>;
      return record["when"] === undefined
        ? { ...record }
        : { ...record, when: toKernelPredicate(record["when"]) };
    });
  }
  return { ...table, rows: convertedRows };
}

/** The table 2 data file, loaded through the kernel's table evaluator. */
export function loadRootTable(): LoadedTable {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ROOT_TABLE_PATH, "utf8")) as unknown;
  } catch (error) {
    throw new TableLoadError(`cannot read the table file ${ROOT_TABLE_PATH}: ${String(error)}`);
  }
  return loadTable(toKernelTableJson(raw));
}

/**
 * Build the vector of signals of table 2 from the records the root holds.
 * Every signal the caller leaves out reads its inert value, so a partially
 * observed run still classifies through the table and never through a
 * switch.
 */
export function buildRelaunchSignals(input: Partial<RelaunchSignals>): RelaunchSignals {
  return {
    stopRequested: input.stopRequested ?? false,
    interrupted: input.interrupted ?? false,
    blocked: input.blocked ?? false,
    cause: input.cause ?? "normal",
    exitCode: input.exitCode ?? 0,
    retryable: input.retryable ?? false,
    stageReasonClass: input.stageReasonClass ?? "other",
    childExitListed: input.childExitListed ?? false,
    reasonAllowed: input.reasonAllowed ?? true,
    contractChanged: input.contractChanged ?? false,
    learningChanged: input.learningChanged ?? false,
    launcherEdited: input.launcherEdited ?? false,
    budgetRemaining: input.budgetRemaining ?? 0,
    deadlinePassed: input.deadlinePassed ?? false,
    held: input.held ?? false,
  };
}

/** The stage reason class of §R.6: `transient`, the deliberate name, `exec-error` or `other`. */
const TRANSIENT_STAGE_REASONS = [
  "exit",
  "timeout",
  "recovery-deadline",
  "recovery-exhausted",
] as const;
const DELIBERATE_STAGE_REASONS = [
  "postcondition",
  "stage-precondition",
  "setup-required",
  "interrupted",
  "existing-prerequisite",
  "completed",
] as const;

export function classifyStageReason(reason: string): string {
  if ((TRANSIENT_STAGE_REASONS as readonly string[]).includes(reason)) return "transient";
  if ((DELIBERATE_STAGE_REASONS as readonly string[]).includes(reason)) return reason;
  if (reason.startsWith("exec-error")) return "exec-error";
  return "other";
}

/** The decision a choice of table 2 stands for: a refusal, a hold or a relaunch. */
export function decisionOfChoice(choice: string): "refuse" | "hold" | "relaunch" {
  if (choice === "classified-transient" || choice === "classified-crash") return "relaunch";
  if (choice === "relaunch-held") return "hold";
  return "refuse";
}

/** One decision of table 2, with the rule id and the table version (F123-FR-029). */
export type RootDecision = {
  tableId: string;
  tableVersion: string;
  ruleId: string;
  choice: string;
  decision: "refuse" | "hold" | "relaunch";
  /** The signals the rule that fired read, with the values of the vector. */
  signals: Record<string, unknown>;
};

/**
 * Evaluate table 2 over a vector of signals, through the kernel's table
 * evaluator: the first row whose predicate holds fires, the last row has no
 * predicate, so exactly one row fires for every vector. The decision
 * records the rule id and the table version. Pure.
 */
export function evaluateRootTable(table: LoadedTable, signals: RelaunchSignals): RootDecision {
  const decision = evaluateTable(table, "relaunch", { ...signals });
  return {
    tableId: decision.tableId,
    tableVersion: decision.tableVersion,
    ruleId: decision.ruleId,
    choice: decision.choice,
    decision: decisionOfChoice(decision.choice),
    signals: decision.signals,
  };
}

/**
 * T083 — the text of the refusal the root gives a blocked run (F123-FR-042,
 * F123-FR-030): it names the refusal `blocked-on-human` and the command
 * `resume`, and it never names a relaunch.
 */
export const ROOT_REFUSAL_BLOCKED_ON_HUMAN =
  "blocked-on-human: the pipeline never relaunches a blocked run; the human resumes it with `resume`" as const;
