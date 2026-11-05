/**
 * T004 — the two values of EP-18 that no record carries: the plan of the next
 * phase attempt, which `next` of `specstride.attempt-planner/1` returns, and
 * the outcome of one critic call, which the call function of the engine returns
 * to a critic strategy (feature 149, data-model.md).
 *
 * Neither value is written as a record and neither crosses a process or a file
 * boundary, so neither gets a schema file and neither gets a schema id
 * (data-model.md, "Plan of the next phase attempt"; annex B §B.4 governs
 * records only). Each gets a type and a guard here, and the engine applies the
 * guard to what a strategy or a planner returns.
 *
 * The members of the three closed sets of this feature are read from the closed
 * sets of annex X §X.6 (rows 9, 253 and 254), so the guards and the sets cannot
 * drift: `kindsOfPhaseAttempt`, `outcomesOfTheBumpRule` and
 * `reasonsOfASkippedBump` of `../enums/sets-145-149.ts`.
 */
import {
  kindsOfPhaseAttempt,
  outcomesOfTheBumpRule,
  reasonsOfASkippedBump,
} from "../enums/sets-145-149.ts";
import { VERDICTS, type AttemptKind, type Verdict } from "./critic-strategy.ts";
import {
  isCompletionForm,
  PROOF_OUTCOMES,
  type CompletionForm,
  type CriticProofResult,
} from "../enums/completion-forms.ts";

/** The section of the design that fixes both values and their validation. */
export const DATA_MODEL_SECTIONS = [
  "Plan of the next phase attempt",
  "Outcome of one critic call",
] as const;

/** Row 253 of annex X §X.6 — the outcome of the bump rule, the choice of a row. */
export type BumpOutcome = (typeof outcomesOfTheBumpRule.members)[number];

/** Row 254 of annex X §X.6 — the reason of a skipped bump. */
export type SkippedBumpReason = (typeof reasonsOfASkippedBump.members)[number];

/**
 * The decision record of a table where one was evaluated (annex X §X.3): table
 * id, table version, decision point, rule id, signals, choice. It is the record
 * the table evaluator of the kernel returns, narrowed to the choice set of the
 * decision point `attempt-tier`.
 */
export type AttemptTierDecision = {
  readonly tableId: string;
  readonly tableVersion: string;
  readonly point: string;
  readonly ruleId: string;
  readonly signals: Readonly<Record<string, unknown>>;
  readonly choice: BumpOutcome;
};

/**
 * The plan of the next phase attempt, which `next` returns (data-model.md,
 * "Plan of the next phase attempt").
 */
export type NextAttemptPlan = {
  /** `plain`, `diagnosed`, `accelerated`, `bumped` (row 9 of annex X §X.6). */
  readonly kind: AttemptKind;
  /** The model tier of the proposer for the phase attempt. */
  readonly modelTier: string;
  /** True after a bump; a new phase attempt starts a fresh session in every case. */
  readonly freshSession: boolean;
  /** Where a table was evaluated; absent where none was. */
  readonly decision?: AttemptTierDecision;
  /** For a skip: the reason, derived from the rule that fired. Absent otherwise. */
  readonly skipReason?: SkippedBumpReason;
};

/**
 * The outcome of one critic call, which the call function of the engine returns
 * to a strategy (data-model.md, "Outcome of one critic call"). No nonce and no
 * hash of a nonce is in it (research.md D3: a strategy never sees a nonce).
 */
export type CriticCallOutcome = {
  /** APPROVED, REJECTED or MALFORMED (row 8 of annex X §X.6). */
  readonly verdict: Verdict;
  /** The session the engine minted for the call. */
  readonly sessionId: string;
  /** The form of the `completion` level (row 28 of annex X §X.6). */
  readonly form: CompletionForm;
  /** The result of the proof of that form (annex C §C.3). */
  readonly proof: CriticProofResult;
  /**
   * Whether the critic-diversity warning was raised; true for the results
   * `same-model` and `unverified` of the diversity test. The field name is
   * unchanged; feature 111 owns it.
   */
  readonly sameModelWarning: boolean;
  /** As the harness reported them, or null. */
  readonly usage: Readonly<Record<string, number>> | null;
  readonly latency: number | null;
};

/**
 * The validation rule of the plan, verbatim from data-model.md: "`kind` is
 * `bumped` only when `decision.choice` is `bump` and the kind the recovery cycle
 * gave was `plain`; `skipReason` is present exactly when `decision.choice` is
 * `skip`."
 */
export const PLAN_VALIDATION_RULE: string =
  "`kind` is `bumped` only when `decision.choice` is `bump` and the kind the recovery cycle " +
  "gave was `plain`; `skipReason` is present exactly when `decision.choice` is `skip`";

/**
 * The field names no outcome of a critic call may carry: a strategy never sees
 * a nonce, in clear or as a hash (data-model.md, "Outcome of one critic call").
 */
export const FIELDS_NO_CALL_OUTCOME_CARRIES = ["nonce", "nonceHash"] as const;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every value of the map is a finite number. */
function isNumberMap(value: unknown): value is Record<string, number> {
  return (
    isRecordValue(value) && Object.values(value).every((v) => typeof v === "number" && isFinite(v))
  );
}

function isAttemptTierDecision(value: unknown): value is AttemptTierDecision {
  if (!isRecordValue(value)) return false;
  return (
    typeof value.tableId === "string" &&
    value.tableId.length > 0 &&
    typeof value.tableVersion === "string" &&
    value.tableVersion.length > 0 &&
    typeof value.point === "string" &&
    value.point.length > 0 &&
    typeof value.ruleId === "string" &&
    value.ruleId.length > 0 &&
    isRecordValue(value.signals) &&
    typeof value.choice === "string" &&
    outcomesOfTheBumpRule.has(value.choice)
  );
}

/**
 * The guard of the plan of the next phase attempt. It applies the validation
 * rule of data-model.md in full.
 *
 * `recoveryKind` is the kind the planner of the recovery cycle gave, which the
 * engine knows because it calls the two planners of Wave 1 in that order
 * (`contracts/ep18-seams.md`, "Wave 1"). The rule's second half can be judged
 * only against it, so a plan whose `kind` is `bumped` is accepted only when
 * `recoveryKind` is given and is `plain`. For every other kind the argument is
 * not read.
 */
export function isNextAttemptPlan(value: unknown, recoveryKind?: string): value is NextAttemptPlan {
  if (!isRecordValue(value)) return false;
  if (typeof value.kind !== "string" || !kindsOfPhaseAttempt.has(value.kind)) return false;
  if (typeof value.modelTier !== "string" || value.modelTier.length === 0) return false;
  if (typeof value.freshSession !== "boolean") return false;
  if (value.decision !== undefined && !isAttemptTierDecision(value.decision)) return false;
  const decision = value.decision as AttemptTierDecision | undefined;

  // "`kind` is `bumped` only when `decision.choice` is `bump` and the kind the
  // recovery cycle gave was `plain`."
  if (value.kind === "bumped" && (decision?.choice !== "bump" || recoveryKind !== "plain")) {
    return false;
  }

  // "`skipReason` is present exactly when `decision.choice` is `skip`."
  const skipIsDue = decision?.choice === "skip";
  if (skipIsDue) {
    if (typeof value.skipReason !== "string" || !reasonsOfASkippedBump.has(value.skipReason)) {
      return false;
    }
  } else if (value.skipReason !== undefined) {
    return false;
  }
  return true;
}

/**
 * The guard of the outcome of one critic call. It applies the validation rule of
 * data-model.md: every field of the table is of its type, and no nonce and no
 * hash of a nonce is in the value.
 */
export function isCriticCallOutcome(value: unknown): value is CriticCallOutcome {
  if (!isRecordValue(value)) return false;
  for (const field of FIELDS_NO_CALL_OUTCOME_CARRIES) {
    if (field in value) return false;
  }
  if (typeof value.verdict !== "string" || !(VERDICTS as readonly string[]).includes(value.verdict))
    return false;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return false;
  if (!isCompletionForm(value.form)) return false;
  if (!isRecordValue(value.proof)) return false;
  const proof = value.proof;
  if (!isCompletionForm(proof.form)) return false;
  if (
    typeof proof.outcome !== "string" ||
    !(PROOF_OUTCOMES as readonly string[]).includes(proof.outcome)
  )
    return false;
  if (typeof value.sameModelWarning !== "boolean") return false;
  if (value.usage !== null && !isNumberMap(value.usage)) return false;
  if (value.latency !== null && (typeof value.latency !== "number" || !isFinite(value.latency)))
    return false;
  return true;
}
