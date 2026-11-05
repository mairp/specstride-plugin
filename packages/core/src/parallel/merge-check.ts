/**
 * T023 and T024 — the merge check and its outcome (feature 142,
 * `packages/core/src/parallel/`).
 *
 * T023 (F142-FR-059; rule PU-48): after the application and the ticks the
 * engine runs the inner check set of the phase on the workspace: **every**
 * command, none skipped at a failure, with fingerprints before and after,
 * through the check runner, **once per group** whatever the worker count. It
 * runs where the application put the work. No check runs in a worker tree.
 *
 * T024 (F142-FR-061; rules PU-49, PU-50): a pass without a condition makes the
 * integrated tasks **one kept unit of work** — a ledger record bound to the
 * fingerprint of the workspace, naming the tasks that the integrated workers
 * named. A failure or a condition sends the same unit to the repair path of the
 * micro-loop layer on the main line and charges **one repair to every task** of
 * the unit. Nothing is reverted.
 *
 * T080 (F142-FR-060; rule PU-79): where the inner check set is empty when the
 * merge check is due, the unit is `unchecked`, **nothing is kept**, and the
 * layer is off for the phase attempt with the reason `unchecked` of row 185. No
 * group is ever kept without a merge check that executed at least one command.
 *
 * T081 (F142-FR-062; rule PU-51): no result obtained in a worker tree and no
 * merge check replaces an execution at the verification gate. The gate runs in
 * full on the workspace after the proposer loop has ended, with no result
 * reused from a group, and the critic is called after it.
 *
 * This module decides and measures; it writes no file. The check runner arrives
 * as an argument (EP-05, annex C §C.8), the fingerprint of the workspace
 * arrives as a function the engine supplies (IR-31), and the ledger record the
 * outcome describes is written by the engine (F142-FR-074). The package is
 * `core` in the package graph, so `node:fs` and `node:child_process` are
 * forbidden to it and nothing here can reach the file system by itself.
 */
import { CONDITIONS, CONDITION_WHEN_UNKNOWN } from "@specstride/contracts/ep/check-runner";
import type {
  CheckResult,
  CheckRunner,
  Condition,
  ContainmentLevel,
  ManifestEntry,
} from "@specstride/contracts/ep/check-runner";

/* ================================================================== *
 * 1. What F142-FR-059 fixes about the merge check.
 * ================================================================== */

/** The merge check runs once per group, whatever the worker count (F142-FR-059). */
export const RUNS_ONCE_PER_GROUP = true as const;

/** No command of the inner check set is skipped at a failure (ruling 51). */
export const NO_COMMAND_IS_SKIPPED_AT_A_FAILURE = true as const;

/** The merge check runs where the application put the work: the workspace. */
export const RUNS_ON_THE_WORKSPACE = true as const;

/** No check runs in a worker tree (F142-FR-059, PU-49). */
export const NO_CHECK_RUNS_IN_A_WORKER_TREE = true as const;

/** Nothing is reverted, whatever the merge check says (F142-FR-061, PU-49). */
export const NOTHING_IS_REVERTED = true as const;

/** The error a request that would run a check in a worker tree is refused with. */
export const CHECK_IN_A_WORKER_TREE =
  "a check of the merge check may not run in a worker tree (F142-FR-059)" as const;

/* ================================================================== *
 * 2. Running the merge check (T023).
 * ================================================================== */

/** What the merge check needs, all of it handed in by the engine. */
export type MergeCheckRequest = {
  /** The check runner of EP-05; the same runner the inner checks use. */
  readonly runner: CheckRunner;
  /**
   * The inner check set of the phase after every exclusion in force, in
   * manifest order. An empty set is the case of F142-FR-060.
   */
  readonly innerCheckSet: readonly ManifestEntry[];
  /** The workspace: the directory the application wrote the composed work to. */
  readonly workspace: string;
  /** The worker trees of the group; no check may run in one of them. */
  readonly workerTrees?: readonly string[];
  readonly containment?: ContainmentLevel;
  readonly environmentAllowList?: readonly string[];
  /** The fingerprint of the workspace, as the engine computes it (IR-31). */
  readonly fingerprintOfTheWorkspace: () => Promise<string>;
};

/** What one command of the inner check set did when the merge check ran it. */
export type CommandRun = {
  readonly id: string;
  readonly exitCode: number;
  readonly durationMs: number;
  /** The one condition the result carries, or `null` where it carries none. */
  readonly condition: Condition | null;
  readonly reason?: string;
  /** The directory the command ran in; always the workspace (F142-FR-059). */
  readonly workingDirectory: string;
};

/** The merge check of one group, as it ran (F142-FR-059). */
export type MergeCheckRun = {
  /** Every command of the inner check set, in manifest order, none skipped. */
  readonly commands: readonly CommandRun[];
  /** True where every command exited 0 and no result carried a condition. */
  readonly passed: boolean;
  /** The first condition any command carried, or `null` where none did. */
  readonly condition: Condition | null;
  readonly fingerprintBefore: string;
  readonly fingerprintAfter: string;
  /** The directory the merge check ran on: the workspace. */
  readonly ranOn: string;
  /**
   * True where the inner check set was empty when the merge check was due: the
   * unit is `unchecked` and is not kept (F142-FR-060).
   */
  readonly unchecked: boolean;
};

/**
 * The one condition a result of the check runner carries, in the order of the
 * closed set of §C.8, or `null` where it carries none. An unknown condition
 * makes the result `unchecked` (`CONDITION_WHEN_UNKNOWN`).
 */
export function conditionOf(result: CheckResult): Condition | null {
  for (const condition of CONDITIONS) {
    if (result[condition] === true) return condition;
  }
  return null;
}

/**
 * Run the merge check of one group (T023, F142-FR-059).
 *
 * Every command of the inner check set runs, in manifest order, and a failure
 * skips none of the rest; every one of them runs in the **workspace**, so a
 * request whose workspace is a worker tree of the group is refused before any
 * command starts; the fingerprint of the workspace is taken before the first
 * command and after the last one; and the whole thing runs once, whatever the
 * worker count of the group — the function takes no worker count at all.
 */
export async function runMergeCheck(request: MergeCheckRequest): Promise<MergeCheckRun> {
  const workerTrees = request.workerTrees ?? [];
  if (workerTrees.includes(request.workspace)) {
    throw new Error(CHECK_IN_A_WORKER_TREE);
  }
  const fingerprintBefore = await request.fingerprintOfTheWorkspace();
  const commands: CommandRun[] = [];
  let condition: Condition | null = null;
  for (const entry of request.innerCheckSet) {
    const identity = await request.runner.pin(entry);
    const handle = await request.runner.start({
      identity,
      workingDirectory: request.workspace,
      environmentAllowList: request.environmentAllowList ?? [],
      timeLimitMs: entry.timeLimitMs,
      containment: request.containment ?? "C2",
    });
    for (;;) {
      const polled = await request.runner.poll(handle);
      if (polled.state === "ended") break;
    }
    const result = await request.runner.result(handle);
    const one = conditionOf(result);
    if (one !== null && condition === null) condition = one;
    commands.push(
      Object.freeze({
        id: entry.id,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        condition: one,
        ...(result.reason === undefined ? {} : { reason: String(result.reason) }),
        workingDirectory: request.workspace,
      }),
    );
    // No `break`: none of the commands is skipped at a failure (ruling 51).
  }
  const fingerprintAfter = await request.fingerprintOfTheWorkspace();
  const unchecked = commands.length === 0;
  return Object.freeze({
    commands: Object.freeze(commands),
    passed: !unchecked && commands.every((run) => run.exitCode === 0) && condition === null,
    condition: unchecked ? CONDITION_WHEN_UNKNOWN : condition,
    fingerprintBefore,
    fingerprintAfter,
    ranOn: request.workspace,
    unchecked,
  });
}

/** The commands of the inner check set that the merge check did not run. */
export function commandsNotRun(
  innerCheckSet: readonly ManifestEntry[],
  run: MergeCheckRun,
): readonly string[] {
  const ran = new Set(run.commands.map((command) => command.id));
  return Object.freeze(innerCheckSet.map((entry) => entry.id).filter((id) => !ran.has(id)));
}

/* ================================================================== *
 * 3. The outcome of the merge check (T024, F142-FR-061).
 * ================================================================== */

/** The kept unit of work of a group (F142-FR-061; entity of `data-model.md`). */
export type KeptUnitOfWork = {
  /** The hash of the sorted task ids of the unit. */
  readonly unitId: string;
  readonly tasks: readonly string[];
  /** The fingerprint of the workspace after the merge check. */
  readonly treeHash: string;
};

/** One repair charged to one task of the unit (F142-FR-061, PU-50). */
export type RepairCharge = { readonly taskId: string; readonly repairs: 1 };

/** The outcome of the merge check: the unit is kept, or it takes the repair path. */
export type MergeCheckOutcome =
  | {
      readonly directive: "keep";
      readonly unit: KeptUnitOfWork;
      readonly repairsCharged: readonly RepairCharge[];
      readonly reverted: false;
      /** The unit is kept: one ledger record bound to the fingerprint. */
      readonly kept: true;
    }
  | {
      readonly directive: "repair";
      readonly unit: KeptUnitOfWork;
      readonly repairsCharged: readonly RepairCharge[];
      readonly reverted: false;
      /** The unit takes the repair path and is not kept (F142-FR-061). */
      readonly kept: false;
      /** Why the unit takes the repair path: a failure, or the condition it carried. */
      readonly because: string;
    }
  | {
      /** The inner check set was empty when the merge check was due (F142-FR-060). */
      readonly directive: "layerOffForAttempt";
      readonly reason: typeof UNCHECKED;
      readonly unit: UncheckedUnit;
      readonly repairsCharged: readonly RepairCharge[];
      readonly reverted: false;
      readonly kept: false;
      readonly because: string;
    };

/** The task ids of a unit, sorted, which is the text the unit id is the hash of. */
export function sortedTaskIds(tasks: readonly string[]): readonly string[] {
  return Object.freeze([...tasks].sort());
}

/**
 * The id of a unit of work: the hash of its sorted task ids (`data-model.md`).
 * The hashing scheme is the canonical one of annex X §X.5 and arrives as an
 * argument, so that this module holds no hashing of its own.
 */
export function unitIdOfTheTasks(tasks: readonly string[], hash: (text: string) => string): string {
  return hash(sortedTaskIds(tasks).join("\n"));
}

/** One repair charged to every task of the unit (F142-FR-061, PU-50, IR-50 d). */
export function oneRepairPerTask(tasks: readonly string[]): readonly RepairCharge[] {
  return Object.freeze(tasks.map((taskId) => Object.freeze({ taskId, repairs: 1 as const })));
}

/**
 * The outcome of the merge check (T024, F142-FR-061).
 *
 * A pass **without a condition** keeps one unit of work: one record naming
 * every task the integrated workers named, bound to the fingerprint of the
 * workspace after the merge check, with nothing charged. A **failure or a
 * condition** sends that same unit to the repair path of the micro-loop layer
 * on the main line and charges one repair to every task of the unit. In both
 * cases nothing is reverted: the workspace keeps the integrated work, so the
 * repair pass starts from it.
 *
 * Before either of them: an **unchecked** run keeps nothing at all and switches
 * the layer off for the phase attempt (F142-FR-060, T080). It is tested first,
 * because an unchecked run is neither a pass nor a failure of the inner set —
 * the inner set did not run.
 */
export function outcomeOfTheMergeCheck(input: {
  readonly run: MergeCheckRun;
  /** The tasks the integrated workers named, in the order of the group. */
  readonly tasks: readonly string[];
  readonly hash: (text: string) => string;
}): MergeCheckOutcome {
  const unit: KeptUnitOfWork = Object.freeze({
    unitId: unitIdOfTheTasks(input.tasks, input.hash),
    tasks: Object.freeze([...input.tasks]),
    treeHash: input.run.fingerprintAfter,
  });
  if (input.run.unchecked) return uncheckedOutcome({ tasks: input.tasks, hash: input.hash });
  if (input.run.passed && input.run.condition === null) {
    return Object.freeze({
      directive: "keep" as const,
      unit,
      repairsCharged: Object.freeze([]),
      reverted: false as const,
      kept: true as const,
    });
  }
  const failed = input.run.commands.filter((command) => command.exitCode !== 0);
  const because =
    input.run.condition !== null
      ? `the merge check carries the condition ${input.run.condition}`
      : `the merge check failed: ${failed.map((command) => `${command.id} exited ${command.exitCode}`).join(", ")}`;
  return Object.freeze({
    directive: "repair" as const,
    unit,
    repairsCharged: oneRepairPerTask(input.tasks),
    reverted: false as const,
    kept: false as const,
    because,
  });
}

/* ================================================================== *
 * 4. The empty inner check set (T080, F142-FR-060, PU-79).
 * ================================================================== */

/**
 * F142-FR-060 — the reason the layer is off for the phase attempt when the
 * inner check set was empty while the merge check was due. It is a member of
 * the closed set of annex X §X.6 row 185, for the phase attempt.
 */
export const UNCHECKED = "unchecked" as const;

/** The row of annex X §X.6 that holds the reasons the layer is off inside a run. */
export const LAYER_OFF_REASON_ROW = 185 as const;

/** The directive the layer returns for an unchecked group (§D.1). */
export const DIRECTIVE_FOR_AN_UNCHECKED_GROUP = "layerOffForAttempt" as const;

/**
 * F142-FR-060 — no group is ever kept without a merge check that executed at
 * least one command. The minimum is one, not zero.
 */
export const COMMANDS_A_KEPT_GROUP_NEEDS = 1 as const;

/**
 * The unit of an unchecked group: it is recorded, named `unchecked`, and bound
 * to **no** tree hash, because nothing is kept (F142-FR-060). It is not a
 * `KeptUnitOfWork`: the type is different so that a record of one cannot be
 * mistaken for a kept unit anywhere it travels.
 */
export type UncheckedUnit = {
  readonly unitId: string;
  readonly tasks: readonly string[];
  /** The state of the unit, which is the word F142-FR-060 uses. */
  readonly state: typeof UNCHECKED;
  /** Nothing is kept, so the unit is bound to no fingerprint. */
  readonly treeHash: null;
};

/**
 * The outcome of a merge check that was due with an empty inner check set
 * (T080, F142-FR-060).
 *
 * Three things happen at once, and the shape of the return makes each of them
 * readable on its own: the unit is recorded as `unchecked`; nothing is kept
 * (`kept` is false and the unit carries no tree hash); and the layer is off for
 * the **phase attempt** — not for the run — with the reason `unchecked`. No
 * repair is charged: the tasks did not fail, the inner set was not there.
 */
export function uncheckedOutcome(input: {
  readonly tasks: readonly string[];
  readonly hash: (text: string) => string;
}): MergeCheckOutcome {
  return Object.freeze({
    directive: DIRECTIVE_FOR_AN_UNCHECKED_GROUP,
    reason: UNCHECKED,
    unit: Object.freeze({
      unitId: unitIdOfTheTasks(input.tasks, input.hash),
      tasks: Object.freeze([...input.tasks]),
      state: UNCHECKED,
      treeHash: null,
    }),
    repairsCharged: Object.freeze([]),
    reverted: false as const,
    kept: false as const,
    because: "the inner check set was empty when the merge check was due (F142-FR-060)",
  });
}

/** True where the outcome is the unchecked one of F142-FR-060. */
export function isUnchecked(
  outcome: MergeCheckOutcome,
): outcome is Extract<MergeCheckOutcome, { readonly reason: typeof UNCHECKED }> {
  return outcome.directive === DIRECTIVE_FOR_AN_UNCHECKED_GROUP;
}

/**
 * F142-FR-060 — the kept units of work that came from a group and whose merge
 * check executed no command. Empty, always: a unit that reaches this function
 * with no executed command is the breach F142-SC-004 measures.
 */
export function keptWithoutAnExecutedCommand(
  units: readonly { readonly unitId: string; readonly commandsExecuted: number }[],
): readonly string[] {
  return Object.freeze(
    units
      .filter((unit) => unit.commandsExecuted < COMMANDS_A_KEPT_GROUP_NEEDS)
      .map((unit) => unit.unitId),
  );
}

/* ================================================================== *
 * 5. The verification gate is not replaced (T081, F142-FR-062, PU-51).
 * ================================================================== */

/** F142-FR-062 — nothing a group produced is offered for reuse at the gate. */
export const RESULTS_OFFERED_FOR_REUSE_AT_THE_VERIFICATION_GATE = Object.freeze([] as const);

/** F142-FR-062 — the gate runs in full, on the workspace, after the proposer loop. */
export const THE_GATE_RUNS_IN_FULL = true as const;
export const THE_GATE_RUNS_ON = "the workspace" as const;
export const THE_GATE_RUNS_AFTER = "the proposer loop has ended" as const;

/** F142-FR-062 — the critic is called after the gate, never before it. */
export const THE_CRITIC_IS_CALLED_AFTER_THE_GATE = true as const;

/**
 * What a group produced, from which a caller might be tempted to reuse a
 * result at the verification gate: the results of the merge check, and anything
 * a check obtained in a worker tree.
 */
export type ResultsOfAGroup = {
  readonly groupId: string;
  readonly mergeCheck: MergeCheckRun;
  /** Results obtained in a worker tree, where a run recorded any. */
  readonly inAWorkerTree?: readonly { readonly id: string; readonly treePath: string }[];
};

/**
 * What a group offers the verification gate for reuse (T081, F142-FR-062):
 * nothing, whatever it holds. The merge check of the group ran on the same
 * workspace with the same commands, and that is exactly why it must not be
 * reused — a gate that reused it would be the inner check approving itself
 * (Principle II).
 */
export function offeredForReuseAtTheVerificationGate(
  _results: ResultsOfAGroup,
): readonly { readonly id: string; readonly reusedFrom: string }[] {
  return Object.freeze([]);
}

/** One execution the verification gate recorded, as the gate records it. */
export type GateExecution = {
  readonly id: string;
  readonly workingDirectory: string;
  /** Set where the execution reused an earlier result; F142-FR-062 forbids it. */
  readonly reusedFrom?: string;
};

/**
 * The plan of the verification gate after a phase attempt that held groups
 * (T081, F142-FR-062): one execution per command of the gate's own manifest, on
 * the workspace, with no `reusedFrom` on any of them.
 */
export function verificationGatePlan(input: {
  readonly gateManifest: readonly ManifestEntry[];
  readonly workspace: string;
  readonly groups: readonly ResultsOfAGroup[];
}): readonly GateExecution[] {
  return Object.freeze(
    input.gateManifest.map((entry) =>
      Object.freeze({ id: entry.id, workingDirectory: input.workspace }),
    ),
  );
}

/**
 * The executions of the verification gate that break F142-FR-062: one that
 * reused a result, and one that did not run on the workspace. Empty on a plan
 * `verificationGatePlan` built.
 */
export function gateExecutionsThatBreakTheRule(
  executions: readonly GateExecution[],
  workspace: string,
): readonly string[] {
  const broken: string[] = [];
  for (const execution of executions) {
    if (execution.reusedFrom !== undefined) {
      broken.push(`${execution.id} reused a result from ${execution.reusedFrom}`);
    }
    if (execution.workingDirectory !== workspace) {
      broken.push(`${execution.id} ran in ${execution.workingDirectory} and not on the workspace`);
    }
  }
  return Object.freeze(broken);
}

/** The commands of the gate's manifest that the plan does not execute: none. */
export function gateCommandsNotExecuted(
  gateManifest: readonly ManifestEntry[],
  executions: readonly GateExecution[],
): readonly string[] {
  const ran = new Set(executions.map((execution) => execution.id));
  return Object.freeze(gateManifest.map((entry) => entry.id).filter((id) => !ran.has(id)));
}
