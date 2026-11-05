/**
 * T057 — the step runner (F148-FR-008).
 *
 * The step runner is an OPTION, `verification.step_runner`, that is OFF by
 * default (row 6 of annex X §X.7, registered in
 * `../registry/switches.ts`). With it on, a command whose declaration holds
 * steps is run step by step by the runtime: each step is a FIXED argument
 * list, the run stops at the first failed step that is REQUIRED, the result of
 * every step is recorded inside the result record of its command, and a later
 * execution can resume from the step the run stopped at.
 *
 * Four rules of F148-FR-008 are code here, not prose:
 *
 *  1. **The option is off by default.** `STEP_RUNNER_IS_ON_BY_DEFAULT` is read
 *     from the "Default" cell of row 6, never typed twice, and the kind
 *     `steps` reaches the EP-05 registry only through
 *     `registerTheStepRunner`, which REFUSES to register it while the option
 *     is off. The default registry of `../registry/runner.ts` serves the kind
 *     `command` alone, so an entry of the kind `steps` is refused at `pin`
 *     until a caller switches the option on.
 *  2. **Each step is a fixed argument list.** A step is run by the kind
 *     `command` of this feature (`../command/kind-command.ts`), so it inherits
 *     `shell: false`, the process group of its own, the environment allow-list,
 *     the time limit and the output cap. A step without an argument list is
 *     refused at the pin.
 *  3. **The run stops at the first failed REQUIRED step.** `required` decides
 *     whether a failure STOPS the run; a failed step of either kind means the
 *     command did not pass (`passedOfTheRun`). Every step after the stop is
 *     recorded with the state `not-run`, so "each step has a result" holds for
 *     every step of the declaration and not only for the ones that ran.
 *  4. **Stopping at a first failure exists HERE and nowhere in the
 *     verification gate.** `STOPPING_EARLY_EXISTS_IN` and
 *     `STOPPING_EARLY_EXISTS_NOWHERE_IN` say so as data, beside
 *     `NO_MEMBER_IS_CANCELLED_BECAUSE_ANOTHER_FAILED` of the batch runner
 *     (F148-FR-015, ruling 51).
 *
 * The steps of a run are NEVER concurrent (F148-FR-015): the loop of
 * `startTheSteps` awaits one step before it starts the next, and
 * `STEPS_ARE_NEVER_CONCURRENT` is the reader of that rule. A command that has
 * steps also shares no batch while the option is on — that is the reason
 * `steps` of an admission, and it lives in `../batch/admission.ts`.
 *
 * The `partial` run of steps and everything the verification gate may do with
 * one are in `partial.ts` (T058, F148-FR-009).
 *
 * Seam of this feature: `ManifestEntry.steps` and a pinned identity of the
 * kind `steps` are NOT in the interface types of feature 100
 * (`@specstride/contracts/ep/check-runner`), though
 * `check-manifest.schema.json` names `entries[].steps` ("Steps, for the step
 * runner", a list of records with no inner shape). The step record is given
 * its fields here, at this feature's seam, and the difference is reported
 * upstream rather than forced on the contracts package.
 */
import type {
  IdentityKind,
  ManifestEntry,
  PinnedIdentity,
} from "@specstride/contracts/ep/check-runner";
import { STEP_RUNNER_DEFAULT_ON } from "@specstride/contracts/ep/check-runner";
import {
  effectiveContainment,
  type ContainmentLevel,
  type ContainmentOfAStart,
} from "../command/containment.ts";
import { PARITY_PROFILE, type EnvironmentOptions } from "../command/environment.ts";
import { startCommand, type EndCause, type RunningCommand } from "../command/kind-command.ts";
import { MAX_OUTPUT_CHARS, cannotStartResult, cut, passedOf } from "../result/errors.ts";
import { resultOf, type RunnerResult, type StepResult } from "../result/result.ts";
import { STEP_RUNNER_KEY, defaultValueOf, parityValueOf } from "../registry/switches.ts";
import { pinACommand } from "../registry/runner.ts";
import { markPartial, runOfSteps, type RunOfSteps } from "./partial.ts";

/* ------------------------------------------------------------------ *
 * The option (F148-FR-008): `verification.step_runner`, off by default.
 * ------------------------------------------------------------------ */

/** The kind of identity the step runner serves. */
export const STEPS_KIND_NAME = "steps" as const;

/** Row 6 of annex X §X.7, which `../registry/switches.ts` registers and exports. */
export const STEP_RUNNER_ROW = 6 as const;

/**
 * F148-FR-008 — the option is OFF by default. The value is read from the
 * "Default" cell of row 6 of §X.7 and is not typed a second time;
 * `STEP_RUNNER_DEFAULT_ON` of EP-05 says the same, and the two are compared
 * here so neither can drift alone.
 */
export const STEP_RUNNER_IS_ON_BY_DEFAULT: boolean =
  defaultValueOf(STEP_RUNNER_KEY) === true && STEP_RUNNER_DEFAULT_ON;

/** The step runner is off under the `parity` profile too (row 6, `parity` cell). */
export const STEP_RUNNER_IS_ON_UNDER_PARITY: boolean = parityValueOf(STEP_RUNNER_KEY) === true;

/** F148-FR-015, ruling 51 — where stopping at a first failure exists. */
export const STOPPING_EARLY_EXISTS_IN = "the step runner, between the steps of one command";
export const STOPPING_EARLY_EXISTS_NOWHERE_IN = "the verification gate";

/** F148-FR-015 — the steps of the step runner are never concurrent. */
export const STEPS_ARE_NEVER_CONCURRENT = true as const;

/** F148-FR-008 — every step is a fixed argument list, never a shell line. */
export const EVERY_STEP_IS_A_FIXED_ARGUMENT_LIST = true as const;

/** How the option is read for one run (F148-FR-008). */
export type StepRunnerOption = {
  /** The configured value of `verification.step_runner`, where one is set. */
  readonly configured?: boolean;
  /** The profile of the run; under `parity` the option is off. */
  readonly profile?: string;
};

/**
 * F148-FR-008 — is the step runner on? Off by default; off under `parity`
 * whatever the configuration says, because no manifest exists there
 * (`spec.md`, "Edge cases").
 */
export function stepRunnerIsOn(option: StepRunnerOption = {}): boolean {
  if (option.profile === PARITY_PROFILE) return STEP_RUNNER_IS_ON_UNDER_PARITY;
  return option.configured ?? STEP_RUNNER_IS_ON_BY_DEFAULT;
}

/* ------------------------------------------------------------------ *
 * The declaration of a step.
 * ------------------------------------------------------------------ */

/**
 * One step of a command, as this feature reads a record of
 * `entries[].steps` of the check manifest. `required` defaults to TRUE: a step
 * of a check is required unless its declaration says otherwise, so a
 * declaration that forgets the field cannot turn a failure into a run that
 * carries on.
 */
export type StepDeclaration = {
  readonly id: string;
  readonly argv: readonly string[];
  readonly required: boolean;
  /** The time limit of the step; the command's where the step names none. */
  readonly timeLimitMs?: number;
  /** The declared environment of the step, overlaid on the command's. */
  readonly env?: Readonly<Record<string, string>>;
};

/** A step of a command as the manifest holds it, before it is read. */
export const REQUIRED_BY_DEFAULT = true as const;

/**
 * An entry of the check manifest that may carry steps. `argv` is optional
 * here, because a command of the kind `steps` carries its argument lists in
 * its steps.
 */
export type StepsEntry = Omit<ManifestEntry, "argv" | "kind"> & {
  readonly kind: IdentityKind | string;
  readonly argv?: readonly string[];
  readonly steps?: readonly unknown[];
};

/** Raised where a declaration of steps cannot be read or cannot be pinned. */
export class StepsRefusedError extends Error {
  readonly entryId: string;
  readonly refusal: string;
  constructor(entryId: string, refusal: string) {
    super(`the steps of the entry \`${entryId}\` are refused: ${refusal} (F148-FR-008)`);
    this.name = "StepsRefusedError";
    this.entryId = entryId;
    this.refusal = refusal;
  }
}

/** Raised where a run of steps is told to start from a step that does not exist. */
export class StepResumeError extends Error {
  readonly entryId: string;
  readonly from: string | number;
  constructor(entryId: string, from: string | number, known: readonly string[]) {
    super(
      `the entry \`${entryId}\` cannot resume from \`${String(from)}\`; its steps are ` +
        `${known.map((id) => `\`${id}\``).join(", ")} (F148-FR-008)`,
    );
    this.name = "StepResumeError";
    this.entryId = entryId;
    this.from = from;
  }
}

/** One record of `entries[].steps`, read into a declaration. */
export function readStep(raw: unknown, position: number, entryId: string): StepDeclaration {
  if (raw === null || typeof raw !== "object") {
    throw new StepsRefusedError(entryId, `step ${String(position)} is not a record`);
  }
  const value = raw as Readonly<Record<string, unknown>>;
  const argv = Array.isArray(value["argv"])
    ? (value["argv"] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  if (argv.length === 0) {
    throw new StepsRefusedError(
      entryId,
      `step ${String(position)} names no argument list; every step is a fixed argument list ` +
        `(F148-FR-008)`,
    );
  }
  const id =
    typeof value["id"] === "string" && value["id"] !== ""
      ? value["id"]
      : `step-${String(position)}`;
  const limit = value["timeLimitMs"] ?? value["timeLimit"];
  const env = value["env"];
  return Object.freeze({
    id,
    argv: Object.freeze([...argv]),
    required: value["required"] === undefined ? REQUIRED_BY_DEFAULT : value["required"] !== false,
    ...(typeof limit === "number" ? { timeLimitMs: limit } : {}),
    ...(env !== null && typeof env === "object"
      ? { env: Object.freeze({ ...(env as Record<string, string>) }) }
      : {}),
  });
}

/** The steps of an entry, in the order of the declaration. */
export function stepsOf(entry: StepsEntry): readonly StepDeclaration[] {
  const raw = (entry as unknown as Readonly<Record<string, unknown>>)["steps"];
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze((raw as unknown[]).map((step, i) => readStep(step, i + 1, entry.id)));
}

/** True where the declaration of the entry holds steps (the reason `steps`). */
export function hasSteps(entry: StepsEntry): boolean {
  const raw = (entry as unknown as Readonly<Record<string, unknown>>)["steps"];
  return Array.isArray(raw) && raw.length > 0;
}

/* ------------------------------------------------------------------ *
 * The pin of a command of steps (F148-FR-001, F148-FR-008).
 * ------------------------------------------------------------------ */

/** One pinned step: the executable of its argument list, with size and hash. */
export type PinnedStep = {
  readonly id: string;
  readonly required: boolean;
  readonly executable: string;
  readonly size: number;
  readonly hash: string;
  /** The argument list after the executable. */
  readonly argv: readonly string[];
};

/** The identity record of a command of the kind `steps`. */
export type PinnedSteps = PinnedIdentity & {
  readonly kind: "steps";
  readonly steps: readonly PinnedStep[];
};

/**
 * F148-FR-001, F148-FR-008 — the identity record of a command of steps: every
 * step pinned at launch, by the same reading `pinACommand` uses for the kind
 * `command`, so the hash and the real path of a step cannot differ from the
 * hash and the real path of a command.
 */
export function pinTheSteps(entry: StepsEntry): PinnedSteps {
  const steps = stepsOf(entry);
  if (steps.length === 0) {
    throw new StepsRefusedError(entry.id, "the entry of the kind `steps` declares no step");
  }
  const pinned = steps.map((step) => {
    const identity = pinACommand({
      id: `${entry.id}#${step.id}`,
      kind: "command",
      argv: step.argv,
      phase: entry.phase,
      timeLimitMs: step.timeLimitMs ?? entry.timeLimitMs,
    });
    return Object.freeze({
      id: step.id,
      required: step.required,
      executable: identity.executable ?? "",
      size: identity.size ?? 0,
      hash: identity.hash ?? "",
      argv: Object.freeze([...(identity.argv ?? [])]),
    });
  });
  const first = pinned[0];
  return Object.freeze({
    kind: STEPS_KIND_NAME,
    executable: first?.executable ?? "",
    size: first?.size ?? 0,
    hash: first?.hash ?? "",
    argv: Object.freeze([...(first?.argv ?? [])]),
    steps: Object.freeze(pinned),
  });
}

/* ------------------------------------------------------------------ *
 * One execution of the steps of one command.
 * ------------------------------------------------------------------ */

/** The state of one step inside a run of steps. */
export const STEP_STATES = ["passed", "failed", "not-run", "before-the-start"] as const;
export type StepState = (typeof STEP_STATES)[number];

/**
 * The result of one step, inside the result record of its command
 * (F148-FR-008; feature 100, annex D §D.8, field `entries[].steps`). It is a
 * `StepResult` of `../result/result.ts` — the step id, whether it was
 * required, the exit result and the duration — with the state of the step and
 * its position beside them.
 */
export type StepOutcome = StepResult & {
  /** The 1-based position of the step in the declaration. */
  readonly position: number;
  readonly state: StepState;
  /** True where the step was executed in THIS run of steps. */
  readonly ran: boolean;
  readonly passed: boolean;
  /** True for the failed required step the run stopped at. */
  readonly stoppedTheRun: boolean;
};

/** What one execution of the steps of one command is given. */
export type StepsRun = ContainmentOfAStart & {
  readonly entry: StepsEntry;
  /** The identity `pinTheSteps` returned at launch; pinned here where absent. */
  readonly identity?: PinnedSteps;
  readonly workingDirectory: string;
  readonly profile: string;
  readonly maxOutputChars?: number;
  readonly environmentOptions?: EnvironmentOptions;
  /**
   * F148-FR-008, F148-FR-009 — the step to start from: the id of a step or its
   * 1-based position. Absent means the first step, which is the only run that
   * serves the verification gate (F148-FR-009).
   */
  readonly from?: string | number;
};

/** A run of steps, as it is returned while it runs. */
export type RunningSteps = RunningCommand & {
  /** The step that is running, or null between steps and after the run. */
  currentStep(): string | null;
};

/** The 0-based index of the step a run starts from (F148-FR-009). */
export function indexOfTheFirstStep(
  steps: readonly StepDeclaration[],
  entryId: string,
  from?: string | number,
): number {
  if (from === undefined) return 0;
  if (typeof from === "number") {
    if (!Number.isInteger(from) || from < 1 || from > steps.length) {
      throw new StepResumeError(
        entryId,
        from,
        steps.map((s) => s.id),
      );
    }
    return from - 1;
  }
  const index = steps.findIndex((step) => step.id === from);
  if (index < 0)
    throw new StepResumeError(
      entryId,
      from,
      steps.map((s) => s.id),
    );
  return index;
}

/**
 * F148-FR-008 — the step the run stopped at: the first failed REQUIRED step,
 * or null where the run reached the end of the declaration. A later execution
 * resumes from it (`from` of `StepsRun`).
 */
export function resumePointOf(run: RunOfSteps | null): string | null {
  if (run === null) return null;
  return run.stoppedAt;
}

/**
 * The step whose exit result is the exit result of the command: the FIRST
 * failed step where one failed, else the LAST step that ran. A run with no
 * step that ran has none.
 */
export function decidingStep(outcomes: readonly StepOutcome[]): StepOutcome | null {
  const failed = outcomes.find((step) => step.state === "failed");
  if (failed !== undefined) return failed;
  const ran = outcomes.filter((step) => step.ran);
  return ran.length === 0 ? null : (ran[ran.length - 1] as StepOutcome);
}

/**
 * F148-FR-008 — a run of steps passed when every step that ran passed and no
 * step of the declaration was left `not-run`. A step that was never part of
 * this execution (`before-the-start`) does not make the command fail: a
 * resumed run that completes carries the exit result of a pass and is kept
 * from being STATED as one by the condition `unchecked` with the reason
 * `partial` (F148-FR-009), not by its exit result.
 */
export function passedOfTheRun(outcomes: readonly StepOutcome[]): boolean {
  if (outcomes.length === 0) return false;
  return !outcomes.some((step) => step.state === "failed" || step.state === "not-run");
}

/** The per-step command the kind `command` runs, built from the pinned step. */
function commandRunOfAStep(run: StepsRun, step: StepDeclaration, pinned: PinnedStep) {
  const entry = run.entry as unknown as Readonly<Record<string, unknown>>;
  const declaredEnv = (entry["env"] ?? {}) as Readonly<Record<string, string>>;
  return {
    entry: {
      id: `${run.entry.id}#${step.id}`,
      kind: "command" as IdentityKind,
      argv: Object.freeze([pinned.executable, ...pinned.argv]),
      phase: run.entry.phase,
      timeLimitMs: step.timeLimitMs ?? run.entry.timeLimitMs,
      env: Object.freeze({ ...declaredEnv, ...(step.env ?? {}) }),
    } as ManifestEntry,
    identity: Object.freeze({
      kind: "command" as IdentityKind,
      executable: pinned.executable,
      size: pinned.size,
      hash: pinned.hash,
      argv: Object.freeze([...pinned.argv]),
    }),
    workingDirectory: run.workingDirectory,
    timeLimitMs: step.timeLimitMs ?? run.entry.timeLimitMs,
    profile: run.profile,
    ...(run.maxOutputChars === undefined ? {} : { maxOutputChars: run.maxOutputChars }),
    ...(run.environmentOptions === undefined ? {} : { environmentOptions: run.environmentOptions }),
    ...(run.containment === undefined ? {} : { containment: run.containment }),
    ...(run.proposerContainment === undefined
      ? {}
      : { proposerContainment: run.proposerContainment }),
  };
}

/** A step of the declaration that this run did not execute. */
function notExecuted(step: StepDeclaration, position: number, state: StepState): StepOutcome {
  return Object.freeze({
    id: step.id,
    required: step.required,
    exitCode: null,
    signal: null,
    durationMs: 0,
    position,
    state,
    ran: false,
    passed: false,
    stoppedTheRun: false,
  });
}

/**
 * F148-FR-008, F148-FR-009 — start one execution of the steps of one command.
 * The steps run ONE AFTER THE OTHER (`STEPS_ARE_NEVER_CONCURRENT`); the run
 * stops at the first failed required step; every step of the declaration gets
 * a result; and a run that did not start at the first step is `partial` and
 * carries `unchecked` with the reason `partial`.
 *
 * Nothing is thrown at the caller: a declaration that cannot be read or
 * pinned gives a settled result with the error `cannot-start`, as the kind
 * `command` does (F148-FR-004).
 */
export function startTheSteps(run: StepsRun): RunningSteps {
  const max = run.maxOutputChars ?? MAX_OUTPUT_CHARS;
  const containment: ContainmentLevel = effectiveContainment(run);
  const startedAt = Date.now();

  let steps: readonly StepDeclaration[];
  let identity: PinnedSteps;
  try {
    steps = stepsOf(run.entry);
    identity = run.identity ?? pinTheSteps(run.entry);
  } catch (thrown) {
    const result = cannotStartResult(
      {
        commandId: run.entry.id,
        executable: "",
        args: [],
        cwd: run.workingDirectory,
        durationMs: 0,
      },
      thrown,
    );
    return Object.freeze({
      commandId: run.entry.id,
      executable: "",
      args: Object.freeze([]),
      cwd: run.workingDirectory,
      processGroup: null,
      pid: null,
      startedAt,
      containment,
      running: () => false,
      endCause: () => "exit" as EndCause,
      currentStep: () => null,
      settled: Promise.resolve(result),
      cancel: () => undefined,
    });
  }

  const firstIndex = indexOfTheFirstStep(steps, run.entry.id, run.from);
  const outcomes: StepOutcome[] = [];
  let current: RunningCommand | null = null;
  let currentId: string | null = null;
  let ended = false;
  let cause: EndCause | null = null;
  let stdout = "";
  let stderr = "";

  const settled = (async (): Promise<RunnerResult> => {
    for (let i = 0; i < firstIndex; i++) {
      // F148-FR-009 — a step before the start of THIS execution. It is not a
      // step that failed and not a step the run skipped: it was never part of
      // the execution, and it is why the run is `partial`.
      outcomes.push(notExecuted(steps[i] as StepDeclaration, i + 1, "before-the-start"));
    }
    let stopped: StepOutcome | null = null;
    for (let i = firstIndex; i < steps.length; i++) {
      const step = steps[i] as StepDeclaration;
      if (stopped !== null || cause !== null) {
        outcomes.push(notExecuted(step, i + 1, "not-run"));
        continue;
      }
      const pinned = identity.steps.find((p) => p.id === step.id) ?? identity.steps[i - firstIndex];
      if (pinned === undefined) {
        outcomes.push(notExecuted(step, i + 1, "not-run"));
        continue;
      }
      currentId = step.id;
      // STEPS_ARE_NEVER_CONCURRENT — the step is awaited before the next one
      // is started (F148-FR-015).
      const running = startCommand(commandRunOfAStep(run, step, pinned));
      current = running;
      const outcome = await running.settled;
      current = null;
      currentId = null;
      stdout = cut(stdout + outcome.stdout, max);
      stderr = cut(stderr + outcome.stderr, max);
      const passed = outcome.passed;
      const stops = !passed && step.required;
      const recorded: StepOutcome = Object.freeze({
        id: step.id,
        required: step.required,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        durationMs: outcome.durationMs,
        position: i + 1,
        state: passed ? ("passed" as StepState) : ("failed" as StepState),
        ran: true,
        passed,
        stoppedTheRun: stops,
      });
      outcomes.push(recorded);
      // F148-FR-008 — the run stops at the first failed REQUIRED step; the
      // steps after it are recorded as `not-run` by the branch above.
      if (stops) stopped = recorded;
    }
    ended = true;
    const frozen = Object.freeze([...outcomes]);
    const deciding = decidingStep(frozen);
    const durationMs = Date.now() - startedAt;
    const record: RunOfSteps = runOfSteps(frozen, firstIndex + 1);
    const base = resultOf(
      {
        commandId: run.entry.id,
        executable: deciding === null ? "" : executableOfAStep(identity, deciding.id),
        args: argsOfAStep(identity, deciding?.id ?? null),
        cwd: run.workingDirectory,
        exitCode: deciding?.exitCode ?? null,
        signal: deciding?.signal ?? null,
        durationMs,
        stdout,
        stderr,
        passed: passedOfTheRun(frozen) && passedOf(deciding?.exitCode ?? null),
      },
      { steps: record },
    );
    const withInterruption =
      cause === "cancel" || cause === "stop-request" ? interruptedRun(base, cause) : base;
    // F148-FR-009 — a run that did not start at the first step is `partial`
    // and carries `unchecked` with the reason `partial`.
    return record.state === "partial" ? markPartial(withInterruption) : withInterruption;
  })();

  const end = (next: Exclude<EndCause, "exit">): void => {
    if (ended) return;
    cause ??= next;
    current?.cancel(next === "time-limit" ? "cancel" : next);
  };

  return Object.freeze({
    commandId: run.entry.id,
    executable: identity.steps[firstIndex]?.executable ?? "",
    args: Object.freeze([...(identity.steps[firstIndex]?.argv ?? [])]),
    cwd: run.workingDirectory,
    get processGroup(): number | null {
      return current?.processGroup ?? null;
    },
    get pid(): number | null {
      return current?.pid ?? null;
    },
    startedAt,
    containment,
    running: () => !ended,
    endCause: () => cause,
    currentStep: () => currentId,
    settled,
    cancel: (reason: "cancel" | "stop-request" = "cancel") => end(reason),
  });
}

/** The executable of a pinned step, by id. */
function executableOfAStep(identity: PinnedSteps, id: string): string {
  return identity.steps.find((step) => step.id === id)?.executable ?? "";
}

/** The argument list of a pinned step, by id. */
function argsOfAStep(identity: PinnedSteps, id: string | null): readonly string[] {
  if (id === null) return Object.freeze([]);
  return Object.freeze([...(identity.steps.find((step) => step.id === id)?.argv ?? [])]);
}

/** A run of steps ended by `cancel` or a stop request (F148-FR-003). */
function interruptedRun(result: RunnerResult, cause: "cancel" | "stop-request"): RunnerResult {
  return Object.freeze({
    ...result,
    interrupted: true,
    error: "interrupted" as const,
    interruptedBy: cause,
  }) as RunnerResult;
}

/** One execution of the steps of one command, run to its end. */
export async function runTheSteps(run: StepsRun): Promise<RunnerResult> {
  return await startTheSteps(run).settled;
}

/* ------------------------------------------------------------------ *
 * The kind `steps` in the EP-05 registry (F148-FR-008: an OPTION).
 * ------------------------------------------------------------------ */

/** The kind `steps`, in the shape `../registry/runner.ts` registers. */
export const STEPS_KIND = Object.freeze({
  kind: STEPS_KIND_NAME,
  pin: (entry: ManifestEntry) => pinTheSteps(entry as unknown as StepsEntry) as PinnedIdentity,
  start: (input: {
    readonly entry: ManifestEntry;
    readonly identity: PinnedIdentity;
    readonly workingDirectory: string;
    readonly timeLimitMs: number;
    readonly profile: string;
    readonly maxOutputChars?: number;
    readonly environmentOptions?: EnvironmentOptions;
    readonly containment?: ContainmentLevel;
    readonly proposerContainment?: ContainmentLevel;
    readonly from?: string | number;
  }): RunningCommand =>
    startTheSteps({
      ...input,
      entry: input.entry as unknown as StepsEntry,
      identity: input.identity as PinnedSteps,
    }),
  environment: () => Object.freeze({}),
});

/** Raised where the kind `steps` is registered while the option is off. */
export class StepRunnerIsOffError extends Error {
  constructor() {
    super(
      `\`${STEP_RUNNER_KEY}\` is off; the step runner is an option that is off by default ` +
        `(F148-FR-008), so the kind \`${STEPS_KIND_NAME}\` is not registered and an entry of ` +
        `that kind is refused at \`pin\` (F148-FR-001)`,
    );
    this.name = "StepRunnerIsOffError";
  }
}

/**
 * F148-FR-008 — register the kind `steps` with a runner, and only while the
 * option is on. With the option off the registration is REFUSED, so the
 * default registry serves the kind `command` alone and an entry of the kind
 * `steps` is refused at `pin`.
 */
export function registerTheStepRunner(
  registry: { register(kind: typeof STEPS_KIND): void },
  option: StepRunnerOption = {},
): typeof STEPS_KIND {
  if (!stepRunnerIsOn(option)) throw new StepRunnerIsOffError();
  registry.register(STEPS_KIND);
  return STEPS_KIND;
}
