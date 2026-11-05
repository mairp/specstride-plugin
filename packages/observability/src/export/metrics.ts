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

// @lisa/otel — platform metrics (FR-060).
//
// FR-060 requires metrics covering AT LEAST: jobs by state, phase durations,
// reject rates, token spend, queue depth, and approval latency — and telemetry
// MUST stay best-effort and off the critical path (FR-031 generalized platform-
// wide). This module is the typed recorder for those six families. It accumulates
// in-process and renders an OTLP `/v1/metrics` payload (the same wire shape the
// OTLP forwarder produces), which is exported through the best-effort OTLP seam.
//
// The recorder derives directly from platform facts the engine already owns:
//   - jobs by state          ← the `JobState` gauge (asynchronous, last-value)
//   - phase durations        ← task.started → task.completed elapsed (histogram, s)
//   - reject rates           ← critic verdict counter by result (APPROVED/REJECTED…)
//   - token spend            ← per-attempt Usage (counter, by kind, + cost)
//   - queue depth            ← scheduler ready-queue length gauge
//   - approval latency       ← approval.requested → approval.decided elapsed (hist, s)
//
// It NEVER throws into the loop: every record method is a plain accumulation, and
// `snapshot()` is a pure read; the export itself uses the forwarder's best-effort
// POST.

// Histogram bounds (seconds) sized for phase/approval wall-clock durations.
const DURATION_BOUNDS_S = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600];
const AGG_DELTA = 1;
const SCOPE_NAME = "lisa.core";

/** The lifecycle states a job can occupy (mirrors core `JobState`). */
export type JobStateName =
  | "INTAKE"
  | "NORMALIZING"
  | "PLANNING"
  | "PLAN_REVIEW"
  | "READY"
  | "EXECUTING"
  | "INTEGRATING"
  | "VERIFYING"
  | "COMPLETED"
  | "PAUSED"
  | "AWAITING_HUMAN"
  | "CANCELLED"
  | "FAILED"
  | "BUDGET_EXCEEDED";

interface Histogram {
  count: number;
  sum: number;
  buckets: number[];
}

function emptyHistogram(): Histogram {
  return { count: 0, sum: 0, buckets: new Array(DURATION_BOUNDS_S.length + 1).fill(0) };
}

function observe(h: Histogram, value: number): void {
  h.count += 1;
  h.sum += value;
  let idx = DURATION_BOUNDS_S.length;
  for (let i = 0; i < DURATION_BOUNDS_S.length; i++) {
    if (value <= DURATION_BOUNDS_S[i]!) {
      idx = i;
      break;
    }
  }
  h.buckets[idx]! += 1;
}

/** A plain snapshot of the recorder's current values (for tests / inspection). */
export interface MetricsSnapshot {
  jobsByState: Record<string, number>;
  phaseDuration: { count: number; sum: number };
  verdicts: Record<string, number>;
  rejectRate: number;
  tokens: Record<string, number>;
  costUsd: number;
  queueDepth: number;
  approvalLatency: { count: number; sum: number };
}

/**
 * The platform-metrics recorder. One instance per daemon/process. Every method is
 * a cheap accumulation off the critical path; nothing here can throw into the loop.
 */
export class PlatformMetrics {
  // jobs by state — a last-value gauge keyed by JobState.
  private jobsByState = new Map<string, number>();
  // phase durations — histogram (seconds), attributed by phase where known.
  private phaseHist = emptyHistogram();
  // reject rates — verdict counter by result.
  private verdicts = new Map<string, number>();
  // token spend — counter by kind + a cost accumulator.
  private tokens = new Map<string, number>();
  private costUsd = 0;
  // queue depth — last-value gauge.
  private queueDepthValue = 0;
  // approval latency — histogram (seconds).
  private approvalHist = emptyHistogram();

  private readonly nowNanos: () => bigint;
  private readonly start: string;

  constructor(opts: { nowNanos?: () => bigint } = {}) {
    this.nowNanos = opts.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
    this.start = this.nowNanos().toString();
  }

  /** Record a job's current state. Moving a job DECrements its old state's gauge. */
  setJobState(state: JobStateName, previous?: JobStateName): void {
    if (previous && previous !== state) {
      const prev = (this.jobsByState.get(previous) ?? 0) - 1;
      this.jobsByState.set(previous, Math.max(0, prev));
    }
    this.jobsByState.set(state, (this.jobsByState.get(state) ?? 0) + 1);
  }

  /** Observe a completed phase's wall-clock duration in seconds. */
  recordPhaseDuration(seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) observe(this.phaseHist, seconds);
  }

  /** Record a critic verdict (`APPROVED`/`REJECTED`/`MALFORMED`) — drives reject rate. */
  recordVerdict(result: string): void {
    this.verdicts.set(result, (this.verdicts.get(result) ?? 0) + 1);
  }

  /** Record per-attempt token usage and cost (token spend). */
  recordTokens(usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    costUsd?: number;
  }): void {
    const add = (kind: string, n: number | undefined): void => {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) {
        this.tokens.set(kind, (this.tokens.get(kind) ?? 0) + n);
      }
    };
    add("input", usage.inputTokens);
    add("output", usage.outputTokens);
    add("cache_read", usage.cacheReadTokens);
    add("cache_creation", usage.cacheCreationTokens);
    if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd) && usage.costUsd > 0) {
      this.costUsd += usage.costUsd;
    }
  }

  /** Record the scheduler's current ready-queue depth (last value wins). */
  setQueueDepth(depth: number): void {
    if (Number.isFinite(depth) && depth >= 0) this.queueDepthValue = Math.trunc(depth);
  }

  /** Observe an approval's wait duration (requested → decided) in seconds. */
  recordApprovalLatency(seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) observe(this.approvalHist, seconds);
  }

  /** The current reject rate over all recorded verdicts (0 when none). */
  rejectRate(): number {
    let total = 0;
    let rejected = 0;
    for (const [result, n] of this.verdicts) {
      total += n;
      if (result !== "APPROVED") rejected += n;
    }
    return total === 0 ? 0 : rejected / total;
  }

  /** A plain snapshot for inspection / assertions. */
  snapshot(): MetricsSnapshot {
    return {
      jobsByState: Object.fromEntries(this.jobsByState),
      phaseDuration: { count: this.phaseHist.count, sum: this.phaseHist.sum },
      verdicts: Object.fromEntries(this.verdicts),
      rejectRate: this.rejectRate(),
      tokens: Object.fromEntries(this.tokens),
      costUsd: this.costUsd,
      queueDepth: this.queueDepthValue,
      approvalLatency: { count: this.approvalHist.count, sum: this.approvalHist.sum },
    };
  }

  /**
   * Render the OTLP `/v1/metrics` payload for the six families. Gauges are emitted
   * as non-monotonic Sums with last-value points (the OTLP shape a Prometheus
   * exporter reads as gauges); counters as monotonic Sums; durations as Histograms.
   */
  toOtlpMetrics(resourceAttrs: Record<string, string> = {}): unknown {
    const now = this.nowNanos().toString();
    const metrics: unknown[] = [];

    // jobs by state — gauge (non-monotonic sum), one point per state.
    metrics.push(
      this.gauge(
        "lisa.jobs",
        now,
        [...this.jobsByState].map(([state, v]) => ({
          attrs: { state },
          value: v,
        })),
      ),
    );

    // queue depth — gauge, single point.
    metrics.push(this.gauge("lisa.queue.depth", now, [{ attrs: {}, value: this.queueDepthValue }]));

    // verdicts — monotonic counter by result (reject rate is derived downstream).
    if (this.verdicts.size > 0) {
      metrics.push(
        this.counter(
          "lisa.verdicts",
          now,
          [...this.verdicts].map(([result, v]) => ({
            attrs: { result },
            value: v,
          })),
        ),
      );
    }

    // token spend — monotonic counter by kind + a cost sum.
    if (this.tokens.size > 0) {
      metrics.push(
        this.counter(
          "lisa.tokens",
          now,
          [...this.tokens].map(([type, v]) => ({
            attrs: { type },
            value: v,
          })),
        ),
      );
    }
    if (this.costUsd > 0) {
      metrics.push(this.counter("lisa.cost_usd", now, [{ attrs: {}, value: this.costUsd }], true));
    }

    // phase durations + approval latency — histograms (seconds).
    if (this.phaseHist.count > 0)
      metrics.push(this.histogram("lisa.phase.duration_s", now, this.phaseHist));
    if (this.approvalHist.count > 0)
      metrics.push(this.histogram("lisa.approval.latency_s", now, this.approvalHist));

    return {
      resourceMetrics: [
        {
          resource: { attributes: kv({ "service.name": "lisa", ...resourceAttrs }) },
          scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics }],
        },
      ],
    };
  }

  private gauge(
    name: string,
    now: string,
    points: { attrs: Record<string, string>; value: number }[],
  ): unknown {
    return {
      name,
      sum: {
        aggregationTemporality: AGG_DELTA,
        isMonotonic: false,
        dataPoints: points.map((p) => ({
          startTimeUnixNano: this.start,
          timeUnixNano: now,
          asInt: String(Math.trunc(p.value)),
          attributes: kv(p.attrs),
        })),
      },
    };
  }

  private counter(
    name: string,
    now: string,
    points: { attrs: Record<string, string>; value: number }[],
    isDouble = false,
  ): unknown {
    return {
      name,
      sum: {
        aggregationTemporality: AGG_DELTA,
        isMonotonic: true,
        dataPoints: points.map((p) => ({
          startTimeUnixNano: this.start,
          timeUnixNano: now,
          ...(isDouble ? { asDouble: p.value } : { asInt: String(Math.trunc(p.value)) }),
          attributes: kv(p.attrs),
        })),
      },
    };
  }

  private histogram(name: string, now: string, h: Histogram): unknown {
    return {
      name,
      unit: "s",
      histogram: {
        aggregationTemporality: AGG_DELTA,
        dataPoints: [
          {
            startTimeUnixNano: this.start,
            timeUnixNano: now,
            count: String(h.count),
            sum: h.sum,
            bucketCounts: h.buckets.map((c) => String(c)),
            explicitBounds: [...DURATION_BOUNDS_S],
            attributes: [],
          },
        ],
      },
    };
  }
}

function kv(d: Record<string, string>): { key: string; value: { stringValue: string } }[] {
  return Object.entries(d).map(([key, v]) => ({ key, value: { stringValue: v } }));
}
