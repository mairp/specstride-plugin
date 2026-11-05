/**
 * T076 of feature 103 — THE SESSION DIRECTIVE AND ITS DROP RULES
 * (F103-FR-042, F103-FR-043).
 *
 * Every pass gets a session directive from the CORE: `fresh` with a minted id,
 * or `continue` with an id, and a reason. The directive and its reason are
 * recorded per pass, and the harness port carries the value out
 * (annex C §C.2; the value is row 126 of annex X §X.6, owned by feature 109).
 *
 * ## It reads the contract, it does not restate it
 *
 * The eleven drop rules and their thresholds live in
 * `specs/103-proposer-pass/contracts/fresh-session-reasons.json`. T076 says to
 * READ that file, so `./fresh-session-reasons.json` is a byte-identical copy
 * of it delivered beside the module — the same mechanism T003 used for the two
 * schemas of the pass loop — and `DROP_RULES`, `RULE_IDS` and every threshold
 * below are READ from it at load. There is no second list of eleven in this
 * file to drift from the contract, and
 * `tests/characterization/103/session-directive.test.ts` compares the copy
 * with the contract byte for byte.
 *
 * ## The order of the decision, and why it is this order
 *
 *  1. **The capability.** F103-FR-043: for a harness whose capability
 *     `continuation` is absent, null or false, the directive is ALWAYS `fresh`
 *     — reason `no-continuation` — and files carry the context. This comes
 *     first because it is not a drop rule: there is nothing to drop.
 *  2. **A `fresh` a layer named in `requestPass`** (the second repair of a
 *     unit of work, an escalation): reason `layer-requested` (clarification
 *     U5). Also not a drop rule — the layer asked.
 *  3. **The switch `carry.continuation`.** Off, and no session may be
 *     continued. Under `parity` the switch is off BECAUSE the profile is
 *     selected, which is drop rule eleven's own wording, so that case is left
 *     to the rules below and reported as `profile-parity`.
 *  4. **The eleven drop rules**, in the order of the contract file. The FIRST
 *     that holds is the reason, and `rulesThatHeld` reports every one that did,
 *     so a test can show that each of the eleven drops a session on its own.
 *  5. **Otherwise `continue`**, with the held id. No held id is itself a fresh
 *     session: there is nothing to continue.
 *
 * ## The pass loop names no harness
 *
 * F103-FR-043: "The pass loop MUST name no harness to decide this." The
 * decision reads ONE field — the capability `continuation` of the descriptor
 * it was handed — and this file contains no harness name at all.
 * `HARNESS_NAMES_IN_THIS_MODULE` is empty and the test greps the source for a
 * name rather than trusting the claim.
 *
 * ## Under `parity`, no invocation carries a continuation argument
 *
 * `continuationArgumentsOf` is the one place the argument is formed, and it
 * returns the empty list under `parity` whatever the directive says. So the
 * last sentence of F103-FR-042 holds through a function a test can drive,
 * rather than through a convention a caller might forget.
 */
import { createHash } from "node:crypto";
import {
  ALWAYS_FRESH_REASONS,
  FRESH_SESSION_REASONS,
  FRESH_SESSION_REASON_WHEN_UNKNOWN,
  SESSION_DIRECTIVES,
  SESSION_DIRECTIVE_WHEN_UNKNOWN,
  freshSessionReasons,
  isFreshSessionReason,
  type FreshSessionReason,
  type SessionDirective,
} from "@specstride/contracts/enums/pass-loop";
import contract from "./fresh-session-reasons.json" with { type: "json" };

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-042", "F103-FR-043"] as const;

/** The contract this module reads, and the copy it reads it from. */
export const CONTRACT_FILE =
  "specs/103-proposer-pass/contracts/fresh-session-reasons.json" as const;
export const DATA_FILE = "packages/core/src/carry/fresh-session-reasons.json" as const;

/** The switch of F103-FR-042; off under `parity` (row 10 of annex X §X.7). */
export const SWITCH = "carry.continuation" as const;
export const SWITCH_DEFAULT_ON = true as const;
export const SWITCH_UNDER_PARITY_ON = false as const;

/** The divergence register row of session continuation. */
export const DIVERGENCE = "DV-010" as const;

/** The two values of the directive (row 126), and the unknown-value rule. */
export const DIRECTIVES = SESSION_DIRECTIVES;
export const DIRECTIVE_WHEN_UNKNOWN = SESSION_DIRECTIVE_WHEN_UNKNOWN;

/** The thirteen reasons (row 133 with clarification U5), and its rule. */
export const REASONS = FRESH_SESSION_REASONS;
export const REASON_WHEN_UNKNOWN = FRESH_SESSION_REASON_WHEN_UNKNOWN;

/** F103-FR-043 — no harness is named to decide this. */
export const HARNESS_NAMES_IN_THIS_MODULE: readonly string[] = Object.freeze([]);
export const THE_PASS_LOOP_NAMES_A_HARNESS = false as const;

/** F103-FR-042 — the directive and its reason are recorded per pass. */
export const RECORDED_PER_PASS = true as const;

/* ------------------------------------------------------------------ *
 * The rules, read from the contract.
 * ------------------------------------------------------------------ */

type RawReason = {
  readonly id: string;
  readonly rule: string;
  readonly parameter: Readonly<Record<string, number>> | null;
};

type RawContract = {
  readonly schema: string;
  readonly reasons: readonly RawReason[];
  readonly alwaysFresh: readonly string[];
  readonly unknownValue: string;
  readonly layerRequested: { readonly id: string; readonly rule: string };
};

const DATA = contract as unknown as RawContract;

/** One drop rule, as the contract states it. */
export type DropRule = {
  readonly id: FreshSessionReason;
  /** The rule in the words of the contract. */
  readonly rule: string;
  /** Its parameters, where it has any. */
  readonly parameter: Readonly<Record<string, number>> | undefined;
};

/**
 * F103-FR-042 — the ELEVEN drop rules, in the order of the contract file. The
 * count is asserted at load: a contract that gained or lost a rule would be a
 * silent change of the requirement, so it fails loudly here instead.
 */
export const DROP_RULES: readonly DropRule[] = Object.freeze(
  DATA.reasons.map((raw) => {
    if (!isFreshSessionReason(raw.id)) {
      throw new Error(
        `${CONTRACT_FILE} names the reason ${raw.id}, which is not in the closed set ` +
          `"Reasons for a fresh session" (row 133 of annex X §X.6)`,
      );
    }
    return Object.freeze({
      id: raw.id,
      rule: raw.rule,
      parameter: raw.parameter === null ? undefined : Object.freeze({ ...raw.parameter }),
    });
  }),
);

/** F103-FR-042 names eleven drop rules; the contract must hold eleven. */
export const DROP_RULE_COUNT = 11 as const;

if (DROP_RULES.length !== DROP_RULE_COUNT) {
  throw new Error(
    `${CONTRACT_FILE} holds ${String(DROP_RULES.length)} drop rules; F103-FR-042 states ` +
      `${String(DROP_RULE_COUNT)}`,
  );
}

/** The ids of the eleven, in the order of the contract. */
export const RULE_IDS: readonly FreshSessionReason[] = Object.freeze(
  DROP_RULES.map((rule) => rule.id),
);

/** One rule by id. */
export function dropRule(id: FreshSessionReason): DropRule | undefined {
  return DROP_RULES.find((rule) => rule.id === id);
}

/** The reasons of a session that is always fresh, whatever the rules say. */
export const ALWAYS_FRESH = ALWAYS_FRESH_REASONS;

/** The contract's own list of the always-fresh cases, in its words. */
export const ALWAYS_FRESH_IN_THE_CONTRACT: readonly string[] = Object.freeze([...DATA.alwaysFresh]);

/** The reason of a `fresh` a layer named in `requestPass` (clarification U5). */
export const LAYER_REQUESTED: FreshSessionReason = "layer-requested";

/** The reason of a harness that cannot continue (F103-FR-043). */
export const NO_CONTINUATION: FreshSessionReason = "no-continuation";

/* ------------------------------------------------------------------ *
 * The parameters, read from the rules that carry them.
 * ------------------------------------------------------------------ */

function parameterOf(id: FreshSessionReason, key: string, fallback: number): number {
  const held = dropRule(id)?.parameter?.[key];
  return typeof held === "number" ? held : fallback;
}

/** `carry.maxContinuedPasses` — the cap of continued passes in a phase attempt. */
export const MAX_CONTINUED_PASSES_KEY = "carry.maxContinuedPasses" as const;
export const MAX_CONTINUED_PASSES_DEFAULT = parameterOf(
  "continuation-cap",
  MAX_CONTINUED_PASSES_KEY,
  3,
);

/** `carry.contextFillTokens` and `carry.contextFillShare` (per cent). */
export const CONTEXT_FILL_TOKENS_KEY = "carry.contextFillTokens" as const;
export const CONTEXT_FILL_TOKENS_DEFAULT = parameterOf(
  "context-fill",
  CONTEXT_FILL_TOKENS_KEY,
  150000,
);
export const CONTEXT_FILL_SHARE_KEY = "carry.contextFillShare" as const;
export const CONTEXT_FILL_SHARE_DEFAULT = parameterOf("context-fill", CONTEXT_FILL_SHARE_KEY, 50);

/** A harness that reports no usage falls back to at most this many continued passes. */
export const FALLBACK_PASSES_WITHOUT_USAGE = parameterOf("context-fill", "fallbackPasses", 2);

/** `carry.ageFallbackSec` — used only where the descriptor declares no TTL. */
export const AGE_FALLBACK_SEC_KEY = "carry.ageFallbackSec" as const;
export const AGE_FALLBACK_SEC_DEFAULT = parameterOf("age", AGE_FALLBACK_SEC_KEY, 300);

/** CQ-068 — where the cache lifetime of a session is declared (annex C §C.2). */
export const CACHE_TTL_FIELD = "continuation.cacheTtlSec" as const;

/* ------------------------------------------------------------------ *
 * What the decision is given.
 * ------------------------------------------------------------------ */

/**
 * The capability `continuation` of the harness descriptor, as much of it as
 * the decision reads (annex C §C.2). The descriptor is handed in; no harness
 * is named (F103-FR-043).
 */
export type ContinuationCapability = {
  readonly supported?: boolean | null | undefined;
  readonly cacheTtlSec?: number | null | undefined;
};

/** The parameters of carry-over in force (row 60 of annex X §X.7). */
export type CarryParameters = {
  readonly maxContinuedPasses?: number | undefined;
  readonly contextFillTokens?: number | undefined;
  readonly contextFillShare?: number | undefined;
  readonly ageFallbackSec?: number | undefined;
};

/** The state of the phase attempt the decision reads. */
export type SessionInput = {
  /** The capability of the harness; absent, null or false means always fresh. */
  readonly continuation?: ContinuationCapability | null | undefined;
  /** The switch `carry.continuation`. */
  readonly switchOn?: boolean | undefined;
  /** The profile in force; `parity` is drop rule eleven's own condition. */
  readonly profile?: string | undefined;
  /** The id of the session held from the pass before, where one is held. */
  readonly heldSessionId?: string | undefined;

  /** A layer named a `fresh` in `requestPass` (U5). */
  readonly layerRequestedFresh?: boolean | undefined;

  /* The eleven, in the order of the contract. */
  /** 1 — a new phase attempt, a critic-class call, a change of role. */
  readonly newPhaseAttempt?: boolean | undefined;
  readonly criticClassCall?: boolean | undefined;
  readonly roleChanged?: boolean | undefined;
  /** 2 — the previous pass was ended by a watchdog. */
  readonly previousPassKilledByAWatchdog?: boolean | undefined;
  /** 3 — consecutive passes without phase evidence and without a kept unit. */
  readonly consecutivePassesWithoutEvidenceOrKeptUnit?: number | undefined;
  /** 4 — the last observed context, and the known window of the harness. */
  readonly lastObservedContextTokens?: number | undefined;
  readonly knownWindowTokens?: number | undefined;
  readonly harnessReportsUsage?: boolean | undefined;
  /** 5 — the time since the last request, in seconds. */
  readonly secondsSinceLastRequest?: number | undefined;
  /** 6 — the model, effort, tool set, plugin set or system prompt must change. */
  readonly configurationChanged?: boolean | undefined;
  /** 7 — the engine was started again inside the phase attempt. */
  readonly relaunch?: boolean | undefined;
  /** 8 — a resume error, a missing transcript, a harness upgraded between passes. */
  readonly sessionUnavailable?: boolean | undefined;
  /** 9 — how many passes of this phase attempt have already continued. */
  readonly continuedPassesInAttempt?: number | undefined;
  /** 11 — the first pass of the main line after a parallel group was applied. */
  readonly firstPassAfterAGroupWasApplied?: boolean | undefined;

  readonly parameters?: CarryParameters | undefined;
};

/* ------------------------------------------------------------------ *
 * The eleven rules, each as a predicate.
 * ------------------------------------------------------------------ */

/** The fill of the context that drops a session, in tokens (F103-FR-042). */
export function contextFillThreshold(
  knownWindowTokens: number | undefined,
  parameters: CarryParameters = {},
): number {
  const tokens = parameters.contextFillTokens ?? CONTEXT_FILL_TOKENS_DEFAULT;
  const share = parameters.contextFillShare ?? CONTEXT_FILL_SHARE_DEFAULT;
  if (knownWindowTokens === undefined || knownWindowTokens <= 0) return tokens;
  // "the SMALLER of carry.contextFillTokens and the share ... of the known window"
  return Math.min(tokens, Math.floor((knownWindowTokens * share) / 100));
}

/** The lifetime after which a session is too old (CQ-068, annex C §C.2). */
export function ageLimitSec(
  capability: ContinuationCapability | null | undefined,
  parameters: CarryParameters = {},
): number {
  const declared = capability?.cacheTtlSec;
  if (typeof declared === "number" && declared > 0) return declared;
  return parameters.ageFallbackSec ?? AGE_FALLBACK_SEC_DEFAULT;
}

/** Whether each of the eleven holds, keyed by its id. */
export function rulesThatHold(input: SessionInput): ReadonlyMap<FreshSessionReason, boolean> {
  const parameters = input.parameters ?? {};
  const held = new Map<FreshSessionReason, boolean>();

  held.set(
    "new-attempt",
    input.newPhaseAttempt === true || input.criticClassCall === true || input.roleChanged === true,
  );
  held.set("watchdog-kill", input.previousPassKilledByAWatchdog === true);
  held.set("repeated-failure", (input.consecutivePassesWithoutEvidenceOrKeptUnit ?? 0) >= 2);

  const continued = input.continuedPassesInAttempt ?? 0;
  const fill = input.lastObservedContextTokens;
  const contextFill =
    input.harnessReportsUsage === false
      ? continued >= FALLBACK_PASSES_WITHOUT_USAGE
      : fill !== undefined && fill > contextFillThreshold(input.knownWindowTokens, parameters);
  held.set("context-fill", contextFill);

  const since = input.secondsSinceLastRequest;
  held.set("age", since !== undefined && since > ageLimitSec(input.continuation, parameters));

  held.set("configuration-change", input.configurationChanged === true);
  held.set("relaunch", input.relaunch === true);
  held.set("session-unavailable", input.sessionUnavailable === true);
  held.set(
    "continuation-cap",
    continued >= (parameters.maxContinuedPasses ?? MAX_CONTINUED_PASSES_DEFAULT),
  );
  held.set("profile-parity", input.profile === "parity" || input.switchOn === false);
  held.set("group-applied", input.firstPassAfterAGroupWasApplied === true);

  return Object.freeze(held);
}

/* ------------------------------------------------------------------ *
 * The directive.
 * ------------------------------------------------------------------ */

/** The directive of one pass, as it is recorded (F103-FR-042). */
export type SessionDirectiveRecord = {
  readonly directive: SessionDirective;
  /** The reason, where the directive is `fresh`. A `continue` has none. */
  readonly reason?: FreshSessionReason | undefined;
  /** The id: minted for a `fresh`, the held one for a `continue`. */
  readonly sessionId: string;
  /** Every one of the eleven that held, for the record and for a test. */
  readonly rulesThatHeld: readonly FreshSessionReason[];
  /** The event a session that is unavailable is announced by. */
  readonly event?:
    { readonly asIsName: string; readonly fields: Readonly<Record<string, unknown>> } | undefined;
};

/** What a minted id is made from; the core holds no randomness here on purpose. */
export type MintInput = {
  /** The base of the invocation ids of the phase attempt. */
  readonly base: string;
  readonly phase: number;
  readonly phaseAttempt: number;
  readonly pass: number;
};

/**
 * A minted session id. It is DERIVED from the base of the phase attempt and
 * the position of the pass, not drawn at random, so that two runs of the same
 * fixture mint the same id and a parity surface can compare it. The base is
 * what carries the uniqueness of the run.
 */
export function mintSessionId(input: MintInput): string {
  const material = `${input.base}/${String(input.phase)}/${String(input.phaseAttempt)}/${String(
    input.pass,
  )}`;
  return `sess-${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * F103-FR-042 and F103-FR-043 — the session directive of one pass.
 *
 * The order of the decision is the one the module's own documentation gives.
 * Every branch returns a RECORD with the reason in it, so there is no path on
 * which a `fresh` is produced without one being recorded.
 */
export function decideSessionDirective(
  input: SessionInput,
  mint: MintInput,
): SessionDirectiveRecord {
  const held = rulesThatHold(input);
  const heldIds = Object.freeze(RULE_IDS.filter((id) => held.get(id) === true));
  const fresh = (reason: FreshSessionReason): SessionDirectiveRecord =>
    Object.freeze({
      directive: "fresh" as const,
      reason,
      sessionId: mintSessionId(mint),
      rulesThatHeld: heldIds,
      ...(reason === "session-unavailable"
        ? {
            event: Object.freeze({
              asIsName: "session.unavailable",
              fields: Object.freeze({ reason, directive: "fresh" }),
            }),
          }
        : {}),
    });

  // 1. F103-FR-043 — the capability. Absent, null or false: always fresh.
  const capability = input.continuation;
  if (
    capability === undefined ||
    capability === null ||
    capability.supported === undefined ||
    capability.supported === null ||
    capability.supported === false
  ) {
    return fresh(NO_CONTINUATION);
  }

  // 2. A `fresh` a layer named in `requestPass` (clarification U5).
  if (input.layerRequestedFresh === true) return fresh(LAYER_REQUESTED);

  // 3. and 4. The eleven, in the order of the contract. The switch being off
  // is drop rule eleven's own condition, so it is inside `rulesThatHold`.
  for (const id of RULE_IDS) {
    if (held.get(id) === true) return fresh(id);
  }

  // 5. Otherwise continue — if there is in fact a session to continue.
  const sessionId = input.heldSessionId;
  if (sessionId === undefined || sessionId === "") return fresh("new-attempt");
  return Object.freeze({
    directive: "continue" as const,
    sessionId,
    rulesThatHeld: heldIds,
  });
}

/**
 * F103-FR-043 — for a harness that cannot continue, FILES carry the context.
 * These three, in the words of the requirement.
 */
export const FILES_THAT_CARRY_THE_CONTEXT = [
  "the handoff",
  "the ledger",
  "the feedback files",
] as const;

/* ------------------------------------------------------------------ *
 * The argument of the invocation.
 * ------------------------------------------------------------------ */

/** F103-FR-042 — under `parity` no invocation carries a continuation argument. */
export const UNDER_PARITY_AN_INVOCATION_CARRIES_A_CONTINUATION_ARGUMENT = false as const;

/** The flag a harness that supports continuation is given the session with. */
export type ContinuationFlag = {
  /** The name of the flag, from the harness descriptor (annex C §C.2). */
  readonly flag: string;
};

/**
 * The arguments that carry the continuation, and the ONE place they are
 * formed. Under `parity` the list is EMPTY whatever the directive says, which
 * is the last sentence of F103-FR-042; and a `fresh` directive carries none
 * either, since there is nothing to continue.
 */
export function continuationArgumentsOf(
  record: SessionDirectiveRecord,
  options: { readonly profile?: string | undefined; readonly flag?: ContinuationFlag | undefined },
): readonly string[] {
  if (options.profile === "parity") return Object.freeze([]);
  if (record.directive !== "continue") return Object.freeze([]);
  const flag = options.flag?.flag;
  if (flag === undefined || flag === "") return Object.freeze([]);
  return Object.freeze([flag, record.sessionId]);
}

/** The reason read back from a record, with the unknown-value rule applied. */
export function readReason(value: string): FreshSessionReason {
  if (isFreshSessionReason(value)) return value;
  const outcome = freshSessionReasons.onUnknown(value);
  return (outcome.treatedAs ?? REASON_WHEN_UNKNOWN) as FreshSessionReason;
}
