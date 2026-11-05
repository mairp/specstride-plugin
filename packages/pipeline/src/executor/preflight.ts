/**
 * T012 — preflight (F123-FR-008).
 *
 * Preflight runs over every enabled stage before any stage runs and collects
 * every failure before it exits. For each enabled stage it checks:
 *
 * - every required variable of the action and of the resume action is set
 *   (skipped for a setup stage without `--implement`);
 * - every preflight-timed precondition;
 * - for a setup stage without `--implement`, its postconditions, with the
 *   failure text ending `; rerun with --implement`.
 */
import type { Stage } from "./types.ts";
import { buildChildEnvironment, type EnvironmentEntry } from "./child-env.ts";
import type { PreconditionCheckRegistry, EvaluationContext } from "../kinds/registry.ts";
import { evaluatePostconditionFailures } from "../kinds/setup.ts";
import { emitLaunchChecked, type EventPort } from "./events.ts";

/** One preflight failure, with the stage it belongs to. */
export type PreflightFailure = {
  stageId: string;
  failure: string;
};

/** The result of a preflight over the whole contract. */
export type PreflightResult = {
  failures: PreflightFailure[];
  /** The `[PREFLIGHT]` lines of the dry run: one per preflight-timed precondition. */
  checks: Array<{ stageId: string; line: string; result: "pass" | "fail" | "deferred" }>;
};

function envEntriesOf(stage: Stage): EnvironmentEntry[] {
  return [...(stage.action?.env ?? []), ...(stage.resumeAction?.env ?? [])];
}

/**
 * Run the preflight over the stages in contract order, collecting every
 * failure (F123-FR-008). Never throws for a check failure; only the
 * registries decide.
 */
export async function runPreflight(input: {
  stages: readonly Stage[];
  implement: boolean;
  checks: PreconditionCheckRegistry;
  context: EvaluationContext;
  shell: Readonly<Record<string, string | undefined>>;
  /** The event port: one `launch.checked` per check the root verifies itself. */
  events?: EventPort;
  /** The time the events carry, in seconds; defaults to the wall clock. */
  now?: number;
}): Promise<PreflightResult> {
  const failures: PreflightFailure[] = [];
  const checks: PreflightResult["checks"] = [];

  for (const stage of input.stages) {
    const isSetup = stage.kind === "setup";
    const skipEnvironment = isSetup && !input.implement;

    // 1. The required variables of the action and of the resume action.
    if (!skipEnvironment) {
      const built = buildChildEnvironment({
        entries: envEntriesOf(stage),
        shell: input.shell,
        colourOn: true,
        kind: stage.kind,
      });
      for (const message of built.messages) failures.push({ stageId: stage.id, failure: message });
    }

    // 2. Every preflight-timed precondition.
    for (const condition of stage.preconditions) {
      if (condition.timing !== "preflight") continue;
      const result = await input.checks.run(condition, input.context);
      checks.push({
        stageId: stage.id,
        line: `${stage.id}: ${result.detail}`,
        result: result.result,
      });
      if (input.events !== undefined) {
        emitLaunchChecked(
          input.events,
          {
            check: `${stage.id}: ${condition.check}`,
            result: result.result,
            detail: result.detail,
          },
          input.now ?? Date.now() / 1_000,
        );
      }
      if (result.result === "fail") {
        failures.push({ stageId: stage.id, failure: result.detail });
      }
    }

    // 3. A setup stage without `--implement` checks its postconditions.
    if (isSetup && !input.implement) {
      for (const failure of await evaluatePostconditionFailures(
        stage,
        input.checks,
        input.context,
      )) {
        failures.push({ stageId: stage.id, failure: `${failure}; rerun with --implement` });
      }
    }
  }

  return { failures, checks };
}
