/**
 * T037 — THE TASK-LIST READING AND ITS COMPARISON (F104-FR-026;
 * `contracts/verdict.md`, the row TaskListReading of `data-model.md`).
 *
 * At launch the model gives, for every phase, the reading of its task list:
 * the ordered ids, markers and text of its tasks, and the CANONICAL RECORD HASH
 * of that list. A later reading is comparable with it and reports which ids
 * were added, removed, reordered or changed in text.
 *
 * The reading is the CONTENT of the record `run:<runId>:task-list` of annex B
 * §B.5 — one per run, which the ENGINE writes at launch and which the engine
 * and the loop layers read. **This feature gives the reading and never writes
 * the record** (F104-FR-026, CQ-044): `WRITES_THE_TASK_LIST_RECORD` of
 * `model.ts` is `false`, and this module imports nothing that writes a file.
 * `contentOfTheRecord` below builds the value the engine puts in the record and
 * hands it back; the write, its path and its atomicity are the engine's.
 *
 * Two fields of a task are kept OUT of the reading on purpose: `ticked` and
 * `line` (and with them the task's `file`). That is what makes the reading's
 * hash survive a tick and a line shift — the same guarantee the hash that
 * ignores checkboxes gives for a file (F104-FR-022), reached here by leaving
 * the state out of the record rather than by normalising it away.
 */
import { canonicalRecordHash, canonicalRecordText } from "@specstride/kernel/hasher";
import { validate } from "@specstride/contracts/records/compile";
import {
  TASK_LIST_LOGICAL_NAME,
  TASK_LIST_SCHEMA_ID,
  WRITES_THE_TASK_LIST_RECORD,
  type CanonicalSpecModel,
  type SpecPhase,
  type SpecTask,
  type TaskListComparison,
  type TaskListReading,
  type TaskReading,
} from "./model.ts";

/** The requirement this module carries out. */
export const REQUIREMENTS = ["F104-FR-026"] as const;

/** The section of annex B that owns the record the reading is the content of. */
export const RECORD_ANNEX_SECTION = "annex B, §B.5" as const;

/** The logical name and the schema id of that record, re-exported from `model.ts`. */
export { TASK_LIST_LOGICAL_NAME, TASK_LIST_SCHEMA_ID, WRITES_THE_TASK_LIST_RECORD };

/** Who writes the record: the engine, at launch — never this feature. */
export const WRITER_OF_THE_RECORD = "the engine, at launch" as const;

/**
 * The fields of a task that the reading keeps, and the fields it leaves out.
 * Both lists are exported so that "ticks and line numbers never enter the hash"
 * is measurable on the module and not only stated (`data-model.md`, the row
 * Task).
 */
export const FIELDS_OF_A_READING = ["id", "markers", "text"] as const;
export const FIELDS_LEFT_OUT_OF_A_READING = ["ticked", "line", "file"] as const;

/* ------------------------------------------------------------------ *
 * The reading (F104-FR-026).
 * ------------------------------------------------------------------ */

/** The reading of ONE task: the id, the markers and the text, and nothing else. */
export function readingOfTask(task: SpecTask): TaskReading {
  return Object.freeze({
    id: task.id,
    markers: Object.freeze([...task.markers]),
    text: task.text,
  });
}

/** The readings of the tasks of a phase, in document order (F104-FR-026). */
export function readingsOfTasks(tasks: readonly SpecTask[]): readonly TaskReading[] {
  return Object.freeze(tasks.map(readingOfTask));
}

/**
 * The record the hash is taken over: the ordered readings of the tasks. The
 * value is exported from `hashedRecordOf` so that a caller — or a test — can
 * see exactly what the hash covers, instead of inferring it from the digest.
 */
export function hashedRecordOf(tasks: readonly TaskReading[]): readonly TaskReading[] {
  return Object.freeze(
    tasks.map((t) => Object.freeze({ id: t.id, markers: [...t.markers], text: t.text })),
  );
}

/**
 * The canonical record hash of a list of task readings (annex X §X.5). It is
 * the hasher's, never this module's; a tick and a line shift do not change it,
 * because neither `ticked` nor `line` is in the record.
 */
export function hashOfReadings(tasks: readonly TaskReading[]): string {
  return canonicalRecordHash(hashedRecordOf(tasks));
}

/** The canonical record TEXT of the same list, the form the hash is taken over. */
export function textOfReadings(tasks: readonly TaskReading[]): string {
  return canonicalRecordText(hashedRecordOf(tasks));
}

/** F104-FR-026 — the reading of the task list of ONE phase. */
export function readingOfPhase(phase: SpecPhase): TaskListReading {
  const tasks = readingsOfTasks(phase.tasks);
  return Object.freeze({ phase: phase.number, tasks, hash: hashOfReadings(tasks) });
}

/**
 * F104-FR-026 — the reading of EVERY phase of a model, in document order. This
 * is what the model gives at launch.
 */
export function readingsOfModel(model: CanonicalSpecModel): readonly TaskListReading[] {
  return Object.freeze(model.phases.map(readingOfPhase));
}

/** The reading of one phase number of a model, where the model holds it. */
export function readingOfPhaseNumber(
  model: CanonicalSpecModel,
  number: number,
): TaskListReading | undefined {
  const phase = model.phases.find((p) => p.number === number);
  return phase === undefined ? undefined : readingOfPhase(phase);
}

/* ------------------------------------------------------------------ *
 * The CONTENT of the record `run:<runId>:task-list` (annex B §B.5).
 * ------------------------------------------------------------------ */

/**
 * The content of the record `run:<runId>:task-list`: the readings of every
 * phase of the run, one record per run (annex B §B.5; CQ-044).
 *
 * This function RETURNS the content. It does not write it, and this module
 * holds no write: the engine writes the record at launch, and the engine and
 * the loop layers read it (F104-FR-026).
 */
export type TaskListRecordContent = {
  /**
   * The schema id the record carries. The `schema` field is the IDENTITY of a
   * record of this product (F100-FR-048), and the schema of annex B §B.20
   * requires it, so the content this feature hands the engine carries it.
   */
  readonly schema: typeof TASK_LIST_SCHEMA_ID;
  readonly phases: readonly TaskListReading[];
};

/** The content the engine puts in the record; nothing here is written to disk. */
export function contentOfTheRecord(model: CanonicalSpecModel): TaskListRecordContent {
  return Object.freeze({ schema: TASK_LIST_SCHEMA_ID, phases: readingsOfModel(model) });
}

/**
 * The record crosses a file boundary, so its content is validated against a
 * schema of `@specstride/contracts` (Principle VI; F104-FR-026, research D-13).
 *
 * The schema id is `specstride.task-list/1`, which feature 100 gives in annex B
 * §B.20. While feature 100 has not delivered the schema file, this function
 * says so — `schema: "absent"` — instead of reporting a validation that did not
 * happen. A pass is reported only where a schema was actually applied.
 */
export type ReadingValidation =
  | { readonly schema: "applied"; readonly ok: true }
  | { readonly schema: "applied"; readonly ok: false; readonly errors: readonly string[] }
  | { readonly schema: "absent"; readonly reason: string };

/** The keyword `@specstride/contracts` reports for a schema id it does not hold. */
export const KEYWORD_OF_AN_ABSENT_SCHEMA = "unknown-schema" as const;

/** The reason an absent schema is reported with: who owns the id, and who delivers it. */
export function absentSchemaReason(detail: string): string {
  return (
    `\`@specstride/contracts\` holds no schema \`${TASK_LIST_SCHEMA_ID}\`: feature 100 gives ` +
    `the id in annex B §B.20, where none existed at the analyze run, and this feature ` +
    `delivers the file through its own \`contracts/deliver.json\` (research D-13). ` +
    `Reported, not validated (${detail})`
  );
}

export function validateRecordContent(content: unknown): ReadingValidation {
  let result: ReturnType<typeof validate>;
  try {
    result = validate(TASK_LIST_SCHEMA_ID, content);
  } catch (cause) {
    return Object.freeze({
      schema: "absent" as const,
      reason: absentSchemaReason(cause instanceof Error ? cause.message : String(cause)),
    });
  }
  if (result.ok) return Object.freeze({ schema: "applied" as const, ok: true as const });
  // A schema id the package does not hold is reported as ABSENT and never as a
  // record that failed validation: the two are different facts, and only the
  // second is this feature's to fix.
  const unknown = result.errors.find((e) => e.keyword === KEYWORD_OF_AN_ABSENT_SCHEMA);
  if (unknown !== undefined) {
    return Object.freeze({
      schema: "absent" as const,
      reason: absentSchemaReason(unknown.message),
    });
  }
  return Object.freeze({
    schema: "applied" as const,
    ok: false as const,
    errors: Object.freeze(result.errors.map((e) => `${e.path} ${e.message}`)),
  });
}

/* ------------------------------------------------------------------ *
 * The comparison (F104-FR-026; `contracts/verdict.md`).
 * ------------------------------------------------------------------ */

/** The ids of a reading, in order. */
export function idsOf(tasks: readonly TaskReading[]): readonly string[] {
  return Object.freeze(tasks.map((t) => t.id));
}

/**
 * Whether the ids the two readings SHARE appear in a different relative order.
 * An id that was added or removed is not a reorder: it is reported as such, so
 * `reordered` stays a statement about the tasks that are in both readings.
 */
export function isReordered(
  before: readonly TaskReading[],
  after: readonly TaskReading[],
): boolean {
  const inAfter = new Set(idsOf(after));
  const inBefore = new Set(idsOf(before));
  const kept = (list: readonly TaskReading[], other: ReadonlySet<string>) =>
    list.filter((t) => other.has(t.id)).map((t) => t.id);
  const left = kept(before, inAfter);
  const right = kept(after, inBefore);
  return left.length === right.length && left.some((id, index) => id !== right[index]);
}

/**
 * F104-FR-026 — how a later reading differs from the recorded one: which ids
 * were `added`, `removed`, `reordered` or changed in `text`
 * (`contracts/verdict.md`, the four fields of the comparison).
 *
 * A tick changes NOTHING here, because `ticked` is not in a reading.
 */
export function compareReadings(
  before: readonly TaskReading[],
  after: readonly TaskReading[],
): TaskListComparison {
  const byIdBefore = new Map(before.map((t) => [t.id, t]));
  const byIdAfter = new Map(after.map((t) => [t.id, t]));
  const added = after.filter((t) => !byIdBefore.has(t.id)).map((t) => t.id);
  const removed = before.filter((t) => !byIdAfter.has(t.id)).map((t) => t.id);
  const textChanged = before
    .filter((t) => {
      const now = byIdAfter.get(t.id);
      return now !== undefined && now.text !== t.text;
    })
    .map((t) => t.id);
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    reordered: isReordered(before, after),
    textChanged: Object.freeze(textChanged),
  });
}

/**
 * The ids whose MARKERS differ, which the four fields of the comparison do not
 * cover. It is reported by a function of its own rather than folded into
 * `textChanged`, because `contracts/verdict.md` names exactly four fields and
 * F104-FR-026 says "changed in text". A markers change still moves the hash, so
 * it is never silently lost.
 */
export function markersChanged(
  before: readonly TaskReading[],
  after: readonly TaskReading[],
): readonly string[] {
  const byIdAfter = new Map(after.map((t) => [t.id, t]));
  return Object.freeze(
    before
      .filter((t) => {
        const now = byIdAfter.get(t.id);
        return (
          now !== undefined &&
          (now.markers.length !== t.markers.length ||
            now.markers.some((m, i) => m !== t.markers[i]))
        );
      })
      .map((t) => t.id),
  );
}

/** True where the two readings differ in no way the comparison reports. */
export function isUnchanged(comparison: TaskListComparison): boolean {
  return (
    comparison.added.length === 0 &&
    comparison.removed.length === 0 &&
    !comparison.reordered &&
    comparison.textChanged.length === 0
  );
}

/** The comparison of two readings of ONE phase, by their task lists. */
export function compareReadingsOfPhase(
  before: TaskListReading,
  after: TaskListReading,
): TaskListComparison {
  return compareReadings(before.tasks, after.tasks);
}
