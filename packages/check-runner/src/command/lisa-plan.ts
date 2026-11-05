/**
 * T006 — the plan types the extracted executor of Lisa's verification
 * package reads, extracted as source from Lisa at `363e6a3`
 * (`packages/core/src/domain/verification-plan.ts`, lines 50 to 144;
 * `research.md` D-1, ruling 12). Recorded in `../../EXTRACTED.md`.
 *
 * At the baseline these are `z.infer` of zod schemas. The check runner takes
 * no dependency from npm beyond the schema validator feature 100 chose
 * (plan.md, "Primary Dependencies"), so the SHAPES are extracted as plain
 * TypeScript types. The field names, their optionality and the members of
 * every enumeration are those of the baseline, byte for byte, because the
 * executor's behaviour is defined over them: only validation moves, never a
 * field.
 */

/** `VerificationCommandKindSchema` of the baseline (line 39). */
export type VerificationCommandKind = "test" | "build" | "lint" | "format" | "custom";

/**
 * `VerificationCommandSchema` of the baseline (line 50), `.strict()`.
 * `executable` and `cwd` are absolute paths; `timeoutSec` is a positive
 * integer of at most 86400.
 */
export type VerificationCommand = {
  id: string;
  kind: VerificationCommandKind;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutSec: number;
};

/** `VerificationSuiteSchema` of the baseline (line 85), `.strict()`. */
export type VerificationSuite = {
  id: string;
  name: string;
  scope: "phase" | "cumulative" | "release";
  phase?: number;
  obligationRefs: string[];
  commandRefs: string[];
};

/** `VerificationGateSchema` of the baseline (line 97), `.strict()`. */
export type VerificationGate = {
  id: string;
  scope: "phase" | "release";
  phase?: number;
  obligationRefs: string[];
  suiteRefs: string[];
  cumulative: boolean;
  required: boolean;
};

/**
 * `VerificationPlanV1Schema` of the baseline (line 126, the shape), with the
 * fields the executor reads named explicitly. `obligations` and the other
 * fields of the shape are carried as the baseline carries them; the executor
 * reads `id`, `contentHash`, `commands`, `suites` and `gates` only.
 */
export type VerificationPlanV1 = {
  id: string;
  kind: "verification-plan";
  version: 1;
  commands: VerificationCommand[];
  suites: VerificationSuite[];
  gates: VerificationGate[];
  contentHash: string;
};
