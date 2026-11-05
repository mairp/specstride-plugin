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

// @lisa/otel — the Loki forwarder (FR-031, FR-061).
//
// Port of the baseline `lib/ralph_loki_ship.py`. It ships the run's event stream
// to a Grafana Loki instance as low-cardinality labelled streams whose log lines
// are logfmt, so the existing LogQL dashboards (`| logfmt | unwrap cost_usd`,
// `sum by (model)(…)`) keep working unchanged during the transition.
//
// Two disciplines carried verbatim from the baseline:
//   1. BEST-EFFORT — every failure (bad payload, Loki down, network error,
//      non-2xx) is swallowed with a stderr warning so telemetry can NEVER stall
//      or fail the loop that calls it (FR-031: "a failing or unreachable backend
//      never stalls or fails the run"). `flush()` never rejects.
//   2. Low-cardinality LABELS only — the base set is exactly `job`, `task`,
//      `backend`, `event` (baseline docstring, ralph_loki_ship.py:19). The baseline
//      CODE then adds ONE extra label, `model`, on exactly the two `run_stream`
//      metric events `api_request` and `tool_use` (ralph_loki_ship.py:149-150,171-172);
//      lifecycle/gate events ship through `run_event` with no `labels` arg (line 207),
//      so `model` is NOT a label there — it stays inside the logfmt line as a field.
//      Every other field (run_id, cost, tokens, …) always rides inside the line.
//
// This module also owns the shared wire primitives the OTLP forwarder reuses
// (`logfmt`, `TelemetryEvent`, `telemetryFromV1`) so the two forwarders emit a
// byte-identical log body from one encoder — mirroring the baseline where
// `ralph_otel_ship.py` does `from ralph_loki_ship import logfmt`.

// ─────────────────────────────────────────────────────────────────────────────
//  Shared wire model
// ─────────────────────────────────────────────────────────────────────────────

/** A scalar that can appear in a telemetry field. `null`/`undefined` are dropped. */
export type TelemetryValue = string | number | boolean | null | undefined;

/**
 * One telemetry event to forward. `event` is the low-cardinality event name
 * (`api_request`, `tool_use`, `gate`, or a lifecycle name); `fields` are the
 * typed payload that becomes the logfmt body (Loki) and the typed metric inputs
 * + log attributes (OTLP); `labels` are extra low-cardinality labels/attrs (the
 * baseline only ever adds `model`).
 */
export interface TelemetryEvent {
  event: string;
  fields: Record<string, TelemetryValue>;
  labels?: Record<string, string>;
}

/**
 * logfmt encoding — byte-for-byte the baseline `_fmt_val`/`logfmt`
 * (ralph_loki_ship.py:40-57):
 *   - `null`/`undefined` value key is DROPPED entirely (Python skips `is not None`).
 *   - a boolean → `true`/`false`.
 *   - a number → its shortest decimal (`repr` in Python; `String(n)` here).
 *   - a string → bare unless empty or containing space, `"`, `=`, or `\`, in which
 *     case it is `\`-escaped and double-quoted.
 * Newlines/carriage-returns are collapsed to spaces first, as in the baseline.
 */
export function fmtVal(v: TelemetryValue): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  let s = String(v).replace(/\n/g, " ").replace(/\r/g, " ");
  if (s === "" || /[ "=\\]/.test(s)) {
    s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${s}"`;
  }
  return s;
}

/** Encode a field map to a single logfmt line (undefined/null fields dropped). */
export function logfmt(fields: Record<string, TelemetryValue>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    parts.push(`${k}=${fmtVal(v)}`);
  }
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
//  events.jsonl → telemetry event(s)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map one parsed v1 `events.jsonl` record (the byte-compatible wire the journal
 * and agent-tap write) onto the telemetry event the forwarders ship. The agent
 * tap already produced `agent_result`/`agent_tool` lines with the same fields the
 * baseline stream shipper extracted from `claude … stream-json`, and the critic
 * produced `verdict` lines — so we normalize those onto the baseline's three
 * metric-bearing events (`api_request`, `tool_use`, `gate`) and pass every other
 * lifecycle event through as-is.
 *
 * LABEL DISCIPLINE — exact executable parity with the baseline, not its docstring:
 * the docstring (ralph_loki_ship.py:19-21) names only the four base labels
 * `job/task/backend/event`, but the CODE adds `model` as an EXTRA label on exactly
 * the two `run_stream` metric events — `api_request` (line 171-172:
 * `loki.add("api_request", …, labels={"model": model} …)`) and `tool_use`
 * (line 149-150: `loki.add("tool_use", …, labels={"model": model_seen} …)`). Every
 * lifecycle/gate event is shipped through `run_event`, whose single `loki.add(...)`
 * call (line 207) passes NO `labels` argument — so `model` is NEVER a label there;
 * it stays inside the logfmt line as an ordinary field (line 156-157 keeps `model`
 * in the api_request field dict too). We reproduce that split precisely: `model` is
 * lifted to a label ONLY for `agent_result`→`api_request` and `agent_tool`→`tool_use`.
 *
 * Returns `undefined` for records with no `event` (nothing to ship).
 */
export function telemetryFromV1(record: Record<string, unknown>): TelemetryEvent | undefined {
  const name = record["event"];
  if (typeof name !== "string" || name === "") return undefined;

  // The envelope identity (run_id/task/backend) rides in the line as fields, not
  // labels — task/backend are already forwarder base labels; run_id stays in-line
  // exactly as the baseline did.
  const fields: Record<string, TelemetryValue> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "event" || k === "ts" || k === "time" || k === "task" || k === "backend") continue;
    fields[k] = coerceScalar(v);
  }

  // `model` becomes an extra Loki label ONLY on the two stream-mode metric events,
  // matching the baseline `run_stream` calls. It always ALSO remains in `fields`
  // (and therefore in the logfmt line), exactly as the baseline keeps it there.
  const model = typeof record["model"] === "string" ? (record["model"] as string) : undefined;
  const streamLabels = model ? { model } : undefined;

  // Normalize the tap/critic events onto the baseline's metric-bearing names so
  // OTLP derives the same metrics the Python shipper did from stream-json.
  if (name === "agent_result") {
    return { event: "api_request", fields, ...(streamLabels ? { labels: streamLabels } : {}) };
  }
  if (name === "agent_tool") {
    return { event: "tool_use", fields, ...(streamLabels ? { labels: streamLabels } : {}) };
  }
  if (name === "verdict") {
    // The critic verdict is the baseline `gate` event (result=APPROVED|REJECTED…),
    // shipped through the baseline's label-less `run_event` path → NO model label.
    return { event: "gate", fields };
  }
  // Any other lifecycle event (run_start, iter_start, run_end, git_checkpoint, …):
  // baseline `run_event` adds no labels → model (if any) stays in the line only.
  return { event: name, fields };
}

function coerceScalar(v: unknown): TelemetryValue {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Loki push
// ─────────────────────────────────────────────────────────────────────────────

/** How the forwarders report the outcome of a POST (so callers/tests can observe it). */
export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** One Loki stream: its full label set + `[nanosecondTs, logfmtLine]` values. */
export interface LokiStreamWire {
  stream: Record<string, string>;
  values: [string, string][];
}

/** The `/loki/api/v1/push` request body. */
export interface LokiPushPayload {
  streams: LokiStreamWire[];
}

export interface LokiOptions {
  /** Base URL, e.g. `http://localhost:3100`; the push path is appended. */
  url: string;
  /** Always-on labels (baseline: `{ job: "lisa" }`, plus task/backend). */
  baseLabels?: Record<string, string>;
  /** Connect/read timeout in ms (baseline `RALPH_LOKI_TIMEOUT`, 2500). */
  timeoutMs?: number;
  /** Sink for the best-effort warning (defaults to `process.stderr`). */
  warn?: (msg: string) => void;
  /** Injectable POST (tests capture; default is `globalThis.fetch`). */
  fetchImpl?: typeof fetch;
  /** Injectable nanosecond clock (kept out of the engine's pure core). */
  nowNanos?: () => bigint;
}

interface Stream {
  labels: Record<string, string>;
  values: [string, string][];
}

/**
 * The batched Loki push client. `add()`/`addEvent()` buffer log lines keyed by
 * their full label set; `flush()` POSTs one `/loki/api/v1/push` payload and
 * clears the buffer. Best-effort throughout.
 */
export class LokiForwarder {
  readonly pushUrl: string;
  private readonly base: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly warnFn: (msg: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly nowNanos: () => bigint;
  private streams = new Map<string, Stream>();

  constructor(opts: LokiOptions) {
    this.pushUrl = opts.url.replace(/\/+$/, "") + "/loki/api/v1/push";
    this.base = { job: "lisa", ...(opts.baseLabels ?? {}) };
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.warnFn = opts.warn ?? ((m) => process.stderr.write(`loki-forward: ${m}\n`));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowNanos = opts.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
  }

  /** Buffer one raw log line under the base labels + `event` (+ any extra labels). */
  add(event: string, line: string, extraLabels?: Record<string, string>): void {
    const labels: Record<string, string> = { ...this.base, event };
    if (extraLabels) Object.assign(labels, extraLabels);
    const key = streamKey(labels);
    let s = this.streams.get(key);
    if (!s) {
      s = { labels, values: [] };
      this.streams.set(key, s);
    }
    s.values.push([this.nowNanos().toString(), line]);
  }

  /** Buffer one telemetry event: logfmt its fields, lift `model` to a label. */
  addEvent(ev: TelemetryEvent): void {
    this.add(ev.event, logfmt(ev.fields), ev.labels);
  }

  /** How many buffered log lines are pending a flush (for tests/backpressure). */
  pending(): number {
    let n = 0;
    for (const s of this.streams.values()) n += s.values.length;
    return n;
  }

  /**
   * The `/loki/api/v1/push` payload for the currently-buffered streams, WITHOUT
   * clearing the buffer. Exposed (typed) so callers/tests can inspect the exact
   * label sets and logfmt line bodies that would be shipped.
   */
  buildPayload(): LokiPushPayload {
    return {
      streams: [...this.streams.values()].map((s) => ({ stream: s.labels, values: s.values })),
    };
  }

  /**
   * POST the batched streams to Loki. Best-effort: on ANY failure it warns and
   * resolves `{ ok: false }` — it never rejects, so a caller can `await` it on the
   * critical path safely. The buffer is cleared regardless (a failed push does not
   * pile up unbounded, matching the baseline's `finally: self.streams = {}`).
   */
  async flush(): Promise<ForwardResult> {
    if (this.streams.size === 0) return { ok: true };
    const payload = this.buildPayload();
    this.streams = new Map();
    return this.post(payload);
  }

  private async post(payload: unknown): Promise<ForwardResult> {
    const body = JSON.stringify(payload);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(this.pushUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctl.signal,
      });
      if (resp.status !== 200 && resp.status !== 204) {
        this.warnFn(`Loki push HTTP ${resp.status}`);
        return { ok: false, status: resp.status };
      }
      return { ok: true, status: resp.status };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.warnFn(`Loki push error: ${msg}`);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Stable key for a label set (order-independent, mirrors the Python frozenset). */
function streamKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("\u0000");
}
