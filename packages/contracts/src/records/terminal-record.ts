/**
 * T054 — the type and the validator of terminal record (annex B, §B.15).
 *
 * Schema id `specstride.terminal/1`, logical name `run:<runId>:terminal`. The type is
 * generated from `schemas/terminal-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-071.
 */
import type { TerminalRecord } from "./generated/terminal-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { TerminalRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.terminal/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:terminal" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.15" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.15 is required (F100-FR-048, F100-FR-049).
 */
export function readTerminalRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): TerminalRecord {
  return readRecord<TerminalRecord>(logicalName, value);
}

/** `readTerminalRecord` that returns a result instead of throwing. */
export function tryReadTerminalRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: TerminalRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<TerminalRecord>(logicalName, value);
}

/** True when the value validates against `specstride.terminal/1`. */
export function isTerminalRecord(value: unknown): value is TerminalRecord {
  return validate<TerminalRecord>(SCHEMA_ID, value).ok;
}

/** The five fields of §B.15 marked "fixed": the content owner may not change them. */
export const FIXED_FIELDS = ["exitCode", "stopReason", "retryable", "cause", "causedBy"] as const;
export type FixedField = (typeof FIXED_FIELDS)[number];

/** The closed set of `cause` and `causedBy` (annex X §X.6 row 5). */
export const CAUSES = ["normal", "crash", "owner-lost"] as const;
export const CAUSED_BY = ["self", "operator", "supervisor", "host", "crash"] as const;
/** An unknown value of either is read as `crash` (row 5). */
export const CAUSE_ON_UNKNOWN = "crash" as const;

/**
 * F100-FR-071 — the engine writes the terminal record before it exits, on
 * every exit path. The readers never match a stop reason by string in the
 * event file; when the record is missing they classify the end as a crash
 * from the exit code and write a synthesized record.
 */
export const READERS_MATCH_STOP_REASON_BY_STRING_IN_THE_EVENT_FILE = false as const;

export function synthesizedRecord(input: {
  readonly exitCode: number;
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId: string;
  readonly at: string;
}): TerminalRecord {
  return {
    schema: "specstride.terminal/1",
    exitCode: input.exitCode,
    stopReason: null,
    retryable: false,
    cause: "crash",
    causedBy: "crash",
    runId: input.runId,
    launchId: input.launchId,
    engineStartId: input.engineStartId,
    at: input.at,
    synthesized: true,
  } as unknown as TerminalRecord;
}
