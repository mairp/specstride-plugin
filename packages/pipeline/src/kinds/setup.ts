/**
 * T074 — setup semantics (F123-FR-010, §R.3).
 *
 * A setup stage without `--implement`:
 *
 * - whose postconditions all hold is ready: `[READY] <stage> already
 *   satisfies setup postconditions`, the stage is skipped with the reason
 *   `existing-prerequisite`;
 * - with a failing postcondition is blocked: `[BLOCKED] <stage>: <failure>;
 *   rerun with --implement`, the reason `setup-required`.
 *
 * With `--implement` the setup stage runs its action like any other.
 */
import type { Stage } from "../executor/types.ts";
import type { PreconditionCheckRegistry, EvaluationContext, CheckResult } from "./registry.ts";

/** What the executor does with a setup stage that does not run its action. */
export type SetupDecision =
  | {
      behaviour: "ready";
      /** The `[READY]` label of the compatibility line. */
      label: "[READY]";
      line: string;
      reason: "existing-prerequisite";
    }
  | {
      behaviour: "blocked";
      /** The `[BLOCKED]` label of the compatibility line. */
      label: "[BLOCKED]";
      line: string;
      reason: "setup-required";
      failure: string;
    }
  | { behaviour: "run" };

/** The label of the line that says a setup stage is already satisfied. */
export const SETUP_READY_LABEL = "[READY]" as const;

/** The label of the line that says a setup stage needs `--implement`. */
export const SETUP_BLOCKED_LABEL = "[BLOCKED]" as const;

/**
 * Decide for one setup stage. `evaluatePostconditions` returns the list of
 * the failures of the postconditions, in the order of the contract; empty
 * when every one holds.
 */
export async function decideSetupStage(input: {
  stage: Stage;
  implement: boolean;
  checks: PreconditionCheckRegistry;
  context: EvaluationContext;
}): Promise<SetupDecision> {
  if (input.implement) return { behaviour: "run" };
  const failures = await evaluatePostconditionFailures(input.stage, input.checks, input.context);
  if (failures.length === 0) {
    return {
      behaviour: "ready",
      label: SETUP_READY_LABEL,
      line: `${input.stage.id} already satisfies setup postconditions`,
      reason: "existing-prerequisite",
    };
  }
  const failure = failures[0];
  return {
    behaviour: "blocked",
    label: SETUP_BLOCKED_LABEL,
    line: `${input.stage.id}: ${failure}; rerun with --implement`,
    reason: "setup-required",
    failure,
  };
}

/** Every failing postcondition of a stage, in contract order. A throw is `fail`. */
export async function evaluatePostconditionFailures(
  stage: Stage,
  checks: PreconditionCheckRegistry,
  context: EvaluationContext,
): Promise<string[]> {
  const failures: string[] = [];
  for (const condition of stage.postconditions) {
    const result = await checks.run(condition, context);
    if (result.result !== "pass") failures.push(result.detail);
  }
  return failures;
}

/**
 * The stage-timed precondition (§G.8, `timing: "stage"`): a condition the
 * executor evaluates when its stage starts, not at preflight. In a dry run
 * the stage-timed precondition executes nothing and reads `deferred`; in a
 * live run the registries decide, and a check that throws is `fail`
 * (F123-FR-010). A check never writes.
 */
export async function runStageTimedPreconditions(input: {
  stage: Stage;
  checks: PreconditionCheckRegistry;
  context: EvaluationContext;
  /** True in the dry run: the plan shows the check as `deferred`. */
  dryRun?: boolean;
}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const condition of input.stage.preconditions) {
    if (condition.timing !== "stage") continue;
    if (input.dryRun === true) {
      results.push({
        result: "deferred",
        detail: `${condition.check}: deferred (dry run)`,
      });
      continue;
    }
    results.push(await input.checks.run(condition, input.context));
  }
  return results;
}
