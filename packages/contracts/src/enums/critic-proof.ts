/**
 * T216 — the types of the proof of a critic-class call, with its three cases,
 * and the rule for the context window of a critic (annex C, §C.3;
 * F100-FR-230, F100-FR-231).
 *
 * T162 (`src/enums/completion-forms.ts`) holds the two forms of the
 * `completion` level and the proof each needs, as the table of §C.3 states it.
 * This module adds what the two amendments state and the table does not:
 *
 *  - F100-FR-230: the proof must show that the call ran in a session of its
 *    own, in one of three ways, and must record which. Case 3 is the weaker
 *    proof, for a tested harness adapter only. A proof that fails refuses a
 *    *configured* critic with `critic_not_toolless`, which halts the run, and
 *    passes over an *automatically picked* one. Under the `parity` profile no
 *    proof is made, as at the baseline (rows 28 and 117 of annex X §X.7).
 *  - F100-FR-231: a critic runs only on a model whose context window is known.
 *    A declared window always wins; where a declared and an effective window
 *    differ the smaller is used. A model whose window is not known does not
 *    qualify for an automatic pick. Outside the `parity` profile a configured
 *    critic on an unlisted model with no declared window is refused by the
 *    harness adapter and no fallback window is used; under the `parity` profile
 *    the as-is fallback window of each harness applies.
 *
 * Row 128 of `data/closed-sets.json` ("Kinds of proof of the form of a critic")
 * is the closed set of the kinds; it registers through T070 in
 * `src/enums/sets-105-109.ts` and this module reads it there.
 */
import { kindsOfProofOfTheFormOfACritic } from "./sets-105-109.ts";
import {
  COMPLETION_FORMS,
  FAILURE_WHEN_THE_PROOF_IS_MISSING,
  SESSION_PROOF_CASES,
  WEAKER_PROOF_FACTS,
  WEAKER_SESSION_PROOF_CASE,
  type CompletionForm,
  type SessionProofCase,
} from "./completion-forms.ts";

/** The section of annex C that owns both rules. */
export const ANNEX_SECTION = "annex C, §C.3" as const;

/** The row of annex X §X.6 that closes the kinds of proof. */
export const CLOSED_SET_ROW = 128 as const;

/* ------------------------------------------------------------------ *
 * F100-FR-230 — the proof of the session, with its three cases.
 * ------------------------------------------------------------------ */

/**
 * Row 128 — the kinds of proof of the form of a critic, as the closed set of
 * annex X §X.6 holds them. `initial-record` and `pinned-configuration` prove
 * the first form; `read-only-sandbox` proves the second.
 */
export const CRITIC_PROOF_KINDS = kindsOfProofOfTheFormOfACritic.members;
export type CriticProofKind = (typeof CRITIC_PROOF_KINDS)[number];

/** The closed set of row 128, with its unknown-value rule. */
export const criticProofKinds = kindsOfProofOfTheFormOfACritic;

/** True when the value is a kind of row 128. */
export function isCriticProofKind(value: string): value is CriticProofKind {
  return kindsOfProofOfTheFormOfACritic.has(value);
}

/** The kind of proof each form of the `completion` level rests on (§C.3). */
export const PROOF_KIND_OF_FORM: Readonly<Record<CompletionForm, readonly CriticProofKind[]>> =
  Object.freeze({
    "tool-less": Object.freeze(["initial-record", "pinned-configuration"] as CriticProofKind[]),
    "read-only-tools": Object.freeze(["read-only-sandbox"] as CriticProofKind[]),
  });

/**
 * F100-FR-230 — the three ways the proof may show that the call ran in a
 * session of its own, in the order of the requirement:
 *
 *  1 `caller-minted-id`: the harness takes a session id from the caller, and
 *    the initial record shows the id that the runtime minted;
 *  2 `harness-given-id`: the harness gives the id itself, and the id of the
 *    initial record equals no session id of any pass of the run;
 *  3 `no-session-in-the-initial-record`: the initial record carries no session,
 *    and the weaker proof applies, for a tested harness adapter only.
 */
export const SESSION_PROOF_CASE_NUMBERS: Readonly<Record<SessionProofCase, 1 | 2 | 3>> =
  Object.freeze({
    "caller-minted-id": 1,
    "harness-given-id": 2,
    "no-session-in-the-initial-record": 3,
  });

/** The three cases, in the order of F100-FR-230. */
export const SESSION_PROOF_CASE_COUNT = 3 as const;
export { SESSION_PROOF_CASES, WEAKER_SESSION_PROOF_CASE, type SessionProofCase };

/** F100-FR-230 — which of the three ways was taken must be recorded. */
export const THE_CASE_IS_RECORDED = true as const;

/** F100-FR-230, case 3 — the weaker proof is open to a tested harness adapter only. */
export const WEAKER_PROOF_IS_TESTED_ADAPTER_ONLY = true as const;

/** F100-FR-230, case 3 — the three facts the weaker proof rests on. */
export const WEAKER_PROOF_RESTS_ON = WEAKER_PROOF_FACTS;

/** F100-FR-230, case 3 — it is recorded as the weaker proof on every call that rests on it. */
export const WEAKER_PROOF_IS_RECORDED_ON_EVERY_CALL = true as const;

/** What each case needs, and whether it is the weaker proof. */
export type SessionProofCaseRule = {
  readonly case: SessionProofCase;
  readonly number: 1 | 2 | 3;
  /** What the case needs to hold, in the words of F100-FR-230. */
  readonly needs: string;
  /** True for the one weaker proof. */
  readonly weaker: boolean;
  /** True where only a tested harness adapter may use the case. */
  readonly testedHarnessAdapterOnly: boolean;
};

/** The three cases of F100-FR-230 as data, in the order of the requirement. */
export const SESSION_PROOF_CASE_RULES: readonly SessionProofCaseRule[] = Object.freeze([
  Object.freeze({
    case: "caller-minted-id" as SessionProofCase,
    number: 1 as const,
    needs:
      "the harness takes a session id from the caller, and the initial record shows the id that the runtime minted",
    weaker: false,
    testedHarnessAdapterOnly: false,
  }),
  Object.freeze({
    case: "harness-given-id" as SessionProofCase,
    number: 2 as const,
    needs:
      "the harness gives the id itself, and the id of the initial record equals no session id of any pass of the run",
    weaker: false,
    testedHarnessAdapterOnly: false,
  }),
  Object.freeze({
    case: "no-session-in-the-initial-record" as SessionProofCase,
    number: 3 as const,
    needs:
      "the initial record carries no session, and the weaker proof applies: the exact version pin, the preflight of the harness adapter and the flag set of the call",
    weaker: true,
    testedHarnessAdapterOnly: true,
  }),
]);

/** The rule of one case; refuses a case outside the three. */
export function ruleOfCase(sessionProofCase: string): SessionProofCaseRule {
  const rule = SESSION_PROOF_CASE_RULES.find((r) => r.case === sessionProofCase);
  if (rule === undefined) {
    throw new CriticProofError(
      `F100-FR-230 admits three ways of showing a session of its own ` +
        `(${SESSION_PROOF_CASES.join(", ")}); \`${sessionProofCase}\` is none of them`,
    );
  }
  return rule;
}

/** A proof that is not of §C.3. */
export class CriticProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticProofError";
  }
}

/** How a critic came to be the critic of the run (F100-FR-230). */
export const CRITIC_PROVENANCE = ["configured", "automatically-picked"] as const;
export type CriticProvenance = (typeof CRITIC_PROVENANCE)[number];

/** What a failed proof does, per provenance (F100-FR-230). */
export const ON_A_FAILED_PROOF = ["refuse-and-halt", "pass-over"] as const;
export type OnAFailedProof = (typeof ON_A_FAILED_PROOF)[number];

/** The failure a refused proof raises (§C.3, row 28, F100-FR-087). */
export const FAILURE_OF_A_REFUSED_PROOF = FAILURE_WHEN_THE_PROOF_IS_MISSING;

/** F100-FR-230 — no proof is made under the `parity` profile, for any harness. */
export const PROOF_IS_MADE_UNDER_PARITY = false as const;

/**
 * The rows of annex X §X.7 that state the absence of a proof under the
 * `parity` profile: row 28 (the as-is transport and mode of each harness,
 * which made no proof) and row 117 (`harnesses.dsh.critic.proof` = `none`).
 */
export const PARITY_ROWS_OF_THE_PROOF = [28, 117] as const;

/** The proof of one critic-class call, as the call record carries it. */
export type SessionProof = {
  /** The form of the `completion` level the call ran in. */
  readonly form: CompletionForm;
  /** The kind of proof of row 128. */
  readonly kind: CriticProofKind;
  /** Which of the three ways of F100-FR-230 was taken; always recorded. */
  readonly sessionProofCase: SessionProofCase;
  /** True where the proof rests on the weaker proof of case 3. */
  readonly weakerProof: boolean;
  /** True where the harness adapter is a tested one. */
  readonly testedHarnessAdapter: boolean;
  /** Whether the facts the case needs held. */
  readonly passed: boolean;
  /** How the critic came to be the critic of the run. */
  readonly provenance: CriticProvenance;
  /** True where the call ran under the `parity` profile. */
  readonly underParity: boolean;
};

/**
 * F100-FR-230 — what a failed proof does: it refuses a configured critic with
 * `critic_not_toolless`, which halts the run, and it passes over an
 * automatically picked one. Under the `parity` profile no proof is made, so
 * there is nothing to fail.
 */
export function outcomeOfAFailedProof(provenance: CriticProvenance): OnAFailedProof {
  return provenance === "configured" ? "refuse-and-halt" : "pass-over";
}

/**
 * Judge one proof. A proof under the `parity` profile is never judged: no
 * proof is made there, as at the baseline. A proof of case 3 made by a harness
 * adapter that is not a tested one is refused, whatever its facts
 * (F100-FR-230, §C.3 first form).
 */
export type ProofJudgment =
  | { readonly accepted: true; readonly weakerProof: boolean; readonly recorded: SessionProofCase }
  | {
      readonly accepted: false;
      readonly failure: typeof FAILURE_OF_A_REFUSED_PROOF;
      readonly consequence: OnAFailedProof;
      readonly reason: string;
    };

/** Judge one proof of a critic-class call (F100-FR-230). */
export function judgeProof(proof: SessionProof): ProofJudgment {
  if (proof.underParity) {
    // No proof is made under the `parity` profile, as at the baseline.
    return Object.freeze({
      accepted: true as const,
      weakerProof: false,
      recorded: proof.sessionProofCase,
    });
  }
  const rule = ruleOfCase(proof.sessionProofCase);
  const refuse = (reason: string): ProofJudgment =>
    Object.freeze({
      accepted: false as const,
      failure: FAILURE_OF_A_REFUSED_PROOF,
      consequence: outcomeOfAFailedProof(proof.provenance),
      reason,
    });
  if (rule.testedHarnessAdapterOnly && !proof.testedHarnessAdapter) {
    return refuse(
      `the weaker proof of F100-FR-230 case 3 is open to a tested harness adapter only`,
    );
  }
  if (!(PROOF_KIND_OF_FORM[proof.form] as readonly string[]).includes(proof.kind)) {
    return refuse(
      `the form \`${proof.form}\` is proved by ` +
        `${PROOF_KIND_OF_FORM[proof.form].join(" or ")}, not by \`${proof.kind}\``,
    );
  }
  if (!proof.passed) return refuse(`the facts of case ${String(rule.number)} did not hold`);
  return Object.freeze({
    accepted: true as const,
    weakerProof: rule.weaker,
    recorded: proof.sessionProofCase,
  });
}

/* ------------------------------------------------------------------ *
 * F100-FR-231 — the rule for the context window of a critic.
 * ------------------------------------------------------------------ */

/** F100-FR-231 — a critic runs only on a model whose context window is known. */
export const A_CRITIC_NEEDS_A_KNOWN_WINDOW = true as const;

/** The two configuration keys by which the consumer declares a window. */
export const DECLARED_WINDOW_KEYS = [
  "roles.critic.contextTokens",
  "harnesses.<id>.contextWindows",
] as const;

/** F100-FR-231 — a window the consumer declares always wins. */
export const A_DECLARED_WINDOW_ALWAYS_WINS = true as const;

/** F100-FR-231 — where a declared and an effective window differ, the smaller is used. */
export const THE_SMALLER_WINDOW_IS_USED = true as const;

/** F100-FR-231 — a model whose window is not known does not qualify for an automatic pick. */
export const AN_UNKNOWN_WINDOW_QUALIFIES_FOR_AN_AUTOMATIC_PICK = false as const;

/** F100-FR-231 — outside the `parity` profile no fallback window is used. */
export const A_FALLBACK_WINDOW_IS_USED_OUTSIDE_PARITY = false as const;

/**
 * F100-FR-231 — under the `parity` profile the as-is fallback window of each
 * harness applies: 128,000, 200,000 or 98,304 tokens, as the baseline of that
 * harness has it (DV-106, DV-111). The rows of annex X §X.7 that carry this are
 * row 28 (the as-is fallback window of each harness), row 55 (the window the
 * consumer sets) and row 57 (`prompt.critic.overWindow` = `send`).
 */
export const AS_IS_FALLBACK_WINDOWS = [128000, 200000, 98304] as const;
export type AsIsFallbackWindow = (typeof AS_IS_FALLBACK_WINDOWS)[number];

/** The rows of annex X §X.7 that the window rule rests on. */
export const PARITY_ROWS_OF_THE_WINDOW = [28, 55, 57] as const;

/** What is known of the window of a critic's model (F100-FR-231). */
export type WindowFacts = {
  /** The window the consumer declared, where they declared one. */
  readonly declared?: number | undefined;
  /** The window the harness or the catalogue reports, where one is known. */
  readonly effective?: number | undefined;
  /** True where the model is a row of the harness's list. */
  readonly listed: boolean;
  /** The as-is fallback window of the harness, for the `parity` profile only. */
  readonly asIsFallback?: AsIsFallbackWindow | undefined;
  /** True where the call runs under the `parity` profile. */
  readonly underParity: boolean;
  /** How the critic came to be the critic of the run. */
  readonly provenance: CriticProvenance;
};

/** Why a critic is refused for want of a known window (F100-FR-231). */
export const WINDOW_REFUSALS = ["window-unknown"] as const;
export type WindowRefusal = (typeof WINDOW_REFUSALS)[number];

/** What the window rule decides for one critic (F100-FR-231). */
export type WindowDecision =
  | {
      readonly known: true;
      readonly window: number;
      /** Where the window came from. */
      readonly from: "declared" | "effective" | "the-smaller-of-both" | "as-is-fallback";
    }
  | {
      readonly known: false;
      /** A configured critic is refused; an automatically picked one does not qualify. */
      readonly refusal?: WindowRefusal;
      readonly qualifiesForAnAutomaticPick: false;
      readonly reason: string;
    };

/**
 * The window in force for a critic (F100-FR-231). A declared window always
 * wins; where a declared and an effective window differ the smaller is used;
 * outside the `parity` profile a model that is not listed and for which the
 * consumer declares no window is refused, and no fallback is used; under the
 * `parity` profile the as-is fallback of the harness applies.
 */
export function windowInForce(facts: WindowFacts): WindowDecision {
  const { declared, effective } = facts;
  if (declared !== undefined && effective !== undefined) {
    return Object.freeze(
      declared === effective
        ? { known: true as const, window: declared, from: "declared" as const }
        : {
            known: true as const,
            window: Math.min(declared, effective),
            from: "the-smaller-of-both" as const,
          },
    );
  }
  // A declared window always wins, and stands alone where nothing else is known.
  if (declared !== undefined) {
    return Object.freeze({ known: true as const, window: declared, from: "declared" as const });
  }
  if (facts.listed && effective !== undefined) {
    return Object.freeze({ known: true as const, window: effective, from: "effective" as const });
  }
  if (facts.underParity && facts.asIsFallback !== undefined) {
    return Object.freeze({
      known: true as const,
      window: facts.asIsFallback,
      from: "as-is-fallback" as const,
    });
  }
  return Object.freeze({
    known: false as const,
    ...(facts.provenance === "configured" ? { refusal: "window-unknown" as WindowRefusal } : {}),
    qualifiesForAnAutomaticPick: false as const,
    reason: facts.underParity
      ? `the harness declares no as-is fallback window for this critic (F100-FR-231)`
      : `the model is not listed and the consumer declares no window; outside the ` +
        `\`parity\` profile the harness adapter refuses the critic and uses no fallback ` +
        `window (F100-FR-231)`,
  });
}

/** F100-FR-231 — whether a model may be picked automatically for the critic role. */
export function qualifiesForAnAutomaticPick(facts: WindowFacts): boolean {
  const decision = windowInForce({ ...facts, provenance: "automatically-picked" });
  return decision.known;
}

/** The two forms of the `completion` level, re-exported for a reader of this module. */
export { COMPLETION_FORMS, type CompletionForm };
