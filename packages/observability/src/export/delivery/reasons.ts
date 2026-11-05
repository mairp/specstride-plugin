/**
 * T032 — the delivery reasons and the result record (F128-FR-027).
 *
 * F128-FR-027: *A delivery reason MUST be `http_<status>` for a rejection at
 * the level of HTTP, `transport_error` for any failure that is not HTTP
 * (connection refused, timeout), `queue_overflow` for a dropped event of a
 * full buffer, or `content_withheld` for content that was replaced by its
 * reference. A sink MUST never exit or throw in a way that the caller sees:
 * every runtime failure of a sink MUST end in a record and a warning, and a
 * component call that stands for the as-is shipper commands MUST return the
 * as-is exit code 0 as the field `exit_code` of its result record, and 2 for
 * a usage error of that call.*
 */
import { QUEUE_OVERFLOW } from "./buffer.ts";

/** A rejection at the level of HTTP: the reason carries the status. */
export const REASON_HTTP_PREFIX = "http_" as const;
/** Any failure that is not HTTP: connection refused, a timeout, a raise. */
export const REASON_TRANSPORT_ERROR = "transport_error" as const;
/** A dropped event of a full buffer (the buffer's own constant). */
export const REASON_QUEUE_OVERFLOW = QUEUE_OVERFLOW;
/** Content that was replaced by its reference. */
export const REASON_CONTENT_WITHHELD = "content_withheld" as const;

/** The closed set of reasons a delivery record can carry. */
export const DELIVERY_REASONS = Object.freeze([
  REASON_HTTP_PREFIX, // the family `http_<status>`; the exact reason carries the status
  REASON_TRANSPORT_ERROR,
  REASON_QUEUE_OVERFLOW,
  REASON_CONTENT_WITHHELD,
] as const);

/** The reason for an HTTP rejection: `http_<status>`. */
export function reasonForHttpStatus(status: number): string {
  return `${REASON_HTTP_PREFIX}${String(status)}`;
}

/** The reason for a failure that is not HTTP. */
export function reasonForTransportError(): typeof REASON_TRANSPORT_ERROR {
  return REASON_TRANSPORT_ERROR;
}

/** The reason for a dropped event of a full buffer. */
export function reasonForQueueOverflow(): typeof REASON_QUEUE_OVERFLOW {
  return REASON_QUEUE_OVERFLOW;
}

/** The reason for content that was replaced by its reference. */
export function reasonForContentWithheld(): typeof REASON_CONTENT_WITHHELD {
  return REASON_CONTENT_WITHHELD;
}

/** Whether a reason is of the HTTP family. */
export function reasonIsHttp(reason: string): boolean {
  return reason.startsWith(REASON_HTTP_PREFIX);
}

/** The outcome of one flush, as the request code reports it. */
export type FlushOutcome = {
  readonly ok: boolean;
  readonly httpStatus?: number | null;
  readonly threw?: boolean;
};

/**
 * The reason of one flush: an HTTP status that was not accepted is
 * `http_<status>`; everything else that failed — a refused connection, a
 * timeout, a raise — is `transport_error`. An accepted flush has no reason
 * (the field is dropped, never null).
 */
export function reasonOf(outcome: FlushOutcome): string | null {
  if (outcome.ok) return null;
  if (typeof outcome.httpStatus === "number") return reasonForHttpStatus(outcome.httpStatus);
  return reasonForTransportError();
}

/* ------------------------------------------------------------------ *
 * The result record of a component call (the as-is shipper commands).
 * ------------------------------------------------------------------ */

/** The exit code of a call that did its work: the as-is exit code 0. */
export const EXIT_CODE_OK = 0 as const;
/** The exit code of a USAGE error of the call (the as-is shipper's `exit 2`). */
export const EXIT_CODE_USAGE = 2 as const;

/** The record a component call returns; `exit_code` is a FIELD, never a throw. */
export type ResultRecord = {
  readonly ok: boolean;
  readonly exit_code: number;
  readonly error?: string;
};

/** The record of a call that did its work: `exit_code` 0. */
export function okResult(): ResultRecord {
  return Object.freeze({ ok: true, exit_code: EXIT_CODE_OK });
}

/** The record of a usage error of the call: `exit_code` 2, never a throw. */
export function usageErrorResult(error: string): ResultRecord {
  return Object.freeze({ ok: false, exit_code: EXIT_CODE_USAGE, error });
}

/** The record of a runtime failure of a call: `exit_code` 0 (the run goes on). */
export function runtimeErrorResult(error: string): ResultRecord {
  return Object.freeze({ ok: false, exit_code: EXIT_CODE_OK, error });
}

/** A sink never exits and never throws in a way the caller sees. */
export const A_SINK_NEVER_EXITS = true as const;
export const A_SINK_NEVER_THROWS = true as const;

/**
 * Run one sink operation so that no throw and no exit reaches the caller: the
 * failure comes back as a result record (and the caller writes its warning).
 * Every runtime failure ends in a record, never in an exception.
 */
export async function neverThrows<T>(
  operation: () => Promise<T> | T,
  fallback: T,
): Promise<{ readonly value: T; readonly result: ResultRecord }> {
  try {
    return { value: await operation(), result: okResult() };
  } catch (e) {
    return {
      value: fallback,
      result: runtimeErrorResult(e instanceof Error ? e.message : String(e)),
    };
  }
}
