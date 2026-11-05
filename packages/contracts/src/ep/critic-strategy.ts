/**
 * T138 — the interface types of EP-18, the critic strategy and the attempt
 * planner, from
 * `contracts/extension-points/EP-18.critic-strategy-and-attempt-planner.json`
 * and annex E, §E.1 (F100-FR-138 to F100-FR-140).
 *
 * `specstride.critic-strategy/1` and `specstride.attempt-planner/1`. Internal
 * seams: versioned and tested as every extension point, with a conformance
 * suite and a sample, and with no promise to implementers outside the
 * product's repository in Wave 1 (F100-FR-020).
 */
import { INTERNAL_SEAM_POINT, standingOf } from "./extension-point.ts";

export const EP = "EP-18" as const;
export const ANNEX_SECTION = "annex E, §E.1" as const;

/** The two ids of the point (annex A, §A.4). */
export const POINT_IDS = ["specstride.critic-strategy/1", "specstride.attempt-planner/1"] as const;
export const CRITIC_STRATEGY_ID = "specstride.critic-strategy/1" as const;
export const ATTEMPT_PLANNER_ID = "specstride.attempt-planner/1" as const;

/** F100-FR-138 — the two operations of the point. */
export const OPERATIONS = ["judge", "next"] as const;
export type CriticStrategyOperation = (typeof OPERATIONS)[number];

/** F100-FR-020 — EP-18 is the one internal seam. */
export const STANDING = standingOf(INTERNAL_SEAM_POINT);
export const IS_AN_INTERNAL_SEAM = true as const;
export const PROMISE_OUTSIDE_THE_REPOSITORY_IN_WAVE_1 = false as const;

/** The closed set of verdicts `judge` returns (§E.1, Outputs). */
export const VERDICTS = ["APPROVED", "REJECTED", "MALFORMED"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Unknown-value rule of §E.1: an unknown verdict is MALFORMED. */
export const VERDICT_WHEN_UNKNOWN: Verdict = "MALFORMED";

/** The closed set of kinds of the next phase attempt (§E.1, Outputs). */
export const ATTEMPT_KINDS = ["plain", "diagnosed", "accelerated", "bumped"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** Unknown-value rule of §E.1: an unknown kind of phase attempt is `plain`. */
export const ATTEMPT_KIND_WHEN_UNKNOWN: AttemptKind = "plain";

/** The facts of the proof the call function returns with the reply. */
export type ProofFacts = {
  readonly tools: readonly string[];
  readonly sessionId: string;
  readonly sandboxMode: string | null;
  readonly networkState: string | null;
};

/**
 * The call function of the engine: one `completion` call with a nonce and a
 * fresh session of its own. A critic strategy reaches a harness through this
 * function only.
 */
export type CriticCall = (prompt: string) => Promise<{
  readonly reply: string;
  readonly proof: ProofFacts;
  /** Only the hash of the nonce is recorded; F100-FR-139. */
  readonly nonceHash: string;
}>;

/** The input of the phase gate `judge` receives (§E.1, Inputs). */
export type GateInput = {
  readonly phaseEvidence: {
    readonly logicalName: string;
    readonly hash: string;
    readonly size: number;
  };
  readonly groundingSnapshot: {
    readonly logicalName: string;
    readonly hash: string;
    readonly size: number;
  };
  readonly verificationResult: unknown;
  readonly factBlock: readonly Readonly<Record<string, unknown>>[];
  readonly rolePlan: unknown;
};

/** The verdict record `judge` returns; only the engine writes the approval record. */
export type VerdictRecord = {
  readonly verdictId: string;
  readonly verdict: Verdict;
  readonly unmetCriteria: readonly string[];
  /** The verdict record may hold the nonce in clear after the call returned. */
  readonly nonce?: string;
  readonly nonceHash: string;
};

/** The history of the phase attempts of a phase that `next` receives. */
export type AttemptHistory = {
  readonly verdicts: readonly Verdict[];
  readonly unmetCriteriaSignatures: readonly string[];
  readonly countsFromTheLedger: Readonly<Record<string, number>>;
  /** The two facts the engine works out and hands over (§E.1, Inputs). */
  readonly diagnosisWasMadeForTheNewestSignature: boolean;
  readonly anAcceleratedPhaseAttemptIsDue: boolean;
};

/** F100-FR-138 — the critic strategy seam. */
export type CriticStrategy = {
  judge(input: GateInput, call: CriticCall): Promise<VerdictRecord>;
};

/** F100-FR-138 — the attempt planner seam: a pure function of the history. */
export type AttemptPlanner = {
  next(history: AttemptHistory): AttemptKind;
};

/** F100-FR-139 — the nonce: 64 bits of its own from a secure random source. */
export const NONCE_BITS = 64 as const;
/** The nonce is never written before the call has returned. */
export const NONCE_WRITTEN_BEFORE_THE_CALL_RETURNS = false as const;
/** Afterwards only its hash is recorded in events, spans, the ledger and the approval record. */
export const PLACES_THAT_HOLD_ONLY_THE_HASH = [
  "events",
  "spans",
  "the ledger",
  "the approval record",
] as const;
/** The verdict record and the feedback may hold the nonce in clear afterwards. */
export const PLACES_THAT_MAY_HOLD_THE_NONCE_IN_CLEAR = [
  "the verdict record",
  "the feedback of the phase attempt",
] as const;

/** "Errors" of §E.1: the configuration error of the critic halts the run. */
export const CRITIC_CONFIG_EXIT_CODE = 3 as const;
export const CRITIC_CONFIG_STOP_REASON = "critic_config" as const;
/** A transport error is scored as MALFORMED. */
export const TRANSPORT_ERROR_IS_SCORED_AS: Verdict = "MALFORMED";

/**
 * "Failure of an implementation" of §E.1 — the plainer path: a critic
 * strategy that fails gives MALFORMED, counted by the MALFORMED limit; an
 * attempt planner that fails gives `plain`.
 */
export const FAILURE_PATHS: Readonly<Record<CriticStrategyOperation, string>> = Object.freeze({
  judge: "MALFORMED, counted by the MALFORMED limit",
  next: "`plain`",
});

/** "Guarantees of the core" of §E.1: a verdict is parsed only from the reply. */
export const VERDICT_IS_PARSED_AS = "a full line, with exactly one match" as const;
/** Everything else is MALFORMED, which rejects. */
export const EVERYTHING_ELSE_IS: Verdict = "MALFORMED";
/** Only the engine writes the approval record. */
export const THE_STRATEGY_WRITES_THE_APPROVAL_RECORD = false as const;

/** The results of the diversity test that raise the critic-diversity warning. */
export const DIVERSITY_RESULTS_THAT_WARN = ["same-model", "unverified"] as const;
export const WARNING_NAME = "critic-diversity warning" as const;

/** F100-FR-140 — the model-tier bump is an option, off by default. */
export const TIER_BUMP_DEFAULT_ON = false as const;
/** A failed verification gate and a MALFORMED reply do not count towards K. */
export const COUNTS_TOWARDS_K: Readonly<Record<string, boolean>> = Object.freeze({
  "rejection by the critic": true,
  "a failed verification gate": false,
  "a MALFORMED reply": false,
});
/** The bump and the escalation of annex D §D.4 are separate rules with separate counts. */
export const BUMP_AND_ESCALATION_SHARE_A_COUNT = false as const;
