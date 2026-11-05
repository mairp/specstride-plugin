/**
 * T106 — the interface types of EP-05, the check runner, from
 * `contracts/extension-points/EP-05.check-runner.json` and annex C, §C.8
 * (F100-FR-097 to F100-FR-100).
 *
 * `specstride.check-runner/1`. The verification gate, inner checks, the
 * closing check and the merge check use the same runner, so that a result
 * means the same everywhere.
 */
export const POINT_ID = "specstride.check-runner/1" as const;
export const EP = "EP-05" as const;
export const ANNEX_SECTION = "annex C, §C.8" as const;

/** F100-FR-097 — the six operations of the runner. */
export const OPERATIONS = ["pin", "start", "poll", "result", "cancel", "environment"] as const;
export type CheckRunnerOperation = (typeof OPERATIONS)[number];

/** The errors of §C.8. */
export const ERRORS = ["cannot-start", "timeout", "interrupted"] as const;
export type CheckRunnerError = (typeof ERRORS)[number];

/** F100-FR-097 — the closed set of conditions, each in a field of its own. */
export const CONDITIONS = ["tainted", "cached", "flaky", "interrupted", "unchecked"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** The reasons a condition may carry (§C.8, Outputs). */
export const CONDITION_REASONS = ["changed-during-check", "slow", "budget"] as const;
export type ConditionReason = (typeof CONDITION_REASONS)[number] | string;

/** Unknown-value rule of §C.8: an unknown condition makes the result `unchecked`. */
export const CONDITION_WHEN_UNKNOWN: Condition = "unchecked";

/** The kinds of identity `pin` can return (§C.8, Outputs). Wave 1: `command`. */
export const IDENTITY_KINDS = ["command", "steps"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

/** The identity record `pin` returns; for `command`, the executable with size and hash. */
export type PinnedIdentity = {
  readonly kind: IdentityKind;
  readonly executable?: string;
  readonly size?: number;
  readonly hash?: string;
  readonly argv?: readonly string[];
};

/** The containment levels a check may run at (§C.15). */
export type ContainmentLevel = "C0" | "C1" | "C2" | "C3";

/** The inputs of `start` (§C.8, Inputs). */
export type StartInput = {
  readonly identity: PinnedIdentity;
  readonly workingDirectory: string;
  readonly environmentAllowList: readonly string[];
  readonly timeLimitMs: number;
  readonly containment: ContainmentLevel;
};

/** A handle of a running check. */
export type CheckHandle = { readonly id: string };

/** The output of `poll` (§C.8, Outputs). */
export type PollResult = { readonly state: "running" } | { readonly state: "ended" };

/** One finding a check may report. */
export type CheckFinding = {
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
};

/** The result of a check (§C.8, Outputs): each condition in a field of its own. */
export type CheckResult = {
  readonly exitCode: number;
  readonly durationMs: number;
  /** A reference to the captured output; never the output itself. */
  readonly output: { readonly logicalName: string; readonly hash: string; readonly size: number };
  readonly tainted: boolean;
  readonly cached: boolean;
  readonly flaky: boolean;
  readonly interrupted: boolean;
  readonly unchecked: boolean;
  /** The reason of the condition that is set, where the condition carries one. */
  readonly reason?: ConditionReason;
  readonly findings?: readonly CheckFinding[];
};

/** One entry of the check manifest, as `pin` and `environment` receive it. */
export type ManifestEntry = {
  readonly id: string;
  readonly kind: IdentityKind;
  readonly argv: readonly string[];
  readonly phase: number;
  readonly timeLimitMs: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly exclusiveResource?: string;
  /** F100-FR-232 — the reuse policy of a staged command. */
  readonly reuse?: ReusePolicy;
};

/** F100-FR-232 — the reuse policies a staged command may declare. */
export const REUSE_POLICIES = ["per-attempt", "per-phase", "per-run"] as const;
export type ReusePolicy = (typeof REUSE_POLICIES)[number];

/** F100-FR-097 — the check runner, handle-based. */
export type CheckRunner = {
  pin(entry: ManifestEntry): Promise<PinnedIdentity>;
  start(input: StartInput): Promise<CheckHandle>;
  poll(handle: CheckHandle): Promise<PollResult>;
  result(handle: CheckHandle): Promise<CheckResult>;
  cancel(handle: CheckHandle): Promise<void>;
  /** Starts no process and returns no handle (§C.8, Outputs). */
  environment(entry: ManifestEntry, profile: string): Readonly<Record<string, string>>;
};

/** F100-FR-099 — the parameter, its default and its ceiling. */
export const PARALLELISM_KEY = "verification.parallelism" as const;
export const PARALLELISM_DEFAULT = 1 as const;
export const PARALLELISM_CEILING = 4 as const;

/**
 * F100-FR-099 — a command runs beside another only when the manifest declares
 * the reads and the writes of both and neither reads what the other writes.
 * An undeclared command runs alone.
 */
export function mayRunBeside(a: ManifestEntry, b: ManifestEntry): boolean {
  if (a.reads === undefined || a.writes === undefined) return false;
  if (b.reads === undefined || b.writes === undefined) return false;
  const conflicts =
    a.reads.some((r) => b.writes!.includes(r)) || b.reads.some((r) => a.writes!.includes(r));
  return !conflicts;
}

/** F100-FR-100 — the step runner is an option that is off by default. */
export const STEP_RUNNER_KEY = "verification.step_runner" as const;
export const STEP_RUNNER_DEFAULT_ON = false as const;
/** A resumed run of steps is partial and never counts as evidence of a pass. */
export const RESUMED_STEPS_COUNT_AS_EVIDENCE = false as const;

/** F100-FR-098 — the condition a result obtained against a changed set carries. */
export const CONDITION_OF_A_CHANGED_PROTECTED_SET: Condition = "tainted";

/** "Failure of an implementation" of §C.8, as data. */
export const FAILURE_PATHS: Readonly<Record<CheckRunnerOperation, string>> = Object.freeze({
  pin: "the entry is refused at launch",
  start:
    "`cannot-start`: a failed command at the verification gate; in an inner check the loop layer is off for the phase attempt",
  poll: "`cannot-start`",
  result: "`cannot-start`",
  cancel: "`cannot-start`",
  environment: "`cannot-start`",
});

/** A runner that throws is treated as `cannot-start` (§C.8). */
export const THROW_IS_TREATED_AS: CheckRunnerError = "cannot-start";
