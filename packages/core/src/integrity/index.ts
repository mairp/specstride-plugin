/**
 * T001 — the module group of the integrity facts of the phase gate in the core
 * (feature 149, plan.md, "Path Conventions").
 *
 * The group holds the invariants that keep everything else away from the phase
 * gate (F149-FR-007; R23 IR-01, IR-04, IR-06, IR-07) and the two facts that are
 * told to the critic and never halt a run: the comparison of the tree at phase
 * entry with the approved tree of the phase before (F149-FR-008, DV-077) and
 * the phase gate with a changed protected set (F149-FR-009, DV-076).
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `gate-writers-guard.ts` | T014 | F149-FR-007 (IR-01, IR-06) |
 * | `layer-calls.ts` | T015 | F149-FR-007 (IR-05, IR-07) |
 * | `phase-entry.ts` | T016 | F149-FR-008 |
 * | `protected-set.ts` | T017 | F149-FR-009 |
 *
 * The group holds no I/O for the same reason as `../ep18/`: a core package
 * reads the tree through the port of the tree store and the kernel
 * (F100-FR-012, F100-FR-234).
 *
 * `phase-entry.ts` and `protected-set.ts` each hold a `PARITY_ROW`, a
 * `SWITCH_KEY`, an `INTEGRITY_KIND` and a `theEventIsAVerdict` of their own, so
 * this index re-exports them under names that say which fact they belong to.
 */

/* T014 — the guard that hands the writers of the phase gate to the phase gate
 * only, and the counts of the phase gate that no event of a layer moves. */
export {
  GATE_WRITER_IDS,
  GATE_RECORDS,
  GATE_RECORD_NAMES,
  GATE_WRITER_MODULES,
  HOLDER_KINDS,
  THE_ONLY_HOLDER,
  HOLDERS_THAT_NEVER_HOLD_A_WRITER,
  COUNTS_OF_THE_PHASE_GATE,
  CORE_NAMESPACE,
  A_LAYER_EVENT_CHANGES_A_COUNT,
  GateWritersRefused,
  mayHoldTheGateWriters,
  gateWritersFor,
  withoutGateWriters,
  keyIsAGateWriter,
  writersOfTheGateRecords,
  gateRecordsHaveOneWriter,
  theWriterOfTheGateRecords,
  snapshotOfTheCounts,
  countsThatChanged,
  recordLayerEvent,
  type GateWriterId,
  type GateWriter,
  type GateWriters,
  type Holder,
  type HolderKind,
  type ServicesWithoutGateWriters,
  type CountOfThePhaseGate,
  type CountsSnapshot,
  type LayerEvent,
  type LayerLedgerRecord,
} from "./gate-writers-guard.ts";

/* T015 — the calls of the loop layer at `onEvidence` and
 * `contributeCriticInput`, and the layer off for the phase attempt. */
export {
  CALL_POINTS_AROUND_THE_PHASE_GATE,
  BOTH_ARE_CALL_POINTS_OF_THE_ANNEX,
  STEPS_OF_THE_PHASE_GATE,
  STEP_BEFORE_THE_PHASE_GATE,
  STEP_BEFORE_THE_CRITIC_PROMPT,
  VALUE_WHEN_UNKNOWN,
  VALUE_WHEN_UNKNOWN_IS_THE_ANNEX_VALUE,
  DIRECTIVE_ON_A_FAILURE,
  DIRECTIVE_ON_A_FAILURE_IS_OF_THE_SET,
  LAYER_CALL_EVENT,
  LAYER_OFF_EVENT,
  LAYER_EVENT_NAMES,
  OFF_REASONS,
  EXIT_CODES_ADDED,
  STOP_REASONS_ADDED,
  A_FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON,
  EXIT_CODES_OF_THE_ENGINE,
  STOP_REASONS_OF_THE_ENGINE,
  callTheLayerAt,
  isOnEvidenceReturn,
  isContributeCriticInputReturn,
  walkThePhaseGate,
  theClassicWalk,
  exitCodesAreASubset,
  stopReasonsAreASubset,
  addedByTheOptions,
  annexCallPointOf,
  type CallPointAroundThePhaseGate,
  type ContributeCriticInputReturn,
  type FactBlockRow,
  type LayerAtThePhaseGate,
  type LayerCallEvent,
  type LayerCallFailure,
  type LayerCallOutcome,
  type OffReason,
  type OnEvidenceReturn,
  type PhaseGateWalk,
  type PhaseGateWalkDependencies,
  type StepOfThePhaseGate,
  type VerificationGate,
  type VerificationGateResult,
} from "./layer-calls.ts";

/* T016 — the comparison of the tree at phase entry (F149-FR-008). */
export {
  PARITY_ROW as PHASE_ENTRY_PARITY_ROW,
  SWITCH_KEY as PHASE_ENTRY_SWITCH_KEY,
  INTEGRITY_KIND as PHASE_ENTRY_INTEGRITY_KIND,
  INTEGRITY_KIND_IS_OF_THE_SET as PHASE_ENTRY_KIND_IS_OF_THE_SET,
  PHASE_ENTRY_EVENT,
  A_DIFFERENCE_BLOCKS,
  REASONS_FOR_NO_COMPARISON,
  rowOfTheSwitch as rowOfThePhaseEntrySwitch,
  defaultOfTheSwitch as defaultOfThePhaseEntrySwitch,
  valueUnderParity as phaseEntryUnderParity,
  theComparisonIsOn,
  compareTheTreeAtPhaseEntry,
  factsOf as phaseEntryFactsOf,
  theEventIsAVerdict as thePhaseEntryEventIsAVerdict,
  type ApprovalOfThePhaseBefore,
  type PhaseEntryComparison,
  type PhaseEntryEvent,
  type PhaseEntryFact,
  type PhaseEntryInput,
  type ReasonForNoComparison,
} from "./phase-entry.ts";

/* T017 — the phase gate with a changed protected set (F149-FR-009). */
export {
  PARITY_ROW as PROTECTED_SET_PARITY_ROW,
  SWITCH_KEY as PROTECTED_SET_SWITCH_KEY,
  INTEGRITY_KIND as PROTECTED_SET_INTEGRITY_KIND,
  INTEGRITY_KIND_IS_OF_THE_SET as PROTECTED_SET_KIND_IS_OF_THE_SET,
  PROTECTED_SET_EVENT,
  CONDITION,
  CONDITION_REASON,
  CONDITION_IS_OF_THE_SET,
  CONDITION_REASON_IS_OF_THE_SET,
  THE_VERIFICATION_GATE_RUNS,
  THE_RESULT_CARRIES_THE_CONDITION,
  THE_CRITIC_IS_TOLD,
  APPROVAL_STAYS_POSSIBLE,
  THE_RUN_HALTS,
  AN_INTEGRITY_EVENT_IS_A_VERDICT,
  rowOfTheSwitch as rowOfTheProtectedSetSwitch,
  defaultOfTheSwitch as defaultOfTheProtectedSetSwitch,
  valueUnderParity as protectedSetUnderParity,
  theFingerprintsAreOn,
  theGateRunsWithAChangedProtectedSet,
  withTheCondition,
  factsOf as protectedSetFactsOf,
  theEventIsAVerdict as theProtectedSetEventIsAVerdict,
  theEventHalts,
  approvalStaysPossible,
  type ChangedPath,
  type ChangedProtectedSetInput,
  type PhaseGateWithAChangedProtectedSet,
  type ProtectedSetEvent,
  type ProtectedSetFact,
  type VerificationGateRun,
} from "./protected-set.ts";
