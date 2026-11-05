/**
 * T254 — the closed sets of the owners 126 to 129 (33 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 126 to 129; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import { defineClosedSet, defineByReference } from "./index.ts";

/**
 * Row 38 — Kinds of normalized stream record.
 *
 * Members: `init`, `text`, `tool`, `usage`, `error`, `terminal`
 * Owner: 126. Closed by: Design.
 * Unknown value: The record is dropped with a diagnostic event
 */
export const kindsOfNormalizedStreamRecord = defineClosedSet(38, [
  "init",
  "text",
  "tool",
  "usage",
  "error",
  "terminal",
] as const);

/**
 * Row 46 — Quota classes.
 *
 * Members: The nine of annex C §C.13
 * Owner: 127. Closed by: Design.
 * Unknown value: `provider_other`
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const quotaClasses = defineByReference(46, [] as const);

/**
 * Row 47 — Quota confidence.
 *
 * Members: `structured`, `status`, `text`, `stall`, `host`
 * Owner: 127. Closed by: Design.
 * Unknown value: `text`
 */
export const quotaConfidence = defineClosedSet(47, [
  "structured",
  "status",
  "text",
  "stall",
  "host",
] as const);

/**
 * Row 48 — Alert levels.
 *
 * Members: `info`, `warn`, `loud`
 * Owner: 127. Closed by: Design.
 * Unknown value: `warn`
 */
export const alertLevels = defineClosedSet(48, ["info", "warn", "loud"] as const);

/**
 * Row 169 — Observability modes of a pass.
 *
 * Members: `structured`, `raw-text`, `degraded`
 * Owner: 126. Closed by: Design.
 * Unknown value: `degraded`
 */
export const observabilityModesOfAPass = defineClosedSet(169, [
  "structured",
  "raw-text",
  "degraded",
] as const);

/**
 * Row 170 — Stream signals.
 *
 * Members: `init`, `text`, `tool`, `evidence`, `result`
 * Owner: 126. Closed by: Design.
 * Unknown value: The registration is refused
 */
export const streamSignals = defineClosedSet(170, [
  "init",
  "text",
  "tool",
  "evidence",
  "result",
] as const);

/**
 * Row 171 — Route reasons of a stream.
 *
 * Members: `structured capture disabled`, `no registered adapter`, `adapter failed to start`; the as-is texts are in the specification of 126
 * Owner: 126. Closed by: Design.
 * Unknown value: Shown as text
 */
export const routeReasonsOfAStream = defineClosedSet(171, [
  "structured capture disabled",
  "no registered adapter",
  "adapter failed to start",
] as const);

/**
 * Row 172 — Diagnostic codes of the stream seam.
 *
 * Members: `adapter_error`, `malformed_json`, `unsupported_schema`, `absent_schema`, `duplicate_terminal`, `line_too_long`, `line_rate_exceeded`, `unknown_record_kind`
 * Owner: 126. Closed by: Design.
 * Unknown value: Shown as text
 */
export const diagnosticCodesOfTheStreamSeam = defineClosedSet(172, [
  "adapter_error",
  "malformed_json",
  "unsupported_schema",
  "absent_schema",
  "duplicate_terminal",
  "line_too_long",
  "line_rate_exceeded",
  "unknown_record_kind",
] as const);

/**
 * Row 173 — Invocation statuses.
 *
 * Members: `success`, `error`, `timeout`, `cancelled`, `degraded`
 * Owner: 126. Closed by: Design.
 * Unknown value: `error`
 */
export const invocationStatuses = defineClosedSet(173, [
  "success",
  "error",
  "timeout",
  "cancelled",
  "degraded",
] as const);

/**
 * Row 174 — Reason codes of an invocation result.
 *
 * Members: `timeout`, `cancelled`, `launch_failed`, `producer_signaled`, `producer_nonzero`, `status_conflict`, `parser_failed`, `unsupported_schema`, `malformed_stream`, `provider_error`, `missing_terminal`, `success`, and any code the provider reports
 * Owner: 126. Closed by: Open by the provider.
 * Unknown value: Shown as text
 */
export const reasonCodesOfAnInvocationResult = defineClosedSet(174, [
  "timeout",
  "cancelled",
  "launch_failed",
  "producer_signaled",
  "producer_nonzero",
  "status_conflict",
  "parser_failed",
  "unsupported_schema",
  "malformed_stream",
  "provider_error",
  "missing_terminal",
  "success",
] as const);

/**
 * Row 175 — Finalization decisions.
 *
 * Members: `cap_halt`, `halt`, `continue`
 * Owner: 126. Closed by: Design.
 * Unknown value: `continue`
 */
export const finalizationDecisions = defineClosedSet(175, [
  "cap_halt",
  "halt",
  "continue",
] as const);

/**
 * Row 176 — Canonical tool names.
 *
 * Members: `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `Glob`, `Grep`, `Task`, `TodoWrite`, `WebFetch`, `WebSearch`
 * Owner: 126. Closed by: Design.
 * Unknown value: The name passes through unchanged
 */
export const canonicalToolNames = defineClosedSet(176, [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "Glob",
  "Grep",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
] as const);

/**
 * Row 177 — Sources of an invocation result.
 *
 * Members: `synthesized`, `reconciled`
 * Owner: 126. Closed by: Design.
 * Unknown value: `reconciled`
 */
export const sourcesOfAnInvocationResult = defineClosedSet(177, [
  "synthesized",
  "reconciled",
] as const);

/**
 * Row 197 — Sink labels of a delivery record.
 *
 * Members: `loki`, `otel`
 * Owner: 128. Closed by: Design.
 * Unknown value: Shown as `unknown`
 */
export const sinkLabelsOfADeliveryRecord = defineClosedSet(197, ["loki", "otel"] as const);

/**
 * Row 198 — Receiver states.
 *
 * Members: `configured`, `reachable`, `request_accepted`, `query_verified`
 * Owner: 128. Closed by: Design.
 * Unknown value: Read as `configured`
 */
export const receiverStates = defineClosedSet(198, [
  "configured",
  "reachable",
  "request_accepted",
  "query_verified",
] as const);

/**
 * Row 199 — Delivery reasons.
 *
 * Members: `http_<status>`, `transport_error`, `queue_overflow`, `content_withheld`
 * Owner: 128. Closed by: Design.
 * Unknown value: Read as `transport_error`
 */
export const deliveryReasons = defineClosedSet(199, [
  "http_<status>",
  "transport_error",
  "queue_overflow",
  "content_withheld",
] as const);

/**
 * Row 200 — OTLP signals.
 *
 * Members: `logs`, `metrics`, `traces`
 * Owner: 128. Closed by: Design.
 * Unknown value: The signal is not sent
 */
export const otlpSignals = defineClosedSet(200, ["logs", "metrics", "traces"] as const);

/**
 * Row 201 — Attribute dialects.
 *
 * Members: `specstride`, `genai`, `openinference`
 * Owner: 128. Closed by: Design.
 * Unknown value: Configuration error
 */
export const attributeDialects = defineClosedSet(201, [
  "specstride",
  "genai",
  "openinference",
] as const);

/**
 * Row 202 — Scopes of a span.
 *
 * Members: `run`, `phase`, `attempt`, `pass`, `verification`, `critic`, `yield`, `long_job`, `check`, `pause`, `blocked`, `stage`, `pipeline`, `diagnosis`, `group`, `worker`
 * Owner: 128. Closed by: Design.
 * Unknown value: The event is a point span
 */
export const scopesOfASpan = defineClosedSet(202, [
  "run",
  "phase",
  "attempt",
  "pass",
  "verification",
  "critic",
  "yield",
  "long_job",
  "check",
  "pause",
  "blocked",
  "stage",
  "pipeline",
  "diagnosis",
  "group",
  "worker",
] as const);

/**
 * Row 203 — Metric names.
 *
 * Members: `specstride.cost.usd`, `specstride.tokens`, `specstride.pass.duration`, `specstride.errors`, `specstride.tool.calls`, `specstride.verdict`, `specstride.attempt.outcome`, `specstride.check.duration`, `specstride.pause.duration`, `specstride.blocked.duration`, `specstride.quota.utilization`, `specstri
 * Owner: 128. Closed by: Design.
 * Unknown value: The metric is not exported
 */
export const metricNames = defineClosedSet(203, [
  "specstride.cost.usd",
  "specstride.tokens",
  "specstride.pass.duration",
  "specstride.errors",
  "specstride.tool.calls",
  "specstride.verdict",
  "specstride.attempt.outcome",
  "specstride.check.duration",
  "specstride.pause.duration",
  "specstride.blocked.duration",
  "specstride.quota.utilization",
  "specstride.run.state",
  "specstride.context.bytes",
  "specstride.context.tokens",
  "specstride.context.limit",
  "ralph.iter.duration_ms",
  "ralph.cost_usd",
  "ralph.tokens",
  "ralph.errors",
  "ralph.tool_use",
  "ralph.gate",
] as const);

/**
 * Row 204 — Forms of a telemetry payload.
 *
 * Members: `as-is`, `new`
 * Owner: 128. Closed by: Design.
 * Unknown value: The new form
 */
export const formsOfATelemetryPayload = defineClosedSet(204, ["as-is", "new"] as const);

/**
 * Row 205 — Alert kinds.
 *
 * Members: `budget-threshold`, `provider-warning`, `billing-mode-change`, `spend-unmeasurable`, `ledger-unreadable`
 * Owner: 127. Closed by: Design.
 * Unknown value: Shown as text at the level `warn`
 */
export const alertKinds = defineClosedSet(205, [
  "budget-threshold",
  "provider-warning",
  "billing-mode-change",
  "spend-unmeasurable",
  "ledger-unreadable",
] as const);

/**
 * Row 206 — Budget dimensions.
 *
 * Members: `tokens`, `costUsd`, `wallClock`, `phaseAttempts`, `calls`
 * Owner: 127. Closed by: Design.
 * Unknown value: Configuration error
 */
export const budgetDimensions = defineClosedSet(206, [
  "tokens",
  "costUsd",
  "wallClock",
  "phaseAttempts",
  "calls",
] as const);

/**
 * Row 207 — Sources of a reset time.
 *
 * Members: `structured`, `header`, `parsed_text`
 * Owner: 127. Closed by: Design.
 * Unknown value: Read as `parsed_text`
 */
export const sourcesOfAResetTime = defineClosedSet(207, [
  "structured",
  "header",
  "parsed_text",
] as const);

/**
 * Row 208 — Reasons that skip a fallback entry.
 *
 * Members: `terms-refused`, `no-cap`, `not-in-plan`, `limited`
 * Owner: 127. Closed by: Design.
 * Unknown value: Shown as text; the entry is skipped
 */
export const reasonsThatSkipAFallbackEntry = defineClosedSet(208, [
  "terms-refused",
  "no-cap",
  "not-in-plan",
  "limited",
] as const);

/**
 * Row 243 — Lanes of the read model.
 *
 * Members: `queued`, `proposing`, `verifying`, `reviewing`, `approved`, `blocked`, `paused`, `failed`
 * Owner: 129. Closed by: Design.
 * Unknown value: Shown as text; the card is not moved
 */
export const lanesOfTheReadModel = defineClosedSet(243, [
  "queued",
  "proposing",
  "verifying",
  "reviewing",
  "approved",
  "blocked",
  "paused",
  "failed",
] as const);

/**
 * Row 244 — Kinds of attention item.
 *
 * Members: `blocked-on-human`, `source-changed`, `dead-run`, `launch-abandoned`, `quota-pause`, `budget-alert`, `stale-run`, `orphan-processes`, `unknown-state`
 * Owner: 129. Closed by: Design.
 * Unknown value: Shown as text with the next command `status --json`
 */
export const kindsOfAttentionItem = defineClosedSet(244, [
  "blocked-on-human",
  "source-changed",
  "dead-run",
  "launch-abandoned",
  "quota-pause",
  "budget-alert",
  "stale-run",
  "orphan-processes",
  "unknown-state",
] as const);

/**
 * Row 245 — Budget levels.
 *
 * Members: `unknown`, `ok`, `info`, `warn`, `loud`, `over`
 * Owner: 129. Closed by: Design.
 * Unknown value: Read as `unknown`
 */
export const budgetLevels = defineClosedSet(245, [
  "unknown",
  "ok",
  "info",
  "warn",
  "loud",
  "over",
] as const);

/**
 * Row 246 — Liveness values of the read model.
 *
 * Members: `alive`, `dead`, `foreign`, `unknown`, `not-applicable`
 * Owner: 129. Closed by: Design.
 * Unknown value: Read as `unknown`
 */
export const livenessValuesOfTheReadModel = defineClosedSet(246, [
  "alive",
  "dead",
  "foreign",
  "unknown",
  "not-applicable",
] as const);

/**
 * Row 247 — Reasons of `stale`.
 *
 * Members: `heartbeat-and-events-old`, `event-major-out-of-range`
 * Owner: 129. Closed by: Design.
 * Unknown value: Shown as text; the view stays `stale`
 */
export const reasonsOfStale = defineClosedSet(247, [
  "heartbeat-and-events-old",
  "event-major-out-of-range",
] as const);

/**
 * Row 248 — Keys of the status line.
 *
 * Members: `run`, `st`, `ph`, `unit`, `rej`, `el`, `next`, `strategy`, `attn`, `cur`, `validUntil`
 * Owner: 129. Closed by: Design.
 * Unknown value: A parser ignores a key it does not know
 */
export const keysOfTheStatusLine = defineClosedSet(248, [
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
] as const);

/**
 * Row 249 — Quota states of a budget row.
 *
 * Members: `ok`, `signalled`, `paused`
 * Owner: 129. Closed by: Design.
 * Unknown value: Read as `ok`
 */
export const quotaStatesOfABudgetRow = defineClosedSet(249, ["ok", "signalled", "paused"] as const);

/**
 * Row 250 — Rows of the lane table.
 *
 * Members: L-01 `approved`, L-02 `failed`, L-03 `blocked`, L-04 `paused`, L-05 `reviewing`, L-06 `verifying`, L-07 `proposing`, L-08 `queued` (default)
 * Owner: 129. Closed by: Design.
 * Unknown value: The default row fires
 */
export const rowsOfTheLaneTable = defineClosedSet(250, [
  "approved",
  "failed",
  "blocked",
  "paused",
  "reviewing",
  "verifying",
  "proposing",
  "queued",
] as const);
