/**
 * T039 of feature 101 — the order at the phase gate (F101-FR-005) and the
 * reading of phase evidence as a claim (F101-FR-013).
 *
 * In EVERY phase attempt the order is fixed, and nothing may be reordered,
 * skipped or cached:
 *
 *  1. the pass loop has ended and phase evidence EXISTS;
 *  2. the verification gate;
 *  3. the critic;
 *  4. the approval record.
 *
 * In verification mode `required` the verification gate runs before the critic
 * on EVERY phase attempt (B-0319). When it fails the critic is NOT called, the
 * result of the phase attempt is forced to a rejection (result code 10), and
 * the ENGINE writes the feedback of the phase attempt itself, from the result
 * record of the verification gate (F101-FR-005, F101-FR-013). No result of an
 * earlier run of a check stands in for the verification gate.
 *
 * After a failed verification gate NO verdict record exists for the phase
 * attempt (B-0328), so no `verdict` event is written and the MALFORMED streak
 * is set to 0 — which is why this module reports `verdictExists: false` on
 * that path rather than inventing a MALFORMED verdict.
 */
import type { Verdict } from "@specstride/contracts/ep/critic-strategy";
import type { VerificationMode } from "@specstride/contracts/ep/verification-source";
import { feedbackOfTheCritic, feedbackOfTheVerificationGate } from "./feedback.ts";
import {
  blocked as blockedCall,
  CONFIG_ERROR_EXIT_CODE,
  CONFIG_ERROR_STOP_REASON,
  RESULT_CODES,
  type CriticCallInputs,
  type CriticCallOutcomeOfTheEngine,
} from "./critic-call.ts";

/** F101-FR-005 — the four steps of the phase gate, in their order. */
export const ORDER_AT_THE_PHASE_GATE = Object.freeze([
  "the pass loop has ended and phase evidence exists",
  "the verification gate",
  "the critic",
  "the approval record",
]);

/** F101-FR-005 — the mode in which the gate runs before the critic every time. */
export const MODE_THAT_GATES_EVERY_PHASE_ATTEMPT: VerificationMode = "required";

/** F101-FR-005 — no earlier run of a check stands in for the verification gate. */
export const AN_EARLIER_RESULT_STANDS_IN = false as const;

/** F101-FR-005 — the result code a failed verification gate forces. */
export const RESULT_CODE_OF_A_FAILED_VERIFICATION_GATE = RESULT_CODES.rejectedOrMalformed;

/** B-0328 — after a failed verification gate there is no verdict record. */
export const A_FAILED_VERIFICATION_GATE_LEAVES_A_VERDICT = false as const;

/** F101-FR-013 — the logical name of the phase evidence the critic judges. */
export const PHASE_EVIDENCE_LOGICAL_NAME = "gate:<N>:evidence" as const;

/**
 * F101-FR-013 — how the engine reads phase evidence: AS A CLAIM. As a regular
 * file, without following links, and with bytes that are no valid text
 * REPLACED and not refused (B-0872).
 */
export const HOW_PHASE_EVIDENCE_IS_READ = Object.freeze({
  asARegularFile: true,
  followsLinks: false,
  invalidBytes: "replaced",
  refusesInvalidBytes: false,
});

/** The result record of the verification gate, as this module reads it (§E.4). */
export type VerificationGateResult = {
  /** 0 passed, 10 failed, 3 a verification error, 11 a staged command failed. */
  readonly exit_code: number;
  /** The hash of the result record; the approval record binds to it. */
  readonly hash: string;
  readonly mode: VerificationMode;
  readonly roster: readonly { readonly name: string; readonly status: string }[];
  readonly criteria?: readonly string[];
};

/** True when the result record says the verification gate passed. */
export function verificationGatePassed(result: VerificationGateResult): boolean {
  return result.exit_code === 0;
}

/** What the engine hands in to run one phase gate. */
export type PhaseGateInputs = {
  readonly phase: number;
  readonly ordinal: number;
  /** Whether the pass loop has ended; step 1 of the order. */
  readonly passLoopHasEnded: boolean;
  /** Whether phase evidence exists; step 1 of the order. */
  readonly phaseEvidenceExists: boolean;
  readonly mode: VerificationMode;
  /** The nine inputs of the critic call (F101-FR-009). */
  readonly criticCallInputs: CriticCallInputs;
};

/** What the phase gate needs from outside. */
export type PhaseGateDependencies = {
  /**
   * Run the verification gate NOW. The engine calls this through the check
   * runner port; a result of an earlier run is never accepted in its place.
   */
  readonly runVerificationGate: () => Promise<VerificationGateResult>;
  /** Make the critic call (`./critic-call.ts`). */
  readonly callTheCritic: () => Promise<CriticCallOutcomeOfTheEngine>;
  /** Write the feedback of the phase attempt, replacing earlier feedback. */
  readonly writeFeedback: (text: string) => void;
  /**
   * The REPLY of the critic call, as the harness adapter gave it back.
   *
   * F101-FR-012 asks that the feedback of a rejected phase attempt hold "the
   * reply of the critic as it was, or `(no critic output)`". The judgment of
   * the seam carries the verdict record and the record of every call, but not
   * the reply — by design, because a verdict record holds the hash of the
   * nonce and not the bytes of a session. So the composition root, which is
   * the one place that saw the reply, hands it over here.
   *
   * Where it is absent the feedback falls back to the unmet criteria of the
   * verdict record, which is all that is then known.
   */
  readonly replyOfTheCriticCall?: (() => string) | undefined;
  /**
   * The AS-IS TEXT of the detail of the parse, for a MALFORMED verdict.
   *
   * F101-FR-012 and B-0880 ask that the quoted notice of a MALFORMED feedback
   * name the detail. The detail is decided by the verdict parser, which runs
   * inside the seam, so the judgment the seam returns does not carry it: the
   * composition root, which handed the parser in, does. Where it is absent the
   * notice falls back to the message of a failure of the strategy, which is
   * the only detail then known.
   */
  readonly detailTextOfTheParse?: (() => string) | undefined;
};

/**
 * Where a phase gate ended. `blocked` arrives with T069: a failed
 * critic-class call that the quota classifier classes as `quota_credit` or as
 * `auth` leaves the run blocked on the consumer, and NOTHING is scored
 * (F101-FR-010, F101-FR-041), so it is neither an approval nor a rejection.
 */
export const PHASE_GATE_OUTCOMES = [
  "approved",
  "rejected",
  "gate-failed",
  "config-error",
  "no-evidence",
  "blocked",
] as const;
export type PhaseGateOutcomeName = (typeof PHASE_GATE_OUTCOMES)[number];

/** What one phase gate reports back. */
export type PhaseGateOutcome = {
  readonly outcome: PhaseGateOutcomeName;
  /** The verdict where a critic call was made; otherwise absent. */
  readonly verdict?: Verdict;
  /** B-0328 — false after a failed verification gate. */
  readonly verdictExists: boolean;
  /** The steps that actually ran, in order: the proof of F101-FR-005. */
  readonly stepsRun: readonly string[];
  /** The result code of the phase attempt. */
  readonly resultCode: number;
  /** Whether the critic was called at all. */
  readonly criticWasCalled: boolean;
  /** The result record of the verification gate, where it ran. */
  readonly verification?: VerificationGateResult;
  /** The outcome of the critic call, where it was made. */
  readonly criticOutcome?: CriticCallOutcomeOfTheEngine;
  /** Where the gate halts the run: the exit code and the stop reason. */
  readonly halt?: {
    readonly exitCode: number;
    readonly stopReason: string;
    readonly message: string;
  };
  /**
   * F101-FR-041 — where the gate leaves the run blocked on the consumer: the
   * blocked reason of the closed set, what is needed, and the end of the table
   * of blocked reasons. Nothing is scored on this path.
   */
  readonly blocked?: {
    readonly reason: string;
    readonly needs: string;
    readonly stopReason: string;
    readonly exitCode: number;
    readonly retryable: false;
  };
  /** The feedback the ENGINE wrote, where it wrote it itself. */
  readonly feedbackWrittenByTheEngine?: string;
};

/**
 * F101-FR-005 and F101-FR-013 — run one phase gate, in the fixed order.
 *
 * `stepsRun` is the record of what happened, in the order it happened, so a
 * test can assert the ORDER and not merely the outcome.
 */
export async function runPhaseGate(
  inputs: PhaseGateInputs,
  deps: PhaseGateDependencies,
): Promise<PhaseGateOutcome> {
  const stepsRun: string[] = [];

  // Step 1 — the pass loop has ended and phase evidence exists. Missing phase
  // evidence at a critic call is a CONFIGURATION ERROR (result code 3) whose
  // message names the LOGICAL NAME of the phase evidence (F101-FR-013).
  stepsRun.push(ORDER_AT_THE_PHASE_GATE[0] as string);
  if (!inputs.passLoopHasEnded || !inputs.phaseEvidenceExists) {
    return Object.freeze({
      outcome: "no-evidence" as const,
      verdictExists: false,
      stepsRun: Object.freeze([...stepsRun]),
      resultCode: RESULT_CODES.configError,
      criticWasCalled: false,
      halt: Object.freeze({
        exitCode: CONFIG_ERROR_EXIT_CODE,
        stopReason: CONFIG_ERROR_STOP_REASON,
        message: `phase evidence not found: ${PHASE_EVIDENCE_LOGICAL_NAME}`,
      }),
    });
  }

  // Step 2 — the verification gate. In mode `required` it runs on EVERY phase
  // attempt, before the critic, and it is run NOW.
  let verification: VerificationGateResult | undefined;
  if (inputs.mode === MODE_THAT_GATES_EVERY_PHASE_ATTEMPT) {
    stepsRun.push(ORDER_AT_THE_PHASE_GATE[1] as string);
    verification = await deps.runVerificationGate();
    if (!verificationGatePassed(verification)) {
      // The critic is NOT called; the result is forced to a rejection; the
      // engine writes the feedback itself, from the result record.
      const feedback = feedbackOfTheVerificationGate({
        phase: inputs.phase,
        mode: verification.mode,
        roster: verification.roster,
        ...(verification.criteria === undefined ? {} : { criteria: verification.criteria }),
      });
      deps.writeFeedback(feedback);
      return Object.freeze({
        outcome: "gate-failed" as const,
        verdictExists: A_FAILED_VERIFICATION_GATE_LEAVES_A_VERDICT,
        stepsRun: Object.freeze([...stepsRun]),
        resultCode: RESULT_CODE_OF_A_FAILED_VERIFICATION_GATE,
        criticWasCalled: false,
        verification,
        feedbackWrittenByTheEngine: feedback,
      });
    }
  }

  // Step 3 — the critic.
  stepsRun.push(ORDER_AT_THE_PHASE_GATE[2] as string);
  const criticOutcome = await deps.callTheCritic();
  if (criticOutcome.halted) {
    return Object.freeze({
      outcome: "config-error" as const,
      verdictExists: false,
      stepsRun: Object.freeze([...stepsRun]),
      resultCode: criticOutcome.result.exit_code,
      criticWasCalled: false,
      ...(verification === undefined ? {} : { verification }),
      criticOutcome,
      halt: Object.freeze({
        exitCode: criticOutcome.exitCode,
        stopReason: criticOutcome.stopReason,
        message: criticOutcome.message,
      }),
    });
  }

  // F101-FR-041 — a failed call the classifier classed `quota_credit` or
  // `auth`: the run rests blocked on the consumer. Nothing is scored, so no
  // feedback is written and no verdict exists for the phase attempt.
  if (blockedCall(criticOutcome)) {
    return Object.freeze({
      outcome: "blocked" as const,
      verdictExists: false,
      stepsRun: Object.freeze([...stepsRun]),
      resultCode: RESULT_CODES.error,
      criticWasCalled: true,
      ...(verification === undefined ? {} : { verification }),
      criticOutcome,
      blocked: Object.freeze({
        reason: criticOutcome.path.reason,
        needs: criticOutcome.path.needs,
        stopReason: criticOutcome.path.stopReason,
        exitCode: criticOutcome.path.exitCode,
        retryable: false as const,
      }),
    });
  }

  const verdict = criticOutcome.verdict;
  if (verdict !== "APPROVED") {
    // F101-FR-012 — on REJECTED and on MALFORMED the engine writes the
    // feedback of the phase attempt, replacing earlier feedback of the phase.
    const feedback = feedbackOfTheCritic({
      phase: inputs.phase,
      verdict,
      detailText: deps.detailTextOfTheParse?.() ?? criticOutcome.judgment.failure ?? "",
      reply:
        deps.replyOfTheCriticCall?.() ?? criticOutcome.judgment.record.unmetCriteria.join("\n"),
    });
    deps.writeFeedback(feedback);
    return Object.freeze({
      outcome: "rejected" as const,
      verdict,
      verdictExists: true,
      stepsRun: Object.freeze([...stepsRun]),
      resultCode: criticOutcome.result.exit_code,
      criticWasCalled: true,
      ...(verification === undefined ? {} : { verification }),
      criticOutcome,
    });
  }

  // Step 4 — the approval record. It is the CALLER's step (T043), because only
  // the engine writes an approval record; the gate reports that the order
  // reached it.
  stepsRun.push(ORDER_AT_THE_PHASE_GATE[3] as string);
  return Object.freeze({
    outcome: "approved" as const,
    verdict,
    verdictExists: true,
    stepsRun: Object.freeze([...stepsRun]),
    resultCode: criticOutcome.result.exit_code,
    criticWasCalled: true,
    ...(verification === undefined ? {} : { verification }),
    criticOutcome,
  });
}
