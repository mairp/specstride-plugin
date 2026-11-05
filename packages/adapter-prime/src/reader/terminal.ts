/**
 * The terminal and the provider errors of the JSONL reader (T035; covers
 * F138-FR-032, F138-FR-033 and F138-FR-034).
 *
 * A provider error gives a diagnostic of severity `error` whose code is
 * `provider_auth` when the message matches, in any case, `auth`,
 * `authentication`, `authorization`, `credential` or `api key` (the
 * separator of the last one being a space, `_`, `-` or none), and
 * `provider_error` otherwise. An error recorded before the end of the agent
 * is held and exposed as the terminal only at the end of the stream, and
 * only when the end of the agent delivered none; a terminal the end of the
 * agent delivers, success or error, replaces it. The start of an internal
 * retry gives a `provider_retry` warning; the end of a retry gives nothing.
 */
import type { DialectRow } from "./dialect.ts";
import {
  cleanFields,
  displayLineForDiagnostic,
  sanitizeText,
  type ReaderRedactor,
} from "./display.ts";
import { usageFields, type UsageState } from "./usage.ts";

/** The words that make a provider error an authentication failure. */
export const AUTH_MARKERS = /auth(?:entication|orization)?|credential|api[ _-]?key/gi;

/** True where the message names authentication, in any case. */
export function isAuthMessage(message: string): boolean {
  AUTH_MARKERS.lastIndex = 0;
  return AUTH_MARKERS.test(message);
}

/** The default messages the requirement names (F138-FR-032). */
export const DEFAULT_ERROR_MESSAGE = "Prime reported an error";
export const MESSAGE_END_ERROR_DEFAULT = "Prime message ended with an error";

/** The statuses of the end of the agent that mean an error. */
export const ERROR_STATUSES = new Set(["error", "failed", "failure"]);

/** The statuses of the end of the agent that mean success. */
export const SUCCESS_STATUSES = new Set(["success", "completed", "complete", "ok"]);

/** The codes of the provider errors. */
export type ProviderErrorCode = "provider_auth" | "provider_error";

/** The code for one provider-error message. */
export function providerErrorCodeOf(message: string): ProviderErrorCode {
  return isAuthMessage(message) ? "provider_auth" : "provider_error";
}

/** A diagnostic the reader gives, with the fields of F138-FR-036. */
export type DiagnosticSink = {
  code: string;
  severity: "error" | "warning";
  message: string;
  providerRecordType: string | null;
  extras: Record<string, unknown>;
};

/** What the caller of the terminal module supplies, to record an error. */
export type DiagnosticEmitter = (
  diagnostic: DiagnosticSink,
  fields: Record<string, unknown>,
  displayLine: string,
) => void;

/** Record one provider error: the diagnostic, and the held terminal. */
export function recordProviderError(options: {
  message: unknown;
  stopReason: unknown;
  providerRecordType: string;
  usage: UsageState;
  turns: number;
  row: DialectRow;
  redactor: ReaderRedactor | null;
  emit: DiagnosticEmitter;
  setTerminal: (terminal: Record<string, unknown>) => void;
}): void {
  const code = providerErrorCodeOf(String(options.message ?? ""));
  const safe = sanitizeText(String(options.message ?? ""), 1024, options.redactor);
  const fields = cleanFields({
    code,
    severity: "error",
    message: safe.value,
    provider_record_type: options.providerRecordType,
    redacted: safe.redacted,
    truncated: safe.truncated,
    original_bytes: safe.originalBytes,
    retained_bytes: safe.retainedBytes,
  });
  options.emit(
    {
      code,
      severity: "error",
      message: safe.value,
      providerRecordType: options.providerRecordType,
      extras: {},
    },
    fields,
    displayLineForDiagnostic(code, safe.value),
  );
  options.setTerminal({
    status: "error",
    reason_code: code,
    reason: String(options.message ?? ""),
    stop_reason: options.stopReason ? options.stopReason : "error",
    ...usageFields(options.usage, options.turns),
  });
}

/** The retry diagnostic the start of an internal retry gives (F138-FR-034). */
export function recordProviderRetry(options: {
  record: Record<string, unknown>;
  providerRecordType: string;
  redactor: ReaderRedactor | null;
  emit: DiagnosticEmitter;
}): void {
  const message = options.record["reason"] ?? "Prime started an internal retry";
  const safe = sanitizeText(String(message ?? ""), 1024, options.redactor);
  const fields = cleanFields({
    code: "provider_retry",
    severity: "warning",
    message: safe.value,
    provider_record_type: options.providerRecordType,
    redacted: safe.redacted,
    truncated: safe.truncated,
    original_bytes: safe.originalBytes,
    retained_bytes: safe.retainedBytes,
    attempt: options.record["attempt"] ?? null,
    delay_ms: options.record["delayMs"] ?? null,
  });
  options.emit(
    {
      code: "provider_retry",
      severity: "warning",
      message: safe.value,
      providerRecordType: options.providerRecordType,
      extras: {
        attempt: options.record["attempt"] ?? null,
        delay_ms: options.record["delayMs"] ?? null,
      },
    },
    fields,
    displayLineForDiagnostic("provider_retry", safe.value),
  );
}

/** The error message an `agent_end` record carries, under either shape. */
export function agentEndErrorMessage(record: Record<string, unknown>): string | null {
  const error = record["error"];
  if (error !== null && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string" && message.length > 0) return message;
  }
  const flat =
    typeof error === "string" && error.length > 0
      ? error
      : typeof record["errorMessage"] === "string"
        ? (record["errorMessage"] as string)
        : null;
  return flat && flat.length > 0 ? flat : null;
}

/** The success terminal the end of the agent gives (F138-FR-033). */
export function successTerminal(options: {
  stopReason: unknown;
  model: string | null;
  usage: UsageState;
  turns: number;
}): Record<string, unknown> {
  return {
    status: "success",
    stop_reason: options.stopReason ?? null,
    model: options.model,
    ...usageFields(options.usage, options.turns),
  };
}
