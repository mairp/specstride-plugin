// T055 (F116-FR-018) — the rows of tasks as the proposer's declaration, the
// tasks of the phase that no unit named, and the one fixed sentence. Pure
// functions of the final state; a task row carries no result.
import { contentHash } from "@specstride/kernel";

/** The fixed sentence of the fact block (F116-FR-018, annex D §D.7). */
export const NOTICE =
  "A result in this block is evidence about the tree and not about a task." as const;

/** The heading under which the tasks a unit named stand (F116-FR-018). */
export const DECLARATION_HEADING = "the proposer's declaration" as const;

/** The id of a unit row: the hash of the sorted task ids (F116-FR-020). */
export function unitRowId(tasks: readonly string[]): string {
  return contentHash(JSON.stringify([...tasks].sort()));
}

/** The tasks of the phase that no unit named, in the order of the tasks at launch. */
export function unnamedTasksOf(
  taskOrder: readonly string[],
  units: readonly { tasks: readonly string[] }[],
): string[] {
  const named = new Set<string>();
  for (const unit of units) for (const task of unit.tasks) named.add(task);
  return taskOrder.filter((task) => !named.has(task));
}

export interface TaskRow {
  id: string;
  declaration: typeof DECLARATION_HEADING;
  tasks: string[];
}

/**
 * The rows of tasks per unit, headed as the proposer's declaration. Units
 * stand in the order of the tasks at launch, never in the order in which
 * they were declared (F116-FR-019, F116-FR-020).
 */
export function taskRows(
  taskOrder: readonly string[],
  units: readonly { tasks: readonly string[] }[],
): TaskRow[] {
  const position = (tasks: readonly string[]): number => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const task of tasks) {
      const at = taskOrder.indexOf(task);
      if (at !== -1 && at < best) best = at;
    }
    return best === Number.MAX_SAFE_INTEGER ? taskOrder.length : best;
  };
  return [...units]
    .sort(
      (a, b) =>
        position(a.tasks) - position(b.tasks) ||
        unitRowId(a.tasks).localeCompare(unitRowId(b.tasks)),
    )
    .map((unit) => ({
      id: unitRowId(unit.tasks),
      declaration: DECLARATION_HEADING,
      tasks: [...unit.tasks],
    }));
}
