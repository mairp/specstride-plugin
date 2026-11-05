/**
 * T048 — the type and the validator of run snapshot (annex B, §B.12).
 *
 * Schema id `specstride.snapshot/1`, logical name `run:<runId>:snapshot`. The type is
 * generated from `schemas/run-snapshot.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-066 and F100-FR-067.
 */
import type { RunSnapshot } from "./generated/run-snapshot.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { RunSnapshot };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.snapshot/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:snapshot" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.12" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.12 is required (F100-FR-048, F100-FR-049).
 */
export function readRunSnapshot(value: unknown, logicalName: string = LOGICAL_NAME): RunSnapshot {
  return readRecord<RunSnapshot>(logicalName, value);
}

/** `readRunSnapshot` that returns a result instead of throwing. */
export function tryReadRunSnapshot(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: RunSnapshot } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<RunSnapshot>(logicalName, value);
}

/** True when the value validates against `specstride.snapshot/1`. */
export function isRunSnapshot(value: unknown): value is RunSnapshot {
  return validate<RunSnapshot>(SCHEMA_ID, value).ok;
}

/** The closed set of key classes of the run snapshot (annex X §X.6 row 76). */
export const KEY_CLASSES = ["pinned", "tunable"] as const;
export type KeyClass = (typeof KEY_CLASSES)[number];

/** A key of the run snapshot without a class is read as `pinned` (row 76). */
export const KEY_CLASS_DEFAULT: KeyClass = "pinned";

/**
 * F100-FR-066 — on `resume` a pinned key ranks below flags and above the
 * environment; a tunable key ranks below the environment. The ranks are those
 * of annex X §X.2: 2 flag, 3 run snapshot, 4 environment, 5 project.
 */
export function snapshotRankOnResume(cls: KeyClass): number {
  return cls === "pinned" ? 3 : 4.5;
}

/** F100-FR-066 — a failed write of the snapshot is a launch error. */
export const FAILED_SNAPSHOT_WRITE_IS_A_LAUNCH_ERROR = true as const;

/** The three source files whose hashes the snapshot pins (§B.12). */
export const PINNED_SOURCES = ["spec", "plan", "tasks"] as const;
export type PinnedSource = (typeof PINNED_SOURCES)[number];

/**
 * F100-FR-067 — the source hashes are compared at launch of a continued run,
 * at `resume` and at the start of every pass. For the task list the hash
 * that ignores checkboxes is the one compared. Under the `parity` profile
 * the three check points are not active and the plan is checked when the
 * critic starts, as at the baseline (row 15 of annex X §X.7).
 */
export const CHECK_POINTS = ["launch", "resume", "pass-start"] as const;
export const CHECK_POINTS_UNDER_PARITY = ["critic-start"] as const;

export function hashComparedFor(file: PinnedSource): "contentHash" | "hashIgnoringCheckboxes" {
  return file === "tasks" ? "hashIgnoringCheckboxes" : "contentHash";
}
