/**
 * T042 — the Loki stream labels (F128-FR-021).
 *
 * F128-FR-021: *Loki stream labels MUST be low in cardinality: in the as-is
 * form `job` `ralph`, `task`, `backend` and `event`, plus the label `model` on
 * the events shipped as `api_request` and `tool_use` only, and plus the label
 * `role`, and nothing else, on an event that comes from the stream tap. In the
 * new form the labels MUST be `job` `specstride`, `feature`, `harness`,
 * `event` (the event type) and `role`, with `model` on usage and tool events.
 * Every other value MUST stay in the logfmt line, and `run_id`,
 * `invocation_id`, `sequence`, cost and tokens MUST never be labels.*
 *
 * The labels are BUILT here and nowhere else: the sink assembles its streams
 * from this function, so a value that must stay in the line can never leak
 * into a label. The names of the as-is form are those of the baseline shipper
 * (`ralph_loki_ship.py`: `job=ralph`, `task`, `backend`, `event`, and `model`
 * on exactly the two stream metric events).
 */

/** The `job` label of the as-is form (the baseline's value). */
export const ASIS_JOB = "ralph" as const;
/** The `job` label of the new form. */
export const NEW_JOB = "specstride" as const;

/** The default of the `task` and `backend` labels when the run gives none. */
export const DEFAULT_LABEL = "specstride" as const;

/** The as-is event names that carry the `model` label, and only they. */
export const MODEL_LABEL_EVENTS_ASIS: readonly string[] = Object.freeze([
  "api_request",
  "tool_use",
]);

/** The new-form event types that carry the `model` label (usage and tool). */
export const MODEL_LABEL_EVENTS_NEW: readonly string[] = Object.freeze([
  "stream.result",
  "tool.call",
]);

/**
 * The values that MUST NEVER be labels (F128-FR-021): identity, sequence,
 * cost and tokens stay in the logfmt line. `labels.ts` refuses them.
 */
export const NEVER_A_LABEL: readonly string[] = Object.freeze([
  "run_id",
  "invocation_id",
  "sequence",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "duration_ms",
  "result_preview",
]);

/** The input of `streamLabelsFor`: everything the label set may depend on. */
export type LokiLabelInput = {
  /** The form in force (F128-FR-009): `as-is` or `new`. */
  readonly form: "as-is" | "new";
  /** The event name the event ships under, of the form in force. */
  readonly eventName: string;
  /** The as-is label `task` (the project of the baseline). */
  readonly task?: string;
  /** The as-is label `backend`. */
  readonly backend?: string;
  /** The new-form label `feature`. */
  readonly feature?: string;
  /** The new-form label `harness`. */
  readonly harness?: string;
  /** The label `role`, on an event that comes from the stream tap. */
  readonly role?: string;
  /** The label `model`, on the usage and tool events of each form. */
  readonly model?: string;
  /** Whether the event comes from the stream tap (adds `role` in the as-is form). */
  readonly fromStreamTap?: boolean;
};

/**
 * The label set of one Loki stream. The keys are exactly those of
 * F128-FR-021 for the form in force, and nothing else: a value that is not a
 * label of the requirement is not accepted here.
 */
export function streamLabelsFor(input: LokiLabelInput): Record<string, string> {
  const labels: Record<string, string> = {};
  if (input.form === "as-is") {
    labels["job"] = ASIS_JOB;
    labels["task"] = input.task ?? DEFAULT_LABEL;
    labels["backend"] = input.backend ?? DEFAULT_LABEL;
    labels["event"] = input.eventName;
    if (input.model !== undefined && MODEL_LABEL_EVENTS_ASIS.includes(input.eventName)) {
      labels["model"] = input.model;
    }
    if (input.fromStreamTap === true && input.role !== undefined) {
      labels["role"] = input.role;
    }
    return labels;
  }
  labels["job"] = NEW_JOB;
  labels["feature"] = input.feature ?? DEFAULT_LABEL;
  labels["harness"] = input.harness ?? DEFAULT_LABEL;
  labels["event"] = input.eventName;
  labels["role"] = input.role ?? DEFAULT_LABEL;
  if (input.model !== undefined && MODEL_LABEL_EVENTS_NEW.includes(input.eventName)) {
    labels["model"] = input.model;
  }
  return labels;
}

/**
 * The guard the sink applies before it lifts anything to a label: a key of
 * `NEVER_A_LABEL` is refused and stays in the line.
 */
export function mayBeALabel(key: string): boolean {
  return !NEVER_A_LABEL.includes(key);
}
