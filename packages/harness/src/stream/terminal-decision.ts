/**
 * T013 — where the terminal decides, and what it decides (F126-FR-010).
 *
 * Where the format row sets `terminalDecides` — or, for a format of the JSONL
 * family, the row of the dialect table that the dialect row names sets it —
 * and for every harness whose process exits 0 on a provider error, the
 * outcome of the call is taken from the terminal record and not from the exit
 * code. A provider terminal that reports an error gives the reason code the
 * provider gave, else `provider_error`, with the provider's own text;
 * `provider_auth` carries `Provider authentication failed` when the provider
 * gave no text. A stream without a terminal never decides a call.
 */

/** The provider terminal, as the provider-terminal artifact holds it. */
export type ProviderTerminal = {
  readonly status: "success" | "error";
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly stopReason: string | null;
};

/** The outcome a call is given when the terminal decides. */
export type TerminalDecision = {
  /** False where the terminal does not decide: the exit code stands. */
  readonly decided: boolean;
  readonly isError: boolean;
  readonly reasonCode: string | null;
  readonly reason: string | null;
};

/** The reason and text of one erroring provider terminal (F126-FR-010). */
export function reasonOfProviderTerminal(terminal: ProviderTerminal): {
  reasonCode: string;
  reason: string;
} {
  const given = terminal.reasonCode;
  const reasonCode = given !== null && given.length > 0 ? given : "provider_error";
  let reason = terminal.reason;
  if (reason === null || reason.length === 0) {
    reason =
      reasonCode === "provider_auth"
        ? "Provider authentication failed"
        : reasonCode === "provider_error"
          ? "Provider reported an error"
          : `Provider reported ${reasonCode}`;
  }
  return { reasonCode, reason };
}

/**
 * The decision of one finished call (F126-FR-010). `terminalDecides` is read
 * from the format row, or from the dialect row of the JSONL family; a null
 * terminal and a false flag both leave the decision to the exit code.
 */
export function decideByTerminal(
  terminal: ProviderTerminal | null,
  terminalDecides: boolean,
): TerminalDecision {
  if (!terminalDecides || terminal === null) {
    return { decided: false, isError: false, reasonCode: null, reason: null };
  }
  if (terminal.status !== "error") {
    return { decided: true, isError: false, reasonCode: null, reason: null };
  }
  const { reasonCode, reason } = reasonOfProviderTerminal(terminal);
  return { decided: true, isError: true, reasonCode, reason };
}
