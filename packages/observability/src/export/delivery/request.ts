/**
 * T012 — the request code and the batch splitter of the exporter
 * (F128-FR-010).
 *
 * F128-FR-010: *A request to a collector MUST have a time limit, default 2500
 * milliseconds. The body of a Loki push and of an OTLP logs request MUST be
 * bounded, default 3145728 bytes; a larger batch MUST be split into several
 * ordered requests. Metrics and traces requests MUST be sent unsplit. The
 * flush interval MUST be `telemetry.flush.intervalMs`, default 2000; the
 * value 0 MUST flush at every event, one event to one request. ... The as-is
 * names `RALPH_LOKI_TIMEOUT`, `RALPH_OTEL_TIMEOUT` (seconds, decimal,
 * converted to milliseconds), `RALPH_LOKI_MAX_BATCH_BYTES` and
 * `RALPH_OTEL_MAX_BATCH_BYTES` MUST stay as aliases of the four keys through
 * §K.8 of feature 110. `close` MUST flush once, bounded by the time limit.*
 *
 * Every POST is best-effort (F128-FR-035, Lisa's contract): a failure warns
 * and reports, never throws into the caller.
 */

/** The default time limit of one request (ms). */
export const DEFAULT_TIMEOUT_MS = 2500 as const;
/** The default bound of a Loki push and an OTLP logs body (bytes). */
export const DEFAULT_MAX_BATCH_BYTES = 3145728 as const;
/** The default flush interval (ms); 0 flushes at every event. */
export const DEFAULT_FLUSH_INTERVAL_MS = 2000 as const;

/**
 * The six `RALPH_*` as-is aliases of §K.8 of feature 110 (F128-FR-010, rows
 * 97–104 of annex X §X.7): the two URLs, and the two time limits and the two
 * body bounds, which the environment carried in DECIMAL SECONDS and bytes.
 */
export const RALPH_ALIASES = Object.freeze({
  "telemetry.loki.url": "RALPH_LOKI_URL",
  "telemetry.otel.url": "RALPH_OTEL_URL",
  "telemetry.loki.timeoutMs": "RALPH_LOKI_TIMEOUT",
  "telemetry.otel.timeoutMs": "RALPH_OTEL_TIMEOUT",
  "telemetry.loki.maxBatchBytes": "RALPH_LOKI_MAX_BATCH_BYTES",
  "telemetry.otel.maxBatchBytes": "RALPH_OTEL_MAX_BATCH_BYTES",
} as const);

/**
 * The two aliases the environment carried in decimal SECONDS: the value is
 * converted to milliseconds (`RALPH_LOKI_TIMEOUT=2.5` is 2500 ms).
 */
export const RALPH_SECOND_ALIASES: readonly string[] = Object.freeze([
  RALPH_ALIASES["telemetry.loki.timeoutMs"],
  RALPH_ALIASES["telemetry.otel.timeoutMs"],
]);

/** Decimal seconds → milliseconds, as the as-is aliases carried them. */
export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * Resolve the time limit: the direct value wins, then the `RALPH_*` alias
 * (decimal seconds, converted), then the default. A value that is not a
 * finite positive number falls back to the next source — the alias never
 * breaks the run.
 */
export function resolveTimeoutMs(
  direct: number | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  alias: string = RALPH_ALIASES["telemetry.loki.timeoutMs"],
): number {
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const raw = env[alias];
  if (raw !== undefined && raw.trim() !== "") {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return secondsToMs(seconds);
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve the body bound: the direct value wins, then the `RALPH_*` alias
 * (bytes), then the default.
 */
export function resolveMaxBatchBytes(
  direct: number | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  alias: string = RALPH_ALIASES["telemetry.loki.maxBatchBytes"],
): number {
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const raw = env[alias];
  if (raw !== undefined && raw.trim() !== "") {
    const bytes = Number(raw);
    if (Number.isFinite(bytes) && bytes > 0) return Math.trunc(bytes);
  }
  return DEFAULT_MAX_BATCH_BYTES;
}

/**
 * One signal of the exporter, for the split rule: a Loki push and an OTLP
 * logs request are split when the body would exceed the bound; metrics and
 * traces requests are sent UNSPLIT (F128-FR-010).
 */
export type SplitSignal = "loki" | "logs" | "metrics" | "traces";
export const UNSPLIT_SIGNALS: readonly SplitSignal[] = Object.freeze(["metrics", "traces"]);
export function signalIsSplit(signal: SplitSignal): boolean {
  return !UNSPLIT_SIGNALS.includes(signal);
}

/** One ordered request the splitter produced. */
export type BatchPart<T> = {
  /** 0-based, in the order of the batch. */
  readonly index: number;
  readonly items: readonly T[];
  readonly bytes: number;
};

/**
 * Split a batch into ordered requests whose serialized body stays within the
 * bound. One item larger than the bound alone still ships, as its own request
 * (a split never drops an event). Items keep their order across the parts.
 */
export function splitBatch<T>(
  items: readonly T[],
  maxBytes: number,
  sizeOf: (item: T) => number,
): readonly BatchPart<T>[] {
  const parts: BatchPart<T>[] = [];
  let current: T[] = [];
  let bytes = 2; // the surrounding JSON skeleton
  for (const item of items) {
    const size = sizeOf(item);
    if (current.length > 0 && bytes + size > maxBytes) {
      parts.push(Object.freeze({ index: parts.length, items: Object.freeze(current), bytes }));
      current = [];
      bytes = 2;
    }
    current.push(item);
    bytes += size + 1; // the separator
  }
  if (current.length > 0 || parts.length === 0) {
    parts.push(Object.freeze({ index: parts.length, items: Object.freeze(current), bytes }));
  }
  return Object.freeze(parts);
}

/** The outcome of one POST, best-effort (Lisa's `ForwardResult`). */
export type RequestResult = {
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
};

/**
 * POST one JSON body with the time limit. Best-effort: any failure — an
 * exception, an abort, a status outside the accepted set — comes back as a
 * result, never as a throw. Accepted statuses: 200, 202 and 204.
 */
export async function postJson(
  url: string,
  body: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  warn: (message: string) => void = () => {},
): Promise<RequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 202 && response.status !== 204) {
      warn(`telemetry: POST ${url} answered HTTP ${String(response.status)}`);
      return { ok: false, status: response.status };
    }
    return { ok: true, status: response.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    warn(`telemetry: POST ${url} failed: ${message}`);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
