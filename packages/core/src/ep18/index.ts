/**
 * T001 — the module group of EP-18 in the core: the seam of the critic
 * strategy and the seam of the attempt planner (feature 149, plan.md, "Path
 * Conventions"; annex E §E.1).
 *
 * This index is the one entry of the group. Phase 1 filled it with the rule
 * table of the model-tier bump (T003); phase 2 adds the read-only history of a
 * phase (T005) and the two registries (T006). The two planners of Wave 1 and
 * the strategy with one critic follow in phases 3 and 5 (T009, T010, T023 to
 * T026).
 *
 * The group holds no I/O: a core package reaches files and processes through
 * the kernel and the ports of the edge packages only (F100-FR-012,
 * F100-FR-234), and a planner is a pure function (annex E §E.1, "Guarantees of
 * a planner").
 *
 * Both registries export a `POINT_ID`, an `OPERATION` and a `REFUSAL_REASONS`
 * of their own, so this index re-exports them under names that say which seam
 * they belong to.
 */
export {
  BUMP_TABLE,
  BUMP_TABLE_ID,
  BUMP_TABLE_VERSION,
  BUMP_TABLE_POINT,
  SKIP_REASON_OF_RULE,
} from "./bump-table.ts";

/* T005 — the read-only history of a phase. */
export {
  HISTORY_SOURCES,
  HISTORY_COUNTERS,
  CRITIC_REJECTIONS_COUNTER,
  CORE_NAMESPACE,
  LEDGER_LOGICAL_NAME,
  historySourcesAreNamedByTheLayout,
  buildPhaseHistory,
  attemptHistoryOf,
  countersOfThePhase,
  newestUnmetCriteriaSignature,
  signatureOfUnmetCriteria,
  attemptKindOf,
  verdictOf,
  freezeDeep,
  isReadOnlyDeeply,
  type PhaseHistory,
  type PhaseHistorySources,
  type AttemptInHistory,
  type MarkersInHistory,
  type AttemptRecordOfTheHistory,
  type VerdictRecordOfTheHistory,
  type RecoveryMarkersOfTheHistory,
  type LedgerRecordOfTheHistory,
} from "./history.ts";

/* T006 — the registry of critic strategies. */
export {
  POINT_ID as CRITIC_STRATEGY_POINT_ID,
  OPERATION as CRITIC_STRATEGY_OPERATION,
  STANDING as CRITIC_STRATEGY_STANDING,
  REFUSAL_REASONS as CRITIC_STRATEGY_REFUSAL_REASONS,
  CriticStrategyRegistrationError,
  registerCriticStrategy,
  criticStrategies,
  criticStrategyIds,
  criticStrategy,
  criticStrategyRegistryFingerprint,
  criticStrategiesAreSealed,
  sealCriticStrategies,
  resetCriticStrategiesForTest,
  type CriticStrategyRegistration,
  type RegisteredCriticStrategy,
} from "./critic-strategy.ts";

/* T009 — the call function the engine hands to a strategy, with the nonce, the
 * fresh session, the proof of the form and the parse of the reply. */
export {
  NONCE_BITS_OF_A_CALL,
  FRESH_SESSION_TRIES,
  CALL_REFUSALS,
  TOOLS_OF_THE_FIRST_FORM,
  CRITIC_CALL_EVENT,
  CRITIC_DIVERSITY_WARNING_EVENT,
  CRITIC_EVENT_NAMES,
  DIVERSITY_RESULT_WHEN_UNKNOWN,
  CriticCallError,
  createCriticCall,
  mintNonce,
  mintSessionId,
  nonceHashOf,
  toolsOfTheCall,
  criticProofKindOf,
  sessionProofCaseOf,
  proofOfTheCall,
  parseVerdictFromTheReply,
  verdictOfTheClosedSet,
  defaultCriticPromptAssembler,
  type CallRefusal,
  type CompletionCallFacts,
  type CompletionPortCall,
  type CompletionRequest,
  type CriticCallDependencies,
  type CriticCallEvent,
  type CriticCallRecord,
  type CriticPromptAssembler,
  type DiversityResult,
  type EngineCriticCall,
  type EngineCriticCallFunction,
  type ProofInput,
  type VerdictDemand,
  type VerdictParser,
} from "./critic-strategy.ts";

/* T010 — the strategy with one critic, the comparison of the model of a call
 * with the models that produced passes, and the engine side of `judge`. */
export {
  SINGLE_CRITIC_STRATEGY_ID,
  CALLS_OF_THE_SINGLE_STRATEGY,
  THE_DIVERSITY_WARNING_BLOCKS,
  NONCE_HASH_WHEN_NO_CALL_WAS_MADE,
  singleCriticStrategy,
  registerSingleCriticStrategy,
  demandOfThePhaseGate,
  diversityResultOf,
  theCriticDiversityWarningIsDue,
  judgePhaseGate,
  verdictOfTheJudgment,
  type EngineCriticStrategy,
  type JudgeDependencies,
  type PhaseGateJudgment,
  type StrategyVerdict,
} from "./critic-strategy.ts";

/* T006 — the registry of attempt planners. */
export {
  POINT_ID as ATTEMPT_PLANNER_POINT_ID,
  OPERATION as ATTEMPT_PLANNER_OPERATION,
  STANDING as ATTEMPT_PLANNER_STANDING,
  REFUSAL_REASONS as ATTEMPT_PLANNER_REFUSAL_REASONS,
  PLANNER_ORDER,
  RECOVERY_PLANNER_ID,
  TIER_BUMP_PLANNER_ID,
  AttemptPlannerRegistrationError,
  registerAttemptPlanner,
  attemptPlanners,
  attemptPlannersInOrder,
  attemptPlannerIds,
  attemptPlanner,
  attemptPlannerRegistryFingerprint,
  attemptPlannersAreSealed,
  sealAttemptPlanners,
  resetAttemptPlannersForTest,
  type AttemptPlannerRegistration,
  type RegisteredAttemptPlanner,
} from "./attempt-planner.ts";

/* T023 — the seam of the attempt planner with the fixed order of the planners. */
export {
  KINDS_THE_RECOVERY_CYCLE_MAY_GIVE,
  KIND_A_LATER_PLANNER_MAY_INTRODUCE,
  FRESH_SESSION_IN_EVERY_CASE,
  EXIT_CODES_FROM_A_PLANNER,
  STOP_REASONS_FROM_A_PLANNER,
  A_PLANNER_CHANGES_NO_COUNT,
  GUARD_FAILURE_FALLS_BACK_TO,
  NO_CONTRIBUTION,
  recoveryCycleKindOf,
  planNextAttempt,
  type AttemptPlannerInput,
  type PlannerCallInput,
  type PlannerContribution,
  type PlannerFailure,
  type PlannedNextAttempt,
  type AttemptPlannerEvent,
  type SeamAttemptPlanner,
  type ModelTierRung,
  type CriticClassCall,
  type RecordedQuotaOfATarget,
} from "./attempt-planner.ts";

/* T024 — the planner of the recovery cycle, always on. */
export {
  THE_RECOVERY_PLANNER_IS_ALWAYS_ON,
  FACTS_THE_RECOVERY_PLANNER_READS,
  RECOVERY_KIND_PRECEDENCE,
  recoveryKindOf,
  recoveryFactsOfThePhaseHistory,
  recoveryFactsOfTheAttemptHistory,
  recoveryCyclePlanner,
  registerRecoveryPlanner,
  type RecoveryFacts,
} from "./planner-recovery.ts";

/* T025 and T026 — the planner of the model-tier bump, off by default. */
export {
  TIER_BUMP_OPTION_KEY,
  TIER_BUMP_AFTER_KEY,
  TIER_BUMP_PARITY_ROW,
  K_PARITY_ROW,
  DEFAULT_K,
  THE_OPTION_IS_OFF_BY_DEFAULT,
  THE_OPTION_OFF_CONTRIBUTES_NOTHING,
  THE_PHASE_ATTEMPT_AFTER_A_BUMP_STARTS_A_FRESH_SESSION,
  A_BUMP_NEVER_MOVES_TO_ANOTHER_HARNESS,
  NO_CALL_IS_MADE_TO_FIND_OUT_THE_QUOTA,
  BUMP_AND_ESCALATION_SHARE_NO_COUNT,
  BUMP_SIGNALS,
  BUMP_EVENT,
  BUMP_SKIPPED_EVENT,
  BUMP_OFF_EVENT,
  TIER_BUMP_EVENT_NAMES,
  VERDICTS_THAT_COUNT_TOWARDS_K,
  FIELDS_OF_A_BUMP,
  rowOfTheOption,
  rowOfK,
  theBumpIsOn,
  kOfTheBump,
  rungAbove,
  hasHigherTier,
  targetOfTheBump,
  targetIsCriticModel,
  targetSharesOnlyTheModel,
  targetQuotaExhausted,
  signalsOfTheBump,
  loadTheBumpTable,
  bindSignalOperands,
  bumpOutcomeOf,
  skipReasonOfTheRule,
  evaluateTheBumpRule,
  tierBumpEventOf,
  bumpOffForTheRunEventOf,
  planTheTierBump,
  tierBumpPlanner,
  registerTierBumpPlanner,
  rejectionCountsTowardsK,
  criticRejectionsAfter,
  ledgerAppendOfTheCriticRejectionCount,
  criticRejectionsOfThePhase,
  countersResetOnPurpose,
  countersOfTheNextPhase,
  theBumpReachesTheCritic,
  type BumpSignals,
  type TargetOfTheBump,
  type PhaseGateOutcomeForTheCount,
  type LedgerAppendOfTheCount,
} from "./planner-tier-bump.ts";

import { sealCriticStrategies as sealStrategies } from "./critic-strategy.ts";
import { sealAttemptPlanners as sealPlanners } from "./attempt-planner.ts";

/**
 * F100-FR-016 — the launch seals both registries of EP-18 at once. The engine
 * calls this once, after the process has filled them and before the run starts;
 * every registration offered afterwards is refused.
 */
export function sealEp18Registries(): void {
  sealStrategies();
  sealPlanners();
}
