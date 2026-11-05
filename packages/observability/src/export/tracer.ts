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

// @lisa/otel — the tracer, span conventions, and W3C `traceparent` propagation
// (FR-059).
//
// FR-059 requires OpenTelemetry spans over the platform's work — specification
// parsing/transformation, reverse-engineering investigations, planning + graph
// validation, scheduler decisions + queue wait, proposer/model execution, tool
// calls, critic evaluation, approval wait, git/worktree ops, integration/
// verification, and event publication — with spans and domain events sharing the
// SAME job / task / plan-revision / correlation / causation / trace / span
// identifiers, and with W3C `traceparent` propagated into child processes and hooks.
//
// This module is intentionally SDK-free (like the baseline shippers): it produces
// W3C-conformant ids and a `traceparent` header by hand, a minimal span tree with
// the pinned span-name conventions, and the propagation seam that injects
// `traceparent` (+ `tracestate`) into a child process environment and a hook's
// HTTP headers / command env. Spans are exported through the same best-effort OTLP
// seam as the metrics/logs forwarders — never on the critical path.

import { randomBytes } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
//  A1. W3C Trace Context (traceparent / tracestate)
// ─────────────────────────────────────────────────────────────────────────────

/** A parsed W3C `traceparent` (version 00). */
export interface SpanContext {
  /** 16-byte trace id as 32 lowercase hex chars. */
  traceId: string;
  /** 8-byte span id as 16 lowercase hex chars. */
  spanId: string;
  /** trace-flags byte (bit 0 = sampled). */
  flags: number;
  /** Opaque `tracestate` header value, propagated verbatim when present. */
  traceState?: string | undefined;
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

/** A fresh random 16-byte trace id (32 hex chars), never all-zero. */
export function newTraceId(rng: (n: number) => Buffer = randomBytes): string {
  let id = rng(16).toString("hex");
  if (id === ZERO_TRACE) id = rng(16).toString("hex");
  return id;
}

/** A fresh random 8-byte span id (16 hex chars), never all-zero. */
export function newSpanId(rng: (n: number) => Buffer = randomBytes): string {
  let id = rng(8).toString("hex");
  if (id === ZERO_SPAN) id = rng(8).toString("hex");
  return id;
}

/** Serialize a span context to a W3C `traceparent` header value. */
export function formatTraceparent(ctx: Pick<SpanContext, "traceId" | "spanId" | "flags">): string {
  const flags = (ctx.flags & 0xff).toString(16).padStart(2, "0");
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Parse a W3C `traceparent`. Returns `undefined` for anything that is not a
 * well-formed version-00 header or that carries the invalid all-zero trace/span id
 * (so a malformed inbound header can never poison a run's correlation).
 */
export function parseTraceparent(
  header: string | undefined,
  traceState?: string,
): SpanContext | undefined {
  if (!header) return undefined;
  const m = TRACEPARENT_RE.exec(header.trim());
  if (!m) return undefined;
  const traceId = m[1]!;
  const spanId = m[2]!;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return undefined;
  return { traceId, spanId, flags: parseInt(m[3]!, 16), ...(traceState ? { traceState } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  A2. Span-name conventions (FR-059 instrumentation points)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pinned span names for the FR-059 instrumentation points. Named constants so
 * spans and the operations they cover cannot drift, and so a dashboard can key on a
 * stable vocabulary. Every name is `lisa.<area>.<op>`.
 */
export const SPAN_NAMES = {
  specParse: "lisa.spec.parse",
  specTransform: "lisa.spec.transform",
  reverseInvestigate: "lisa.reverse.investigate",
  plan: "lisa.plan.generate",
  planValidate: "lisa.plan.validate_graph",
  scheduleDecision: "lisa.scheduler.decision",
  queueWait: "lisa.scheduler.queue_wait",
  proposerPass: "lisa.proposer.pass",
  toolCall: "lisa.proposer.tool_call",
  criticEvaluate: "lisa.critic.evaluate",
  approvalWait: "lisa.approval.wait",
  gitOp: "lisa.git.op",
  worktreeOp: "lisa.worktree.op",
  integrate: "lisa.integration.verify",
  eventPublish: "lisa.events.publish",
} as const;

export type SpanName = (typeof SPAN_NAMES)[keyof typeof SPAN_NAMES];

/**
 * The correlation identifiers a span and its domain events share (FR-059). The
 * journal's `LisaEvent` carries the same `jobId`/`taskId`/`planRevision`/
 * `correlationId`/`causationId`/`traceId`/`spanId`, so a span started for a unit of
 * work stamps its events with matching ids.
 */
export interface Correlation {
  jobId: string;
  taskId?: string | undefined;
  planRevision?: number | undefined;
  correlationId: string;
  causationId?: string | undefined;
}

export type SpanStatus = "unset" | "ok" | "error";

/** A finished span, ready for OTLP export. Times are epoch-nanosecond strings. */
export interface FinishedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

/** A live span. `setAttribute`/`setStatus` refine it; `end()` finalizes it. */
export class Span {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId: string | undefined;
  readonly startNanos: string;
  readonly attributes: Record<string, string | number | boolean>;
  private readonly clock: () => bigint;
  private readonly onEnd: (s: Span) => void;
  private status: SpanStatus = "unset";
  private ended = false;
  private endNanos?: string;

  constructor(
    name: string,
    context: SpanContext,
    parentSpanId: string | undefined,
    startNanos: string,
    attributes: Record<string, string | number | boolean>,
    clock: () => bigint,
    onEnd: (s: Span) => void,
  ) {
    this.name = name;
    this.context = context;
    this.parentSpanId = parentSpanId;
    this.startNanos = startNanos;
    this.attributes = attributes;
    this.clock = clock;
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.status = status;
    return this;
  }

  /** The `traceparent` header a child of THIS span should carry. */
  traceparent(): string {
    return formatTraceparent(this.context);
  }

  end(): FinishedSpan {
    if (!this.ended) {
      this.ended = true;
      this.endNanos = this.clock().toString();
      this.onEnd(this);
    }
    return this.toFinished();
  }

  toFinished(): FinishedSpan {
    return {
      name: this.name,
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      parentSpanId: this.parentSpanId,
      startTimeUnixNano: this.startNanos,
      endTimeUnixNano: this.endNanos ?? this.clock().toString(),
      status: this.status,
      attributes: { ...this.attributes },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  A3. The tracer
// ─────────────────────────────────────────────────────────────────────────────

export interface TracerOptions {
  /** Inbound `traceparent` (e.g. from a webhook / parent process) to continue. */
  parent?: SpanContext | undefined;
  /** Injectable nanosecond clock (kept out of the pure engine). */
  nowNanos?: () => bigint;
  /** Injectable id source (tests pin ids). */
  rng?: (n: number) => Buffer;
  /** Called with every finished span (the OTLP export seam; best-effort). */
  onSpanEnd?: (s: FinishedSpan) => void;
}

/**
 * A minimal tracer. It roots every span in one trace (continuing an inbound
 * `traceparent` when given, else minting a fresh trace id), tracks the current
 * span so children nest correctly, stamps FR-059 correlation attributes, and hands
 * every finished span to `onSpanEnd` for best-effort OTLP export.
 */
export class Tracer {
  private readonly nowNanos: () => bigint;
  private readonly rng: (n: number) => Buffer;
  private readonly onSpanEnd: (s: FinishedSpan) => void;
  private readonly rootTraceId: string;
  private readonly rootFlags: number;
  private readonly rootTraceState: string | undefined;
  private current: SpanContext | undefined;
  private readonly finished: FinishedSpan[] = [];

  constructor(opts: TracerOptions = {}) {
    this.nowNanos = opts.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
    this.rng = opts.rng ?? randomBytes;
    this.onSpanEnd = opts.onSpanEnd ?? (() => {});
    this.rootTraceId = opts.parent?.traceId ?? newTraceId(this.rng);
    this.rootFlags = opts.parent?.flags ?? 1; // sampled by default
    this.rootTraceState = opts.parent?.traceState;
    this.current = opts.parent;
  }

  /** The trace id shared by every span this tracer produces. */
  traceId(): string {
    return this.rootTraceId;
  }

  /**
   * Start a span. It parents to the currently-active span (or the inbound
   * `traceparent`, or is a root) and becomes the active span until `end()`. The
   * correlation ids are stamped as span attributes so spans and events share them.
   */
  startSpan(
    name: SpanName | string,
    correlation: Correlation,
    attributes: Record<string, string | number | boolean> = {},
  ): Span {
    const parentSpanId = this.current?.spanId;
    const context: SpanContext = {
      traceId: this.rootTraceId,
      spanId: newSpanId(this.rng),
      flags: this.rootFlags,
      ...(this.rootTraceState ? { traceState: this.rootTraceState } : {}),
    };
    const attrs: Record<string, string | number | boolean> = {
      "lisa.job_id": correlation.jobId,
      "lisa.correlation_id": correlation.correlationId,
      ...attributes,
    };
    if (correlation.taskId !== undefined) attrs["lisa.task_id"] = correlation.taskId;
    if (correlation.planRevision !== undefined)
      attrs["lisa.plan_revision"] = correlation.planRevision;
    if (correlation.causationId !== undefined) attrs["lisa.causation_id"] = correlation.causationId;

    const prev = this.current;
    this.current = context;
    return new Span(
      name,
      context,
      parentSpanId,
      this.nowNanos().toString(),
      attrs,
      this.nowNanos,
      (s) => {
        const fin = s.toFinished();
        this.finished.push(fin);
        // restore the parent as active on end (LIFO nesting).
        this.current = prev;
        try {
          this.onSpanEnd(fin);
        } catch {
          // best-effort export: a dead exporter must never break the loop.
        }
      },
    );
  }

  /** Run `fn` inside a span, ending it (status ok/error) automatically. */
  async withSpan<T>(
    name: SpanName | string,
    correlation: Correlation,
    fn: (span: Span) => Promise<T> | T,
  ): Promise<T> {
    const span = this.startSpan(name, correlation);
    try {
      const out = await fn(span);
      span.setStatus("ok");
      return out;
    } catch (e) {
      span.setStatus("error").setAttribute("error", e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      span.end();
    }
  }

  /** Every span finished so far (for OTLP export / tests). */
  finishedSpans(): FinishedSpan[] {
    return [...this.finished];
  }

  /** The `traceparent` a child of the active span should carry (root if none active). */
  currentTraceparent(): string {
    const ctx = this.current ?? {
      traceId: this.rootTraceId,
      spanId: ZERO_SPAN,
      flags: this.rootFlags,
    };
    return formatTraceparent(ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  A4. Propagation into child processes and hooks (FR-059)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject W3C trace context into a child process environment. The convention (used
 * by the OTel SDK and honored by downstream harness/hook tooling) is the
 * `TRACEPARENT` / `TRACESTATE` environment variables. The returned object is a
 * COPY — the caller's `env` is never mutated — so a child process spawned for a
 * proposer pass, a git op, or a command hook continues the same trace (FR-059:
 * "W3C `traceparent` propagated into child processes and hooks").
 */
export function injectTraceparentEnv(
  span: Span | SpanContext,
  env: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const ctx = span instanceof Span ? span.context : span;
  const out: NodeJS.ProcessEnv = { ...env, TRACEPARENT: formatTraceparent(ctx) };
  if (ctx.traceState) out.TRACESTATE = ctx.traceState;
  return out;
}

/**
 * The HTTP headers an HTTP lifecycle hook (FR-057) should carry so the receiving
 * system joins the trace. Returns lowercase W3C header names (`traceparent`,
 * `tracestate`).
 */
export function traceparentHeaders(span: Span | SpanContext): Record<string, string> {
  const ctx = span instanceof Span ? span.context : span;
  const headers: Record<string, string> = { traceparent: formatTraceparent(ctx) };
  if (ctx.traceState) headers.tracestate = ctx.traceState;
  return headers;
}

/**
 * Read an inbound trace context from a child/hook-style environment (the inverse of
 * `injectTraceparentEnv`), so a spawned Lisa continues a caller's trace.
 */
export function traceContextFromEnv(env: NodeJS.ProcessEnv = process.env): SpanContext | undefined {
  return parseTraceparent(env.TRACEPARENT, env.TRACESTATE);
}
