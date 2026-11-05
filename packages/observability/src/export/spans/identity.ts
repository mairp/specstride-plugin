/**
 * T057 — the trace identity of a run and the traces switch
 * (F128-FR-017; C-187; B-0063; B-2336; B-2337; B-2339; B-2369; B-2370).
 *
 * F128-FR-017: *The trace of a run MUST have one trace id for every launch of
 * the run. An inbound `SPECSTRIDE_TRACE_ID` of 32 hexadecimal characters,
 * dashes ignored and not all zeros, MUST be that id and MUST take precedence
 * over the trace id of an event. Otherwise the id MUST be the first 32
 * hexadecimal characters of the SHA-256 hash of `specstride:` followed by the
 * run id, so that every process of one run lands in one trace. A span id MUST
 * be 8 random bytes written as 16 hexadecimal characters. Span derivation and
 * the correlation of logs with traces MUST be switched off by
 * `telemetry.otel.traces` set to false, `0`, `no` or `off` in any case, and
 * MUST be on by default when the OTLP exporter is on. With no run id, no span
 * MUST be produced.*
 */

import { createHash, randomBytes } from "node:crypto";

/** The resolved key the traces switch is read from (F128-FR-017). */
export const TRACES_SWITCH_KEY = "telemetry.otel.traces" as const;

/** The environment alias of the inbound trace id (B-0063, B-2337). */
export const INBOUND_TRACE_ID_ENV = "SPECSTRIDE_TRACE_ID" as const;

/** A well-formed trace id: 32 lowercase hexadecimal characters. */
export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
/** A well-formed span id: 16 lowercase hexadecimal characters. */
export const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

/**
 * The inbound trace id, normalized: dashes ignored (removed), lowercased, and
 * accepted only when the 32 remaining characters are hexadecimal and the id is
 * not all zeros. Anything else — a malformed id, a short id, an all-zero id —
 * answers `null` and never invented (B-0063: passed through untouched, never
 * synthesised; B-2337).
 */
export function normalizeInboundTraceId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.replaceAll("-", "").toLowerCase();
  if (!TRACE_ID_PATTERN.test(id)) return null;
  if (id === ALL_ZERO_TRACE_ID) return null;
  return id;
}

/**
 * The derived trace id of a run (B-2369): the first 32 hexadecimal characters
 * of the SHA-256 hash of `specstride:` followed by the run id.
 */
export function traceIdFromRunId(runId: string): string {
  return createHash("sha256").update(`specstride:${runId}`).digest("hex").slice(0, 32);
}

/**
 * The trace id in force (F128-FR-017): the inbound id when it is
 * well-formed (it takes precedence over the trace id of an event), else the
 * derivation from the run id. With no run id (and no usable inbound id, which
 * still needs a run to belong to) `null` — **no run id, no span** (B-2339).
 */
export function traceIdOf(options: {
  readonly runId: string | null | undefined;
  readonly inboundTraceId?: string | null | undefined;
  readonly eventTraceId?: string | null | undefined;
}): string | null {
  const runId = options.runId;
  if (typeof runId !== "string" || runId.length === 0) return null;
  const inbound = normalizeInboundTraceId(options.inboundTraceId);
  if (inbound !== null) return inbound;
  // The trace id of an event never takes precedence over the derivation; it is
  // accepted only when the derivation cannot be made (kept for a tap event that
  // carries one and no run id of its own). The derivation needs only the run
  // id, so in practice the derived id answers.
  void options.eventTraceId;
  return traceIdFromRunId(runId);
}

/** A fresh span id: 8 random bytes as 16 hex characters, never all zeros (B-2370). */
export function newSpanId(rng: (n: number) => Buffer = randomBytes): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = rng(8).toString("hex");
    if (id !== ALL_ZERO_SPAN_ID) return id;
  }
  // A source that answers nothing but zeros: mix the clock in, so the id is
  // never all zeros even then.
  const mixed = Buffer.concat([rng(4), Buffer.from(Date.now().toString(16))])
    .subarray(0, 8)
    .toString("hex")
    .padEnd(16, "1")
    .slice(0, 16);
  return mixed === ALL_ZERO_SPAN_ID ? "0000000000000001" : mixed;
}

/**
 * The traces switch (B-2336): `false`, `0`, `no` or `off` in any case switches
 * span derivation and the correlation of logs with traces off; everything else
 * — including `undefined`, the default — leaves them on when the exporter is on.
 */
export function tracesSwitchOn(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
  }
  return value !== false && value !== 0;
}
