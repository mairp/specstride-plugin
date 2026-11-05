/**
 * T058 — the ends of the plugin protocol, returned by `betweenPasses`
 * (F130-FR-035, F130-FR-036).
 *
 * The protocol is enabled only by a non-empty allowlist and only for the
 * harness named WITHOUT a qualifier; the descriptor expresses this as the
 * capability `pluginRequests`, available only without a qualifier, and the
 * core never compares the name of the harness (DV-064). A request that
 * exists while the allowlist is empty, and a request that is invalid,
 * denied, timed out or whose installer failed, end the run with the result
 * 7. An install on the final pass ends it with the result 4. An install on
 * any other pass starts the next pass fresh, and THAT pass is exempt from
 * every breaker and from the short-pass counter. Three events are rendered
 * by the compatibility projection with the as-is literals and fields, and
 * standard error carries the three lines of the pass loop.
 */
import { ARCHIVE_LOGICAL_NAME, REQUEST_LOGICAL_NAME, type ProcessorResult } from "./request.ts";

/** The capability of the descriptor: `pluginRequests` (F130-FR-035). */
export const PLUGIN_REQUESTS_CAPABILITY = "pluginRequests" as const;

/**
 * The capability statement (F130-FR-035): available ONLY without a
 * qualifier, whatever the allowlist says.
 */
export function pluginRequestsCapability(qualifier: string | null | undefined): {
  readonly capability: typeof PLUGIN_REQUESTS_CAPABILITY;
  readonly available: boolean;
  readonly provenance: "adapter";
} {
  return {
    capability: PLUGIN_REQUESTS_CAPABILITY,
    available: qualifier === null || qualifier === undefined,
    provenance: "adapter",
  };
}

/**
 * Whether the protocol is enabled for a pass (F130-FR-035): a non-empty
 * allowlist AND the bare name. The two as-is comparisons of the baseline
 * became this capability check; no caller names the harness.
 */
export function pluginProtocolEnabled(input: {
  readonly qualifier: string | null;
  readonly allowlist: readonly string[];
}): boolean {
  return input.qualifier === null && input.allowlist.length > 0;
}

/** What the processor left behind after the pass, as the pass loop saw it. */
export type PluginRequestOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "allowlist_empty" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "installed"; readonly profile: string; readonly plugins: readonly string[] };

/** Maps one processor result to the outcome the pass loop consumes. */
export function outcomeOfProcessor(
  ran: boolean,
  result: ProcessorResult | null,
): PluginRequestOutcome {
  if (!ran || result === null) return { kind: "none" };
  if (result.exit === 0) {
    if (result.result !== null && result.result["status"] === "installed") {
      return {
        kind: "installed",
        profile: String(result.result["profile"] ?? ""),
        plugins: (result.result["plugins"] as readonly string[]) ?? [],
      };
    }
    return { kind: "none" };
  }
  return { kind: "failed", reason: result.stderr };
}

/** The input of `betweenPasses`. */
export type BetweenPassesInput = {
  /** Whether a request file existed when the pass ended. */
  readonly requestExists: boolean;
  /** The allowlist of the run, as accepted by the consent of F130-FR-034. */
  readonly allowlist: readonly string[];
  /** The qualifier the harness was named with, or null for the bare name. */
  readonly qualifier: string | null;
  /** What the processor did with the request (null where never run). */
  readonly outcome: PluginRequestOutcome | null;
  /** The number of the pass that just ended, 1-based. */
  readonly iter: number;
  /** Whether the pass that just ended was the last the budget allows. */
  readonly isFinalPass: boolean;
  /** Whether the pass wrote phase evidence (a request is handled FIRST). */
  readonly hasEvidence?: boolean;
};

/** The decision `betweenPasses` returns to the pass loop. */
export type BetweenPassesDecision =
  | {
      readonly action: "continue";
      readonly restart: false;
      readonly exemptFromBreakers: false;
      readonly exemptFromShortPassCounter: false;
    }
  | {
      readonly action: "continue";
      readonly restart: true;
      /** A pass that ended with a plugin install (F130-FR-035). */
      readonly exemptFromBreakers: true;
      readonly exemptFromShortPassCounter: true;
      readonly event: string;
      readonly stderrLine: string;
    }
  | {
      readonly action: "stop";
      readonly result: 4 | 7;
      readonly event: string;
      readonly stderrLine: string;
      /**
       * True only where the pass ENDED WITH AN INSTALL (the final-pass end);
       * a denied or failed request installs nothing and exempts nothing.
       */
      readonly exemptFromBreakers: boolean;
      readonly exemptFromShortPassCounter: boolean;
    };

/** The prefix every stderr line of the pass loop carries (F130-FR-036). */
export const PASS_LOOP_COMPONENT = "pass-loop" as const;

/**
 * Renders the three events with the as-is literals and fields
 * (F130-FR-036): `plugin_install_denied` (`iter`, `reason=allowlist_empty`),
 * `plugin_install_failed` (`iter`, `reason` = the full output of the
 * processor) and `plugin_installed` (`iter`, `profile`, `plugins` joined by
 * commas).
 */
export function renderPluginEvent(
  event:
    | { readonly name: "plugin_install_denied"; readonly iter: number }
    | { readonly name: "plugin_install_failed"; readonly iter: number; readonly reason: string }
    | {
        readonly name: "plugin_installed";
        readonly iter: number;
        readonly profile: string;
        readonly plugins: readonly string[];
      },
): string {
  switch (event.name) {
    case "plugin_install_denied":
      return `plugin_install_denied iter=${event.iter} reason=allowlist_empty`;
    case "plugin_install_failed":
      return `plugin_install_failed iter=${event.iter} reason=${event.reason}`;
    case "plugin_installed":
      return `plugin_installed iter=${event.iter} profile=${event.profile} plugins=${event.plugins.join(",")}`;
  }
}

/** The three stderr lines of the pass loop (F130-FR-036). */
export function allowlistEmptyLine(allowlist: readonly string[]): string {
  return `${PASS_LOOP_COMPONENT}: DSH plugin request found but ${allowlist.join(",")} is empty`;
}

export function restartLine(plugins: readonly string[]): string {
  return `${PASS_LOOP_COMPONENT}: installed DSH plugin(s): ${plugins.join(",")}; restarting with fresh profile`;
}

export function finalPassLine(): string {
  return `${PASS_LOOP_COMPONENT}: plugin installed on final pass; raise --max-iter to allow a restarted DSH pass`;
}

/**
 * The ends of the protocol (F130-FR-035, F130-FR-036). A request is handled
 * BEFORE the check for phase evidence: a pass that wrote both still
 * triggers the install and a restart pass. A qualified name is never
 * processed: the decision is a plain continue and the processor never ran.
 */
export function betweenPasses(input: BetweenPassesInput): BetweenPassesDecision {
  // The capability gate: a QUALIFIED name is never processed (F130-FR-035).
  // The empty-allowlist case is NOT gated here: a request that exists while
  // the allowlist is empty is exactly the denied end of F130-FR-036, even
  // though an empty allowlist never enabled the protocol.
  if (input.qualifier !== null) {
    return continue_plain();
  }
  if (!input.requestExists || input.outcome === null || input.outcome.kind === "none") {
    return continue_plain();
  }
  if (input.outcome.kind === "allowlist_empty") {
    return {
      action: "stop",
      result: 7,
      event: renderPluginEvent({ name: "plugin_install_denied", iter: input.iter }),
      stderrLine: allowlistEmptyLine(input.allowlist),
      exemptFromBreakers: false,
      exemptFromShortPassCounter: false,
    };
  }
  if (input.outcome.kind === "failed") {
    return {
      action: "stop",
      result: 7,
      event: renderPluginEvent({
        name: "plugin_install_failed",
        iter: input.iter,
        reason: input.outcome.reason,
      }),
      // The full output of the processor reaches standard error as it is
      // (it begins with `dsh plugin request: ...`); it is the event's reason.
      stderrLine: input.outcome.reason.replace(/\n$/, ""),
      exemptFromBreakers: false,
      exemptFromShortPassCounter: false,
    };
  }
  const event = renderPluginEvent({
    name: "plugin_installed",
    iter: input.iter,
    profile: input.outcome.profile,
    plugins: input.outcome.plugins,
  });
  if (input.isFinalPass) {
    return {
      action: "stop",
      result: 4,
      event,
      stderrLine: finalPassLine(),
      exemptFromBreakers: true,
      exemptFromShortPassCounter: true,
    };
  }
  return {
    action: "continue",
    restart: true,
    exemptFromBreakers: true,
    exemptFromShortPassCounter: true,
    event,
    stderrLine: restartLine(input.outcome.plugins),
  };
}

function continue_plain(): BetweenPassesDecision {
  return {
    action: "continue",
    restart: false,
    exemptFromBreakers: false,
    exemptFromShortPassCounter: false,
  };
}

/** The logical names the protocol owns, re-exported for the pass loop. */
export { ARCHIVE_LOGICAL_NAME, REQUEST_LOGICAL_NAME };

/**
 * The port outcome of a decision, in the closed vocabulary of the harness
 * port (`continue`, `stop:4`, `stop:7` — `BETWEEN_PASSES_OUTCOMES` of EP-02).
 */
export function betweenPassesOutcome(
  decision: BetweenPassesDecision,
): "continue" | "stop:4" | "stop:7" {
  if (decision.action === "continue") return "continue";
  return decision.result === 4 ? "stop:4" : "stop:7";
}
