/**
 * The plan SHAPES the extracted modules of Lisa's verification package read
 * (T006, `research.md` D-1; recorded in `../../EXTRACTED.md`).
 *
 * Extracted from `packages/core/src/domain/verification-plan.ts` of Lisa at
 * `363e6a3`, lines 8 to 140, read with
 * `git -C <lisa> show 363e6a3:packages/core/src/domain/verification-plan.ts`.
 *
 * The one change of the extraction: the zod schemas become plain TypeScript
 * types. This package imports only `@specstride/contracts` and
 * `@specstride/kernel` of the product
 * (`packages/contracts/data/package-graph.json`) and takes no dependency from
 * npm beyond the schema validator feature 100 chose, so VALIDATION moves out
 * — it is written new with the planner on the canonical spec model
 * (F105-FR-013). Every field name, every optional marker and every member of
 * every enumeration below is the baseline's.
 */

/** Lisa's `VerificationLevelSchema` (line 8). */
export type VerificationLevel =
  "unit" | "contract" | "integration" | "e2e" | "security" | "operator";

/** Lisa's `VerificationKindSchema` (line 18). */
export type VerificationKind = "positive" | "negative" | "property" | "recovery" | "effect-witness";

/** Lisa's `VerificationAutomationStatusSchema` (line 27). */
export type VerificationAutomationStatus =
  "planned" | "generated" | "executable" | "passing" | "blocked" | "manual";

/** Lisa's `VerificationCommandKindSchema` (line 39). */
export type VerificationCommandKind = "test" | "build" | "lint" | "format" | "custom";

/** Lisa's `VerificationCommandSchema` (line 50). */
export interface VerificationCommand {
  id: string;
  kind: VerificationCommandKind;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutSec: number;
}

/** Lisa's `VerificationObligationSchema` (line 63). */
export interface VerificationObligation {
  id: string;
  title: string;
  phase?: number;
  requirementRefs: string[];
  acceptanceRefs: string[];
  workItemRefs: string[];
  level: VerificationLevel;
  kind: VerificationKind;
  setup: string[];
  action: string;
  oracle: string[];
  witnesses: string[];
  negativeCases: string[];
  automationStatus: VerificationAutomationStatus;
}

/** Lisa's `VerificationSuiteSchema` (line 85). */
export interface VerificationSuite {
  id: string;
  name: string;
  scope: "phase" | "cumulative" | "release";
  phase?: number;
  obligationRefs: string[];
  commandRefs: string[];
}

/** Lisa's `VerificationGateSchema` (line 97). */
export interface VerificationGate {
  id: string;
  scope: "phase" | "release";
  phase?: number;
  obligationRefs: string[];
  suiteRefs: string[];
  cumulative: boolean;
  required: boolean;
}

/** Lisa's `VerificationPlanSourceSchema` (line 110). */
export interface VerificationPlanSource {
  bundleId: string;
  contentHash: string;
  specPath: string;
}

/** Lisa's `VerificationProjectSchema` (line 118). */
export interface VerificationProject {
  workdir: string;
  fingerprint: string;
  frameworks: string[];
}

/** Lisa's `verificationPlanShape` (line 126). */
export interface VerificationPlanV1 {
  id: string;
  kind: "verification-plan";
  version: 1;
  source: VerificationPlanSource;
  project: VerificationProject;
  obligations: VerificationObligation[];
  commands: VerificationCommand[];
  suites: VerificationSuite[];
  gates: VerificationGate[];
  assumptions: string[];
  ambiguities: string[];
  unsupportedCapabilities: string[];
  contentHash: string;
}
