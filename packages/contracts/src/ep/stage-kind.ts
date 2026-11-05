/**
 * T147 — the interface types of EP-19, the stage kind and the precondition
 * check, from `contracts/extension-points/EP-19.stage-kind.json` and annex F,
 * §F.7 (F100-FR-166, F100-FR-167).
 *
 * `specstride.stage-kind/1`. Two registries: stage kinds and precondition
 * checks. A launch contract names a kind of stage and a kind of check by id,
 * so that a new kind needs no change of the schema of the launch contract, of
 * its validator or of the stage executor.
 */
export const POINT_ID = "specstride.stage-kind/1" as const;
export const EP = "EP-19" as const;
export const ANNEX_SECTION = "annex F, §F.7" as const;

/** F100-FR-166 — the operations of the point; the names are the reading of CQ-022. */
export const OPERATIONS = ["validate", "run", "evaluate"] as const;
export type StageKindOperation = (typeof OPERATIONS)[number];

/** The two registries of the point (§F.7, Id and version). */
export const REGISTRIES = ["stage-kinds", "precondition-checks"] as const;
export type RegistryName = (typeof REGISTRIES)[number];

/** F100-FR-166 — the five built-in stage kinds. */
export const BUILT_IN_STAGE_KINDS = [
  "setup",
  "decision",
  "command",
  "specstride",
  "smoke",
] as const;
export type StageKindId = (typeof BUILT_IN_STAGE_KINDS)[number] | string;

/** F100-FR-166 — the six built-in precondition checks. */
export const BUILT_IN_PRECONDITION_CHECKS = [
  "file_exists",
  "dir_exists",
  "env_set",
  "command_available",
  "command_success",
  "json_field_equals",
] as const;
export type PreconditionCheckId = (typeof BUILT_IN_PRECONDITION_CHECKS)[number] | string;

/** The timing of a precondition check (§F.7, Inputs). */
export const CHECK_TIMINGS = ["preflight", "stage"] as const;
export type CheckTiming = (typeof CHECK_TIMINGS)[number];

/** The outcome of `evaluate` (§F.7, Outputs). */
export const EVALUATE_OUTCOMES = ["pass", "fail", "deferred"] as const;
export type EvaluateOutcome = (typeof EVALUATE_OUTCOMES)[number];

/** The flags of the launch a stage kind is handed (§F.7, Inputs). */
export type LaunchFlags = { readonly implement: boolean; readonly smoke: boolean };

/** One finding of `validate`. */
export type StageFinding = { readonly message: string; readonly stage?: string };

/** The result of `run` (§F.7, Outputs). */
export type StageRunResult = {
  readonly exitCode: number;
  /** A stage reason from the closed families of annex E §E.3. */
  readonly stageReason: string;
  readonly digestEvidencePath: string;
};

/** F100-FR-166 — one entry of the registry of stage kinds. */
export type StageKind = {
  readonly id: StageKindId;
  validate(stage: Readonly<Record<string, unknown>>): readonly StageFinding[];
  run(
    stage: Readonly<Record<string, unknown>>,
    flags: LaunchFlags,
    environment: Readonly<Record<string, string>>,
    timeLimitMs: number,
  ): Promise<StageRunResult>;
};

/** F100-FR-166 — one entry of the registry of precondition checks. */
export type PreconditionCheck = {
  readonly id: PreconditionCheckId;
  evaluate(
    declared: Readonly<Record<string, unknown>>,
    timing: CheckTiming,
    dryRun: boolean,
  ): Promise<EvaluateOutcome>;
};

/** "Errors" of §F.7: a kind or a check the registries do not hold. */
export const INVALID_LAUNCH_CONTRACT_PIPELINE_CODE = 20 as const;

/** "Guarantees of the core" of §F.7, as data. */
export const CORE_GUARANTEES = [
  "the stage executor runs stages in the declared order, one at a time",
  "it applies the in-stage retry policy of the launch contract",
  "it reads the outcome of a stage of kind `specstride` from the terminal record of the engine",
  "it strips the pinned keys of the launch contract from the environment of every child",
] as const;

/** A stage whose child exits 6 ends the pipeline with code 22 and the state `stopped`. */
export const CHILD_EXIT_THAT_ENDS_THE_PIPELINE = 6 as const;
export const PIPELINE_CODE_WHEN_A_CHILD_EXITS_6 = 22 as const;
export const PIPELINE_STATE_WHEN_A_CHILD_EXITS_6 = "stopped" as const;

/** "Guarantees of an implementation" of §F.7, as data. */
export const IMPLEMENTATION_GUARANTEES = [
  "a stage kind runs a fixed argument list without a shell",
  "a precondition check reads and never writes",
  "in a dry run it executes nothing and reports `deferred` where it would have to execute",
] as const;

/**
 * "Failure of an implementation" of §F.7 — the plainer path: a stage kind
 * that throws ends the stage with the stage reason `exec-error:` and its
 * detail; a check that throws is `fail`.
 */
export const STAGE_REASON_ON_A_THROW = "exec-error:" as const;
export const CHECK_OUTCOME_ON_A_THROW: EvaluateOutcome = "fail";
export const FAILURE_PATHS: Readonly<Record<StageKindOperation, string>> = Object.freeze({
  validate: "the launch contract is invalid (pipeline code 20)",
  run: "the stage ends with the stage reason `exec-error:` and its detail",
  evaluate: "`fail`",
});

/**
 * Unknown-value rule of §F.7: an unknown stage kind and an unknown check type
 * each make the launch contract invalid. The as-is legacy spelling of the
 * stage kind `specstride` is not accepted.
 */
export const AS_IS_LEGACY_SPELLING_IS_ACCEPTED = false as const;
export function unknownKindMessage(registry: RegistryName, id: string): string {
  return (
    `the launch contract is invalid (pipeline code 20): the registry ` +
    `\`${registry}\` holds no entry \`${id}\` (annex F, §F.7)`
  );
}

/** F100-FR-167 — the keys a launch contract pins, and no other. */
export const PINNED_KEYS_SUBJECTS = [
  "the learning mode",
  "the bound of learning decisions",
  "live output in a run without a terminal",
] as const;
/** The value from the shell is stripped in every child of the runtime root. */
export const THE_VALUE_FROM_THE_SHELL_IS_STRIPPED = true as const;
