/**
 * Feature 147 — the terms gate (`src/terms/`, plan.md Project Structure).
 *
 * | Module | Content | Requirements |
 * |---|---|---|
 * | `loader.ts` | the data file: load, validation, replacement of `user:terms` | F147-FR-003, F147-FR-011, F147-FR-013 |
 * | `table.ts` | the rule table of annex X §X.3, `evaluate`, the default tier per audience | F147-FR-001 to F147-FR-004, F147-FR-008 to F147-FR-012 |
 * | `gate.ts` | the gate call: record every decision, emit `terms.override_used` | F147-FR-005, F147-FR-006, F147-FR-009 |
 * | `data/terms.json` | the shipped rows of R8v's corrected matrix (42 cells) | F147-FR-011 |
 */
export * as loader from "./loader.ts";
export * as gating from "./gate.ts";
export {
  buildTermsTable,
  defaultTier,
  evaluate,
  makeEvaluate,
  refusalWithoutTier2Credential,
  rowFor,
  SDK_TRANSPORT,
  SDK_TRANSPORT_TIER,
  SUBPROCESS_TRANSPORT,
  TERMS_POINT,
  TERMS_TABLE_ID,
  TERMS_TABLE_VERSION,
  asAudience,
  asAuthTier,
  shippedData,
} from "./table.ts";
export type { TermsGateDecision } from "./table.ts";
export {
  loadTermsData,
  resolveTermsData,
  shippedTermsData,
  SHIPPED_DATA_FILE,
  STALE_AFTER_DAYS,
  TermsDataError,
  USER_TERMS,
  staleness,
} from "./loader.ts";
export type { ResolvedTerms, TermsData, TermsOrigin, TermsStaleness } from "./loader.ts";
export { EVALUATION_POINTS, gate, gateEntry, gateLaunch, NULL_SINK } from "./gate.ts";
export type {
  EvaluationPoint,
  FallbackSkippedEvent,
  GateSink,
  LaunchDecision,
  PlanEntry,
  TermsOverrideUsedEvent,
} from "./gate.ts";
