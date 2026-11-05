/**
 * The types the stage executor and the two registries share (feature 123,
 * §R.3, §R.4; F123-FR-010 context).
 *
 * The stage executor is a pure sequence over injected ports (clock, process
 * starter, state writer, event writer, registries), so that every rule has a
 * fake-clock test (plan.md, Approach).
 */
/** The five built-in kinds of §R.3 (the Wave 1 of the open registry, row 25). */
export const BUILTIN_STAGE_KINDS = ["setup", "decision", "command", "specstride", "smoke"] as const;
export type StageKind = (typeof BUILTIN_STAGE_KINDS)[number];

/** The six built-in precondition checks of §R.3 (the Wave 1 of the open registry, row 25). */
export const BUILTIN_PRECONDITION_CHECKS = [
  "file_exists",
  "dir_exists",
  "env_set",
  "command_available",
  "command_success",
  "json_field_equals",
] as const;
export type PreconditionCheckName = (typeof BUILTIN_PRECONDITION_CHECKS)[number];

/** The timing of a precondition (§G.8). */
export type ConditionTiming = "preflight" | "stage" | "postcondition";

/** One precondition or postcondition: a check of the registry, with its timing. */
export type Condition = {
  check: string;
  timing: ConditionTiming;
  /** The parameters of the check: path, name, command, file, field, value. */
  params: Record<string, unknown>;
};

/** One entry of the environment of an action. */
export type ActionEnvironmentEntry = {
  name: string;
  target?: string;
  required: boolean;
  value?: string;
};

/** The action of a stage: a fixed argument list, no shell (F123-FR-011). */
export type Action = {
  argv: string[];
  cwd?: string;
  env?: ActionEnvironmentEntry[];
  timeLimitSeconds?: number;
};

/** The declared recovery of a stage (F123-FR-012). */
export type Recovery = {
  maxAttempts: number;
  exitCodes: number[];
  backoffSeconds: number[];
  totalSeconds?: number;
  /** The reason rule: the newest stop reason must be one of these to retry. */
  reasonRule?: { allowed: readonly string[] };
};

/** One stage of the launch contract, as the executor sees it. */
export type Stage = {
  id: string;
  kind: StageKind | string;
  dependencies: string[];
  cwd?: string;
  action?: Action;
  resumeAction?: Action;
  preconditions: Condition[];
  postconditions: Condition[];
  recovery?: Recovery;
  /** `setup` or `smoke`: the markers of §R.1. */
  smoke?: boolean;
  evidence?: string | null;
};

/**
 * The clock port: `now()` in milliseconds since the epoch, `sleep(ms)`
 * awaiting to the time reached — the same two members as the fake clock of
 * `tests/characterization/123/support/clock.ts`, so a test hands it in
 * unchanged.
 */
export type Clock = {
  now(): number;
  sleep(ms: number): Promise<number>;
};

/** The result of one child run (F123-FR-011). */
export type ChildResult = {
  code: number;
  signal: string | null;
  timedOut: boolean;
  /** The cause when the child could not start (`exec-error:`). */
  error?: string;
};

/** The process-starter port: the stage child runner of F123-FR-011. */
export type StageChildRunner = (input: {
  stage: Stage;
  action: Action;
  attempt: number;
  maxAttempts: number;
  env: Record<string, string>;
}) => Promise<ChildResult>;

/** The outcome of one stage: reason, child exit, evidence. */
export type StageOutcome = {
  stageId: string;
  ok: boolean;
  reason: string;
  childExitCode: number | null;
  evidence: string | null;
};
