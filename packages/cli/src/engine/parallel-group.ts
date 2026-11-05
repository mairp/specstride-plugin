/**
 * THE PREPARATION, THE RUN AND THE BARRIER OF ONE GROUP, at the composition
 * root (step 3 of `prompts/specstride-parallel-units.md`; F143-FR-005 to
 * F143-FR-017). The decisions are the core's and the layer's; this module is
 * the edge that carries them out on real directories, real files and real
 * processes:
 *
 *  - `prepareTheGroupTrees` — the base snapshot of the group and the
 *    materialization of one worker tree per member through the tree store,
 *    then THE WORKSPACE PART of each worker (F143-FR-008): an EMPTY OUTBOX
 *    and the HANDOFF that names the assigned task, the scope and the base
 *    fingerprint, and the temporary directory beside the tree (F143-FR-009).
 *    The main line's outbox, evidence and notebook are not copied — the tree
 *    store guarantees it, because a snapshot never holds an ignored path and
 *    the outbox is one;
 *  - `runTheGroupWorkers` — the N workers of the group through the runner of
 *    step 2 (`startGroupWorkers`), each started through a door the caller
 *    hands in (the real one is `dshStartDoor` below, the `startPass` door of
 *    `specstride.harness/1`), with the end of every pass observed from the
 *    door and carried into the runner (`markTheEnd`), and the checkpoint a
 *    KILLED pass left behind remembered by the hash of its bytes;
 *  - `closeTheGroup` — THE BARRIER (F143-FR-017) through core
 *    `closeTheBarrier`: the processes of a worker are confirmed gone —
 *    `theGroupIsAlive` asks the process group itself, so a group whose
 *    leader is dead but that still holds a process is NOT claimed empty —
 *    then the final snapshot, then the fingerprint taken again, the outcome
 *    of every worker derived from its checkpoint and its end, and the one
 *    `group_barrier` record through the ledger door the caller hands in.
 *
 * WHAT IS NOT HERE YET, AND WHAT THIS MODULE DOES NOT DECIDE: the delta
 * audits, the integration (compose, apply, ticks), the merge check, the
 * before-critic input, the queue that serializes the ledger and the
 * `parallel.*` events — the next slices of step 3. The `record` and
 * `emitEvent` doors this module hands core are the seams they join at.
 *
 * A start refusal of the door is a typed `WorkerStartRefused`, and it ABORTS
 * the start of the group: the caller answers it with the survivor search of
 * F143-FR-018 (`endTheLeftoverWorkers`), which is the one path that ends
 * workers an aborted start left behind.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ContainmentLevel } from "@specstride/contracts/ep/harness";
import type { ProcessEnd } from "@specstride/contracts/ep/kernel-services";
import type { TreeId, TreeStoreService, WorkerTree } from "@specstride/contracts/ep/tree-store";
import type { RegistryAccess } from "../../../core/src/pass-supervision/ports.ts";
import { YIELD_CONTRACT } from "../../../core/src/pass-supervision/yield/schema/index.ts";
import {
  closeTheBarrier,
  type BarrierResult,
  type WorkerAtTheBarrier,
  type WorkerCheckpoint,
  type WorkerEnd,
} from "../../../core/src/parallel/barrier.ts";
import type { ParallelLedgerKind } from "../../../core/src/parallel/ledger-kinds.ts";
import {
  refuseAYieldArtifact,
  workspacePartOfAWorker,
  type PlannedWorker,
} from "../../../core/src/parallel/group-executor.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { startGroupWorkers, type WorkerGroup } from "./group-run.ts";
import {
  THE_STOP_POLL_MS,
  theStopRequestAsItStands,
  type TheStopOfTheGroup,
  type TheStopSeen,
} from "./parallel-stop.ts";
import { processIsGone, type SupervisedWorkerStart } from "./worker-supervisor.ts";
import { startDshWorkerPass } from "./worker-pass.ts";

/* ------------------------------------------------------------------ *
 * The places of the store, and the members of a group of the plan.
 * ------------------------------------------------------------------ */

/**
 * THE HOME OF ONE RUN'S WORKER ROOTS (F143-SC-001): the environment's
 * override where a host pins it, else the scratch directory named by THE
 * RUN'S OWN ID. The home is a function of the run alone — never of the
 * engine start — so a LATER engine start resolves an earlier run's home
 * without knowing where that start put it: the trees of an interrupted run
 * stand where THAT run's start materialized them, and the resume of
 * F143-FR-025 finds them there.
 */
export function theParallelHomeOfARun(runId: string): string {
  return process.env.SPECSTRIDE_PARALLEL_HOME ?? join(tmpdir(), "specstride-parallel", runId);
}

/**
 * THE THREE PLACES of the tree store of one run (F143-FR-002, F143-FR-005):
 * the store in the control plane of the run, one per run; the worker root
 * OUTSIDE the workspace and outside the control plane, under the home
 * directory, named by the run alone (no group and no worker ordinal); the
 * control plane itself, which holds the store's temporary index.
 */
export function placesOfTheParallelStore(input: {
  readonly controlRoot: string;
  readonly runId: string;
  readonly home: string;
}): { readonly store: string; readonly workerRoot: string; readonly control: string } {
  return {
    store: join(input.controlRoot, "tree-store"),
    workerRoot: join(input.home, ".specstride", "worker-roots", input.runId),
    control: input.controlRoot,
  };
}

/** One member of a group, as the plan holds it, before any tree exists. */
export type PlannedMember = {
  readonly taskId: string;
  /** The prefixes of the write scope of the task, as the plan resolved them. */
  readonly scopePrefixes: readonly string[];
};

/**
 * The members of ONE group of the plan of a phase, in the order of the tasks
 * at launch. The group is the one with the ordinal asked for — the first of
 * the phase where none is named. A task of the plan that no group holds is
 * serial and is no member of any group.
 */
export function membersOfTheGroup(
  plan: ParallelPlan,
  phase: number,
  groupOrdinal?: number,
): readonly PlannedMember[] {
  const phasePlan = plan.phases.find((candidate) => candidate.phase === phase);
  if (phasePlan === undefined) return [];
  const group =
    phasePlan.groups.find((candidate) => candidate.ordinal === groupOrdinal) ?? phasePlan.groups[0];
  if (group === undefined) return [];
  const scopes = new Map(phasePlan.tasks.map((task) => [task.id, task.scope.prefixes]));
  return group.tasks.map((taskId) => ({
    taskId,
    scopePrefixes: scopes.get(taskId) ?? [],
  }));
}

/* ------------------------------------------------------------------ *
 * The checkpoint and the yield artifact of a worker's outbox.
 * ------------------------------------------------------------------ */

/**
 * THE CHECKPOINT OF A WORKER (F143-FR-012) is the file the pass was told to
 * write for ITS task, in ITS OWN outbox, named by the task. An outbox of the
 * main line never holds it, because the workspace part gives the worker an
 * empty outbox.
 */
export function workerCheckpointName(taskId: string): string {
  return `${taskId}.checkpoint.json`;
}

/**
 * Read the checkpoint of a worker from its outbox. ONLY the task it names is
 * read, and only from a REGULAR file that is small enough to be a checkpoint
 * and parses: a link, a directory, a broken file — an absent checkpoint
 * (`undefined`), which is one of the three shapes of a bad checkpoint.
 * `writtenByAKilledPass` is NOT read from the file: it is a fact the RUNTIME
 * holds, and `closeTheGroup` states it from the killed pass it observed.
 */
export function readTheWorkerCheckpoint(
  outboxPath: string,
  taskId: string,
): WorkerCheckpoint | undefined {
  const path = join(outboxPath, workerCheckpointName(taskId));
  if (!existsSync(path)) return undefined;
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return undefined;
  }
  if (!stat.isFile()) return undefined;
  if (stat.size > 16 * 1024) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  const task = (parsed as { task?: unknown } | null)?.task;
  return typeof task === "string" ? { task } : undefined;
}

/**
 * The hash of the BYTES of the checkpoint of a worker, as the runtime
 * remembers a killed pass's checkpoint (`undefined` where there is none).
 */
export function hashOfTheWorkerCheckpoint(outboxPath: string, taskId: string): string | undefined {
  const path = join(outboxPath, workerCheckpointName(taskId));
  if (!existsSync(path)) return undefined;
  try {
    if (!lstatSync(path).isFile()) return undefined;
    return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * THE YIELD ARTIFACT of a worker (F143-FR-011): a JSON file in its outbox
 * that carries the yield contract. The path of the first such file, or
 * `undefined` where the outbox holds none.
 */
export function yieldArtifactIn(outboxPath: string): string | undefined {
  if (!existsSync(outboxPath)) return undefined;
  for (const name of readdirSync(outboxPath).sort()) {
    const path = join(outboxPath, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 16 * 1024) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      continue;
    }
    if ((parsed as { contract?: unknown } | null)?.contract === YIELD_CONTRACT) return path;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The preparation of the trees.
 * ------------------------------------------------------------------ */

/** One worker of a prepared group, ready to be started. */
export type PreparedWorker = {
  readonly workerId: string;
  readonly taskId: string;
  /** The worker tree, as `materialize` of the store made it. */
  readonly tree: string;
  /** Its own outbox, EMPTY at preparation (F143-FR-008). */
  readonly outboxPath: string;
  /** Where its handoff was written (F143-FR-008). */
  readonly handoffPath: string;
  /** The temporary directory beside its tree (F143-FR-009). */
  readonly temporaryDirectory: string;
  /** Its opaque token (F143-FR-009): a secret of this group only. */
  readonly workerToken: string;
};

/** What the preparation of a group holds. */
export type PreparedGroup = {
  /** The base snapshot every tree was materialized from. */
  readonly baseTreeId: TreeId;
  /** The worker trees, exactly as the store returned them. */
  readonly workerTrees: readonly WorkerTree[];
  readonly workers: readonly PreparedWorker[];
};

/**
 * PREPARE THE TREES OF ONE GROUP: the base snapshot (the one given after a
 * resume, else the FIRST snapshot this preparation takes), then one worker
 * tree per member, then the workspace part of each — the empty outbox, the
 * handoff, the temporary directory beside the tree. The worker ids are
 * minted in the order of the members, from 1; the tokens are minted per
 * worker, and no token is derived from any other.
 */
export async function prepareTheGroupTrees(input: {
  readonly store: TreeStoreService;
  readonly workspace: string;
  readonly members: readonly PlannedMember[];
  /** The feature slug, which names the outbox and the handoff of a worker. */
  readonly slug: string;
  /** The fingerprint of the workspace the base snapshot was taken at. */
  readonly baseFingerprint: string;
  /** The base snapshot, where a resume already has one. */
  readonly baseTreeId?: TreeId | undefined;
}): Promise<PreparedGroup> {
  const baseTreeId = input.baseTreeId ?? (await input.store.snapshot(input.workspace));
  const workerTrees: WorkerTree[] = [];
  const workers: PreparedWorker[] = [];
  let position = 0;
  for (const member of input.members) {
    position += 1;
    const workerId = `w-${String(position)}`;
    const tree = await input.store.materialize(baseTreeId, workerId);
    const temporaryDirectory = join(`${tree.path}.tmp`, randomBytes(8).toString("hex"));
    const planned: PlannedWorker = {
      workerId,
      task: member.taskId,
      scope: [...member.scopePrefixes],
      tree: tree.path,
      temporaryDirectory,
      // The token of the worker is opaque and minted here, in the edge that
      // can reach a random source; the core only decides that one exists.
      token: randomBytes(24).toString("hex"),
      taskPosition: position,
    };
    const part = workspacePartOfAWorker({
      worker: planned,
      slug: input.slug,
      baseFingerprint: input.baseFingerprint,
    });
    mkdirSync(join(tree.path, part.outbox), { recursive: true, mode: 0o700 });
    mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(tree.path, part.handoffPath), JSON.stringify(part.handoff, null, 2), {
      mode: 0o600,
    });
    workerTrees.push(tree);
    workers.push({
      workerId,
      taskId: member.taskId,
      tree: tree.path,
      outboxPath: join(tree.path, part.outbox),
      handoffPath: join(tree.path, part.handoffPath),
      temporaryDirectory,
      workerToken: planned.token,
    });
  }
  return { baseTreeId, workerTrees: Object.freeze(workerTrees), workers: Object.freeze(workers) };
}

/** Remove the temporary directories of a group at its close (F143-FR-009). */
export function removeTheTemporaryDirectories(prepared: PreparedGroup): void {
  for (const worker of prepared.workers) {
    rmSync(`${worker.tree}.tmp`, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ *
 * The run of the workers.
 * ------------------------------------------------------------------ */

/** What one started worker pass hands back to the runner of the group. */
export type StartedWorkerPass = SupervisedWorkerStart & {
  /** The end of the pass, as the door observes it — the runtime's ends. */
  readonly ended: Promise<WorkerEnd>;
};

/**
 * A refusal of the start door: the harness could not start one worker. This
 * ABORTS the start of the group; the caller answers it with the survivor
 * search of F143-FR-018, the one path that ends what an aborted start left.
 */
export class WorkerStartRefused extends Error {
  readonly workerId: string;
  constructor(workerId: string, message: string) {
    super(`the worker \`${workerId}\` could not start: ${message}`);
    this.name = "WorkerStartRefused";
    this.workerId = workerId;
  }
}

/**
 * THE REAL DOOR of a worker pass: `startDshWorkerPass`, the `startPass`
 * operation of `specstride.harness/1` (annex C §C.1). The worker's tree is
 * the working directory and the write root, the session is fresh under the
 * worker id, the three-variable environment of F143-FR-009 is allow-listed,
 * and the two outputs of the pass go under the run's control root. A refusal
 * of the adapter is a typed `WorkerStartRefused`.
 */
export function dshStartDoor(input: {
  readonly model: string;
  readonly modelTierOrEffort: string;
  readonly containment: ContainmentLevel;
  /** The run token of the group, as the environment of the worker carries it. */
  readonly runToken: string;
  readonly timeLimitMs: number;
  readonly promptOf: (worker: PreparedWorker) => string;
  readonly outputRootOf: (worker: PreparedWorker) => string;
  /** The end of the dsh process; defaults to the handle's own promise. */
  readonly endedOf?: (workerId: string) => Promise<ProcessEnd>;
}): (worker: PreparedWorker) => Promise<StartedWorkerPass> {
  return async (worker) => {
    const result = await startDshWorkerPass({
      workerId: worker.workerId,
      tree: worker.tree,
      workerToken: worker.workerToken,
      runToken: input.runToken,
      temporaryDirectory: worker.temporaryDirectory,
      model: input.model,
      modelTierOrEffort: input.modelTierOrEffort,
      containment: input.containment,
      promptReference: input.promptOf(worker),
      timeLimitMs: input.timeLimitMs,
      outputRoot: input.outputRootOf(worker),
    });
    if (!result.ok) throw new WorkerStartRefused(worker.workerId, result.message);
    const handle = result.handle;
    const readEnd = input.endedOf ?? (async () => await handle.ended);
    return {
      workerId: worker.workerId,
      pid: handle.pid,
      startTime: handle.startTime,
      processGroup: handle.processGroup,
      runTokenHash: createHash("sha256").update(input.runToken).digest("hex"),
      ended: readEnd(worker.workerId).then((end): WorkerEnd =>
        end.exitCode === 0 && end.signal === null ? "ended" : "harness-error",
      ),
    };
  };
}

/**
 * THE HASH the runtime remembers of the checkpoint a killed pass had
 * written, so the barrier can tell a checkpoint OF the killed pass from one
 * a restarted pass wrote afterwards (F143-FR-012).
 */
export type KilledCheckpoint = { readonly workerId: string; readonly hash: string };

/** The facts of one start, as the registry names them (F142-FR-028). */
export type WorkerStartFacts = {
  /** The task the pass runs. */
  readonly task: string;
  /** The pid of the pass, as the door observed it. */
  readonly pid: number;
  /** The start time of the pass, as the host gave it; `""` where it did not. */
  readonly startTime: string;
  /** The position of the task in the order of the tasks at launch, from 1. */
  readonly taskPosition: number;
  /** The index of the restart this pass is, from 0 (0 within one call). */
  readonly restartIndex: number;
};

/**
 * RUN THE WORKERS OF ONE GROUP to their ends. The slices, the supervision,
 * the guards, the watchdogs, the pause and the cap are the runner of step 2;
 * this function adapts the prepared workers to it and observes every pass
 * end through the door, carrying it into the runner. A killed pass leaves
 * its checkpoint remembered by hash; the barrier reads that memory.
 */
export async function runTheGroupWorkers(input: {
  readonly prepared: PreparedGroup;
  readonly supervision: {
    readonly enginePid: number;
    readonly engineStartedAtMs: number;
    readonly runTokenHash: string;
    readonly workersDir: string;
    readonly guardScriptPath: string;
    /** The pass ceiling of the workers, in seconds. */
    readonly ceilingSec: number;
    readonly registry: RegistryAccess;
  };
  readonly workersAtATime: number;
  readonly start: (worker: PreparedWorker) => Promise<StartedWorkerPass>;
  /**
   * The one `worker_started` record per worker, through the ledger door,
   * with the facts of the start (F142-FR-028: the task, the pid, the start
   * time, and the pass ordinal).
   */
  readonly record?:
    | ((kind: ParallelLedgerKind, workerId: string, facts: WorkerStartFacts) => Promise<void>)
    | undefined;
  /**
   * The index of the restart each pass is, from 0. Within one call every
   * pass is the first of its worker (0), so this is left out of the fresh
   * group run; the RESTART of a resume (F143-FR-013) hands the index the
   * interrupted run's ledger numbers the lost pass by, plus one.
   */
  readonly restartIndexOf?: ((workerId: string) => number | undefined) | undefined;
  /**
   * THE STOP THE GROUP RUNS UNDER (F143-FR-026): the request `inbox:stop` is
   * read at the boundaries the wait below already runs, never by a watcher
   * and never inside a pass. Left out, no poll runs and the group is exactly
   * as it was before the stop join.
   */
  readonly stop?: TheStopOfTheGroup | undefined;
  readonly say?: ((line: string) => void) | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly group: WorkerGroup;
      readonly ends: ReadonlyMap<string, WorkerEnd>;
      readonly checkpointLeftByAKilledPass: readonly KilledCheckpoint[];
      /** The stop the group saw, where a request stood while it ran. */
      readonly stop?: TheStopSeen | undefined;
    }
  | { readonly ok: false; readonly workerId: string; readonly message: string }
> {
  const endedOf = new Map<string, Promise<WorkerEnd>>();
  const killedCheckpoints: KilledCheckpoint[] = [];
  // The ends the door resolves are carried into the runner AFTER the runner
  // came up: the door runs while `startGroupWorkers` is still in flight, so
  // it cannot hold the group yet. The loop below applies them.
  const resolvedEnds = new Map<string, WorkerEnd>();
  try {
    const group = await startGroupWorkers({
      planned: input.prepared.workers.map((worker) => ({
        workerId: worker.workerId,
        task: worker.taskId,
        taskPosition: Number(worker.workerId.slice(2)),
        tree: worker.tree,
      })),
      workersAtATime: input.workersAtATime,
      runTokenHash: input.supervision.runTokenHash,
      enginePid: input.supervision.enginePid,
      engineStartedAtMs: input.supervision.engineStartedAtMs,
      workersDir: input.supervision.workersDir,
      guardScriptPath: input.supervision.guardScriptPath,
      ceilingSec: input.supervision.ceilingSec,
      registry: input.supervision.registry,
      say: input.say,
      start: async (workerId) => {
        const worker = input.prepared.workers.find((row) => row.workerId === workerId);
        if (worker === undefined) throw new WorkerStartRefused(workerId, "no such worker");
        const started = await input.start(worker);
        endedOf.set(
          workerId,
          started.ended.then(async (end) => {
            if (end === "killed") {
              // The checkpoint the killed pass left, by the hash of its
              // bytes — a restarted pass overwrites the file, and the hash
              // stops matching.
              const hash = hashOfTheWorkerCheckpoint(worker.outboxPath, worker.taskId);
              if (hash !== undefined) killedCheckpoints.push({ workerId, hash });
            }
            resolvedEnds.set(workerId, end);
            return end;
          }),
        );
        if (input.record !== undefined) {
          await input.record("worker_started", workerId, {
            task: worker.taskId,
            pid: started.pid,
            startTime: started.startTime ?? "",
            taskPosition: Number(worker.workerId.slice(2)),
            // Within one call every pass is the first of its worker: a
            // restart happens on a relaunch (F143-FR-013), which the caller
            // numbers when it calls again — the restart of a resume hands
            // `restartIndexOf` for exactly that.
            restartIndex: input.restartIndexOf?.(workerId) ?? 0,
          });
        }
        return started;
      },
    });

    // Every pass ends — through its own exit, the watchdog of the runner,
    // the pause or the cap. Each end is carried into the runner the moment
    // it resolves (`markTheEnd` closes the row); the loop is over when every
    // row of the group has closed. The same boundaries carry the stop poll
    // (F143-FR-026): a READ of the request file every `intervalMs`, at a
    // boundary, never inside a pass (F122-FR-029).
    const applied = new Set<string>();
    const readTheStop = input.stop?.read ?? theStopRequestAsItStands;
    const stopPollMs = input.stop?.intervalMs ?? THE_STOP_POLL_MS;
    let stopSeen: TheStopSeen | undefined;
    let lastStopPollAt = Number.NEGATIVE_INFINITY;
    while (group.rows().length > 0) {
      for (const [workerId, end] of resolvedEnds) {
        if (!applied.has(workerId)) {
          applied.add(workerId);
          group.markTheEnd(workerId, end);
        }
      }
      if (input.stop !== undefined && stopSeen === undefined) {
        const at = Date.now();
        if (at - lastStopPollAt >= stopPollMs) {
          lastStopPollAt = at;
          const found = readTheStop(input.stop.requestPath);
          if (found.asked) {
            stopSeen = { now: found.now };
            if (found.now) {
              // `stop --now` (F143-FR-026): every live worker ends through
              // the runner's ladder — the identity check stands between the
              // signal and the pid — and the group is LEFT OPEN for the
              // states of F143-FR-025. The caller writes nothing more.
              input.say?.(
                "[LOOP] parallel: stop --now — the workers end after the identity check; the group is left to the resume states (F143-FR-025)",
              );
              await group.endAllOfTheGroup("killed");
            } else {
              // A clean stop changes NOTHING inside the group: the live
              // workers run to the ends of their passes, and the caller runs
              // the integration and the merge check through `group_closed`;
              // the stop takes effect after the group.
              input.say?.(
                "[LOOP] parallel: stop requested — the live workers run to the end of their pass, the integration and the merge check run through group_closed, and the run then stops (F143-FR-026)",
              );
            }
          }
        }
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    await Promise.allSettled([...endedOf.values()]);

    const ends = new Map<string, WorkerEnd>();
    for (const worker of input.prepared.workers) {
      const end = group.theEndOf(worker.workerId);
      if (end === undefined) {
        // The row closed without an end reaching it — the door never
        // resolved. A pass the runtime knows nothing about is a harness
        // failure, and the barrier derives the outcome from that.
        group.markTheEnd(worker.workerId, "harness-error");
        ends.set(worker.workerId, "harness-error");
      } else {
        ends.set(worker.workerId, end);
      }
    }
    return {
      ok: true,
      group,
      ends,
      checkpointLeftByAKilledPass: Object.freeze(killedCheckpoints),
      ...(stopSeen === undefined ? {} : { stop: stopSeen }),
    };
  } catch (error) {
    if (error instanceof WorkerStartRefused) {
      return { ok: false, workerId: error.workerId, message: error.message };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * The barrier.
 * ------------------------------------------------------------------ */

/**
 * Whether ANY process still answers in the process group `pgid`: the group
 * is asked itself with a signal-0 probe against the NEGATIVE pid, so a group
 * whose leader is dead but that still holds a worker's stray child is not
 * claimed empty. A `zombie` leader is gone for the group probe the same way.
 */
export function theGroupIsAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * CLOSE THE GROUP AT THE BARRIER (F143-FR-017). The checkpoint and the yield
 * artifact of every worker are read BEFORE the barrier touches the tree, the
 * processes of a worker are confirmed gone — the process group itself is
 * probed, and only a group that answers NOTHING is claimed empty — then the
 * core barrier takes the final snapshots, fingerprints the trees again,
 * derives the outcomes and writes the one `group_barrier` record.
 *
 * A checkpoint whose bytes match the hash a killed pass left is the
 * checkpoint OF that killed pass (`writtenByAKilledPass`, F143-FR-012): the
 * worker is refused, and a restarted pass that overwrote the file is not
 * punished for it.
 *
 * The ledger door is the one writer of the run (the queue joins at the next
 * slice); the event door carries the tree-changed event, which is not shown
 * to the critic, and the yield-refusal event, which is.
 */
export async function closeTheGroup(input: {
  readonly store: TreeStoreService;
  /** The fingerprint of the workspace at group start, for the record. */
  readonly workspace: string;
  readonly prepared: PreparedGroup;
  readonly ends: ReadonlyMap<string, WorkerEnd>;
  readonly pidOf: (workerId: string) => number | undefined;
  readonly record: (
    kind: ParallelLedgerKind,
    data: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  readonly emitEvent: (event: {
    readonly kind: string;
    readonly workerId: string;
    readonly shownToTheCritic: boolean;
  }) => Promise<void>;
  /** The checkpoints a killed pass left, from `runTheGroupWorkers`. */
  readonly checkpointLeftByAKilledPass?: readonly KilledCheckpoint[] | undefined;
}): Promise<BarrierResult> {
  const workers: WorkerAtTheBarrier[] = input.prepared.workers.map((worker) => {
    const checkpoint = readTheWorkerCheckpoint(worker.outboxPath, worker.taskId);
    const yieldArtifact = yieldArtifactIn(worker.outboxPath) !== undefined;
    const leftBehind = (input.checkpointLeftByAKilledPass ?? []).filter(
      (row) => row.workerId === worker.workerId,
    );
    const current = hashOfTheWorkerCheckpoint(worker.outboxPath, worker.taskId);
    const writtenByAKilledPass =
      checkpoint !== undefined &&
      current !== undefined &&
      leftBehind.some((row) => row.hash === current);
    return {
      workerId: worker.workerId,
      assignedTask: worker.taskId,
      tree: worker.tree,
      ...(checkpoint === undefined
        ? {}
        : {
            checkpoint: writtenByAKilledPass ? { ...checkpoint, writtenByAKilledPass } : checkpoint,
          }),
      end: input.ends.get(worker.workerId) ?? "harness-error",
      ...(yieldArtifact ? { yieldArtifact: true } : {}),
    };
  });
  for (const worker of workers) {
    if (worker.yieldArtifact === true) {
      const refused = refuseAYieldArtifact(worker.workerId);
      await input.emitEvent({ ...refused.event, shownToTheCritic: true });
    }
  }
  return closeTheBarrier(
    {
      endProcessesOf: async (workerId) => {
        const pid = input.pidOf(workerId);
        if (pid === undefined) return { ended: [], guaranteedNoneRemains: false };
        if (!processIsGone(pid)) {
          // The barrier is the LAST RESORT: the runner's polite ladder has
          // run and every row of the group is closed; what still answers
          // here takes the kill of its group, and emptiness is confirmed
          // only AFTER the kill, by the answer of the group itself.
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // Already gone under another group.
          }
          await new Promise((done) => setTimeout(done, 80));
          return { ended: [pid], guaranteedNoneRemains: !theGroupIsAlive(pid) };
        }
        // Nothing of this worker answers any more. Emptiness is the GROUP's
        // answer, and only a group that answers NOTHING guarantees it
        // (F143-FR-018): a dead leader with a stray child is no guarantee.
        return { ended: [], guaranteedNoneRemains: !theGroupIsAlive(pid) };
      },
      snapshot: (directory) => input.store.snapshot(directory),
      fingerprint: (directory) => input.store.snapshot(directory),
      record: (kind, data) => input.record(kind, data),
      emitEvent: (event) => input.emitEvent(event),
    },
    { workers, workspace: input.workspace },
  );
}
