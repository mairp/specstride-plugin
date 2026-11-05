/**
 * T016, T017 and T020 — candidates, the eight admission checks and the groups
 * of the layer `parallel` (feature 142).
 *
 * T016 (F142-FR-007; rule PU-09): candidates are read from the task list **as
 * read at launch**. A task is a candidate only if that reading carries the
 * marker `[P]` on it. The marker is necessary and never sufficient: a task
 * without it is never assigned to a worker, whatever configuration says, and a
 * task with it still has to pass the eight checks.
 *
 * T020 (F142-FR-011; rule PU-13): admission is a pure function, greedy in the
 * order of the tasks with the worker cap. Its checks are the closed set of row
 * 61 — `marker`, `scope`, `protected`, `resource`, `headroom`, `check`,
 * `links`, `jobs` — and every one of them is recorded per task with its
 * verdict and its detail. A task that fails a check is serial, with the failed
 * check as the reason; it is never dropped. Every task of a phase appears in
 * exactly one of a group or the serial list, and the same inputs give the same
 * plan.
 *
 * T017 (F142-FR-008; rules PU-10, PU-14, PU-86, PU-102): a group is a run of
 * consecutive **admitted** tasks in the order of the tasks at launch, inside
 * one phase, with no heading and no other task between them. A candidate that
 * admission makes serial ends the run at its position. A group holds at least
 * 2 and at most `workers` tasks; a longer run gives successive groups, each
 * with its own base snapshot, barrier and merge check. Groups never cross a
 * phase.
 *
 * The module is pure: it reads no file, starts no process, calls no service,
 * holds no state and mutates nothing it is given. Everything the eight checks
 * read arrives in `AdmissionInputs`, which the engine fills from the view of
 * the phase attempt and from configuration.
 */
import { scopesOverlap } from "./scope.ts";
import type { ScopeDecision } from "./scope.ts";
import { ADMISSION_CHECKS, ALONE_IN_ITS_RUN, GROUP_MIN_TASKS, WORKERS_DEFAULT } from "./types.ts";
import type {
  AdmissionCheck,
  AdmissionVerdict,
  CandidateTask,
  PlannedGroup,
  WriteScope,
} from "./types.ts";

/* ================================================================== *
 * 1. Candidates: the marker `[P]` (T016, F142-FR-007, PU-09).
 * ================================================================== */

/** The marker the task list carries on a task that may be worked in parallel. */
export const MARKER = "[P]" as const;

/** The marker is necessary for a candidate (F142-FR-007). */
export const MARKER_IS_NECESSARY = true as const;

/** The marker is never sufficient: the eight checks still run (F142-FR-007). */
export const MARKER_IS_SUFFICIENT = false as const;

/**
 * One task of the task list as read at launch (F142-FR-007). `marked` is the
 * marker `[P]` as **that reading** carries it, not as a later reading does:
 * the plan is computed once, at launch, from this list (F142-FR-017).
 */
export type TaskAsReadAtLaunch = {
  readonly id: string;
  /** The phase the task belongs to; a group never crosses a phase. */
  readonly phase: number;
  /** True where the reading of the task list at launch carries `[P]` on it. */
  readonly marked: boolean;
  /** The text of the task, which is the second source of a scope. */
  readonly text?: string;
  /** True where a heading stands between this task and the one before it. */
  readonly headingBefore?: boolean;
  /** True where the reading at launch already ticks the task. */
  readonly ticked?: boolean;
};

/** True where the task list as read at launch makes this task a candidate. */
export function isCandidate(task: TaskAsReadAtLaunch): boolean {
  return task.marked;
}

/**
 * The candidates of a list of tasks: those and only those that the reading of
 * the task list at launch marks `[P]` (F142-FR-007, T016). The order of the
 * list is kept, because admission is greedy in that order.
 */
export function candidatesOf(tasks: readonly TaskAsReadAtLaunch[]): readonly TaskAsReadAtLaunch[] {
  return Object.freeze(tasks.filter(isCandidate));
}

/**
 * The ids of tasks that a group names although the task list at launch does
 * not mark them — the guard of "a task without the marker MUST never be
 * assigned to a worker, whatever configuration says" (F142-FR-007). An empty
 * list is the only acceptable value.
 */
export function assignedWithoutTheMarker(
  tasks: readonly TaskAsReadAtLaunch[],
  assigned: readonly string[],
): readonly string[] {
  const marked = new Set(candidatesOf(tasks).map((task) => task.id));
  return Object.freeze(assigned.filter((id) => !marked.has(id)));
}

/* ================================================================== *
 * 2. What the eight checks read (T020, F142-FR-011 to F142-FR-016).
 * ================================================================== */

/** The utilisation of the quota windows of the proposer's account, in per cent. */
export type QuotaObservation = {
  /** The last observed utilisation of every window, in per cent; empty where none was observed. */
  readonly utilisationPerCent: readonly number[];
  /** `loop.parallel.quota_headroom`, in per cent (row 22 of annex X §X.7). */
  readonly headroomPerCent: number;
};

/** What the check `headroom` reads (F142-FR-016). */
export type Headroom = {
  readonly quota?: QuotaObservation;
  /** True where a hard cap on spending is in force. */
  readonly hardCap?: boolean;
  /** The remaining budget of the role, in the unit of the cost below. */
  readonly budgetRemaining?: number;
  /** The cost of a pass at the 90th percentile of the passes so far. */
  readonly costP90?: number;
  /** True where the harness adapter declares a process-level spending limit. */
  readonly spendLimitDeclared?: boolean;
  /** The free space of the file system of the worker root, in bytes. */
  readonly freeSpaceBytes?: number;
  /** The size of the base snapshot plus the seed paths, in bytes. */
  readonly baseSnapshotBytes?: number;
  /** The remaining cycles of the micro-loop layer (assumption CQ-111). */
  readonly remainingCycles?: number;
};

/** An exclusive resource a phase names, with the capacity configuration gives it. */
export type ExclusiveResource = {
  readonly name: string;
  /** `loop.parallel.resources.<name>.capacity`, 1 by default (row 96). */
  readonly capacity: number;
};

/** The containment level in force (annex C §C.15). */
export type Containment = "C0" | "C1" | "C2" | "C3";

/**
 * Everything the eight checks read. The layer computes nothing of this itself:
 * the engine fills it from the view of the phase attempt, the registry, the
 * process registry, the check manifest and configuration (F142-FR-005 — with
 * no group started the layer calls no service).
 */
export type AdmissionInputs = {
  /** The worker count in force; the cap of a group (F142-FR-019). */
  readonly workers?: number;
  /** The scope decision of every task, keyed by task id (F142-FR-010). */
  readonly scopes?: Readonly<Record<string, ScopeDecision>>;
  /** The single-writer files of F142-FR-057, as paths of the workspace. */
  readonly singleWriterPaths?: readonly string[];
  /** The inner check set of the phase after every exclusion in force (F142-FR-012). */
  readonly innerCheckSet?: readonly string[];
  /** Symbolic links of the base snapshot that are absolute or leave the tree (F142-FR-013). */
  readonly linksLeavingTheTree?: readonly string[];
  readonly containment?: Containment;
  /** Detached jobs of the run with the class `adoptable` that are alive (F142-FR-014). */
  readonly adoptableJobsAlive?: number;
  /** The exclusive resources the phase names (F142-FR-015). */
  readonly exclusiveResources?: readonly ExclusiveResource[];
  readonly headroom?: Headroom;
};

/* ================================================================== *
 * 3. The eight checks, each a pure verdict with a detail.
 * ================================================================== */

/** One verdict, frozen. */
function verdict(check: AdmissionCheck, passed: boolean, detail: string): AdmissionVerdict {
  return Object.freeze({ check, passed, detail });
}

/** The scope of a task where the decision carries one, else `undefined`. */
export function scopeOfTheDecision(decision: ScopeDecision | undefined): WriteScope | undefined {
  return decision !== undefined && decision.kind === "scope" ? decision.scope : undefined;
}

/** Why the decision gives no scope, in the words the plan prints. */
function whyNoScope(decision: ScopeDecision | undefined): string {
  if (decision === undefined) return "no scope was derived for this task";
  if (decision.kind === "absent") {
    return "neither the consumer nor the text of the task names a path: the scope is the whole tree";
  }
  if (decision.kind === "excluded") return `the task is named by ${"loop.parallel.exclude"}`;
  if (decision.kind === "refused")
    return `the prefix ${decision.prefix} breaks the form: ${decision.reason}`;
  return "";
}

/** The check `marker` (F142-FR-007). */
export function checkMarker(task: TaskAsReadAtLaunch): AdmissionVerdict {
  return verdict(
    "marker",
    isCandidate(task),
    isCandidate(task)
      ? `the task list as read at launch carries ${MARKER} on ${task.id}`
      : `the task list as read at launch carries no ${MARKER} on ${task.id}`,
  );
}

/**
 * The check `scope` (F142-FR-011): the scope is present and disjoint from the
 * scope of every task admitted before it **in the group**.
 */
export function checkScope(
  task: TaskAsReadAtLaunch,
  inputs: AdmissionInputs,
  admittedBeforeItInTheGroup: readonly { readonly id: string; readonly scope: WriteScope }[],
): AdmissionVerdict {
  const decision = inputs.scopes?.[task.id];
  const scope = scopeOfTheDecision(decision);
  if (scope === undefined) return verdict("scope", false, whyNoScope(decision));
  if (scope.prefixes.length === 0) {
    return verdict("scope", false, "an empty list of prefixes is the whole tree");
  }
  const clash = admittedBeforeItInTheGroup.find((other) => scopesOverlap(scope, other.scope));
  if (clash !== undefined) {
    return verdict("scope", false, `the scope overlaps the scope of ${clash.id}`);
  }
  return verdict(
    "scope",
    true,
    `the scope (${scope.prefixes.join(", ")}, from ${scope.source}) is disjoint from every scope admitted before it`,
  );
}

/**
 * The check `protected` (F142-FR-011): the scope holds no single-writer file of
 * F142-FR-057.
 */
export function checkProtected(
  task: TaskAsReadAtLaunch,
  inputs: AdmissionInputs,
): AdmissionVerdict {
  const scope = scopeOfTheDecision(inputs.scopes?.[task.id]);
  const single = inputs.singleWriterPaths ?? [];
  if (scope === undefined) return verdict("protected", true, "no scope to check");
  const held = single.filter((path) =>
    scope.prefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`) || prefix.startsWith(`${path}/`),
    ),
  );
  return held.length === 0
    ? verdict("protected", true, "the scope holds no single-writer file")
    : verdict("protected", false, `the scope holds the single-writer file ${held.join(", ")}`);
}

/** The check `resource` (F142-FR-015). */
export function checkResource(inputs: AdmissionInputs): AdmissionVerdict {
  const workers = workersOf(inputs);
  const named = inputs.exclusiveResources ?? [];
  const without = named.filter((resource) => resource.capacity < workers);
  return without.length === 0
    ? verdict(
        "resource",
        true,
        named.length === 0
          ? "the phase names no exclusive resource"
          : `every exclusive resource has a capacity of at least ${workers}`,
      )
    : verdict(
        "resource",
        false,
        `the exclusive resource ${without.map((r) => r.name).join(", ")} has a capacity below ${workers}`,
      );
}

/** The check `headroom` (F142-FR-016; assumption CQ-111 for `cycles`). */
export function checkHeadroom(inputs: AdmissionInputs): AdmissionVerdict {
  const workers = workersOf(inputs);
  const headroom = inputs.headroom;
  if (headroom === undefined) return verdict("headroom", true, "no headroom signal was given");
  const quota = headroom.quota;
  if (quota !== undefined) {
    const over = quota.utilisationPerCent.filter((value) => value >= quota.headroomPerCent);
    if (over.length > 0) {
      return verdict(
        "headroom",
        false,
        `quota: a window is at ${Math.max(...over)} per cent, at or above the headroom of ${quota.headroomPerCent}`,
      );
    }
  }
  if (headroom.hardCap === true) {
    const factor = headroom.spendLimitDeclared === true ? 1 : 2;
    const needed = workers * (headroom.costP90 ?? 0) * factor;
    if ((headroom.budgetRemaining ?? 0) < needed) {
      return verdict(
        "headroom",
        false,
        `budget: ${headroom.budgetRemaining ?? 0} remains, ${needed} is needed`,
      );
    }
  }
  if (headroom.freeSpaceBytes !== undefined && headroom.baseSnapshotBytes !== undefined) {
    const needed = 2 * headroom.baseSnapshotBytes * workers;
    if (headroom.freeSpaceBytes < needed) {
      return verdict(
        "headroom",
        false,
        `disk: ${headroom.freeSpaceBytes} bytes free, ${needed} is needed`,
      );
    }
  }
  if (headroom.remainingCycles !== undefined && headroom.remainingCycles < workers) {
    return verdict(
      "headroom",
      false,
      `cycles: ${headroom.remainingCycles} remain, a group of ${workers} needs ${workers}`,
    );
  }
  return verdict("headroom", true, "quota, budget, disk and cycles all leave headroom");
}

/** The check `check` (F142-FR-012). */
export function checkCheck(inputs: AdmissionInputs): AdmissionVerdict {
  const set = inputs.innerCheckSet ?? [];
  return set.length > 0
    ? verdict("check", true, `the inner check set of the phase holds ${set.length} command(s)`)
    : verdict(
        "check",
        false,
        "the inner check set of the phase is empty after the exclusions in force",
      );
}

/** The check `links` (F142-FR-013). */
export function checkLinks(task: TaskAsReadAtLaunch, inputs: AdmissionInputs): AdmissionVerdict {
  const links = inputs.linksLeavingTheTree ?? [];
  const containment = inputs.containment ?? "C2";
  if (links.length === 0) {
    return verdict("links", true, "the base snapshot holds no link that leaves the tree");
  }
  if (containment === "C0" || containment === "C1") {
    return verdict(
      "links",
      false,
      `a link leaves the tree and containment is ${containment}: the phase has no group`,
    );
  }
  const scope = scopeOfTheDecision(inputs.scopes?.[task.id]);
  if (scope === undefined)
    return verdict("links", false, "a link leaves the tree and the task has no scope");
  const behind = links.filter((link) =>
    scope.prefixes.some(
      (prefix) => link === prefix || link.startsWith(`${prefix}/`) || prefix.startsWith(`${link}/`),
    ),
  );
  return behind.length === 0
    ? verdict("links", true, "no link that leaves the tree lies in or behind the scope")
    : verdict("links", false, `the scope contains or lies behind the link ${behind.join(", ")}`);
}

/** The check `jobs` (F142-FR-014). */
export function checkJobs(inputs: AdmissionInputs): AdmissionVerdict {
  const alive = inputs.adoptableJobsAlive ?? 0;
  return alive === 0
    ? verdict("jobs", true, "no adoptable detached job of the run is alive")
    : verdict("jobs", false, `${alive} adoptable detached job(s) of the run are alive`);
}

/**
 * The verdict of every one of the eight checks on one task, in the order of
 * row 61 (F142-FR-011). Every check runs and is recorded, whatever an earlier
 * one said, so that the plan can print a verdict and a detail per check.
 */
export function checkVerdicts(
  task: TaskAsReadAtLaunch,
  inputs: AdmissionInputs,
  admittedBeforeItInTheGroup: readonly { readonly id: string; readonly scope: WriteScope }[] = [],
): readonly AdmissionVerdict[] {
  const byName: Readonly<Record<AdmissionCheck, AdmissionVerdict>> = {
    marker: checkMarker(task),
    scope: checkScope(task, inputs, admittedBeforeItInTheGroup),
    protected: checkProtected(task, inputs),
    resource: checkResource(inputs),
    headroom: checkHeadroom(inputs),
    check: checkCheck(inputs),
    links: checkLinks(task, inputs),
    jobs: checkJobs(inputs),
  };
  return Object.freeze(ADMISSION_CHECKS.map((check) => byName[check]));
}

/** The first check of row 61 that a task failed, or `undefined` where it is admitted. */
export function firstFailedCheck(
  verdicts: readonly AdmissionVerdict[],
): AdmissionVerdict | undefined {
  for (const check of ADMISSION_CHECKS) {
    const found = verdicts.find((v) => v.check === check);
    if (found !== undefined && !found.passed) return found;
  }
  return undefined;
}

/* ================================================================== *
 * 4. Groups of 2 to `workers` consecutive admitted tasks (T017).
 * ================================================================== */

/** The worker count in force, 2 by default (F142-FR-019). */
export function workersOf(inputs: AdmissionInputs): number {
  const workers = inputs.workers ?? WORKERS_DEFAULT;
  return workers >= 1 ? Math.floor(workers) : 1;
}

/**
 * A task that every one of the eight checks admitted and that no group of at
 * least `GROUP_MIN_TASKS` tasks can hold, because its run of consecutive
 * admitted tasks ended with it alone (F142-FR-008, PU-14). It is serial, like
 * a task that failed a check, and it is never dropped — but the reason is not
 * a member of row 61, so it is kept apart from the admission checks.
 */
export const ALONE = ALONE_IN_ITS_RUN;

/** Why a task is serial: the admission check it failed, or `ALONE`. */
export type SerialReason = AdmissionCheck | typeof ALONE;

/** One task of the serial list, with the reason it is there (F142-FR-011). */
export type SerialPlacement = {
  readonly id: string;
  readonly reason: SerialReason;
  readonly detail: string;
};

/** The groups a run of consecutive admitted tasks gives, and what is left over. */
export type GroupsOfARun = {
  readonly groups: readonly PlannedGroup[];
  /** The tasks of the run that no group holds: at most `GROUP_MIN_TASKS - 1` of them. */
  readonly ungrouped: readonly string[];
};

/**
 * Form the groups of one run of consecutive admitted tasks (T017,
 * F142-FR-008). The run is cut into successive groups of at most `workers`
 * tasks, in the order of the tasks at launch; a group holds at least
 * `GROUP_MIN_TASKS`, so a trailing cut of one task is no group (PU-14) and its
 * task is left over. A longer run therefore gives successive groups, each of
 * which will have its own base snapshot, barrier and merge check (PU-86).
 */
export function groupsOfConsecutiveAdmittedTasks(input: {
  readonly run: readonly string[];
  readonly workers: number;
  readonly phase: number;
  readonly firstOrdinal: number;
}): GroupsOfARun {
  const workers = Math.max(1, Math.floor(input.workers));
  const groups: PlannedGroup[] = [];
  const ungrouped: string[] = [];
  let ordinal = input.firstOrdinal;
  for (let at = 0; at < input.run.length; at += workers) {
    const cut = input.run.slice(at, at + workers);
    if (cut.length >= GROUP_MIN_TASKS) {
      groups.push(Object.freeze({ ordinal, phase: input.phase, tasks: Object.freeze([...cut]) }));
      ordinal += 1;
      continue;
    }
    ungrouped.push(...cut);
  }
  return Object.freeze({ groups: Object.freeze(groups), ungrouped: Object.freeze(ungrouped) });
}

/**
 * The tasks of the cut that is still open while a run is walked: the `scope`
 * check compares a task with the tasks admitted before it **in its group**,
 * and the cut is where the group boundary will fall (F142-FR-011).
 */
export function openCutOf<T>(run: readonly T[], workers: number): readonly T[] {
  const size = Math.max(1, Math.floor(workers));
  return run.slice(Math.floor(run.length / size) * size);
}

/* ================================================================== *
 * 5. Admission, greedy in the order of the tasks (T020).
 * ================================================================== */

/** The result of admission for the tasks of one phase (F142-FR-011). */
export type AdmissionResult = {
  readonly phase: number;
  /** Every task of the phase, with the verdict of every check (F142-FR-011). */
  readonly tasks: readonly CandidateTask[];
  readonly groups: readonly PlannedGroup[];
  readonly serial: readonly SerialPlacement[];
};

/** The ids of the tasks a result places in a group. */
export function groupedTaskIds(result: AdmissionResult): readonly string[] {
  return Object.freeze(result.groups.flatMap((group) => [...group.tasks]));
}

/**
 * The ids that are not placed in exactly one of a group or the serial list
 * (F142-FR-011). An empty list is the only acceptable value.
 */
export function notPlacedExactlyOnce(result: AdmissionResult): readonly string[] {
  const counted = new Map<string, number>();
  for (const id of [...groupedTaskIds(result), ...result.serial.map((s) => s.id)]) {
    counted.set(id, (counted.get(id) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const task of result.tasks) {
    if (counted.get(task.id) !== 1) out.push(task.id);
  }
  for (const [id, n] of counted) {
    if (n !== 1 && !out.includes(id)) out.push(id);
  }
  return Object.freeze(out);
}

/**
 * Run the eight checks greedily in the order of the tasks and record every
 * verdict (T020, F142-FR-011), then form the groups of every run of
 * consecutive admitted tasks (T017, F142-FR-008).
 *
 * The walk is greedy with the worker cap: a task that every check admits joins
 * the run that is open; a task that fails a check ends that run at its
 * position (PU-102) and goes to the serial list with the failed check as its
 * reason; a heading, a new phase, or a gap in the order of the tasks also ends
 * the run. Nothing is dropped: every task of the phase appears in exactly one
 * of a group or the serial list.
 *
 * The function is pure. It reads only `tasks` and `inputs`, mutates neither,
 * and the same inputs give the same result.
 */
export function admit(
  tasks: readonly TaskAsReadAtLaunch[],
  inputs: AdmissionInputs = {},
): AdmissionResult {
  const workers = workersOf(inputs);
  const phase = tasks[0]?.phase ?? 0;
  const recorded: CandidateTask[] = [];
  const groups: PlannedGroup[] = [];
  const serial: SerialPlacement[] = [];
  let run: { readonly id: string; readonly scope: WriteScope; readonly phase: number }[] = [];
  let ordinal = 1;

  const closeTheRun = (): void => {
    const formed = groupsOfConsecutiveAdmittedTasks({
      run: run.map((entry) => entry.id),
      workers,
      phase: run[0]?.phase ?? phase,
      firstOrdinal: ordinal,
    });
    groups.push(...formed.groups);
    ordinal += formed.groups.length;
    for (const id of formed.ungrouped) {
      serial.push(
        Object.freeze({
          id,
          reason: ALONE,
          detail: `every check admitted ${id}, and its run of consecutive admitted tasks holds fewer than ${GROUP_MIN_TASKS} tasks at that point`,
        }),
      );
    }
    run = [];
  };

  for (const task of tasks) {
    if (task.headingBefore === true || (run[0] !== undefined && run[0].phase !== task.phase)) {
      closeTheRun();
    }
    const verdicts = checkVerdicts(task, inputs, openCutOf(run, workers));
    const scope = scopeOfTheDecision(inputs.scopes?.[task.id]);
    recorded.push(
      Object.freeze({
        id: task.id,
        scope:
          scope ?? Object.freeze({ prefixes: Object.freeze([]), source: "task-text" as const }),
        checks: verdicts,
      }),
    );
    const failed = firstFailedCheck(verdicts);
    if (failed !== undefined) {
      closeTheRun();
      serial.push(Object.freeze({ id: task.id, reason: failed.check, detail: failed.detail }));
      continue;
    }
    // Admitted. `scope` cannot be undefined here: the check `scope` passed.
    run.push({ id: task.id, scope: scope as WriteScope, phase: task.phase });
  }
  closeTheRun();

  return Object.freeze({
    phase,
    tasks: Object.freeze(recorded),
    groups: Object.freeze(groups),
    serial: Object.freeze(serial),
  });
}

/**
 * Admission over the tasks of several phases: each phase is admitted on its
 * own, so that no group ever crosses a phase (F142-FR-008, PU-10).
 */
export function admitEveryPhase(
  tasks: readonly TaskAsReadAtLaunch[],
  inputs: AdmissionInputs = {},
): readonly AdmissionResult[] {
  const phases: number[] = [];
  for (const task of tasks) {
    if (!phases.includes(task.phase)) phases.push(task.phase);
  }
  return Object.freeze(
    phases.map((phase) =>
      admit(
        tasks.filter((task) => task.phase === phase),
        inputs,
      ),
    ),
  );
}

/* ================================================================== *
 * 6. The five checks of user story 2, at the level of the group
 *    (T046 to T050; F142-FR-012 to F142-FR-016; rules PU-30, PU-37,
 *    PU-39, PU-79, PU-84, PU-87, PU-88, PU-92).
 *
 * The checks themselves are in section 3 and run per task: that is how
 * row 61 records a verdict and a detail for every task. Four of the five
 * are facts of the **phase attempt** and not of the task, so each also
 * decides whether a group may be admitted or started at all. The
 * functions here are those group-level decisions, stated once so that the
 * engine, the plan and the doctor read the same rule.
 * ================================================================== */

/** Whether a group may be admitted or started, and why not where it may not. */
export type GroupGate = {
  readonly admitted: boolean;
  /** The check of row 61 the group failed, or `undefined` where it passed. */
  readonly reason?: AdmissionCheck;
  readonly detail: string;
};

/** A gate that admits, with its words. */
function admits(detail: string): GroupGate {
  return Object.freeze({ admitted: true, detail });
}

/** A gate that refuses, with the check of row 61 as the reason. */
function refuses(reason: AdmissionCheck, detail: string): GroupGate {
  return Object.freeze({ admitted: false, reason, detail });
}

/**
 * T046 — admit a group only with a non-empty inner check set (F142-FR-012,
 * PU-79).
 *
 * The inner check set is read **after every exclusion in force**: a phase whose
 * manifest holds commands but all of which are excluded has an empty set and
 * no group. Where the set is empty the tasks are serial with the reason
 * `check` — the name of the failed check, and never `no-check`, which belongs
 * to the layer `micro` (row 59) and is a member of no set of this feature
 * (clarification of `spec.md`).
 */
export function admitAGroupOnlyWithANonEmptyInnerCheckSet(inputs: AdmissionInputs): GroupGate {
  const verdict = checkCheck(inputs);
  return verdict.passed ? admits(verdict.detail) : refuses("check", verdict.detail);
}

/** The reason a task serial for an empty inner check set carries (F142-FR-012). */
export const REASON_OF_AN_EMPTY_INNER_CHECK_SET: AdmissionCheck = "check";

/** The reason of the layer `micro` that is a member of no set of this feature. */
export const NOT_A_REASON_OF_THIS_FEATURE = "no-check" as const;

/**
 * T047 — the tasks that a link which leaves the tree makes serial
 * (F142-FR-013, PU-84).
 *
 * A link of the base snapshot that is absolute or resolves outside the tree
 * makes **every task whose scope contains the link or lies behind it** serial.
 * "Behind it" is the case where the link is a prefix of the scope: a scope of
 * `src/vendor/x` lies behind the link `src/vendor`. At containment C0 and C1
 * such a phase has **no group** at all, whatever the scopes say, because the
 * sandbox is not there to deny writes to the targets.
 */
export function tasksSerialBehindALinkThatLeavesTheTree(
  tasks: readonly TaskAsReadAtLaunch[],
  inputs: AdmissionInputs,
): readonly string[] {
  return Object.freeze(
    tasks.filter((task) => !checkLinks(task, inputs).passed).map((task) => task.id),
  );
}

/**
 * T047 — whether the phase may hold a group at all, given its links
 * (F142-FR-013, PU-84). At C0 and C1 one link that leaves the tree is enough
 * for the phase to have no group.
 */
export function aPhaseWithALinkThatLeavesTheTreeMayHoldAGroup(inputs: AdmissionInputs): GroupGate {
  const links = inputs.linksLeavingTheTree ?? [];
  const containment = inputs.containment ?? "C2";
  if (links.length === 0) return admits("the base snapshot holds no link that leaves the tree");
  if (containment === "C0" || containment === "C1") {
    return refuses(
      "links",
      `the base snapshot holds ${links.length} link(s) that leave the tree and containment is ${containment}: the phase has no group (F142-FR-013)`,
    );
  }
  return admits(
    `containment is ${containment}: the sandbox denies writes to the targets, and only the tasks in or behind a link are serial`,
  );
}

/**
 * T048 — no group starts while an adoptable detached job lives (F142-FR-014,
 * PU-92).
 *
 * The reading is of the **process registry** at the moment the group would
 * start, and the engine takes it: a job of the run whose class is `adoptable`
 * and that is alive stops every group of the phase attempt, not only the tasks
 * whose scope it touches, because an adoptable job may be adopted into any
 * pass and would then write outside every worker tree.
 */
export function noGroupStartsWhileAnAdoptableJobLives(inputs: AdmissionInputs): GroupGate {
  const verdict = checkJobs(inputs);
  return verdict.passed ? admits(verdict.detail) : refuses("jobs", verdict.detail);
}

/** The class of a detached job that stops a group (F142-FR-014). */
export const JOB_CLASS_THAT_STOPS_A_GROUP = "adoptable" as const;

/**
 * T049 — no group in a phase that names an exclusive resource without capacity
 * (F142-FR-015, PU-37).
 *
 * A resource is named by a command of the check manifest, by a declared
 * detached job or by the launch contract. The phase has no group unless **user
 * configuration** gives that resource a capacity of at least the worker count.
 */
export function noGroupInAPhaseNamingAnExclusiveResourceWithoutCapacity(
  inputs: AdmissionInputs,
): GroupGate {
  const verdict = checkResource(inputs);
  return verdict.passed ? admits(verdict.detail) : refuses("resource", verdict.detail);
}

/** The three places a phase may name an exclusive resource (F142-FR-015). */
export const PLACES_THAT_NAME_AN_EXCLUSIVE_RESOURCE = Object.freeze([
  "a command of the check manifest",
  "a declared detached job",
  "the launch contract",
] as const);

/** The key that gives a resource its capacity (row 96 of annex X §X.7). */
export function capacityKeyOf(resource: string): string {
  return `loop.parallel.resources.${resource}.capacity`;
}

/**
 * T049 — the lines the doctor prints for the resources it cannot check
 * (F142-FR-015, PU-37). A resource whose capacity no configuration states — a
 * port, a lab bench — is named rather than assumed free.
 */
export function doctorLinesForResourcesItCannotCheck(inputs: AdmissionInputs): readonly string[] {
  const workers = workersOf(inputs);
  return Object.freeze(
    (inputs.exclusiveResources ?? [])
      .filter((resource) => resource.capacity < workers)
      .map(
        (resource) =>
          `warning: the exclusive resource \`${resource.name}\` cannot be checked; set ${capacityKeyOf(resource.name)} to ${workers} or more in user configuration to let a group run (F142-FR-015)`,
      ),
  );
}

/**
 * T050 — the four conditions of the check `headroom` (F142-FR-016; PU-30,
 * PU-39, PU-87, PU-88): quota utilisation, budget, disk and cycles. Each is
 * stated on its own, so that the plan and the doctor can print which of the
 * four refused a group, and `checkHeadroom` is the conjunction of them.
 */
export const HEADROOM_CONDITIONS = Object.freeze(["quota", "budget", "disk", "cycles"] as const);
export type HeadroomCondition = (typeof HEADROOM_CONDITIONS)[number];

/** `loop.parallel.quota_headroom`, in per cent (row 22 of annex X §X.7). */
export const QUOTA_HEADROOM_KEY = "loop.parallel.quota_headroom" as const;
export const QUOTA_HEADROOM_DEFAULT_PER_CENT = 70 as const;

/** With no quota observation in the run a group has 2 workers (F142-FR-016, PU-88). */
export const WORKERS_WITH_NO_QUOTA_OBSERVATION = 2 as const;

/** One of the four conditions, with its verdict and the words it prints. */
export type HeadroomVerdict = {
  readonly condition: HeadroomCondition;
  readonly passed: boolean;
  readonly detail: string;
};

/**
 * T050 — the verdict of each of quota utilisation, budget, disk and cycles
 * (F142-FR-016).
 *
 *  - **quota** (a): the last observed utilisation of every quota window of the
 *    proposer's account is below `loop.parallel.quota_headroom`, 70 per cent by
 *    default. With no window observed the condition holds (PU-39);
 *  - **budget** (b): under a hard cap, the remaining budget of the role is at
 *    least the worker count times the cost of a pass at the 90th percentile of
 *    the passes so far, and **twice** that where the harness adapter declares
 *    no process-level spending limit (PU-88). With no hard cap the condition
 *    holds;
 *  - **disk** (c): the free space of the file system of the worker root is at
 *    least twice the size of the base snapshot plus the seed paths, times the
 *    worker count (PU-30);
 *  - **cycles** (d): the remaining cycles of the micro-loop layer are at least
 *    the number of tasks of the group (PU-87, assumption CQ-111).
 */
export function headroomVerdicts(
  inputs: AdmissionInputs,
  tasksOfTheGroup: number = workersOf(inputs),
): readonly HeadroomVerdict[] {
  const workers = workersOf(inputs);
  const headroom = inputs.headroom ?? {};
  const out: HeadroomVerdict[] = [];

  const quota = headroom.quota;
  if (quota === undefined || quota.utilisationPerCent.length === 0) {
    out.push(
      Object.freeze({
        condition: "quota" as const,
        passed: true,
        detail: "no quota window was observed in the run",
      }),
    );
  } else {
    const worst = Math.max(...quota.utilisationPerCent);
    out.push(
      Object.freeze({
        condition: "quota" as const,
        passed: worst < quota.headroomPerCent,
        detail: `quota: the worst window is at ${worst} per cent and ${QUOTA_HEADROOM_KEY} is ${quota.headroomPerCent}`,
      }),
    );
  }

  if (headroom.hardCap !== true) {
    out.push(
      Object.freeze({
        condition: "budget" as const,
        passed: true,
        detail: "no hard cap on spending is in force",
      }),
    );
  } else {
    const factor = headroom.spendLimitDeclared === true ? 1 : 2;
    const needed = workers * (headroom.costP90 ?? 0) * factor;
    const remaining = headroom.budgetRemaining ?? 0;
    out.push(
      Object.freeze({
        condition: "budget" as const,
        passed: remaining >= needed,
        detail: `budget: ${remaining} remains and ${needed} is needed (${workers} workers × ${headroom.costP90 ?? 0} at the 90th percentile × ${factor}, the adapter ${headroom.spendLimitDeclared === true ? "declares" : "declares no"} process-level spending limit)`,
      }),
    );
  }

  if (headroom.freeSpaceBytes === undefined || headroom.baseSnapshotBytes === undefined) {
    out.push(
      Object.freeze({
        condition: "disk" as const,
        passed: true,
        detail: "no reading of the free space of the worker root was given",
      }),
    );
  } else {
    const needed = 2 * headroom.baseSnapshotBytes * workers;
    out.push(
      Object.freeze({
        condition: "disk" as const,
        passed: headroom.freeSpaceBytes >= needed,
        detail: `disk: ${headroom.freeSpaceBytes} bytes are free on the worker root and ${needed} are needed (2 × ${headroom.baseSnapshotBytes} × ${workers})`,
      }),
    );
  }

  if (headroom.remainingCycles === undefined) {
    out.push(
      Object.freeze({
        condition: "cycles" as const,
        passed: true,
        detail: "no reading of the remaining cycles was given",
      }),
    );
  } else {
    out.push(
      Object.freeze({
        condition: "cycles" as const,
        passed: headroom.remainingCycles >= tasksOfTheGroup,
        detail: `cycles: ${headroom.remainingCycles} remain and the group of ${tasksOfTheGroup} task(s) needs ${tasksOfTheGroup}`,
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * T050 — the gate of the check `headroom`: a group is admitted only when all
 * four conditions hold (F142-FR-016). The detail names the first condition
 * that refused, so that the `[LOOP]` line and the plan say which of quota,
 * budget, disk and cycles it was.
 */
export function checkQuotaBudgetDiskAndCycles(
  inputs: AdmissionInputs,
  tasksOfTheGroup: number = workersOf(inputs),
): GroupGate {
  const verdicts = headroomVerdicts(inputs, tasksOfTheGroup);
  const failed = verdicts.find((verdict) => !verdict.passed);
  return failed === undefined
    ? admits("quota, budget, disk and cycles all leave headroom")
    : refuses("headroom", failed.detail);
}

/**
 * T050 — the worker count a group has where the run observed no quota at all:
 * 2, whatever configuration says (F142-FR-016, PU-88). A configured 4 becomes
 * 2; a configured 1 stays 1, because at one worker no group starts and raising
 * it would start one.
 */
export function workersWithNoQuotaObservation(
  configuredWorkers: number,
  quota: QuotaObservation | undefined,
): number {
  const observed = quota !== undefined && quota.utilisationPerCent.length > 0;
  if (observed) return configuredWorkers;
  return Math.min(configuredWorkers, WORKERS_WITH_NO_QUOTA_OBSERVATION);
}

/**
 * The gates of the phase attempt, in the order of row 61: a group is admitted
 * only where every one of them admits (F142-FR-012 to F142-FR-016). The first
 * that refuses gives the reason the plan prints and the `[LOOP]` line carries.
 */
export function groupGate(
  inputs: AdmissionInputs,
  tasksOfTheGroup: number = workersOf(inputs),
): GroupGate {
  const gates = [
    noGroupInAPhaseNamingAnExclusiveResourceWithoutCapacity(inputs),
    checkQuotaBudgetDiskAndCycles(inputs, tasksOfTheGroup),
    admitAGroupOnlyWithANonEmptyInnerCheckSet(inputs),
    aPhaseWithALinkThatLeavesTheTreeMayHoldAGroup(inputs),
    noGroupStartsWhileAnAdoptableJobLives(inputs),
  ];
  const refused = gates.find((gate) => !gate.admitted);
  return (
    refused ??
    admits(
      "every check of the phase attempt admits a group: resource, headroom, check, links, jobs",
    )
  );
}
