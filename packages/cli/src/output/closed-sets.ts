/**
 * T003 — the closed sets of the spec, as data (F119-FR-030, F119-FR-013,
 * the contract of the front door).
 *
 * Every set here is CLOSED: a host can enumerate it, the front door never
 * invents a member, and every failure reason carries exactly one fixed fix
 * text (F119-FR-030, the data-model rule "every failure reason has exactly one
 * fix text"). Text on the left of a pair is data, never prose from outside
 * the runtime.
 */

/** The closed set of failure reasons (F119-FR-030). */
export const FAILURE_REASONS = [
  "no-state",
  "no-feature",
  "no-log",
  "no-events",
  "no-verdicts",
  "no-verdict-for-phase",
  "no-feedback",
  "no-spec",
  "spec-invalid",
  "usage",
  "unknown-subcommand",
  "internal",
] as const;

/** One member of the closed set of failure reasons. */
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * The one fixed fix text of each reason (F119-FR-030). The map is total over
 * the closed set: a reason without a fix text here is a failure of the build.
 */
export const FIX_TEXTS: Readonly<Record<FailureReason, string>> = Object.freeze({
  "no-state": "run the engine once, or pass --feature to name the run",
  "no-feature": "pass --feature with the slug of the feature",
  "no-log": "run the engine so a log is written, or pass --feature",
  "no-events": "run the engine so events are written, or pass --feature",
  "no-verdicts": "run the engine so a critic verdict is written",
  "no-verdict-for-phase": "pass a phase number that has a verdict, or run the engine",
  "no-feedback": "pass a phase number that has critic feedback, or run the engine",
  "no-spec": "create spec.md for the feature, or pass --feature",
  "spec-invalid": "repair spec.md with the validation errors it reports",
  usage: "call specstride <verb> -h for the usage of the verb",
  "unknown-subcommand": "call specstride with no argument for the list of verbs",
  internal: "an unexpected error: report it with the run snapshot",
});

/** The failure line of the front door (the contract). */
export const ERROR_LABEL = "[SPECSTRIDE-ERROR]" as const;

/** The truncation line of the byte cap (F119-FR-031). */
export const TRUNCATED_LABEL = "[SPECSTRIDE-TRUNCATED]" as const;

/** The data-frame labels (F119-FR-032). */
export const DATA_BEGIN_LABEL = "[SPECSTRIDE-DATA]" as const;
export const DATA_END_LABEL = "[SPECSTRIDE-DATA]" as const;

/** The product-line labels of the inspection verbs (F119-FR-030). */
export const LINE_LABELS = {
  tail: "[SPECSTRIDE-TAIL]",
  events: "[SPECSTRIDE-EVENT]",
  verdicts: "[SPECSTRIDE-VERDICT]",
  feedback: "[SPECSTRIDE-FEEDBACK]",
  phases: "[SPECSTRIDE-PHASES]",
} as const;

/** One label of a product line of an inspection verb. */
export type LineLabel = (typeof LINE_LABELS)[keyof typeof LINE_LABELS];

/** The inspection verbs the front door prints lines for (F119-FR-033). */
export const RECORD_VERBS = ["phases", "feedback", "verdicts", "events", "tail"] as const;

/** The `schema` id of one inspection verb (F119-FR-033). */
export function schemaIdOf(verb: string): string {
  return `specstride.inspect.${verb}/1`;
}

/** True when the value is a member of the closed set of reasons. */
export function isFailureReason(value: string): value is FailureReason {
  return (FAILURE_REASONS as readonly string[]).includes(value);
}

/** The fix text of a reason; `internal` when the reason is not in the set. */
export function fixTextOf(reason: FailureReason): string {
  return FIX_TEXTS[reason];
}
