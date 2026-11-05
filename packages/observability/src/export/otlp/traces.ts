/**
 * T055 — the traces request (F128-FR-019; C-190; B-2364; B-2365; B-2375).
 *
 * F128-FR-019: *A traces request MUST have the shape
 * `resourceSpans[0].resource.attributes`, `scopeSpans[0].scope.name` and
 * `spans[]` with `traceId`, `spanId`, `parentSpanId`, `name`, `kind`,
 * `startTimeUnixNano`, `endTimeUnixNano`, `attributes` and, on error, a
 * `status` of code 2 with `message`. (The dotted form of the status field is
 * written unquoted here on purpose: it is a field of the OTLP payload, not a
 * configuration key, and `status` is a namespace of the configuration schema —
 * see the static test CT-110-109 of `packages/config`.) The start time MUST
 * come from the `ts` of
 * the opening event, and where an event has none, from the clock of the
 * exporter. Scope spans MUST be sent only when they close.*
 *
 * F128-FR-012 (traces side): the resource attributes of traces keep the
 * others and set `service.name` to `specstride` in both forms (B-2364: the
 * shipper's own `service.name` is discarded); the instrumentation scope of
 * traces is `specstride.trace` and every span has the kind INTERNAL (B-2365).
 */

import {
  SPAN_KIND_INTERNAL,
  TRACE_SCOPE_NAME,
  traceResourceAttributesOf,
  typedAttributeValue,
} from "./logs.ts";

/** The endpoint of the traces request. */
export const TRACES_ENDPOINT = "/v1/traces" as const;

/** The URL of the traces request from the base address. */
export function tracesUrlOf(base: string): string {
  return `${base.replace(/\/+$/, "")}${TRACES_ENDPOINT}`;
}

/** One built span as the request carries it. */
export type TracesSpanInput = {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly kind?: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly status?: { readonly code: 2; readonly message: string } | null;
};

/** One span of the `spans[]` array (B-2375). */
export function spanOf(span: TracesSpanInput): Record<string, unknown> {
  const attributes = Object.entries(span.attributes)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: typedAttributeValue(value) }));
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId !== undefined ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: span.kind ?? SPAN_KIND_INTERNAL,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes,
    ...(span.status !== null && span.status !== undefined
      ? { status: { code: span.status.code, message: span.status.message } }
      : {}),
  };
}

/** The body of one traces request over the spans that have closed. */
export function buildTracesRequest(options: {
  readonly form: "as-is" | "new";
  readonly labels?: { task?: string; backend?: string; project?: string; harness?: string };
  readonly spans: readonly TracesSpanInput[];
}): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: Object.entries(
            traceResourceAttributesOf(options.form, options.labels ?? {}),
          ).map(([key, value]) => ({ key, value: { stringValue: value } })),
        },
        scopeSpans: [
          {
            scope: { name: TRACE_SCOPE_NAME },
            spans: options.spans.map(spanOf),
          },
        ],
      },
    ],
  });
}
