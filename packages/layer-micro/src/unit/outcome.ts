/**
 * T046 — the outcomes of a check on a unit, with their directives
 * (F115-FR-016, F115-FR-017, F115-FR-021).
 *
 * `kept`: every command exits 0 and no result carries a condition; the
 * directive is `keep` and the record is bound to the tree fingerprint.
 * `repair`: a command failed, or a result carries `tainted` or `cached`,
 * and repairs remain. `unresolved`: the repairs are spent or the time cap
 * of the unit is reached; the tree stays as it is. `unchecked`: the unit has
 * no command to run, or no checkpoint named its task — unchecked is never a
 * pass (it is not a kept unit) and never fails a unit (no exit code and no
 * stop reason results; the empty inner set never fails a unit).
 *
 * The layer never commits, reverts, resets, cleans or checks out the
 * working tree, creates no reference, and writes nothing under the
 * repository directory (F115-FR-017): an outcome is a directive and a
 * ledger record, nothing else. The set of outcomes is the closed set of row
 * 136 (kept, repair, unresolved) plus the status of row 137 (`unchecked`).
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import type { epLoopLayer as epLoopLayerTypes } from "@specstride/contracts";

type Directive = epLoopLayerTypes.Directive;

/** The outcomes of a check on a unit, `unchecked` included (rows 136, 137). */
export const UNIT_OUTCOMES = ["kept", "repair", "unresolved", "unchecked"] as const;
export type UnitOutcome = (typeof UNIT_OUTCOMES)[number];

/** One result of one command of the inner set, as the check runner gave it. */
export type CheckResult = {
  /** The id of the command in the check manifest. */
  readonly id: string;
  /** The exit status the runtime observed; never read from a file. */
  readonly exit: number;
  /** The conditions the check runner set (`tainted`, `cached`, `flaky`). */
  readonly conditions?: readonly string[];
  /**
   * F115-FR-023 — the result of a command the runtime excluded (`slow`,
   * `budget`): it reads `unchecked`, never failed, and takes no part in the
   * decision on the unit.
   */
  readonly excluded?: boolean;
};

/**
 * The outcome of one unit: the outcome, the directive the layer returns,
 * and for `kept` the tree fingerprint the record is bound to.
 */
export type UnitDecision = {
  readonly outcome: UnitOutcome;
  readonly directive: Directive | "none";
};

/**
 * The repair cap of a task id (F115-FR-022 default: 2). A unit with no
 * repair left on any of its tasks cannot go to `repair`.
 */
export type RepairBudget = {
  /** Repairs left per task id; a task absent from the map has its default. */
  readonly repairsLeft: Readonly<Record<string, number>>;
  readonly defaultRepairsLeft: number;
};

/** The repairs left for the unit: the highest among its tasks (F115-FR-022). */
export function repairsLeftFor(taskIds: readonly string[], budget: RepairBudget): number {
  if (taskIds.length === 0) return budget.defaultRepairsLeft;
  return Math.max(...taskIds.map((id) => budget.repairsLeft[id] ?? budget.defaultRepairsLeft));
}

/**
 * F115-FR-016, F115-FR-021 — decide the outcome of a check on a unit.
 *
 * - no command ran: `unchecked`, no directive, never a pass, never a failure;
 * - every command exited 0 with no condition: `kept`, directive `keep`;
 * - a failure, a `tainted` or a `cached` result with repairs left: `repair`;
 * - otherwise (repairs spent or the time cap of the unit reached):
 *   `unresolved`, the tree stays as it is.
 */
export function decideOutcome(
  results: readonly CheckResult[],
  options: {
    readonly taskIds: readonly string[];
    readonly budget: RepairBudget;
    /** True when the time cap of the unit is reached (F115-FR-016). */
    readonly timeCapReached?: boolean;
  },
): UnitDecision {
  if (options.timeCapReached === true) {
    return { outcome: "unresolved", directive: "unresolved" };
  }
  // F115-FR-023 — an excluded command reads `unchecked` and not failed: it
  // takes no part in the decision on the unit.
  const effective = results.filter((result) => result.excluded !== true);
  if (effective.length === 0) {
    return { outcome: "unchecked", directive: "none" };
  }
  const failed = effective.some((result) => result.exit !== 0);
  const conditioned = effective.some(
    (result) => result.conditions !== undefined && result.conditions.length > 0,
  );
  if (!failed && !conditioned) {
    return { outcome: "kept", directive: "keep" };
  }
  if (repairsLeftFor(options.taskIds, options.budget) > 0) {
    return { outcome: "repair", directive: "repair" };
  }
  return { outcome: "unresolved", directive: "unresolved" };
}
