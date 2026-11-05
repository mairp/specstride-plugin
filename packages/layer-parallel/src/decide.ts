/**
 * T021 and T025 — the decisions of the layer `parallel` at the call points of
 * EP-04 that start and integrate a group (feature 142).
 *
 * T021 (F142-FR-018; rules PU-16, PU-17, PU-40): a group starts only at a
 * **clean pass boundary** of the main line — no session open, no yield wait
 * open, no phase evidence present in the phase attempt — and only when every
 * task of the phase that precedes the group is named by a kept unit of work in
 * the ledger. Until then the prompt of the main line holds the reserved-tasks
 * block, which asks the proposer to end its pass before the reserved tasks. The
 * reservation is a **request**: a task that a serial pass names in a
 * checkpoint, or that is ticked in the task list as read at the boundary,
 * leaves its group, and a group left with fewer than 2 tasks is cancelled.
 *
 * T025 (F142-FR-074): the layer obtains every worker tree and every write to
 * the workspace **only** through the group directives of annex D §D.1 and the
 * tree-store service of §D.2, and through nothing else. That is enforced here
 * in three ways:
 *
 *  1. this module touches no file and starts no process — it cannot, the
 *     package is `core` in the package graph and `node:fs` and
 *     `node:child_process` are forbidden to it;
 *  2. a worker tree reaches the layer only as a `WorkerTree` value that the
 *     engine got from `materialize` of the tree-store service; `groupRequest`
 *     refuses to request a group whose working directory is not one of those
 *     values (`workingDirectoriesNotFromTheStore`), so the layer can name no
 *     directory of its own;
 *  3. the only way the composed work reaches the workspace is the directive
 *     `integrateGroup`, which the engine executes with `compose` and `apply`;
 *     the layer returns the verdicts of the audits and nothing else.
 *
 * Every function here is pure: a directive is a value, and the engine executes
 * it (F142-FR-006).
 */
import type { ChangeKind, TreeId, WorkerTree } from "@specstride/contracts/ep/tree-store";
import type {
  DirectiveCall,
  PassGroupRequest,
  PassRequest,
  PromptBlock,
} from "@specstride/contracts/ep/loop-layer";

import {
  FAILED_GROUPS_BEFORE_THE_LAYER_IS_OFF,
  GROUP_MIN_TASKS,
  integrateGroupRequestOf,
  layerOffScopeOf,
} from "./types.ts";
import type {
  AdmissionVerdict,
  FallbackReason,
  LayerOffForAttemptReason,
  LayerOffReason,
  PlannedGroup,
  WorkerVerdict,
  WriteScope,
} from "./types.ts";

/* ================================================================== *
 * 1. The clean pass boundary (T021, F142-FR-018, PU-16).
 * ================================================================== */

/**
 * The conditions of a clean pass boundary, in the words of F142-FR-018. A
 * group starts only where all of them hold.
 */
export const CLEAN_PASS_BOUNDARY_CONDITIONS = Object.freeze([
  "no session open",
  "no yield wait open",
  "no phase evidence present in the phase attempt",
  "every task of the phase that precedes the group is named by a kept unit of work in the ledger",
] as const);
export type CleanPassBoundaryCondition = (typeof CLEAN_PASS_BOUNDARY_CONDITIONS)[number];

/**
 * What the engine reports about the boundary the main line has reached. The
 * layer reads it from the view of the phase attempt and computes nothing of it
 * itself (F142-FR-005).
 */
export type PassBoundary = {
  readonly sessionOpen: boolean;
  readonly yieldWaitOpen: boolean;
  readonly phaseEvidencePresent: boolean;
  /** The tasks of the phase that precede the group, in the order at launch. */
  readonly tasksBeforeTheGroup: readonly string[];
  /** The tasks that a kept unit of work in the ledger names. */
  readonly tasksNamedByKeptUnits: readonly string[];
};

/** Whether the boundary is clean, and the first condition it breaks. */
export type BoundaryVerdict =
  | { readonly clean: true }
  | {
      readonly clean: false;
      readonly condition: CleanPassBoundaryCondition;
      readonly detail: string;
    };

/**
 * The verdict on the boundary (F142-FR-018, PU-16). The conditions are tested
 * in the order of `CLEAN_PASS_BOUNDARY_CONDITIONS`, so the reason a group did
 * not start is always the first one that failed.
 */
export function cleanPassBoundary(boundary: PassBoundary): BoundaryVerdict {
  if (boundary.sessionOpen) {
    return Object.freeze({
      clean: false,
      condition: CLEAN_PASS_BOUNDARY_CONDITIONS[0],
      detail: "a session of the main line is open",
    });
  }
  if (boundary.yieldWaitOpen) {
    return Object.freeze({
      clean: false,
      condition: CLEAN_PASS_BOUNDARY_CONDITIONS[1],
      detail: "a yield wait is open",
    });
  }
  if (boundary.phaseEvidencePresent) {
    return Object.freeze({
      clean: false,
      condition: CLEAN_PASS_BOUNDARY_CONDITIONS[2],
      detail: "phase evidence is present in the phase attempt",
    });
  }
  const kept = new Set(boundary.tasksNamedByKeptUnits);
  const missing = boundary.tasksBeforeTheGroup.filter((id) => !kept.has(id));
  if (missing.length > 0) {
    return Object.freeze({
      clean: false,
      condition: CLEAN_PASS_BOUNDARY_CONDITIONS[3],
      detail: `no kept unit of work names ${missing.join(", ")}`,
    });
  }
  return Object.freeze({ clean: true });
}

/* ================================================================== *
 * 2. The reservation is a request (T021, F142-FR-018, PU-17).
 * ================================================================== */

/** The id of the reserved-tasks block of the main line (EP-15, §D.5). */
export const RESERVED_TASKS_BLOCK_ID = "parallel.reserved-tasks" as const;

/**
 * The text of the reserved-tasks block: it says up to which task to work and
 * never why (F142-FR-069). It names no worker, no count and no group.
 */
export function reservedTasksBlockText(reserved: readonly string[]): string {
  const first = reserved[0];
  if (first === undefined) return "";
  return `Work up to ${first} and end your pass there. Do not work ${reserved.join(", ")}.`;
}

/** What happened to a group when the main line worked a reserved task anyway. */
export type ReservationOutcome =
  | { readonly kind: "unchanged"; readonly group: PlannedGroup }
  | { readonly kind: "shrunk"; readonly group: PlannedGroup; readonly left: readonly string[] }
  | { readonly kind: "cancelled"; readonly left: readonly string[]; readonly detail: string };

/** What the boundary says about the reserved tasks of a group (F142-FR-018). */
export type ReservationReading = {
  /** Tasks that a serial pass named in a checkpoint. */
  readonly namedInACheckpoint?: readonly string[];
  /** Tasks that the task list as read at the boundary ticks. */
  readonly tickedInTheTaskList?: readonly string[];
};

/**
 * Shrink or cancel a group when a reserved task was worked serially
 * (F142-FR-018, PU-17). A task that a serial pass named in a checkpoint, or
 * that the task list as read at the boundary ticks, **leaves** its group; a
 * group left with fewer than `GROUP_MIN_TASKS` tasks is cancelled. A reading
 * only ever removes a task from a group: it never adds one and never reorders
 * the rest.
 */
export function shrinkOrCancelAGroup(
  group: PlannedGroup,
  reading: ReservationReading,
): ReservationOutcome {
  const worked = new Set([
    ...(reading.namedInACheckpoint ?? []),
    ...(reading.tickedInTheTaskList ?? []),
  ]);
  const left = Object.freeze(group.tasks.filter((id) => worked.has(id)));
  const kept = Object.freeze(group.tasks.filter((id) => !worked.has(id)));
  if (left.length === 0) return Object.freeze({ kind: "unchanged", group });
  if (kept.length < GROUP_MIN_TASKS) {
    return Object.freeze({
      kind: "cancelled",
      left,
      detail: `${kept.length} task(s) are left, fewer than ${GROUP_MIN_TASKS}`,
    });
  }
  return Object.freeze({
    kind: "shrunk",
    group: Object.freeze({ ordinal: group.ordinal, phase: group.phase, tasks: kept }),
    left,
  });
}

/* ================================================================== *
 * 3. Worker trees and writes come only from the contracts (T025,
 *    F142-FR-074).
 * ================================================================== */

/** Where a worker tree may come from, and from nowhere else (F142-FR-074). */
export const WORKER_TREES_COME_ONLY_FROM = Object.freeze([
  "the group directives of the loop-layer interface (annex D §D.1)",
  "the tree-store service (annex D §D.2)",
] as const);

/** The layer itself never creates, moves or removes a worker tree. */
export const THE_LAYER_CREATES_NO_WORKER_TREE = true as const;

/** The only directive through which work reaches the workspace (F142-FR-074). */
export const THE_ONLY_WRITE_TO_THE_WORKSPACE = "integrateGroup" as const;

/** The operation of the tree store that may write a path of the workspace. */
export const THE_ONLY_OPERATION_THAT_WRITES_THE_WORKSPACE = "apply" as const;

/**
 * What the engine reports about the git state of the workspace, read through
 * the tree-store service and never by the layer (F142-FR-002, F142-FR-074).
 */
export type WorkspaceState = {
  readonly insideAGitWorkTree: boolean;
  readonly submodules?: boolean;
  readonly gitVersionTakesASnapshot?: boolean;
};

/**
 * The fallback reason the state of the workspace gives, or `null` where it
 * gives none (F142-FR-002). On a workspace that is not inside a git work tree
 * the reason is `not-git` and **no group is requested** — the first of the
 * properties F142-FR-074 makes observable from outside.
 */
export function fallbackOfTheWorkspace(state: WorkspaceState): FallbackReason | null {
  if (!state.insideAGitWorkTree) return "not-git";
  if (state.submodules === true) return "submodules";
  if (state.gitVersionTakesASnapshot === false) return "git-version";
  return null;
}

/** One task of a group, with the scope its worker is told and nothing else. */
export type GroupMember = {
  readonly taskId: string;
  readonly workerId: string;
  readonly scope: WriteScope;
};

/**
 * What the engine hands the layer to request a group: the group of the plan,
 * its members, the base snapshot the tree store took, and the worker trees the
 * tree store **materialized** from it. The layer adds nothing of its own.
 */
export type GroupRequestInput = {
  readonly group: PlannedGroup;
  readonly members: readonly GroupMember[];
  readonly boundary: PassBoundary;
  readonly reading?: ReservationReading;
  readonly workspace: WorkspaceState;
  /** The tree id of the base snapshot of the group (§D.2, `snapshot`). */
  readonly baseTreeId: TreeId;
  /** The worker trees, exactly as `materialize` of the tree store returned them. */
  readonly workerTrees: readonly WorkerTree[];
  /**
   * The cap of a proposal of the micro-loop layer in force, where the engine
   * reports one other than the starting value. The layer **requests** this
   * limit for every worker pass; it owns no key for it (F142-FR-024).
   */
  readonly timeLimitMs?: number;
  /**
   * The caps of the micro-loop layer in force, where the engine reports them:
   * the cap of a proposal for a worker pass and the cap of a unit of work for
   * the group (F142-FR-024). Where neither is given the starting values of
   * `STARTING_CAPS` hold.
   */
  readonly caps?: Partial<MicroLoopCaps>;
  /** The fallback reason already in force, where the preconditions found one. */
  readonly fallback?: FallbackReason | null;
};

/** The decision at `betweenPasses` on whether a group starts (F142-FR-018). */
export type GroupRequestDecision =
  | {
      readonly requested: true;
      readonly directive: DirectiveCall;
      readonly request: PassGroupRequest;
      /** The time limits requested for every pass of the group (F142-FR-024). */
      readonly timeLimits: WorkerPassTimeLimits;
      /** The cap the group holds, from group start to the end of the merge check. */
      readonly unitCap: GroupUnitCap;
    }
  | {
      readonly requested: false;
      readonly fallback?: FallbackReason;
      readonly boundary?: CleanPassBoundaryCondition;
      readonly cancelled?: boolean;
      readonly detail: string;
    };

/**
 * The working directories of a list of passes that no worker tree of the tree
 * store accounts for (F142-FR-074). An empty list is the only acceptable
 * value: a directory the layer named itself would appear here, and
 * `groupRequest` refuses such a group.
 */
export function workingDirectoriesNotFromTheStore(
  passes: readonly PassRequest[],
  workerTrees: readonly WorkerTree[],
): readonly string[] {
  const fromTheStore = new Set(workerTrees.map((tree) => tree.path));
  return Object.freeze(
    passes.map((pass) => pass.workingDirectory).filter((path) => !fromTheStore.has(path)),
  );
}

/** The prompt block of one worker: its task and its scope, and no sibling (F142-FR-069). */
export function workerPromptBlock(member: GroupMember): PromptBlock {
  const text = `Work ${member.taskId}. Write only inside ${member.scope.prefixes.join(", ")}.`;
  return Object.freeze({
    id: `parallel.worker.${member.workerId}`,
    bytes: text.length,
    hash: "",
    writer: "parallel",
    protected: false,
    stability: "stable" as const,
    text,
  });
}

/**
 * Decide whether to request a group, and build the directive `requestPassGroup`
 * where one starts (T021, T025; F142-FR-018, F142-FR-074).
 *
 * The order of the decision is the order of the requirements:
 *
 *  1. a fallback reason in force, or a workspace that is not inside a git work
 *     tree, means **no group is requested** at all (F142-FR-002, F142-FR-074);
 *  2. the boundary must be clean (F142-FR-018);
 *  3. the reservation is a request: tasks worked serially leave the group, and
 *     a group left with fewer than 2 tasks is cancelled (PU-17);
 *  4. every pass of the group works in a worker tree the tree store
 *     materialized, and in nothing else (F142-FR-074).
 */
export function groupRequest(input: GroupRequestInput): GroupRequestDecision {
  const fallback = input.fallback ?? fallbackOfTheWorkspace(input.workspace);
  if (fallback !== null) {
    return Object.freeze({
      requested: false,
      fallback,
      detail: `no group is requested: the layer is off for the run with the reason ${fallback}`,
    });
  }
  const verdict = cleanPassBoundary(input.boundary);
  if (!verdict.clean) {
    return Object.freeze({
      requested: false,
      boundary: verdict.condition,
      detail: `no group starts: ${verdict.detail}`,
    });
  }
  const outcome = shrinkOrCancelAGroup(input.group, input.reading ?? {});
  if (outcome.kind === "cancelled") {
    return Object.freeze({
      requested: false,
      cancelled: true,
      detail: `the group is cancelled: ${outcome.detail}`,
    });
  }
  const group = outcome.group;
  // T098 — the limits the layer requests for every pass of the group, and the
  // cap the group itself holds (F142-FR-024). Both come from the micro-loop
  // layer: this layer asks for them and adds no key of its own.
  const capsInForce: Partial<MicroLoopCaps> = {
    ...(input.caps ?? {}),
    ...(input.timeLimitMs === undefined ? {} : { proposalCapMs: input.timeLimitMs }),
  };
  const timeLimits = timeLimitsOfAWorkerPass(capsInForce);
  const unitCap = unitCapOfAGroup(capsInForce);
  const members = input.members.filter((member) => group.tasks.includes(member.taskId));
  const passes: PassRequest[] = [];
  for (const member of members) {
    const tree = input.workerTrees.find((candidate) => candidate.workerId === member.workerId);
    if (tree === undefined) {
      return Object.freeze({
        requested: false,
        detail: `no worker tree of the tree store was given for ${member.workerId}: no group is requested (F142-FR-074)`,
      });
    }
    if (tree.treeId !== input.baseTreeId) {
      return Object.freeze({
        requested: false,
        detail: `the worker tree of ${member.workerId} was not materialized from the base snapshot of the group (F142-FR-074)`,
      });
    }
    passes.push(
      Object.freeze({
        promptBlock: workerPromptBlock(member),
        workingDirectory: tree.path,
        session: "fresh" as const,
        timeLimitMs: timeLimits.timeLimitMs,
        workerId: member.workerId,
      }),
    );
  }
  const foreign = workingDirectoriesNotFromTheStore(passes, input.workerTrees);
  if (foreign.length > 0) {
    return Object.freeze({
      requested: false,
      detail: `the working directory ${foreign.join(", ")} is no worker tree of the tree store (F142-FR-074)`,
    });
  }
  const request: PassGroupRequest = Object.freeze({
    passes: Object.freeze(passes),
    concurrency: passes.length,
  });
  return Object.freeze({
    requested: true,
    request,
    directive: Object.freeze({ directive: "requestPassGroup" as const, request }),
    timeLimits,
    unitCap,
  });
}

/**
 * The directive `integrateGroup` (F142-FR-074): the verdicts of the audits, and
 * nothing else, leave the layer. The engine composes the accepted deltas and
 * applies the composed tree to the workspace with `apply`; the layer writes no
 * path itself and names none.
 */
export function integrateGroupDirective(verdicts: readonly WorkerVerdict[]): DirectiveCall {
  return Object.freeze({
    directive: "integrateGroup" as const,
    request: integrateGroupRequestOf(verdicts),
  });
}

/**
 * The paths of a delta, as the tree-store operation `changed` gives them. The
 * layer reads a delta only in this shape: it never lists a directory itself.
 */
export type ChangedPathOfADelta = { readonly path: string; readonly kind: ChangeKind };

/* ================================================================== *
 * 4. T044 — every failure inside a group ends in one of three ends
 *    (F142-FR-004, F142-FR-023; rule PU-03).
 * ================================================================== */

/**
 * The layer adds **no** exit code, **no** stop reason and **no** run state
 * (F142-FR-004). The three lists are empty, and they are read by CT-142-104,
 * which compares the sets over the parallel fixtures with the sets over the
 * same fixtures with the option off.
 */
export const EXIT_CODES_THE_LAYER_ADDS = Object.freeze([] as const);
export const STOP_REASONS_THE_LAYER_ADDS = Object.freeze([] as const);
export const RUN_STATES_THE_LAYER_ADDS = Object.freeze([] as const);

/**
 * The three ends a failure inside a group may have, and no fourth
 * (F142-FR-004, PU-03).
 */
export const THREE_ENDS = Object.freeze([
  "the task returns to the main line",
  "the layer is off for the phase attempt",
  "the layer is off for the run",
] as const);
export type End = (typeof THREE_ENDS)[number];

/** The directive each end is carried out by, where one carries it (§D.1). */
export const DIRECTIVE_OF_THE_END: Readonly<Record<End, string | null>> = Object.freeze({
  [THREE_ENDS[0]]: null,
  [THREE_ENDS[1]]: "layerOffForAttempt",
  [THREE_ENDS[2]]: "layerOffForRun",
});

/**
 * The failures that can happen inside a group, from F142-FR-004 and
 * F142-FR-023 and from the reasons of row 185. Every one of them is mapped by
 * `endOfAFailureInsideAGroup` to exactly one of the three ends; a value that is
 * no member of this list is mapped too, by the unknown-value rule of row 185.
 */
export const FAILURES_INSIDE_A_GROUP = Object.freeze([
  "delta-refused",
  "worker-killed",
  "merge-check-failed",
  "group-failures",
  "harness-error",
  "unchecked",
  "missing-object",
  "ledger",
  "check-budget",
  "plan-hash",
  "apply-incomplete",
] as const);
export type FailureInsideAGroup = (typeof FAILURES_INSIDE_A_GROUP)[number];

/** The end of one failure: which of the three, and what the layer records. */
export type EndOfAFailure = {
  readonly end: End;
  /** The reason of row 185, where the end is one of the two switch-offs. */
  readonly reason: LayerOffReason | null;
  /** The directive the engine executes, or `null` where the task simply returns. */
  readonly directive: string | null;
  /** The layer adds no exit code: always `null`. */
  readonly exitCode: null;
  /** The layer adds no stop reason: always `null`. */
  readonly stopReason: null;
  /** The layer adds no run state: always `null`. */
  readonly runState: null;
  readonly detail: string;
};

/**
 * T044 — map every failure inside a group to exactly one of the three ends
 * (F142-FR-004, F142-FR-023, PU-03).
 *
 * The mapping is total and it is a function: every failure has one end, and no
 * failure has two. A refused delta and a killed worker send **the task back to
 * the main line**, where the breakers of the pass loop count as they always do.
 * The six reasons of row 185 that are scoped to the attempt switch the layer
 * off **for the phase attempt**; the two that are scoped to the run switch it
 * off **for the run**. A failure this feature does not name is read by the
 * unknown-value rule of row 185 — "shown as text; the layer is off for the run"
 * — so an unknown failure is never silently treated as a returning task.
 *
 * Whatever the end, no exit code, no stop reason and no run state is added.
 */
export function endOfAFailureInsideAGroup(failure: string): EndOfAFailure {
  const end = (which: End, reason: LayerOffReason | null, detail: string): EndOfAFailure =>
    Object.freeze({
      end: which,
      reason,
      directive: DIRECTIVE_OF_THE_END[which],
      exitCode: null,
      stopReason: null,
      runState: null,
      detail,
    });
  switch (failure) {
    case "delta-refused":
      return end(
        THREE_ENDS[0],
        null,
        "the delta of the worker was refused by an audit: its task returns to the main line (F142-FR-004)",
      );
    case "worker-killed":
      return end(
        THREE_ENDS[0],
        null,
        "the worker pass was ended by a cap or a watchdog: its task returns to the main line (F142-FR-022, F142-FR-024)",
      );
    case "merge-check-failed":
      return end(
        THREE_ENDS[0],
        null,
        "the merge check failed or carried a condition: the unit goes to the repair path and its tasks return to the main line (F142-FR-061)",
      );
    default:
      break;
  }
  const scope = layerOffScopeOf(failure);
  if (scope === "attempt") {
    return end(
      THREE_ENDS[1],
      failure as LayerOffReason,
      `the engine reported \`${failure}\`: the layer is off for the phase attempt and the micro-loop layer carries on serially (F142-FR-023)`,
    );
  }
  if (scope === "run") {
    return end(
      THREE_ENDS[2],
      failure as LayerOffReason,
      `the engine reported \`${failure}\`: the layer is off for the run (F142-FR-023)`,
    );
  }
  return end(
    THREE_ENDS[2],
    null,
    `\`${failure}\` is no member of row 185: by the unknown-value rule of that row it is shown as text and the layer is off for the run`,
  );
}

/** The end of every failure this feature names, keyed by the failure. */
export function endsOfEveryFailure(): Readonly<Record<string, End>> {
  return Object.freeze(
    Object.fromEntries(
      FAILURES_INSIDE_A_GROUP.map((failure) => [failure, endOfAFailureInsideAGroup(failure).end]),
    ),
  );
}

/** The failures this feature names that no end of the three covers: none. */
export function failuresWithoutAnEnd(): readonly string[] {
  return Object.freeze(
    FAILURES_INSIDE_A_GROUP.filter(
      (failure) => !THREE_ENDS.includes(endOfAFailureInsideAGroup(failure).end),
    ),
  );
}

/* ================================================================== *
 * 5. T053 — the `parallel.*` events the engine is asked to emit
 *    (F142-FR-025; rule PU-58).
 * ================================================================== */

/** The closed set of `parallel.*` event types (row 74 of annex X §X.6). */
export const PARALLEL_EVENT_TYPES = Object.freeze([
  "parallel.plan",
  "parallel.admission",
  "parallel.group.started",
  "parallel.group.ended",
  "parallel.worker.started",
  "parallel.worker.ended",
  "parallel.integration",
] as const);
export type ParallelEventType = (typeof PARALLEL_EVENT_TYPES)[number];

/** True where the type is a member of row 74. */
export function isAParallelEventType(type: string): type is ParallelEventType {
  return (PARALLEL_EVENT_TYPES as readonly string[]).includes(type);
}

/** The two fields every event **of a worker** carries (F142-FR-025, F100-FR-198). */
export const WORKER_EVENT_FIELDS = Object.freeze(["workerId", "wseq"] as const);

/** The event types that are events of a worker and so carry those two fields. */
export const EVENTS_OF_A_WORKER = Object.freeze([
  "parallel.worker.started",
  "parallel.worker.ended",
] as const);

/** In the compatibility projection every event of row 74 projects to nothing. */
export const COMPATIBILITY_PROJECTION_OF_THESE_EVENTS = null;

/** What the compatibility projection of one of these events is: nothing (PU-58). */
export function compatibilityProjectionOf(type: string): null {
  void type;
  return COMPATIBILITY_PROJECTION_OF_THESE_EVENTS;
}

/**
 * One event the layer asks the engine to emit (F142-FR-006, F142-FR-025). The
 * layer holds no event writer: it returns this value and the engine writes the
 * envelope around it, filling `seq`, `ts`, `runId` and the rest.
 */
export type EventRequest = {
  readonly type: ParallelEventType;
  readonly data: Readonly<Record<string, unknown>>;
  /** The worker the event belongs to, on an event of a worker (F142-FR-025). */
  readonly workerId?: string;
  /** The position in that worker's own stream, on an event of a worker. */
  readonly wseq?: number;
};

/** The request of an event of a worker: `workerId` and `wseq` are not optional. */
export type WorkerEventRequest = EventRequest & {
  readonly workerId: string;
  readonly wseq: number;
};

/**
 * T053 — the event `parallel.plan`: the plan with its hash (F142-FR-025). It is
 * no event of a worker, so it carries neither `workerId` nor `wseq`.
 */
export function planEvent(plan: {
  readonly hash: string;
  readonly workers: number;
  readonly groups: number;
}): EventRequest {
  return Object.freeze({
    type: "parallel.plan" as const,
    data: Object.freeze({ hash: plan.hash, workers: plan.workers, groups: plan.groups }),
  });
}

/**
 * T053 — the event `parallel.admission`: one per task, with `taskId` and the
 * verdict of **every** check of row 61 (F142-FR-025, PU-58). The verdicts are
 * carried by name, so a reader can tell which check refused without knowing the
 * order of the row.
 */
export function admissionEvent(task: {
  readonly id: string;
  readonly checks: readonly AdmissionVerdict[];
}): EventRequest {
  return Object.freeze({
    type: "parallel.admission" as const,
    data: Object.freeze({
      taskId: task.id,
      verdicts: Object.freeze(
        Object.fromEntries(
          task.checks.map((verdict) => [verdict.check, verdict.passed ? "passed" : "failed"]),
        ),
      ),
      details: Object.freeze(
        Object.fromEntries(task.checks.map((verdict) => [verdict.check, verdict.detail])),
      ),
    }),
  });
}

/** T053 — the start of a group (F142-FR-025). */
export function groupStartedEvent(group: {
  readonly groupId: string;
  readonly ordinal: number;
  readonly phase: number;
  readonly tasks: readonly string[];
}): EventRequest {
  return Object.freeze({
    type: "parallel.group.started" as const,
    data: Object.freeze({
      groupId: group.groupId,
      ordinal: group.ordinal,
      phase: group.phase,
      taskCount: group.tasks.length,
      tasks: Object.freeze([...group.tasks]),
    }),
  });
}

/** The outcomes a group ends with (F142-FR-023, F142-FR-061). */
export const GROUP_OUTCOMES = Object.freeze(["kept", "repair", "failed"] as const);
export type GroupOutcome = (typeof GROUP_OUTCOMES)[number];

/** T053 — the end of a group, with its outcome (F142-FR-025). */
export function groupEndedEvent(group: {
  readonly groupId: string;
  readonly outcome: GroupOutcome;
  readonly refused?: number;
}): EventRequest {
  return Object.freeze({
    type: "parallel.group.ended" as const,
    data: Object.freeze({
      groupId: group.groupId,
      outcome: group.outcome,
      refused: group.refused ?? 0,
    }),
  });
}

/** The outcomes a worker ends with (PU-58). */
export const WORKER_OUTCOMES = Object.freeze([
  "integrated",
  "refused",
  "killed",
  "paused",
] as const);
export type WorkerOutcome = (typeof WORKER_OUTCOMES)[number];

/**
 * T053 — the start of a worker (F142-FR-025). Every event of a worker carries
 * `workerId` and `wseq`: the return type makes both of them required.
 */
export function workerStartedEvent(worker: {
  readonly workerId: string;
  readonly wseq: number;
  readonly taskId: string;
  readonly groupId: string;
}): WorkerEventRequest {
  return Object.freeze({
    type: "parallel.worker.started" as const,
    workerId: worker.workerId,
    wseq: worker.wseq,
    data: Object.freeze({
      workerId: worker.workerId,
      wseq: worker.wseq,
      taskId: worker.taskId,
      groupId: worker.groupId,
    }),
  });
}

/** T053 — the end of a worker, with its outcome and the refusal reason (F142-FR-025). */
export function workerEndedEvent(worker: {
  readonly workerId: string;
  readonly wseq: number;
  readonly outcome: WorkerOutcome;
  readonly refused?: string;
}): WorkerEventRequest {
  return Object.freeze({
    type: "parallel.worker.ended" as const,
    workerId: worker.workerId,
    wseq: worker.wseq,
    data: Object.freeze({
      workerId: worker.workerId,
      wseq: worker.wseq,
      outcome: worker.outcome,
      ...(worker.refused === undefined ? {} : { reason: worker.refused }),
    }),
  });
}

/** The steps of integration, in the order the engine runs them (F142-FR-025). */
export const INTEGRATION_STEPS = Object.freeze([
  "audit",
  "compose",
  "apply",
  "tick",
  "merge-check",
] as const);
export type IntegrationStep = (typeof INTEGRATION_STEPS)[number];

/**
 * T053 — the event `parallel.integration`: one per step, with `step` and
 * `pathCount` and **no path text** beyond what the redactor allows
 * (F142-FR-025, PU-58).
 *
 * No path reaches the event: only how many there were. The redactor is the
 * engine's, and this layer gives it nothing to redact, which is the strongest
 * form of "no path text beyond what the redactor allows".
 */
export function integrationEvent(step: {
  readonly step: IntegrationStep;
  readonly pathCount: number;
  readonly groupId?: string;
}): EventRequest {
  return Object.freeze({
    type: "parallel.integration" as const,
    data: Object.freeze({
      step: step.step,
      pathCount: step.pathCount,
      ...(step.groupId === undefined ? {} : { groupId: step.groupId }),
    }),
  });
}

/** The fields of `parallel.integration` that may carry a path: none (PU-58). */
export const INTEGRATION_EVENT_PATH_FIELDS = Object.freeze([] as const);

/**
 * The data of an event, with every value that looks like a path removed — the
 * check CT-142-125 makes on `parallel.integration`. A value is read as a path
 * where it is text holding a path separator; a count never is.
 */
export function pathTextIn(data: Readonly<Record<string, unknown>>): readonly string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" && value.includes("/")) found.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(data);
  return Object.freeze(found);
}

/**
 * T053 — every event of a group, in the order the engine emits them
 * (F142-FR-025). The layer returns the list and the engine emits it: this is
 * the whole of "ask the engine to emit the `parallel.*` events".
 */
export function eventsOfAGroup(input: {
  readonly groupId: string;
  readonly ordinal: number;
  readonly phase: number;
  readonly tasks: readonly string[];
  readonly workers: readonly {
    readonly workerId: string;
    readonly taskId: string;
    readonly outcome: WorkerOutcome;
    readonly refused?: string;
  }[];
  readonly integration: readonly { readonly step: IntegrationStep; readonly pathCount: number }[];
  readonly outcome: GroupOutcome;
}): readonly EventRequest[] {
  const events: EventRequest[] = [
    groupStartedEvent({
      groupId: input.groupId,
      ordinal: input.ordinal,
      phase: input.phase,
      tasks: input.tasks,
    }),
  ];
  for (const worker of input.workers) {
    events.push(
      workerStartedEvent({
        workerId: worker.workerId,
        wseq: 1,
        taskId: worker.taskId,
        groupId: input.groupId,
      }),
    );
    events.push(
      workerEndedEvent({
        workerId: worker.workerId,
        wseq: 2,
        outcome: worker.outcome,
        refused: worker.refused,
      }),
    );
  }
  for (const step of input.integration) {
    events.push(
      integrationEvent({ step: step.step, pathCount: step.pathCount, groupId: input.groupId }),
    );
  }
  events.push(
    groupEndedEvent({
      groupId: input.groupId,
      outcome: input.outcome,
      refused: input.workers.filter((worker) => worker.outcome === "refused").length,
    }),
  );
  return Object.freeze(events);
}

/** The events of the list that are events of a worker and lack one of the two fields. */
export function workerEventsMissingAField(events: readonly EventRequest[]): readonly string[] {
  return Object.freeze(
    events
      .filter((event) => (EVENTS_OF_A_WORKER as readonly string[]).includes(event.type))
      .filter((event) => event.workerId === undefined || event.wseq === undefined)
      .map((event) => event.type),
  );
}

/** The events of the list whose type is no member of row 74. */
export function eventsOutsideRow74(events: readonly EventRequest[]): readonly string[] {
  return Object.freeze(
    events.filter((event) => !isAParallelEventType(event.type)).map((event) => event.type),
  );
}

/* ================================================================== *
 * 5. What a group costs (T095, F142-FR-021; rules PU-67, PU-69, PU-70,
 *    PU-79, PU-87).
 * ================================================================== */

/**
 * The ends a worker pass can have: the four of a pass that ran to a stop of
 * its own, and the five kills of R29 section F ("Kills and watchdogs").
 */
export const WORKER_PASS_ENDS = Object.freeze([
  "checkpoint",
  "yield",
  "quota-signal",
  "harness-error",
  "proposal-cap",
  "unit-cap",
  "idle-watchdog",
  "progress-watchdog",
  "repeat-stall-watchdog",
] as const);
export type WorkerPassEnd = (typeof WORKER_PASS_ENDS)[number];

/**
 * The counters of the outer loop that a worker pass MUST leave as they were,
 * whatever its end (F142-FR-021; rule PU-67, which states the list of IR-06
 * and IR-48).
 *
 * `passCount` is the pass count of the phase attempt, `rejectCount` its reject
 * count, `attemptOrdinal` the ordinal of the phase attempt, `malformedStreak`
 * the MALFORMED streak, `oscillationWindow` the number of inputs of the
 * oscillation window; the last four are the breakers of the pass loop.
 */
export const OUTER_LOOP_COUNTERS = Object.freeze([
  "passCount",
  "rejectCount",
  "attemptOrdinal",
  "malformedStreak",
  "oscillationWindow",
  "consecErr",
  "consecCap",
  "consecShort",
  "noProgress",
] as const);
export type OuterLoopCounter = (typeof OUTER_LOOP_COUNTERS)[number];

/** The breakers of the pass loop among those counters (PU-67, IR-48). */
export const BREAKERS_OF_THE_PASS_LOOP = Object.freeze([
  "consecErr",
  "consecCap",
  "consecShort",
  "noProgress",
] as const);

/** A reading of the counters of the outer loop, as the view of a phase attempt carries them. */
export type OuterLoopCounters = Readonly<Record<OuterLoopCounter, number>>;

/** F142-FR-021 — a worker pass is outside the pass loop. */
export const A_WORKER_PASS_IS_OUTSIDE_THE_PASS_LOOP = true as const;

/** F142-FR-021 — the passes a worker pass spends: none. */
export const PASSES_SPENT_BY_A_WORKER_PASS = 0 as const;

/**
 * T095 — the counters of the outer loop after a worker pass (F142-FR-021,
 * PU-67).
 *
 * The end of the pass is a parameter only so that the claim can be read off
 * the signature: the result is the reading that was given, for **every** member
 * of `WORKER_PASS_ENDS` and for every value beside them. The layer holds no
 * counter of the outer loop (F142-FR-006), so this is what the engine's own
 * accounting is compared against and never a writer of it.
 */
export function outerLoopCountersAfterAWorkerPass(
  before: OuterLoopCounters,
  _end: string,
): OuterLoopCounters {
  return Object.freeze({ ...before });
}

/** The counters that differ between two readings, by name (the test of PU-67). */
export function outerLoopCountersChangedBy(
  before: OuterLoopCounters,
  after: OuterLoopCounters,
): readonly OuterLoopCounter[] {
  return Object.freeze(OUTER_LOOP_COUNTERS.filter((name) => before[name] !== after[name]));
}

/** The reasons a start **again** of a worker pass charges no cycle (F142-FR-021, PU-87). */
export const RESTARTS_THAT_CHARGE_NO_CYCLE = Object.freeze([
  "quota-pause",
  "interruption-not-caused-by-the-worker",
] as const);
export type RestartThatChargesNoCycle = (typeof RESTARTS_THAT_CHARGE_NO_CYCLE)[number];

/** One start of a worker, as the record `worker_started` of row 184 carries it. */
export type WorkerStart = {
  readonly workerId: string;
  readonly taskId: string;
  /** Set where this start is a start **again**, with the reason for it. */
  readonly restartedAfter?: string;
};

/** One start that charged no cycle, with the reason it charged none. */
export type UnchargedStart = {
  readonly workerId: string;
  readonly taskId: string;
  readonly reason: string;
};

/** What a group charged of the cycle cap of the micro-loop layer (F142-FR-021). */
export type CycleCharge = {
  /** One cycle per admitted worker task, at its first start. */
  readonly charged: number;
  readonly perTask: Readonly<Record<string, number>>;
  readonly notCharged: readonly UnchargedStart[];
};

/**
 * T095 — charge one cycle of the micro-loop layer per admitted worker task, at
 * its **first** start (F142-FR-021; rule PU-87, which amends PU-68).
 *
 * A start of a task that the admission of this group did not admit charges
 * nothing: the cycle belongs to the admitted task, not to the process. A start
 * again — after a quota pause, or after an interruption the worker did not
 * cause, or for any other reason — charges nothing either, because the cycle of
 * that task was charged at its first start. So the charge of a group is at most
 * the number of its tasks, whatever happened to its processes.
 */
export function chargeCyclesPerAdmittedTask(
  starts: readonly WorkerStart[],
  admittedTasks: readonly string[],
): CycleCharge {
  const perTask: Record<string, number> = {};
  for (const task of admittedTasks) perTask[task] = 0;
  const notCharged: UnchargedStart[] = [];
  for (const start of starts) {
    if (!admittedTasks.includes(start.taskId)) {
      notCharged.push(
        Object.freeze({
          workerId: start.workerId,
          taskId: start.taskId,
          reason: `${start.taskId} is no admitted task of this group: no cycle is charged for it`,
        }),
      );
      continue;
    }
    if ((perTask[start.taskId] ?? 0) > 0) {
      const after = start.restartedAfter;
      notCharged.push(
        Object.freeze({
          workerId: start.workerId,
          taskId: start.taskId,
          reason:
            after === undefined
              ? `a start again of ${start.taskId}: the cycle was charged at its first start`
              : `a pass started again after ${after}: the cycle was charged at the first start of ${start.taskId}`,
        }),
      );
      continue;
    }
    perTask[start.taskId] = 1;
  }
  return Object.freeze({
    charged: Object.values(perTask).reduce((sum, one) => sum + one, 0),
    perTask: Object.freeze(perTask),
    notCharged: Object.freeze(notCharged),
  });
}

/**
 * Whether the remaining cycles admit a group (PU-87, second sentence). The
 * admission check `headroom` of `admission.ts` is the gate; this is the same
 * rule read from the charging side, so that the two cannot drift.
 */
export function cyclesSufficeForTheGroup(input: {
  readonly remainingCycles: number;
  readonly tasks: readonly string[];
}): { readonly admissible: boolean; readonly needed: number; readonly detail: string } {
  const needed = input.tasks.length;
  const admissible = input.remainingCycles >= needed;
  return Object.freeze({
    admissible,
    needed,
    detail: `${input.remainingCycles} cycle(s) remain and a group of ${needed} task(s) charges ${needed}: ${admissible ? "admissible" : "no group is admitted"}`,
  });
}

/** One worker's time, with the time it was paused (ruling 27). */
export type WorkerTime = {
  readonly workerId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** Paused time, which is excluded from every count (F142-FR-021). */
  readonly pausedMs?: number;
};

/** The time one worker was alive, paused time excluded. */
export function aliveMsOf(worker: WorkerTime): number {
  return Math.max(0, worker.endedAtMs - worker.startedAtMs - (worker.pausedMs ?? 0));
}

/** What a group cost in time: the wall time once, and the agent time over its passes. */
export type GroupTime = {
  /** The wall time of the group, counted once whatever the worker count. */
  readonly wallMs: number;
  /** The sum over the passes of the group, which is what a group buys. */
  readonly agentMs: number;
  /** What the elapsed time of the phase attempt advances by: the wall time, once. */
  readonly attemptElapsedAdvanceMs: number;
  readonly pausedMs: number;
  readonly workers: number;
  readonly perWorkerMs: Readonly<Record<string, number>>;
};

/**
 * T095 — count the wall time of a group **once**, whatever the worker count,
 * with paused time excluded (F142-FR-021; rule PU-69).
 *
 * The run's wall-clock budget and the elapsed time of the phase attempt advance
 * by `wallMs` and by nothing more: four workers of ten minutes each advance the
 * attempt by about ten minutes, not by forty. The forty is `agentMs`, the sum
 * over passes, which is what the report gives as agent hours beside the wall
 * hours (F142-FR-022).
 */
export function countWallTimeOnce(input: {
  readonly groupStartedAtMs: number;
  readonly groupEndedAtMs: number;
  /** The time the whole group was paused (a quota pause), excluded from the wall time. */
  readonly pausedMs?: number;
  readonly workers: readonly WorkerTime[];
}): GroupTime {
  const paused = Math.max(0, input.pausedMs ?? 0);
  const wallMs = Math.max(0, input.groupEndedAtMs - input.groupStartedAtMs - paused);
  const perWorkerMs: Record<string, number> = {};
  for (const worker of input.workers) perWorkerMs[worker.workerId] = aliveMsOf(worker);
  return Object.freeze({
    wallMs,
    agentMs: Object.values(perWorkerMs).reduce((sum, one) => sum + one, 0),
    attemptElapsedAdvanceMs: wallMs,
    pausedMs: paused,
    workers: input.workers.length,
    perWorkerMs: Object.freeze(perWorkerMs),
  });
}

/**
 * The steps of a group whose time counts inside the budget of inner check time
 * of the phase attempt (F142-FR-021; rule PU-70).
 */
export const GROUP_OVERHEAD_STEPS = Object.freeze([
  "snapshot",
  "fingerprint",
  "audit",
  "compose",
  "apply",
  "merge-check",
] as const);
export type GroupOverheadStep = (typeof GROUP_OVERHEAD_STEPS)[number];

/** The share of the elapsed time of a phase attempt the inner checks may spend (R27 D1.5). */
export const INNER_CHECK_BUDGET_SHARE = 0.15;

/** The budget of inner check time of a phase attempt, in milliseconds. */
export function innerCheckBudgetMs(attemptElapsedMs: number): number {
  return Math.max(0, attemptElapsedMs) * INNER_CHECK_BUDGET_SHARE;
}

/** The time of the steps of `GROUP_OVERHEAD_STEPS`, and of nothing else. */
export function groupOverheadMs(
  overhead: Readonly<Partial<Record<GroupOverheadStep, number>>>,
): number {
  return GROUP_OVERHEAD_STEPS.reduce((sum, step) => sum + Math.max(0, overhead[step] ?? 0), 0);
}

/** F142-FR-021, PU-79 — the commands group overhead excludes from the inner check set: none. */
export const COMMANDS_EXCLUDED_BY_GROUP_OVERHEAD = Object.freeze([] as const);

/**
 * The inner check set after group overhead broke the budget: unchanged
 * (F142-FR-021; rule PU-79). Group overhead never excludes a command — what a
 * breach stops is the **next group**, never a check.
 */
export function innerCheckSetAfterGroupOverhead(
  innerCheckSet: readonly string[],
): readonly string[] {
  return Object.freeze([...innerCheckSet]);
}

/** The budget of inner check time with a group's overhead counted inside it. */
export type InnerCheckBudgetReading = {
  readonly budgetMs: number;
  readonly innerCheckMs: number;
  readonly groupOverheadMs: number;
  readonly spentMs: number;
  readonly broken: boolean;
  /** On a breach no further group is admitted in the phase attempt (PU-70). */
  readonly noFurtherGroupIsAdmitted: boolean;
  /** The commands group overhead excluded: always none (PU-79). */
  readonly excludedCommands: readonly string[];
  /** The inner check set as it stays, whether the budget broke or not. */
  readonly innerCheckSet: readonly string[];
  /** The reason of row 185 a breach carries, or `null` where it did not break. */
  readonly layerOff: LayerOffForAttemptReason | null;
  readonly detail: string;
};

/**
 * T095 — count the time of snapshots, fingerprints, audits, composition, the
 * application and the merge check inside the budget of inner check time of the
 * phase attempt (F142-FR-021; rules PU-70, PU-79).
 *
 * When the overhead of a group breaks that budget, no further group is admitted
 * in the phase attempt and the layer is off for it with the reason
 * `check-budget` of row 185 — and the inner check set stays exactly as it was:
 * group overhead never excludes a command.
 */
export function countGroupOverheadInTheInnerCheckBudget(input: {
  readonly attemptElapsedMs: number;
  /** The time the inner checks themselves have spent in the phase attempt. */
  readonly innerCheckMs: number;
  readonly overhead: Readonly<Partial<Record<GroupOverheadStep, number>>>;
  readonly innerCheckSet?: readonly string[];
}): InnerCheckBudgetReading {
  const budgetMs = innerCheckBudgetMs(input.attemptElapsedMs);
  const overhead = groupOverheadMs(input.overhead);
  const innerCheckMs = Math.max(0, input.innerCheckMs);
  const spentMs = innerCheckMs + overhead;
  const broken = spentMs > budgetMs;
  const set = innerCheckSetAfterGroupOverhead(input.innerCheckSet ?? []);
  return Object.freeze({
    budgetMs,
    innerCheckMs,
    groupOverheadMs: overhead,
    spentMs,
    broken,
    noFurtherGroupIsAdmitted: broken,
    excludedCommands: COMMANDS_EXCLUDED_BY_GROUP_OVERHEAD,
    innerCheckSet: set,
    layerOff: broken ? ("check-budget" as const) : null,
    detail: broken
      ? `the inner checks spent ${innerCheckMs} ms and the group overhead ${overhead} ms, which is more than the ${budgetMs} ms of the budget: no further group is admitted in the phase attempt and no command is excluded (check-budget)`
      : `the inner checks spent ${innerCheckMs} ms and the group overhead ${overhead} ms of the ${budgetMs} ms of the budget`,
  });
}

/* ================================================================== *
 * 6. What the operator reads (T096, F142-FR-022; rules PU-71, PU-72,
 *    PU-97).
 * ================================================================== */

/**
 * The eight keys the `[LOOP]` line gains with the option on, in the order of
 * F142-FR-022 and of `data/loop-fields.json`.
 */
export const LOOP_LINE_KEYS = Object.freeze([
  "parallel",
  "workers",
  "groups",
  "group-failures",
  "refused",
  "worker-caches",
  "wall-hours",
  "agent-hours",
] as const);
export type LoopLineKey = (typeof LOOP_LINE_KEYS)[number];

/** The key the line carries beside the eight when `parallel=off` (F142-FR-022). */
export const LOOP_LINE_REASON_KEY = "reason" as const;

/** The `[LOOP]` fields of this feature exist only with the option on (DV-088). */
export const LOOP_LINE_FIELDS_ONLY_WITH_THE_OPTION_ON = true as const;

/** The two values of `worker-caches` (rule PU-97). */
export const WORKER_CACHES_VALUES = Object.freeze(["profile", "shared"] as const);
export type WorkerCaches = (typeof WORKER_CACHES_VALUES)[number];

/** The runtime promises no port to a worker; a project derives one itself (PU-97). */
export const THE_RUNTIME_PROMISES_NO_PORT = true as const;
/** What a project may derive a port from (PU-97). */
export const A_PORT_MAY_BE_DERIVED_FROM = "the opaque token of the worker tree" as const;

/** What the toolchain profile of EP-16 says about caches per worker (PU-97). */
export type WorkerCachesReading = {
  readonly value: WorkerCaches;
  /** The doctor names a toolchain without a profile for caches per worker. */
  readonly doctorLines: readonly string[];
  readonly detail: string;
};

/**
 * T096 — `worker-caches=profile` or `worker-caches=shared` (F142-FR-022; rule
 * PU-97).
 *
 * A toolchain profile may give, per worker, the environment that moves a cache
 * which is unsafe for several writers — the field `workerEnv` of
 * `specstride.toolchain/1` (EP-16, consumed). Where no profile gives one, the
 * run record and the `[LOOP]` line say `shared` and the doctor names it.
 */
export function workerCachesReading(
  profile?: { readonly workerEnv?: Readonly<Record<string, unknown>> | null } | null,
): WorkerCachesReading {
  const env = profile?.workerEnv;
  const moves = env !== undefined && env !== null && Object.keys(env).length > 0;
  if (moves) {
    return Object.freeze({
      value: "profile" as const,
      doctorLines: Object.freeze([]),
      detail: `the toolchain profile moves ${Object.keys(env).length} cache(s) per worker`,
    });
  }
  return Object.freeze({
    value: "shared" as const,
    doctorLines: Object.freeze([
      "the toolchain has no profile that moves a cache per worker: the workers of a group share every cache (worker-caches=shared)",
    ]),
    detail: "no profile gives an environment per worker: the caches are shared",
  });
}

/**
 * The ends that are a time limit or a watchdog, and so count as a **killed
 * pass** (F142-FR-022; rule PU-71, ruling 5). The list is the kills of R29
 * section F: the two caps and the three watchdogs of a pass.
 */
export const KILLING_ENDS = Object.freeze([
  "proposal-cap",
  "unit-cap",
  "idle-watchdog",
  "progress-watchdog",
  "repeat-stall-watchdog",
] as const);
export type KillingEnd = (typeof KILLING_ENDS)[number];

/** The target a killed pass counts for (ruling 5, decision 21). */
export const KILLED_PASS_TARGET = "decision 21" as const;
/** A killed pass counts in every arm (F142-FR-022, PU-71). */
export const KILLED_PASSES_COUNT_IN_EVERY_ARM = true as const;

/**
 * T096 — a worker pass ended by **any** time limit or watchdog counts as a
 * killed pass (F142-FR-022; rule PU-71).
 */
export function countsAsAKilledPass(end: string): boolean {
  return (KILLING_ENDS as readonly string[]).includes(end);
}

/** The usage of one model call of one worker (PU-72). */
export type ModelCallUsage = {
  readonly workerId: string;
  /** The ordinal of the call inside that worker's pass. */
  readonly call: number;
  readonly tokens: number;
};

/** One worker pass, as the report reads it. */
export type WorkerPass = {
  readonly workerId: string;
  readonly end: string;
  readonly wallMs: number;
  readonly agentMs: number;
  /** The usage of every model call of this worker (F142-FR-022, PU-72). */
  readonly usage?: readonly ModelCallUsage[];
};

/** The killed passes of a report: the count and their hours (PU-71). */
export type KilledPasses = {
  readonly count: number;
  readonly workers: readonly string[];
  readonly wallHours: number;
  readonly agentHours: number;
};

/** Hours from milliseconds, to three decimals, which is how the line prints them. */
export function hoursOf(ms: number): number {
  return Math.round((Math.max(0, ms) / 3_600_000) * 1000) / 1000;
}

/** T096 — the count, the wall hours and the agent hours of the killed passes (PU-71). */
export function killedPasses(passes: readonly WorkerPass[]): KilledPasses {
  const killed = passes.filter((pass) => countsAsAKilledPass(pass.end));
  return Object.freeze({
    count: killed.length,
    workers: Object.freeze(killed.map((pass) => pass.workerId)),
    wallHours: hoursOf(killed.reduce((sum, pass) => sum + pass.wallMs, 0)),
    agentHours: hoursOf(killed.reduce((sum, pass) => sum + pass.agentMs, 0)),
  });
}

/** Usage counted per model call per worker, and its total (F142-FR-022, PU-72). */
export type UsageReading = {
  readonly perCall: readonly ModelCallUsage[];
  readonly perWorker: Readonly<Record<string, number>>;
  readonly total: number;
};

/**
 * T096 — usage counted per model call per worker (F142-FR-022; rule PU-72).
 * The sum over the workers is the total of the group: no call of a worker is
 * counted against the main line and none is lost.
 */
export function usagePerModelCallPerWorker(passes: readonly WorkerPass[]): UsageReading {
  const perCall: ModelCallUsage[] = [];
  const perWorker: Record<string, number> = {};
  for (const pass of passes) {
    perWorker[pass.workerId] = perWorker[pass.workerId] ?? 0;
    for (const call of pass.usage ?? []) {
      perCall.push(Object.freeze({ ...call, workerId: pass.workerId }));
      perWorker[pass.workerId] = (perWorker[pass.workerId] ?? 0) + call.tokens;
    }
  }
  return Object.freeze({
    perCall: Object.freeze(perCall),
    perWorker: Object.freeze(perWorker),
    total: Object.values(perWorker).reduce((sum, one) => sum + one, 0),
  });
}

/** What the engine hands the layer at the call point `report` (F142-FR-022). */
export type ReportInput = {
  /** `loop.parallel.units` in force. With `off` the report is empty (F142-FR-005). */
  readonly units: "on" | "off";
  /** The fallback reason of row 60, where a precondition failed (F142-FR-002). */
  readonly fallback?: FallbackReason | null;
  /** The reason of row 185, where the layer was switched off inside the run. */
  readonly layerOff?: LayerOffReason | null;
  /** The worker count in force (F142-FR-019). */
  readonly workers: number;
  /** The groups that ran in the run. */
  readonly groups: number;
  readonly groupFailures: number;
  /** The deltas the audits refused (F142-FR-058). */
  readonly refused: number;
  readonly workerCaches: WorkerCaches;
  /** The wall time of the run's groups, counted once (PU-69). */
  readonly wallMs: number;
  /** The agent time of the run's passes, the sum over passes (PU-72). */
  readonly agentMs: number;
  readonly passes?: readonly WorkerPass[];
};

/** The report of the layer at the call point `report` (F142-FR-022). */
export type ParallelReport = {
  /** The eight keys, with `reason` where `parallel=off`, by key. */
  readonly fields: Readonly<Record<string, string>>;
  /** The same, as the `key=value` segments of the `[LOOP]` line, in order. */
  readonly loopLineFields: readonly string[];
  /**
   * The one field the layer contributes to the `[LOOP]` line. It begins
   * `parallel`, which is how DV-088 names it and how
   * `withoutTheNamedFieldsOfDv088` removes it whole.
   */
  readonly loopLineField: string;
  readonly wallHours: number;
  readonly agentHours: number;
  readonly killed: KilledPasses;
  readonly usage: UsageReading;
  /** The reason printed, or `null` where `parallel=on`. */
  readonly reason: string | null;
};

/**
 * T096 — the call point `report` of EP-04 (F142-FR-022; rules PU-71, PU-72,
 * PU-97).
 *
 * With the option **off** the report is empty: the layer object does not even
 * exist, and a caller that holds one from an earlier phase reads nothing from
 * it (F142-FR-005, DV-088). With the option on the report gives the eight keys
 * `parallel`, `workers`, `groups`, `group-failures`, `refused`,
 * `worker-caches`, `wall-hours` and `agent-hours`, and — where the layer is off
 * by a fallback reason of row 60 or by a reason of row 185 — that reason too.
 *
 * `parallel=on` means the layer ran; `parallel=off` with a reason means the
 * option was on and the layer did not run, which is the state an operator has
 * to be able to tell from the option being off altogether. The counts are kept
 * beside the reason, so that a run that fell back after two groups still shows
 * what those two groups cost.
 */
export function report(input: ReportInput): ParallelReport {
  if (input.units === "off") {
    return Object.freeze({
      fields: Object.freeze({}),
      loopLineFields: Object.freeze([]),
      loopLineField: "",
      wallHours: 0,
      agentHours: 0,
      killed: killedPasses([]),
      usage: usagePerModelCallPerWorker([]),
      reason: null,
    });
  }
  const passes = input.passes ?? [];
  const reason = input.layerOff ?? input.fallback ?? null;
  const on = reason === null;
  const wallHours = hoursOf(input.wallMs);
  const agentHours = hoursOf(input.agentMs);
  const fields: Record<string, string> = {
    parallel: on ? "on" : "off",
    workers: String(input.workers),
    groups: String(input.groups),
    "group-failures": String(input.groupFailures),
    refused: String(input.refused),
    "worker-caches": input.workerCaches,
    ...(on ? {} : { [LOOP_LINE_REASON_KEY]: reason }),
    "wall-hours": String(wallHours),
    "agent-hours": String(agentHours),
  };
  const loopLineFields = Object.freeze(
    Object.entries(fields).map(([key, value]) => `${key}=${value}`),
  );
  return Object.freeze({
    fields: Object.freeze(fields),
    loopLineFields,
    loopLineField: loopLineFields.join(" "),
    wallHours,
    agentHours,
    killed: killedPasses(passes),
    usage: usagePerModelCallPerWorker(passes),
    reason,
  });
}

/** The keys of a report that no key of `LOOP_LINE_KEYS` and no `reason` accounts for. */
export function reportKeysOutsideTheContract(reportOfTheLayer: ParallelReport): readonly string[] {
  const allowed = new Set<string>([...LOOP_LINE_KEYS, LOOP_LINE_REASON_KEY]);
  return Object.freeze(Object.keys(reportOfTheLayer.fields).filter((key) => !allowed.has(key)));
}

/** The keys of `LOOP_LINE_KEYS` a report did not give. */
export function loopLineKeysMissingFrom(reportOfTheLayer: ParallelReport): readonly LoopLineKey[] {
  return Object.freeze(LOOP_LINE_KEYS.filter((key) => !(key in reportOfTheLayer.fields)));
}

/* ================================================================== *
 * 7. Failed groups, and the switch off inside a run (T097,
 *    F142-FR-023; rules PU-52, PU-89).
 * ================================================================== */

/** The three things that make a group one **failed group** (F142-FR-023; PU-52). */
export const GROUP_FAILURE_CAUSES = Object.freeze([
  "worker-refused",
  "worker-killed",
  "merge-check-failed",
] as const);
export type GroupFailureCause = (typeof GROUP_FAILURE_CAUSES)[number];

/** What one closed group showed, as the engine reports it to the layer. */
export type ClosedGroup = {
  readonly groupId: string;
  /** The workers whose delta an audit refused (F142-FR-058). */
  readonly refused: readonly string[];
  /** The workers a time limit or a watchdog ended (F142-FR-024). */
  readonly killed: readonly string[];
  /** `null` where no merge check was due, because nothing was integrated. */
  readonly mergeCheckPassed: boolean | null;
};

/** Whether a group counts as one failed group, and why (F142-FR-023). */
export type GroupFailure = {
  readonly failed: boolean;
  readonly causes: readonly GroupFailureCause[];
  readonly detail: string;
};

/**
 * T097 — one failed group, or none (F142-FR-023; rule PU-52).
 *
 * A group in which a worker was refused or killed, or whose merge check failed,
 * counts as **one** failed group however many of the three happened in it. A
 * group that integrated nothing has no result to check: it reaches no merge
 * check, and it counts as failed too — otherwise a group in which every worker
 * was refused would be counted twice and a group in which none was would not be
 * counted at all.
 */
export function groupFailed(group: ClosedGroup): GroupFailure {
  const causes: GroupFailureCause[] = [];
  if (group.refused.length > 0) causes.push("worker-refused");
  if (group.killed.length > 0) causes.push("worker-killed");
  if (group.mergeCheckPassed === false) causes.push("merge-check-failed");
  if (causes.length === 0 && group.mergeCheckPassed === null) {
    causes.push("merge-check-failed");
    return Object.freeze({
      failed: true,
      causes: Object.freeze(causes),
      detail: `${group.groupId} integrated nothing, so no result was checked: one failed group`,
    });
  }
  return Object.freeze({
    failed: causes.length > 0,
    causes: Object.freeze(causes),
    detail:
      causes.length === 0
        ? `${group.groupId} refused no worker, lost none to a cap and passed its merge check: no failed group`
        : `${group.groupId} counts as one failed group (${causes.join(", ")})`,
  });
}

/**
 * The number of failed groups in a phase attempt after which the layer is off
 * (F142-FR-023). The value is `FAILED_GROUPS_BEFORE_THE_LAYER_IS_OFF` of
 * `types.ts`, re-exported here under the name the decision uses, so that the
 * two cannot drift.
 */
export const FAILED_GROUPS_THAT_SWITCH_THE_LAYER_OFF = FAILED_GROUPS_BEFORE_THE_LAYER_IS_OFF;

/** The counters of the layer in the view of a phase attempt (data-model.md). */
export type AttemptCounters = {
  readonly failedGroups: number;
  readonly groups: number;
  readonly refused: number;
  readonly cyclesCharged: number;
};

/** T097 — the number of failed groups of a phase attempt (F142-FR-023). */
export function countFailedGroups(groups: readonly ClosedGroup[]): number {
  return groups.filter((group) => groupFailed(group).failed).length;
}

/** The counters after a list of closed groups, from the counters before them. */
export function attemptCountersAfter(
  before: AttemptCounters,
  groups: readonly ClosedGroup[],
  cyclesCharged = 0,
): AttemptCounters {
  return Object.freeze({
    failedGroups: before.failedGroups + countFailedGroups(groups),
    groups: before.groups + groups.length,
    refused: before.refused + groups.reduce((sum, group) => sum + group.refused.length, 0),
    cyclesCharged: before.cyclesCharged + cyclesCharged,
  });
}

/**
 * What the engine reports to the layer beside the groups it closed (§D.1,
 * Outputs, and the further facts of F142-FR-023).
 */
export type EngineReport = {
  /** Worker passes that ended with a harness error (PU-89). */
  readonly harnessError?: readonly { readonly workerId: string; readonly taskId: string }[];
  /** An object of a tree is missing in the store. */
  readonly missingObject?: boolean;
  /** The ledger was changed inside a group. */
  readonly ledgerChangedInsideAGroup?: boolean;
  /** Group overhead broke the budget of inner check time (PU-70). */
  readonly checkBudgetBroken?: boolean;
  /** An application of a group could not be completed (PU-83). */
  readonly applicationNotCompleted?: boolean;
  /** The stored plan does not match its hash (F142-FR-017). */
  readonly planHashDiffers?: boolean;
};

/** The event of row 74 that carries each reason of row 185 (F142-FR-023, PU-58). */
export const EVENT_OF_A_LAYER_OFF_REASON: Readonly<Record<LayerOffReason, ParallelEventType>> =
  Object.freeze({
    "group-failures": "parallel.group.ended",
    "harness-error": "parallel.group.ended",
    unchecked: "parallel.group.ended",
    "check-budget": "parallel.group.ended",
    "missing-object": "parallel.integration",
    ledger: "parallel.integration",
    "apply-incomplete": "parallel.integration",
    "plan-hash": "parallel.plan",
  });

/** The decision to switch the layer off, with its reason and how far it reaches. */
export type LayerOffDecision = {
  readonly reason: LayerOffReason;
  readonly scope: "attempt" | "run";
  readonly directive: DirectiveCall;
  /** The event of row 74 that carries the reason (F142-FR-023, F142-FR-025). */
  readonly event: EventRequest;
  /** What carries on where the layer does not (F142-FR-023). */
  readonly carriesOn: string;
  /** No reason of row 185 stops a run (F142-FR-023). */
  readonly stopsTheRun: false;
  readonly detail: string;
};

/** The event of row 74 that announces one reason of row 185 (F142-FR-023). */
export function layerOffEvent(reason: LayerOffReason, groupId?: string): EventRequest {
  return Object.freeze({
    type: EVENT_OF_A_LAYER_OFF_REASON[reason],
    data: Object.freeze({
      ...(groupId === undefined ? {} : { groupId }),
      reason,
      scope: layerOffScopeOf(reason) ?? "run",
      outcome: "failed",
    }),
  });
}

/** The decision for one reason of row 185 (F142-FR-023). */
export function layerOffFor(
  reason: LayerOffReason,
  input: { readonly groupId?: string; readonly detail?: string } = {},
): LayerOffDecision {
  const end = endOfAFailureInsideAGroup(reason);
  const scope = layerOffScopeOf(reason) ?? "run";
  return Object.freeze({
    reason,
    scope,
    directive: Object.freeze({
      directive: (scope === "attempt" ? "layerOffForAttempt" : "layerOffForRun") as
        "layerOffForAttempt" | "layerOffForRun",
    }),
    event: layerOffEvent(reason, input.groupId),
    carriesOn:
      scope === "attempt"
        ? "the micro-loop layer carries on serially in the phase attempt"
        : "the micro-loop layer carries on serially for the rest of the run",
    stopsTheRun: false,
    detail: input.detail ?? end.detail,
  });
}

/**
 * T097 — count the failed groups and decide whether the layer is off
 * (F142-FR-023; rules PU-52, PU-89).
 *
 * The order of the decision: the two reasons scoped to the **run** are read
 * first, because they reach further than a reason scoped to the attempt and a
 * run that must stop using the layer altogether may not be told it is off for
 * one phase attempt only. Among the reasons scoped to the attempt the order of
 * the requirement holds: two failed groups, then a harness error, then the
 * three the engine reports. Where nothing applies the result is `null` and the
 * layer carries on.
 */
export function layerOffDecision(input: {
  readonly closedGroups?: readonly ClosedGroup[];
  /** The failed groups of this phase attempt before `closedGroups`. */
  readonly failedGroupsBefore?: number;
  readonly report?: EngineReport;
}): LayerOffDecision | null {
  const engine = input.report ?? {};
  const groups = input.closedGroups ?? [];
  const lastGroupId = groups.length === 0 ? undefined : groups[groups.length - 1]?.groupId;
  if (engine.applicationNotCompleted === true) {
    return layerOffFor("apply-incomplete", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
      detail:
        "the engine reported an application of a group that could not be completed: the layer is off for the run (apply-incomplete)",
    });
  }
  if (engine.planHashDiffers === true) {
    return layerOffFor("plan-hash", {
      detail:
        "the stored plan does not match its hash: no group starts and the layer is off for the run (plan-hash)",
    });
  }
  const failed = (input.failedGroupsBefore ?? 0) + countFailedGroups(groups);
  if (failed >= FAILED_GROUPS_THAT_SWITCH_THE_LAYER_OFF) {
    return layerOffFor("group-failures", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
      detail: `${failed} groups of this phase attempt failed: the layer is off for the phase attempt and the micro-loop layer carries on serially (group-failures)`,
    });
  }
  const harness = engine.harnessError ?? [];
  if (harness.length > 0) {
    return layerOffFor("harness-error", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
      detail: `the pass of ${harness.map((one) => one.workerId).join(", ")} ended with a harness error: the group closes at the barrier and the layer is off for the phase attempt (harness-error)`,
    });
  }
  if (engine.missingObject === true) {
    return layerOffFor("missing-object", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
    });
  }
  if (engine.ledgerChangedInsideAGroup === true) {
    return layerOffFor("ledger", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
    });
  }
  if (engine.checkBudgetBroken === true) {
    return layerOffFor("check-budget", {
      ...(lastGroupId === undefined ? {} : { groupId: lastGroupId }),
      detail:
        "the overhead of a group broke the budget of inner check time: no further group is admitted and the layer is off for the phase attempt (check-budget)",
    });
  }
  return null;
}

/** What a harness error does to the group it happened in (F142-FR-023; rule PU-89). */
export type HarnessErrorEnd = {
  /** The group closes at the barrier: the workers that ended are still integrated. */
  readonly closesTheGroupAtTheBarrier: true;
  readonly layerOff: LayerOffDecision;
  /** The tasks of the workers whose pass ended with a harness error. */
  readonly tasksToTheMainLine: readonly string[];
  /** On the main line the breakers count as they always do (PU-89). */
  readonly breakersCountOnTheMainLine: true;
  /** The ends a harness error is **not**: it is none of these (PU-89). */
  readonly notACheckpointNotAKillNotAQuotaSignal: true;
  readonly detail: string;
};

/**
 * T097 — a worker pass that ends with a harness error (F142-FR-023; rule
 * PU-89).
 *
 * A harness error is the end that is neither a checkpoint, nor a kill by a cap,
 * nor a quota signal. It closes the group at the barrier — the workers that did
 * end are audited and integrated as they always are — and switches the layer
 * off for the phase attempt. The task of the worker that broke goes to the main
 * line, where the breakers of the pass loop count as they always do, which is
 * the one place a worker's end does reach a counter of the outer loop: on the
 * main line, as an ordinary pass.
 */
export function onAHarnessError(input: {
  readonly groupId: string;
  readonly workers: readonly { readonly workerId: string; readonly taskId: string }[];
}): HarnessErrorEnd {
  const decision = layerOffDecision({
    closedGroups: Object.freeze([
      Object.freeze({
        groupId: input.groupId,
        refused: Object.freeze([]),
        killed: Object.freeze([]),
        mergeCheckPassed: null,
      }),
    ]),
    report: Object.freeze({ harnessError: input.workers }),
  });
  /* istanbul ignore next -- `layerOffDecision` with a harness error is never null */
  const layerOff = decision ?? layerOffFor("harness-error", { groupId: input.groupId });
  return Object.freeze({
    closesTheGroupAtTheBarrier: true,
    layerOff,
    tasksToTheMainLine: Object.freeze(input.workers.map((worker) => worker.taskId)),
    breakersCountOnTheMainLine: true,
    notACheckpointNotAKillNotAQuotaSignal: true,
    detail: `${input.groupId} closes at the barrier and the layer is off for the phase attempt; ${input.workers.map((worker) => worker.taskId).join(", ")} goes to the main line`,
  });
}

/* ================================================================== *
 * 8. The time limits of a worker pass and of a group (T098,
 *    F142-FR-024; R29 section F, "Kills and watchdogs").
 * ================================================================== */

/** One minute, in milliseconds. */
export const MINUTE_MS = 60_000 as const;

/** The starting value of the cap of a proposal, in minutes (F142-FR-024). */
export const PROPOSAL_CAP_STARTING_VALUE_MINUTES = 20 as const;
/** The starting value of the cap of a unit of work, in minutes (F142-FR-024). */
export const UNIT_CAP_STARTING_VALUE_MINUTES = 30 as const;

/** The caps of the micro-loop layer, in milliseconds (F142-FR-024). */
export type MicroLoopCaps = {
  /** The cap of a **proposal**, which is the time limit of a worker pass. */
  readonly proposalCapMs: number;
  /** The cap of a **unit of work**, which is the cap of a group. */
  readonly unitCapMs: number;
};

/** The starting values, which hold until the micro-loop layer reports others. */
export const STARTING_CAPS: MicroLoopCaps = Object.freeze({
  proposalCapMs: PROPOSAL_CAP_STARTING_VALUE_MINUTES * MINUTE_MS,
  unitCapMs: UNIT_CAP_STARTING_VALUE_MINUTES * MINUTE_MS,
});

/** F142-FR-024 — the keys this feature adds for the caps: none. */
export const KEYS_THIS_FEATURE_ADDS_FOR_THE_CAPS = Object.freeze([] as const);

/** F142-FR-024 — whose values they are. */
export const THE_CAPS_BELONG_TO = "the owner of the micro-loop layer" as const;

/** The watchdogs of a worker pass, which are those of a pass (R29 section F). */
export const WATCHDOGS_OF_A_WORKER_PASS = Object.freeze([
  "idle",
  "progress",
  "repeat-stall",
] as const);
export type WatchdogOfAWorkerPass = (typeof WATCHDOGS_OF_A_WORKER_PASS)[number];

/** A kill reaches the process group of that worker and no other (R29 section F). */
export const KILL_IS_DELIVERED_TO = "the process group of that worker only" as const;
/** A kill stops politely first (R29 section F). */
export const POLITE_STOP_FIRST = true as const;

/** The caps in force: those the micro-loop layer reports, else the starting values. */
export function microLoopCapsInForce(reading: Partial<MicroLoopCaps> = {}): MicroLoopCaps {
  return Object.freeze({
    proposalCapMs: reading.proposalCapMs ?? STARTING_CAPS.proposalCapMs,
    unitCapMs: reading.unitCapMs ?? STARTING_CAPS.unitCapMs,
  });
}

/** The time limits the layer requests for one worker pass (F142-FR-024). */
export type WorkerPassTimeLimits = {
  readonly timeLimitMs: number;
  readonly from: "the cap of a proposal of the micro-loop layer";
  readonly watchdogs: readonly WatchdogOfAWorkerPass[];
  readonly killIsDeliveredTo: string;
  readonly politeStopFirst: true;
};

/**
 * T098 — the time limits the layer requests for **every** worker pass
 * (F142-FR-024; R29 section F).
 *
 * They are the time limits of a proposal of the micro-loop layer: the cap of a
 * proposal, 20 minutes as a starting value, and the watchdogs of a pass. The
 * layer requests them; it owns neither the values nor a key for them.
 */
export function timeLimitsOfAWorkerPass(
  reading: Partial<MicroLoopCaps> = {},
): WorkerPassTimeLimits {
  return Object.freeze({
    timeLimitMs: microLoopCapsInForce(reading).proposalCapMs,
    from: "the cap of a proposal of the micro-loop layer" as const,
    watchdogs: WATCHDOGS_OF_A_WORKER_PASS,
    killIsDeliveredTo: KILL_IS_DELIVERED_TO,
    politeStopFirst: true,
  });
}

/** The cap a group holds (F142-FR-024). */
export type GroupUnitCap = {
  readonly capMs: number;
  readonly from: "the cap of a unit of work of the micro-loop layer";
  readonly measuredFrom: "group start";
  readonly measuredTo: "the end of the merge check";
  readonly quotaPausesExcluded: true;
};

/**
 * T098 — the cap of a unit of work, which a **group** holds (F142-FR-024).
 *
 * It is wall time from group start to the end of the merge check, quota pauses
 * excluded, 30 minutes as a starting value.
 */
export function unitCapOfAGroup(reading: Partial<MicroLoopCaps> = {}): GroupUnitCap {
  return Object.freeze({
    capMs: microLoopCapsInForce(reading).unitCapMs,
    from: "the cap of a unit of work of the micro-loop layer" as const,
    measuredFrom: "group start" as const,
    measuredTo: "the end of the merge check" as const,
    quotaPausesExcluded: true,
  });
}

/** The reading of the cap of a group at one moment inside it (F142-FR-024). */
export type UnitCapReading = {
  readonly capMs: number;
  readonly elapsedMs: number;
  readonly quotaPausedMs: number;
  readonly hit: boolean;
  readonly detail: string;
};

/** T098 — whether the cap of a group has been hit (F142-FR-024). */
export function unitCapReading(input: {
  readonly groupStartedAtMs: number;
  /** The moment of the reading: the end of the merge check, or now. */
  readonly atMs: number;
  readonly quotaPausedMs?: number;
  readonly caps?: Partial<MicroLoopCaps>;
}): UnitCapReading {
  const cap = unitCapOfAGroup(input.caps ?? {});
  const paused = Math.max(0, input.quotaPausedMs ?? 0);
  const elapsedMs = Math.max(0, input.atMs - input.groupStartedAtMs - paused);
  const hit = elapsedMs >= cap.capMs;
  return Object.freeze({
    capMs: cap.capMs,
    elapsedMs,
    quotaPausedMs: paused,
    hit,
    detail: `${elapsedMs} ms of the ${cap.capMs} ms of the unit cap are spent from group start to ${cap.measuredTo}, ${paused} ms of quota pause excluded: ${hit ? "the cap is hit" : "the cap holds"}`,
  });
}

/** What happens when the cap of a group is hit (F142-FR-024). */
export type OnTheUnitCap = {
  /** The workers still alive are ended. */
  readonly endLiveWorkers: readonly string[];
  /** The workers that ended are integrated. */
  readonly integrate: readonly string[];
  readonly groupCountsAsFailed: true;
  readonly cause: GroupFailureCause;
  readonly killIsDeliveredTo: string;
  readonly politeStopFirst: true;
  readonly detail: string;
};

/**
 * T098 — what the layer decides when the cap of a group is hit (F142-FR-024;
 * R29 section F).
 *
 * The live workers are ended, the workers that ended are integrated — their
 * work is not thrown away because a sibling was slow — and the group counts as
 * one failed group, with the cause `worker-killed`, so that two such groups
 * switch the layer off for the phase attempt (F142-FR-023).
 */
export function onTheUnitCapOfAGroup(input: {
  readonly live: readonly string[];
  readonly ended: readonly string[];
}): OnTheUnitCap {
  return Object.freeze({
    endLiveWorkers: Object.freeze([...input.live]),
    integrate: Object.freeze([...input.ended]),
    groupCountsAsFailed: true,
    cause: "worker-killed" as const,
    killIsDeliveredTo: KILL_IS_DELIVERED_TO,
    politeStopFirst: true,
    detail: `the unit cap of the group is hit: ${input.live.length} live worker(s) are ended politely first, ${input.ended.length} that ended are integrated, and the group counts as one failed group`,
  });
}
