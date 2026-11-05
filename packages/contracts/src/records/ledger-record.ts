/**
 * T050 — the type and the validator of ledger record (annex B, §B.13).
 *
 * Schema id `specstride.ledger/1`, logical name `run:<runId>:ledger`. The type is
 * generated from `schemas/ledger-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-068 and F100-FR-069.
 */
import type { LedgerRecord } from "./generated/ledger-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { LedgerRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.ledger/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:ledger" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.13" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.13 is required (F100-FR-048, F100-FR-049).
 */
export function readLedgerRecord(value: unknown, logicalName: string = LOGICAL_NAME): LedgerRecord {
  return readRecord<LedgerRecord>(logicalName, value);
}

/** `readLedgerRecord` that returns a result instead of throwing. */
export function tryReadLedgerRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: LedgerRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<LedgerRecord>(logicalName, value);
}

/** True when the value validates against `specstride.ledger/1`. */
export function isLedgerRecord(value: unknown): value is LedgerRecord {
  return validate<LedgerRecord>(SCHEMA_ID, value).ok;
}

/** The namespace `core` of the ledger; a loop layer owns its own (§B.13). */
export const CORE_NAMESPACE = "core" as const;

/**
 * F100-FR-068 — a run has one ledger: append-only, every record chained to
 * the one before and signed with a key that is not the approval key.
 */
export const LEDGER_KEY_IS_THE_APPROVAL_KEY = false as const;

export function isChained(
  records: readonly LedgerRecord[],
  hashOf: (record: LedgerRecord) => string,
): boolean {
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as LedgerRecord;
    if (Number(record.seq) !== i + 1) return false;
    const before = records[i - 1];
    if (before !== undefined && String(record.prev) !== hashOf(before)) return false;
  }
  return true;
}

/**
 * F100-FR-068 — the effect of a truncated, reordered or edited ledger is that
 * every loop layer is off for the phase attempt, and never a stop.
 */
export const EFFECT_OF_A_BROKEN_LEDGER = "loop-layers-off-for-the-phase-attempt" as const;
export const A_BROKEN_LEDGER_STOPS_THE_RUN = false as const;

/**
 * F100-FR-069 — the counts that limit a run live in the ledger and continue
 * across a resume and a relaunch. `--reset-counts` resets them all and is
 * recorded.
 */
export const CORE_COUNTERS = [
  "rejectCount",
  "phaseAttemptOrdinal",
  "malformedStreak",
  "passIndex",
  "yieldIndex",
  "consecutiveBreakers",
] as const;
export type CoreCounter = (typeof CORE_COUNTERS)[number];

export function resetCounts(): Readonly<Record<CoreCounter, number>> {
  return Object.freeze(
    Object.fromEntries(CORE_COUNTERS.map((c) => [c, 0])) as Record<CoreCounter, number>,
  );
}

/** The oscillation window is keyed by the sequence of phase attempts. */
export const OSCILLATION_WINDOW_KEY = "sequence-of-phase-attempts" as const;
