/**
 * T011 — the action per class of §Q.1, and the counting rule of the counter of
 * consecutive errors (F127-FR-004, F127-FR-005).
 *
 * "The engine MUST act on the class only" (F127-FR-004): nothing here reads a
 * harness name, a provider name or a text. `ACTION_BY_CLASS` is §Q.1 as data,
 * one row per class, and `actionFor` is the one function the engine calls.
 *
 * The two bounds of F127-FR-004 live here too, because the class the engine
 * acts on CHANGES at a bound:
 *
 *  - the pass-level wait of `rate_limit_transient` is bounded by
 *    `quota.transientMaxWaitMs`; a wait past that bound is READ AS
 *    `quota_window`, so the run pauses instead of waiting inside the pass;
 *  - the retry of `overload` is bounded by `quota.overloadRetries`; a retry
 *    past that bound is an ORDINARY PROVIDER ERROR, so it counts towards the
 *    consecutive errors and spends what an error spends.
 *
 * F127-FR-005 is the other half: the counter of consecutive errors counts only
 * `agent_failure`, `provider_other` and `overload` AFTER its cap. Everything
 * else a quota class does spends nothing — not a reject, a pass, a MALFORMED
 * count, an error count, the wall-clock budget or the relaunch budget.
 */
import {
  A_QUOTA_CLASS_SPENDS,
  CLASSES,
  CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR,
  CLASS_THAT_COUNTS_AFTER_ITS_CAP,
  type QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";
import { RETRYABLE_BY_CLASS } from "./table.ts";
import type { QuotaClassification } from "./classify.ts";

/* ------------------------------------------------------------------ *
 * §Q.1 as data.
 * ------------------------------------------------------------------ */

/** The action the engine takes, one per row of §Q.1. */
export const QUOTA_ACTIONS = [
  /** Enter the state `paused-quota` for the role; with a fallback opted in, group G3. */
  "pause-role",
  /** A fallback if opted in; else `blocked-on-human` (F127-FR-017). */
  "fallback-or-blocked",
  /** The harness adapter waits and retries INSIDE the pass, up to the bound. */
  "wait-in-pass",
  /** Retry with backoff, up to the bound. */
  "retry-with-backoff",
  /** `blocked-on-human`; no retry and no fallback. */
  "blocked-on-human",
  /** The existing error path of the baseline. */
  "error-path",
  /** The budget path of §Q.3; never a relaunch. */
  "budget-path",
] as const;
export type QuotaAction = (typeof QUOTA_ACTIONS)[number];

/** The column "Counts as" of §Q.1. */
export const COUNTS_AS = ["neither", "error", "error-after-the-cap", "budget-stop"] as const;
export type CountsAs = (typeof COUNTS_AS)[number];

/** The column "Spends reject, pass, MALFORMED, error, wall-clock, relaunch" of §Q.1. */
export const SPENDS = ["no", "yes", "after-the-cap", "cap-counter-only"] as const;
export type Spends = (typeof SPENDS)[number];

/** One row of §Q.1. */
export type ClassAction = {
  readonly quotaClass: QuotaClass;
  readonly action: QuotaAction;
  readonly countsAs: CountsAs;
  readonly spends: Spends;
  /** The constant `retryable` of the class (§Q.1, item W-127-02). */
  readonly retryable: boolean;
  /** The blocked reason of the class, where the action is `blocked-on-human`. */
  readonly blockedReason: string | null;
  /** The bound of §Q.1 that changes the class, where the row names one. */
  readonly bound: "quota.transientMaxWaitMs" | "quota.overloadRetries" | null;
  /** What the class is read as past its bound (F127-FR-004). */
  readonly pastTheBound: QuotaClass | null;
  /** The meaning column of §Q.1, in words. */
  readonly meaning: string;
};

/**
 * §Q.1 — the nine classes, the action on each. The engine acts on the class
 * only (F127-FR-004) and reads this table.
 */
export const ACTION_BY_CLASS: Readonly<Record<QuotaClass, ClassAction>> = Object.freeze({
  quota_window: Object.freeze({
    quotaClass: "quota_window",
    action: "pause-role",
    countsAs: "neither",
    spends: "no",
    retryable: true,
    blockedReason: null,
    bound: null,
    pastTheBound: null,
    meaning: "a limit that a window reset ends (five hours, week, per model family)",
  }),
  quota_credit: Object.freeze({
    quotaClass: "quota_credit",
    action: "fallback-or-blocked",
    countsAs: "neither",
    spends: "no",
    retryable: false,
    blockedReason: "quota-credit",
    bound: null,
    pastTheBound: null,
    meaning: "credit, plan or billing: no clock refills it",
  }),
  rate_limit_transient: Object.freeze({
    quotaClass: "rate_limit_transient",
    action: "wait-in-pass",
    countsAs: "neither",
    spends: "no",
    retryable: true,
    blockedReason: null,
    bound: "quota.transientMaxWaitMs",
    pastTheBound: "quota_window",
    meaning: "a short limit, a delay of seconds",
  }),
  overload: Object.freeze({
    quotaClass: "overload",
    action: "retry-with-backoff",
    countsAs: "error-after-the-cap",
    spends: "after-the-cap",
    retryable: true,
    blockedReason: null,
    bound: "quota.overloadRetries",
    pastTheBound: "provider_other",
    meaning: "the provider is busy (529, 503); not the consumer's limit",
  }),
  auth: Object.freeze({
    quotaClass: "auth",
    action: "blocked-on-human",
    countsAs: "neither",
    spends: "no",
    retryable: false,
    blockedReason: "auth",
    bound: null,
    pastTheBound: null,
    meaning: "the credential is refused or missing",
  }),
  context_window: Object.freeze({
    quotaClass: "context_window",
    action: "error-path",
    countsAs: "error",
    spends: "yes",
    retryable: false,
    blockedReason: null,
    bound: null,
    pastTheBound: null,
    meaning: "the prompt is too large for the model",
  }),
  agent_failure: Object.freeze({
    quotaClass: "agent_failure",
    action: "error-path",
    countsAs: "error",
    spends: "yes",
    retryable: true,
    blockedReason: null,
    bound: null,
    pastTheBound: null,
    meaning: "the harness process failed",
  }),
  provider_other: Object.freeze({
    quotaClass: "provider_other",
    action: "error-path",
    countsAs: "error",
    spends: "yes",
    retryable: true,
    blockedReason: null,
    bound: null,
    pastTheBound: null,
    meaning: "any other provider failure, and the class of an input that matches nothing",
  }),
  budget_cap: Object.freeze({
    quotaClass: "budget_cap",
    action: "budget-path",
    countsAs: "budget-stop",
    spends: "cap-counter-only",
    retryable: false,
    blockedReason: "budget-cap",
    bound: null,
    pastTheBound: null,
    meaning:
      "a cap of this feature was reached, in the pass by the harness's own limit or at a " +
      "boundary by the engine",
  }),
});

/** The nine classes of §Q.1, in the order of the table. */
export const CLASSES_OF_Q1: readonly QuotaClass[] = Object.freeze([...CLASSES]);

/* ------------------------------------------------------------------ *
 * F127-FR-004 — the two bounds of the pass-level retries.
 * ------------------------------------------------------------------ */

/** The two bounds of F127-FR-004, with the defaults of profile row 111. */
export type RetryBounds = {
  /** `quota.transientMaxWaitMs`; 60000 by default (profile row 111). */
  readonly transientMaxWaitMs: number;
  /** `quota.overloadRetries`; 3 by default (profile row 111). */
  readonly overloadRetries: number;
};

/** The defaults of profile row 111 of the spec: 60000 ms and 3 retries. */
export const DEFAULT_RETRY_BOUNDS: RetryBounds = Object.freeze({
  transientMaxWaitMs: 60_000,
  overloadRetries: 3,
});

/** What the pass has already spent on this failure, so a bound can be tested. */
export type RetryState = {
  /** The milliseconds the adapter has already waited inside the pass. */
  readonly waitedMs?: number;
  /** How many times the call has already been retried for `overload`. */
  readonly retries?: number;
};

/** What `actionFor` answers. */
export type ActionDecision = {
  /** The class the engine acts on: the class given, or the one past its bound. */
  readonly quotaClass: QuotaClass;
  /** The class `classify` gave, before any bound was applied. */
  readonly classifiedAs: QuotaClass;
  /** The row of §Q.1 of `quotaClass`. */
  readonly row: ClassAction;
  readonly action: QuotaAction;
  readonly countsAs: CountsAs;
  readonly spends: Spends;
  readonly retryable: boolean;
  readonly blockedReason: string | null;
  /** True where a bound of F127-FR-004 changed the class. */
  readonly boundReached: boolean;
  /** True where this failure adds one to the counter of consecutive errors. */
  readonly countsAsAConsecutiveError: boolean;
  /** What a quota class never spends (F127-FR-005). */
  readonly spendsNothing: boolean;
  /** Why, in one line, for the event and the log. */
  readonly note: string;
};

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The action of §Q.1 for a class, with the two bounds of F127-FR-004 applied
 * (T011).
 *
 * `rate_limit_transient` whose wait has reached `quota.transientMaxWaitMs` is
 * read as `quota_window`: the run pauses. `overload` whose retries have
 * reached `quota.overloadRetries` is an ordinary provider error: it is read as
 * `provider_other`, counts towards the consecutive errors and spends what an
 * error spends.
 */
export function actionFor(
  quotaClass: QuotaClass,
  state: RetryState = {},
  bounds: RetryBounds = DEFAULT_RETRY_BOUNDS,
): ActionDecision {
  const classifiedAs = quotaClass;
  let acted: QuotaClass = quotaClass;
  let boundReached = false;
  let note = ACTION_BY_CLASS[quotaClass].meaning;

  const maxWaitMs = finite(bounds.transientMaxWaitMs, DEFAULT_RETRY_BOUNDS.transientMaxWaitMs);
  const maxRetries = finite(bounds.overloadRetries, DEFAULT_RETRY_BOUNDS.overloadRetries);

  if (quotaClass === "rate_limit_transient" && finite(state.waitedMs, 0) >= maxWaitMs) {
    acted = "quota_window";
    boundReached = true;
    note =
      `the pass-level wait reached quota.transientMaxWaitMs (${maxWaitMs} ms); the failure is ` +
      `read as quota_window and the run pauses (F127-FR-004)`;
  } else if (quotaClass === "overload" && finite(state.retries, 0) >= maxRetries) {
    acted = "provider_other";
    boundReached = true;
    note =
      `the retries reached quota.overloadRetries (${maxRetries}); the failure is an ordinary ` +
      `provider error from here on (F127-FR-004)`;
  }

  const row = ACTION_BY_CLASS[acted];
  const counts = countsAsAConsecutiveError(classifiedAs, boundReached);
  return Object.freeze({
    quotaClass: acted,
    classifiedAs,
    row,
    action: row.action,
    countsAs: row.countsAs,
    spends: row.spends,
    retryable: RETRYABLE_BY_CLASS[acted],
    blockedReason: row.blockedReason,
    boundReached,
    countsAsAConsecutiveError: counts,
    spendsNothing: row.spends === "no",
    note,
  });
}

/** The same, from a classification (F127-FR-004). */
export function actionForClassification(
  classification: QuotaClassification,
  state: RetryState = {},
  bounds: RetryBounds = DEFAULT_RETRY_BOUNDS,
): ActionDecision {
  return actionFor(classification.quotaClass, state, bounds);
}

/* ------------------------------------------------------------------ *
 * F127-FR-005 — the counting rule of the counter of consecutive errors.
 * ------------------------------------------------------------------ */

/**
 * The classes the counter of consecutive errors counts: `agent_failure` and
 * `provider_other` (F127-FR-005; EP-12's
 * `CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR`).
 */
export const CLASSES_THAT_COUNT: readonly QuotaClass[] = CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR;

/** The one class that counts only after its cap: `overload` (F127-FR-005). */
export const CLASS_THAT_COUNTS_AFTER_ITS_CAP_ONLY: QuotaClass = CLASS_THAT_COUNTS_AFTER_ITS_CAP;

/**
 * F127-FR-005 — the counter of consecutive errors counts ONLY failures of the
 * classes `agent_failure` and `provider_other`, and `overload` after its cap.
 *
 * `context_window` is deliberately not among them: §Q.1 puts it on the error
 * path and its column "Counts as" reads "An error", but the counter of
 * CONSECUTIVE errors is the narrower list F127-FR-005 gives, which the
 * contracts package carries as `CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR`.
 */
export function countsAsAConsecutiveError(
  quotaClass: QuotaClass,
  overloadCapSpent = false,
): boolean {
  if (CLASSES_THAT_COUNT.includes(quotaClass)) return true;
  return quotaClass === CLASS_THAT_COUNTS_AFTER_ITS_CAP_ONLY && overloadCapSpent;
}

/**
 * The as-is path a failure takes that is not classified as a quota class
 * (F127-FR-005): the pass loop's result 7 at the error limit, engine exit 4,
 * the stop reason `proposer_consecutive_errors`.
 */
export const AS_IS_ERROR_PATH = Object.freeze({
  passLoopResult: 7,
  exitCode: 4,
  stopReason: "proposer_consecutive_errors",
});

/**
 * F127-FR-005 — what no quota class spends: a reject, a pass, a MALFORMED
 * count, an error count, the wall-clock budget, the relaunch budget. The
 * record is EP-12's `A_QUOTA_CLASS_SPENDS`, all six false.
 */
export const A_QUOTA_CLASS_SPENDS_NOTHING = A_QUOTA_CLASS_SPENDS;

/** The six counts F127-FR-005 names, for a test that asserts each is unchanged. */
export const THE_SIX_COUNTS = Object.freeze([
  "reject",
  "pass",
  "malformedCount",
  "errorCount",
  "wallClockBudget",
  "relaunchBudget",
] as const);

/**
 * The classes that spend none of the six counts: every row of §Q.1 whose
 * column reads "No" (F127-FR-005).
 */
export const CLASSES_THAT_SPEND_NOTHING: readonly QuotaClass[] = Object.freeze(
  CLASSES_OF_Q1.filter((quotaClass) => ACTION_BY_CLASS[quotaClass].spends === "no"),
);

/**
 * Apply one failure to the counter of consecutive errors (F127-FR-005). A
 * class that does not count leaves the counter where it was; a success resets
 * it, as the baseline does.
 */
export function applyToConsecutiveErrors(
  counter: number,
  decision: ActionDecision,
): { readonly counter: number; readonly counted: boolean } {
  return decision.countsAsAConsecutiveError
    ? { counter: counter + 1, counted: true }
    : { counter, counted: false };
}
