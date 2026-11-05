/**
 * @specstride/layer-micro — the implementation `micro` of the loop-layer
 * interface EP-04 (feature 115).
 *
 * Core package: the imports are `@specstride/contracts` and `@specstride/kernel`
 * only (F100-FR-012, the package graph of annex A), and no `node:fs` or
 * `node:fs/promises` — the layer is pure logic over the read-only view of the
 * phase attempt and its ledger namespace (research.md D-1). The two things of
 * the feature that touch the file system stand behind the ports of
 * `@specstride/contracts/src/ports/layer-micro.ts` (T003); the implementations
 * are the edge package's.
 *
 * Phase 1 (T002) creates the package. The call points of EP-04 arrive with
 * T010; nothing of the layer is behaviour yet.
 */

/** The layer this package implements, as the loop-layer table names it. */
export const LAYER_NAME = "micro" as const;

/** The micro level the layer runs (closed set of F115-FR-005; L2 and L3 come later). */
export const LEVEL = "L1" as const;

/** The eight call points of EP-04 (T010), each returning `none` for now. */
export {
  CALLED_POINTS,
  type CallPointInvocation,
  type CallPoints,
  type NoneResult,
  type PhaseAttemptView,
  afterPass,
  betweenPasses,
  callPoints,
  contributeCriticInput,
  contributePrompt,
  nextPassBlock,
  onEvidence,
  report,
  resume,
} from "./callpoints/index.ts";

// Phase 3 (US1) — the unit of work, the caps and the implemented call points.
export * as register from "./register.ts";
export * as unitValidate from "./unit/validate.ts";
export * as unitTaskList from "./unit/task-list.ts";
export * as unitOutcome from "./unit/outcome.ts";
export * as capsExemptions from "./caps/exemptions.ts";
export * as contributePromptPoint from "./callpoints/contribute-prompt.ts";
export * as afterPassPoint from "./callpoints/after-pass.ts";
export * as betweenPassesPoint from "./callpoints/between-passes.ts";
export * as contributeCriticInputPoint from "./callpoints/contribute-critic-input.ts";

// Phase 4 (US2) — the repair inside the phase attempt, the caps, the router
// and the closing check.
export * as nextPassBlockPoint from "./callpoints/next-pass-block.ts";
export * as unitSignature from "./unit/signature.ts";
export * as unitFlaky from "./unit/flaky.ts";
export * as caps from "./caps/caps.ts";
export * as capsExclusions from "./caps/exclusions.ts";
export * as capsInterrupted from "./caps/interrupted.ts";
export * as capsDisengage from "./caps/disengage.ts";
export * as routerRoute from "./router/route.ts";
export * as routerEscalation from "./router/escalation.ts";
export * as closingCheck from "./closing/closing-check.ts";

// Phase 5 (US3) — the strategy pinned at launch, the fallback and the inert
// state of an attempt that has not declared a unit yet.
export * as strategySelect from "./strategy/select.ts";
export * as strategyFallback from "./strategy/fallback.ts";
export * as strategyEngaged from "./strategy/engaged.ts";

// Phase 6 (US4) — the ledger namespace `micro`, the resume call point and
// the counters that survive a resume.
export * as ledgerRecords from "./ledger/records.ts";
export * as ledgerCounters from "./ledger/counters.ts";
export * as resumePoint from "./callpoints/resume.ts";

// Phase 7 (US5) — the events of the layer, the `[LOOP]` line, the breach
// kinds and the report of a breach.
export * as reportEvents from "./report/events.ts";
export * as reportPoint from "./callpoints/report.ts";
export * as breachInvariants from "./breach/invariants.ts";
export * as breachReport from "./breach/report.ts";

// Phase 9 — beneath a stacked layer: the integrated group as one unit.
export * as integratedGroup from "./unit/integrated-group.ts";

// Phase 8 (US6) — the record of every check and the per-phase time report
// the paired design of the experiments consumes.
export * as checkTimes from "./report/check-times.ts";
