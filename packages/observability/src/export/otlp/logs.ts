/**
 * T048 — the OTLP log records, the resource and the scope (F128-FR-011,
 * F128-FR-012).
 *
 * F128-FR-011: *... Every event MUST become one log record: `timeUnixNano`,
 * `observedTimeUnixNano`, `severityNumber` 9, `severityText` `INFO`, a body
 * that is the logfmt line of F128-FR-022, attributes that are the event name
 * and every non-null field, and `traceId` and `spanId` when spans are active.
 * An attribute MUST be typed: a boolean as a boolean value, a whole number as
 * an integer value written as text, a fractional number as a double value,
 * everything else as a string value. In the as-is form the time MUST be the
 * clock of the exporter; in the new form it MUST be the `ts` of the event.*
 *
 * F128-FR-012: *The instrumentation scope of logs and metrics MUST be
 * `specstride.ralph` in the as-is form and `specstride.export` in the new
 * form. The resource attributes of logs and metrics MUST be `service.name`,
 * `task` and `backend` in the as-is form, with `service.name` `ralph`, and
 * `service.name`, `project` and `harness` in the new form, with
 * `service.name` `specstride`. The resource attributes of traces MUST keep
 * the others and MUST set `service.name` to `specstride` in both forms. The
 * instrumentation scope of traces MUST be `specstride.trace` and every span
 * MUST have the kind INTERNAL.*
 */

/** The severity of every log record (F128-FR-011). */
export const SEVERITY_NUMBER = 9 as const;
/** The severity text of every log record. */
export const SEVERITY_TEXT = "INFO" as const;

/** The instrumentation scope of logs and metrics, per form (F128-FR-012). */
export function scopeNameOf(form: "as-is" | "new"): string {
  return form === "as-is" ? "specstride.ralph" : "specstride.export";
}

/** The instrumentation scope of traces, in both forms. */
export const TRACE_SCOPE_NAME = "specstride.trace" as const;

/** The kind of every span: INTERNAL (1). */
export const SPAN_KIND_INTERNAL = 1 as const;

/**
 * The resource attributes of logs and metrics, per form (F128-FR-012).
 * Traces keep these and set `service.name` to `specstride` in both forms
 * (`traceResourceAttributesOf`).
 */
export function resourceAttributesOf(
  form: "as-is" | "new",
  labels: { task?: string; backend?: string; project?: string; harness?: string } = {},
): Record<string, string> {
  if (form === "as-is") {
    return {
      "service.name": "ralph",
      task: labels.task ?? "specstride",
      backend: labels.backend ?? "specstride",
    };
  }
  return {
    "service.name": "specstride",
    project: labels.project ?? "specstride",
    harness: labels.harness ?? "specstride",
  };
}

/** The resource attributes of traces: the others, with `service.name` `specstride`. */
export function traceResourceAttributesOf(
  form: "as-is" | "new",
  labels: { task?: string; backend?: string; project?: string; harness?: string } = {},
): Record<string, string> {
  return {
    ...resourceAttributesOf(form, labels),
    "service.name": "specstride",
  };
}

/** The OTLP typed value of one attribute (F128-FR-011). */
export function typedAttributeValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

/** The typed `attributes` array of one log record, nulls dropped. */
export function attributesKv(
  record: Record<string, unknown>,
): { key: string; value: Record<string, unknown> }[] {
  const out: { key: string; value: Record<string, unknown> }[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    out.push({ key, value: typedAttributeValue(value) });
  }
  return out;
}

/** The input of `logRecordOf`. */
export type LogRecordInput = {
  /** The event time: the clock of the exporter (as-is) or the `ts` (new). */
  readonly timeNanos: string;
  /** The observed time: the clock of the exporter, in nanoseconds. */
  readonly observedTimeNanos: string;
  /** The logfmt line — the same string the Loki entry carries (F128-FR-022). */
  readonly line: string;
  /** The event name and every non-null field. */
  readonly attrs: Record<string, unknown>;
  /** The trace and span ids, when spans are active (F128-FR-011). */
  readonly traceId?: string;
  readonly spanId?: string;
};

/** One log record of the `/v1/logs` body (F128-FR-011). */
export function logRecordOf(input: LogRecordInput): Record<string, unknown> {
  return {
    timeUnixNano: input.timeNanos,
    observedTimeUnixNano: input.observedTimeNanos,
    severityNumber: SEVERITY_NUMBER,
    severityText: SEVERITY_TEXT,
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
    body: { stringValue: input.line },
    attributes: attributesKv(input.attrs),
  };
}

/** The input of `buildLogsRequest`. */
export type LogsRequestInput = {
  readonly form: "as-is" | "new";
  readonly entries: readonly LogRecordInput[];
  readonly labels?: { task?: string; backend?: string; project?: string; harness?: string };
};

/** The `/v1/logs` request body over buffered entries (resource → scope → records). */
export function buildLogsRequest(input: LogsRequestInput): string {
  return JSON.stringify({
    resourceLogs: [
      {
        resource: { attributes: attributesKv(resourceAttributesOf(input.form, input.labels)) },
        scopeLogs: [
          {
            scope: { name: scopeNameOf(input.form) },
            logRecords: input.entries.map(logRecordOf),
          },
        ],
      },
    ],
  });
}
