/**
 * T269 — the type and the validator of the Run record (annex E, §E.2;
 * F100-FR-143, F100-FR-146, F100-FR-147).
 *
 * A slice of T078. Schema id `specstride.run-state/1`, logical name
 * `run:<runId>:record`. The type is generated from
 * `schemas/run-record.schema.json` (T009); this module gives the validator
 * over the lazy compile of T028, the fields the requirement names — the
 * containment level, the result of the critic proof, the version of the
 * redaction pattern set, `productVersions` as one list — the one writer, and
 * the rules of the quota pause and of the lease check as data.
 */
import type { RunRecord } from "./generated/run-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";
import { appendProductVersion, productVersionDifference } from "./rules.ts";
import { RUN_STATES, type RunState } from "../state/run-state.ts";

export type { RunRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.run-state/1" as const;

/** The logical name of the record (annex B, §B.5; annex E, §E.2). */
export const LOGICAL_NAME = "run:<runId>:record" as const;

/** The section of annex E that owns the field list. */
export const ANNEX_SECTION = "annex E, §E.2" as const;

/**
 * F100-FR-143 — the record has one writer: the runtime root, and the engine
 * in start mode `standalone`.
 */
export const WRITER = "Runtime root; the engine in start mode `standalone`" as const;
export const WRITERS_COUNT = 1 as const;

/** Annex E §E.2 — the readers of the record. */
export const READERS = "All" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §E.2 is
 * required (F100-FR-048, F100-FR-049, F100-FR-143).
 */
export function readRunRecord(value: unknown, logicalName: string = LOGICAL_NAME): RunRecord {
  return readRecord<RunRecord>(logicalName, value);
}

/** `readRunRecord` that returns a result instead of throwing. */
export function tryReadRunRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: RunRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<RunRecord>(logicalName, value);
}

/** True when the value validates against `specstride.run-state/1`. */
export function isRunRecord(value: unknown): value is RunRecord {
  return validate<RunRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-143 — the fields the requirement names by hand, beside the whole
 * field list of §E.2: the containment level in force per role with
 * `protection`, the result of the proof that the critic holds no tools or
 * only read-only tools, and the version of the pattern set of the redactor.
 */
export const FIELDS_THE_REQUIREMENT_NAMES = ["containment", "criticProof", "redaction"] as const;

/**
 * F100-FR-143 — `state` is a state of the machine and never a derived
 * condition (F100-FR-141).
 */
export function stateIsWritable(state: string): state is RunState {
  return (RUN_STATES as readonly string[]).includes(state);
}

/**
 * F100-FR-050, F100-FR-143 — `productVersions` is one list: the version that
 * started the run, then the version of every later engine start. The rule
 * itself is T246; this is the field of the run record it governs.
 */
export const PRODUCT_VERSIONS_FIELD = "productVersions" as const;
export const PRODUCT_VERSIONS_IS_ONE_LIST = true as const;
export { appendProductVersion, productVersionDifference };

/**
 * The version of the engine start with the ordinal `k` (1-based): entry `k`
 * of `productVersions`. Entry 1 is the version that started the run.
 */
export function productVersionOfEngineStart(record: RunRecord, k: number): string | undefined {
  const list = record.productVersions;
  if (!Array.isArray(list)) return undefined;
  return list[k - 1] as string | undefined;
}

/* ------------------------------------------------------------------ *
 * F100-FR-146 — the rules of the quota pause.
 * ------------------------------------------------------------------ */

/** The state of a quota pause (annex E, §E.2). */
export const QUOTA_PAUSE_STATE = "paused-quota" as const;

/**
 * F100-FR-146 — a quota pause spends no reject, no pass, no MALFORMED count,
 * no error count, no wall-clock budget and no relaunch budget. Every counter
 * the pause may not spend, with the amount it spends: zero.
 */
export const QUOTA_PAUSE_SPENDS = Object.freeze({
  rejects: 0,
  passes: 0,
  malformedCount: 0,
  errorCount: 0,
  wallClockBudget: 0,
  relaunchBudget: 0,
});

/** The counters a quota pause spends nothing of (F100-FR-146). */
export const COUNTERS_A_QUOTA_PAUSE_NEVER_SPENDS: readonly string[] = Object.freeze(
  Object.keys(QUOTA_PAUSE_SPENDS),
);

/** F100-FR-146 — a quota pause spends nothing of any counter. */
export function quotaPauseSpends(counter: string): number {
  return (QUOTA_PAUSE_SPENDS as Readonly<Record<string, number>>)[counter] ?? 0;
}

/** F100-FR-146 — the pause holds while the runtime lives. */
export const PAUSE_HOLDS_WHILE_THE_RUNTIME_LIVES = true as const;

/**
 * F100-FR-146 — the ceiling of the wait, which the consumer can set. Row 39
 * of the parity profile (annex X §X.7) holds the key; the default is 24
 * hours.
 */
export const PAUSE_MAX_TOTAL_MS_KEY = "pause.maxTotalMs" as const;

/** 24 hours in milliseconds: the default of `pause.maxTotalMs`. */
export const PAUSE_MAX_TOTAL_MS_DEFAULT = 86_400_000 as const;

/** 24 hours, as the annex words it. */
export const PAUSE_MAX_TOTAL_DEFAULT_HOURS = 24 as const;

/**
 * F100-FR-146 — at the ceiling the run rests in `blocked-on-human` with the
 * stop reason `paused_quota_ceiling`, and the blocked reason of §E.2 is
 * `quota-wait-ceiling`.
 */
export const AT_THE_CEILING = {
  state: "blocked-on-human",
  stopReason: "paused_quota_ceiling",
  blockedReason: "quota-wait-ceiling",
  engineExit: 4,
  retryable: false,
} as const;

/** What a run does after `pause.maxTotalMs` of waiting (F100-FR-146). */
export function atTheCeiling(
  waitedMs: number,
  maxTotalMs: number = PAUSE_MAX_TOTAL_MS_DEFAULT,
): typeof AT_THE_CEILING | undefined {
  return waitedMs >= maxTotalMs ? AT_THE_CEILING : undefined;
}

/**
 * F100-FR-146, F100-FR-073 — the pause record is present exactly while the
 * run is paused, and never otherwise.
 */
export function pauseRecordIsPresent(state: string): boolean {
  return state === QUOTA_PAUSE_STATE;
}

/**
 * F100-FR-146 — after a reboot nothing relaunches by itself; `resume` enters
 * the pause again.
 */
export const AFTER_A_REBOOT = {
  relaunchesByItself: false,
  resumeEntersThePauseAgain: true,
} as const;

/* ------------------------------------------------------------------ *
 * F100-FR-147 — the lease check.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-147 — the engine verifies the lease at every boundary at which it
 * reads the stop request.
 */
export const LEASE_IS_VERIFIED_AT_EVERY_BOUNDARY_THAT_READS_THE_STOP_REQUEST = true as const;

/** What the engine does when the owner of the lease is lost (F100-FR-147). */
export type OwnerLostOutcome = {
  /** It finishes the current pass. */
  readonly finishesTheCurrentPass: true;
  /** It runs no phase gate. */
  readonly runsThePhaseGate: false;
  /** The `cause` of the terminal record. */
  readonly cause: "owner-lost";
  /** The stop reason of the terminal record. */
  readonly stopReason: "stop_flag";
  /** The `causedBy` of the terminal record. */
  readonly causedBy: "crash";
  /** The exit code of the engine. */
  readonly exitCode: 6;
  /** `retryable` is false: `stop_flag` is not transient (§E.3, row 1). */
  readonly retryable: false;
};

/**
 * F100-FR-147 — when the owner of the lease is lost: finish the current pass,
 * run no phase gate, write the terminal record with the cause `owner-lost`,
 * the stop reason `stop_flag` and `causedBy: crash`, and exit 6.
 */
export const OWNER_LOST: OwnerLostOutcome = Object.freeze({
  finishesTheCurrentPass: true,
  runsThePhaseGate: false,
  cause: "owner-lost",
  stopReason: "stop_flag",
  causedBy: "crash",
  exitCode: 6,
  retryable: false,
});

/**
 * F100-FR-147 — the outcome of the lease check at one boundary: `undefined`
 * while the owner lives, and the terminal outcome when it is lost.
 */
export function leaseCheck(ownerIsLive: boolean): OwnerLostOutcome | undefined {
  return ownerIsLive ? undefined : OWNER_LOST;
}
