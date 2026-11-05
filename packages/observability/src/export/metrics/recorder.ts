/**
 * T049 — the metric recorder (F128-FR-030, F128-FR-031).
 *
 * F128-FR-030: *The exporter MUST record these metrics, with the names
 * `specstride.*` and delta temporality: `specstride.cost.usd` (sum;
 * attributes `role`, `model`, `provider`, `billing`, `cost_source`),
 * `specstride.tokens` (sum; `type` of `input`, `output`, `cache_read`,
 * `cache_write`, `reasoning`, plus `model`), `specstride.pass.duration`
 * (histogram, unit `ms`, attribute `model`), `specstride.errors` (sum,
 * `model`), `specstride.tool.calls` (sum, `tool`), `specstride.verdict` (sum,
 * `result`), `specstride.attempt.outcome` (sum, `cause`),
 * `specstride.check.duration` (histogram, `result`),
 * `specstride.pause.duration` (histogram), `specstride.blocked.duration`
 * (histogram), `specstride.quota.utilization` (gauge, `rate_limit_type`) and
 * `specstride.run.state` (gauge, `state`). An error counter MUST be
 * incremented when `is_error` is true or the text `true`, `1` or `yes`. A
 * tool counter MUST be incremented once per tool call, and a verdict counter
 * once per verdict.*
 *
 * F128-FR-031: *Every metric sum MUST be monotonic with delta aggregation
 * temporality, with the start time of the exporter start. The histogram of
 * durations MUST have the explicit bounds 100, 500, 1000, 5000, 10000, 30000,
 * 60000 and 120000 milliseconds. No unit MUST be set on a cost metric.*
 *
 * Everything here is a plain accumulation; nothing throws into the run.
 */
import { scopeNameOf } from "../otlp/logs.ts";

/** The twelve metric names of F128-FR-030, in the order of the requirement. */
export const METRIC_NAMES: readonly string[] = Object.freeze([
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
]);

/**
 * The context-budget gauges (F128-FR-034, `metrics.tsv` rows 14–16). They are
 * NOT part of `METRIC_NAMES` — the twelve names of F128-FR-030 stay twelve —
 * but the recorder carries them beside the twelve: a series recorded under a
 * context name is exported even though the name is not one of the twelve.
 */
export const CONTEXT_METRIC_NAMES: readonly string[] = Object.freeze([
  "specstride.context.bytes",
  "specstride.context.tokens",
  "specstride.context.limit",
]);

/** The explicit bounds of every duration histogram, in milliseconds (F128-FR-031). */
export const DURATION_BOUNDS_MS: readonly number[] = Object.freeze([
  100, 500, 1000, 5000, 10000, 30000, 60000, 120000,
]);

/** Delta aggregation temporality (the OTLP enum value). */
export const DELTA_AGGREGATION_TEMPORALITY = 1 as const;

/** The unit of every duration metric; the cost metric carries NO unit. */
export const DURATION_UNIT = "ms" as const;
/** What the cost metric carries as its unit: nothing. */
export const COST_UNIT_ABSENT = true as const;

/** The texts that turn an `is_error` value into an error increment (F128-FR-030). */
export const IS_ERROR_TEXTS: readonly string[] = Object.freeze(["true", "1", "yes"]);

/** Whether an `is_error` value counts as an error (boolean or text). */
export function isErrorValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return IS_ERROR_TEXTS.includes(value.trim().toLowerCase());
  return false;
}

/** One histogram accumulator. */
type Histogram = {
  count: number;
  sum: number;
  bucketCounts: number[];
};

function emptyHistogram(): Histogram {
  return { count: 0, sum: 0, bucketCounts: DURATION_BOUNDS_MS.map(() => 0).concat(0) };
}

function observe(h: Histogram, value: number): void {
  h.count += 1;
  h.sum += value;
  let index = DURATION_BOUNDS_MS.length;
  for (let i = 0; i < DURATION_BOUNDS_MS.length; i++) {
    if (value <= DURATION_BOUNDS_MS[i]!) {
      index = i;
      break;
    }
  }
  h.bucketCounts[index]! += 1;
}

/** One series of a metric: its attributes and its accumulated value. */
type Series = {
  attrs: Record<string, string>;
  value: number;
  hist?: Histogram;
};

function seriesKey(name: string, attrs: Record<string, string>): string {
  const keys = Object.keys(attrs).sort();
  return `${name}|${keys.map((k) => `${k}=${attrs[k]!}`).join(",")}`;
}

/** The input of `record`: one metric datum with its attributes. */
export type MetricDatum = {
  readonly name: string;
  /** For a sum or a gauge: the increment or the last value. */
  readonly value?: number;
  /** For a histogram: the observation, in milliseconds. */
  readonly observedMs?: number;
  readonly attrs?: Record<string, string>;
};

/** The options of the recorder. */
export type MetricRecorderOptions = {
  /** The clock of the exporter, in nanoseconds. */
  readonly nowNanos?: () => bigint;
};

/**
 * The metric recorder. One instance per exporter start; `startUnixNano` is
 * the start time of every point (F128-FR-031). The records of the usage and
 * tool facts feed the same series the old names are later derived from
 * (`metrics/legacy.ts`), so the opt-in can never split a source.
 */
export class MetricRecorder {
  /** The start of the exporter, in nanoseconds: the start time of every point. */
  readonly startUnixNano: string;

  private readonly nowNanos: () => bigint;
  private readonly sums = new Map<string, Series>();
  private readonly gauges = new Map<string, Series>();
  private readonly hists = new Map<string, Series>();

  constructor(options: MetricRecorderOptions = {}) {
    this.nowNanos = options.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
    this.startUnixNano = this.nowNanos().toString();
  }

  private sum(name: string, by: number, attrs: Record<string, string>): void {
    const key = seriesKey(name, attrs);
    const series = this.sums.get(key) ?? { attrs: { ...attrs }, value: 0 };
    series.value += by;
    this.sums.set(key, series);
  }

  private gauge(name: string, value: number, attrs: Record<string, string>): void {
    const key = seriesKey(name, attrs);
    const series = this.gauges.get(key) ?? { attrs: { ...attrs }, value: 0 };
    series.value = value; // a gauge keeps its last value
    this.gauges.set(key, series);
  }

  private histogram(name: string, observedMs: number, attrs: Record<string, string>): void {
    const key = seriesKey(name, attrs);
    const series = this.hists.get(key) ?? {
      attrs: { ...attrs },
      value: 0,
      hist: emptyHistogram(),
    };
    if (Number.isFinite(observedMs) && observedMs >= 0) observe(series.hist!, observedMs);
    this.hists.set(key, series);
  }

  /** Record one datum. An unknown metric name is ignored, never thrown. */
  record(datum: MetricDatum): void {
    try {
      const attrs = datum.attrs ?? {};
      if (datum.observedMs !== undefined) {
        this.histogram(datum.name, datum.observedMs, attrs);
        return;
      }
      if (datum.value === undefined || !Number.isFinite(datum.value)) return;
      if (
        datum.name === "specstride.quota.utilization" ||
        datum.name === "specstride.run.state" ||
        // The context-budget gauges (F128-FR-034) are gauges, not sums.
        datum.name.startsWith("specstride.context.")
      ) {
        this.gauge(datum.name, datum.value, attrs);
        return;
      }
      this.sum(datum.name, datum.value, attrs);
    } catch {
      // Best-effort: a malformed datum is ignored.
    }
  }

  /** Convenience: record the cost of one usage fact (the cost sum, in dollars). */
  recordCost(costUsd: number, attrs: Record<string, string> = {}): void {
    this.record({ name: "specstride.cost.usd", value: costUsd, attrs });
  }

  /** Convenience: record tokens of one type (`input`/`output`/…) for a model. */
  recordTokens(type: string, count: number, model?: string): void {
    this.record({
      name: "specstride.tokens",
      value: count,
      attrs: model !== undefined ? { type, model } : { type },
    });
  }

  /** Convenience: one error counter, honoured only for a true `is_error` value. */
  recordError(model?: string, isError?: unknown): void {
    if (!isErrorValue(isError)) return;
    this.record({
      name: "specstride.errors",
      value: 1,
      attrs: model !== undefined ? { model } : {},
    });
  }

  /** Convenience: ONE increment per tool call. */
  recordToolCall(tool: string): void {
    this.record({ name: "specstride.tool.calls", value: 1, attrs: { tool } });
  }

  /** Convenience: ONE increment per verdict. */
  recordVerdict(result: string): void {
    this.record({ name: "specstride.verdict", value: 1, attrs: { result } });
  }

  /** The recorded series of one metric name, in first-recorded order. */
  seriesOf(
    name: string,
  ): readonly { attrs: Record<string, string>; value: number; hist?: Histogram }[] {
    const out: { attrs: Record<string, string>; value: number; hist?: Histogram }[] = [];
    for (const source of [this.sums, this.gauges, this.hists]) {
      for (const [key, series] of source) {
        if (key.startsWith(`${name}|`)) out.push(series);
      }
    }
    return out;
  }

  /** The OTLP typed attributes of one series. */
  private static attrsKv(attrs: Record<string, string>): unknown[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    }));
  }

  private now(): string {
    return this.nowNanos().toString();
  }

  /**
   * The `/v1/metrics` request body: sums monotonic with delta temporality,
   * histograms with the explicit bounds of F128-FR-031, gauges as
   * non-monotonic sums, the cost metric without a unit and the durations in
   * `ms`. The scope is the scope of F128-FR-012 for the form in force.
   */
  toOtlpMetrics(
    form: "as-is" | "new" = "new",
    resourceAttrs: Record<string, string> = {},
  ): Record<string, unknown> {
    const now = this.now();
    const metrics: unknown[] = [];
    // The twelve names always, then any context series actually recorded
    // (F128-FR-034) — the twelve stay twelve, the gauges ride beside them.
    const names = [
      ...METRIC_NAMES,
      ...CONTEXT_METRIC_NAMES.filter(
        (n) => !METRIC_NAMES.includes(n) && this.seriesOf(n).length > 0,
      ),
    ];
    for (const name of names) {
      if (
        name === "specstride.pass.duration" ||
        name === "specstride.check.duration" ||
        name === "specstride.pause.duration" ||
        name === "specstride.blocked.duration"
      ) {
        const series = this.seriesOf(name);
        if (series.length === 0) continue;
        metrics.push({
          name,
          unit: DURATION_UNIT,
          histogram: {
            aggregationTemporality: DELTA_AGGREGATION_TEMPORALITY,
            dataPoints: series.map((s) => ({
              startTimeUnixNano: this.startUnixNano,
              timeUnixNano: now,
              count: String(s.hist!.count),
              sum: s.hist!.sum,
              bucketCounts: s.hist!.bucketCounts.map((c) => String(c)),
              explicitBounds: [...DURATION_BOUNDS_MS],
              attributes: MetricRecorder.attrsKv(s.attrs),
            })),
          },
        });
        continue;
      }
      const isGauge =
        name === "specstride.quota.utilization" ||
        name === "specstride.run.state" ||
        name.startsWith("specstride.context.");
      const series = this.seriesOf(name);
      if (series.length === 0) continue;
      const isCost = name === "specstride.cost.usd";
      metrics.push({
        name,
        sum: {
          aggregationTemporality: DELTA_AGGREGATION_TEMPORALITY,
          isMonotonic: !isGauge,
          dataPoints: series.map((s) => ({
            startTimeUnixNano: this.startUnixNano,
            timeUnixNano: now,
            ...(isCost ? { asDouble: s.value } : { asInt: String(Math.trunc(s.value)) }),
            attributes: MetricRecorder.attrsKv(s.attrs),
          })),
        },
      });
    }
    return {
      resourceMetrics: [
        {
          resource: {
            attributes: MetricRecorder.attrsKv({
              ...(form === "as-is"
                ? { "service.name": "ralph" }
                : { "service.name": "specstride" }),
              ...resourceAttrs,
            }),
          },
          scopeMetrics: [{ scope: { name: scopeNameOf(form) }, metrics }],
        },
      ],
    };
  }
}
