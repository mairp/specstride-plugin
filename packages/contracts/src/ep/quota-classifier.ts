/**
 * T121 — the interface types of EP-12, the quota classifier, from
 * `contracts/extension-points/EP-12.quota-classifier.json` and annex C, §C.13
 * (F100-FR-109).
 *
 * `specstride.quota-classifier/1`. It tells a limit of a provider apart from
 * every other failure, so that a run waits instead of counting an error.
 */
export const POINT_ID = "specstride.quota-classifier/1" as const;
export const EP = "EP-12" as const;
export const ANNEX_SECTION = "annex C, §C.13" as const;

/** F100-FR-109 — the two operations of the point. */
export const OPERATIONS = ["classify", "observe"] as const;
export type QuotaClassifierOperation = (typeof OPERATIONS)[number];

/** F100-FR-109 — the closed set of classes. */
export const CLASSES = [
  "quota_window",
  "quota_credit",
  "rate_limit_transient",
  "overload",
  "auth",
  "context_window",
  "agent_failure",
  "provider_other",
  "budget_cap",
] as const;
export type QuotaClass = (typeof CLASSES)[number];

/** F100-FR-109 — the closed set of confidences. */
export const CONFIDENCES = ["structured", "status", "text", "stall", "host"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Unknown-value rule of §C.13: an unknown class is read as `provider_other`. */
export const CLASS_WHEN_UNKNOWN: QuotaClass = "provider_other";
/** Unknown-value rule of §C.13: an unknown confidence is read as `text`. */
export const CONFIDENCE_WHEN_UNKNOWN: Confidence = "text";

/** "Errors" of §C.13: an input that matches no entry. */
export const NO_ENTRY_MATCHES: Classification = Object.freeze({
  quotaClass: "provider_other",
  confidence: "text",
  resetsAt: null,
  retryable: true,
});

/** The output of `classify` (§C.13, Outputs). */
export type Classification = {
  readonly quotaClass: QuotaClass;
  readonly confidence: Confidence;
  /** When the limit resets, or null. */
  readonly resetsAt: string | null;
  readonly retryable: boolean;
};

/** What `classify` is handed: what the harness adapter saw. */
export type ClassifyInput = {
  readonly streamRecord?: unknown;
  readonly status?: { readonly code: number; readonly headers: Readonly<Record<string, string>> };
  readonly exitCode?: number;
  readonly errorText?: string;
};

/** What `observe` is handed: a gauge, or a fact a host observed (from the inbox). */
export type Observation =
  | { readonly kind: "gauge"; readonly remaining: number; readonly of: string }
  | { readonly kind: "host-fact"; readonly fact: string };

/** The alert levels `observe` may return, or nothing. */
export const ALERT_LEVELS = ["info", "warn", "critical"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** F100-FR-109 — the quota classifier: a pure table or pure code. */
export type QuotaClassifier = {
  classify(seen: ClassifyInput): Classification;
  observe(observation: Observation): AlertLevel | undefined;
};

/** "Guarantees of an implementation" of §C.13: no I/O, no clock, no model. */
export const IS_PURE = true as const;

/** "Guarantees of the core" of §C.13: what a quota class never spends. */
export const A_QUOTA_CLASS_SPENDS = Object.freeze({
  pass: false,
  reject: false,
  malformedCount: false,
  errorCount: false,
  wallClockBudget: false,
  relaunchBudget: false,
});

/** Confidences that pause only after a confirming probe (§C.13). */
export const CONFIDENCES_THAT_NEED_A_PROBE: readonly Confidence[] = Object.freeze([
  "text",
  "stall",
  "host",
]);

/** Classes that lead to the state `blocked-on-human` (§C.13). */
export const CLASSES_THAT_BLOCK_ON_A_HUMAN: readonly QuotaClass[] = Object.freeze([
  "quota_credit",
  "auth",
  "budget_cap",
]);

/**
 * F100-FR-109 — `proposer_consecutive_errors` counts only failures whose
 * class is `agent_failure` or `provider_other`, or `overload` after its cap.
 */
export const CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR: readonly QuotaClass[] = Object.freeze([
  "agent_failure",
  "provider_other",
]);
export const CLASS_THAT_COUNTS_AFTER_ITS_CAP: QuotaClass = "overload";

export function countsAsAConsecutiveError(
  quotaClass: QuotaClass,
  overloadCapSpent = false,
): boolean {
  if (CLASSES_THAT_COUNT_AS_A_CONSECUTIVE_ERROR.includes(quotaClass)) return true;
  return quotaClass === CLASS_THAT_COUNTS_AFTER_ITS_CAP && overloadCapSpent;
}

/** "Failure of an implementation" of §C.13, as data. */
export const FAILURE_PATH =
  "a classifier that fails gives `provider_other`; the failure takes the as-is path of consecutive errors" as const;
export const FAILURE_PATHS: Readonly<Record<QuotaClassifierOperation, string>> = Object.freeze({
  classify: FAILURE_PATH,
  observe: FAILURE_PATH,
});
