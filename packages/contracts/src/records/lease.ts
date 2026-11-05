/**
 * T040 — the type and the validator of lease (annex B, §B.8).
 *
 * Schema id `specstride.lease/1`, logical name `run:<runId>:lease`. The type is
 * generated from `schemas/lease.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-061.
 */
import type { Lease } from "./generated/lease.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { Lease };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.lease/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:lease" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.8" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.8 is required (F100-FR-048, F100-FR-049).
 */
export function readLease(value: unknown, logicalName: string = LOGICAL_NAME): Lease {
  return readRecord<Lease>(logicalName, value);
}

/** `readLease` that returns a result instead of throwing. */
export function tryReadLease(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: Lease } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<Lease>(logicalName, value);
}

/** True when the value validates against `specstride.lease/1`. */
export function isLease(value: unknown): value is Lease {
  return validate<Lease>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-061 — liveness is read from the lease through the lock provider and
 * is never an event. A reader derives `dead` when the run record shows a live
 * state and the lease has no live owner, and `stale` when the owner lives and
 * both the heartbeat and the newest event are old.
 */
export const DERIVED_CONDITIONS = ["dead", "stale", "launch-abandoned"] as const;
export type DerivedCondition = (typeof DERIVED_CONDITIONS)[number];

/** Liveness is never an event (F100-FR-061). */
export const LIVENESS_IS_AN_EVENT = false as const;

export function derivedCondition(input: {
  readonly runStateIsLive: boolean;
  readonly ownerIsLive: boolean;
  readonly heartbeatIsOld: boolean;
  readonly newestEventIsOld: boolean;
}): DerivedCondition | undefined {
  if (input.runStateIsLive && !input.ownerIsLive) return "dead";
  if (input.ownerIsLive && input.heartbeatIsOld && input.newestEventIsOld) return "stale";
  return undefined;
}

/** After `validUntil` a precomputed status line is stale (§B.8). */
export function statusLineIsStale(record: Lease, now: Date): boolean {
  const until = Date.parse(String(record.validUntil));
  return Number.isNaN(until) ? true : now.getTime() > until;
}
