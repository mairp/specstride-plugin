/**
 * T131 — the entry of an integrated group as one kept unit, and of a failed
 * merge check into the repair path (F115-FR-042).
 *
 * Beneath the layer of parallel units (feature 142), the proposer may group
 * the tasks of a phase into one integrated group where the tasks cannot be
 * checked apart. The micro-loop layer sees the group as ONE unit of work:
 * it is declared in one checkpoint, checked by the inner set of the phase
 * plus the merge check of the group, and it ends in one outcome.
 *
 * - The merge check passed (exit 0, no condition) and every member check
 *   passed: the group enters as one KEPT unit, directive `keep`, bound to
 *   the union of the task ids of its members.
 * - The merge check FAILED: the group enters the repair path. One repair is
 *   charged to EVERY task of the unit (`chargeOneRepairPerTask`), because
 *   the members of the group cannot be repaired apart.
 * - With parallel units OFF the layer changes nothing: the entry is not
 *   used and every member keeps the decision it had on its own
 *   (`enterIntegratedGroup` returns it unchanged; the per-task decisions
 *   are the ones `decideOutcome` gives).
 *
 * Purity: imports the layer only; no `node:fs`, no process.
 */
import {
  decideOutcome,
  type CheckResult,
  type RepairBudget,
  type UnitDecision,
} from "./outcome.ts";

/** The id of the merge check of an integrated group (the extra command). */
export const MERGE_CHECK_ID = "merge" as const;

/** One member of an integrated group: a unit beneath the group unit. */
export type IntegratedGroupMember = {
  readonly unitId: string;
  readonly taskIds: readonly string[];
  /** The results of the inner set for this member (as the runner gave them). */
  readonly results: readonly CheckResult[];
};

/** The union of the task ids of the members, in member order, duplicates dropped. */
export function groupTasks(members: readonly IntegratedGroupMember[]): string[] {
  const seen: string[] = [];
  for (const member of members) {
    for (const id of member.taskIds) {
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

/**
 * F115-FR-042 — one repair charged to every task of the group unit: the
 * budget with one repair spent on each task id, so no member of the group
 * can be repaired apart from the others.
 */
export function chargeOneRepairPerTask(
  taskIds: readonly string[],
  budget: RepairBudget,
): RepairBudget {
  const repairsLeft: Record<string, number> = { ...budget.repairsLeft };
  for (const id of taskIds) {
    const left = repairsLeft[id] ?? budget.defaultRepairsLeft;
    repairsLeft[id] = Math.max(0, left - 1);
  }
  return { repairsLeft, defaultRepairsLeft: budget.defaultRepairsLeft };
}

/** The result of the entry of an integrated group into the loop. */
export type IntegratedGroupEntry =
  | {
      readonly entered: true;
      /** The group is ONE unit: its id, its tasks, its one decision. */
      readonly unitId: string;
      readonly tasks: readonly string[];
      readonly decision: UnitDecision;
      /** The budget after the charge of a failed merge check (unchanged on keep). */
      readonly budget: RepairBudget;
    }
  | {
      /** Parallel units are off: nothing changes, the members stand alone. */
      readonly entered: false;
      readonly decisions: Readonly<Record<string, UnitDecision>>;
    };

/**
 * F115-FR-042 — enter an integrated group into the micro-loop.
 *
 * With parallel units ON, the group is one unit: the merge check is the
 * command `merge` of the inner set, and its result decides with the member
 * results. With parallel units OFF the entry is refused (`entered: false`)
 * and the per-member decisions of `decideOutcome` are returned unchanged —
 * the layer beneath parallel units changes nothing when parallel units are
 * off.
 */
export function enterIntegratedGroup(group: {
  readonly unitId: string;
  readonly members: readonly IntegratedGroupMember[];
  /** The result of the merge check of the group. */
  readonly mergeResult: CheckResult;
  /** The budget of repairs for the tasks of the group. */
  readonly budget: RepairBudget;
  /** Whether the layer of parallel units is on for this run (feature 142). */
  readonly parallelUnitsOn: boolean;
  /** True when the time cap of the group unit is reached (F115-FR-016). */
  readonly timeCapReached?: boolean;
}): IntegratedGroupEntry {
  if (!group.parallelUnitsOn) {
    const decisions: Record<string, UnitDecision> = {};
    for (const member of group.members) {
      decisions[member.unitId] = decideOutcome(member.results, {
        taskIds: member.taskIds,
        budget: group.budget,
        timeCapReached: group.timeCapReached,
      });
    }
    return { entered: false, decisions };
  }
  const tasks = groupTasks(group.members);
  const allResults = [...group.members.flatMap((member) => member.results), group.mergeResult];
  const decision = decideOutcome(allResults, {
    taskIds: tasks,
    budget: group.budget,
    timeCapReached: group.timeCapReached,
  });
  // A failed merge check charges one repair to every task of the unit,
  // whether the unit goes to repair now or is already unresolved.
  const mergeFailed =
    group.mergeResult.exit !== 0 ||
    (group.mergeResult.conditions !== undefined && group.mergeResult.conditions.length > 0);
  const budget = mergeFailed ? chargeOneRepairPerTask(tasks, group.budget) : group.budget;
  return {
    entered: true,
    unitId: group.unitId,
    tasks,
    decision,
    budget,
  };
}
