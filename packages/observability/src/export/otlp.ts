// Copyright 2026 the Specstride authors
//
// Extracted from Lisa, package `@lisa/otel`, at commit 363e6a3
// (363e6a392ff6e59ec4905c044fb3b0a5239cbffc), as task T006 of feature 128
// (telemetry export). The characterization test CT-128-11
// (tests/characterization/128/lisa-exporter.test.ts) holds the extracted
// behaviour; the tasks that follow rewrite this file against the
// specification of feature 128.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// @lisa/otel — the OTLP log/metric forwarder (FR-031).
//
// Port of the baseline `lib/ralph_otel_ship.py`. A stdlib-only sibling of the Loki
// forwarder: same best-effort contract, but it hand-builds OTLP/HTTP+JSON and
// POSTs it with `fetch`, so the two forwarders run side by side (dual-ship).
//
// Two OTLP signals come from the same telemetry stream:
//   * LOGS   (/v1/logs)    — one log record per event. Resource attributes carry the
//     low-cardinality identity (service.name=lisa, task, backend); every typed field
//     becomes a log-record attribute AND the record body keeps the SAME logfmt string
//     the Loki forwarder emits, so a collector with a logfmt parser reproduces the
//     Loki fields verbatim. This byte-parity of the body is proven in otlp.test.ts.
//   * METRICS (/v1/metrics) — cost / tokens / duration / counts as real OTLP metrics
//     (lisa.cost_usd Sum, lisa.tokens Sum by type, lisa.iter.duration_ms Histogram,
//     lisa.errors Sum, lisa.tool_use Sum, lisa.gate Sum). DELTA temporality: each
//     short-lived forwarder reports its own slice; the collector cumulates.
//
// The log body is produced by `logfmt` imported from `./loki.js` — ONE encoder, so
// the OTLP body can never drift from the Loki line (the baseline's
// `from ralph_loki_ship import logfmt`).

import { logfmt, type ForwardResult, type TelemetryEvent, type TelemetryValue } from "./loki.ts";

// DELTA temporality: each forwarder invocation reports its own delta slice.
const AGG_DELTA = 1;
// Histogram bounds for iteration duration, in milliseconds (baseline DURATION_BOUNDS_MS).
const DURATION_BOUNDS_MS = [100, 500, 1000, 5000, 10000, 30000, 60000, 120000];
const SCOPE_NAME = "lisa.core";

// ─────────────────────────────────────────────────────────────────────────────
//  OTLP AnyValue / KeyValue encoding
// ─────────────────────────────────────────────────────────────────────────────

type AnyValue =
  { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

/** Encode a scalar as an OTLP AnyValue. bool BEFORE int (baseline `_any_value`). */
export function anyValue(v: TelemetryValue): AnyValue {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function attrsKv(d: Record<string, TelemetryValue>): { key: string; value: AnyValue }[] {
  const out: { key: string; value: AnyValue }[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue;
    out.push({ key: k, value: anyValue(v) });
  }
  return out;
}

function toInt(v: TelemetryValue): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
  return undefined;
}

function toFloat(v: TelemetryValue): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function truthy(v: TelemetryValue): boolean {
  if (v === true) return true;
  if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Metric accumulators
// ─────────────────────────────────────────────────────────────────────────────

interface SumEntry {
  name: string;
  unit: string;
  isDouble: boolean;
  attrs: Record<string, string>;
  value: number;
}
interface HistEntry {
  name: string;
  unit: string;
  attrs: Record<string, string>;
  count: number;
  sum: number;
  buckets: number[];
}

export interface OtlpOptions {
  /** Base URL, e.g. `http://localhost:4318`; `/v1/logs` and `/v1/metrics` appended. */
  url: string;
  /** Resource attributes; `service.name` defaults to `lisa` (baseline `ralph`). */
  resourceAttrs?: Record<string, string>;
  timeoutMs?: number;
  warn?: (msg: string) => void;
  fetchImpl?: typeof fetch;
  nowNanos?: () => bigint;
}

/**
 * The batched OTLP forwarder (logs + metrics). `addEvent()` buffers one log record
 * and accumulates its metrics; `flush()` POSTs `/v1/logs` and `/v1/metrics` and
 * clears the buffer. Best-effort throughout — `flush()` never rejects.
 */
export class OtlpForwarder {
  readonly logsUrl: string;
  readonly metricsUrl: string;
  private readonly resource: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly warnFn: (msg: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly nowNanos: () => bigint;
  private readonly start: string;
  private logs: { ts: string; body: string; attrs: Record<string, TelemetryValue> }[] = [];
  private sums = new Map<string, SumEntry>();
  private hists = new Map<string, HistEntry>();

  constructor(opts: OtlpOptions) {
    const base = opts.url.replace(/\/+$/, "");
    this.logsUrl = base + "/v1/logs";
    this.metricsUrl = base + "/v1/metrics";
    this.resource = { "service.name": "lisa", ...(opts.resourceAttrs ?? {}) };
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.warnFn = opts.warn ?? ((m) => process.stderr.write(`otlp-forward: ${m}\n`));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowNanos = opts.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
    this.start = this.nowNanos().toString();
  }

  /**
   * Buffer one telemetry event. The log body is the SAME logfmt line the Loki
   * forwarder emits (byte-parity); the event name + `model` label + every typed
   * field become log-record attributes; and the metric-bearing events accumulate
   * the baseline metrics.
   */
  addEvent(ev: TelemetryEvent): void {
    const body = logfmt(ev.fields);
    const rec: Record<string, TelemetryValue> = { event: ev.event };
    if (ev.labels) for (const [k, v] of Object.entries(ev.labels)) rec[k] = v;
    for (const [k, v] of Object.entries(ev.fields)) {
      if (v !== null && v !== undefined && k !== "event") rec[k] = v;
    }
    this.logs.push({ ts: this.nowNanos().toString(), body, attrs: rec });
    this.accumulate(ev);
  }

  pending(): number {
    return this.logs.length;
  }

  private addSum(
    name: string,
    value: number | undefined,
    attrs: Record<string, string>,
    isDouble: boolean,
    unit = "",
  ): void {
    if (value === undefined) return;
    const key = `${name}\x00${unit}\x00${isDouble}\x00${sortedAttrs(attrs)}`;
    const e = this.sums.get(key);
    if (e) e.value += value;
    else this.sums.set(key, { name, unit, isDouble, attrs, value });
  }

  private addHist(
    name: string,
    value: number | undefined,
    attrs: Record<string, string>,
    unit = "",
  ): void {
    if (value === undefined) return;
    const key = `${name}\x00${unit}\x00${sortedAttrs(attrs)}`;
    let h = this.hists.get(key);
    if (!h) {
      h = {
        name,
        unit,
        attrs,
        count: 0,
        sum: 0,
        buckets: new Array(DURATION_BOUNDS_MS.length + 1).fill(0),
      };
      this.hists.set(key, h);
    }
    h.count += 1;
    h.sum += value;
    let idx = DURATION_BOUNDS_MS.length;
    for (let i = 0; i < DURATION_BOUNDS_MS.length; i++) {
      if (value <= DURATION_BOUNDS_MS[i]!) {
        idx = i;
        break;
      }
    }
    h.buckets[idx]! += 1;
  }

  private accumulate(ev: TelemetryEvent): void {
    const model = (ev.fields["model"] as string | undefined) ?? ev.labels?.["model"];
    const ma: Record<string, string> = model ? { model } : {};
    if (ev.event === "api_request") {
      this.addSum("lisa.cost_usd", toFloat(ev.fields["cost_usd"]), ma, true);
      const tokenKeys: [string, string][] = [
        ["input_tokens", "input"],
        ["output_tokens", "output"],
        ["cache_read_tokens", "cache_read"],
        ["cache_creation_tokens", "cache_creation"],
      ];
      for (const [fkey, ttype] of tokenKeys) {
        this.addSum("lisa.tokens", toInt(ev.fields[fkey]), { ...ma, type: ttype }, false);
      }
      this.addHist("lisa.iter.duration_ms", toFloat(ev.fields["duration_ms"]), ma, "ms");
      if (truthy(ev.fields["is_error"])) this.addSum("lisa.errors", 1, ma, false);
    } else if (ev.event === "tool_use") {
      const tool = ev.fields["tool"];
      this.addSum("lisa.tool_use", 1, typeof tool === "string" ? { tool } : {}, false);
    } else if (ev.event === "gate") {
      const result = ev.fields["result"];
      this.addSum("lisa.gate", 1, typeof result === "string" ? { result } : {}, false);
    }
  }

  private resourceBlock(): { attributes: { key: string; value: AnyValue }[] } {
    return { attributes: attrsKv(this.resource) };
  }

  /** The `/v1/logs` payload (exposed so tests and the parity check can read it). */
  logsPayload(): unknown {
    const now = this.nowNanos().toString();
    const records = this.logs.map((l) => ({
      timeUnixNano: l.ts,
      observedTimeUnixNano: now,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: l.body },
      attributes: attrsKv(l.attrs),
    }));
    return {
      resourceLogs: [
        {
          resource: this.resourceBlock(),
          scopeLogs: [{ scope: { name: SCOPE_NAME }, logRecords: records }],
        },
      ],
    };
  }

  /** The `/v1/metrics` payload. */
  metricsPayload(): unknown {
    const now = this.nowNanos().toString();
    const metrics: unknown[] = [];
    // group sums by (name, unit, isDouble)
    const byName = new Map<
      string,
      { name: string; unit: string; isDouble: boolean; points: unknown[] }
    >();
    for (const e of this.sums.values()) {
      const dp: Record<string, unknown> = {
        startTimeUnixNano: this.start,
        timeUnixNano: now,
        attributes: attrsKv(e.attrs),
      };
      if (e.isDouble) dp["asDouble"] = e.value;
      else dp["asInt"] = String(Math.trunc(e.value));
      const key = `${e.name}\x00${e.unit}\x00${e.isDouble}`;
      let g = byName.get(key);
      if (!g) {
        g = { name: e.name, unit: e.unit, isDouble: e.isDouble, points: [] };
        byName.set(key, g);
      }
      g.points.push(dp);
    }
    for (const g of byName.values()) {
      metrics.push({
        name: g.name,
        unit: g.unit,
        sum: { aggregationTemporality: AGG_DELTA, isMonotonic: true, dataPoints: g.points },
      });
    }
    // histograms
    const hByName = new Map<string, { name: string; unit: string; points: unknown[] }>();
    for (const h of this.hists.values()) {
      const dp = {
        startTimeUnixNano: this.start,
        timeUnixNano: now,
        count: String(h.count),
        sum: h.sum,
        bucketCounts: h.buckets.map((c) => String(c)),
        explicitBounds: [...DURATION_BOUNDS_MS],
        attributes: attrsKv(h.attrs),
      };
      const key = `${h.name}\x00${h.unit}`;
      let g = hByName.get(key);
      if (!g) {
        g = { name: h.name, unit: h.unit, points: [] };
        hByName.set(key, g);
      }
      g.points.push(dp);
    }
    for (const g of hByName.values()) {
      metrics.push({
        name: g.name,
        unit: g.unit,
        histogram: { aggregationTemporality: AGG_DELTA, dataPoints: g.points },
      });
    }
    return {
      resourceMetrics: [
        {
          resource: this.resourceBlock(),
          scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics }],
        },
      ],
    };
  }

  /**
   * POST logs (if any) and metrics (if any). Best-effort: warns and reports
   * `{ ok: false }` on any failure, never rejects. The buffer is cleared regardless.
   */
  async flush(): Promise<{ logs?: ForwardResult; metrics?: ForwardResult }> {
    const hasLogs = this.logs.length > 0;
    const hasMetrics = this.sums.size > 0 || this.hists.size > 0;
    const logsPayload = hasLogs ? this.logsPayload() : undefined;
    const metricsPayload = hasMetrics ? this.metricsPayload() : undefined;
    this.logs = [];
    this.sums = new Map();
    this.hists = new Map();
    const out: { logs?: ForwardResult; metrics?: ForwardResult } = {};
    if (logsPayload !== undefined) out.logs = await this.post(this.logsUrl, logsPayload);
    if (metricsPayload !== undefined)
      out.metrics = await this.post(this.metricsUrl, metricsPayload);
    return out;
  }

  private async post(url: string, payload: unknown): Promise<ForwardResult> {
    const body = JSON.stringify(payload);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctl.signal,
      });
      if (resp.status !== 200 && resp.status !== 202 && resp.status !== 204) {
        this.warnFn(`OTLP push HTTP ${resp.status} to ${url}`);
        return { ok: false, status: resp.status };
      }
      return { ok: true, status: resp.status };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.warnFn(`OTLP push error: ${msg}`);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sortedAttrs(attrs: Record<string, string>): string {
  return Object.keys(attrs)
    .sort()
    .map((k) => `${k}=${attrs[k]}`)
    .join(",");
}
