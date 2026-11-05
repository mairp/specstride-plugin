/**
 * T025 — the `data` schemas of the types of F111-FR-013: quota, pause,
 * fallback and alerts.
 *
 * *Quota, pause, fallback and alerts MUST be defined here and emitted by their
 * owners: `quota.signal` (class, confidence, limit type, utilization,
 * `resetsAt` and its source, the status, the evidence redacted),
 * `harness.error`, `run.paused` and `run.resumed` (a pair, with `pausedMs`),
 * `fallback.switched` and `fallback.restored`, `alert` (kind, level `info`,
 * `warn` or `loud`, role, threshold, value, limit), `budget.exceeded`, and
 * `host.quota_observed` for what a host reports through the inbox. A quota
 * pause MUST add no count to any event that counts a reject, an iteration, a
 * MALFORMED reply, an error or a relaunch.*
 *
 * THE LAST SENTENCE IS A RULE ABOUT TWO MOMENTS, not about one record, so it
 * cannot live in a schema: `quotaPauseAddsNoCount` compares the counters
 * before the pause with the counters after it. A pause is the run waiting for
 * a window to open, and waiting is not failing — a reject counted there would
 * push a phase attempt towards a limit it never earned.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  refine,
  COUNT,
  FLAG,
  NUMBER_OR_NULL,
  TEXT,
  TEXT_OR_NULL,
  type TypeRefinement,
} from "./refinement.ts";

/** The confidences of a quota signal: annex X §X.6 row 47. */
export const QUOTA_CONFIDENCES: readonly string[] = Object.freeze([
  ...(closedSet(47)?.members ?? []),
]);

/** The sources of a reset time: annex X §X.6 row 207. */
export const RESET_SOURCES: readonly string[] = Object.freeze([...(closedSet(207)?.members ?? [])]);

/** The kinds of an alert: annex X §X.6 row 205. */
export const ALERT_KINDS: readonly string[] = Object.freeze([...(closedSet(205)?.members ?? [])]);

/** The levels of an alert: annex X §X.6 row 48. */
export const ALERT_LEVELS: readonly string[] = Object.freeze([...(closedSet(48)?.members ?? [])]);

/** The dimensions of a budget: annex X §X.6 row 206. */
export const BUDGET_DIMENSIONS: readonly string[] = Object.freeze([
  ...(closedSet(206)?.members ?? []),
]);

/** The end cause of a pass that ended because the run entered a quota pause. */
export const QUOTA_PAUSE = "quota_pause" as const;

/** What a quota pause must not add to (F111-FR-013). */
export const COUNTING_EVENTS = [
  "rejects",
  "iterations",
  "malformed",
  "errors",
  "relaunches",
] as const;
export type CountingEvent = (typeof COUNTING_EVENTS)[number];

/** The counters of a run, as the rule of F111-FR-013 reads them. */
export type Counters = Readonly<Partial<Record<CountingEvent, number>>>;

/**
 * The findings of a quota pause: a counter that rose across it. An empty list
 * means the pause added no count (F111-FR-013).
 */
export function quotaPauseAddsNoCount(before: Counters, after: Counters): readonly string[] {
  const findings: string[] = [];
  for (const counter of COUNTING_EVENTS) {
    const was = before[counter] ?? 0;
    const is = after[counter] ?? 0;
    if (is > was) {
      findings.push(
        `a quota pause adds no count: \`${counter}\` rose from ${was} to ${is} across the pause`,
      );
    }
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-013. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-013",
    type: "quota.signal",
    required: [
      "class",
      "confidence",
      "rateLimitType",
      "utilization",
      "resetsAt",
      "resetsAtSource",
      "status",
    ],
    fields: {
      class: TEXT,
      confidence: { enum: QUOTA_CONFIDENCES },
      rateLimitType: TEXT,
      utilization: NUMBER_OR_NULL,
      resetsAt: TEXT_OR_NULL,
      resetsAtSource: { enum: RESET_SOURCES },
      status: TEXT,
    },
    note: "the evidence is a marked free-text field: it is redacted and capped",
  }),
  refine({
    requirement: "F111-FR-013",
    type: "harness.error",
    required: ["class", "retryable"],
    fields: { class: TEXT, retryable: FLAG },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "run.paused",
    required: ["class"],
    fields: { class: TEXT, resetsAt: TEXT_OR_NULL, resumeAt: TEXT_OR_NULL },
    note: "the opener of the pair; `run.resumed` closes it",
  }),
  refine({
    requirement: "F111-FR-013",
    type: "run.resumed",
    required: ["pausedMs"],
    fields: { pausedMs: COUNT },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "fallback.switched",
    required: ["from", "to", "reason"],
    fields: { from: TEXT, to: TEXT },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "fallback.restored",
    required: ["from", "to"],
    fields: { from: TEXT, to: TEXT },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "alert",
    required: ["kind", "level", "role", "threshold", "value", "limit"],
    fields: {
      kind: { enum: ALERT_KINDS },
      level: { enum: ALERT_LEVELS },
      role: TEXT,
      threshold: NUMBER_OR_NULL,
      value: NUMBER_OR_NULL,
      limit: NUMBER_OR_NULL,
    },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "budget.exceeded",
    required: ["dimension", "limit", "used"],
    fields: {
      dimension: { enum: BUDGET_DIMENSIONS },
      limit: NUMBER_OR_NULL,
      used: NUMBER_OR_NULL,
      resumable: FLAG,
    },
  }),
  refine({
    requirement: "F111-FR-013",
    type: "host.quota_observed",
    required: ["kind"],
    fields: { kind: TEXT },
    note: "what a host reports through the inbox",
  }),
]);
