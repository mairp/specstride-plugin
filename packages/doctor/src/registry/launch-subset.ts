/**
 * T039 (feature 112) — the launch subset and the `--launch-checks` evaluation
 * (F112-FR-030, F112-FR-026; annex G §G.4).
 *
 * The launch checks of `launch` MUST be exactly the checks whose flag `lb` is
 * set, and they MUST be the same functions that the doctor runs — the subset
 * is selected from the one registry, and the evaluation below goes through
 * `runDoctorChecks`, so the doctor and a launch cannot disagree. The flag on
 * `budget.caps` applies only for an automatically picked metered critic, so
 * the subset is narrowed by the launch context, never by a flag, a mode, a
 * comment or a project key (no such input can switch an `lb` check off).
 *
 * A launch MUST be refused when a check with `lb` returns `fail`, and MUST NOT
 * be refused for any other finding (`launchRefusal`). The doctor exposes the
 * same subset for evaluation without launching through `--launch-checks`
 * (`evaluateLaunchChecks`): the form of the doctor that a host hook calls; its
 * exit code follows F112-FR-027.
 */
import { runDoctorChecks, orderFindings } from "../runner/run.ts";
import { exitCodeFor, type ExitInput } from "../runner/exit.ts";
import type { Check, Finding, ProbeBag } from "./types.ts";

/** The one check whose launch-blocking flag is conditional (F112-FR-030). */
export const CONDITIONAL_LAUNCH_CHECK_ID = "budget.caps" as const;

/**
 * The launch context: what only the launch itself knows, read from the
 * resolved registry and configuration by the caller (the pipeline runtime).
 * The only input that narrows the subset is the conditional tenth: the flag on
 * `budget.caps` holds only for an automatically picked metered critic.
 */
export type LaunchContext = {
  readonly autopickMeteredCritic: boolean;
};

/**
 * F112-FR-030 — the launch checks: exactly the checks whose flag `lb` is set,
 * in their fixed order (by `order`, then by id, the running order of the
 * registry). `budget.caps` joins the subset only for an automatically picked
 * metered critic. No other input can remove a check from the subset.
 */
export function launchSubset(checks: readonly Check[], context?: LaunchContext): readonly Check[] {
  return Object.freeze(
    [...checks]
      .filter((c) => c.lb)
      .filter(
        (c) => c.id !== CONDITIONAL_LAUNCH_CHECK_ID || context?.autopickMeteredCritic === true,
      )
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  );
}

/**
 * F112-FR-030 — the launch refusal: refused exactly when a finding of a check
 * with `lb` is `fail`, and for no other finding. Warnings, `info` findings and
 * `fail` findings of non-launch-blocking checks never refuse a launch.
 */
export function launchRefusal(findings: readonly Finding[]): {
  readonly refused: boolean;
  readonly ids: readonly string[];
} {
  const ids = findings
    .filter((f) => f.lb && f.severity === "fail")
    .map((f) => f.id)
    .sort((a, b) => a.localeCompare(b));
  return Object.freeze({ refused: ids.length > 0, ids: Object.freeze(ids) });
}

/** What `evaluateLaunchChecks` holds when it is done (annex G §G.4). */
export interface LaunchChecksResult {
  /** The subset that was evaluated, in its fixed order. */
  readonly subset: readonly Check[];
  /** The findings of the subset, in the output order of the doctor. */
  readonly findings: readonly Finding[];
  /** The exit code per F112-FR-027: 2 when a finding of the subset is `fail`. */
  readonly exit: number;
  /** Whether a launch on this state would be refused (F112-FR-030). */
  readonly refused: boolean;
  /** The ids of the `lb` findings whose `fail` refuses the launch. */
  readonly refusalIds: readonly string[];
}

/**
 * F112-FR-026, annex G §G.4 — evaluate the launch checks without launching
 * (`--launch-checks`): exactly the `lb` subset, in its fixed order, through
 * the same functions as a launch (`runDoctorChecks`). It is the form of the
 * doctor that a host hook calls. The evaluation launches nothing: it runs the
 * probes of the subset over the injected probe bag and nothing else.
 */
export async function evaluateLaunchChecks(input: {
  checks: readonly Check[];
  bag: ProbeBag;
  context?: LaunchContext;
  exit?: ExitInput;
}): Promise<LaunchChecksResult> {
  const subset = launchSubset(input.checks, input.context);
  const run = await runDoctorChecks({ checks: subset, bag: input.bag });
  const refusal = launchRefusal(run.findings);
  const findings = orderFindings(run.findings);
  const exit = run.exit !== 0 ? run.exit : exitCodeFor(findings, input.exit);
  return {
    subset,
    findings,
    exit,
    refused: refusal.refused,
    refusalIds: refusal.ids,
  };
}
