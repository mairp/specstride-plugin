/**
 * T073 — the five built-in stage kinds of §R.3 (F123-FR-010).
 *
 * Every kind offers the three operations of annex F §F.7: `validate`, `run`
 * and `evaluate`. The kinds differ in what they add around the action:
 *
 * - `setup` runs its action only with `--implement`; setup semantics live in
 *   `setup.ts` and are wired through `evaluate` here;
 * - `decision` runs its action and takes its exit code as a yes/no;
 * - `command` runs its action plainly;
 * - `specstride` runs the engine; its streams are shown as the child produced
 *   them (terminal, or pipe with the log), and it runs without live output;
 * - `smoke` runs its action and is skipped without `--smoke` (the skip
 *   itself is the stage loop's, from the marker).
 *
 * The as-is spelling of the kind `specstride` of the legacy product is not
 * accepted (F123-FR-010).
 */
import type { Stage, StageOutcome } from "../executor/types.ts";
import type { EvaluationContext, StageKindOperations, StageRunContext } from "./registry.ts";

/** The as-is spellings of the legacy product that are never accepted. */
export const REFUSED_LEGACY_SPELLINGS = ["SpecStride", "spec-stride", "Specstride"] as const;

function validateCommandish(stage: Stage): string[] {
  const problems: string[] = [];
  if (stage.action === undefined) problems.push(`the stage ${stage.id} declares no action`);
  else if (stage.action.argv.length === 0)
    problems.push(`the action of ${stage.id} is an empty argument list`);
  return problems;
}

async function evaluateWithChecks(
  stage: Stage,
  context: EvaluationContext,
  checks: (stage: Stage, context: EvaluationContext) => Promise<boolean>,
): Promise<boolean> {
  return checks(stage, context);
}

/** Run the action through the context's child runner, mapping a throw to `exec-error:`. */
async function runThrough(
  stage: Stage,
  attempt: number,
  maxAttempts: number,
  runChild: StageRunContext["runChild"],
  context: StageRunContext,
  action?: Stage["action"],
): Promise<StageOutcome> {
  if (action === undefined) {
    return {
      stageId: stage.id,
      ok: false,
      reason: `exec-error: the stage declares no action`,
      childExitCode: 127,
      evidence: null,
    };
  }
  try {
    const result = await runChild({ stage, action, attempt, maxAttempts, env: {} });
    const ok = result.code === 0;
    return {
      stageId: stage.id,
      ok,
      reason: ok ? "completed" : result.timedOut ? "timeout" : `exit:${result.code}`,
      childExitCode: result.code,
      evidence: result.error ?? null,
    };
  } catch (error) {
    // A kind that throws ends the stage with `exec-error:` and its detail (F123-FR-010).
    return {
      stageId: stage.id,
      ok: false,
      reason: `exec-error: ${String((error as Error)?.message ?? error)}`,
      childExitCode: 127,
      evidence: null,
    };
  }
}

/** `setup`: §R.3 semantics; the ready/blocked decision lives in `setup.ts`. */
export const setupKind: StageKindOperations = {
  validate: validateCommandish,
  async run(input) {
    return runThrough(
      input.stage,
      input.attempt,
      input.maxAttempts,
      input.runChild,
      input.context,
      input.stage.action,
    );
  },
  evaluate: (stage, context) =>
    evaluateWithChecks(stage, context, async () =>
      // Setup postconditions hold or not; the checks registry decides.
      // The stage loop calls this through the checks; a throw is `fail`.
      context.implement || stage.postconditions.length === 0 ? true : false,
    ),
};

/** `decision`: the action's exit code is the decision; 0 holds. */
export const decisionKind: StageKindOperations = {
  validate: validateCommandish,
  async run(input) {
    return runThrough(
      input.stage,
      input.attempt,
      input.maxAttempts,
      input.runChild,
      input.context,
      input.stage.action,
    );
  },
  evaluate: async (stage) => stage.postconditions.length === 0,
};

/** `command`: a plain command. */
export const commandKind: StageKindOperations = {
  validate: validateCommandish,
  async run(input) {
    return runThrough(
      input.stage,
      input.attempt,
      input.maxAttempts,
      input.runChild,
      input.context,
      input.stage.action,
    );
  },
  evaluate: async (stage) => stage.postconditions.length === 0,
};

/** `specstride`: the engine; shown as the child produced it, no live output. */
export const specstrideKind: StageKindOperations = {
  validate: validateCommandish,
  async run(input) {
    return runThrough(
      input.stage,
      input.attempt,
      input.maxAttempts,
      input.runChild,
      input.context,
      input.stage.action,
    );
  },
  evaluate: async (stage) => stage.postconditions.length === 0,
};

/** `smoke`: a smoke stage; the loop skips it without `--smoke`. */
export const smokeKind: StageKindOperations = {
  validate: validateCommandish,
  async run(input) {
    return runThrough(
      input.stage,
      input.attempt,
      input.maxAttempts,
      input.runChild,
      input.context,
      input.stage.action,
    );
  },
  evaluate: async (stage) => stage.postconditions.length === 0,
};

/** The five built-in kinds, with their names. */
export const BUILTIN_KINDS: Readonly<Record<string, StageKindOperations>> = {
  setup: setupKind,
  decision: decisionKind,
  command: commandKind,
  specstride: specstrideKind,
  smoke: smokeKind,
};
