/**
 * T031 to T034, T036 and T042 — THE GROUP EXECUTOR (F143-FR-008 to
 * F143-FR-011, F143-FR-013, F143-FR-022; R29 PU-25, PU-26, PU-28, PU-32 to
 * PU-36; R29v PU-82, PU-85, PU-94, PU-97; ruling K3).
 *
 * The engine owns the executor (R29 PU-07). Six tasks live here, and each is
 * one decision the engine makes about one worker:
 *
 *  T031, F143-FR-008 — THE WORKSPACE PART OF A WORKER. Each worker tree
 *    receives a workspace part OF ITS OWN: an EMPTY OUTBOX and a HANDOFF
 *    written by the runtime that names the ASSIGNED TASK, the SCOPE and the
 *    BASE FINGERPRINT. The phase evidence, the notebook and the outbox of the
 *    main line are NOT COPIED. The TASK LIST IS IN EVERY SNAPSHOT and is
 *    DROPPED FROM EVERY DELTA.
 *
 *  T032, F143-FR-009 — THE ENVIRONMENT OF A WORKER. One OPAQUE TOKEN, the RUN
 *    TOKEN and a TEMPORARY DIRECTORY, and NO INDEX AND NO COUNT. The
 *    temporary directory lies BESIDE the worker tree in the worker root, is
 *    never part of a snapshot and is removed at group close. Without a
 *    toolchain profile the run record and the `[LOOP]` line say
 *    `worker-caches=shared`. The runtime PROMISES NO PORT.
 *
 *  T033, F143-FR-010 — ONE PROCESS PER WORKER, in a PROCESS GROUP OF ITS OWN,
 *    REGISTERED AS `owned` with pid, start time, run token and worker id, and
 *    AT MOST `workers` AT A TIME.
 *
 *  T034, F143-FR-011 — THE SESSION RULES. Every worker pass is a FRESH
 *    SESSION with a minted id, on the BASE MODEL TIER of the proposer as
 *    resolved at launch, and makes ONE PROPOSAL. No repair, no check, no
 *    escalation and NO YIELD. A yield artifact is refused with an event and
 *    the outcome of that worker is `refused`. No session is continued into a
 *    worker or out of one. AFTER A GROUP HAS BEEN APPLIED the next pass of
 *    the main line is a FRESH SESSION.
 *
 *  T036, F143-FR-013 — RESTART AT MOST ONCE, in its tree, in a fresh session,
 *    and ONLY AFTER AN INTERRUPTION IT DID NOT CAUSE.
 *
 *  T042, F143-FR-022 — THE STALENESS CHECK of a worker pass READS THE FILES
 *    OF THE WORKSPACE AND NOT THOSE OF THE WORKER TREE, and for the task list
 *    compares THE HASH THAT IGNORES CHECKBOXES, so that a tick of the runtime
 *    never makes the run stale.
 *
 * WHY NOTHING HERE STARTS A PROCESS OR READS A FILE. This is a module of the
 * core, and the core may not do either (annex A, §A.3; the graph entry of
 * `@specstride/core` forbids `node:child_process` and `node:fs`, and a static
 * test of task T071 holds it to that). What the engine owns is the DECISION:
 * which environment a worker gets, how many run at once, whether a restart is
 * allowed, what counts as stale. Carrying the decision out — spawning,
 * writing, hashing — is handed in as `GroupExecutorPorts`, and every port is
 * an interface of `@specstride/contracts`, so this file names no
 * implementation of anything (F100-FR-012, F100-FR-018).
 */
import type {
  CanonicalHasher,
  SourceReading,
  StalenessClassification,
} from "@specstride/contracts/ep/hasher";
import type {
  ContainmentLevel,
  SessionDirective,
  StartPassInput,
} from "@specstride/contracts/ep/harness";
import type { ParallelLedgerKind } from "./ledger-kinds.ts";
import type { WorkerEnd } from "./barrier.ts";

/* ------------------------------------------------------------------ *
 * T031 — the workspace part of a worker (F143-FR-008).
 * ------------------------------------------------------------------ */

/** The workspace part (annex B, §B.2); each worker tree gets one of its own. */
export const WORKSPACE_PART = ".specstride" as const;

/** F143-FR-008 — the outbox a worker is given is EMPTY. */
export const THE_OUTBOX_OF_A_WORKER_IS_EMPTY = true as const;

/**
 * F143-FR-008 — what is NEVER COPIED into the workspace part of a worker. A
 * worker is a fresh session on one task; the record of the main line's own
 * work would be context no one asked for and, in the case of its outbox, a
 * checkpoint of another pass that a worker could be read as having written.
 */
export const PATHS_NEVER_COPIED_INTO_A_WORKER = [
  "the phase evidence",
  "the notebook",
  "the outbox of the main line",
] as const;

/** F143-FR-008 — the task list is in EVERY snapshot. */
export const THE_TASK_LIST_IS_IN_EVERY_SNAPSHOT = true as const;

/** F143-FR-008 — and is DROPPED FROM EVERY DELTA. */
export const THE_TASK_LIST_IS_IN_A_DELTA = false as const;

/**
 * F143-FR-008 — the HANDOFF the runtime writes for a worker: the assigned
 * task, the scope and the base fingerprint, and nothing of the main line.
 */
export type WorkerHandoff = {
  readonly schema: "specstride.worker-handoff/1";
  /** The task assigned to this worker (F143-FR-008, F143-FR-011). */
  readonly task: string;
  /** The write scope of the task, as the plan resolved it (annex D, §D.3). */
  readonly scope: readonly string[];
  /** The fingerprint of the base snapshot the tree was made from. */
  readonly baseFingerprint: string;
};

/** The schema id of the handoff. */
export const HANDOFF_SCHEMA = "specstride.worker-handoff/1" as const;

/** The workspace part of one worker, as paths relative to its tree. */
export type WorkerWorkspacePart = {
  /** The empty outbox: a directory, with nothing in it. */
  readonly outbox: string;
  /** The handoff, by path and by content. */
  readonly handoffPath: string;
  readonly handoff: WorkerHandoff;
  /** What is not copied, so that a caller cannot copy it by accident. */
  readonly neverCopied: typeof PATHS_NEVER_COPIED_INTO_A_WORKER;
};

/** One worker as the executor plans it, before anything is started. */
export type PlannedWorker = {
  readonly workerId: string;
  /** The task assigned at launch. */
  readonly task: string;
  /** The write scope of that task. */
  readonly scope: readonly string[];
  /** Its tree, as `materialize` made it. */
  readonly tree: string;
  /** Its temporary directory, beside the tree (F143-FR-009). */
  readonly temporaryDirectory: string;
  /** Its opaque token (F143-FR-009). */
  readonly token: string;
  /** Its position in the order of the tasks at launch, from 1. */
  readonly taskPosition: number;
  /** How many restarts it has used (F143-FR-013). */
  readonly restartsUsed?: number;
};

/** The feature slug, which names the outbox of a phase attempt (annex B, §B.5). */
export function outboxOfAWorker(slug: string): string {
  return `${WORKSPACE_PART}/features/${slug}/outbox`;
}

/** The handoff of a worker, by path inside its tree (annex B, §B.5). */
export function handoffOfAWorker(slug: string): string {
  return `${WORKSPACE_PART}/features/${slug}/handoff.json`;
}

/**
 * F143-FR-008 — THE WORKSPACE PART OF A WORKER: an empty outbox and a
 * handoff that names the assigned task, the scope and the base fingerprint.
 * A pure function: it says what is to be written, and `GroupExecutorPorts`
 * writes it, because the core writes no file.
 */
export function workspacePartOfAWorker(input: {
  readonly worker: PlannedWorker;
  readonly slug: string;
  readonly baseFingerprint: string;
}): WorkerWorkspacePart {
  return Object.freeze({
    outbox: outboxOfAWorker(input.slug),
    handoffPath: handoffOfAWorker(input.slug),
    handoff: Object.freeze({
      schema: HANDOFF_SCHEMA,
      task: input.worker.task,
      scope: Object.freeze([...input.worker.scope]),
      baseFingerprint: input.baseFingerprint,
    }),
    neverCopied: PATHS_NEVER_COPIED_INTO_A_WORKER,
  });
}

/* ------------------------------------------------------------------ *
 * T032 — the environment of a worker (F143-FR-009).
 * ------------------------------------------------------------------ */

/** The variable that carries the OPAQUE TOKEN of a worker (F143-FR-009). */
export const WORKER_TOKEN_VARIABLE = "SPECSTRIDE_WORKER_TOKEN" as const;

/** The variable that carries the RUN TOKEN (F143-FR-009, F143-FR-018). */
export const RUN_TOKEN_VARIABLE = "SPECSTRIDE_RUN_TOKEN" as const;

/** The variable that names the TEMPORARY DIRECTORY of a worker (F143-FR-009). */
export const TEMPORARY_DIRECTORY_VARIABLE = "SPECSTRIDE_WORKER_TMPDIR" as const;

/**
 * F143-FR-009 — THE THREE THINGS THE ENVIRONMENT OF A WORKER HOLDS, and no
 * fourth. The order is the order of the requirement.
 */
export const ENVIRONMENT_OF_A_WORKER = [
  WORKER_TOKEN_VARIABLE,
  RUN_TOKEN_VARIABLE,
  TEMPORARY_DIRECTORY_VARIABLE,
] as const;

/**
 * F143-FR-009 — what the environment of a worker MUST NOT hold: AN INDEX AND
 * A COUNT. A worker that knew it was "worker 2 of 3" could write differently
 * for it, and the whole point of a group is that a worker pass is an ordinary
 * pass on one task (R29v PU-82, PU-97).
 */
export const NO_INDEX_AND_NO_COUNT = ["index", "count", "ordinal", "total", "of"] as const;

/**
 * True where a variable name would tell a worker its index or the size of its
 * group. Read as words, so `WORKER_INDEX`, `workerIndex` and `worker-index`
 * are the same subject.
 */
export function namesAnIndexOrACount(variable: string): boolean {
  const words = variable
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/);
  return (NO_INDEX_AND_NO_COUNT as readonly string[]).some((bad) => words.includes(bad));
}

/** F143-FR-009 — the temporary directory is never part of a snapshot. */
export const THE_TEMPORARY_DIRECTORY_IS_IN_A_SNAPSHOT = false as const;

/** F143-FR-009 — the temporary directory is removed at group close. */
export const THE_TEMPORARY_DIRECTORY_IS_REMOVED_AT = "group close" as const;

/** F143-FR-009 — the runtime promises no port. */
export const THE_RUNTIME_PROMISES_A_PORT = false as const;

/**
 * F143-FR-009 — what the run record and the `[LOOP]` line say for a toolchain
 * WITHOUT a profile, and what the doctor names.
 */
export const WORKER_CACHES_KEY = "worker-caches" as const;
export const WORKER_CACHES_WITHOUT_A_PROFILE = "worker-caches=shared" as const;
export const WORKER_CACHES_VALUES = ["shared", "per-worker"] as const;
export type WorkerCaches = (typeof WORKER_CACHES_VALUES)[number];

/**
 * A toolchain profile MAY give, PER WORKER, the environment that moves a
 * cache which is unsafe for several writers (F143-FR-009). Where it does, the
 * state is `per-worker`; where it does not, it is `shared` and is SAID.
 */
export type ToolchainProfile = {
  readonly toolchain: string;
  /** The variables that move the unsafe cache, per worker. */
  cacheEnvironment(worker: {
    readonly temporaryDirectory: string;
  }): Readonly<Record<string, string>>;
};

/**
 * F143-FR-009 — the state of the caches, and the line the run record and the
 * `[LOOP]` line carry. With no profile the state is `shared` and the line
 * says so; the doctor names it too (task T069).
 */
export function workerCachesState(profile?: ToolchainProfile | undefined): {
  readonly state: WorkerCaches;
  readonly line: string;
  readonly theDoctorNamesIt: boolean;
} {
  if (profile === undefined) {
    return Object.freeze({
      state: "shared" as const,
      line: WORKER_CACHES_WITHOUT_A_PROFILE,
      theDoctorNamesIt: true,
    });
  }
  return Object.freeze({
    state: "per-worker" as const,
    line: `${WORKER_CACHES_KEY}=per-worker`,
    theDoctorNamesIt: false,
  });
}

/**
 * F143-FR-009 — THE ENVIRONMENT OF ONE WORKER: the opaque token, the run
 * token, the temporary directory, and — only where a toolchain profile gives
 * them — the variables that move an unsafe cache. Nothing else: no index, no
 * count, and no port, because the runtime promises none.
 */
export function environmentOfAWorker(input: {
  readonly worker: PlannedWorker;
  readonly runToken: string;
  readonly profile?: ToolchainProfile | undefined;
}): Readonly<Record<string, string>> {
  const fromTheProfile =
    input.profile === undefined
      ? {}
      : input.profile.cacheEnvironment({ temporaryDirectory: input.worker.temporaryDirectory });
  const env: Record<string, string> = {
    [WORKER_TOKEN_VARIABLE]: input.worker.token,
    [RUN_TOKEN_VARIABLE]: input.runToken,
    [TEMPORARY_DIRECTORY_VARIABLE]: input.worker.temporaryDirectory,
    ...fromTheProfile,
  };
  for (const name of Object.keys(env)) {
    if (namesAnIndexOrACount(name)) {
      throw new Error(
        `the environment of a worker holds no index and no count (F143-FR-009): \`${name}\``,
      );
    }
  }
  return Object.freeze(env);
}

/* ------------------------------------------------------------------ *
 * T033 — one process per worker (F143-FR-010).
 * ------------------------------------------------------------------ */

/** F143-FR-010 — there is ONE harness process per worker. */
export const PROCESSES_PER_WORKER = 1 as const;

/** F143-FR-010 — each in a PROCESS GROUP OF ITS OWN. */
export const EACH_IN_A_PROCESS_GROUP_OF_ITS_OWN = true as const;

/** F143-FR-010, F100-FR-063 — a worker process is `owned` and never `adoptable`. */
export const CLASS_OF_A_WORKER_PROCESS = "owned" as const;

/** F100-FR-063 — the kind of a worker process in the registry (annex B, §B.10). */
export const KIND_OF_A_WORKER_PROCESS = "worker-pass" as const;

/**
 * F143-FR-010 — what is registered for a worker process: the class, the pid,
 * the start time, the run token and the worker id. The order is the order of
 * the requirement.
 */
export const REGISTERED_FOR_A_WORKER = [
  "class",
  "pid",
  "startTime",
  "runToken",
  "workerId",
] as const;

/** The entry the process registry is given for one worker (annex B, §B.10). */
export type WorkerRegistration = {
  readonly kind: typeof KIND_OF_A_WORKER_PROCESS;
  readonly class: typeof CLASS_OF_A_WORKER_PROCESS;
  readonly pid: number;
  readonly startTime: string;
  readonly runToken: string;
  readonly workerId: string;
  /** The process group of the worker, which is its own (F143-FR-010). */
  readonly processGroup: number;
};

/**
 * F143-FR-010 — at C2 and above the sandbox DENIES WRITES to the workspace,
 * the trees of its siblings, the control plane and the store. The list is the
 * requirement's, in its order.
 */
export const DENIED_AT_C2_AND_ABOVE = [
  "the workspace",
  "the trees of its siblings",
  "the control plane",
  "the store",
] as const;

/** The containment levels at which the denial list is in force (F143-FR-010). */
export const LEVELS_THAT_DENY: readonly ContainmentLevel[] = Object.freeze(["C2", "C3"]);

/** True where the sandbox denies the writes of `DENIED_AT_C2_AND_ABOVE`. */
export function sandboxDeniesTheWrites(containment: ContainmentLevel): boolean {
  return (LEVELS_THAT_DENY as readonly string[]).includes(containment);
}

/**
 * F143-FR-010 — a worker runs at THE STRONGEST CONTAINMENT ITS HARNESS
 * OFFERS, with its tree as the write root. The ceiling comes from
 * `capabilities().containmentCeiling` of the harness port; the engine takes
 * it and never less.
 */
export function containmentOfAWorker(ceiling: ContainmentLevel): ContainmentLevel {
  return ceiling;
}

/** The write root of a worker is ITS TREE, and no other directory (F143-FR-010). */
export function writeRootOfAWorker(worker: PlannedWorker): string {
  return worker.tree;
}

/**
 * F143-FR-010 — AT MOST `workers` AT A TIME. The slices a group of `n`
 * workers is started in, each at most `workers` long, in the order of the
 * tasks at launch.
 */
export function inSlicesOfAtMost<T>(
  items: readonly T[],
  workers: number,
): readonly (readonly T[])[] {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`\`workers\` is a whole number of 1 or more (F143-FR-010): ${String(workers)}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += workers) out.push(items.slice(i, i + workers));
  return Object.freeze(out.map((slice) => Object.freeze(slice)));
}

/* ------------------------------------------------------------------ *
 * T034 — the session rules of a worker pass (F143-FR-011).
 * ------------------------------------------------------------------ */

/** F143-FR-011 — every worker pass is a FRESH SESSION with a minted id. */
export const SESSION_OF_A_WORKER_PASS = "fresh" as const;

/** F143-FR-011 — no session is continued into a worker or out of one. */
export const A_SESSION_IS_CONTINUED_INTO_A_WORKER = false as const;
export const A_SESSION_IS_CONTINUED_OUT_OF_A_WORKER = false as const;

/** F143-FR-011 — a worker pass makes ONE PROPOSAL: one pass, one checkpoint. */
export const PROPOSALS_PER_WORKER_PASS = 1 as const;

/**
 * F143-FR-011 — what does NOT take place in a worker. Each would be a second
 * decision inside a pass that is meant to make exactly one.
 */
export const NEVER_IN_A_WORKER = ["repair", "check", "escalation", "yield"] as const;

/** F143-FR-011 — the model tier of a worker pass: the proposer's BASE tier. */
export const MODEL_TIER_OF_A_WORKER_PASS = "base" as const;

/** F143-FR-011 — the tier is the one RESOLVED AT LAUNCH, and never re-resolved. */
export const THE_TIER_IS_RESOLVED_AT = "launch" as const;

/** F143-FR-011 — the session directive of a worker pass, with its minted id. */
export function sessionOfAWorkerPass(mintedSessionId: string): SessionDirective {
  return Object.freeze({ kind: "fresh" as const, sessionId: mintedSessionId });
}

/**
 * F143-FR-011 — the model tier a worker pass runs on: the base tier of the
 * proposer AS RESOLVED AT LAUNCH. An escalated tier of the main line is not
 * carried into a worker, because no escalation takes place in one.
 */
export function modelTierOfAWorkerPass(resolvedAtLaunch: {
  readonly baseTier: string;
  readonly tierNow?: string;
}): string {
  return resolvedAtLaunch.baseTier;
}

/** F143-FR-011 — a yield artifact in the outbox of a worker is REFUSED. */
export const YIELD_ARTIFACT_IS_REFUSED = true as const;

/** The event kind raised when a worker writes a yield artifact (F143-FR-011). */
export const YIELD_REFUSED_EVENT = "worker-yield-refused" as const;

/**
 * F143-FR-011 — the refusal of a yield artifact: an event, and the outcome of
 * that worker is `refused` (R29 PU-36). The outcome itself is derived by
 * `outcomeOfWorker` of the barrier from the same fact, so the two cannot
 * disagree.
 */
export function refuseAYieldArtifact(workerId: string): {
  readonly event: { readonly kind: typeof YIELD_REFUSED_EVENT; readonly workerId: string };
  readonly outcome: "refused";
} {
  return Object.freeze({
    event: Object.freeze({ kind: YIELD_REFUSED_EVENT, workerId }),
    outcome: "refused" as const,
  });
}

/**
 * F143-FR-011 — AFTER A GROUP HAS BEEN APPLIED the next pass of the main line
 * is a FRESH SESSION. The reason is plain: the workspace the main line's
 * session last saw is not the workspace now, because the application changed
 * paths under it, and a continued session would carry a picture that is no
 * longer true.
 */
export function sessionOfTheNextMainLinePass(group: {
  readonly applied: boolean;
}): "fresh" | "continue" {
  return group.applied ? "fresh" : "continue";
}

/**
 * F143-FR-011 — the session state of a worker lives under the phase attempt,
 * PER WORKER, and is removed when the group closes.
 */
export function sessionStateOfAWorker(input: {
  readonly slug: string;
  readonly attempt: string;
  readonly workerId: string;
}): string {
  return `${WORKSPACE_PART}/features/${input.slug}/attempts/${input.attempt}/workers/${input.workerId}/session`;
}
export const SESSION_STATE_OF_A_WORKER_IS_REMOVED_AT = "group close" as const;

/**
 * F143-FR-011 — the critic-diversity rule and its warning are evaluated over
 * the models of ALL PASSES OF THE PHASE ATTEMPT, WORKER PASSES INCLUDED.
 */
export function modelsForTheCriticDiversityRule(input: {
  readonly mainLinePasses: readonly { readonly model: string }[];
  readonly workerPasses: readonly { readonly model: string }[];
}): readonly string[] {
  return Object.freeze([
    ...input.mainLinePasses.map((p) => p.model),
    ...input.workerPasses.map((p) => p.model),
  ]);
}

/* ------------------------------------------------------------------ *
 * T036 — restart once (F143-FR-013).
 * ------------------------------------------------------------------ */

/** F143-FR-013 — a worker is restarted AT MOST ONCE. */
export const MAX_RESTARTS_PER_WORKER = 1 as const;

/**
 * F143-FR-013 — the interruptions A WORKER DID NOT CAUSE, and the only ones
 * after which a restart is allowed. The list is the requirement's.
 */
export const INTERRUPTIONS_A_WORKER_DID_NOT_CAUSE = [
  "a crash of the engine",
  "a relaunch",
  "a quota pause",
] as const;
export type InterruptionNotItsOwn = (typeof INTERRUPTIONS_A_WORKER_DID_NOT_CAUSE)[number];

/**
 * The ends a worker DID cause, after which no restart is allowed: it ended of
 * its own accord, or its harness failed. Restarting either would be the
 * engine giving a worker a second proposal, which F143-FR-011 forbids.
 */
export const ENDS_A_WORKER_CAUSED: readonly WorkerEnd[] = Object.freeze(["ended", "harness-error"]);

/** Why a restart was refused, where it was. */
export const RESTART_REFUSALS = [
  "the restart was already used",
  "the interruption was the worker's own",
] as const;
export type RestartRefusal = (typeof RESTART_REFUSALS)[number];

/**
 * F143-FR-013 — MAY THIS WORKER BE RESTARTED? Only where it has used no
 * restart yet AND the interruption was one of `INTERRUPTIONS_A_WORKER_DID_NOT_CAUSE`.
 * The restart happens IN ITS TREE and IN A FRESH SESSION, which is what the
 * result says so that no caller has to remember it.
 */
export function mayRestart(input: {
  readonly worker: PlannedWorker;
  readonly interruption: InterruptionNotItsOwn | WorkerEnd;
}):
  | {
      readonly restart: true;
      readonly inItsTree: string;
      readonly session: "fresh";
      readonly restartIndex: number;
    }
  | { readonly restart: false; readonly because: RestartRefusal } {
  const used = input.worker.restartsUsed ?? 0;
  if (used >= MAX_RESTARTS_PER_WORKER) {
    return Object.freeze({ restart: false as const, because: RESTART_REFUSALS[0] });
  }
  if (!(INTERRUPTIONS_A_WORKER_DID_NOT_CAUSE as readonly string[]).includes(input.interruption)) {
    return Object.freeze({ restart: false as const, because: RESTART_REFUSALS[1] });
  }
  return Object.freeze({
    restart: true as const,
    inItsTree: input.worker.tree,
    session: "fresh" as const,
    restartIndex: used + 1,
  });
}

/**
 * The pass ordinal of a worker pass: the group ordinal, the position of the
 * task, and the restart index (data-model.md, the entity `Worker`).
 */
export function passOrdinalOf(input: {
  readonly groupOrdinal: number;
  readonly taskPosition: number;
  readonly restartIndex: number;
}): readonly [number, number, number] {
  return Object.freeze([input.groupOrdinal, input.taskPosition, input.restartIndex] as const);
}

/* ------------------------------------------------------------------ *
 * T042 — staleness (F143-FR-022).
 * ------------------------------------------------------------------ */

/**
 * F143-FR-022 — THE STALENESS CHECK OF A WORKER PASS READS THE FILES OF THE
 * WORKSPACE, and not those of the worker tree. Stated as a value, because it
 * is the whole of the requirement's first sentence and the one thing a caller
 * could get wrong by handing in the tree.
 */
export const STALENESS_READS = "the files of the workspace" as const;
export const STALENESS_READS_THE_WORKER_TREE = false as const;

/**
 * F143-FR-022 — for the TASK LIST the check compares THE HASH THAT IGNORES
 * CHECKBOXES, so that a tick of the runtime never makes the run stale (ruling
 * K3: a tick is the runtime's own write, and a run that went stale from its
 * own write could never close a phase).
 */
export const THE_TASK_LIST_IS_COMPARED_WITH = "the hash that ignores checkboxes" as const;

/** The directory the staleness check of a worker pass reads (F143-FR-022). */
export function directoryTheStalenessCheckReads(input: {
  readonly workspace: string;
  readonly workerTree: string;
}): string {
  return input.workspace;
}

/**
 * One recorded source of the run, as the group executor holds it before the
 * files are read. `isTheTaskList` is what decides which of the two hashes the
 * reading carries.
 */
export type RecordedSource = {
  readonly logicalName: string;
  /** The path relative to the workspace. Never relative to a worker tree. */
  readonly repositoryPath: string;
  readonly recordedHash: string;
  /** The recorded hash that ignores checkboxes, for a task list. */
  readonly recordedHashIgnoringCheckboxes?: string | undefined;
  /** True where this source is the task list (F143-FR-022). */
  readonly isTheTaskList?: boolean;
};

/**
 * What reading a file of the workspace gives. `bytes` is `undefined` where
 * the file cannot be read, which the hasher reads as `unreadable`.
 */
export type WorkspaceFileReader = (repositoryPath: string) => string | undefined;

/**
 * F143-FR-022 — THE READINGS of the staleness check of a worker pass: one per
 * recorded source, hashed from THE FILES OF THE WORKSPACE. For the task list
 * the reading carries BOTH hashes, the plain one and the one that ignores
 * checkboxes, so that `classifyStaleness` of the hasher can tell `ticks-only`
 * from `changed`.
 *
 * `read` is given the path RELATIVE TO THE WORKSPACE and is built by the
 * caller over the workspace directory; `directoryTheStalenessCheckReads`
 * names which directory that is, and it is never the worker tree.
 */
export function readingsOfAWorkerPass(input: {
  readonly hasher: CanonicalHasher;
  readonly sources: readonly RecordedSource[];
  readonly read: WorkspaceFileReader;
}): readonly SourceReading[] {
  return Object.freeze(
    input.sources.map((source) => {
      const text = input.read(source.repositoryPath);
      if (text === undefined) {
        return Object.freeze({
          logicalName: source.logicalName,
          repositoryPath: source.repositoryPath,
          recordedHash: source.recordedHash,
          ...(source.recordedHashIgnoringCheckboxes === undefined
            ? {}
            : { recordedHashIgnoringCheckboxes: source.recordedHashIgnoringCheckboxes }),
          hashNow: undefined,
        });
      }
      const hashNow = input.hasher.contentHash(text);
      if (source.isTheTaskList !== true) {
        return Object.freeze({
          logicalName: source.logicalName,
          repositoryPath: source.repositoryPath,
          recordedHash: source.recordedHash,
          hashNow,
        });
      }
      // F143-FR-022 — the task list is compared with the hash that ignores
      // checkboxes, so a tick of the runtime is `ticks-only` and not `changed`.
      return Object.freeze({
        logicalName: source.logicalName,
        repositoryPath: source.repositoryPath,
        recordedHash: source.recordedHash,
        ...(source.recordedHashIgnoringCheckboxes === undefined
          ? {}
          : { recordedHashIgnoringCheckboxes: source.recordedHashIgnoringCheckboxes }),
        hashNow,
        hashNowIgnoringCheckboxes: input.hasher.taskListHashIgnoringCheckboxes(text),
      });
    }),
  );
}

/**
 * F143-FR-022 — THE STALENESS OF A WORKER PASS. The readings are taken from
 * the workspace (`readingsOfAWorkerPass`) and classified by the one hasher
 * (`classifyStaleness`, which reads no file). A tick of the runtime leaves
 * the task list `ticks-only` and the verdict `fresh`.
 */
export function stalenessOfAWorkerPass(input: {
  readonly hasher: CanonicalHasher;
  readonly sources: readonly RecordedSource[];
  readonly workspace: string;
  readonly workerTree: string;
  readonly read: WorkspaceFileReader;
}): StalenessClassification & { readonly readFrom: string } {
  const readFrom = directoryTheStalenessCheckReads({
    workspace: input.workspace,
    workerTree: input.workerTree,
  });
  const classification = input.hasher.classifyStaleness(
    readingsOfAWorkerPass({ hasher: input.hasher, sources: input.sources, read: input.read }),
  );
  return Object.freeze({ ...classification, readFrom });
}

/* ------------------------------------------------------------------ *
 * The ports, and starting a group.
 * ------------------------------------------------------------------ */

/**
 * What the group executor is handed. Every member is an operation the core
 * may not perform itself: it starts no process, writes no file and hashes
 * nothing of its own (annex A, §A.3).
 */
export type GroupExecutorPorts = {
  /** Write the workspace part of one worker into its tree (F143-FR-008). */
  writeWorkspacePart(worker: PlannedWorker, part: WorkerWorkspacePart): Promise<void>;
  /**
   * Start one harness process, in a process group of its own, with the
   * environment handed in (F143-FR-010). `specstride.harness/1`, `startPass`.
   */
  startPass(
    input: StartPassInput & { readonly environment: Readonly<Record<string, string>> },
  ): Promise<{
    readonly pid: number;
    readonly startTime: string;
    readonly processGroup: number;
    readonly sessionId: string;
  }>;
  /** Register the process in the process registry with the class `owned`. */
  register(entry: WorkerRegistration): Promise<void>;
  /** Write one record of the parallel namespace, through the one writer. */
  record(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): Promise<void>;
};

/** One worker that was started. */
export type StartedWorker = {
  readonly workerId: string;
  readonly pid: number;
  readonly startTime: string;
  readonly processGroup: number;
  readonly sessionId: string;
  readonly registration: WorkerRegistration;
  readonly environment: Readonly<Record<string, string>>;
  readonly passOrdinal: readonly [number, number, number];
};

/**
 * F143-FR-008 to F143-FR-011 — START THE WORKERS OF A GROUP: at most
 * `workers` at a time, each with its own workspace part, its own environment,
 * one process in a process group of its own, registered as `owned`, in a
 * fresh session on the base model tier, at the strongest containment its
 * harness offers with its tree as the write root.
 */
export async function startWorkers(
  ports: GroupExecutorPorts,
  input: {
    readonly workers: readonly PlannedWorker[];
    readonly groupOrdinal: number;
    readonly slug: string;
    readonly attempt: string;
    readonly baseFingerprint: string;
    readonly runToken: string;
    readonly workersAtATime: number;
    readonly containmentCeiling: ContainmentLevel;
    readonly proposer: { readonly model: string; readonly baseTier: string };
    readonly promptReference: string;
    readonly timeLimitMs: number;
    readonly transport: StartPassInput["transport"];
    readonly mintSessionId: (worker: PlannedWorker) => string;
    readonly profile?: ToolchainProfile | undefined;
    readonly processSpendingLimit?: number | undefined;
  },
): Promise<readonly StartedWorker[]> {
  const started: StartedWorker[] = [];
  // F143-FR-010 — AT MOST `workers` AT A TIME, in the order of the tasks.
  for (const slice of inSlicesOfAtMost(input.workers, input.workersAtATime)) {
    for (const worker of slice) {
      // T031 — its own workspace part: an empty outbox and a handoff.
      const part = workspacePartOfAWorker({
        worker,
        slug: input.slug,
        baseFingerprint: input.baseFingerprint,
      });
      await ports.writeWorkspacePart(worker, part);

      // T032 — the environment: three things, and no index and no count.
      const environment = environmentOfAWorker({
        worker,
        runToken: input.runToken,
        profile: input.profile,
      });

      // T033, T034 — one process, in a group of its own, fresh session, base
      // tier, its tree as the write root, the strongest containment offered.
      const handle = await ports.startPass({
        promptReference: input.promptReference,
        workingDirectory: worker.tree,
        session: sessionOfAWorkerPass(input.mintSessionId(worker)),
        model: input.proposer.model,
        modelTierOrEffort: modelTierOfAWorkerPass(input.proposer),
        containment: containmentOfAWorker(input.containmentCeiling),
        writeRoot: writeRootOfAWorker(worker),
        environmentAllowList: Object.keys(environment),
        timeLimitMs: input.timeLimitMs,
        transport: input.transport,
        ...(input.processSpendingLimit === undefined
          ? {}
          : { processSpendingLimit: input.processSpendingLimit }),
        environment,
      });

      const registration: WorkerRegistration = Object.freeze({
        kind: KIND_OF_A_WORKER_PROCESS,
        class: CLASS_OF_A_WORKER_PROCESS,
        pid: handle.pid,
        startTime: handle.startTime,
        runToken: input.runToken,
        workerId: worker.workerId,
        processGroup: handle.processGroup,
      });
      await ports.register(registration);

      const passOrdinal = passOrdinalOf({
        groupOrdinal: input.groupOrdinal,
        taskPosition: worker.taskPosition,
        restartIndex: worker.restartsUsed ?? 0,
      });
      await ports.record("worker_started", {
        workerId: worker.workerId,
        task: worker.task,
        passId: handle.sessionId,
        passOrdinal: [...passOrdinal],
        fingerprint: input.baseFingerprint,
        pid: handle.pid,
        startTime: handle.startTime,
      });

      started.push(
        Object.freeze({
          workerId: worker.workerId,
          pid: handle.pid,
          startTime: handle.startTime,
          processGroup: handle.processGroup,
          sessionId: handle.sessionId,
          registration,
          environment,
          passOrdinal,
        }),
      );
    }
  }
  return Object.freeze(started);
}

/* ================================================================== *
 * T060 — F143-FR-015: THE GROUP PAUSE (R29 PU-38; R14; ruling 27, 28).
 * ================================================================== */

/**
 * F143-FR-015 — A PAUSE PAUSES THE GROUP, and the requirement is a list of
 * seven things that all happen on ONE quota signal from ANY worker:
 *
 *   1  no further worker starts
 *   2  every live worker of the group gets the POLITE STOP
 *   3  their passes close with THE CAUSE OF THE PAUSE
 *   4  their TREES ARE KEPT
 *   5  ONE pause record is written
 *   6  ONE pause event is emitted
 *   7  the pause spends NO CYCLE, NO RESTART, NO TIME CAP AND NO BUDGET
 *
 * "One" in 5 and 6 is the whole of F143-SC-003 ("a quota signal in a group
 * gives exactly 1 pause event") and is why `pauseTheGroup` is idempotent: a
 * second signal from a sibling, which is the ordinary case because siblings
 * share a quota, finds the group already paused and writes nothing. The count
 * is therefore a property of the function and not of the caller's care.
 *
 * WHY THE PAUSE RECORD IS NOT ONE OF THE THIRTEEN KINDS. The closed set of
 * thirteen; the record set of a GROUP'S PROGRESS is the parallel one (F143-FR-023); a pause is
 * a state of the RUN, and R29 PU-38 names its record `pause.record` and its
 * event `run.paused`. They go through ports of their own, so a pause can never
 * be mistaken for a step of the group having happened.
 */

/** R29 PU-38 — the cause a paused pass closes with. */
export const QUOTA_PAUSE_CAUSE = "quota_pause" as const;

/** R29 PU-38 — the one record, by its logical name. */
export const PAUSE_RECORD = "pause.record" as const;

/** R29 PU-38 — the one event. */
export const PAUSE_EVENT = "run.paused" as const;

/** R29 PU-38, ruling 28 — the event that lets each unfinished worker start again. */
export const RESUME_EVENT = "run.resumed" as const;

/** F143-SC-003 — exactly one of each, however many workers signal. */
export const PAUSE_RECORDS_PER_PAUSE = 1 as const;
export const PAUSE_EVENTS_PER_PAUSE = 1 as const;

/** F143-FR-015 — the four things a pause spends, and it spends none of them. */
export const THE_PAUSE_SPENDS: readonly string[] = Object.freeze([]);
export const THINGS_A_PAUSE_DOES_NOT_SPEND = [
  "a cycle",
  "a restart of a worker",
  "a time cap",
  "a budget",
] as const;

/** F143-FR-015 — the trees of the paused workers are KEPT. */
export const A_PAUSE_KEEPS_THE_TREES = true as const;

/** F143-FR-015 — and no further worker starts. */
export const NO_FURTHER_WORKER_STARTS_AFTER_A_PAUSE = true as const;

/** The classification of EP-12 that pauses a group (R14, R29 PU-38). */
export const CLASSIFICATION_THAT_PAUSES = "quota_window" as const;

/** The signal one worker's stream carried. */
export type QuotaSignal = {
  /** The worker whose stream carried it. */
  readonly workerId: string;
  /** The classification EP-12 gave the stream (R14's confidence rules). */
  readonly classification: string;
  /** The line of the stream, for the record. */
  readonly evidence?: string;
};

/** What the pause is handed. Each member is something the core may not do. */
export type PausePorts = {
  /** The POLITE STOP to one live worker. True where it was delivered. */
  politeStop(worker: {
    readonly workerId: string;
    readonly pid: number;
    readonly processGroup: number;
  }): Promise<boolean>;
  /** Write the one pause record (R29 PU-38, `pause.record`). */
  pauseRecord(record: Readonly<Record<string, unknown>>): Promise<void>;
  /** Emit the one pause event (R29 PU-38, `run.paused`). */
  emitEvent(event: Readonly<Record<string, unknown>>): Promise<void>;
};

/** One live worker of the group, as the pause sees it. */
export type LiveWorker = {
  readonly workerId: string;
  readonly pid: number;
  readonly processGroup: number;
  /** The tree it works in; the pause keeps it. */
  readonly tree: string;
};

/** What one pause did. */
export type GroupPause = {
  /** True where this call is the one that paused the group. */
  readonly paused: boolean;
  /** The classification that caused it, where it was caused. */
  readonly because?: string;
  /** The worker whose stream carried the signal. */
  readonly signalledBy?: string;
  /** The workers that got the polite stop. */
  readonly politelyStopped: readonly string[];
  /** The cause their passes closed with. */
  readonly passesClosedWith: typeof QUOTA_PAUSE_CAUSE;
  /** The trees that were KEPT (F143-FR-015). */
  readonly treesKept: readonly string[];
  /** How many pause records this call wrote: one, or none on a repeat. */
  readonly recordsWritten: number;
  /** How many pause events it emitted: one, or none on a repeat. */
  readonly eventsEmitted: number;
  /** F143-FR-015 — what the pause spent. Empty, always. */
  readonly spent: readonly string[];
  /** F143-FR-015 — no further worker starts. */
  readonly furtherWorkersStart: false;
};

/**
 * THE STATE OF ONE GROUP'S PAUSE. A pause must be counted once per group, and
 * the signals that cause it arrive from several workers at once, so the count
 * cannot live in a caller's local variable. `theGroupPause()` returns the one
 * object that holds it, and `pauseTheGroup` is a method of it.
 */
export type GroupPauseState = {
  /** True once the group is paused. */
  paused(): boolean;
  /** F143-FR-015 — the first signal pauses; every later one changes nothing. */
  pauseTheGroup(
    ports: PausePorts,
    input: {
      readonly signal: QuotaSignal;
      readonly groupId: string;
      readonly liveWorkers: readonly LiveWorker[];
    },
  ): Promise<GroupPause>;
  /** How many pause records were written for this group, in total. */
  records(): number;
  /** How many pause events were emitted for this group, in total. */
  events(): number;
  /**
   * F143-FR-015, ruling 28 — on resume, and on `resume` after a reboot, EACH
   * UNFINISHED WORKER GETS A NEW PASS IN ITS TREE.
   */
  resumeAfterThePause(input: {
    readonly workers: readonly PlannedWorker[];
    readonly finished: readonly string[];
  }): readonly {
    readonly workerId: string;
    readonly inItsTree: string;
    readonly session: "fresh";
  }[];
};

/** F143-FR-015 — the pause of one group, with its count. */
export function theGroupPause(): GroupPauseState {
  let paused = false;
  let records = 0;
  let events = 0;

  return Object.freeze({
    paused: () => paused,
    records: () => records,
    events: () => events,

    async pauseTheGroup(ports, input): Promise<GroupPause> {
      const treesKept = Object.freeze(input.liveWorkers.map((w) => w.tree));
      if (paused) {
        // A sibling's signal. The group is already paused: NOTHING is written,
        // which is what makes the count exactly one (F143-SC-003).
        return Object.freeze({
          paused: false,
          politelyStopped: Object.freeze([]),
          passesClosedWith: QUOTA_PAUSE_CAUSE,
          treesKept,
          recordsWritten: 0,
          eventsEmitted: 0,
          spent: THE_PAUSE_SPENDS,
          furtherWorkersStart: false as const,
        });
      }
      paused = true;

      // 2 — the POLITE STOP to every live worker of the group.
      const politelyStopped: string[] = [];
      for (const worker of input.liveWorkers) {
        const delivered = await ports.politeStop({
          workerId: worker.workerId,
          pid: worker.pid,
          processGroup: worker.processGroup,
        });
        if (delivered) politelyStopped.push(worker.workerId);
      }

      // 5 — THE ONE PAUSE RECORD.
      records += 1;
      await ports.pauseRecord({
        record: PAUSE_RECORD,
        groupId: input.groupId,
        cause: QUOTA_PAUSE_CAUSE,
        classification: input.signal.classification,
        signalledBy: input.signal.workerId,
        workers: input.liveWorkers.map((w) => w.workerId),
        treesKept: [...treesKept],
        spent: [...THE_PAUSE_SPENDS],
        ...(input.signal.evidence === undefined ? {} : { evidence: input.signal.evidence }),
      });

      // 6 — THE ONE PAUSE EVENT.
      events += 1;
      await ports.emitEvent({
        event: PAUSE_EVENT,
        groupId: input.groupId,
        cause: QUOTA_PAUSE_CAUSE,
        signalledBy: input.signal.workerId,
      });

      return Object.freeze({
        paused: true,
        because: input.signal.classification,
        signalledBy: input.signal.workerId,
        politelyStopped: Object.freeze(politelyStopped),
        passesClosedWith: QUOTA_PAUSE_CAUSE,
        treesKept,
        recordsWritten: 1,
        eventsEmitted: 1,
        spent: THE_PAUSE_SPENDS,
        furtherWorkersStart: false as const,
      });
    },

    resumeAfterThePause(input) {
      const finished = new Set(input.finished);
      return Object.freeze(
        input.workers
          .filter((worker) => !finished.has(worker.workerId))
          .map((worker) =>
            Object.freeze({
              workerId: worker.workerId,
              // IN ITS TREE: the pause kept it, so the new pass has somewhere
              // to go and the work already done is not thrown away.
              inItsTree: worker.tree,
              session: "fresh" as const,
            }),
          ),
      );
    },
  });
}

/* ================================================================== *
 * T061 — F143-FR-016: THE SPENDING LIMIT UNDER A HARD CAP (R29v PU-88).
 * ================================================================== */

/**
 * F143-FR-016 — three clauses, and all three are here:
 *
 *  (a) UNDER A HARD CAP each worker pass starts with a PROCESS-LEVEL SPENDING
 *      LIMIT of the remaining budget of the role DIVIDED BY THE TASKS OF THE
 *      GROUP, where the harness adapter declares that capability.
 *  (b) WHERE IT DOES NOT, the engine SAYS SO IN THE VIEW OF THE PHASE ATTEMPT,
 *      so that the loop layer can hold a group to the stricter budget
 *      condition of its admission (clarification: the view carries the
 *      capabilities of the harness port read at launch).
 *  (c) THE CAP IS EVALUATED ON THE SUM OVER LIVE WORKERS AT EVERY USAGE
 *      RECORD, and crossing it ENDS EVERY WORKER OF THE GROUP.
 *
 * (c) is the clause a reader is most likely to get wrong, so it is a function
 * of its own: the cap is NOT per worker. A group of four workers each under a
 * quarter of the budget can still cross the cap together — that is the point
 * of summing — and when it does, every worker of the group ends, not the one
 * whose usage record happened to arrive last.
 */

/** The capability of the harness port that carries the limit (annex C, §C.1). */
export const SPEND_LIMIT_CAPABILITY = "spendLimit" as const;

/** F143-FR-016 — what the cap is evaluated on. Not one worker: the sum. */
export const THE_CAP_IS_EVALUATED_ON = "the sum over live workers" as const;

/** F143-FR-016 — and at which moment. */
export const THE_CAP_IS_EVALUATED_AT = "every usage record" as const;

/** F143-FR-016 — what crossing it does. */
export const CROSSING_THE_CAP_ENDS = "every worker of the group" as const;

/** Where the engine says that the adapter declares no limit (clarification). */
export const DECLARED_IN = "the view of the phase attempt" as const;

/**
 * F143-FR-016 (a) — the process-level spending limit of ONE worker pass: the
 * remaining budget of the role divided by the tasks of the group. A group with
 * no task gets no limit rather than a division by nought.
 */
export function processSpendingLimitOfAWorkerPass(input: {
  readonly remainingRoleBudget: number;
  readonly tasksOfTheGroup: number;
}): number | undefined {
  if (!Number.isFinite(input.remainingRoleBudget) || input.remainingRoleBudget < 0)
    return undefined;
  if (!Number.isInteger(input.tasksOfTheGroup) || input.tasksOfTheGroup <= 0) return undefined;
  return input.remainingRoleBudget / input.tasksOfTheGroup;
}

/** What the view of the phase attempt says about the limit (F143-FR-016 (b)). */
export type SpendingLimitInTheView = {
  /** True where the adapter declares the capability `spendLimit`. */
  readonly declared: boolean;
  /** The limit each worker pass starts with, where there is one. */
  readonly perWorkerPass?: number;
  /** Where the adapter declares none, the sentence the view carries. */
  readonly note?: string;
  /** The capability the view read at launch. */
  readonly capability: typeof SPEND_LIMIT_CAPABILITY;
  /** Where it is said. */
  readonly saidIn: typeof DECLARED_IN;
};

/**
 * F143-FR-016 (a) and (b) — THE LIMIT TO PASS, AND WHAT THE VIEW SAYS. One
 * function, because the two are one decision: either the adapter takes the
 * limit and every pass starts with it, or it does not and the view must say
 * so, and there is no third case in which the engine quietly passes nothing.
 */
export function spendingLimitForTheGroup(input: {
  /** True under a hard cap; without one there is no limit to divide. */
  readonly hardCap: boolean;
  readonly remainingRoleBudget: number;
  readonly tasksOfTheGroup: number;
  /** The capabilities the harness port declared at launch (annex C, §C.1). */
  readonly declaresSpendLimit: boolean;
}): SpendingLimitInTheView {
  if (!input.declaresSpendLimit) {
    return Object.freeze({
      declared: false,
      note: `the harness adapter declares no process-level spending limit (\`${SPEND_LIMIT_CAPABILITY}\`); hold the group to the stricter budget condition of its admission`,
      capability: SPEND_LIMIT_CAPABILITY,
      saidIn: DECLARED_IN,
    });
  }
  const limit = input.hardCap
    ? processSpendingLimitOfAWorkerPass({
        remainingRoleBudget: input.remainingRoleBudget,
        tasksOfTheGroup: input.tasksOfTheGroup,
      })
    : undefined;
  return Object.freeze({
    declared: true,
    ...(limit === undefined ? {} : { perWorkerPass: limit }),
    capability: SPEND_LIMIT_CAPABILITY,
    saidIn: DECLARED_IN,
  });
}

/** One usage record of one worker, as the cap reads it. */
export type UsageRecord = {
  readonly workerId: string;
  /** What that worker has spent so far, in the unit of the budget. */
  readonly spent: number;
};

/** What the evaluation of the cap came to. */
export type CapEvaluation = {
  /** The sum over LIVE workers, which is what the cap is evaluated on. */
  readonly sumOverLiveWorkers: number;
  /** The workers whose usage was counted. */
  readonly liveWorkers: readonly string[];
  /** The cap itself. */
  readonly cap: number;
  /** True where the sum crossed it. */
  readonly crossed: boolean;
  /** F143-FR-016 — the workers to end: every worker of the group, or none. */
  readonly endTheseWorkers: readonly string[];
  readonly evaluatedOn: typeof THE_CAP_IS_EVALUATED_ON;
  readonly evaluatedAt: typeof THE_CAP_IS_EVALUATED_AT;
};

/**
 * F143-FR-016 (c) — EVALUATE THE CAP ON THE SUM OVER LIVE WORKERS. Called at
 * EVERY usage record. A worker that has ended is not live and its usage is not
 * summed; `endTheseWorkers` is every worker of the group when the cap is
 * crossed, and the empty list when it is not.
 */
export function evaluateTheCap(input: {
  readonly cap: number;
  /** The latest usage of every worker, live and ended. */
  readonly usage: readonly UsageRecord[];
  /** The workers still live at this moment. */
  readonly liveWorkers: readonly string[];
  /** Every worker of the group, which is what crossing the cap ends. */
  readonly workersOfTheGroup: readonly string[];
}): CapEvaluation {
  const live = new Set(input.liveWorkers);
  const counted = input.usage.filter((record) => live.has(record.workerId));
  const sum = counted.reduce((total, record) => total + record.spent, 0);
  const crossed = sum > input.cap;
  return Object.freeze({
    sumOverLiveWorkers: sum,
    liveWorkers: Object.freeze(counted.map((record) => record.workerId)),
    cap: input.cap,
    crossed,
    endTheseWorkers: Object.freeze(crossed ? [...input.workersOfTheGroup] : []),
    evaluatedOn: THE_CAP_IS_EVALUATED_ON,
    evaluatedAt: THE_CAP_IS_EVALUATED_AT,
  });
}

/* ================================================================== *
 * T066 — F143-FR-026: STOP WITH A GROUP LIVE (R29v PU-93).
 * ================================================================== */

/**
 * F143-FR-026 — TWO STOPS, AND THEY ARE NOT THE SAME STOP:
 *
 *  AN ORDINARY `stop` with a group live LETS THE GROUP CLOSE. No further
 *  worker starts; live workers run to the end of their pass; integration and
 *  the merge check run THROUGH `group_closed`; and the stop takes effect
 *  THEN. The reason is the one thing the whole feature is built around: a
 *  group that is interrupted between `apply_started` and `applied` leaves a
 *  half-written workspace, and stopping is not worth that. So the stop WAITS
 *  for the one record that says nothing of the group is open.
 *
 *  `stop --now`, A STOP BY A BUDGET and A TIME CAP OF THE RUN do not wait.
 *  They END THE WORKERS AFTER THE IDENTITY CHECK and leave the group to the
 *  resume states of F143-FR-025 — which is safe precisely because those
 *  states exist, and is why this requirement can afford to have a fast path
 *  at all.
 */

/** F143-FR-026 — the record after which an ordinary `stop` takes effect. */
export const STOP_TAKES_EFFECT_AFTER: ParallelLedgerKind = "group_closed";

/** F143-FR-026 — the stops that do NOT wait for it. */
export const STOPS_THAT_END_THE_WORKERS = ["now", "budget", "run-time-cap"] as const;
export type StopThatEndsTheWorkers = (typeof STOPS_THAT_END_THE_WORKERS)[number];

/** F143-FR-026 — the stop that does wait. */
export const STOPS_THAT_LET_THE_GROUP_CLOSE = ["ordinary"] as const;

/** Every kind of stop request this requirement knows. */
export const STOP_KINDS = ["ordinary", ...STOPS_THAT_END_THE_WORKERS] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** F143-FR-026 — no further worker starts, whichever stop it is. */
export const NO_FURTHER_WORKER_STARTS_AFTER_A_STOP = true as const;

/** R11 T-26 — the identity check comes before the workers are ended. */
export const THE_IDENTITY_CHECK_COMES_BEFORE_ENDING_THE_WORKERS = true as const;

/** F143-FR-026 — what the fast stops leave the group to. */
export const THE_FAST_STOPS_LEAVE_THE_GROUP_TO = "the resume states of F143-FR-025" as const;

/** What an ordinary stop must let run, in order, before it takes effect. */
export const AN_ORDINARY_STOP_LETS_THESE_RUN: readonly ParallelLedgerKind[] = Object.freeze([
  "group_barrier",
  "audit_done",
  "merge_done",
  "apply_started",
  "applied",
  "ticks_applied",
  "merge_check_started",
  "merge_check_finished",
  "group_closed",
]);

/** What the engine decided about a stop request read with a group live. */
export type StopDecision = {
  readonly kind: StopKind;
  /** F143-FR-026 — always false: no further worker starts. */
  readonly startFurtherWorkers: false;
  /** True where live workers run to the end of their pass. */
  readonly liveWorkersRunToTheEndOfTheirPass: boolean;
  /** True where integration and the merge check run through `group_closed`. */
  readonly integrationRunsThrough: boolean;
  /** The record the stop takes effect after, where it waits for one. */
  readonly takesEffectAfter?: ParallelLedgerKind;
  /** True where the workers are ended now, after the identity check. */
  readonly endTheWorkersNow: boolean;
  /** Where the workers are ended, the states the group is left to. */
  readonly leavesTheGroupTo?: typeof THE_FAST_STOPS_LEAVE_THE_GROUP_TO;
};

/**
 * F143-FR-026 — READ A STOP REQUEST WITH A GROUP LIVE. A pure decision: what
 * the engine does with this stop, and in particular whether it waits for
 * `group_closed` or ends the workers now.
 */
export function readAStopRequest(kind: StopKind): StopDecision {
  if ((STOPS_THAT_END_THE_WORKERS as readonly string[]).includes(kind)) {
    return Object.freeze({
      kind,
      startFurtherWorkers: false as const,
      liveWorkersRunToTheEndOfTheirPass: false,
      integrationRunsThrough: false,
      endTheWorkersNow: true,
      leavesTheGroupTo: THE_FAST_STOPS_LEAVE_THE_GROUP_TO,
    });
  }
  return Object.freeze({
    kind,
    startFurtherWorkers: false as const,
    liveWorkersRunToTheEndOfTheirPass: true,
    integrationRunsThrough: true,
    takesEffectAfter: STOP_TAKES_EFFECT_AFTER,
    endTheWorkersNow: false,
  });
}

/**
 * F143-FR-026 — HAS AN ORDINARY STOP TAKEN EFFECT YET? It has, and only has,
 * once `group_closed` is in the ledger. Reading the ledger is how the question
 * is answered, so that the answer survives a relaunch of the engine between
 * the request and the record.
 */
export function theStopMayTakeEffect(input: {
  readonly kind: StopKind;
  readonly kindsInTheLedger: readonly string[];
}): boolean {
  if ((STOPS_THAT_END_THE_WORKERS as readonly string[]).includes(input.kind)) return true;
  return input.kindsInTheLedger.includes(STOP_TAKES_EFFECT_AFTER);
}

/** What the core is handed to carry out a stop. */
export type StopPorts = {
  /** The rows the process registry of the run holds (annex B, §B.10). */
  registeredProcesses(): Promise<
    readonly {
      readonly pid: number;
      readonly startTime: string;
      readonly runToken: string;
      readonly workerId?: string;
    }[]
  >;
  /** End one worker's processes, after the identity check cleared them. */
  endProcessesOf(worker: {
    readonly workerId: string;
    readonly pid: number;
    readonly processGroup: number;
  }): Promise<boolean>;
};

/** What one `stop --now` (or budget, or time cap) did. */
export type WorkersEndedByAStop = {
  readonly kind: StopThatEndsTheWorkers;
  /** The workers whose processes were ended. */
  readonly ended: readonly string[];
  /** The workers the identity check refused to signal, with the reason. */
  readonly refused: readonly { readonly workerId: string; readonly because: string }[];
  readonly leavesTheGroupTo: typeof THE_FAST_STOPS_LEAVE_THE_GROUP_TO;
};

/**
 * F143-FR-026 — END THE WORKERS ON `stop --now`. The identity check of R11
 * T-26 comes first and is not a formality: by the time a stop is read, a
 * worker may have ended and its pid may belong to something else, and ending
 * THAT would be the runtime killing a stranger. A worker whose registered
 * start time does not match is refused and reported, never signalled.
 */
export async function endWorkersOnStopNow(
  ports: StopPorts,
  input: {
    readonly kind: StopThatEndsTheWorkers;
    readonly liveWorkers: readonly {
      readonly workerId: string;
      readonly pid: number;
      readonly startTime: string;
      readonly processGroup: number;
    }[];
    readonly runToken: string;
  },
): Promise<WorkersEndedByAStop> {
  const registry = await ports.registeredProcesses();
  const ended: string[] = [];
  const refused: { workerId: string; because: string }[] = [];
  for (const worker of input.liveWorkers) {
    if (!Number.isInteger(worker.pid) || worker.pid <= 1) {
      refused.push({ workerId: worker.workerId, because: "pid-is-not-above-one" });
      continue;
    }
    const row = registry.find((entry) => entry.pid === worker.pid);
    if (row === undefined) {
      refused.push({ workerId: worker.workerId, because: "no-registration" });
      continue;
    }
    if (row.startTime !== worker.startTime) {
      refused.push({ workerId: worker.workerId, because: "start-time-differs" });
      continue;
    }
    if (row.runToken !== input.runToken) {
      refused.push({ workerId: worker.workerId, because: "run-token-differs" });
      continue;
    }
    const gone = await ports.endProcessesOf({
      workerId: worker.workerId,
      pid: worker.pid,
      processGroup: worker.processGroup,
    });
    if (gone) ended.push(worker.workerId);
    else refused.push({ workerId: worker.workerId, because: "still-live" });
  }
  return Object.freeze({
    kind: input.kind,
    ended: Object.freeze(ended),
    refused: Object.freeze(refused.map((r) => Object.freeze(r))),
    leavesTheGroupTo: THE_FAST_STOPS_LEAVE_THE_GROUP_TO,
  });
}
