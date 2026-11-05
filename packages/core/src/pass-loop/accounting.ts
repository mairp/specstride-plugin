/**
 * The ACCOUNTING AFTER A PASS of feature 103: the counters, the three breakers
 * and the quota carve-out (F103-FR-012 to F103-FR-018 and F103-FR-020).
 *
 * This module is written in phase 2 for the classic loop. It is pure: it takes
 * the counters as they stand and what one pass ended with, and it gives the
 * counters as they now stand together with the decision. It reads no file,
 * holds no state between calls, and prints nothing — the caller
 * (`./loop.ts`) prints and emits what the decision names. That is what lets
 * the counters survive a resume: they live in the ledger (F103-FR-040), and a
 * module that kept its own copy would make a limit reached across a resume
 * reach it at a different pass.
 *
 * ## The two paths
 *
 * | Path | What decides whether a pass errored | Requirement |
 * |---|---|---|
 * | legacy | the LAST `agent_result` record of the whole event file | F103-FR-012 |
 * | structured | the result of THIS invocation, found by its identity | F103-FR-013 |
 *
 * The legacy path reads the last record of the whole file, which is the
 * baseline's behaviour and its defect: a harness that emits no `agent_result`
 * record makes a CRASHED pass read as clean (defect D-48, preserved), so such
 * a harness can trip the error breaker only through a futility or a hang kill.
 * The structured path never reads the newest file and never reads the last
 * record of a log: it finds the result by run id, feature, role, phase and
 * phase attempt, and REFUSES a result whose scope differs.
 *
 * ## The order of the steps
 *
 * The order is `specs/103-proposer-pass/contracts/accounting-order.json` and
 * it is not a convenience: phase evidence wins before any counter moves
 * (F103-FR-005), a quota class is carved out before any counter moves
 * (F103-FR-020), and the error accounting runs before the no-progress
 * measurement so that an erroring pass is also measured for progress
 * (F103-FR-017). `ACCOUNTING_ORDER` holds the steps this module owns.
 *
 * ## The quota carve-out, and what it does NOT exempt
 *
 * A failure the quota classifier gives a quota class changes NO counter: not
 * the error counter, not the cap counter, not the no-progress counter, and it
 * resets none of them either. The pass number is handed back (F103-FR-020).
 * Only `agent_failure` and `provider_other`, and `overload` AFTER ITS CAP, add
 * to the error counter — `COUNTS_AS_AN_ERROR` is that table, and `overload` is
 * in it conditionally, which is why `countsAsAnError` takes whether the cap of
 * `overload` was reached.
 */
import type { QuotaClass } from "@specstride/contracts/ep/quota-classifier";

/** The requirements this module carries out. */
export const REQUIREMENTS = [
  "F103-FR-012",
  "F103-FR-013",
  "F103-FR-014",
  "F103-FR-015",
  "F103-FR-017",
  "F103-FR-018",
  "F103-FR-020",
] as const;

/** The design file that fixes the order of the steps after a pass. */
export const ORDER_FILE = "specs/103-proposer-pass/contracts/accounting-order.json" as const;

/** The steps of the order after a pass that THIS module owns, in order. */
export const ACCOUNTING_ORDER = [
  "quota class: give the pass number back, change no counter",
  "error accounting, legacy or structured path; cap counter",
  "no-progress measurement and counter",
] as const;

/* ------------------------------------------------------------------ *
 * The kill reasons and their classes (F103-FR-015).
 * ------------------------------------------------------------------ */

/** F103-FR-015 — the classes of a kill. */
export const KILL_CLASSES = ["budget", "hang", "futility", "agent"] as const;
export type KillClass = (typeof KILL_CLASSES)[number];

/** F103-FR-015 — the kill reasons of the baseline and their classes. */
export const CLASS_OF_KILL_REASON: Readonly<Record<string, KillClass>> = Object.freeze({
  hard_cap: "budget",
  idle_timeout: "hang",
  repeat_stall: "futility",
  progress_stall: "futility",
});

/** F103-FR-015 — an UNKNOWN kill reason is futility. */
export const KILL_CLASS_WHEN_UNKNOWN: KillClass = "futility";

/** F103-FR-015 — the class of a kill reason; an unknown reason is futility. */
export function classOfKillReason(reason: string): KillClass {
  return CLASS_OF_KILL_REASON[reason] ?? KILL_CLASS_WHEN_UNKNOWN;
}

/** F103-FR-012 — the kill classes that OVERRIDE the `agent_result` record. */
export const CLASSES_THAT_OVERRIDE_THE_RECORD: readonly KillClass[] = Object.freeze([
  "futility",
  "hang",
]);

/** True when a kill of this class makes the pass an error whatever the record says. */
export function overridesTheRecord(killClass: KillClass): boolean {
  return CLASSES_THAT_OVERRIDE_THE_RECORD.includes(killClass);
}

/** F103-FR-012 — the reason of an erroring pass that was NOT killed. */
export const REASON_WHEN_NOT_KILLED = "agent_error" as const;

/** F103-FR-012 — the kill class of an erroring pass that was NOT killed. */
export const KILL_CLASS_WHEN_NOT_KILLED: KillClass = "agent";

/** F103-FR-012 — the subtype of a pass an override made an error. */
export function watchdogSubtype(killReason: string): string {
  return `watchdog_${killReason}`;
}

/* ------------------------------------------------------------------ *
 * The quota carve-out (F103-FR-020).
 * ------------------------------------------------------------------ */

/**
 * F103-FR-020 — the classes that ADD to the error counter. Every other class
 * is carved out: it changes no counter and resets none. `overload` is in the
 * table only AFTER ITS CAP, which is why it carries a condition.
 */
export const COUNTS_AS_AN_ERROR: Readonly<Record<string, "always" | "after-its-cap">> =
  Object.freeze({
    agent_failure: "always",
    provider_other: "always",
    overload: "after-its-cap",
  });

/**
 * F103-FR-020 — true when a class adds to the error counter. `overload` does
 * so only after its cap was reached; every class outside the table is carved
 * out and changes no counter at all.
 */
export function countsAsAnError(quotaClass: string, overloadCapReached = false): boolean {
  const rule = COUNTS_AS_AN_ERROR[quotaClass];
  if (rule === undefined) return false;
  return rule === "always" || overloadCapReached;
}

/**
 * F103-FR-020 — true when the class is CARVED OUT: no counter changes and
 * none is reset, and the pass number is handed back.
 */
export function isCarvedOut(quotaClass: string, overloadCapReached = false): boolean {
  return !countsAsAnError(quotaClass, overloadCapReached);
}

/**
 * F103-FR-020 — the three classes that lead to `blocked-on-human` through the
 * table of blocked reasons of annex E §E.2. The pause, the resume time and the
 * wait belong to the quota feature; this module only names them.
 */
export const CLASSES_THAT_BLOCK_ON_A_HUMAN: readonly QuotaClass[] = Object.freeze([
  "quota_credit",
  "auth",
  "budget_cap",
]);

/* ------------------------------------------------------------------ *
 * The counters (F103-FR-040; annex B §B.13).
 * ------------------------------------------------------------------ */

/**
 * The counters the pass loop keeps. They live in the ledger and continue
 * across a resume (F103-FR-040); this module takes them and gives them back.
 */
export type Counters = {
  /** Consecutive erroring passes (F103-FR-012, F103-FR-014). */
  readonly errorCount: number;
  /** Consecutive kills of class budget (F103-FR-013, F103-FR-015). */
  readonly capCount: number;
  /** Consecutive passes without progress (F103-FR-017). */
  readonly noProgressCount: number;
};

/** The counters at the start of a phase attempt. */
export const ZERO_COUNTERS: Counters = Object.freeze({
  errorCount: 0,
  capCount: 0,
  noProgressCount: 0,
});

/* ------------------------------------------------------------------ *
 * The limits (F103-FR-014, F103-FR-015, F103-FR-017).
 * ------------------------------------------------------------------ */

/** F103-FR-014 — the default of the error breaker's limit. */
export const MAX_ERRORS_DEFAULT = 2 as const;

/** F103-FR-014 — the configuration key of the error breaker's limit. */
export const MAX_ERRORS_KEY = "roles.proposer.maxErrors" as const;

/** F103-FR-014 — the alias of that key. */
export const MAX_ERRORS_ALIAS = "SPECSTRIDE_PROPOSER_MAX_ERRORS" as const;

/** F103-FR-017 — the default of the no-progress breaker's limit. */
export const MAX_NO_PROGRESS_DEFAULT = 3 as const;

/** F103-FR-017 — the configuration key of the no-progress breaker's limit. */
export const MAX_NO_PROGRESS_KEY = "roles.proposer.maxNoProgress" as const;

/** F103-FR-017 — the alias of that key. */
export const MAX_NO_PROGRESS_ALIAS = "SPECSTRIDE_PROPOSER_MAX_NOPROGRESS" as const;

/** F103-FR-017 — the value of the no-progress limit that DISABLES the breaker. */
export const NO_PROGRESS_LIMIT_OFF = 0 as const;

/**
 * F103-FR-015 — the cap breaker halts only when its limit is ABOVE 0. The
 * default of the limit, the kill itself and its lines belong to the feature
 * that owns the watchdogs; this module holds the rule and not the default.
 */
export const CAP_LIMIT_OFF = 0 as const;

/** The limits the accounting is given. */
export type Limits = {
  /** F103-FR-014 — the error breaker's limit; 2 by default. */
  readonly maxErrors: number;
  /** F103-FR-017 — the no-progress breaker's limit; 3 by default, 0 disables. */
  readonly maxNoProgress: number;
  /** F103-FR-015 — the cap breaker's limit; it halts only above 0. */
  readonly maxCapKills: number;
};

/** The limits with the defaults this feature owns; the cap limit is 118's. */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxErrors: MAX_ERRORS_DEFAULT,
  maxNoProgress: MAX_NO_PROGRESS_DEFAULT,
  maxCapKills: CAP_LIMIT_OFF,
});

/* ------------------------------------------------------------------ *
 * The legacy path (F103-FR-012).
 * ------------------------------------------------------------------ */

/**
 * F103-FR-012 — the last `agent_result` record of the WHOLE event file, as the
 * legacy path reads it. `is_error` counts as an error as a truth value OR as
 * the TEXT `true`, which is the baseline's typing (D-25: events the engine
 * script wrote carry every value as text).
 */
export type AgentResultRecord = {
  readonly is_error?: boolean | string;
  readonly subtype?: string;
};

/** F103-FR-012 — `is_error` true as a truth value or as the text `true`. */
export function isErrorFlagSet(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

/**
 * F103-FR-012 — a harness that emits NO `agent_result` record makes a crashed
 * pass read as CLEAN (defect D-48, preserved). Such a harness can trip the
 * error breaker only through a futility or a hang kill.
 */
export const NO_RECORD_READS_AS_CLEAN = true as const;

/** The defect of the baseline that F103-FR-012 preserves. */
export const PRESERVED_DEFECT = "D-48" as const;

/**
 * F103-FR-012 — a flag of the STREAM SEAM that the terminal record is missing
 * changes NO counter. It is not an error, not a clean pass and not a kill: it
 * is information, and the accounting ignores it.
 */
export const A_MISSING_TERMINAL_RECORD_FLAG_CHANGES_A_COUNTER = false as const;

/* ------------------------------------------------------------------ *
 * The structured path (F103-FR-013).
 * ------------------------------------------------------------------ */

/** F103-FR-013 — the scope by which the structured path finds a result. */
export type BreakerScope = {
  readonly runId: string;
  readonly feature: string;
  readonly role: string;
  readonly phase: number;
  readonly phaseAttempt: number;
};

/** F103-FR-013 — never the newest file, and never the last record of a log. */
export const FOUND_BY_IDENTITY_NOT_BY_RECENCY = true as const;

/** F103-FR-013 — the logical name under which the result of a pass is written once. */
export function resultLogicalName(passId: string): string {
  return `pass:${passId}:result`;
}

/** F103-FR-013 — the decisions the finalisation of the structured path returns. */
export const FINALISATION_DECISIONS = ["cap_halt", "halt"] as const;
export type FinalisationDecision = (typeof FINALISATION_DECISIONS)[number];

/** F103-FR-013 — the result of each decision of the finalisation. */
export const RESULT_OF_DECISION: Readonly<Record<FinalisationDecision, 7 | 10>> = Object.freeze({
  cap_halt: 10,
  halt: 7,
});

/** F103-FR-013 — any value outside the two decisions CONTINUES the loop. */
export function resultOfFinalisation(decision: string): 7 | 10 | undefined {
  return RESULT_OF_DECISION[decision as FinalisationDecision];
}

/** F103-FR-013 — a result whose scope differs from the breaker's is REFUSED. */
export function scopeMatches(scope: BreakerScope, of: Partial<BreakerScope>): boolean {
  return (
    of.runId === scope.runId &&
    of.feature === scope.feature &&
    of.role === scope.role &&
    of.phase === scope.phase &&
    of.phaseAttempt === scope.phaseAttempt
  );
}

/** The error a refused result raises (F103-FR-013). */
export class ResultOutOfScopeError extends Error {
  readonly passId: string;
  constructor(passId: string, scope: BreakerScope, of: Partial<BreakerScope>) {
    super(
      `the result of the invocation \`${passId}\` is out of the scope of the breaker: ` +
        `the breaker is ${JSON.stringify(scope)} and the result names ${JSON.stringify(of)} ` +
        `(F103-FR-013)`,
    );
    this.name = "ResultOutOfScopeError";
    this.passId = passId;
  }
}

/** F103-FR-013 — a second finalisation of one invocation is NOT counted twice. */
export const A_SECOND_FINALISATION_IS_COUNTED = false as const;

/* ------------------------------------------------------------------ *
 * What one pass ended with.
 * ------------------------------------------------------------------ */

/** Which path the accounting takes for a pass (F103-FR-012, F103-FR-013). */
export const PATHS = ["legacy", "structured"] as const;
export type AccountingPath = (typeof PATHS)[number];

/** What one pass ended with, as the accounting is handed it. */
export type PassOutcome = {
  /** The pass number (F103-FR-003). */
  readonly pass: number;
  /** The id of the invocation of the pass (F103-FR-009). */
  readonly passId: string;
  /** Which path the harness of this pass takes. */
  readonly path: AccountingPath;
  /** The kill reason, where a watchdog killed the pass (F103-FR-015). */
  readonly killReason?: string | undefined;
  /** The last `agent_result` record of the event file (the legacy path). */
  readonly agentResult?: AgentResultRecord | undefined;
  /** The decision of the finalisation (the structured path, F103-FR-013). */
  readonly finalisation?: string | undefined;
  /** The class the quota classifier gave a failed pass (F103-FR-020). */
  readonly quotaClass?: string | undefined;
  /** Whether the cap of `overload` was reached (F103-FR-020). */
  readonly overloadCapReached?: boolean | undefined;
  /** F103-FR-016 — whether the pass made progress. */
  readonly madeProgress: boolean;
  /** F103-FR-012 — a flag of the stream seam; it changes no counter. */
  readonly terminalRecordMissing?: boolean | undefined;
  /** F103-FR-013 — true when this invocation was finalised before. */
  readonly finalisedBefore?: boolean | undefined;
  /** F103-FR-018 — a declaration of the proposer, or a question of the harness. */
  readonly declarationSeen?: boolean | undefined;
  /**
   * F103-FR-013 — the scope the RESULT of this invocation names. A result
   * whose run id, feature, role, phase or phase attempt differs from the
   * scope of the breaker is refused with an error.
   */
  readonly scopeOf?: Partial<BreakerScope> | undefined;
};

/* ------------------------------------------------------------------ *
 * The no-progress breaker on the structured path (F103-FR-018).
 * ------------------------------------------------------------------ */

/** F103-FR-018 — the switch of row 59 of annex X §X.7. */
export const NO_PROGRESS_STRUCTURED_KEY = "loop.noProgressStructured" as const;

/** F103-FR-018 — the row of the `parity` profile that holds the switch. */
export const NO_PROGRESS_STRUCTURED_ROW = 59 as const;

/** F103-FR-018 — the default of the switch: ON, so the breaker is evaluated. */
export const NO_PROGRESS_STRUCTURED_DEFAULT = true as const;

/** F103-FR-018 — the value under the `parity` profile: OFF (defect D-44 kept). */
export const NO_PROGRESS_STRUCTURED_UNDER_PARITY = false as const;

/** The defect of the baseline the `parity` profile preserves (F103-FR-018). */
export const PRESERVED_DEFECT_OF_THE_STRUCTURED_PATH = "D-44" as const;

/**
 * F103-FR-018 — whether the no-progress breaker is EVALUATED for a pass. On
 * the legacy path it always is. On the structured path it is evaluated only
 * when the switch is on, which it is everywhere except under `parity`.
 */
export function noProgressIsEvaluated(path: AccountingPath, structuredSwitchOn: boolean): boolean {
  return path === "legacy" || structuredSwitchOn;
}

/**
 * F103-FR-018, warning W-103-01 — the result 8 is marked `declared-block` ONLY
 * when a declaration of the proposer that it needs a human, or a question of
 * the harness, was seen IN THE COUNTED PASSES. Without one the run rests in
 * `failed` and not in `blocked-on-human`.
 */
export const WARNING = "W-103-01" as const;

/** F103-FR-018 — what the engine does with a result 8 that is `declared-block`. */
export const DECLARED_BLOCK = Object.freeze({
  blocked: "declared-block",
  stopReason: "proposer_no_progress",
  engineExit: 4,
  retryable: false,
  state: "blocked-on-human",
  relaunched: false,
});

/** F103-FR-018 — what the engine does with a result 8 that is NOT declared. */
export const NO_PROGRESS_NOT_DECLARED = Object.freeze({
  stopReason: "proposer_no_progress",
  engineExit: 4,
  retryable: false,
  state: "failed",
});

/* ------------------------------------------------------------------ *
 * The lines (compatibility output).
 * ------------------------------------------------------------------ */

/** The logical component prefix of a line of the pass loop. */
export const LOGICAL_PREFIX = "proposer.sh:" as const;

/** F103-FR-014 — the line of each erroring pass. */
export function erroredLine(
  pass: number,
  subtype: string,
  errorCount: number,
  maxErrors: number,
): string {
  return (
    `${LOGICAL_PREFIX} pass ${pass} errored (subtype '${subtype}', is_error) — ` +
    `consecutive errors: ${errorCount}/${maxErrors}`
  );
}

/**
 * F103-FR-014 — the line of the halt. The requirement gives the head of the
 * line verbatim and ABBREVIATES its tail ("or fix the phase harness ..."), so
 * the head is pinned here and the tail stands in `ABORT_TAIL`, which the
 * parity tests of the as-is behaviour pin against the baseline.
 */
export function abortOnErrorsLine(errorCount: number): string {
  return (
    `${LOGICAL_PREFIX} ${errorCount} consecutive agent errors — aborting (exit 7). ` +
    `Raise --timeout or SPECSTRIDE_PROPOSER_MAX_ERRORS, or ${ABORT_TAIL}`
  );
}

/** The tail of the abort line, which the parity tests pin against the baseline. */
export const ABORT_TAIL = "fix the phase harness" as const;

/** F103-FR-017 — the line of each pass without progress. */
export function noProgressLine(pass: number, consec: number, max: number): string {
  return (
    `${LOGICAL_PREFIX} pass ${pass} changed nothing outside .specstride — ` +
    `consecutive no-progress passes: ${consec}/${max}`
  );
}

/**
 * F103-FR-017 — the line of the halt of the no-progress breaker. As with the
 * abort line the requirement abbreviates the tail; the head is pinned here.
 */
export function noProgressHaltLine(consec: number): string {
  return (
    `${LOGICAL_PREFIX} ${consec} consecutive passes wrote nothing — the phase is ` +
    `blocked on something the agent cannot decide for itself (exit 8).`
  );
}

/* ------------------------------------------------------------------ *
 * The decision.
 * ------------------------------------------------------------------ */

/** The breaker that ended the loop, where one did. */
export const BREAKERS = ["errors", "cap", "no-progress"] as const;
export type Breaker = (typeof BREAKERS)[number];

/** The stop line a breaker writes (F103-FR-014, F103-FR-015, F103-FR-017). */
export type StopLine = {
  /** The as-is name of the line: always `run_stop`. */
  readonly line: "run_stop";
  /** The stop reason of annex E §E.3. */
  readonly reason: string;
  /** The as-is fields of the line, in the order the requirement lists them. */
  readonly fields: Readonly<Record<string, string | number>>;
};

/** What the accounting decided about one pass. */
export type Accounting = {
  /** The counters as they now stand. */
  readonly counters: Counters;
  /** F103-FR-020 — true when the pass was carved out and changed no counter. */
  readonly carvedOut: boolean;
  /** The pass number, handed back; a carved-out pass hands back its own. */
  readonly passReached: number;
  /** The result of the loop, where a breaker ended it. */
  readonly exit_code?: 7 | 8 | 10;
  /** Which breaker ended it. */
  readonly breaker?: Breaker;
  /** The stop line the loop writes for its own halt. */
  readonly stopLine?: StopLine;
  /** F103-FR-018 — set on a result 8 that a declaration marks. */
  readonly blocked?: { readonly reason: "declared-block" };
  /**
   * F103-FR-018, warning W-103-01 — whether a declaration of the proposer or a
   * question of the harness was seen in THE COUNTED PASSES: the consecutive
   * passes without progress the breaker is counting right now.
   *
   * It is returned and not kept, for the same reason the counters are: the
   * caller threads it back as `declarationSeenEarlier` on the next pass, and a
   * resume reads it from where the counters are read. It is reset by exactly
   * what resets the no-progress count — a pass that MADE progress — so a
   * declaration in a pass that made progress is not in the streak that fires
   * later. That is the one case a reading of "was a declaration seen anywhere
   * in the run" gets wrong.
   */
  readonly declarationInCountedPasses: boolean;
  /** The lines the caller prints, in order. */
  readonly lines: readonly string[];
  /** The as-is events the caller emits, in order. */
  readonly events: readonly AccountingEvent[];
};

/** An event the accounting asks the caller to emit, by its as-is name. */
export type AccountingEvent = {
  readonly asIsName: "iter_error" | "iter_no_progress";
  readonly fields: Readonly<Record<string, string | number>>;
};

/** What the accounting needs besides the pass and the counters. */
export type AccountingOptions = {
  readonly limits?: Limits;
  /** F103-FR-018 — whether the switch of row 59 is on. */
  readonly noProgressStructured?: boolean;
  /** F103-FR-013 — the scope of the breaker, for the structured path. */
  readonly scope?: BreakerScope;
  /** F103-FR-018 — whether a declaration was seen in an EARLIER counted pass. */
  readonly declarationSeenEarlier?: boolean;
};

/**
 * F103-FR-012 to F103-FR-018 and F103-FR-020 — the accounting of one pass.
 *
 * The steps are those of `ACCOUNTING_ORDER`, and the caller has already
 * settled the two that come before them: phase evidence wins outright
 * (F103-FR-005), and the kill, yield and layer steps of F103-FR-022 ran first.
 */
export function accountForPass(
  counters: Counters,
  outcome: PassOutcome,
  options: AccountingOptions = {},
): Accounting {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const lines: string[] = [];
  const events: AccountingEvent[] = [];
  // W-103-01 — "in the counted passes". A pass that MADE progress resets the
  // streak, and with it the memory of a declaration; otherwise a declaration
  // seen in this pass joins the streak.
  const declarationInCountedPasses = outcome.madeProgress
    ? false
    : (options.declarationSeenEarlier ?? false) || outcome.declarationSeen === true;

  // Step 1 — the quota carve-out. No counter changes and none is reset
  // (F103-FR-020), and the pass number is handed back.
  if (
    outcome.quotaClass !== undefined &&
    isCarvedOut(outcome.quotaClass, outcome.overloadCapReached ?? false)
  ) {
    return Object.freeze({
      counters,
      carvedOut: true,
      passReached: outcome.pass,
      declarationInCountedPasses,
      lines: Object.freeze(lines),
      events: Object.freeze(events),
    });
  }

  // F103-FR-013 — a second finalisation of one invocation is not counted twice.
  if (outcome.finalisedBefore === true) {
    return Object.freeze({
      counters,
      carvedOut: false,
      passReached: outcome.pass,
      declarationInCountedPasses,
      lines: Object.freeze(lines),
      events: Object.freeze(events),
    });
  }

  // F103-FR-013 — a result out of the scope of the breaker is refused.
  if (
    outcome.path === "structured" &&
    options.scope !== undefined &&
    outcome.scopeOf !== undefined
  ) {
    if (!scopeMatches(options.scope, outcome.scopeOf)) {
      throw new ResultOutOfScopeError(outcome.passId, options.scope, outcome.scopeOf);
    }
  }

  // Step 2 — the error accounting and the cap counter.
  const charged = chargeOnePass(counters, outcome);
  let next = charged.counters;

  if (charged.errored) {
    lines.push(erroredLine(outcome.pass, charged.subtype, next.errorCount, limits.maxErrors));
    events.push({
      asIsName: "iter_error",
      fields: Object.freeze({
        iter: outcome.pass,
        subtype: charged.subtype,
        consec: next.errorCount,
        reason: charged.reason,
        kill_class: charged.killClass,
      }),
    });
  }

  // F103-FR-014 — the error breaker, on both paths, with the result 7.
  if (next.errorCount >= limits.maxErrors && limits.maxErrors > 0) {
    lines.push(abortOnErrorsLine(next.errorCount));
    return Object.freeze({
      counters: next,
      carvedOut: false,
      passReached: outcome.pass,
      exit_code: 7 as const,
      breaker: "errors" as const,
      declarationInCountedPasses,
      stopLine: Object.freeze({
        line: "run_stop" as const,
        reason: "proposer_consecutive_errors",
        fields: Object.freeze({
          iter: outcome.pass,
          subtype: charged.subtype,
          kill_reason: outcome.killReason ?? charged.reason,
          kill_class: charged.killClass,
        }),
      }),
      lines: Object.freeze(lines),
      events: Object.freeze(events),
    });
  }

  // F103-FR-015 — the cap breaker, only when its limit is above 0.
  if (limits.maxCapKills > CAP_LIMIT_OFF && next.capCount >= limits.maxCapKills) {
    return Object.freeze({
      counters: next,
      carvedOut: false,
      passReached: outcome.pass,
      exit_code: 10 as const,
      breaker: "cap" as const,
      declarationInCountedPasses,
      stopLine: Object.freeze({
        line: "run_stop" as const,
        reason: "proposer_cap_exhausted",
        fields: Object.freeze({
          iter: outcome.pass,
          kill_reason: outcome.killReason ?? "hard_cap",
          consec: next.capCount,
        }),
      }),
      lines: Object.freeze(lines),
      events: Object.freeze(events),
    });
  }

  // F103-FR-013 — the finalisation of the structured path may halt by itself.
  if (outcome.path === "structured" && outcome.finalisation !== undefined) {
    const byFinalisation = resultOfFinalisation(outcome.finalisation);
    if (byFinalisation !== undefined) {
      return Object.freeze({
        counters: next,
        carvedOut: false,
        passReached: outcome.pass,
        exit_code: byFinalisation,
        breaker: byFinalisation === 10 ? ("cap" as const) : ("errors" as const),
        declarationInCountedPasses,
        stopLine: Object.freeze({
          line: "run_stop" as const,
          reason: byFinalisation === 10 ? "proposer_cap_exhausted" : "proposer_consecutive_errors",
          fields: Object.freeze({
            iter: outcome.pass,
            subtype: charged.subtype,
            kill_reason: outcome.killReason ?? charged.reason,
            kill_class: charged.killClass,
          }),
        }),
        lines: Object.freeze(lines),
        events: Object.freeze(events),
      });
    }
  }

  // Step 3 — the no-progress measurement and counter (F103-FR-017), which
  // measures an erroring pass and a hard-capped pass as well.
  const structuredOn = options.noProgressStructured ?? NO_PROGRESS_STRUCTURED_DEFAULT;
  const evaluated = noProgressIsEvaluated(outcome.path, structuredOn);
  if (evaluated && limits.maxNoProgress > NO_PROGRESS_LIMIT_OFF) {
    if (outcome.madeProgress) {
      next = Object.freeze({ ...next, noProgressCount: 0 });
    } else {
      next = Object.freeze({ ...next, noProgressCount: next.noProgressCount + 1 });
      lines.push(noProgressLine(outcome.pass, next.noProgressCount, limits.maxNoProgress));
      events.push({
        asIsName: "iter_no_progress",
        fields: Object.freeze({ iter: outcome.pass, consec: next.noProgressCount }),
      });
      if (next.noProgressCount >= limits.maxNoProgress) {
        lines.push(noProgressHaltLine(next.noProgressCount));
        const declared = declarationInCountedPasses;
        return Object.freeze({
          counters: next,
          carvedOut: false,
          passReached: outcome.pass,
          exit_code: 8 as const,
          breaker: "no-progress" as const,
          declarationInCountedPasses,
          stopLine: Object.freeze({
            line: "run_stop" as const,
            reason: "proposer_no_progress",
            fields: Object.freeze({ iter: outcome.pass, consec: next.noProgressCount }),
          }),
          ...(declared ? { blocked: Object.freeze({ reason: "declared-block" as const }) } : {}),
          lines: Object.freeze(lines),
          events: Object.freeze(events),
        });
      }
    }
  }

  return Object.freeze({
    counters: next,
    carvedOut: false,
    passReached: outcome.pass,
    declarationInCountedPasses,
    lines: Object.freeze(lines),
    events: Object.freeze(events),
  });
}

/** What charging one pass to one counter settled. */
type Charged = {
  readonly counters: Counters;
  readonly errored: boolean;
  readonly subtype: string;
  readonly reason: string;
  readonly killClass: KillClass;
};

/**
 * F103-FR-012, F103-FR-013 and F103-FR-015 — charge ONE invocation to EXACTLY
 * ONE counter: a kill of class budget to the cap counter, with the error count
 * untouched; anything else to the error counter, which also clears the cap
 * streak. A clean pass resets both.
 */
function chargeOnePass(counters: Counters, outcome: PassOutcome): Charged {
  const killClass =
    outcome.killReason !== undefined ? classOfKillReason(outcome.killReason) : undefined;

  // F103-FR-013 and F103-FR-015 — a kill of class budget goes to the cap
  // counter and to no other, and the error count is untouched.
  if (killClass === "budget") {
    return {
      counters: Object.freeze({ ...counters, capCount: counters.capCount + 1 }),
      errored: false,
      subtype: watchdogSubtype(outcome.killReason as string),
      reason: outcome.killReason as string,
      killClass,
    };
  }

  // F103-FR-012 — a kill of class futility or hang OVERRIDES the record.
  if (killClass !== undefined && overridesTheRecord(killClass)) {
    return {
      counters: Object.freeze({
        ...counters,
        errorCount: counters.errorCount + 1,
        capCount: 0,
      }),
      errored: true,
      subtype: watchdogSubtype(outcome.killReason as string),
      reason: outcome.killReason as string,
      killClass,
    };
  }

  // F103-FR-012 — the last `agent_result` record of the whole event file.
  // No such record, and `is_error` false, both count as CLEAN.
  const errored = isErrorFlagSet(outcome.agentResult?.is_error);
  if (!errored) {
    return {
      counters: Object.freeze({ ...counters, errorCount: 0, capCount: 0 }),
      errored: false,
      subtype: outcome.agentResult?.subtype ?? "",
      reason: "",
      killClass: KILL_CLASS_WHEN_NOT_KILLED,
    };
  }
  return {
    counters: Object.freeze({ ...counters, errorCount: counters.errorCount + 1, capCount: 0 }),
    errored: true,
    subtype: outcome.agentResult?.subtype ?? REASON_WHEN_NOT_KILLED,
    reason: REASON_WHEN_NOT_KILLED,
    killClass: KILL_CLASS_WHEN_NOT_KILLED,
  };
}
