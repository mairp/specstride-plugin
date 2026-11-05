/**
 * T010 — the dry-run plan of §R.2 (F123-FR-005).
 *
 * With `--dry-run` the pipeline entry prints the plan and executes nothing:
 * no action, no pipeline run, no log, no lock, no state record. The plan is:
 *
 * - `[DRY-RUN]` first;
 * - `[PREFLIGHT]` once per preflight-timed precondition of each stage that
 *   would run, where a `command_success` check is not executed and reads
 *   `deferred`;
 * - then for each stage `[SKIP]`, `[CHECK]` or `[PLAN]`;
 * - exactly one `[DIGEST] state=dry-run exit=0 last-stage=none evidence=none`
 *   as the last line;
 * - exit 0.
 */
import type { Stage } from "../executor/types.ts";
import { runPreflight, type PreflightResult } from "../executor/preflight.ts";
import type { PreconditionCheckRegistry, EvaluationContext } from "../kinds/registry.ts";
import { decideSetupStage } from "../kinds/setup.ts";
import { redactAction, digestLine } from "../output/lines.ts";

/** The lines of the plan, in the order they are printed. */
export type DryRunLine = {
  label: "[DRY-RUN]" | "[PREFLIGHT]" | "[SKIP]" | "[CHECK]" | "[PLAN]" | "[DIGEST]";
  text: string;
  hue: "green" | "yellow" | "cyan" | "dim";
};

/** Whether a smoke stage would run. */
export function smokeWouldRun(stage: Stage, smoke: boolean): boolean {
  return stage.kind !== "smoke" || smoke;
}

/** The plan line of one stage of the dry run. */
export async function planLineForStage(input: {
  stage: Stage;
  implement: boolean;
  smoke: boolean;
  checks: PreconditionCheckRegistry;
  context: EvaluationContext;
}): Promise<DryRunLine> {
  const { stage } = input;
  if (!smokeWouldRun(stage, input.smoke)) {
    return { label: "[SKIP]", text: `${stage.id} (enable with --smoke)`, hue: "yellow" };
  }
  if (stage.kind === "setup" && !input.implement) {
    const decision = await decideSetupStage({
      stage,
      implement: false,
      checks: input.checks,
      context: input.context,
    });
    if (decision.behaviour !== "run") {
      return {
        label: "[CHECK]",
        text: `${stage.id} uses existing prerequisite; --implement would run setup`,
        hue: "cyan",
      };
    }
  }
  const action = stage.action;
  return {
    label: "[PLAN]",
    text: `${stage.id}: ${action === undefined ? "(no action)" : redactAction(planActionOf(action))}`,
    hue: "cyan",
  };
}

/**
 * The action of a plan line as `redactAction` takes it. The stages the entry
 * plans are the RAW stages of the launch contract, and the contract writes
 * the action in either of the two shapes the product's readers accept: the
 * argument list itself (the dialect the completion of feature 107 writes,
 * F107-FR-041a) or a record that carries it (annex G §G.8). The plan prints
 * the argument list either way; the record's environment entries, when it
 * has them, are printed as their sorted names by `redactAction`.
 */
function planActionOf(action: unknown): {
  argv: readonly string[];
  env?: readonly { name: string; target?: string; value?: string }[];
} {
  if (Array.isArray(action)) return { argv: action as readonly string[] };
  const record = (action ?? {}) as {
    argv?: unknown;
    env?: unknown;
  };
  const argv = Array.isArray(record.argv) ? (record.argv as readonly string[]) : [];
  const env = Array.isArray(record.env)
    ? (record.env as { name: string; target?: string; value?: string }[])
    : undefined;
  return { argv, ...(env === undefined ? {} : { env }) };
}

/**
 * Build the whole plan. Pure over its inputs; the caller prints. No port is
 * called that acts: the preflight here only reads (F123-FR-005).
 */
export async function planDryRun(input: {
  contractId: string;
  stages: readonly Stage[];
  implement: boolean;
  smoke: boolean;
  checks: PreconditionCheckRegistry;
  context: EvaluationContext;
  shell: Readonly<Record<string, string | undefined>>;
  /** The parallel-units option of F123-FR-006; absent means the option is off. */
  parallel?: ParallelPlanInput;
}): Promise<{ lines: DryRunLine[]; preflight: PreflightResult }> {
  const lines: DryRunLine[] = [];
  lines.push({
    label: "[DRY-RUN]",
    text: `contract ${input.contractId} is source-current; no actions or writes will occur`,
    hue: "green",
  });

  // The plan runs the preflight for the stages that would run, so that a
  // `command_success` check reads `deferred` and never executes.
  const wouldRun = input.stages.filter((stage) => smokeWouldRun(stage, input.smoke));
  const preflight = await runPreflight({
    stages: wouldRun,
    implement: input.implement,
    checks: input.checks,
    context: input.context,
    shell: input.shell,
  });
  for (const check of preflight.checks) {
    const verdict =
      check.result === "pass" ? "pass" : check.result === "fail" ? "fail" : "deferred";
    lines.push({
      label: "[PREFLIGHT]",
      text: `${check.line}: ${verdict}`,
      hue: check.result === "pass" ? "green" : "yellow",
    });
  }

  for (const stage of input.stages) {
    lines.push(
      await planLineForStage({
        stage,
        implement: input.implement,
        smoke: input.smoke,
        checks: input.checks,
        context: input.context,
      }),
    );
  }

  // The parallel plan (F123-FR-006): with the option on, the plan — the
  // stored one, or the one the same pure derivation gives — is part of the
  // dry-run plan; with the option off, and under the `parity` profile, no
  // line about it is printed at all.
  if (input.parallel !== undefined && parallelUnitsOn(input.parallel)) {
    const plan =
      readStoredParallelPlan(input.parallel.storedPlan) ??
      deriveParallelPlan({
        runId: input.parallel.runId ?? input.contractId,
        stages: input.stages,
        workers: input.parallel.workers,
      });
    for (const text of parallelPlanLines(plan)) {
      lines.push({ label: "[PLAN]", text, hue: "cyan" });
    }
  }

  lines.push({
    label: "[DIGEST]",
    text: digestLine({
      state: "dry-run",
      exit: 0,
      lastStage: null,
      childExit: null,
      evidence: null,
    }).replace("[DIGEST] ", ""),
    hue: "dim",
  });
  return { lines, preflight };
}

/* ================================================================== *
 * The parallel plan of the dry run (T077, F123-FR-006).
 *
 * `@specstride/pipeline` may import only `@specstride/contracts`,
 * `@specstride/kernel`, `@specstride/spec-formats` and `@specstride/config`
 * (`packages/contracts/data/package-graph.json`), so the layer `parallel` of
 * feature 142 is not imported here. The plan reaches this entry in one of the
 * two ways F123-FR-006 names:
 *
 *  - **read from the stored plan**: the composition root injects the record
 *    the engine stored under `run:<runId>:parallel-plan`
 *    (`specstride.parallel-plan/1`, feature 100 annex D §D.3) and
 *    `readStoredParallelPlan` takes it as it stands;
 *  - **derived by the same pure function**: where nothing was stored, the
 *    pure derivation `deriveParallelPlan` computes the plan over the stages
 *    of the launch contract with the rules annex D §D.3 states — groups of
 *    consecutive tasks of at least 2 and at most the worker count, the rest
 *    serial with the reason `alone-in-its-run-of-admitted-tasks`, and the
 *    ceiling of the speed-up per phase under equal task cost.
 *
 * The option `loop.parallel.units` is off by default and off under the
 * `parity` profile (owner ruling 56); with it off, and under that profile,
 * the dry run prints no line about the plan at all — the one gate
 * `parallelUnitsOn`, so that a second guard cannot drift from the first.
 */

/** The schema id of the stored plan (annex D §D.3). */
export const PARALLEL_PLAN_SCHEMA = "specstride.parallel-plan/1" as const;

/** The key of the option (row 20 of annex X §X.7). */
export const PARALLEL_UNITS_KEY = "loop.parallel.units" as const;

/** The logical name the engine stores the plan under (annex B §B.5). */
export const PARALLEL_PLAN_LOGICAL_NAME = "run:<runId>:parallel-plan" as const;

/** A group holds at least two tasks, and at most the worker count (§D.3). */
export const GROUP_MIN_TASKS = 2 as const;

/** The worker count the derivation assumes where none is in force (§D.3). */
export const WORKERS_DEFAULT = 2 as const;

/** Why a task is serial where its run of consecutive tasks was too short. */
export const ALONE_IN_ITS_RUN = "alone-in-its-run-of-admitted-tasks" as const;

/** One group of the plan. */
export type PlannedGroup = {
  readonly ordinal: number;
  readonly phase: number;
  readonly tasks: readonly string[];
};

/** One task made serial, with its reason. */
export type SerialTask = {
  readonly id: string;
  readonly reason: string;
};

/** One phase of the plan (annex D §D.3). */
export type PhasePlan = {
  readonly phase: number;
  readonly groups: readonly PlannedGroup[];
  readonly serial: readonly SerialTask[];
  /** The ceiling of the speed-up of the phase under equal task cost. */
  readonly ceiling: number;
};

/** The parallel plan (annex D §D.3, `specstride.parallel-plan/1`). */
export type ParallelPlan = {
  readonly schema: typeof PARALLEL_PLAN_SCHEMA;
  readonly runId: string;
  /** The canonical hash of the stored plan; empty where the plan is derived. */
  readonly hash: string;
  readonly workers: number;
  readonly phases: readonly PhasePlan[];
  readonly fallback: string | null;
};

/** What the dry run is given about the parallel-units option. */
export type ParallelPlanInput = {
  /** The value of `loop.parallel.units`; anything but `"on"` is off. */
  units?: string;
  /** The profile in force; the `parity` profile switches the option off. */
  profile?: string;
  /** The stored plan record, as the engine wrote it, if there is one. */
  storedPlan?: unknown;
  /** The run id the derivation names in the plan it computes. */
  runId?: string;
  /** The worker count in force; the derivation defaults it to 2. */
  workers?: number;
};

/**
 * Whether the parallel plan belongs in the dry-run plan (F123-FR-006): the
 * option is on **and** the profile is not `parity`. This is the one gate.
 */
export function parallelUnitsOn(input: ParallelPlanInput): boolean {
  return input.units === "on" && input.profile !== "parity";
}

/**
 * Read the stored plan (F123-FR-006). A record that is not of schema
 * `specstride.parallel-plan/1` is not a stored plan: the reader returns
 * `null` and the caller derives instead. Nothing is repaired and nothing is
 * written.
 */
export function readStoredParallelPlan(record: unknown): ParallelPlan | null {
  if (typeof record !== "object" || record === null) return null;
  const candidate = record as Record<string, unknown>;
  if (candidate["schema"] !== PARALLEL_PLAN_SCHEMA) return null;
  if (typeof candidate["runId"] !== "string") return null;
  if (!Array.isArray(candidate["phases"])) return null;
  return record as unknown as ParallelPlan;
}

/**
 * The ceiling of the speed-up of a phase under equal task cost (annex D
 * §D.3): a phase of `n` tasks whose groups hold `g1..gk` tasks costs
 * `n - sum(gi) + k` task-times, so the ceiling is the ratio of the two, and
 * it is 1 where the plan holds no group.
 */
export function ceilingOfTheSpeedUp(input: {
  tasks: readonly { readonly id: string }[];
  groups: readonly { readonly tasks: readonly string[] }[];
}): number {
  const n = input.tasks.length;
  if (n === 0) return 1;
  const grouped = input.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const cost = n - grouped + input.groups.length;
  return cost === 0 ? 1 : n / cost;
}

/**
 * Derive the plan (F123-FR-006, annex D §D.3). Pure: the same stages and the
 * same worker count give the same plan. Consecutive runs of stages of at
 * least `GROUP_MIN_TASKS` are cut into groups of at most `workers` tasks; a
 * trailing run that is too short for a group stays serial, with the reason
 * `alone-in-its-run-of-admitted-tasks`. The hash stays empty: the canonical
 * hasher is a service of the composition root, and a derived plan is never
 * stored.
 */
export function deriveParallelPlan(input: {
  runId: string;
  stages: readonly Stage[];
  workers?: number;
}): ParallelPlan {
  const workers =
    input.workers !== undefined && Number.isInteger(input.workers) && input.workers >= 1
      ? input.workers
      : WORKERS_DEFAULT;
  const ids = input.stages.map((stage) => stage.id);
  const groups: PlannedGroup[] = [];
  const serial: SerialTask[] = [];
  let index = 0;
  let ordinal = 1;
  while (index < ids.length) {
    const cut = ids.slice(index, index + workers);
    if (cut.length >= GROUP_MIN_TASKS) {
      groups.push({ ordinal: ordinal++, phase: 1, tasks: Object.freeze([...cut]) });
      index += cut.length;
    } else {
      for (const id of ids.slice(index)) {
        serial.push({ id, reason: ALONE_IN_ITS_RUN });
      }
      index = ids.length;
    }
  }
  const tasks = Object.freeze(ids.map((id) => ({ id })));
  const phase: PhasePlan = Object.freeze({
    phase: 1,
    groups: Object.freeze(groups),
    serial: Object.freeze(serial),
    ceiling: ceilingOfTheSpeedUp({ tasks, groups }),
  });
  return Object.freeze({
    schema: PARALLEL_PLAN_SCHEMA,
    runId: input.runId,
    hash: "",
    workers,
    phases: Object.freeze([phase]),
    fallback: null,
  });
}

/**
 * The lines the dry run prints for a plan (F123-FR-006, annex D §D.3): the
 * header with the group count, the worker count and the hash; per phase the
 * ceiling and, for each group and each serial task, one line.
 */
export function parallelPlanLines(plan: ParallelPlan): readonly string[] {
  const groups = plan.phases.reduce((sum, phase) => sum + phase.groups.length, 0);
  const lines: string[] = [
    `parallel plan (launch --dry-run): ${groups} group(s), workers=${plan.workers}, hash=${plan.hash}`,
  ];
  for (const phase of plan.phases) {
    lines.push(`phase ${phase.phase}: ceiling=${phase.ceiling.toFixed(2)} under equal task cost`);
    for (const group of phase.groups) {
      lines.push(`  group ${group.ordinal}: ${group.tasks.join(", ")}`);
    }
    for (const task of phase.serial) {
      lines.push(`  serial ${task.id}: reason=${task.reason}`);
    }
  }
  return Object.freeze(lines);
}
