/**
 * T086 of feature 103 — THE TASK EVENTS OF THE PASS LOOP (F103-FR-044).
 *
 * The loop emits two events of the catalogue of feature 111:
 *
 *  - `task.planned`, ONCE PER TASK of the phase slice, at the OPEN of the
 *    phase attempt, with `taskId` and with `estimateMs` where the format of
 *    the task list gives an estimate;
 *  - `task.ticked`, after a pass, for every task whose checkbox changed from
 *    UNTICKED to TICKED during that pass, with `taskId` and `elapsedMs`
 *    measured from the open of the phase attempt, where the time is known.
 *
 * ## The loop ticks nothing
 *
 * F103-FR-044: "The loop MUST tick no checkbox and MUST edit the task list in
 * no way; it reads the change by comparing the task list, read through the
 * spec-format adapter port, before and after the pass."
 *
 * That is why this module has NO writer of any kind. `TaskListPort` is a READ
 * port with one operation, `readPhaseSlice`, and the only thing the module
 * does with two readings is compare them. `THE_LOOP_TICKS_A_CHECKBOX` and
 * `THE_LOOP_EDITS_THE_TASK_LIST` are `false` as constants so a test can assert
 * the rule rather than infer it from the absence of code, and the port type
 * has no `write`, no `tick` and no `save`.
 *
 * ## Why a PORT and not an import of the spec-format adapter
 *
 * The core imports the contracts package and the kernel and nothing else
 * (F100-FR-012, and the rule `core-modules-103` of
 * `tools/import-boundary/rules/`). The canonical spec model of feature 104
 * lives in the spec-format package of Wave 1, which the core may not import.
 * So the reading arrives as data through a port the engine fills, exactly as the
 * harness arrives through `HarnessPort`. `TaskSliceReading` is the shape of
 * one task as this module needs it, and it is a SUBSET of feature 104's
 * `SpecTask`: `id` and `ticked`, with the optional `estimateMs` the format may
 * give.
 *
 * ## Every profile, and no compared surface
 *
 * F103-FR-044: "Both events MUST be emitted in every profile: they project to
 * nothing at the baseline, so no compared surface changes under `parity`, and
 * selecting the profile changes nothing else (F100-FR-210)."
 *
 * Rows 107 and 108 of `packages/observability/data/projection/projection-table.tsv`
 * give both types the as-is name `-` and the dialect `none`: there is no as-is
 * equivalent, so the compatibility projection renders nothing for either. That
 * is what `PROJECTS_TO` and `AS_IS_NAME` record here, and it is why the events
 * need no row of annex X §X.7: a behaviour that differed under the profile
 * would need one (F100-FR-210), and this one does not differ.
 *
 * B-8.7 of `spec.md` withdrew the earlier reading that the events are
 * suppressed under `parity`; `EMITTED_IN_EVERY_PROFILE` is the reading that
 * stands.
 *
 * They are also emitted on a channel of their own (`emitEvent` of
 * `LoopServices`), not through `emit`, which carries the AS-IS announcements
 * of `./announce.ts`. A catalogue event that reached the as-is stream would
 * change a compared surface, which is the one thing F103-FR-044 forbids.
 */

/** The requirement this module carries out. */
export const REQUIREMENTS = ["F103-FR-044"] as const;

/** The catalogue the two types belong to. */
export const EVENT_CATALOGUE_FILE = "packages/observability/data/event-catalogue.tsv" as const;
export const PROJECTION_TABLE_FILE =
  "packages/observability/data/projection/projection-table.tsv" as const;

/** The type emitted once per task of the phase slice at the open of the attempt. */
export const TASK_PLANNED = "task.planned" as const;

/** The type emitted per checkbox newly ticked after a pass. */
export const TASK_TICKED = "task.ticked" as const;

/** The two types, in the order F103-FR-044 names them. */
export const TASK_EVENT_TYPES = [TASK_PLANNED, TASK_TICKED] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

/** The fields of each type, as the event catalogue gives them. */
export const TASK_EVENT_FIELDS: Readonly<Record<TaskEventType, readonly string[]>> = Object.freeze({
  [TASK_PLANNED]: Object.freeze(["taskId", "estimateMs"]),
  [TASK_TICKED]: Object.freeze(["taskId", "elapsedMs"]),
});

/** F103-FR-044 — the events are emitted whatever the profile is. */
export const EMITTED_IN_EVERY_PROFILE = true as const;

/** Rows 107 and 108 of the projection table: `none`, so nothing is rendered. */
export const PROJECTS_TO = "none" as const;
export const AS_IS_NAME: undefined = undefined;

/** F103-FR-044 — no switch, so no row of annex X §X.7 (F100-FR-210). */
export const HAS_A_PROFILE_ROW = false as const;

/** F103-FR-044 — the loop ticks no checkbox and edits the task list in no way. */
export const THE_LOOP_TICKS_A_CHECKBOX = false as const;
export const THE_LOOP_EDITS_THE_TASK_LIST = false as const;

/** F103-FR-044 — the change is read by comparing two readings of the list. */
export const READ_THROUGH = "the spec-format adapter port" as const;

/**
 * One task of the phase slice as the loop needs it. A SUBSET of feature 104's
 * `SpecTask`: the id, whether the checkbox is ticked, and the estimate where
 * the format of the task list gives one.
 */
export type TaskSliceReading = {
  readonly id: string;
  readonly ticked: boolean;
  /** Where the format of the task list gives an estimate; absent otherwise. */
  readonly estimateMs?: number | undefined;
};

/**
 * The READ port the engine fills from the spec-format adapter of feature 104.
 * It has one operation and no writer of any kind: the loop cannot tick a
 * checkbox through it, which is F103-FR-044's own rule expressed in the type.
 */
export type TaskListPort = {
  /** The tasks of the phase slice, as the adapter reads them NOW. */
  readPhaseSlice(): readonly TaskSliceReading[];
};

/** One emitted event: its catalogue type and its fields. */
export type TaskEvent = {
  readonly type: TaskEventType;
  readonly fields: Readonly<Record<string, unknown>>;
};

/**
 * F103-FR-044 — `task.planned` once per task of the phase slice, in the order
 * the slice gives them. `estimateMs` is carried only where the format gave
 * one: an absent estimate is an ABSENT FIELD, not a zero, because a zero
 * would read as "this task takes no time".
 */
export function plannedEvents(slice: readonly TaskSliceReading[]): readonly TaskEvent[] {
  return Object.freeze(
    slice.map((task) =>
      Object.freeze({
        type: TASK_PLANNED,
        fields: Object.freeze({
          taskId: task.id,
          ...(task.estimateMs === undefined ? {} : { estimateMs: task.estimateMs }),
        }),
      }),
    ),
  );
}

/**
 * The tasks whose checkbox changed from UNTICKED to TICKED between two
 * readings. A task that was already ticked is not reported, a task that
 * appeared in the later reading already ticked is not reported either (it was
 * never seen unticked by this attempt), and a task that went from ticked to
 * unticked is not reported — F103-FR-044 names one direction only.
 */
export function newlyTicked(
  before: readonly TaskSliceReading[],
  after: readonly TaskSliceReading[],
): readonly string[] {
  const was = new Map(before.map((task) => [task.id, task.ticked]));
  const ids: string[] = [];
  for (const task of after) {
    if (task.ticked && was.get(task.id) === false) ids.push(task.id);
  }
  return Object.freeze(ids);
}

/**
 * F103-FR-044 — `task.ticked` per checkbox newly ticked during the pass, with
 * `elapsedMs` measured FROM THE OPEN OF THE PHASE ATTEMPT. "Where the time is
 * known": an unknown elapsed time leaves the field out rather than inventing
 * a number.
 */
export function tickedEvents(
  before: readonly TaskSliceReading[],
  after: readonly TaskSliceReading[],
  elapsedMs?: number | undefined,
): readonly TaskEvent[] {
  return Object.freeze(
    newlyTicked(before, after).map((id) =>
      Object.freeze({
        type: TASK_TICKED,
        fields: Object.freeze({
          taskId: id,
          ...(elapsedMs === undefined ? {} : { elapsedMs }),
        }),
      }),
    ),
  );
}

/**
 * The elapsed time of F103-FR-044: from the open of the phase attempt to now,
 * never negative. Both stamps are milliseconds of the clock the engine hands
 * the loop; where either is absent the time is NOT KNOWN and the field is left
 * out by `tickedEvents`.
 */
export function elapsedSinceOpen(openedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - openedAtMs);
}
