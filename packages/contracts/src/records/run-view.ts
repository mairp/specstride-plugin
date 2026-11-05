/**
 * T006 of feature 129 — the schema id, the bounds of the collections and the
 * closed sets of the view record `specstride.view/1` (annex G, §G.6;
 * F129-FR-007, F129-FR-035).
 *
 * The schema file is `schemas/run-view.schema.json`, hand-written by feature
 * 129 from `specs/129-run-view-and-status/contracts/run-view.md` and the
 * section "Closed sets" of its `spec.md`, and delivered into this package by
 * `specs/129-run-view-and-status/contracts/deliver.json`. Feature 100's
 * `contracts/schemas/` holds no schema of the view. The generated type is
 * `generated/run-view.ts` (T009 of feature 100); this module gives the
 * validator over it and the data of the two requirements above.
 */
import viewSchema from "../../schemas/run-view.schema.json" with { type: "json" };
import type { RunView } from "./generated/run-view.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { RunView };

/** The schema id the view carries in its field `schema` (F129-FR-007). */
export const SCHEMA_ID = "specstride.view/1" as const;

/** The major this schema supports (F129-FR-007). */
export const MAJOR = 1 as const;

/** The logical name of the cached view (annex B, §B.5); disposable (F129-FR-008). */
export const LOGICAL_NAME = "run:<runId>:view" as const;

/** The section of annex G that owns the interface text. */
export const ANNEX_SECTION = "annex G, §G.6" as const;

/** The schema file as data, so that a test can read its bounds and enums. */
export const VIEW_SCHEMA: Readonly<Record<string, unknown>> = viewSchema as Readonly<
  Record<string, unknown>
>;

/**
 * F129-FR-026 — the fixed bounds the schema records, so that the output of
 * `status --json` has a byte cap by construction. `timelineRows` is the
 * default of the configuration key `status.timelineRows` (feature 110,
 * `contracts/config-keys.tsv` row 246).
 */
export const COLLECTION_BOUNDS = Object.freeze({
  timelineRows: 20,
  attentionItems: 50,
  budgetRows: 64,
  listedProcesses: 50,
  lanes: 8,
});

/** The configuration key that bounds the rows of the timeline (F129-FR-034). */
export const TIMELINE_ROWS_KEY = "status.timelineRows" as const;

/** The size cap of a free-text field of the view, in bytes (F129-FR-009). */
export const TEXT_CAP_BYTES = 240 as const;

/** The size cap of the line of an attention item that `status` prints (F129-FR-025). */
export const ATTENTION_LINE_CAP_BYTES = 120 as const;

/** Lanes of the view: row 243 of annex X §X.6, owner 129. */
export const LANES = [
  "queued",
  "proposing",
  "verifying",
  "reviewing",
  "approved",
  "blocked",
  "paused",
  "failed",
] as const;
export type Lane = (typeof LANES)[number];

/** Kinds of attention item, in the order items are listed: row 244, owner 129. */
export const ATTENTION_KINDS = [
  "blocked-on-human",
  "source-changed",
  "dead-run",
  "launch-abandoned",
  "quota-pause",
  "budget-alert",
  "stale-run",
  "orphan-processes",
  "unknown-state",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Budget levels: row 245, owner 129. */
export const BUDGET_LEVELS = ["unknown", "ok", "info", "warn", "loud", "over"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

/** Liveness values of the view: row 246, owner 129. */
export const LIVENESS_VALUES = ["alive", "dead", "foreign", "unknown", "not-applicable"] as const;
export type Liveness = (typeof LIVENESS_VALUES)[number];

/** Reasons of `stale`: row 247, owner 129. */
export const STALE_REASONS = ["heartbeat-and-events-old", "event-major-out-of-range"] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/** Keys of the status line, in the order of F129-FR-027: row 248, owner 129. */
export const STATUS_LINE_KEYS = [
  "run",
  "st",
  "ph",
  "unit",
  "rej",
  "el",
  "next",
  "strategy",
  "attn",
  "cur",
  "validUntil",
] as const;
export type StatusLineKey = (typeof STATUS_LINE_KEYS)[number];

/** Quota states of a budget row: row 249, owner 129. */
export const QUOTA_STATES = ["ok", "signalled", "paused"] as const;
export type QuotaState = (typeof QUOTA_STATES)[number];

/** Rows of the lane table: row 250, owner 129. */
export const LANE_TABLE_ROWS = [
  "L-01",
  "L-02",
  "L-03",
  "L-04",
  "L-05",
  "L-06",
  "L-07",
  "L-08",
] as const;
export type LaneTableRow = (typeof LANE_TABLE_ROWS)[number];

/** The rows of annex X §X.6 this feature owns, with the set each one closes. */
export const OWNED_CLOSED_SET_ROWS: Readonly<Record<number, string>> = Object.freeze({
  243: "Lanes of the read model",
  244: "Kinds of attention item",
  245: "Budget levels",
  246: "Liveness values of the read model",
  247: "Reasons of `stale`",
  248: "Keys of the status line",
  249: "Quota states of a budget row",
  250: "Rows of the lane table",
});

/**
 * Read the cached view: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * `contracts/run-view.md` is required (F100-FR-048, F100-FR-049,
 * F129-FR-007).
 */
export function readRunView(value: unknown, logicalName: string = LOGICAL_NAME): RunView {
  return readRecord<RunView>(logicalName, value);
}

/** `readRunView` that returns a result instead of throwing. */
export function tryReadRunView(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: RunView } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<RunView>(logicalName, value);
}

/** True when the value validates against `specstride.view/1`. */
export function isRunView(value: unknown): value is RunView {
  return validate<RunView>(SCHEMA_ID, value).ok;
}
