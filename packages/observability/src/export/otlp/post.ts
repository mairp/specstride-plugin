/**
 * T048 — the OTLP acceptance rules and the batch verdict (F128-FR-013).
 *
 * F128-FR-013: *An OTLP request MUST count as accepted only on HTTP 200, 202
 * or 204. A batch MUST be marked failed when the logs request or the metrics
 * request fails. The traces request MUST NOT change the verdict of a batch: a
 * collector without a traces pipeline MUST NOT mark the batch failed, and a
 * failed traces request MUST give one warning. Nothing MUST be retried or
 * kept for later: after a flush, whether or not the push succeeded, the
 * buffered logs, sums and histograms MUST be cleared.*
 *
 * The posts go through `delivery/request.ts`, which never retries and never
 * keeps a body for later; this module adds only the acceptance set, the
 * verdict over the three requests and the endpoints.
 */
import { postJson, type RequestResult } from "../delivery/request.ts";
import { reasonOf, reasonForTransportError } from "../delivery/reasons.ts";

/** The endpoints of the exporter, relative to the base address (F128-FR-011). */
export const OTLP_ENDPOINTS = Object.freeze({
  logs: "/v1/logs",
  metrics: "/v1/metrics",
  traces: "/v1/traces",
} as const);

/** The statuses an OTLP request counts as accepted, and only they. */
export const OTLP_ACCEPTED_STATUSES: readonly number[] = Object.freeze([200, 202, 204]);

/** Whether a request with this HTTP status counts as accepted (200/202/204). */
export function isOtlpAccepted(status: number): boolean {
  return OTLP_ACCEPTED_STATUSES.includes(status);
}

/** The address of one endpoint: the base without a trailing slash + the path. */
export function otlpUrlOf(base: string, signal: keyof typeof OTLP_ENDPOINTS): string {
  return `${base.replace(/\/+$/, "")}${OTLP_ENDPOINTS[signal]}`;
}

/** What a failed traces request changes about the batch verdict: NOTHING. */
export const TRACES_NEVER_CHANGE_THE_VERDICT = true as const;

/** What a flush keeps for later: NOTHING (F128-FR-013). */
export const NOTHING_IS_RETRIED_OR_KEPT = true as const;

/** The input of `batchVerdict`: the result of each of the three requests. */
export type BatchRequests = {
  readonly logs?: RequestResult;
  readonly metrics?: RequestResult;
  /** The traces result is recorded but NEVER decides (F128-FR-013). */
  readonly traces?: RequestResult;
};

/** The verdict of one OTLP batch. */
export type BatchVerdict = {
  readonly status: "accepted" | "failed";
  /** The reason, of the closed set of F128-FR-027, when the batch failed. */
  readonly reason: string | null;
  /** Always false: the traces request never changed a verdict here. */
  readonly tracesChangedVerdict: boolean;
};

/**
 * The verdict of one batch: the logs request and the metrics request decide,
 * in that order; the traces request is ignored for the verdict in both of its
 * outcomes — a collector without a traces pipeline leaves the batch accepted.
 */
export function batchVerdict(requests: BatchRequests): BatchVerdict {
  const deciding: [RequestResult | undefined, "logs" | "metrics"][] = [
    [requests.logs, "logs"],
    [requests.metrics, "metrics"],
  ];
  for (const [result] of deciding) {
    if (result !== undefined && !result.ok) {
      return {
        status: "failed",
        reason: reasonOf({
          ok: false,
          httpStatus: result.status,
          threw: result.error !== undefined,
        }),
        tracesChangedVerdict: false,
      };
    }
  }
  return { status: "accepted", reason: null, tracesChangedVerdict: false };
}

/** The reason of a failed request, re-exported for the callers of the verdict. */
export { reasonOf, reasonForTransportError };

/**
 * One OTLP POST: best-effort, never retried, nothing kept for later. The
 * result is returned to the caller; a failure is the caller's warning to
 * print, never an exception into the run.
 */
export function postOtlp(
  url: string,
  body: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
  warn?: (message: string) => void,
): Promise<RequestResult> {
  return postJson(url, body, timeoutMs, fetchImpl, warn);
}
