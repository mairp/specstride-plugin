/**
 * T034 — the warnings of a sink (F128-FR-025).
 *
 * F128-FR-025: *The warnings of a sink MUST be lines on standard error that
 * start with the logical component name of the sink, `telemetry-loki` or
 * `telemetry-otlp`, and a colon and a space. The messages MUST be:
 * `Loki push HTTP <status>`, `Loki push failed HTTP <code> <first 200
 * characters of the body>`, `Loki push error: <exception>`, `OTLP push HTTP
 * <status> to <url>`, `OTLP push failed HTTP <code> <first 200 characters>`,
 * `OTLP push error: <exception>`, `trace spans disabled (<error>)` when span
 * derivation cannot start (the logs and the metrics MUST still ship),
 * `trace span error: <error>` when a span cannot be derived (the log record
 * MUST still be buffered), `event mode needs --event NAME` in the as-is form
 * when an event has no name, and `fatal (ignored): <error>` for an unexpected
 * error. The excerpt of a response body and the text of an exception MUST
 * pass the redaction point and the cut to their size before they are
 * printed.*
 *
 * The module RETURNS lines; it prints nothing (standard error is the caller's
 * channel — F128-FR-024, and the exporter itself prints nothing on standard
 * output). The excerpt always passes the redaction point FIRST and is cut to
 * its size SECOND, so a redaction can never be cut in half.
 */

/** The logical component name of the Loki sink (N-15). */
export const LOKI_COMPONENT = "telemetry-loki" as const;
/** The logical component name of the OTLP exporter (N-15). */
export const OTLP_COMPONENT = "telemetry-otlp" as const;

/** The logical component name of a sink label. */
export function componentOf(sink: "loki" | "otlp"): string {
  return sink === "loki" ? LOKI_COMPONENT : OTLP_COMPONENT;
}

/** One warning line: `<component>: <message>` — the caller prints it. */
export function warningLine(component: string, message: string): string {
  return `${component}: ${message}`;
}

/** The size of the excerpt of a response body, in characters. */
export const WARNING_EXCERPT_MAX = 200 as const;

/** The redaction point a text passes before it is cut: text in, redacted text out. */
export type RedactPoint = (text: string) => string;

/**
 * The excerpt of a body: REDACTION FIRST, then the cut to its size. A text
 * that the redaction point emptied stays empty.
 */
export function redactedExcerpt(
  text: string,
  redact: RedactPoint,
  max: number = WARNING_EXCERPT_MAX,
): string {
  const redacted = redact(text ?? "");
  return redacted.length > max ? redacted.slice(0, max) : redacted;
}

/* ------------------------------------------------------------- Loki --- */

/** `Loki push HTTP <status>` — a rejection with a status the sink does not take. */
export function lokiHttpStatus(status: number): string {
  return `Loki push HTTP ${String(status)}`;
}

/** `Loki push failed HTTP <code> <first 200 characters of the body>` — redacted, then cut. */
export function lokiHttpFailed(code: number, body: string, redact: RedactPoint): string {
  return `Loki push failed HTTP ${String(code)} ${redactedExcerpt(body, redact)}`;
}

/** `Loki push error: <exception>` — the text of the exception passes the redaction point. */
export function lokiError(exception: unknown, redact: RedactPoint): string {
  const message = exception instanceof Error ? exception.message : String(exception);
  return `Loki push error: ${redactedExcerpt(message, redact)}`;
}

/* -------------------------------------------------------------- OTLP --- */

/** `OTLP push HTTP <status> to <url>` — the address carries no credential. */
export function otlpHttpStatus(status: number, url: string): string {
  return `OTLP push HTTP ${String(status)} to ${url}`;
}

/** `OTLP push failed HTTP <code> <first 200 characters>` — redacted, then cut. */
export function otlpHttpFailed(code: number, body: string, redact: RedactPoint): string {
  return `OTLP push failed HTTP ${String(code)} ${redactedExcerpt(body, redact)}`;
}

/** `OTLP push error: <exception>` — the text of the exception passes the redaction point. */
export function otlpError(exception: unknown, redact: RedactPoint): string {
  const message = exception instanceof Error ? exception.message : String(exception);
  return `OTLP push error: ${redactedExcerpt(message, redact)}`;
}

/* ------------------------------------------------------- span events --- */

/**
 * `trace spans disabled (<error>)` — span derivation cannot start. THE LOGS
 * AND THE METRICS MUST STILL SHIP: the caller keeps going, the warning is the
 * whole effect.
 */
export function traceSpansDisabled(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `trace spans disabled (${message})`;
}

/**
 * `trace span error: <error>` — one span cannot be derived. THE LOG RECORD
 * MUST STILL BE BUFFERED: the warning replaces nothing, it accompanies.
 */
export function traceSpanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `trace span error: ${message}`;
}

/** What a span failure changes about shipping: nothing. */
export const A_SPAN_FAILURE_STILL_SHIPS_LOGS_AND_METRICS = true as const;
export const A_SPAN_FAILURE_STILL_BUFFERS_THE_LOG_RECORD = true as const;

/* ------------------------------------------------------------ as-is --- */

/** `event mode needs --event NAME` — the as-is form, an event without a name. */
export const EVENT_MODE_NEEDS_NAME = "event mode needs --event NAME" as const;

/** `fatal (ignored): <error>` — an unexpected error, swallowed. */
export function fatalIgnored(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `fatal (ignored): ${message}`;
}

/**
 * One prefixed warning of a sink, from the sink's label and the message. The
 * convenience the sinks call: the line is RETURNED, the caller prints it on
 * standard error and nothing else is printed anywhere.
 */
export function sinkWarning(sink: "loki" | "otlp", message: string): string {
  return warningLine(componentOf(sink), message);
}
