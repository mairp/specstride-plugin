/**
 * T030 — reconciliation: the reason code and the status of one invocation,
 * in the precedence of F126-FR-033 (origins C-164 B-2166 to B-2178; C-162
 * B-2163, B-2164).
 *
 * The precedence is fixed, and it is the only place the outcome of an
 * invocation is decided: timeout, cancelled, launch failed, producer
 * signaled, producer nonzero, status conflict, parser failed, unsupported
 * schema, malformed stream, the provider's own error, a missing terminal,
 * and success last. The finalization never passes `cancelled` or
 * `unsupported_schema` in, so those statuses cannot appear in a result it
 * writes (B-2163).
 */
import { producerFieldsOfExit } from "./producer.ts";
import type { ProducerFields } from "./writers.ts";

/** The reason texts of the precedence (F126-FR-033, B-2166 to B-2178). */
export const REASON_TEXTS = {
  timeout: "Invocation timed out",
  cancelled: "Invocation was cancelled",
  launch_failed: "Provider process could not be launched",
  producer_signaled: "Provider process terminated by signal",
  producer_nonzero: "Provider process exited nonzero",
  status_conflict: "Provider and process terminal observations conflict",
  parser_failed: "Provider stream parser failed",
  malformed_stream: "Provider stream was malformed or truncated",
  provider_error: "Provider reported an error",
  provider_auth: "Provider authentication failed",
  missing_terminal: "Provider stream ended without a terminal observation",
} as const;

/** The default text of a provider-reported code that carries none. */
export const PROVIDER_AUTH_DEFAULT_TEXT = REASON_TEXTS.provider_auth;

/** The terminal a provider reported, as the sidecar of the pass holds it. */
export type ProviderTerminalObservation = {
  readonly status: "success" | "error";
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly stopReason: string | null;
  /** Any other non-null key of the sidecar record, copied onto the result. */
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
};

/** The observation of one invocation the reconciliation reconciles. */
export type ReconciliationInput = {
  /** The producer fields, as the controller observed them (F126-FR-030). */
  readonly producer: ProducerFields;
  /** The provider terminal record, or null where the sidecar is absent. */
  readonly providerTerminal: ProviderTerminalObservation | null;
  /** True where the tap flagged a malformed or truncated stream. */
  readonly malformedStream: boolean;
  /**
   * True where the caller says the schema is unsupported: the only way the
   * status `degraded` arises (B-2174). The finalization never passes it.
   */
  readonly unsupportedSchema?: boolean | undefined;
  /**
   * A cancellation handed in by the controller: the only way the status
   * `cancelled` arises (B-2168). The finalization never passes it.
   */
  readonly cancelled?: boolean | undefined;
  /** The provider status (the HTTP status), where the terminal carries one. */
  readonly providerStatus?: number | string | null | undefined;
};

/** The outcome of the reconciliation: the status, the code and the text. */
export type Reconciliation = {
  readonly status: "success" | "error" | "timeout" | "cancelled" | "degraded";
  readonly reason_code: string;
  readonly reason: string;
  readonly provider_stop_reason: string | null;
};

/** True where the provider terminal claims success (B-2177, B-2178). */
function terminalIsSuccess(terminal: ProviderTerminalObservation | null): boolean {
  return terminal !== null && terminal.status === "success";
}

/**
 * Reconcile one invocation (F126-FR-033). The checks run in the fixed
 * precedence; the first that applies decides.
 */
export function reconcileInvocation(input: ReconciliationInput): Reconciliation {
  const producer = input.producer;
  const terminal = input.providerTerminal;
  const stopReason = terminal?.stopReason ?? null;

  // (1) timeout — highest precedence (B-2167).
  if (producer.timed_out) {
    return {
      status: "timeout",
      reason_code: "timeout",
      reason: REASON_TEXTS.timeout,
      provider_stop_reason: stopReason,
    };
  }
  // (2) cancelled (B-2168); never passed by the finalization (B-2163).
  if (input.cancelled === true) {
    return {
      status: "cancelled",
      reason_code: "cancelled",
      reason: REASON_TEXTS.cancelled,
      provider_stop_reason: stopReason,
    };
  }
  // (3) launch failed (B-2169).
  if (producer.launch_failed) {
    return {
      status: "error",
      reason_code: "launch_failed",
      reason: REASON_TEXTS.launch_failed,
      provider_stop_reason: stopReason,
    };
  }
  // (4) the producer ended by a signal (B-2170).
  if (producer.producer_signal !== null) {
    return {
      status: "error",
      reason_code: "producer_signaled",
      reason: REASON_TEXTS.producer_signaled,
      provider_stop_reason: stopReason,
    };
  }
  const producerExit = producer.producer_exit_code;
  const nonZeroExit = producerExit !== null && producerExit !== 0;
  const providerClaimedSuccess = terminalIsSuccess(terminal);
  // (5) the exit is non-zero and the provider did not claim success (B-2171).
  if (nonZeroExit && !providerClaimedSuccess) {
    return {
      status: "error",
      reason_code: "producer_nonzero",
      reason: REASON_TEXTS.producer_nonzero,
      provider_stop_reason: stopReason,
    };
  }
  // (6) the provider said success and the exit is non-zero (B-2172).
  if (nonZeroExit && providerClaimedSuccess) {
    return {
      status: "error",
      reason_code: "status_conflict",
      reason: REASON_TEXTS.status_conflict,
      provider_stop_reason: stopReason,
    };
  }
  // (7) the parser exit is non-zero (B-2173).
  if (producer.parser_exit_code !== null && producer.parser_exit_code !== 0) {
    return {
      status: "error",
      reason_code: "parser_failed",
      reason: REASON_TEXTS.parser_failed,
      provider_stop_reason: stopReason,
    };
  }
  // (8) unsupported schema, when the caller says so (B-2174).
  if (input.unsupportedSchema === true) {
    return {
      status: "degraded",
      reason_code: "unsupported_schema",
      reason: REASON_TEXTS.provider_error,
      provider_stop_reason: stopReason,
    };
  }
  // (9) the stream was malformed or truncated (B-2175).
  if (input.malformedStream) {
    return {
      status: "error",
      reason_code: "malformed_stream",
      reason: REASON_TEXTS.malformed_stream,
      provider_stop_reason: stopReason,
    };
  }
  // (10) the error the provider reported, default `provider_error` (B-2166,
  // B-2176).
  if (terminal !== null && terminal.status === "error") {
    const code = terminal.reasonCode ?? "provider_error";
    const text =
      terminal.reason ??
      (code === "provider_auth" ? PROVIDER_AUTH_DEFAULT_TEXT : REASON_TEXTS.provider_error);
    return { status: "error", reason_code: code, reason: text, provider_stop_reason: stopReason };
  }
  // (11) the terminal is absent, or not success, or success without both
  // exits exactly 0 (B-2177).
  const bothZero = producerExit === 0 && producer.parser_exit_code === 0;
  if (!providerClaimedSuccess || !bothZero) {
    return {
      status: "error",
      reason_code: "missing_terminal",
      reason: REASON_TEXTS.missing_terminal,
      provider_stop_reason: stopReason,
    };
  }
  // (12) success, only when the terminal is success and both exits are 0
  // (B-2178).
  return {
    status: "success",
    reason_code: "success",
    reason: "",
    provider_stop_reason: stopReason,
  };
}

/* ------------------------------------------------------------------ *
 * The kill reason and its class (F126-FR-034, B-2161, B-0783).
 * ------------------------------------------------------------------ */

/**
 * The classes a kill reason may take. The as-is reasons map onto them: hard
 * cap to budget; repeat stall and progress stall to futility; idle timeout
 * to hang. A kill reason handed in by the controller is carried in, because
 * a kill severs the stream and no artifact can name it (B-0783).
 */
export const CLASS_OF_KILL_REASON: Readonly<Record<string, string>> = Object.freeze({
  hard_cap: "budget",
  idle_timeout: "hang",
  repeat_stall: "futility",
  progress_stall: "futility",
});

/**
 * The class of a kill reason, or null where the reason is unclassified or
 * empty: an unclassified or empty reason adds nothing to the result and to
 * the event (B-2161).
 */
export function classifyKillReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  return CLASS_OF_KILL_REASON[trimmed] ?? null;
}

/** Re-export, so a caller needs no second import for the producer mapping. */
export { producerFieldsOfExit };
