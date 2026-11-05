/**
 * T035 and T038 — THE BARRIER of a group (F143-FR-012, F143-FR-017; R29
 * PU-41, PU-42; R29v PU-96; R29 PU-35, PU-50).
 *
 * Two tasks, and they are the two halves of the same moment:
 *
 *  T035, F143-FR-012 — DERIVE THE OUTCOME OF A WORKER FROM ITS CHECKPOINT AND
 *    ITS END. The outcome is one of the closed set `integrated`, `refused`,
 *    `killed`, `paused` and nothing else. A CHECKPOINT THAT NAMES ANOTHER
 *    TASK, THAT IS ABSENT, OR THAT WAS WRITTEN BY A KILLED PASS GIVES
 *    `refused`. A refused worker charges nothing to its task: the task goes
 *    back to the main line with its counts as they were.
 *
 *  T038, F143-FR-017 — TAKE FINAL SNAPSHOTS AT THE END OF EACH WORKER;
 *    FINGERPRINT AGAIN AT THE BARRIER. The final snapshot of a worker is
 *    taken WHEN THE PROCESSES OF THAT WORKER HAVE BEEN ENDED, and its tree id
 *    is recorded in the ledger BEFORE ANY OTHER STEP. Before the barrier
 *    closes, every process of every worker the runtime can identify is ended;
 *    where the runtime cannot guarantee that none remains, the run says
 *    `protection=detect`. Integration starts only when every worker pass has
 *    ended. At the barrier EVERY WORKER TREE IS FINGERPRINTED AGAIN, and a
 *    tree that differs from its final snapshot REFUSES THAT WORKER, with an
 *    event that is not shown to the critic.
 *
 * WHY THE ORDER IS NOT NEGOTIABLE. The final snapshot is the only record of
 * what a worker did; a tree is a directory on disk that anything with the
 * path could still write. So: end the processes, THEN snapshot, THEN record
 * the tree id, and at the barrier take the fingerprint A SECOND TIME and
 * compare. A tree that moved between the two readings is a tree whose delta
 * no one can vouch for, and the worker is refused rather than integrated —
 * `tree-changed-outside-pass`, one of the two neutral integrity kinds, which
 * is reported by kind and without a count and never reaches a critic
 * (F100-FR-128).
 *
 * WHY THIS FILE STARTS NOTHING AND READS NOTHING. It is a module of the core,
 * which may not start a process and may not touch the file system (annex A
 * §A.3). Ending processes, taking a snapshot and reading a fingerprint are
 * all handed in as `BarrierPorts`; this module decides the ORDER and the
 * OUTCOME, which is the part that is the engine's own.
 */
import type { ParallelLedgerKind } from "./ledger-kinds.ts";

/* ------------------------------------------------------------------ *
 * T035 — the outcome of a worker (F143-FR-012).
 * ------------------------------------------------------------------ */

/**
 * F143-FR-012 — the closed set of outcomes of a worker, and no other value.
 * Registered in annex X §X.6 with this feature's other two closed sets.
 */
export const WORKER_OUTCOMES = ["integrated", "refused", "killed", "paused"] as const;
export type WorkerOutcome = (typeof WORKER_OUTCOMES)[number];

/** True where the value is one of the four outcomes (F143-FR-012). */
export function isWorkerOutcome(value: unknown): value is WorkerOutcome {
  return typeof value === "string" && (WORKER_OUTCOMES as readonly string[]).includes(value);
}

/**
 * HOW A WORKER PROCESS ENDED, as the group executor observed it. This is the
 * second of the two things the outcome is derived from; the first is the
 * checkpoint.
 */
export const WORKER_ENDS = [
  /** The process ended of its own accord. */
  "ended",
  /** The runtime ended it: a stop, a cap, a relaunch, a crash of the engine. */
  "killed",
  /** The polite stop of a quota pause (F143-FR-015). */
  "paused",
  /** The harness itself failed (F143-FR-012). */
  "harness-error",
] as const;
export type WorkerEnd = (typeof WORKER_ENDS)[number];

/**
 * The checkpoint of a worker, as it was found in the worker's own outbox. An
 * ABSENT checkpoint is `undefined`, which is one of the three shapes
 * F143-FR-012 names.
 */
export type WorkerCheckpoint = {
  /** The task the checkpoint names. */
  readonly task?: string;
  /** True where the pass that wrote it was killed (F143-FR-012). */
  readonly writtenByAKilledPass?: boolean;
};

/** What the outcome of one worker is derived from (F143-FR-012). */
export type WorkerEndState = {
  readonly workerId: string;
  /** The task assigned to the worker at launch. */
  readonly assignedTask: string;
  /** The checkpoint found in its outbox, or `undefined` where there is none. */
  readonly checkpoint?: WorkerCheckpoint | undefined;
  /** How the process ended. */
  readonly end: WorkerEnd;
  /** True where a yield artifact was found in its outbox (F143-FR-011). */
  readonly yieldArtifact?: boolean;
  /** True where its tree differs from its final snapshot (F143-FR-017). */
  readonly treeChangedAfterTheFinalSnapshot?: boolean;
};

/** The reasons a worker is refused, in the order they are tested. */
export const REFUSAL_REASONS = [
  "a yield artifact in the outbox of a worker",
  "the checkpoint is absent",
  "the checkpoint names another task",
  "the checkpoint was written by a killed pass",
  "the tree changed after its final snapshot",
  "the harness failed",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** The outcome of one worker, with the reason where it is not `integrated`. */
export type DerivedOutcome = {
  readonly workerId: string;
  readonly outcome: WorkerOutcome;
  /** Why, where the outcome is `refused`. */
  readonly reason?: RefusalReason;
  /** F143-FR-012 — a refused worker charges nothing to its task. */
  readonly chargesItsTask: boolean;
  /** F143-FR-014, F143-FR-012 — the task returns to the main line. */
  readonly taskReturnsToTheMainLine: boolean;
};

/**
 * F143-FR-012 — THE OUTCOME OF A WORKER, from its checkpoint and its end.
 *
 * The order of the tests is the order of the requirement, and it matters:
 *
 *  1 `paused` and `killed` come from THE END, not from the checkpoint. A
 *    worker the runtime stopped has no claim to judge, and a `killed` worker
 *    keeps that outcome even where it had written a checkpoint first — its
 *    work is discarded from integration by F143-FR-014.
 *  2 A YIELD ARTIFACT refuses the worker whatever else it wrote: no yield
 *    takes place in a worker (F143-FR-011).
 *  3 THE THREE SHAPES OF A BAD CHECKPOINT of F143-FR-012 — absent, naming
 *    another task, written by a killed pass — each give `refused`.
 *  4 A TREE THAT MOVED after its final snapshot refuses the worker
 *    (F143-FR-017), because the delta that was audited is no longer the delta
 *    on disk.
 *  5 A HARNESS FAILURE refuses rather than kills: the runtime did not end the
 *    process, so it is not `killed`, and there is nothing to integrate.
 *
 * Only a worker that passes all five is `integrated`.
 */
export function outcomeOfWorker(state: WorkerEndState): DerivedOutcome {
  const refuse = (reason: RefusalReason): DerivedOutcome =>
    Object.freeze({
      workerId: state.workerId,
      outcome: "refused" as const,
      reason,
      // F143-FR-012 — a refused worker charges nothing to its task; the task
      // returns to the main line with its counts as they were.
      chargesItsTask: false,
      taskReturnsToTheMainLine: true,
    });

  if (state.end === "paused") {
    return Object.freeze({
      workerId: state.workerId,
      outcome: "paused" as const,
      // F143-FR-015 — a pause spends no cycle, no restart, no cap, no budget.
      chargesItsTask: false,
      taskReturnsToTheMainLine: false,
    });
  }
  if (state.end === "killed") {
    return Object.freeze({
      workerId: state.workerId,
      outcome: "killed" as const,
      // F143-FR-014 — the work is discarded and the task returns to the main
      // line; a killed worker charges nothing either.
      chargesItsTask: false,
      taskReturnsToTheMainLine: true,
    });
  }
  if (state.yieldArtifact === true) return refuse("a yield artifact in the outbox of a worker");
  if (state.checkpoint === undefined) return refuse("the checkpoint is absent");
  if (state.checkpoint.writtenByAKilledPass === true) {
    return refuse("the checkpoint was written by a killed pass");
  }
  if (state.checkpoint.task !== state.assignedTask)
    return refuse("the checkpoint names another task");
  if (state.treeChangedAfterTheFinalSnapshot === true) {
    return refuse("the tree changed after its final snapshot");
  }
  if (state.end === "harness-error") return refuse("the harness failed");
  return Object.freeze({
    workerId: state.workerId,
    outcome: "integrated" as const,
    chargesItsTask: true,
    taskReturnsToTheMainLine: false,
  });
}

/* ------------------------------------------------------------------ *
 * T038 — the barrier (F143-FR-017).
 * ------------------------------------------------------------------ */

/** F143-FR-017 — integration starts only when every worker pass has ended. */
export const INTEGRATION_STARTS_ONLY_WHEN_EVERY_WORKER_PASS_HAS_ENDED = true as const;

/**
 * F143-FR-017 — what the run says where the runtime cannot guarantee that no
 * process of a worker remains.
 */
export const PROTECTION_WHEN_NOT_GUARANTEED = "detect" as const;

/** F143-FR-017 — what the run says where every process was ended for certain. */
export const PROTECTION_WHEN_GUARANTEED = "enforce" as const;

/**
 * F143-FR-017 — no check and no command of the verification gate runs while a
 * process of a worker is known to live.
 */
export function theGateMayRun(liveProcesses: readonly number[]): boolean {
  return liveProcesses.length === 0;
}

/**
 * F100-FR-128 — the neutral integrity kind a moved tree raises. Reported by
 * kind and WITHOUT A COUNT, and never shown to a critic.
 */
export const TREE_CHANGED_EVENT = "tree-changed-outside-pass" as const;

/** F143-FR-017 — the event of a moved tree is not shown to the critic. */
export const TREE_CHANGED_EVENT_IS_SHOWN_TO_THE_CRITIC = false as const;

/** One worker as the barrier receives it: its tree and what it was asked to do. */
export type WorkerAtTheBarrier = {
  readonly workerId: string;
  readonly assignedTask: string;
  /** The directory the worker worked in. */
  readonly tree: string;
  /** The checkpoint found in its outbox, or `undefined`. */
  readonly checkpoint?: WorkerCheckpoint | undefined;
  /** How its process ended. */
  readonly end: WorkerEnd;
  /** True where a yield artifact was found in its outbox. */
  readonly yieldArtifact?: boolean;
};

/**
 * What the barrier is handed to do its work with. Every member is an
 * operation this module may not perform itself: the core starts no process
 * and reads no file (annex A, §A.3).
 */
export type BarrierPorts = {
  /**
   * End every process of this worker that the runtime can identify, and say
   * whether it can guarantee that none remains (F143-FR-017, F143-FR-018).
   */
  endProcessesOf(workerId: string): Promise<{
    readonly ended: readonly number[];
    readonly guaranteedNoneRemains: boolean;
  }>;
  /** `snapshot(directory) → treeId` of the store, behind its interface. */
  snapshot(directory: string): Promise<string>;
  /** The fingerprint of a directory, which for a tree is a tree id of the store. */
  fingerprint(directory: string): Promise<string>;
  /** Write one record of the parallel namespace, through the one writer. */
  record(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): Promise<void>;
  /** Emit one event. The event of a moved tree is not shown to the critic. */
  emitEvent(event: {
    readonly kind: string;
    readonly workerId: string;
    readonly shownToTheCritic: boolean;
  }): Promise<void>;
};

/** What the barrier observed of one worker. */
export type WorkerAtTheBarrierResult = {
  readonly workerId: string;
  /** The tree id of the final snapshot, taken after its processes were ended. */
  readonly finalTreeId: string;
  /** The fingerprint taken AGAIN at the barrier (F143-FR-017). */
  readonly fingerprintAtTheBarrier: string;
  /** True where the two differ: the tree moved after its final snapshot. */
  readonly treeChangedAfterTheFinalSnapshot: boolean;
  /** The pids that were ended before the snapshot was taken. */
  readonly processesEnded: readonly number[];
  /** The outcome derived from the checkpoint and the end (F143-FR-012). */
  readonly outcome: DerivedOutcome;
};

/** What the barrier gave for the group as a whole. */
export type BarrierResult = {
  readonly perWorker: readonly WorkerAtTheBarrierResult[];
  /** `enforce` or `detect`, as F143-FR-017 requires the run to say. */
  readonly protection: typeof PROTECTION_WHEN_GUARANTEED | typeof PROTECTION_WHEN_NOT_GUARANTEED;
  /** True where integration may start: every worker pass has ended. */
  readonly integrationMayStart: boolean;
  /** The workers whose outcome is `integrated` — the candidates for an audit. */
  readonly candidates: readonly string[];
};

/**
 * F143-FR-017 — THE FINAL SNAPSHOT OF ONE WORKER: its processes are ended
 * FIRST, then the snapshot is taken, and its tree id is recorded in the
 * ledger BEFORE ANY OTHER STEP. The three happen in that order and in no
 * other, which is the whole content of the task.
 */
export async function finalSnapshotOfWorker(
  ports: BarrierPorts,
  worker: WorkerAtTheBarrier,
): Promise<{
  readonly finalTreeId: string;
  readonly processesEnded: readonly number[];
  readonly guaranteedNoneRemains: boolean;
}> {
  // 1 The processes of THAT worker are ended.
  const ended = await ports.endProcessesOf(worker.workerId);
  // 2 THEN the final snapshot is taken.
  const finalTreeId = await ports.snapshot(worker.tree);
  // 3 THEN its tree id is in the ledger, before any other step.
  await ports.record("worker_ended", {
    workerId: worker.workerId,
    endCause: worker.end,
    treeId: finalTreeId,
    fingerprint: finalTreeId,
    usage: "unknown",
  });
  return Object.freeze({
    finalTreeId,
    processesEnded: ended.ended,
    guaranteedNoneRemains: ended.guaranteedNoneRemains,
  });
}

/**
 * F143-FR-017 — CLOSE THE BARRIER. For every worker: end its processes, take
 * its final snapshot, record its tree id. Then, for every worker again,
 * FINGERPRINT THE TREE A SECOND TIME and refuse the worker whose tree moved.
 * Then the one record `group_barrier`, which carries the fingerprint of the
 * workspace and, per worker, the fingerprint taken again.
 *
 * The second loop is separate from the first on purpose: the comparison is
 * only worth something once every process of every worker of the group has
 * been ended, so no fingerprint is taken while a sibling could still be
 * writing.
 */
export async function closeTheBarrier(
  ports: BarrierPorts,
  input: {
    readonly workers: readonly WorkerAtTheBarrier[];
    /** The fingerprint of the workspace at group start, for the record. */
    readonly workspace: string;
  },
): Promise<BarrierResult> {
  const finals = new Map<
    string,
    { finalTreeId: string; processesEnded: readonly number[]; guaranteedNoneRemains: boolean }
  >();
  for (const worker of input.workers) {
    finals.set(worker.workerId, await finalSnapshotOfWorker(ports, worker));
  }

  const perWorker: WorkerAtTheBarrierResult[] = [];
  for (const worker of input.workers) {
    const final = finals.get(worker.workerId);
    if (final === undefined) continue;
    // F143-FR-017 — at the barrier every worker tree is fingerprinted AGAIN.
    const again = await ports.fingerprint(worker.tree);
    const moved = again !== final.finalTreeId;
    if (moved) {
      await ports.emitEvent({
        kind: TREE_CHANGED_EVENT,
        workerId: worker.workerId,
        shownToTheCritic: TREE_CHANGED_EVENT_IS_SHOWN_TO_THE_CRITIC,
      });
    }
    perWorker.push(
      Object.freeze({
        workerId: worker.workerId,
        finalTreeId: final.finalTreeId,
        fingerprintAtTheBarrier: again,
        treeChangedAfterTheFinalSnapshot: moved,
        processesEnded: final.processesEnded,
        outcome: outcomeOfWorker({
          workerId: worker.workerId,
          assignedTask: worker.assignedTask,
          checkpoint: worker.checkpoint,
          end: worker.end,
          ...(worker.yieldArtifact === undefined ? {} : { yieldArtifact: worker.yieldArtifact }),
          treeChangedAfterTheFinalSnapshot: moved,
        }),
      }),
    );
  }

  const protection = input.workers.every(
    (w) => finals.get(w.workerId)?.guaranteedNoneRemains === true,
  )
    ? PROTECTION_WHEN_GUARANTEED
    : PROTECTION_WHEN_NOT_GUARANTEED;

  await ports.record("group_barrier", {
    fingerprint: input.workspace,
    perWorkerFingerprint: Object.fromEntries(
      perWorker.map((w) => [w.workerId, w.fingerprintAtTheBarrier]),
    ),
    protection,
  });

  return Object.freeze({
    perWorker: Object.freeze(perWorker),
    protection,
    integrationMayStart: INTEGRATION_STARTS_ONLY_WHEN_EVERY_WORKER_PASS_HAS_ENDED,
    candidates: Object.freeze(
      perWorker.filter((w) => w.outcome.outcome === "integrated").map((w) => w.workerId),
    ),
  });
}
