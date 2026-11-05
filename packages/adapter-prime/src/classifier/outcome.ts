/**
 * The outcome rule (T041; covers F138-FR-038).
 *
 * For a pass and for a critic-class call in JSON mode, the outcome is decided
 * by the terminal record and never by the exit code alone: prime exits 0 even
 * when the model provider returned an error (the recorded stream
 * `stock-auth-error` ends with `fixtureProcessExitCode` 0). A success needs
 * BOTH a success terminal and an exit code of 0 with no signal. An error
 * terminal with exit 0 is a failed call with the reason and class of the
 * terminal. A stream that ends with no terminal record yields the outcome
 * `stream.missing_terminal`, never a success. In text mode there is no
 * terminal, and the exit code and the output decide, as at the baseline.
 */

/** The event name the seam reports for a stream with no terminal record. */
export const MISSING_TERMINAL = "stream.missing_terminal";

/** The reason code written when a success terminal meets a non-zero exit. */
export const REASON_EXIT_NONZERO = "process_exit_nonzero";

/** The reason code written when the pass was ended by a signal. */
export const REASON_SIGNALED = "process_signalled";

/** How the seam saw the process end. */
export type ExitStatus = {
  /** The exit code, or null when the process was ended by a signal. */
  readonly code: number | null;
  /** The signal that ended the process, or null. */
  readonly signal: string | null;
};

/** The classes of provider error the reader writes into a terminal. */
export type TerminalErrorClass = "provider_auth" | "provider_error";

/** What the outcome rule decides for one call. */
export type Outcome = {
  /** True only for a success terminal with exit code 0 and no signal. */
  readonly ok: boolean;
  /** The reason code: of the terminal, of the process, or the missing-terminal event name. */
  readonly reasonCode: string;
  /** The human reason, or null when none is known. */
  readonly reason: string | null;
  /** The class of the provider error of the terminal, or null. */
  readonly providerClass: TerminalErrorClass | null;
  /** True where the stream ended with no terminal record. */
  readonly missingTerminal: boolean;
};

/** What the outcome rule reads off one finished stream. */
export type OutcomeStream = {
  /** The exposed terminal record, or null when the stream held none. */
  readonly terminal: Readonly<Record<string, unknown>> | null;
  /** True where the stream ended without a terminal record (F138-FR-023). */
  readonly missingTerminal: boolean;
};

/** The status the terminal record holds, or null where it holds none. */
export function terminalStatusOf(
  terminal: Readonly<Record<string, unknown>> | null,
): "success" | "error" | null {
  if (terminal === null) return null;
  const status = terminal["status"];
  return status === "success" ? "success" : status === "error" ? "error" : null;
}

/** The class of the provider error the terminal carries, or null. */
export function terminalErrorClassOf(
  terminal: Readonly<Record<string, unknown>> | null,
): TerminalErrorClass | null {
  if (terminal === null) return null;
  const reasonCode = terminal["reason_code"];
  if (reasonCode === "provider_auth") return "provider_auth";
  if (reasonCode === "provider_error") return "provider_error";
  const reason = terminal["reason"];
  if (typeof reason === "string" && reason === "provider_auth") return "provider_auth";
  return terminalStatusOf(terminal) === "error" ? "provider_error" : null;
}

/** The exit status is a clean zero: code 0, no signal. */
export function exitedCleanly(exit: ExitStatus): boolean {
  return exit.code === 0 && exit.signal === null;
}

/**
 * Decide the outcome of one JSON-mode call (F138-FR-038). `errorCodes` are
 * the codes of the diagnostics of severity `error` of the stream, in order;
 * where the terminal carries no reason code of its own, the first of them is
 * the reason of the failed call (the rule F138-FR-020 names).
 */
export function decideOutcome(
  stream: OutcomeStream,
  exit: ExitStatus,
  errorCodes: readonly string[] = [],
): Outcome {
  const terminal = stream.terminal;
  const status = terminalStatusOf(terminal);
  if (terminal === null || status === null) {
    // No terminal record: never a success, whatever the exit code said.
    return {
      ok: false,
      reasonCode: MISSING_TERMINAL,
      reason: "the stream ended with no terminal record",
      providerClass: null,
      missingTerminal: true,
    };
  }
  if (status === "success") {
    if (exitedCleanly(exit)) {
      return {
        ok: true,
        reasonCode: "success",
        reason: null,
        providerClass: null,
        missingTerminal: false,
      };
    }
    // A success terminal with a non-zero exit, or ended by a signal, is not
    // a success: the process must have ended cleanly as well.
    return {
      ok: false,
      reasonCode: exit.signal !== null ? REASON_SIGNALED : REASON_EXIT_NONZERO,
      reason:
        exit.signal !== null
          ? `the process was ended by signal ${exit.signal}`
          : `the process exited ${String(exit.code)} after a success terminal`,
      providerClass: null,
      missingTerminal: false,
    };
  }
  // Error terminal: a failed call with the reason and class of the terminal,
  // whatever the exit code said — exit 0 included.
  const providerClass = terminalErrorClassOf(terminal);
  const terminalCode = terminal["reason_code"];
  const reasonCode =
    typeof terminalCode === "string" && terminalCode.length > 0
      ? terminalCode
      : (errorCodes[0] ?? providerClass ?? "provider_error");
  const reason = typeof terminal["reason"] === "string" ? terminal["reason"] : null;
  return {
    ok: false,
    reasonCode,
    reason,
    providerClass,
    missingTerminal: false,
  };
}

/**
 * The text-mode rule (F138-FR-038, last sentence): there is no terminal, and
 * the exit code and the output decide, as at the baseline — a clean exit with
 * visible output is a success, everything else is a failed call.
 */
export function decideTextModeOutcome(exit: ExitStatus, output: string): Outcome {
  const trimmed = output.trim();
  if (exitedCleanly(exit) && trimmed.length > 0) {
    return {
      ok: true,
      reasonCode: "success",
      reason: null,
      providerClass: null,
      missingTerminal: false,
    };
  }
  return {
    ok: false,
    reasonCode: exit.signal !== null ? REASON_SIGNALED : REASON_EXIT_NONZERO,
    reason:
      exit.signal !== null
        ? `the process was ended by signal ${exit.signal}`
        : exit.code === 0
          ? "the process exited 0 with no visible output"
          : `the process exited ${String(exit.code)}`,
    providerClass: null,
    missingTerminal: false,
  };
}
