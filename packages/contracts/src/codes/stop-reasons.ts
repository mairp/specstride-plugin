/**
 * T080 — the stop-reason enumeration (annex E, §E.3; F100-FR-148).
 *
 * The 15 stop reasons of `data/stop-reasons.json` as a closed set registered
 * through T070: the literal, who writes it, the engine exit code, the
 * attribute `transient`, the rule for `retryable` in the terminal record, and
 * the rule for a value outside the set.
 *
 * Row 3 of `data/closed-sets.json` gives no literals of its own: it refers to
 * this table, and registers through T070 from here (`stopReasonSet`).
 */
import data from "../../data/stop-reasons.json" with { type: "json" };
import {
  defineByReference,
  type SetByReference,
  type UnknownValueOutcome,
} from "../enums/index.ts";

/** The section of annex E that owns this table. */
export const ANNEX_SECTION = "annex E, §E.3" as const;

/** The schema id of the enumeration (annex E, §E.3). */
export const SCHEMA_ID = "specstride.stop-reason/1" as const;

type RawStopReason = {
  number: number;
  literal: string;
  writtenBy: string;
  engineExit: number;
  transient: boolean;
  transientNote: string;
  retryable: string;
  matchedByStringAtBaseline: string;
};

const RAW = (data as { stopReasons: RawStopReason[] }).stopReasons;

/** The 15 literals of §E.3, in the order of the annex. */
export const STOP_REASONS = [
  "stop_flag",
  "wall_budget",
  "proposer_max_iter",
  "proposer_no_progress",
  "proposer_consecutive_errors",
  "proposer_yield_budget",
  "proposer_yield_timeout",
  "proposer_cap_exhausted",
  "proposer_no_evidence",
  "critic_config",
  "critic_unavailable",
  "gate_oscillation",
  "max_rejects",
  "release_verification",
  "paused_quota_ceiling",
] as const;

/** A member of the closed enumeration of stop reasons (annex E, §E.3). */
export type StopReason = (typeof STOP_REASONS)[number];

/** The count the annex pins: 14 literals of the baseline and one new one. */
export const STOP_REASON_COUNT: 15 = STOP_REASONS.length;

/** Row 3 of §X.6 — stop reasons, registered through T070 from here. */
export const stopReasonSet: SetByReference<StopReason> = defineByReference(3, STOP_REASONS);

/** One row of the table of §E.3. */
export type StopReasonRow = {
  /** The number of the row, 1 to 15. */
  readonly number: number;
  /** The literal the terminal record carries. */
  readonly literal: StopReason;
  /** The cell "Written by". */
  readonly writtenBy: string;
  /** The exit code of the engine for this stop. */
  readonly engineExit: number;
  /** Whether a stop with this reason may be relaunched at all. */
  readonly transient: boolean;
  /** The cell "Transient", verbatim. */
  readonly transientNote: string;
  /** The cell "`retryable` in the terminal record", verbatim. */
  readonly retryableRule: string;
  /** The cell "Matched by string at the baseline". */
  readonly matchedByStringAtBaseline: string;
  /** True where the engine writes a line for this reason. */
  readonly writtenByTheEngine: boolean;
  /** True where the pass loop writes a line for this reason. */
  readonly writtenByThePassLoop: boolean;
};

/**
 * The cell "Written by" of §E.3 names the writers. Row 7 reads "Pass loop
 * only. The engine records member 6 for the same stop": the engine writes no
 * line for member 7. Row 3 reads "Engine. The result 4 of the pass loop
 * writes no line of its own": the pass loop writes no line for member 3.
 */
const engineWrites = (cell: string): boolean =>
  /\bengine\b/i.test(cell) && !/^pass loop only\b/i.test(cell.trim());
const passLoopWrites = (cell: string): boolean =>
  /\bpass loop\b/i.test(cell) && !/pass loop writes no line/i.test(cell);

/** Every row of the table, in the order of the annex (F100-FR-148). */
export const stopReasonRows: readonly StopReasonRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      number: row.number,
      literal: row.literal as StopReason,
      writtenBy: row.writtenBy,
      engineExit: row.engineExit,
      transient: row.transient,
      transientNote: row.transientNote,
      retryableRule: row.retryable,
      matchedByStringAtBaseline: row.matchedByStringAtBaseline,
      writtenByTheEngine: engineWrites(row.writtenBy),
      writtenByThePassLoop: passLoopWrites(row.writtenBy),
    }),
  ),
);

const ROW = new Map(stopReasonRows.map((r) => [r.literal, r]));
const ROW_BY_NUMBER = new Map(stopReasonRows.map((r) => [r.number, r]));

/** The row of a stop reason, or `undefined` where the table holds none. */
export function stopReasonRow(literal: string): StopReasonRow | undefined {
  return ROW.get(literal as StopReason);
}

/** The row of a number 1 to 15 of the table of §E.3. */
export function stopReasonOfNumber(number: number): StopReasonRow | undefined {
  return ROW_BY_NUMBER.get(number);
}

/** The exit code of the engine for a stop reason (F100-FR-148). */
export function engineExitOf(literal: string): number | undefined {
  return ROW.get(literal as StopReason)?.engineExit;
}

/** The attribute `transient` of the member (annex E, §E.3). */
export function isTransient(literal: string): boolean {
  return ROW.get(literal as StopReason)?.transient ?? false;
}

/** True when the value is one of the 15 members. */
export function isStopReason(value: string): value is StopReason {
  return (STOP_REASONS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * The rule for `retryable` (annex E, §E.3).
 * ------------------------------------------------------------------ */

/** What the engine knows about one stop when it writes `retryable`. */
export type StopContext = {
  /** The blocked reason, where the stop is blocked on a human (§E.2). */
  readonly blockedReason?: string;
  /** The failure class of the pass, where there is one (annex C §C.13). */
  readonly failureClass?: string;
  /** True where the class `overload` has passed its cap. */
  readonly overloadCapReached?: boolean;
};

/**
 * The failure classes for which `proposer_consecutive_errors` is retryable
 * (annex E, §E.3, row 5).
 */
export const RETRYABLE_FAILURE_CLASSES = ["agent_failure", "provider_other", "overload"] as const;

/**
 * F100-FR-148, annex E §E.3 — the value the engine writes for one stop.
 *
 * It is never true for a member that is not transient. For `wall_budget` it
 * is true, except false when the stop is blocked on a human (`budget-cap`).
 * For `proposer_consecutive_errors` it is true for the classes
 * `agent_failure`, `provider_other` and `overload` after its cap, and false
 * when the stop is blocked on a human (`quota-credit`, `auth`).
 */
export function retryableFor(literal: string, context: StopContext = {}): boolean {
  const row = ROW.get(literal as StopReason);
  if (row === undefined) return false;
  if (!row.transient) return false;
  if (context.blockedReason !== undefined) return false;
  if (row.literal === "wall_budget") return true;
  if (row.literal === "proposer_consecutive_errors") {
    const cls = context.failureClass;
    if (cls === undefined) return false;
    if (cls === "overload") return context.overloadCapReached === true;
    return (RETRYABLE_FAILURE_CLASSES as readonly string[]).includes(cls);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The rule for an exit without a member, and for an unknown value.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-148 — the exits of the engine whose column "Stop reasons" of §E.4
 * holds a member. The terminal record carries one of the 15 on each of them.
 */
export const EXITS_WITH_A_MEMBER: readonly number[] = Object.freeze(
  [...new Set(stopReasonRows.map((r) => r.engineExit))].sort((a, b) => a - b),
);

/**
 * F100-FR-148 — the exits whose column holds none: 0, 5 and 70. On them, and
 * on the causes of 1 and 3 that have no member, the field is null,
 * `retryable` is false, and no as-is stop line is written.
 */
export const EXITS_WITHOUT_A_MEMBER = [0, 5, 70] as const;

/** What the terminal record carries for an exit with no member. */
export type TerminalStopFields = {
  /** The stop reason, or null where the exit has no member. */
  readonly stopReason: StopReason | null;
  /** Never true where the stop reason is null. */
  readonly retryable: boolean;
  /** F100-FR-148 — no as-is stop line is written where there is no member. */
  readonly writeTheAsIsStopLine: boolean;
};

/**
 * F100-FR-148 — the fields for one exit. `literal` is the member the cause
 * carries, or `null` for a cause the annex marks "no member".
 */
export function terminalStopFields(
  exitCode: number,
  literal: string | null = null,
  context: StopContext = {},
): TerminalStopFields {
  if (literal === null || !isStopReason(literal)) {
    return Object.freeze({ stopReason: null, retryable: false, writeTheAsIsStopLine: false });
  }
  void exitCode;
  return Object.freeze({
    stopReason: literal,
    retryable: retryableFor(literal, context),
    writeTheAsIsStopLine: true,
  });
}

/** What a reader does with a stop reason outside the set (row 3 of §X.6). */
export type UnknownStopReason = {
  readonly outcome: UnknownValueOutcome;
  /** Row 3: an unknown value is treated as not retryable. */
  readonly retryable: false;
  /** Row 3: and reported. */
  readonly reported: true;
};

/**
 * F100-FR-148 — a reader that finds a value outside the set treats the stop
 * as not retryable and reports it (row 3 of §X.6).
 */
export function onUnknownStopReason(value: string): UnknownStopReason {
  return Object.freeze({
    outcome: stopReasonSet.onUnknown(value),
    retryable: false as const,
    reported: true as const,
  });
}

/**
 * Annex E §E.3 — what is not a member and is never to be added: a quota
 * pause (a run state), `blocked` (an event), the outcomes of the micro-loop
 * layer and of parallel units, integrity events, and the two extra reasons
 * that Lisa emits.
 */
export const NEVER_MEMBERS = [
  "a quota pause (a run state)",
  "`blocked` (an event)",
  "outcomes of the micro-loop layer and of parallel units",
  "integrity events",
  "the two extra reasons that Lisa emits",
] as const;
