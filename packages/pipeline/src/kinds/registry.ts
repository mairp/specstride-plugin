/**
 * T073 — the two open registries of EP-19 (F123-FR-010; annex F §F.7).
 *
 * The stage executor reaches stage kinds and precondition checks through the
 * registries only: never a switch over a kind name, never an inline check. A
 * kind a registry does not hold, or a check, makes the launch contract
 * invalid (exit 20).
 */
import type { Condition, Stage, StageOutcome } from "../executor/types.ts";

/** The three operations a registered kind offers (annex F §F.7, F123-FR-010). */
export type StageKindOperations = {
  /** Validate one stage of the kind: the list of problems, empty when valid. */
  validate(stage: Stage): string[];
  /** Run one attempt of the stage. A kind that throws ends the stage `exec-error:`. */
  run(input: {
    stage: Stage;
    attempt: number;
    maxAttempts: number;
    runChild: (
      action: Parameters<StageRunContext["runChild"]>[0],
    ) => ReturnType<StageRunContext["runChild"]>;
    context: StageRunContext;
  }): Promise<StageOutcome>;
  /**
   * `evaluate`: whether the postconditions of the stage hold right now, so
   * that a completed stage can be skipped and a setup stage read as ready.
   * A check that throws is `fail` and reads as "does not hold".
   */
  evaluate(stage: Stage, context: EvaluationContext): Promise<boolean>;
};

/** What a kind needs to run an attempt. */
export type StageRunContext = {
  runChild(input: {
    stage: Stage;
    action: NonNullable<Stage["action"]>;
    attempt: number;
    maxAttempts: number;
    env: Record<string, string>;
  }): Promise<{ code: number; signal: string | null; timedOut: boolean; error?: string }>;
  colourOn: boolean;
  stdoutIsTerminal: boolean;
  env: Readonly<Record<string, string | undefined>>;
};

/** What `evaluate` needs: the shell environment and a resolver for paths. */
export type EvaluationContext = {
  env: Readonly<Record<string, string | undefined>>;
  /** The working directory the stage runs in. */
  cwd?: string;
  /** `--implement`: a setup stage evaluates its postconditions the same way. */
  implement: boolean;
};

/** A registry that refuses the same name twice. */
export class RegistryDuplicateError extends Error {
  constructor(name: string, registry: string) {
    super(`the ${registry} registry already holds ${name}`);
    this.name = "RegistryDuplicateError";
  }
}

/** The open registry of stage kinds (EP-19). */
export class StageKindRegistry {
  private readonly kinds = new Map<string, StageKindOperations>();

  private readonly registryName: string;

  constructor(
    entries?: Readonly<Record<string, StageKindOperations>>,
    registryName: string = "stage kind",
  ) {
    this.registryName = registryName;
    if (entries !== undefined) {
      for (const [kind, operations] of Object.entries(entries)) this.register(kind, operations);
    }
  }

  register(kind: string, operations: StageKindOperations): void {
    if (this.kinds.has(kind)) throw new RegistryDuplicateError(kind, this.registryName);
    this.kinds.set(kind, operations);
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  get(kind: string): StageKindOperations {
    const operations = this.kinds.get(kind);
    if (operations === undefined) {
      throw new Error(`no stage kind ${kind} is registered (F123-FR-010)`);
    }
    return operations;
  }

  names(): string[] {
    return [...this.kinds.keys()];
  }
}

/** The outcome of one precondition check (§F.7; row 108 of the closed sets). */
export type CheckResult = {
  /** `pass`, `fail` or `deferred` (a `command_success` in a dry run). */
  result: "pass" | "fail" | "deferred";
  /** The detail the `[PREFLIGHT]` and `[BLOCKED]` lines print. */
  detail: string;
};

/** The open registry of precondition checks (EP-19). */
export class PreconditionCheckRegistry {
  private readonly checks = new Map<
    string,
    (condition: Condition, context: EvaluationContext) => Promise<CheckResult> | CheckResult
  >();

  constructor(
    entries?: Readonly<
      Record<
        string,
        (condition: Condition, context: EvaluationContext) => Promise<CheckResult> | CheckResult
      >
    >,
  ) {
    if (entries !== undefined) {
      for (const [name, check] of Object.entries(entries)) this.register(name, check);
    }
  }

  register(
    name: string,
    check: (condition: Condition, context: EvaluationContext) => Promise<CheckResult> | CheckResult,
  ): void {
    if (this.checks.has(name)) throw new RegistryDuplicateError(name, "precondition check");
    this.checks.set(name, check);
  }

  has(name: string): boolean {
    return this.checks.has(name);
  }

  names(): string[] {
    return [...this.checks.keys()];
  }

  /**
   * Run one check. A check that throws is `fail` with the detail of the
   * throw, and a check never writes (F123-FR-010).
   */
  async run(condition: Condition, context: EvaluationContext): Promise<CheckResult> {
    const check = this.checks.get(condition.check);
    if (check === undefined) {
      return { result: "fail", detail: `no precondition check ${condition.check} is registered` };
    }
    try {
      return await check(condition, context);
    } catch (error) {
      return { result: "fail", detail: String((error as Error)?.message ?? error) };
    }
  }
}

/**
 * Every stage kind and every precondition check the launch contract names
 * must be registered; a name no registry holds makes the launch contract
 * INVALID (exit 20, F123-FR-010) — this is the check the entry runs before
 * the plan and the stage loop, so an unknown extension never reaches the
 * executor. The list it returns holds one message per unknown name, in
 * contract order.
 */
export function unknownRegistryEntries(input: {
  stages: readonly Stage[];
  kinds: StageKindRegistry;
  checks: PreconditionCheckRegistry;
}): string[] {
  const unknown: string[] = [];
  for (const stage of input.stages) {
    if (!input.kinds.has(stage.kind)) {
      unknown.push(`no stage kind ${stage.kind} is registered (F123-FR-010)`);
    }
    for (const condition of [...stage.preconditions, ...stage.postconditions]) {
      if (!input.checks.has(condition.check)) {
        unknown.push(`no precondition check ${condition.check} is registered (F123-FR-010)`);
      }
    }
  }
  return unknown;
}
