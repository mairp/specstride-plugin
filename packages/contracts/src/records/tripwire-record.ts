/**
 * T060 — the type and the validator of tripwire record (annex B, §B.18).
 *
 * Schema id `specstride.tripwire/1`, logical name `user:tripwire`. The type is
 * generated from `schemas/tripwire-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-074.
 */
import type { TripwireRecord } from "./generated/tripwire-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { TripwireRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.tripwire/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "user:tripwire" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.18" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.18 is required (F100-FR-048, F100-FR-049).
 */
export function readTripwireRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): TripwireRecord {
  return readRecord<TripwireRecord>(logicalName, value);
}

/** `readTripwireRecord` that returns a result instead of throwing. */
export function tryReadTripwireRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: TripwireRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<TripwireRecord>(logicalName, value);
}

/** True when the value validates against `specstride.tripwire/1`. */
export function isTripwireRecord(value: unknown): value is TripwireRecord {
  return validate<TripwireRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-074 — on a breach of the integrity of the phase gate the runtime
 * writes the tripwire record. While it exists, every run on the machine runs
 * with every loop layer off, announced, until the operator clears the
 * tripwire by a command. Clearing removes the record and is recorded as an
 * event in the next run.
 */
export const EFFECT_WHILE_IT_EXISTS = "every-loop-layer-off-announced" as const;
export const CLEARED_BY = "a command of the operator" as const;
export const CLEARING_EVENT = "integrity.tripwire-cleared" as const;

export function loopLayersAreOff(tripwireExists: boolean): boolean {
  return tripwireExists;
}

/** It is the only write the runtime makes to user-level state (§B.18). */
export const THE_ONLY_RUNTIME_WRITE_TO_USER_STATE = "user:tripwire" as const;
