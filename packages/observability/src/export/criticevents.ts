/**
 * T027 — the shipped copy of the critic-class events (F128-FR-007).
 *
 * F128-FR-007: *Events of the critic-class calls (critic, diagnostician,
 * release verification) MUST reach the enabled sinks by the same flow, under
 * the same switches, and telemetry MUST never affect a verdict. The shipped
 * copy of such an event MUST carry the run, the project (as-is: `task`), the
 * feature and the trace id as fields, and the event file MUST NOT gain them
 * from the shipping. The label `backend` of a shipped critic event MUST
 * default to `specstride` and the label `task` MUST default to `specstride`.
 * Shipping MUST use the labels `job`, `task` and `backend` on Loki and the
 * resource attributes `service.name`, `task` and `backend` on OTLP, as
 * F128-FR-021 and F128-FR-012 fix, and MUST drop `event` and `time` from the
 * shipped field set. Any error MUST be swallowed.*
 *
 * The copy is the ONLY place the identity fields are added: the caller hands
 * the envelope it wrote to the primary event file and gets a NEW record back;
 * the original envelope is never mutated, so the event file gains nothing
 * from the shipping (F128-FR-007). Shipping itself is best-effort through and
 * through: `ship` swallows every error, because telemetry never affects a
 * verdict.
 */

/**
 * The critic-class types: the events of the critic-class calls — the critic
 * (the types of F111-FR-011), the diagnostician and the release verification,
 * which ride the same flow under the same switches. Every `critic.*` and
 * `verdict.*` type of the catalogue is critic-class.
 */
export function isCriticClassType(type: string): boolean {
  return type.startsWith("critic.") || type.startsWith("verdict.");
}

/** The identity a shipped copy carries as fields (as-is spellings). */
export type CriticIdentity = {
  /** The run id, shipped as the field `run`. */
  readonly run: string;
  /** The project, shipped under its as-is name `task`. */
  readonly task: string;
  /** The feature, shipped as the field `feature`. */
  readonly feature: string;
  /** The trace id of the run, shipped as the field `traceId`. */
  readonly traceId: string;
};

/** The shipped fields a critic event gains (the as-is spellings). */
export const SHIPPED_IDENTITY_FIELDS: readonly string[] = Object.freeze([
  "run",
  "task",
  "feature",
  "traceId",
]);

/** The fields the shipped copy drops (F128-FR-007). */
export const DROPPED_FIELDS: readonly string[] = Object.freeze(["event", "time"]);

/**
 * The shipped copy of one critic-class event: the same fields with `event`
 * and `time` dropped, plus `run`, `task`, `feature` and `traceId`. The input
 * envelope is not mutated — the copy exists for the sinks only, and the event
 * file gains nothing (F128-FR-007). A non-critic-class event is returned
 * unchanged in a copy without identity fields.
 */
export function shippedCopy(
  data: Readonly<Record<string, unknown>>,
  type: string,
  identity: CriticIdentity,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "event" || key === "time") continue; // dropped from the shipped field set
    copy[key] = value;
  }
  if (isCriticClassType(type)) {
    copy["run"] = identity.run;
    copy["task"] = identity.task;
    copy["feature"] = identity.feature;
    copy["traceId"] = identity.traceId;
  }
  return copy;
}

/**
 * The default labels of a shipped critic event: `backend` and `task` default
 * to `specstride` (F128-FR-007); `job` is the label of F128-FR-021, which
 * defaults to `specstride` as well. An explicit label of the context wins.
 */
export const DEFAULT_LABELS: Readonly<{ job: string; task: string; backend: string }> =
  Object.freeze({ job: "specstride", task: "specstride", backend: "specstride" });

/** The Loki labels of a shipped critic event: `job`, `task`, `backend`. */
export function lokiLabelsFor(
  identity: CriticIdentity,
  contextLabels: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  return {
    job: contextLabels["job"] ?? DEFAULT_LABELS.job,
    task: contextLabels["task"] ?? DEFAULT_LABELS.task,
    backend: contextLabels["backend"] ?? DEFAULT_LABELS.backend,
  };
}

/** The OTLP resource attributes of a shipped critic event. */
export function otelResourceAttributesFor(
  identity: CriticIdentity,
  contextLabels: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  return {
    "service.name": contextLabels["service.name"] ?? DEFAULT_LABELS.job,
    task: contextLabels["task"] ?? DEFAULT_LABELS.task,
    backend: contextLabels["backend"] ?? DEFAULT_LABELS.backend,
  };
}

/** The best-effort send the shipping uses; any error is swallowed. */
export type BestEffortSend = (data: Record<string, unknown>) => Promise<void> | void;

/**
 * Ship one critic-class event to a sink. The copy is built here, the send is
 * awaited, and ANY error — of the copy or of the send — is swallowed:
 * telemetry never affects a verdict (F128-FR-007). The function always
 * resolves, and never rethrows.
 */
export async function ship(
  type: string,
  data: Readonly<Record<string, unknown>>,
  identity: CriticIdentity,
  send: BestEffortSend,
): Promise<void> {
  try {
    if (!isCriticClassType(type)) return;
    await send(shippedCopy(data, type, identity));
  } catch {
    // swallowed: a failing sink never affects the verdict (F128-FR-007)
  }
}
