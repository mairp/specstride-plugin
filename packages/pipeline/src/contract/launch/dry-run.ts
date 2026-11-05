/**
 * T052 — the `dry-run` mode of `launch` (F107-FR-033; F107-SC-003;
 * F107-FR-038; contracts/commands.md, row "`launch`", mode `dry-run`).
 *
 * What a dry run does, and the one thing it never does:
 *
 * - it VALIDATES THE PROMOTED LAUNCH CONTRACT AGAIN, with the source check
 *   (the one validation order of `validate/order.ts` — never a second
 *   reading of the rules);
 * - it REPORTS what would be launched: the pipeline id, the features, the
 *   stages with their time limits, the verification mode with its reason,
 *   the comment and what it changed, the launch checks evaluated WITHOUT
 *   launching, and the read-only plan of the pipeline entry (F123-FR-005);
 * - with parallel units on, the report includes the PARALLEL PLAN exactly
 *   once, as part of the plan of the pipeline entry — the entry prints it
 *   (F123-FR-006), and this module never prints a second one; with the units
 *   off it prints no line about it (F107-FR-038);
 * - a launch check that would refuse is A LINE OF THE REPORT and never a
 *   change of the exit code (F107-FR-033);
 * - it LAUNCHES NOTHING (F107-SC-003): no detached runtime, no engine, no
 *   harness, no stage action starts, and no launch record, lease, process
 *   registry entry, event, run record or comment record is written. The
 *   function writes nothing at all — its only output is the returned lines;
 * - it DERIVES NOTHING (F107-FR-033): the function reads a contract that the
 *   launch-contract commands already derived, judged, validated, promoted and
 *   rendered. A contract that is absent, not JSON, a draft or invalid ends
 *   the dry run with exit 20 and a `next:` line that names `contract derive`;
 *   stale sources end it with exit 23.
 *
 * The exit codes are those of the `launch` table of `commands/exit-codes.ts`:
 * 0 reported; 20 no promoted launch contract; 23 stale sources.
 */
import { isAbsolute, join } from "node:path";

import { parallelPlan } from "@specstride/contracts";

import type { Condition, ConditionTiming } from "../../executor/types.ts";
import { PreconditionCheckRegistry, type EvaluationContext } from "../../kinds/registry.ts";
import { DEFAULT_CHECKS } from "../default-registries.ts";
import { readContractFromDisk } from "../promote/promote.ts";
import { validateInOrder, type ValidationOptions } from "../validate/order.ts";
import {
  stageTimeLimitSec,
  type SupervisionCeilings,
  resolvedCeilings,
} from "../validate/supervision.ts";
import { StageKindRegistry } from "../../kinds/registry.ts";
import { DEFAULT_STAGE_KINDS } from "../default-registries.ts";
import { productLine } from "../commands/lines.ts";

/** The exit codes of the mode `dry-run` (annex G §G.4, row "`launch`"). */
export const DRY_RUN_EXIT_CODES = { reported: 0, noContract: 20, stale: 23 } as const;

/** The `next:` a dry run without a promoted launch contract names (F107-FR-033). */
export const DRY_RUN_NEXT = "contract derive" as const;

/** The label of the dry-run line (contracts/commands.md, product lines). */
export const DRY_RUN_LABEL = "[SPECSTRIDE-DRY-RUN]" as const;

/** One launch check, evaluated without launching (F107-FR-033). */
export type LaunchCheckEvaluation = {
  /** The check, as `stage/check` (or a bare id for a check of the whole launch). */
  readonly id: string;
  /** True when the check would refuse the launch. */
  readonly refused: boolean;
  /** The detail of the reading (pass, refuse or deferred). */
  readonly detail: string;
};

/** An injectable launch check: a pure, read-only evaluation over the contract. */
export type LaunchCheck = {
  readonly id: string;
  evaluate(contract: Record<string, unknown>, root: string): LaunchCheckEvaluation;
};

/** One condition of a stage, as the contract carries it. */
type ConditionRecord = {
  readonly check?: unknown;
  readonly timing?: unknown;
  readonly target?: unknown;
  readonly path?: unknown;
  readonly params?: unknown;
  readonly name?: unknown;
  readonly command?: unknown;
  readonly field?: unknown;
  readonly value?: unknown;
};

function asCondition(raw: ConditionRecord): Condition | undefined {
  if (typeof raw.check !== "string") return undefined;
  const timing = (typeof raw.timing === "string" ? raw.timing : "preflight") as ConditionTiming;
  const params: Record<string, unknown> = {
    ...(raw.params as Record<string, unknown> | undefined),
  };
  if (params.path === undefined) {
    const target = raw.target ?? raw.path;
    if (typeof target === "string") params.path = target;
  }
  // `command_available` names its command by `target` in the contract.
  if (raw.check === "command_available" && params.command === undefined) {
    const target = raw.target ?? raw.path;
    if (typeof target === "string") params.command = target;
  }
  if (params.name === undefined && typeof raw.name === "string") params.name = raw.name;
  if (params.command === undefined && typeof raw.command === "string") params.command = raw.command;
  if (params.field === undefined && typeof raw.field === "string") params.field = raw.field;
  if (params.value === undefined && raw.value !== undefined) params.value = raw.value;
  return { check: raw.check, timing, params };
}

/**
 * The launch checks of the contract, by DEFAULT: the preflight preconditions
 * of its stages, evaluated through the registry of precondition checks
 * (EP-19). Every built-in check reads and never writes (the registry's own
 * rule), so evaluating them here launches nothing — a `command_success` reads
 * `deferred`, as the dry run must.
 */
export async function defaultLaunchChecks(
  contract: Record<string, unknown>,
  root: string,
): Promise<readonly LaunchCheckEvaluation[]> {
  const registry = new PreconditionCheckRegistry(DEFAULT_CHECKS);
  const context: EvaluationContext = {
    env: process.env,
    cwd: root,
    implement: false,
  };
  const evaluations: LaunchCheckEvaluation[] = [];
  const stages = Array.isArray(contract.stages)
    ? (contract.stages as Record<string, unknown>[])
    : [];
  for (const stage of stages) {
    const stageId = String(stage.id ?? "stage");
    const preconditions = Array.isArray(stage.preconditions)
      ? (stage.preconditions as ConditionRecord[])
      : [];
    for (const raw of preconditions) {
      const condition = asCondition(raw);
      if (condition === undefined) continue;
      // A relative target of the contract is relative to the repository root
      // (the rule the validator applies); the check receives it absolute.
      if (typeof condition.params.path === "string" && !isAbsolute(condition.params.path)) {
        condition.params.path = join(root, condition.params.path);
      }
      // The registry runs the check: a check that throws is `fail`, an
      // unregistered check is `fail` — and every built-in check reads and
      // never writes (EP-19), so this launches nothing.
      const result = await registry.run(condition, context);
      evaluations.push({
        id: `${stageId}/${condition.check}`,
        refused: result.result === "fail",
        detail: result.detail,
      });
    }
  }
  return evaluations;
}

/**
 * The parallel plan of the report (F107-FR-038): per feature, the groups,
 * the tasks made serial with the reason, and the ceiling under equal task
 * cost. Printed ONCE, as part of the plan of the pipeline entry — the entry
 * prints the plan (F123-FR-006); this module hands it over, it never prints
 * a second one. WITH THE UNITS OFF this function is not called and NO line
 * about the parallel plan exists.
 */
export function parallelPlanLines(
  contract: Record<string, unknown>,
  options: { readonly workersMax?: number | undefined } = {},
): readonly string[] {
  const lines: string[] = [];
  const features = Array.isArray(contract.features)
    ? (contract.features as Record<string, unknown>[])
    : [];
  const tasks = (() => {
    const inventory = contract.inventory as { tasks?: unknown } | undefined;
    return Array.isArray(inventory?.tasks) ? (inventory.tasks as Record<string, unknown>[]) : [];
  })();
  const ceiling = parallelPlan.ceilingInForce({
    fromLowerRanks:
      options.workersMax ?? parallelPlan.KEY_DEFAULTS[parallelPlan.WORKERS_CEILING_KEY],
  });
  for (const feature of features) {
    const slug = String(feature.slug ?? feature.path ?? "feature");
    const path = String(feature.path ?? "");
    const mine = tasks.filter((one) => String(one.source ?? "").startsWith(`${path}/`));
    const parallel = mine.filter((one) => one.parallel_marker === true);
    const serial = mine.filter((one) => one.parallel_marker !== true);
    const groups = new Map<string, string[]>();
    for (const task of parallel) {
      const phase = String(task.phase ?? "0");
      groups.set(phase, [...(groups.get(phase) ?? []), String(task.id ?? "")]);
    }
    lines.push(
      `parallel-plan feature=${slug} groups=${groups.size} ` +
        `serial=${serial.length} ceiling=${ceiling.value}`,
    );
    for (const [phase, ids] of [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
      lines.push(`parallel-plan group phase=${phase} tasks=${ids.join(",")}`);
    }
    for (const task of serial) {
      lines.push(`parallel-plan serial task=${String(task.id ?? "")} reason=not marked [P]`);
    }
  }
  return lines;
}

/** The report of one dry run. */
export type DryRunOutcome = {
  readonly exit: (typeof DRY_RUN_EXIT_CODES)[keyof typeof DRY_RUN_EXIT_CODES];
  readonly lines: readonly string[];
  /** The pipeline id of the contract, when it was read. */
  readonly pipelineId?: string;
  /** The launch checks evaluated without launching, when they ran. */
  readonly launchChecks?: readonly LaunchCheckEvaluation[];
};

/** The input of one dry run: everything injectable, nothing derived. */
export type DryRunInput = {
  /** The promoted launch contract: a path, or a logical name of the state. */
  readonly contractFile: string;
  /** The repository root the validation resolves the sources against. */
  readonly root: string;
  /** Parallel units on (F107-FR-038): the plan of the entry carries it once. */
  readonly parallelUnits?: boolean;
  /** The comment of the call, redacted and cut, as the report shows it. */
  readonly commentShown?: string | undefined;
  /** The ceiling of the workers (F100-FR-127), for the parallel plan. */
  readonly workersMax?: number | undefined;
  /** The ceilings of the relaunch budget, for the validation again. */
  readonly ceilings?: SupervisionCeilings | undefined;
  /** The launch checks; the preflight preconditions of the stages by default. */
  readonly launchChecks?: readonly LaunchCheck[] | undefined;
};

/** The refusal lines of a dry run without a promoted launch contract (exit 20). */
function noContractLines(): readonly string[] {
  return [
    `[SPECSTRIDE-REFUSE] action=launch reason=no-contract next=${JSON.stringify(DRY_RUN_NEXT)}`,
    `next: ${DRY_RUN_NEXT}`,
  ];
}

/**
 * F107-FR-033 — one dry run. It validates again, evaluates the launch checks
 * without launching, reports, and stops. It writes NOTHING: no launch record,
 * no lease, no comment record, no event, no run record (F107-SC-003), and it
 * derives nothing (the absence of a contract is exit 20, never a derivation).
 */
export async function dryRun(input: DryRunInput): Promise<DryRunOutcome> {
  // The contract AS WRITTEN ON DISK. Absent, not JSON or not an object: exit
  // 20, and the `next:` line names `contract derive` — launch never derives.
  const reading = readContractFromDisk(input.contractFile);
  if (!reading.ok) {
    return { exit: DRY_RUN_EXIT_CODES.noContract, lines: noContractLines() };
  }
  const contract = reading.record as Record<string, unknown>;

  // A contract that is not PROMOTED is no promoted launch contract (exit 20).
  if (contract.status !== "validated") {
    return { exit: DRY_RUN_EXIT_CODES.noContract, lines: noContractLines() };
  }

  // Validate again, with the source check (F107-FR-033): the ONE validation
  // order, strict — no `--allow-draft`, no `--no-source-check`.
  const options: ValidationOptions = {
    root: input.root,
    stageKinds: new StageKindRegistry(DEFAULT_STAGE_KINDS, "launch-dry-run-107"),
    checks: new PreconditionCheckRegistry(DEFAULT_CHECKS),
    allowDraft: false,
    noSourceCheck: false,
    ...(input.ceilings !== undefined
      ? { ceilings: input.ceilings }
      : { ceilings: resolvedCeilings() }),
  };
  const outcome = validateInOrder(reading.record, options);
  if (outcome.exit === 20) {
    return {
      exit: DRY_RUN_EXIT_CODES.noContract,
      lines: [
        ...noContractLines(),
        ...outcome.composedErrors.map((one) => `${one.path}: ${one.message}`),
        ...outcome.problems.map((one) => `${one.path}: ${one.message}`),
      ],
    };
  }
  if (outcome.exit === 23) {
    return {
      exit: DRY_RUN_EXIT_CODES.stale,
      lines: [
        "launch: the sources of the launch contract changed; re-derive and re-render",
        ...outcome.changed.map((one) => `sources[${one.index}] ${one.state}: ${one.path}`),
      ],
    };
  }

  // The launch checks, evaluated WITHOUT launching (F107-FR-033). An
  // injected check runs first; the default is the preflight preconditions of
  // the stages through the registry. A refusal is A LINE OF THE REPORT and
  // never a change of the exit code.
  const injected = (input.launchChecks ?? []).map(async (one) => {
    const evaluation = await one.evaluate(contract, input.root);
    return { id: one.id, refused: evaluation.refused, detail: evaluation.detail };
  });
  const evaluations = [
    ...(await Promise.all(injected)),
    ...(await defaultLaunchChecks(contract, input.root)),
  ];

  // The report (F107-FR-033): the dry-run line, the stages with their time
  // limits, the checks, and the read-only plan of the pipeline entry.
  const configuration = (contract.configuration ?? {}) as Record<string, unknown>;
  const verification = (configuration.verification ?? {}) as Record<string, unknown>;
  const comment = (configuration.comment ?? undefined) as Record<string, unknown> | undefined;
  const changed = Array.isArray(comment?.changed) ? (comment.changed as unknown[]).length : 0;
  const stages = Array.isArray(contract.stages)
    ? (contract.stages as Record<string, unknown>[])
    : [];
  const features = Array.isArray(contract.features)
    ? (contract.features as Record<string, unknown>[])
    : [];
  const pipelineId = String(contract.id ?? "");
  const limits = stages.length > 0 ? stages.map((one) => stageTimeLimitSec(one)).join(",") : "-";

  const lines: string[] = [
    productLine(DRY_RUN_LABEL, {
      pipeline: pipelineId,
      features: features.length,
      stages: stages.length,
      limits,
      verification: String(verification.mode ?? ""),
      reason: String(verification.reason ?? ""),
      comment: input.commentShown ?? "none",
      changed,
    }),
  ];
  for (const stage of stages) {
    lines.push(
      `stage ${String(stage.id ?? "")} limit=${stageTimeLimitSec(stage)}` +
        `${Array.isArray(stage.depends_on) && (stage.depends_on as unknown[]).length > 0 ? ` depends=${(stage.depends_on as string[]).join(",")}` : ""}`,
    );
  }
  for (const evaluation of evaluations) {
    lines.push(
      evaluation.refused
        ? `launch-check ${evaluation.id} would refuse: ${evaluation.detail}`
        : `launch-check ${evaluation.id} ${evaluation.detail}`,
    );
  }

  // The read-only plan of the pipeline entry (F123-FR-005), with the
  // parallel plan ONCE inside it when the units are on (F107-FR-038) — and
  // no line about the parallel plan when they are off.
  lines.push(`plan pipeline-entry=${pipelineId} stages=${stages.length} (read-only)`);
  if (input.parallelUnits === true) {
    lines.push(...parallelPlanLines(contract, { workersMax: input.workersMax }));
  }

  return {
    exit: DRY_RUN_EXIT_CODES.reported,
    lines,
    pipelineId,
    launchChecks: evaluations,
  };
}
