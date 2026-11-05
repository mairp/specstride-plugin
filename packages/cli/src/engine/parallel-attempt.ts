/**
 * THE RUN OF ONE GROUP OF ONE PHASE ATTEMPT, END TO END (step 3 of
 * `prompts/specstride-parallel-units.md`; F142-FR-018 to F142-FR-067,
 * F143-FR-005 to F143-FR-027). This module is THE ORCHESTRATION SLICE: it
 * takes one group of the plan and drives it through the state sequence of
 * `data-model.md`, on the real store, the real ledger file, the real barrier
 * and a real check runner, and it emits every `parallel.*` event LIVE, as
 * the layer's own builders built them:
 *
 *     group_started → worker_started ×N → worker_ended ×N → group_barrier
 *     → audit_done → merge_done → apply_started → applied → ticks_applied
 *     → merge_check_started → merge_check_finished → group_closed
 *
 * Every decision along the way is already made elsewhere — the preparation,
 * the run and the barrier in `parallel-group.ts`, the audits, the
 * integration, the merge check and the close in `parallel-drive.ts`, the
 * keep/repair/switch-off directive in `packages/layer-parallel`. What is new
 * here is only the JOINING and the three decisions a join must take:
 *
 *  - `passOrdinal` is the triple `(groupOrdinal, taskPosition, restartIndex)`
 *    in the array form core's own `passOrdinalOf` writes and the resume
 *    (F143-SC-002) and the counters (F143-FR-028) read, and `passId` is
 *    `${groupId}:${workerId}:pass${restartIndex + 1}`; within one
 *    call the restart index is 0 — a restart happens on a relaunch, which is
 *    the wiring slice's business (F143-FR-013);
 *  - the fingerprints (a) to (g) of F142-FR-063 are taken HERE, through the
 *    one `snapshot` of the store: (a) the workspace at group start — the
 *    FIRST snapshot the service takes, which makes it the base; (b) each
 *    worker tree right after its creation, before any pass runs; (c) to (g)
 *    the barrier and the drive take their own;
 *  - a failure that is no member of row 185 — an overlap in the composition,
 *    or no worker left integrated — ends the group as FAILED with the
 *    directive `none`: the tasks return to the main line (the first of the
 *    three ends, F142-FR-004), the layer stays on, and the wiring counts the
 *    failed group toward `group-failures`.
 *
 * WHAT IS NOT HERE, AND WHAT THIS MODULE DOES NOT DECIDE: the call site in
 * `run-feature.ts` — which groups of which attempts run, what returns to the
 * main line, the exclusion of the group's tasks from the serial passes, the
 * `[LOOP] parallel=` line, the counters of the attempt, the restart-once of
 * F143-FR-013 and the `[P]` overlap refusal — the wiring slice. The audit
 * inputs (`prefixesOf`, the protected set, the single-writer reading) arrive
 * through this module's input, because they read the launch-time state only
 * the composition root holds.
 *
 * A start refusal is answered HERE with the survivor search of F143-FR-018,
 * exactly as `parallel-group.ts` tells its caller to: the workers an aborted
 * start left behind are ended by the runner's search, the trees are released
 * and a `group_closed` record of outcome `failed` closes the group.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import type {
  CheckRunner,
  ContainmentLevel,
  ManifestEntry,
} from "@specstride/contracts/ep/check-runner";
import type { TreeId, TreeStoreService } from "@specstride/contracts/ep/tree-store";
import type { RegistryAccess } from "../../../core/src/pass-supervision/ports.ts";
import type {
  PathLeakSecrets,
  ProtectedSet,
  SingleWriterReading,
} from "../../../core/src/parallel/audits.ts";
import type { BarrierResult } from "../../../core/src/parallel/barrier.ts";
import { passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import type { IntegrationResult, TickOutcome } from "../../../core/src/parallel/integrate.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { initStore, treeStore, type StorePlaces } from "../../../tree-store/src/index.ts";
import {
  groupEndedEvent,
  groupStartedEvent,
  handoffText,
  integrationEvent,
  layerOffFor,
  workerEndedEvent,
  workerStartedEvent,
  type EventRequest,
  type GroupOutcome,
  type LayerOffDecision,
  type ParallelPlan,
  type WorkerOutcome,
} from "../../../layer-parallel/src/index.ts";
import { endTheLeftoverWorkers } from "./group-run.ts";
import {
  closeTheGroup,
  dshStartDoor,
  membersOfTheGroup,
  placesOfTheParallelStore,
  prepareTheGroupTrees,
  runTheGroupWorkers,
  WorkerStartRefused,
  type PreparedGroup,
  type PreparedWorker,
  type StartedWorkerPass,
} from "./parallel-group.ts";
import {
  auditTheGroupThroughTheStore,
  closeTheGroupRun,
  dataOfTheKind,
  integrateThroughTheStore,
  openTheLedgerOfTheRun,
  parallelLedgerPathOf,
  readTheDeltasOfTheGroup,
  theCountersOfTheLedger,
  theMergeCheckOfTheGroup,
  theRecordAheadOfTheWriter,
  theWorkersForIntegration,
  type GroupAudit,
  type TheMergeCheck,
} from "./parallel-drive.ts";

/** The opaque id of the group of one phase attempt (F142-FR-025). */
export function groupIdOfTheAttempt(phase: number, groupOrdinal: number): string {
  return `g-${String(phase)}-${String(groupOrdinal)}`;
}

/** The directives the wiring may be asked to carry out after one group. */
export type GroupAttemptDirective = "keep" | "repair" | "none" | "layerOffForAttempt";

/** What closing the run of one group gave, as this module returns it. */
export type TheClosedGroup = Awaited<ReturnType<typeof closeTheGroupRun>>;

/**
 * THE SUMMARY OF ONE GROUP. `outcome` is the group's outcome in the closed
 * set; `directive` is what the wiring carries out next; `keptUnits` are the
 * kept units of work (F100-FR-124), each the sorted task ids of one kept
 * group — the before-critic input is `handoff` below; `tasksOnTheMainLine`
 * are the tasks the wiring must run serially after this group.
 */
export type TheGroupAttempt = {
  readonly ok: true;
  readonly groupId: string;
  readonly outcome: GroupOutcome;
  readonly directive: GroupAttemptDirective;
  /** The layer's switch-off decision, where the end is one of the two. */
  readonly layerOff: LayerOffDecision | null;
  /** The kept units of work, each the sorted task ids of one kept group. */
  readonly keptUnits: readonly (readonly string[])[];
  /** The text of the kept units, as the before-critic input (F142-FR-069). */
  readonly handoff: string;
  /** The tasks the wiring runs on the main line after this group. */
  readonly tasksOnTheMainLine: readonly string[];
  readonly baseTreeId: TreeId;
  readonly barrier: BarrierResult;
  readonly audit: GroupAudit;
  /**
   * The integration of the group, where one ran. A group that integrated
   * nothing reached no `compose` at all, so it carries none — there is no
   * result to hold, and the shape `{integrated: false}` would name this end
   * a compose refusal, which it is not.
   */
  readonly integration?: IntegrationResult | undefined;
  /** The merge check; absent where nothing was integrated to check. */
  readonly merge?: TheMergeCheck | undefined;
  readonly closed: TheClosedGroup;
  readonly counts: {
    /** The workers whose delta an audit refused. */
    readonly refused: number;
    /** The wall time of the group, from its start to its close. */
    readonly wallMs: number;
    /** The agent time of the group; `0` where no usage reached this slice. */
    readonly agentMs: number;
  };
  readonly events: readonly EventRequest[];
  /**
   * A CLEAN STOP STOOD WHILE THE GROUP RAN (F143-FR-026): the workers ran to
   * the ends of their passes and the group closed whole — the stop takes
   * effect now, after `group_closed`, at the boundary that follows.
   */
  readonly stopAfterTheGroup?: true | undefined;
};

/** A start refusal: the group never started whole. */
export type TheGroupAttemptRefused = {
  readonly ok: false;
  readonly groupId: string;
  readonly workerId: string;
  readonly message: string;
  /** The workers the survivor search ended (F143-FR-018). */
  readonly endedByTheSearch: readonly { readonly workerId: string; readonly pid: number }[];
  readonly closed: TheClosedGroup | null;
  readonly events: readonly EventRequest[];
};

/**
 * A GROUP A `stop --now` CUT (F143-FR-026). The workers ended after the
 * identity check, and the group is LEFT TO THE STATES OF F143-FR-025: no
 * barrier, no integration, no merge check, no `group_closed` — the ledger
 * stands as the kill left it, the trees stand, and the next engine start
 * decides from the last record. The run itself stops; nothing here is an
 * outcome of a group.
 */
export type TheGroupAttemptStoppedNow = {
  readonly ok: true;
  readonly groupId: string;
  readonly stoppedByStopNow: true;
  readonly events: readonly EventRequest[];
};

/** The hash of THIS run's token — the hash, never the token (F122-FR-024). */
export function hashOfTheRunToken(runToken: string): string {
  return createHash("sha256").update(runToken).digest("hex");
}

/**
 * RUN ONE GROUP OF ONE PHASE ATTEMPT. The input is everything the composition
 * root holds at the pass boundary; nothing is decided here that a core or
 * layer module already decides.
 */
export async function runTheGroupOfTheAttempt(input: {
  readonly controlRoot: string;
  readonly runId: string;
  /** The home directory the worker root hangs off (`placesOfTheParallelStore`). */
  readonly home: string;
  readonly plan: ParallelPlan;
  readonly phase: number;
  readonly groupOrdinal: number;
  readonly workspace: string;
  /** The feature slug, which names the outbox and the handoff of a worker. */
  readonly slug: string;
  /** The path of the task list, relative to the workspace (dropped from deltas). */
  readonly taskListPath?: string | undefined;
  /* The start door of a worker pass; the real one is `dshStartDoor`. */
  readonly model: string;
  readonly modelTierOrEffort: string;
  readonly containment: ContainmentLevel;
  readonly runToken: string;
  /** The pass ceiling of the workers, in seconds. */
  readonly timeLimitSec: number;
  readonly promptOf: (worker: PreparedWorker) => string;
  /** Where the two outputs of a worker pass go (`dshStartDoor`). */
  readonly outputRootOf: (worker: PreparedWorker) => string;
  /** A door the caller hands in where the real one cannot run (the tests). */
  readonly startDoor?: ((worker: PreparedWorker) => Promise<StartedWorkerPass>) | undefined;
  /* The supervision of the runner of step 2. */
  readonly enginePid: number;
  readonly engineStartedAtMs: number;
  readonly workersAtATime: number;
  readonly guardScriptPath: string;
  readonly registry: RegistryAccess;
  /* The audits, from the launch-time state. */
  readonly prefixesOf?: ((workerId: string) => readonly string[]) | undefined;
  readonly protectedSet?: ProtectedSet | undefined;
  /** The task list EXACTLY as it was read at launch (F142-FR-055). */
  readonly taskTextAtLaunch: string;
  /**
   * The secrets of the path-leak audit (F142-FR-057): the run slice calls it
   * with the worker's id AND the opaque token of THAT worker, which the
   * preparation knows and no caller outside this run does.
   */
  readonly secretsOf: (workerId: string, workerToken: string) => PathLeakSecrets;
  readonly singleWriter: SingleWriterReading;
  /** Set where the workspace at the barrier differs from the workspace at start. */
  readonly workspaceChanged?: boolean | undefined;
  /**
   * `--reset-counts` (F100-FR-045, F143-FR-028): the engine start that asks
   * for it writes zeroed counters on every record it writes. It is a decision
   * of one engine start and never a state of the run, which is why it arrives
   * here and is not read from the run.
   */
  readonly resetCounts?: boolean | undefined;
  /* The integration and the merge check. */
  readonly tick: (taskIds: readonly string[]) => Promise<TickOutcome>;
  readonly runner: CheckRunner;
  readonly innerCheckSet: readonly ManifestEntry[];
  readonly environmentAllowList?: readonly string[] | undefined;
  /** The canonical hash of annex X §X.5, which names the unit. */
  readonly hash: (text: string) => string;
  /* The live events, as the engine emits them (F142-FR-025). */
  readonly emit: (event: EventRequest) => void;
  /**
   * THE PATH OF THE STOP REQUEST (`inbox:stop`, annex B §B.5), which the
   * group's wait polls at its boundaries (F143-FR-026). Left out, no poll
   * runs — the behaviour with the join off is the single-pass behaviour.
   */
  readonly stopRequestPath?: string | undefined;
  readonly say?: ((line: string) => void) | undefined;
}): Promise<TheGroupAttempt | TheGroupAttemptRefused | TheGroupAttemptStoppedNow> {
  const groupId = groupIdOfTheAttempt(input.phase, input.groupOrdinal);
  const startedAtMs = Date.now();
  const events: EventRequest[] = [];
  const emit = (event: EventRequest): void => {
    events.push(event);
    input.emit(event);
  };
  const workersDir = join(input.controlRoot, "runs", input.runId, "workers");
  const members = membersOfTheGroup(input.plan, input.phase, input.groupOrdinal);
  const tasksOfTheGroup = members.map((member) => member.taskId);
  const places: StorePlaces = placesOfTheParallelStore({
    controlRoot: input.controlRoot,
    runId: input.runId,
    home: input.home,
  });
  const ledgerName = `${input.runId}:ledger`;
  const ledger = openTheLedgerOfTheRun({
    controlRoot: input.controlRoot,
    runId: input.runId,
    groupId,
    // F143-FR-028 — every record leaves the disk carrying the counters of the
    // layer as they stand after it, derived from the file itself, so a
    // relaunch continues them without any mechanism beyond the ledger.
    countersOf: theCountersOfTheLedger({
      ledgerFile: parallelLedgerPathOf(input.controlRoot, input.runId),
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
    }),
  });
  initStore(places);
  const store: TreeStoreService = treeStore(places, {
    runId: input.runId,
    groupId,
    ...(input.taskListPath === undefined ? {} : { taskListPath: input.taskListPath }),
    recordAhead: theRecordAheadOfTheWriter(ledger.writer),
  });
  /** The pid of each started pass, for the barrier's own last resort. */
  const pidOf = new Map<string, number>();

  try {
    /* ---- (a) the workspace at group start: the FIRST snapshot the service
     * takes, which makes it the base of the group (F142-FR-063 (a)). ---- */
    const workspaceAtStart = await store.snapshot(input.workspace);
    const prepared = await prepareTheGroupTrees({
      store,
      workspace: input.workspace,
      members,
      slug: input.slug,
      baseFingerprint: workspaceAtStart,
      baseTreeId: workspaceAtStart,
    });
    /* ---- (b) each worker tree after creation, before any pass runs. ---- */
    const treeFingerprintOf = new Map<string, string>();
    for (const worker of prepared.workers) {
      treeFingerprintOf.set(worker.workerId, await store.snapshot(worker.tree));
    }
    await ledger.writer.ahead(
      "group_started",
      dataOfTheKind("group_started", {
        baseTree: prepared.baseTreeId,
        workspaceFingerprint: workspaceAtStart,
      }),
      () => Promise.resolve(),
    );
    emit(
      groupStartedEvent({
        groupId,
        ordinal: input.groupOrdinal,
        phase: input.phase,
        tasks: tasksOfTheGroup,
      }),
    );
    input.say?.(`[LOOP] parallel group ${groupId} of phase ${String(input.phase)} started`);

    /* ---- the workers, and the one `worker_started` per worker. ---- */
    const innerStart =
      input.startDoor ??
      dshStartDoor({
        model: input.model,
        modelTierOrEffort: input.modelTierOrEffort,
        containment: input.containment,
        runToken: input.runToken,
        timeLimitMs: input.timeLimitSec * 1000,
        promptOf: input.promptOf,
        outputRootOf: input.outputRootOf,
      });
    const run = await runTheGroupWorkers({
      prepared,
      supervision: {
        enginePid: input.enginePid,
        engineStartedAtMs: input.engineStartedAtMs,
        runTokenHash: hashOfTheRunToken(input.runToken),
        workersDir,
        guardScriptPath: input.guardScriptPath,
        ceilingSec: input.timeLimitSec,
        registry: input.registry,
      },
      workersAtATime: input.workersAtATime,
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
                groupOrdinal: input.groupOrdinal,
                taskPosition: facts.taskPosition,
                restartIndex: facts.restartIndex,
              }),
            ],
            treeFingerprint: treeFingerprintOf.get(workerId) ?? "",
            pid: facts.pid,
            startTime: facts.startTime,
          }),
        );
        emit(workerStartedEvent({ workerId, wseq: 1, taskId: facts.task, groupId }));
      },
      ...(input.stopRequestPath === undefined
        ? {}
        : { stop: { requestPath: input.stopRequestPath } }),
      say: input.say,
    });
    if (!run.ok) {
      /* ---- THE ANSWER TO A START REFUSAL (F143-FR-018): the survivor
       * search ends what an aborted start left behind, the trees are
       * released, and the group closes with the outcome `failed`. ---- */
      const search = await endTheLeftoverWorkers({
        workersDir,
        runTokenHash: hashOfTheRunToken(input.runToken),
        say: input.say,
      });
      const closed = await closeTheGroupRun({
        places,
        writer: ledger.writer,
        store,
        runId: input.runId,
        groupId,
        outcome: "failed",
        prepared,
      });
      emit(groupEndedEvent({ groupId, outcome: "failed", refused: prepared.workers.length }));
      input.say?.(`[LOOP] parallel group ${groupId} refused at start: ${run.message}`);
      return {
        ok: false,
        groupId,
        workerId: run.workerId,
        message: run.message,
        endedByTheSearch: search.ended,
        closed,
        events: Object.freeze(events),
      };
    }
    if (run.stop?.now === true) {
      /* ---- `stop --now` (F143-FR-026): the workers ended after the
       * identity check, and the group is LEFT TO THE STATES OF
       * F143-FR-025 — nothing more is written, the ledger stands as the
       * kill left it, the trees stand, and the next engine start decides
       * from the last record. ---- */
      input.say?.(
        `[LOOP] parallel group ${groupId} stopped by stop --now — the ledger stands, the resume decides (F143-FR-025)`,
      );
      return {
        ok: true,
        groupId,
        stoppedByStopNow: true,
        events: Object.freeze(events),
      };
    }

    /* ---- THE BARRIER (F143-FR-017), and the one `worker_ended` per worker. ---- */
    const barrier = await closeTheGroup({
      store,
      workspace: input.workspace,
      prepared,
      ends: run.ends,
      pidOf: (workerId) => pidOf.get(workerId),
      record: async (kind, data) => {
        await ledger.writer.record(kind, dataOfTheKind(kind, data));
      },
      emitEvent: async () => {
        // The tree-changed and yield-refusal events of the barrier join the
        // run's event file, which the wiring owns; the barrier's verdicts
        // reach the worker events emitted just below.
      },
      checkpointLeftByAKilledPass: run.checkpointLeftByAKilledPass,
    });
    for (const row of barrier.perWorker) {
      const outcome: WorkerOutcome = row.outcome.outcome;
      emit(
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

    /* ---- THE DELTAS AND THE AUDITS (F142-FR-054 to F142-FR-058). ---- */
    const deltas = await readTheDeltasOfTheGroup({
      store,
      baseTreeId: prepared.baseTreeId,
      workers: barrier.perWorker.map((row) => ({
        workerId: row.workerId,
        treeId: row.finalTreeId,
        treePath: prepared.workers.find((worker) => worker.workerId === row.workerId)?.tree ?? "",
      })),
    });
    const audit = await auditTheGroupThroughTheStore({
      writer: ledger.writer,
      deltas,
      prefixesOf:
        input.prefixesOf ??
        ((workerId) => {
          const worker = prepared.workers.find((row) => row.workerId === workerId);
          const member = members.find((row) => row.taskId === worker?.taskId);
          return member?.scopePrefixes ?? [];
        }),
      protectedSet: input.protectedSet ?? { paths: [], patterns: [] },
      taskTextAtLaunch: input.taskTextAtLaunch,
      secretsOf: (workerId) => {
        const worker = prepared.workers.find((row) => row.workerId === workerId);
        return input.secretsOf(workerId, worker?.workerToken ?? "");
      },
      singleWriter: input.singleWriter,
      ...(input.workspaceChanged === undefined ? {} : { workspaceChanged: input.workspaceChanged }),
    });
    emit(
      integrationEvent({
        groupId,
        step: "audit",
        pathCount: deltas.reduce((sum, delta) => sum + delta.paths.length, 0),
      }),
    );

    /* ---- THE INTEGRATION (F143-FR-014, F143-FR-019 to F143-FR-021). ---- */
    const taskOfWorker = new Map(
      prepared.workers.map((worker) => [worker.workerId, worker.taskId]),
    );
    const workersForIntegration = await theWorkersForIntegration({
      store,
      baseTreeId: prepared.baseTreeId,
      barrier,
      taskOf: (workerId) => taskOfWorker.get(workerId) ?? "",
      ends: run.ends,
      verdicts: audit.verdicts,
    });
    const integrated = workersForIntegration.filter(
      (worker) => worker.outcome.outcome === "integrated",
    );
    const failedWith = async (
      reason: string,
      theIntegration?: IntegrationResult,
    ): Promise<TheGroupAttempt> => {
      const closed = await closeTheGroupRun({
        places,
        writer: ledger.writer,
        store,
        runId: input.runId,
        groupId,
        outcome: "failed",
        prepared,
      });
      emit(groupEndedEvent({ groupId, outcome: "failed", refused: audit.refused.length }));
      input.say?.(`[LOOP] parallel group ${groupId} failed: ${reason}`);
      return {
        ok: true,
        groupId,
        outcome: "failed",
        directive: "none",
        layerOff: null,
        keptUnits: [],
        handoff: "",
        tasksOnTheMainLine: tasksOfTheGroup,
        baseTreeId: prepared.baseTreeId,
        barrier,
        audit,
        ...(theIntegration === undefined ? {} : { integration: theIntegration }),
        closed,
        ...(run.stop !== undefined && run.stop.now === false ? { stopAfterTheGroup: true } : {}),
        counts: {
          refused: audit.refused.length,
          wallMs: Date.now() - startedAtMs,
          agentMs: 0,
        },
        events: Object.freeze(events),
      };
    };
    if (integrated.length === 0) {
      // No worker left integrated: there is no composition, no application,
      // no ticks and no merge check — a merge check over an unchanged
      // workspace would keep an EMPTY unit, which F142-FR-059 forbids. The
      // group fails with the directive `none`: the tasks return to the main
      // line, the layer stays on, and the wiring counts the failure.
      return await failedWith("no worker left integrated");
    }
    const integration = await integrateThroughTheStore({
      store,
      writer: ledger.writer,
      tick: input.tick,
      baseTreeId: prepared.baseTreeId,
      workspace: input.workspace,
      workers: workersForIntegration,
    });
    emit(
      integrationEvent({
        groupId,
        step: "compose",
        pathCount: integrated.reduce((sum, worker) => sum + worker.paths.length, 0),
      }),
    );
    if (!integration.integrated) {
      // An overlap in the composition: nothing was applied (F143-FR-019),
      // so no merge check runs either. The group fails with the directive
      // `none` — the tasks return to the main line, and the overlap stays
      // scheduling history (F142-FR-067).
      return await failedWith(
        `the composition refused an overlap (${integration.reason})`,
        integration,
      );
    }
    emit(integrationEvent({ groupId, step: "apply", pathCount: integration.paths.length }));
    emit(integrationEvent({ groupId, step: "tick", pathCount: integration.ticked.length }));

    /* ---- THE MERGE CHECK (F142-FR-059 to F142-FR-061), in the workspace. ---- */
    const merge = await theMergeCheckOfTheGroup({
      store,
      writer: ledger.writer,
      runner: input.runner,
      innerCheckSet: input.innerCheckSet,
      workspace: input.workspace,
      containment: input.containment,
      ...(input.environmentAllowList === undefined
        ? {}
        : { environmentAllowList: input.environmentAllowList }),
      tasks: integration.ticked,
      hash: input.hash,
    });
    emit(integrationEvent({ groupId, step: "merge-check", pathCount: merge.run.commands.length }));

    /* ---- THE CLOSE (F143-FR-027), and the group's outcome. ---- */
    const integratedTasks = [...integration.ticked];
    const returnedTasks = tasksOfTheGroup.filter((task) => !integratedTasks.includes(task));
    let outcome: GroupOutcome;
    let directive: GroupAttemptDirective;
    let layerOff: LayerOffDecision | null = null;
    let keptUnits: readonly (readonly string[])[] = [];
    if (merge.outcome.directive === "keep") {
      outcome = "kept";
      directive = "keep";
      keptUnits = [Object.freeze([...integratedTasks].sort())];
    } else if (merge.outcome.directive === "repair") {
      outcome = "repair";
      directive = "repair";
    } else {
      // `layerOffForAttempt` — the inner check set was empty when the merge
      // check was due (reason `unchecked`, row 185): the layer is off for
      // the phase attempt and the micro-loop layer carries on serially
      // (F142-FR-023).
      outcome = "failed";
      directive = "layerOffForAttempt";
      layerOff = layerOffFor("unchecked", { groupId, detail: merge.outcome.reason });
    }
    const closed = await closeTheGroupRun({
      places,
      writer: ledger.writer,
      store,
      runId: input.runId,
      groupId,
      // A group that ended `kept` closed whole; a `repair` or a `failed`
      // group is ONE FAILED GROUP either way (F142-FR-023), and the close
      // says so.
      outcome: outcome === "kept" ? "closed" : "failed",
      prepared,
      workerOutcomes: Object.fromEntries(
        barrier.perWorker.map((row) => [row.workerId, row.outcome.outcome]),
      ),
    });
    emit(groupEndedEvent({ groupId, outcome, refused: audit.refused.length }));
    input.say?.(
      `[LOOP] parallel group ${groupId} ended: ${outcome}${
        audit.refused.length > 0 ? `, ${String(audit.refused.length)} delta(s) refused` : ""
      }`,
    );
    return {
      ok: true,
      groupId,
      outcome,
      directive,
      layerOff,
      keptUnits,
      handoff: handoffText(keptUnits),
      tasksOnTheMainLine: outcome === "kept" ? returnedTasks : tasksOfTheGroup,
      baseTreeId: prepared.baseTreeId,
      barrier,
      audit,
      integration,
      merge,
      closed,
      ...(run.stop !== undefined && run.stop.now === false ? { stopAfterTheGroup: true } : {}),
      counts: {
        refused: audit.refused.length,
        wallMs: Date.now() - startedAtMs,
        agentMs: 0,
      },
      events: Object.freeze(events),
    };
  } catch (error) {
    // A start refusal that escapes the runner (a refusal of the door while
    // the group was already coming up) is the same typed answer; the writer
    // is released in the block below, and the search is the wiring's next
    // step, exactly as `parallel-group.ts` tells its caller.
    if (error instanceof WorkerStartRefused) {
      return {
        ok: false,
        groupId,
        workerId: error.workerId,
        message: error.message,
        endedByTheSearch: [],
        closed: null,
        events: Object.freeze(events),
      };
    }
    throw error;
  } finally {
    releaseTheWriter(ledgerName);
  }
}

/** The workers of a prepared group, as the tests and the wiring read them. */
export type { PreparedGroup };
