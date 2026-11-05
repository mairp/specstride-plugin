/**
 * T043 — the task list as read at launch (F115-FR-012).
 *
 * The task list of each phase as read at launch, with its order, its ids and
 * its hash, is the record `run:<runId>:task-list` of annex B §B.5 of feature
 * 100, which the engine writes at launch from the canonical spec model. The
 * layer reads it through the read-only view of the phase attempt and MUST
 * NOT store the reading, or a copy of it, under a name of its own. Validation
 * of a checkpoint uses that reading, and the reading is given to the builder
 * of the fact block with the rows of the units. A difference between that
 * reading and the task list at the phase gate, other than ticked
 * checkboxes, is the further fact `task-list-changed` (annex D §D.7; annex X
 * §X.6 row 66).
 *
 * This module writes no task list: the only export that names a record is a
 * pure name builder, and no function here takes a writer.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/**
 * The logical name of the record, exactly as annex B §B.5 names it: the
 * layer reads this record, the engine writes it, the layer stores no copy.
 */
export const TASK_LIST_RECORD = "run:<runId>:task-list" as const;

/** The further fact the builder of the fact block gets on a difference. */
export const TASK_LIST_CHANGED_FACT = "task-list-changed" as const;

/** The logical name of the record for one concrete run. */
export function taskListRecordName(runId: string): string {
  return `run:${runId}:task-list`;
}

/** The task list as the engine wrote it at launch (annex B §B.5). */
export type TaskListAtLaunch = {
  readonly phase: number;
  /** The task ids of the phase, in order. */
  readonly taskIds: readonly string[];
  /** Hash of the list, by the hash that ignores checkboxes. */
  readonly hash: string;
};

/**
 * The read-only view of the phase attempt as far as this module needs it:
 * one accessor for a record of the run, which the engine serves from the
 * control plane. The layer never writes through it.
 */
export type TaskListView = {
  /** Read a record of the run by its logical name; `undefined` when absent. */
  readonly readRecord: (name: string) => unknown;
};

/** A record that is not a task list of the phase the layer asked about. */
export type TaskListMismatch = { readonly ok: false; readonly reason: "not-a-task-list" };

/** The reading succeeded; the layer holds the value only for this call. */
export type TaskListRead = { readonly ok: true; readonly taskList: TaskListAtLaunch };

/** The result of reading the task list as read at launch. */
export type TaskListResult = TaskListRead | TaskListMismatch;

/** Shape guard for the record the engine serves. */
function isTaskList(value: unknown): value is TaskListAtLaunch {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.phase === "number" &&
    Array.isArray(record.taskIds) &&
    record.taskIds.every((id) => typeof id === "string") &&
    typeof record.hash === "string"
  );
}

/**
 * F115-FR-012 — read `run:<runId>:task-list` through the read-only view of
 * the phase attempt. The layer stores nothing: the caller uses the value
 * inside the call and drops it.
 */
export function readTaskListAtLaunch(runId: string, view: TaskListView): TaskListResult {
  const record = view.readRecord(taskListRecordName(runId));
  if (!isTaskList(record)) return { ok: false, reason: "not-a-task-list" };
  return { ok: true, taskList: record };
}

/**
 * A difference between the reading at launch and the task list at the phase
 * gate, other than ticked checkboxes. Checkbox state arrives as the `ticked`
 * flag of a task; everything else — ids, order, the hash that ignores
 * checkboxes — must be equal.
 */
export type TaskListAtGate = {
  readonly phase: number;
  readonly taskIds: readonly string[];
  readonly hash: string;
  /** Per task id: whether its checkbox is ticked at the phase gate. */
  readonly ticked?: Readonly<Record<string, boolean>>;
};

/** The lists agree up to ticked checkboxes. */
export type TaskListUnchanged = { readonly changed: false };

/** The lists differ beyond ticked checkboxes; the fact `task-list-changed` follows. */
export type TaskListChanged = {
  readonly changed: true;
  readonly fact: typeof TASK_LIST_CHANGED_FACT;
};

/** The result of the comparison at the phase gate. */
export type TaskListComparison = TaskListUnchanged | TaskListChanged;

/**
 * F115-FR-012 — compare the reading at launch with the task list at the
 * phase gate. Ticked checkboxes are the only allowed difference; a
 * difference of ids, of order or of the checkbox-ignoring hash is given to
 * the builder of the fact block as `task-list-changed`.
 */
export function compareTaskListAtGate(
  atLaunch: TaskListAtLaunch,
  atGate: TaskListAtGate,
): TaskListComparison {
  if (atLaunch.phase !== atGate.phase) return { changed: true, fact: TASK_LIST_CHANGED_FACT };
  if (atLaunch.hash !== atGate.hash) return { changed: true, fact: TASK_LIST_CHANGED_FACT };
  if (atLaunch.taskIds.length !== atGate.taskIds.length) {
    return { changed: true, fact: TASK_LIST_CHANGED_FACT };
  }
  for (let i = 0; i < atLaunch.taskIds.length; i += 1) {
    if (atLaunch.taskIds[i] !== atGate.taskIds[i]) {
      return { changed: true, fact: TASK_LIST_CHANGED_FACT };
    }
  }
  return { changed: false };
}
