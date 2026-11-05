/**
 * T042 — the Loki sink (F128-FR-020).
 *
 * F128-FR-020: *The Loki sink MUST push to `<base without trailing
 * slash>/loki/api/v1/push` with `POST` and `Content-Type: application/json`,
 * in the shape `{"streams": [{"stream": {labels}, "values": [["<ns>", "<logfmt
 * line>"], ...]}]}`. A push MUST count as accepted only on HTTP 200 or 204.
 * The entry time MUST be the clock of the sink in nanoseconds, as a string, in
 * the as-is form, and the `ts` of the event in the new form. After a flush the
 * buffered streams MUST be cleared even when the push failed.*
 *
 * The wire is built here; the sink of `src/export/index.ts` buffers on
 * `write`, posts on `flush` through the request code of
 * `delivery/request.ts` (which never retries) and hands this module the
 * buffered entries. Nothing here throws into the run: a failed push is one
 * warning on standard error, and nothing is kept for later.
 */

/** The push path of the Loki HTTP API. */
export const LOKI_PUSH_PATH = "/loki/api/v1/push" as const;

/** The statuses a Loki push counts as accepted, and only they. */
export const LOKI_ACCEPTED_STATUSES: readonly number[] = Object.freeze([200, 204]);

/** The push address of the Loki sink: the base without a trailing slash + the path. */
export function lokiPushUrlOf(base: string): string {
  return `${base.replace(/\/+$/, "")}${LOKI_PUSH_PATH}`;
}

/** Whether a push with this HTTP status counts as accepted (200 or 204 only). */
export function isLokiAccepted(status: number): boolean {
  return LOKI_ACCEPTED_STATUSES.includes(status);
}

/** One Loki stream: its full label set and its `[nanoseconds, logfmt line]` values. */
export type LokiStreamWire = {
  readonly stream: Record<string, string>;
  readonly values: readonly (readonly [string, string])[];
};

/** The `/loki/api/v1/push` request body, as the wire carries it. */
export type LokiPushPayload = { streams: LokiStreamWire[] };

/** One buffered entry the sink hands this module: the line and its entry time. */
export type LokiEntry = {
  /** The logfmt line — the same string the OTLP log body carries (F128-FR-022). */
  readonly line: string;
  /** The entry time in nanoseconds, as a string. */
  readonly timeNanos: string;
};

/** The push payload over buffered entries of ONE label set (one stream). */
export function lokiStreamOf(
  labels: Record<string, string>,
  entries: readonly LokiEntry[],
): LokiStreamWire {
  return {
    stream: { ...labels },
    values: entries.map((entry) => [entry.timeNanos, entry.line] as const),
  };
}

/** The request body of a payload: `{"streams":[…]}`, `Content-Type: application/json`. */
export function lokiPushBodyOf(payload: LokiPushPayload): string {
  return JSON.stringify({
    streams: payload.streams.map((s) => ({
      stream: s.stream,
      values: s.values.map(([ns, line]) => [ns, line]),
    })),
  });
}

/** The content type of a Loki push. */
export const LOKI_CONTENT_TYPE = "application/json" as const;

/**
 * What a failed push keeps for later: NOTHING (F128-FR-020). The buffer is
 * cleared even when the push failed; nothing is retried.
 */
export const BUFFER_CLEARED_EVEN_WHEN_THE_PUSH_FAILED = true as const;
