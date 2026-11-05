/**
 * T058 — the type and the validator of pause record (annex B, §B.17).
 *
 * Schema id `specstride.pause/1`, logical name `run:<runId>:pause`. The type is
 * generated from `schemas/pause-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-073.
 */
import type { PauseRecord } from "./generated/pause-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { PauseRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.pause/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:pause" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.17" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.17 is required (F100-FR-048, F100-FR-049).
 */
export function readPauseRecord(value: unknown, logicalName: string = LOGICAL_NAME): PauseRecord {
  return readRecord<PauseRecord>(logicalName, value);
}

/** `readPauseRecord` that returns a result instead of throwing. */
export function tryReadPauseRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: PauseRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<PauseRecord>(logicalName, value);
}

/** True when the value validates against `specstride.pause/1`. */
export function isPauseRecord(value: unknown): value is PauseRecord {
  return validate<PauseRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-073 — the pause record exists exactly while the run is in the state
 * `paused-quota`, and there is one per run whatever the number of workers.
 */
export const STATE_WITH_A_PAUSE_RECORD = "paused-quota" as const;
export const PAUSE_RECORDS_PER_RUN = 1 as const;

export function shouldExist(runState: string): boolean {
  return runState === STATE_WITH_A_PAUSE_RECORD;
}

/**
 * F100-FR-073 — a start of the engine that finds a pause record enters the
 * pause again and computes the remaining wait from `resumeAt` and
 * `ceilingAt`, never from a timer.
 */
export const REMAINING_WAIT_COMES_FROM_A_TIMER = false as const;

export function remainingWaitSeconds(record: PauseRecord, now: Date): number {
  const resume = Date.parse(String(record.resumeAt ?? ""));
  const ceiling = Date.parse(String(record.ceilingAt));
  const target = Number.isNaN(resume) ? ceiling : Math.min(resume, ceiling);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.round((target - now.getTime()) / 1000));
}
