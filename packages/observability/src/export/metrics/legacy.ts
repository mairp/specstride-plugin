/**
 * T051 — the opt-in for the old metric names (F128-FR-032).
 *
 * F128-FR-032: *The option `telemetry.otel.legacyMetricNames`, off by default
 * and off under the `parity` profile, MUST additionally send the as-is
 * metrics `ralph.iter.duration_ms` (histogram, `model`), `ralph.cost_usd`
 * (sum, `model`), `ralph.tokens` (sum, `model` and `type` of `input`,
 * `output`, `cache_read`, `cache_creation`), `ralph.errors` (sum, `model`),
 * `ralph.tool_use` (sum, `tool`) and `ralph.gate` (sum, `result`), from the
 * same records as the new metrics and never instead of them. It MUST never
 * rename an attribute of a new metric.*
 *
 * The old metrics are DERIVED here from the series the recorder of
 * `recorder.ts` already holds — the same records, a second projection — and
 * APPENDED AFTER the new metrics of the `/v1/metrics` body, so they can never
 * replace one. No attribute of a new metric is read for writing here: the
 * derivation copies, it never renames.
 */
import { DURATION_BOUNDS_MS } from "./recorder.ts";

/** The key the opt-in is read from (the key list of feature 110). */
export const LEGACY_METRIC_NAMES_SWITCH = "telemetry.otel.legacyMetricNames" as const;

/** The six as-is metric names, in the order of the requirement. */
export const LEGACY_METRIC_NAMES: readonly string[] = Object.freeze([
  "ralph.iter.duration_ms",
  "ralph.cost_usd",
  "ralph.tokens",
  "ralph.errors",
  "ralph.tool_use",
  "ralph.gate",
]);

/** Whether the opt-in is on: only the literal `true`, and never under `parity`. */
export function legacyMetricNamesOn(
  switches: Readonly<Record<string, unknown>>,
  profile?: string,
): boolean {
  if (profile === "parity") return false; // off under the parity profile
  return switches[LEGACY_METRIC_NAMES_SWITCH] === true;
}

/** What the derivation does to the attributes of a new metric: NOTHING. */
export const NEVER_RENAMES_AN_ATTRIBUTE = true as const;

/** A recorded series the derivation reads (the shape `MetricRecorder.seriesOf` returns). */
export type RecordedSeries = {
  readonly attrs: Record<string, string>;
  readonly value: number;
  readonly hist?: {
    count: number;
    sum: number;
    bucketCounts: number[];
  };
};

/** What the old metric keeps as its `type` for the new metric's `cache_write`. */
const CACHE_WRITE_TO_CREATION: Readonly<Record<string, string>> = Object.freeze({
  cache_write: "cache_creation",
});

/** The typed `attributes` array of a legacy point. */
function legacyAttrs(attrs: Record<string, string>): unknown[] {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

/**
 * The six old metrics derived from the same recorded series the new metrics
 * were summed from. Each entry is one OTLP metric object of the `/v1/metrics`
 * body; nothing here holds a value the recorder did not record first.
 */
export function legacyMetricsFrom(
  seriesOf: (name: string) => readonly RecordedSeries[],
  options: { startUnixNano: string; timeUnixNano: string },
): unknown[] {
  const point = (attrs: Record<string, string>, extra: Record<string, unknown>) => ({
    startTimeUnixNano: options.startUnixNano,
    timeUnixNano: options.timeUnixNano,
    ...extra,
    attributes: legacyAttrs(attrs),
  });
  const out: unknown[] = [];

  // ralph.iter.duration_ms — the pass-duration histogram, by model.
  const pass = seriesOf("specstride.pass.duration").filter((s) => s.hist !== undefined);
  if (pass.length > 0) {
    out.push({
      name: "ralph.iter.duration_ms",
      unit: "ms",
      histogram: {
        aggregationTemporality: 1,
        dataPoints: pass.map((s) =>
          point(s.attrs, {
            count: String(s.hist!.count),
            sum: s.hist!.sum,
            bucketCounts: s.hist!.bucketCounts.map((c) => String(c)),
            explicitBounds: [...DURATION_BOUNDS_MS],
          }),
        ),
      },
    });
  }

  // ralph.cost_usd — the cost sum, by model (and the other cost attributes kept).
  const cost = seriesOf("specstride.cost.usd");
  if (cost.length > 0) {
    out.push({
      name: "ralph.cost_usd",
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: cost.map((s) => point(s.attrs, { asDouble: s.value })),
      },
    });
  }

  // ralph.tokens — the token sums, by model and type, `cache_write` read as
  // the old name's `cache_creation` (the as-is type of the same record).
  const tokens = seriesOf("specstride.tokens");
  const legacyTokens = tokens.map((s) => ({
    attrs: {
      ...s.attrs,
      ...(CACHE_WRITE_TO_CREATION[s.attrs["type"] ?? ""]
        ? { type: CACHE_WRITE_TO_CREATION[s.attrs["type"] ?? ""]! }
        : {}),
    },
    value: s.value,
  }));
  if (legacyTokens.length > 0) {
    out.push({
      name: "ralph.tokens",
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: legacyTokens.map((s) => point(s.attrs, { asInt: String(Math.trunc(s.value)) })),
      },
    });
  }

  // ralph.errors, ralph.tool_use, ralph.gate — the three counters, by their one attribute.
  const counterOf = (newName: string, oldName: string): unknown => {
    const series = seriesOf(newName);
    if (series.length === 0) return null;
    return {
      name: oldName,
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: series.map((s) => point(s.attrs, { asInt: String(Math.trunc(s.value)) })),
      },
    };
  };
  for (const [newName, oldName] of [
    ["specstride.errors", "ralph.errors"],
    ["specstride.tool.calls", "ralph.tool_use"],
    ["specstride.verdict", "ralph.gate"],
  ] as const) {
    const metric = counterOf(newName, oldName);
    if (metric !== null) out.push(metric);
  }
  return out;
}

/**
 * Append the old metrics AFTER the new ones in the `/v1/metrics` body — never
 * instead of them, and never before a new metric. The new metrics are copied,
 * never mutated: no attribute of a new metric is renamed.
 */
export function appendLegacyMetrics(
  newMetrics: readonly unknown[],
  legacyMetrics: readonly unknown[],
): unknown[] {
  return [...newMetrics, ...legacyMetrics];
}
