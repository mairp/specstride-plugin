/* ------------------------------------------------------------------ *
 * THE RESTART CARRY OF THE RESUME (F143-FR-025 states 1 and 2) — the
 * engine's carry-out of the two states a group of an earlier start answers
 * with where a worker pass must be started, joined to the tail of the eight
 * states (step 4 of `prompts/specstride-parallel-units.md`, third slice).
 *
 * WHAT THIS SLICE CARRIES OUT:
 *
 *  - state 2, `end-the-recorded-processes` — the ledger ends on one or more
 *    `worker_started` records with no `worker_ended` after them: the passes
 *    were cut in the middle. For EVERY worker whose last record is a start,
 *    the record OF A LOST PASS is written first — `worker_ended` with no
 *    tree id and `usage: unknown` (F143-FR-018) — so the ledger then says,
 *    of each cut pass, exactly what the holder search knew. Then every
 *    worker whose restart is unused is RESTARTED IN ITS OWN TREE
 *    (F143-FR-013), the pass ordinal numbering the restart from the ledger's
 *    own triple; a worker whose restart is used already stands `killed` in
 *    the decision and is NOT restarted — its task returns to the main line.
 *    Where the crash fell between `group_started` and the first
 *    `worker_started`, the decision names no worker at all, and the trees
 *    the store still holds ARE the group: each one is started as its first
 *    pass (restart index 0), which is the truthful number — no pass ever
 *    ran in it.
 *  - state 1, `start-the-group` — the engine died before the group even
 *    prepared its trees (the real engine writes `group_planned` only through
 *    the characterization double). The group is prepared NOW, out of THIS
 *    pass boundary's plan, its `group_started` record written ahead of the
 *    first start, and every worker started as its first pass.
 *
 * In both cases the barrier is closed over the started passes and the group
 * goes on through the tail: the last record before the delegation is
 * `group_barrier`, so the tail re-decides into state 4 and carries the
 * audits, the composition, the application, the ticks, the merge check and
 * the close of the INTERRUPTED run's group — answered as ONE group attempt
 * of this engine start.
 *
 * THE TREE AND THE ROOTS OF A RESTART are the ones the interrupted pass
 * already had: the tree the store still holds for that run, group and
 * worker, and the outbox and the handoff beside it. Nothing is materialized
 * again — the work of the lost pass stands in its tree, and that is the
 * point of a restart. A checkpoint the lost pass left is read as the
 * restart's own: the state-2 contract vouches the tree by the END of the
 * restarted pass (F143-FR-025), and what the barrier refuses by hash
 * (F143-FR-012) is a checkpoint of a pass killed DURING this run, which the
 * runner remembers — a checkpoint cannot be told from one the restart
 * rewrote by its bytes alone.
 *
 * THE SUPERVISION IS THIS START'S: the started passes run under THIS
 * engine's run token, so their identity records go on THIS run's own workers
 * directory (`runs/<runId>/workers`), and a later holder search of the
 * interrupted run finds nothing of them there — a holder of this start's
 * token is this start's own search to end. The ledger and the tree store
 * stay the INTERRUPTED run's (F143-FR-024): one ledger, one queue, `seq`
 * rising without a gap across the relaunch, the counters continuing from
 * the file (F143-FR-028).
 *
 * WHAT IS NOT HERE, and is refused `carried: false` with the reason:
 *  - a group where a `worker_ended` record WITH a tree id stands beside a
 *    restart-marked worker (some passes finished before the cut): carrying a
 *    restart beside it needs the tree-id verification of state 3 joined to
 *    this path, which this slice does not carry yet — the left work is named
 *    in `results/par-4.progress`;
 *  - a holder the identity check refused or could not end, and one that
 *    still answers after the search: no restart may run beside it;
 *  - a restart-marked worker whose tree the store no longer holds, or whose
 *    task stands in no ledger record and no handoff file.
 *
 * THE ONE WRITER: this module opens the INTERRUPTED run's ledger as it
 * stands and RELEASES the writer before the tail carry opens its own — two
 * writers over one ledger within one process are refused, not merged.
 * ------------------------------------------------------------------ */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { ContainmentLevel } from "@specstride/contracts/ep/check-runner";
import type { TreeStoreService } from "@specstride/contracts/ep/tree-store";
import type { RegistryAccess } from "../../../core/src/pass-supervision/ports.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import {
  handoffOfAWorker,
  outboxOfAWorker,
  passOrdinalOf,
} from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import {
  decideFromTheLastRecord,
  recordsOfTheGroup,
  type ResumeAction,
  type ResumeRecord,
} from "../../../core/src/parallel/resume.ts";
import {
  initStore,
  treeStore,
  treesStillHeld,
  type TreeOwnership,
} from "../../../tree-store/src/index.ts";
import {
  groupEndedEvent,
  groupStartedEvent,
  workerEndedEvent,
  workerStartedEvent,
  type EventRequest,
} from "../../../layer-parallel/src/index.ts";
import {
  hashOfTheRunToken,
  type TheGroupAttempt,
  type TheGroupAttemptStoppedNow,
} from "./parallel-attempt.ts";
import { endTheLeftoverWorkers, type LeftoverWorkersReport } from "./group-run.ts";
import {
  closeTheGroupRun,
  dataOfTheKind,
  openTheLedgerOfTheRun,
  theCountersOfTheLedger,
  theRecordAheadOfTheWriter,
} from "./parallel-drive.ts";
import {
  closeTheGroup,
  dshStartDoor,
  membersOfTheGroup,
  prepareTheGroupTrees,
  runTheGroupWorkers,
  type PreparedGroup,
  type PreparedWorker,
  type StartedWorkerPass,
} from "./parallel-group.ts";
import {
  carryOutTheTailOfTheOpenGroup,
  type TheStoppedOfTheResume,
  type TheTailOfTheResumeDrive,
} from "./parallel-resume-drive.ts";
import { theWorkersDirectoryOfTheRun, type TheOpenParallelGroup } from "./parallel-resume.ts";

/* ------------------------------------------------------------------ *
 * The drive facts of a restart.
 * ------------------------------------------------------------------ */

/** The actions of F143-FR-025 this slice carries out — worker passes start. */
export const RESTART_ACTIONS_OF_THE_RESUME = [
  "start-the-group",
  "end-the-recorded-processes",
] as const;
export type RestartActionOfTheResume = (typeof RESTART_ACTIONS_OF_THE_RESUME)[number];

/**
 * THE DRIVE FACTS of a restart: the tail of the eight states (this slice
 * hands the group on to it once the barrier stands), the report of the
 * holder search the wiring ran before the carry-out, and the supervision
 * and door facts of one worker start of THIS engine — the same names the
 * fresh group run takes. Nothing here is resume-specific except the tail
 * and the search, which name where the carry hands on and what was ended.
 */
export type TheRestartOfTheResumeDrive = {
  /** The tail of the eight states, carried out after the barrier stands. */
  readonly tail: TheTailOfTheResumeDrive;
  /** The report of the holder search over the INTERRUPTED run's token. */
  readonly search: LeftoverWorkersReport;
  /* The supervision and the door of a worker start of THIS engine start. */
  readonly model: string;
  readonly modelTierOrEffort: string;
  readonly containment: ContainmentLevel;
  /** The run token of THIS engine start (the door and the hash take it). */
  readonly runToken: string;
  /**
   * The run id of THIS engine start: the started passes' workers directory
   * is named by it, because the identity records they write carry the hash
   * of THIS start's token.
   */
  readonly runId: string;
  readonly timeLimitSec: number;
  readonly enginePid: number;
  readonly engineStartedAtMs: number;
  readonly workersAtATime: number;
  readonly guardScriptPath: string;
  readonly registry: RegistryAccess;
  readonly promptOf: (worker: PreparedWorker) => string;
  readonly outputRootOf: (worker: PreparedWorker) => string;
  /** Only a test hands another start door; the engine hands the real one. */
  readonly startDoor?: ((worker: PreparedWorker) => Promise<StartedWorkerPass>) | undefined;
};

/** What carrying the restart out gave, as `parallel-resume.ts` passes it on. */
export type TheRestartOfAnOpenGroup =
  | {
      readonly carried: true;
      readonly action: RestartActionOfTheResume;
      /** The state of F143-FR-025 the ledger answered with, 1 or 2. */
      readonly state: number;
      /**
       * The carried group, as ONE group attempt of this engine start: the
       * restart's own attempt, or — where a clean stop stood at a boundary
       * the restart polled (F143-FR-026, owed item 4 of par-4) — the tail's
       * attempt marked `stopAfterTheGroup`. Where `stop --now` cut the
       * restarted workers, the attempt is THE CUT ITSELF
       * (`TheGroupAttemptStoppedNow`): nothing more stands in the records.
       */
      readonly attempt: TheGroupAttempt | TheGroupAttemptStoppedNow;
      /** The stop of state 6 the tail met, handed through for the wiring. */
      readonly stopped?: TheStoppedOfTheResume | undefined;
    }
  | {
      /** A group this slice does not carry out — nothing was written. */
      readonly carried: false;
      readonly action: ResumeAction;
      /** The state of F143-FR-025, 1 to 8. */
      readonly state: number;
      /** The reason the carry-out refused the group. */
      readonly because: string;
      readonly says?: string;
    };

/* ------------------------------------------------------------------ *
 * The reads over the interrupted run's own places.
 * ------------------------------------------------------------------ */

/** The records of the ledger file, as it stands at the moment of the read. */
function theRecordsOfTheFile(ledgerFile: string): readonly ResumeRecord[] {
  if (!existsSync(ledgerFile)) return Object.freeze([]);
  return Object.freeze(readAppendedRecords(readFileSync(ledgerFile, "utf8")).records);
}

/** The task a `worker_started` record named for one worker, if any. */
function theTaskOfTheLedger(
  records: readonly ResumeRecord[],
  workerId: string,
): string | undefined {
  let task: string | undefined;
  for (const record of records) {
    if (record.workerId !== workerId || record.kind !== "worker_started") continue;
    const named = record.data?.["task"];
    if (typeof named === "string" && named !== "") task = named;
  }
  return task;
}

/** The task the tree's handoff file names, where the tree still holds it. */
function theTaskOfTheHandoff(tree: string, slug: string): string | undefined {
  const handoffPath = join(tree, handoffOfAWorker(slug));
  if (!existsSync(handoffPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(handoffPath, "utf8")) as { task?: unknown };
    return typeof parsed.task === "string" && parsed.task !== "" ? parsed.task : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The tree the store still holds for one worker of the interrupted group:
 * the index of the worker root names it, and the tree has to be THERE — a
 * tree the host lost is no tree to restart in.
 */
function theHeldTreeOf(
  held: readonly TreeOwnership[],
  runId: string,
  groupId: string,
  workerId: string,
): string | undefined {
  const entry = held.find(
    (row) => row.runId === runId && row.groupId === groupId && row.workerId === workerId,
  );
  return entry !== undefined && existsSync(entry.tree) ? entry.tree : undefined;
}

/* ------------------------------------------------------------------ *
 * THE CARRY-OUT.
 * ------------------------------------------------------------------ */

export async function carryOutTheStartOrRestartOfTheOpenGroup(input: {
  readonly open: TheOpenParallelGroup;
  readonly controlRoot: string;
  /** `--reset-counts` (F100-FR-045): zeroes the counters THIS start writes. */
  readonly resetCounts?: boolean | undefined;
  /**
   * THE PATH OF THE STOP REQUEST (`inbox:stop`), which the restart's wait
   * polls at the same boundaries the fresh group runs under (F143-FR-026):
   * a resumed restart runs worker passes, and a request standing while they
   * run is read there — never seen only at the next fresh boundary (owed
   * item 4 of par-4). Left out, no poll runs.
   */
  readonly stopRequestPath?: string | undefined;
  readonly drive: TheRestartOfTheResumeDrive;
}): Promise<TheRestartOfAnOpenGroup> {
  const { open, drive } = input;
  const groupId = open.groupId;
  const slug = drive.tail.slug;
  const refused = (
    because: string,
    action: ResumeAction,
    state: number,
    says?: string,
  ): TheRestartOfAnOpenGroup =>
    Object.freeze({
      carried: false as const,
      action,
      state,
      because,
      ...(says === undefined ? {} : { says }),
    });

  // The decision is read from the file AGAIN — the holder search ran between
  // discovery and here (CT-143-125), and the restart must be taken over the
  // ledger as it then is.
  const records = theRecordsOfTheFile(open.ledgerFile);
  const decision = decideFromTheLastRecord(records, { groupId });
  const action = decision.action;
  if (action !== "start-the-group" && action !== "end-the-recorded-processes") {
    return refused(
      "the carry-out of this slice answers the states 1 and 2 of F143-FR-025 only; this state belongs to the tail of the resume",
      action,
      decision.state,
      decision.says,
    );
  }
  const state = decision.state;

  // A holder the identity check refused, one the search could not end, and
  // one that still answers after the search — none may have a restart run
  // beside it: the pass the holder is in was never ended by anyone.
  if (drive.search.refused.length > 0 || drive.search.stillAlive.length > 0) {
    return refused(
      `the holder search of run ${open.runId} left ${String(drive.search.refused.length)} refused by the identity check and ${String(drive.search.stillAlive.length)} still answering; no restart may run beside a holder that was never ended`,
      action,
      state,
      decision.says,
    );
  }

  // The per-worker verdicts, as the core decided them over this file.
  const restartMarked = decision.workers.filter((worker) => worker.then === "restart");
  const alreadyEnded = decision.workers.filter((worker) => worker.then === "verify-the-tree-id");
  if (alreadyEnded.length > 0) {
    // LEFT WORK, recorded in results/par-4.progress: a group where some
    // passes finished before the cut needs the tree-id verification of
    // state 3 joined to the restart — the tail carries state 3 alone, not
    // beside a restart.
    return refused(
      `${alreadyEnded.map((worker) => worker.workerId).join(", ")} ended before the interruption: carrying a restart beside a worker_ended record that stands needs the tree-id verification of state 3 joined to this path, which this slice does not carry yet`,
      action,
      state,
      decision.says,
    );
  }

  const ofTheGroup = recordsOfTheGroup(records, groupId);
  const startedRecord = ofTheGroup.find((record) => record.kind === "group_started");
  const baseTreeId = startedRecord?.data?.["baseTree"];

  // The places and the store of the INTERRUPTED run: the trees the restart
  // runs in are that run's, and the ledger the records go on is its too.
  initStore(open.places);
  const ledger = openTheLedgerOfTheRun({
    controlRoot: input.controlRoot,
    runId: open.runId,
    groupId,
    countersOf: theCountersOfTheLedger({
      ledgerFile: open.ledgerFile,
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
    }),
  });
  const store: TreeStoreService = treeStore(open.places, {
    runId: open.runId,
    groupId,
    recordAhead: theRecordAheadOfTheWriter(ledger.writer),
  });

  // THE TWO SHAPES OF THE RESTART.
  const held = treesStillHeld(open.places).filter(
    (entry) => entry.runId === open.runId && entry.groupId === groupId,
  );
  const workers: PreparedWorker[] = [];
  const rows: { workerId: string; restartIndex: number }[] = [];
  const temporaryDirectories: string[] = [];
  const events: EventRequest[] = [];
  const emitEvent = (event: EventRequest): void => {
    events.push(event);
    drive.tail.emit(event.type, event.data as Readonly<Record<string, unknown>>);
  };
  let base: string;

  if (typeof baseTreeId === "string" && baseTreeId !== "") {
    // THE INTERRUPTED PREPARATION: the base snapshot is the one the ledger
    // named at the group's start, and every worker's tree is the one the
    // store still holds — nothing is materialized again.
    const fingerprint = startedRecord?.data?.["workspaceFingerprint"];
    base = typeof fingerprint === "string" && fingerprint !== "" ? fingerprint : baseTreeId;
    const untouched =
      restartMarked.length > 0
        ? restartMarked.map((worker) => {
            const tree = theHeldTreeOf(held, open.runId, groupId, worker.workerId);
            return {
              workerId: worker.workerId,
              // The pass ordinal numbers the restart FROM THE LEDGER: the
              // lost pass was the `restartsUsed`-th, so this one is the next.
              restartIndex: worker.restartsUsed + 1,
              tree,
              task: theTaskOfTheLedger(ofTheGroup, worker.workerId),
            };
          })
        : held.map((entry) => ({
            workerId: entry.workerId,
            // The crash fell between `group_started` and the first start:
            // no pass ever ran, so the truthful index is 0.
            restartIndex: 0,
            tree: entry.tree,
            task: theTaskOfTheHandoff(entry.tree, slug),
          }));
    const missing = untouched.filter((row) => row.tree === undefined || row.task === undefined);
    if (untouched.length === 0 || missing.length > 0) {
      const named = missing
        .map((row) =>
          row.tree === undefined ? `${row.workerId} (no tree)` : `${row.workerId} (no task)`,
        )
        .join(", ");
      return refused(
        untouched.length === 0
          ? `no tree of group ${groupId} stands in the store of run ${open.runId}, and the decision names no worker to restart; the group cannot be carried`
          : `the tree or the task of ${named} stands in neither the ledger nor the tree's handoff; the worker cannot be restarted`,
        action,
        state,
      );
    }
    for (const row of untouched) {
      const tree = row.tree as string;
      const task = row.task as string;
      const outboxPath = join(tree, outboxOfAWorker(slug));
      const handoffPath = join(tree, handoffOfAWorker(slug));
      // A temporary directory BESIDE the tree, fresh for this pass (F143-FR-009).
      const temporaryDirectory = join(
        `${tree}.tmp-resume-${String(row.restartIndex)}`,
        randomBytes(8).toString("hex"),
      );
      mkdirSync(outboxPath, { recursive: true, mode: 0o700 });
      mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
      temporaryDirectories.push(temporaryDirectory);
      // A checkpoint the LOST pass left stands in the outbox and is read as
      // the restart's own: the state-2 contract vouches the tree by the END
      // of the restarted pass (F143-FR-025), and a checkpoint cannot be told
      // from one the restart rewrote by its bytes alone. What the barrier
      // refuses by hash is a checkpoint OF a pass killed DURING this run,
      // which the runner remembers (F143-FR-012).
      workers.push({
        workerId: row.workerId,
        taskId: task,
        tree,
        outboxPath,
        handoffPath,
        temporaryDirectory,
        // The token of the worker is opaque and minted here, in the edge
        // that can reach a random source (F143-FR-009); it is never derived
        // from the token of the pass it replaces.
        workerToken: randomBytes(24).toString("hex"),
      });
      rows.push({ workerId: row.workerId, restartIndex: row.restartIndex });
    }
  } else {
    // STATE 1 — the group never prepared: prepare it NOW, out of THIS pass
    // boundary's plan, and write the `group_started` record ahead of the
    // first start, exactly as the fresh path writes it. The boundary's own
    // verdict stood before this carry-out was reached, so the plan of this
    // start is the plan the group runs under.
    const prepared = await prepareTheGroupTrees({
      store,
      workspace: drive.tail.workspace,
      members: membersOfTheGroup(drive.tail.plan, drive.tail.phase, drive.tail.groupOrdinal),
      slug,
      baseFingerprint: await store.snapshot(drive.tail.workspace),
    });
    base = prepared.baseTreeId;
    for (const worker of prepared.workers) {
      workers.push(worker);
      rows.push({ workerId: worker.workerId, restartIndex: 0 });
      temporaryDirectories.push(worker.temporaryDirectory);
    }
    await ledger.writer.ahead(
      "group_started",
      dataOfTheKind("group_started", {
        baseTree: prepared.baseTreeId,
        workspaceFingerprint: prepared.baseTreeId,
      }),
      () => Promise.resolve(),
    );
    emitEvent(
      groupStartedEvent({
        groupId,
        ordinal: drive.tail.groupOrdinal,
        phase: drive.tail.phase,
        tasks: prepared.workers.map((worker) => worker.taskId),
      }),
    );
  }
  const prepared: PreparedGroup = {
    baseTreeId: base,
    workerTrees: Object.freeze([]),
    workers: Object.freeze(workers),
  };

  // THE LOST PASSES (F143-FR-018): for every worker whose LAST record is a
  // start, the record of the cut pass goes on first, so the ledger says of
  // each pass what the holder search knew — the stream was cut, no tree id
  // stands, the usage is unknown. The end cause is `killed`, because the
  // decision derives the outcome of a not-restarted cut pass from the end
  // the ledger names (F143-FR-025 state 2: "otherwise its outcome is
  // killed"), and `ended` would derive a finished pass that never finished.
  const lastKindOf = new Map<string, string>();
  for (const record of ofTheGroup) {
    if (record.workerId !== undefined) lastKindOf.set(record.workerId, record.kind ?? "");
  }
  for (const [workerId, kind] of lastKindOf) {
    if (kind !== "worker_started") continue;
    await ledger.writer.record(
      "worker_ended",
      dataOfTheKind("worker_ended", {
        workerId,
        endCause: "killed",
        treeId: "",
        fingerprint: "",
        usage: "unknown",
      }),
    );
    emitEvent(
      workerEndedEvent({ workerId, wseq: 2, outcome: "killed", refused: "the pass was cut" }),
    );
  }

  // The workers directory of THIS start: the started passes write their
  // identity records under the hash of THIS start's token, so a later holder
  // search of the interrupted run's directory finds nothing of them there.
  const workersDir = theWorkersDirectoryOfTheRun(input.controlRoot, drive.runId);
  const pidOf = new Map<string, number>();

  try {
    const innerStart =
      drive.startDoor ??
      dshStartDoor({
        model: drive.model,
        modelTierOrEffort: drive.modelTierOrEffort,
        containment: drive.containment,
        runToken: drive.runToken,
        timeLimitMs: drive.timeLimitSec * 1000,
        promptOf: drive.promptOf,
        outputRootOf: drive.outputRootOf,
      });
    // Each worker tree as the store holds it NOW, before any pass runs — the
    // fingerprint the `worker_started` record carries (F142-FR-028).
    const treeFingerprintOf = new Map<string, string>();
    for (const worker of prepared.workers) {
      treeFingerprintOf.set(worker.workerId, await store.snapshot(worker.tree));
    }
    const run = await runTheGroupWorkers({
      prepared,
      supervision: {
        enginePid: drive.enginePid,
        engineStartedAtMs: drive.engineStartedAtMs,
        runTokenHash: hashOfTheRunToken(drive.runToken),
        workersDir,
        guardScriptPath: drive.guardScriptPath,
        ceilingSec: drive.timeLimitSec,
        registry: drive.registry,
      },
      workersAtATime: drive.workersAtATime,
      restartIndexOf: (workerId) => rows.find((row) => row.workerId === workerId)?.restartIndex,
      start: async (worker) => {
        const started = await innerStart(worker);
        pidOf.set(worker.workerId, started.pid);
        return started;
      },
      record: async (kind, workerId, facts) => {
        await ledger.writer.record(
          "worker_started",
          dataOfTheKind("worker_started", {
            workerId,
            task: facts.task,
            passId: `${groupId}:${workerId}:pass${String(facts.restartIndex + 1)}`,
            // THE TRIPLE AS CORE WRITES AND READS IT (`passOrdinalOf`): the
            // resume decision (F143-FR-025) and the counters (F143-FR-028)
            // both read the RESTART INDEX out of this field, and they read an
            // array of three, not a string joined by colons.
            passOrdinal: [
              ...passOrdinalOf({
                groupOrdinal: drive.tail.groupOrdinal,
                taskPosition: facts.taskPosition,
                restartIndex: facts.restartIndex,
              }),
            ],
            treeFingerprint: treeFingerprintOf.get(workerId) ?? "",
            pid: facts.pid,
            startTime: facts.startTime,
          }),
        );
        emitEvent(workerStartedEvent({ workerId, wseq: 1, taskId: facts.task, groupId }));
      },
      // THE STOP THE RESTART RUNS UNDER (F143-FR-026, owed item 4 of par-4):
      // the same poll the fresh group runs — read at the boundaries the wait
      // already runs, never inside a pass (F122-FR-029). Left out, the poll
      // does not run and the restart is exactly as it was.
      ...(input.stopRequestPath === undefined
        ? {}
        : { stop: { requestPath: input.stopRequestPath } }),
    });

    if (!run.ok) {
      // The answer to a start refusal is the fresh path's own: the search
      // ends what an aborted start left behind over THIS start's token, the
      // trees are released, and the group closes failed — its tasks back on
      // the main line, the ledger closed so no open group stands.
      await endTheLeftoverWorkers({
        workersDir,
        runTokenHash: hashOfTheRunToken(drive.runToken),
      });
      await closeTheGroupRun({
        places: open.places,
        writer: ledger.writer,
        store,
        runId: open.runId,
        groupId,
        outcome: "failed",
        prepared,
      });
      emitEvent(groupEndedEvent({ groupId, outcome: "failed", refused: prepared.workers.length }));
      return refused(
        `the restart of ${run.workerId} was refused by the start door: ${run.message}; the group closed failed and its tasks run on the main line`,
        action,
        state,
      );
    }

    if (run.stop?.now === true) {
      /* ---- `stop --now` ON THE CARRIED RESTART (F143-FR-026, owed item 4
       * of par-4): the restarted workers ended after the identity check, and
       * the group is LEFT TO THE STATES OF F143-FR-025 — no barrier, no
       * integration, no `group_closed`; the ledger of the interrupted run
       * stands as the cut left it, the trees stand, and the next engine
       * start decides from the last record. The answer is the cut attempt
       * itself, which the wiring answers as the run's stop (F143-FR-026). ---- */
      return Object.freeze({
        carried: true,
        action,
        state,
        attempt: {
          ok: true,
          groupId,
          stoppedByStopNow: true,
          events: Object.freeze(events),
        } as TheGroupAttemptStoppedNow,
      });
    }
    // A CLEAN stop changes nothing inside the restart (F143-FR-026): the
    // workers ran to the ends of their passes and the barrier, the audits
    // and the merge check run through `group_closed` below — the stop takes
    // effect at the boundary after the group, which the carried attempt
    // marks (the tail's own attempt cannot carry it: the tail runs no poll).
    const cleanStopSeen = run.stop !== undefined && run.stop.now === false;

    // THE BARRIER (F143-FR-017), over the started passes only: the ends are
    // the door's, the pid map is the last resort's, and the checkpoint
    // hashes the runner took at a kill DURING this run name the checkpoints
    // OF the killed passes (F143-FR-012).
    const barrier = await closeTheGroup({
      store,
      workspace: drive.tail.workspace,
      prepared,
      ends: run.ends,
      pidOf: (workerId) => pidOf.get(workerId),
      record: async (kind, data) => {
        await ledger.writer.record(kind, dataOfTheKind(kind, data));
      },
      emitEvent: async () => {
        // The tree-changed and yield-refusal events of the barrier are not
        // shown to the critic; the verdicts reach the worker events emitted
        // just below, as the fresh path emits them.
      },
      checkpointLeftByAKilledPass: run.checkpointLeftByAKilledPass,
    });
    for (const row of barrier.perWorker) {
      const outcome = row.outcome.outcome;
      emitEvent(
        workerEndedEvent({
          workerId: row.workerId,
          wseq: 2,
          outcome,
          ...(outcome === "refused" && row.outcome.reason !== undefined
            ? { refused: row.outcome.reason }
            : {}),
        }),
      );
    }

    // THE TAIL: the last record is `group_barrier`, so the tail re-decides
    // into state 4 and carries the audits, the composition, the application,
    // the ticks, the merge check and the close of the interrupted run's
    // group — answered as ONE group attempt of this engine start. The writer
    // of THIS opening is released first: two writers over one ledger within
    // one process are refused, not merged.
    releaseTheWriter(`${open.runId}:ledger`);
    const tail = await carryOutTheTailOfTheOpenGroup({
      open,
      controlRoot: input.controlRoot,
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
      drive: drive.tail,
    });
    if (!tail.carried) {
      return refused(
        `the barrier stood, but the tail of the resume refused the group: ${tail.says ?? "no reason given"}`,
        action,
        tail.state,
      );
    }
    return Object.freeze({
      carried: true,
      action,
      state,
      attempt: cleanStopSeen
        ? ({ ...tail.attempt, stopAfterTheGroup: true } as TheGroupAttempt & {
            readonly stopAfterTheGroup: true;
          })
        : tail.attempt,
      ...(tail.stopped === undefined ? {} : { stopped: tail.stopped }),
    });
  } finally {
    releaseTheWriter(`${open.runId}:ledger`);
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
