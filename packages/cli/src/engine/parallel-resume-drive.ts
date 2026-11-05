/* ------------------------------------------------------------------ *
 * THE TAIL OF THE RESUME (F143-FR-025) — the engine's carry-out of the
 * states the ledger answers with no worker process to start.
 *
 * WHAT THIS SLICE CARRIES OUT. Five of the eight states, the ones where the
 * ledger alone says what is left:
 *
 *  - state 3, `verify-the-tree-id` — every worker's pass is over and its
 *    `worker_ended` record stands. Each tree id the ledger names is checked
 *    against the store; a worker whose snapshot is not there any more is
 *    REFUSED, never integrated (the core's own reading of state 3). The
 *    barrier is closed again — `worker_ended` records stand, only
 *    `group_barrier` is written, ahead of the audits — and then the group
 *    goes on: audits, composition, application, ticks, merge check, close.
 *  - state 4, `repeat-from-the-audits` — the barrier stands. The workspace is
 *    verified against the fingerprint at group start; where it moved, the
 *    audits refuse every worker (`workspace-changed`) and the group fails.
 *    Where it stands, the audits are repeated — a second `audit_done` is the
 *    protocol's own repeat — and the group goes on.
 *  - state 5, `repeat-the-application` — the audits and the composition
 *    stand. The verification of states 5 and 6 runs over the composed delta;
 *    on a pass the application is repeated IN FULL (compose, apply, ticks),
 *    on a stop (state 6) NOTHING MORE IS WRITTEN but the close of the group,
 *    the event `apply-incomplete` goes out with the integrity kind
 *    `tree-changed-outside-pass`, and the loop layer goes off for the run.
 *  - state 7, `write-the-ticks` — `applied` without `ticks_applied`: the
 *    ticks alone are written, through the spec-format adapter, under
 *    `ticks_applied`.
 *  - state 8, `run-the-merge-check` — the ticks stand: the merge check runs
 *    over the tasks the ticks named, and the group closes on its outcome.
 *
 * WHAT IS NOT HERE, and stays `carried: false`: states 1 and 2 and any
 * per-worker verdict `restart` — those need a worker process to start, which
 * is no part of this slice. Nothing in this module starts a process, holds a
 * run token, or writes a `worker_started` record.
 *
 * THE LEDGER the records go on is the INTERRUPTED run's own (F143-FR-024):
 * the one writer opens over the file AS IT STANDS, so `seq` rises without a
 * gap and the counters continue from the file (F143-FR-028). The decision is
 * read from the file AGAIN inside this module — the holder search ran between
 * discovery and here, and the decision must be taken over the ledger as it
 * then is (CT-143-125).
 *
 * THE REFERENCE for every order here is the characterization engine of
 * F143 (`tests/characterization/143/support/engine.ts`), read back through
 * the real doors of `parallel-drive.ts`.
 * ------------------------------------------------------------------ */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  CheckRunner,
  ContainmentLevel,
  ManifestEntry,
} from "@specstride/contracts/ep/check-runner";
import type {
  DeltaRefusalReason,
  PathLeakSecrets,
  ProtectedSet,
  SingleWriterReading,
  WorkerAuditVerdict,
} from "../../../core/src/parallel/audits.ts";
import { isADeltaRefusalReason } from "../../../core/src/parallel/audits.ts";
import { PROTECTION_WHEN_NOT_GUARANTEED } from "../../../core/src/parallel/barrier.ts";
import { outcomeOfWorker } from "../../../core/src/parallel/barrier.ts";
import type {
  BarrierResult,
  DerivedOutcome,
  WorkerEnd,
} from "../../../core/src/parallel/barrier.ts";
import type { TickOutcome } from "../../../core/src/parallel/integrate.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { outboxOfAWorker } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import {
  decideFromTheLastRecord,
  recordsOfTheGroup,
  treeIdAgreesWithTheLedger,
  verifyBeforeTheApplicationIsRepeated,
  workspaceIsAtTheFingerprintOfGroupStart,
  type PathOfTheDelta,
  type ResumeAction,
  type ResumeDecision,
  type ResumeRecord,
} from "../../../core/src/parallel/resume.ts";
import { objectIdOfBytes } from "../../../tree-store/src/git.ts";
import {
  initStore,
  treeStore,
  treesStillHeld,
  type StorePlaces,
} from "../../../tree-store/src/index.ts";
import {
  groupEndedEvent,
  handoffText,
  integrationEvent,
  layerOffFor,
  type EventRequest,
  type GroupOutcome,
  type LayerOffDecision,
  type ParallelPlan,
} from "../../../layer-parallel/src/index.ts";
import { membersOfTheGroup, readTheWorkerCheckpoint } from "./parallel-group.ts";
import {
  auditTheGroupThroughTheStore,
  closeTheGroupRun,
  dataOfTheKind,
  integrateThroughTheStore,
  openTheLedgerOfTheRun,
  readTheDeltasOfTheGroup,
  theCountersOfTheLedger,
  theMergeCheckOfTheGroup,
  theRecordAheadOfTheWriter,
  theWorkersForIntegration,
  type GroupAudit,
  type TheMergeCheck,
} from "./parallel-drive.ts";
import type { GroupAttemptDirective, TheGroupAttempt } from "./parallel-attempt.ts";
import type { TheOpenParallelGroup } from "./parallel-resume.ts";

/* ------------------------------------------------------------------ *
 * The shapes this slice answers with.
 * ------------------------------------------------------------------ */

/** The actions of F143-FR-025 this slice carries out — no worker starts. */
export const TAIL_ACTIONS_OF_THE_RESUME = [
  "verify-the-tree-id",
  "repeat-from-the-audits",
  "repeat-the-application",
  "write-the-ticks",
  "run-the-merge-check",
] as const;
export type TailActionOfTheResume = (typeof TAIL_ACTIONS_OF_THE_RESUME)[number];

/** F143-FR-025 state 6 — what the stop-writing left behind, for the wiring. */
export type TheStoppedOfTheResume = {
  readonly event: "apply-incomplete";
  readonly integrityKind: "tree-changed-outside-pass";
  /** The paths of the delta that hold neither the base nor the composed content. */
  readonly neither: readonly string[];
  /** The paths outside the delta at which the workspace differs from the start. */
  readonly outside: readonly string[];
};

/** What carrying the tail out gave, as `parallel-resume.ts` passes it on. */
export type TheTailOfAnOpenGroup =
  | {
      readonly carried: true;
      readonly action: TailActionOfTheResume;
      /** The state of F143-FR-025 the ledger answered with, 3 to 8. */
      readonly state: number;
      /** The carried group, as ONE group attempt of this engine start. */
      readonly attempt: TheGroupAttempt;
      /** State 6 only: the stop-writing the verification gave. */
      readonly stopped?: TheStoppedOfTheResume | undefined;
    }
  | {
      /** A state this slice does not carry out — nothing at all was written. */
      readonly carried: false;
      readonly action: ResumeAction;
      /** The state of F143-FR-025, 1 to 8, or 0 where no record exists. */
      readonly state: number;
      readonly says?: string | undefined;
    };

/**
 * THE DRIVE FACTS the composition root already holds at the pass boundary —
 * the same names the fresh group run takes. Nothing here is resume-specific:
 * these are the audits' inputs, the tick, the check runner and the hash, all
 * of which read launch-time state only the wiring holds.
 */
export type TheTailOfTheResumeDrive = {
  readonly plan: ParallelPlan;
  readonly phase: number;
  readonly groupOrdinal: number;
  readonly workspace: string;
  readonly slug: string;
  readonly taskListPath?: string | undefined;
  readonly prefixesOf?: ((workerId: string) => readonly string[]) | undefined;
  readonly protectedSet?: ProtectedSet | undefined;
  /** The task list EXACTLY as it was read at launch (F142-FR-055). */
  readonly taskTextAtLaunch: string;
  readonly secretsOf: (workerId: string, workerToken: string) => PathLeakSecrets;
  readonly singleWriter: SingleWriterReading;
  readonly tick: (taskIds: readonly string[]) => Promise<TickOutcome>;
  readonly runner: CheckRunner;
  readonly innerCheckSet: readonly ManifestEntry[];
  readonly containment?: ContainmentLevel | undefined;
  readonly environmentAllowList?: readonly string[] | undefined;
  readonly hash: (text: string) => string;
  readonly emit: (type: string, data: Readonly<Record<string, unknown>>) => void;
};

/* ------------------------------------------------------------------ *
 * The facts of the group, read back from the ledger.
 * ------------------------------------------------------------------ */

/** The records of the ledger file, as the file stands on disk. */
function theRecordsOfTheFile(ledgerFile: string): readonly ResumeRecord[] {
  const read = readAppendedRecords(existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "");
  return read.records as readonly ResumeRecord[];
}

/**
 * The task of a worker, from the `worker_started` record its pass began with:
 * on a resume the plan of the interrupted start is not re-derived, the ledger
 * says what each worker was assigned.
 */
function theTaskOfAWorker(records: readonly ResumeRecord[]): ReadonlyMap<string, string> {
  const taskOf = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== "worker_started" || record.workerId === undefined) continue;
    const task = record.data?.["task"];
    if (typeof task === "string") taskOf.set(record.workerId, task);
  }
  return taskOf;
}

/**
 * The tasks of the group, from the ledger: the `group_planned` record where
 * one stands, else the tasks the `worker_started` records named — the real
 * engine opens a group with `group_started`, so the started workers are what
 * the ledger holds.
 */
function theTasksOfTheGroup(records: readonly ResumeRecord[]): readonly string[] {
  const planned = records.find((record) => record.kind === "group_planned");
  const tasks = planned?.data?.["tasks"];
  if (Array.isArray(tasks)) {
    const named = tasks.filter((task): task is string => typeof task === "string");
    if (named.length > 0) return named;
  }
  const started = [...theTaskOfAWorker(records).values()];
  return [...new Set(started)];
}

/**
 * The verdicts of the audits, from the `audit_done` record the interrupted
 * start wrote (F143-FR-025 reads it): per worker, `accepted` or the refusal
 * reason as the loop layer gave it. A value that is neither accepted nor one
 * of the eight reasons refuses the worker under `scope` — the reading is
 * never quieter than the record.
 */
function theVerdictsOfTheLedger(
  records: readonly ResumeRecord[],
): ReadonlyMap<string, WorkerAuditVerdict> {
  const written = records.find((record) => record.kind === "audit_done")?.data?.["audits"];
  const verdicts = new Map<string, WorkerAuditVerdict>();
  if (written === undefined || typeof written !== "object") return verdicts;
  for (const [workerId, value] of Object.entries(written as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const refused =
      value === "accepted" ? undefined : isADeltaRefusalReason(value) ? value : "scope";
    verdicts.set(
      workerId,
      Object.freeze({
        workerId,
        ...(refused === undefined ? ({ verdict: "accepted" } as const) : { verdict: { refused } }),
        detail:
          refused === undefined
            ? "the audits of the interrupted start accepted the delta (the ledger's `audit_done`)"
            : `the audits of the interrupted start refused the delta: ${refused} (the ledger's ` +
              "`audit_done`)",
        dropped: [],
        paths: [],
        authorisedProtectedChanges: Object.freeze([] as readonly string[]),
      }),
    );
  }
  return verdicts;
}

/** The audit of the group as the ledger stands: the recorded verdicts, verbatim. */
function theAuditOfTheLedger(
  verdicts: ReadonlyMap<string, WorkerAuditVerdict>,
  workerIds: readonly string[],
): GroupAudit {
  const accepted: string[] = [];
  const refused: { workerId: string; reason: DeltaRefusalReason }[] = [];
  for (const workerId of workerIds) {
    const verdict = verdicts.get(workerId);
    if (verdict === undefined || verdict.verdict === "accepted") accepted.push(workerId);
    else refused.push({ workerId, reason: verdict.verdict.refused });
  }
  return Object.freeze({
    verdicts,
    accepted: Object.freeze(accepted),
    refused: Object.freeze(refused),
  });
}

/* ------------------------------------------------------------------ *
 * The carry-out.
 * ------------------------------------------------------------------ */

/**
 * CARRY THE TAIL OF THE RESUME OUT. The order inside is the reference
 * engine's, read through the real doors: verify what the ledger says stands,
 * close what stands unfinished, and go on to the merge check and the close —
 * every record through the ONE WRITER over the interrupted run's ledger, so
 * the file that decides the resume is also the file that records it.
 */
export async function carryOutTheTailOfTheOpenGroup(input: {
  readonly open: TheOpenParallelGroup;
  readonly controlRoot: string;
  /** `--reset-counts` (F100-FR-045): zeroes the counters THIS start writes. */
  readonly resetCounts?: boolean | undefined;
  readonly drive: TheTailOfTheResumeDrive;
}): Promise<TheTailOfAnOpenGroup> {
  const { open, drive } = input;
  const startedAtMs = Date.now();
  const groupId = open.groupId;

  /* The decision, over the ledger AS IT NOW STANDS (CT-143-125): the holder
   * search ran after discovery read the file, and ending a holder writes its
   * record before the decision is taken again. */
  const records = theRecordsOfTheFile(open.ledgerFile);
  const decision: ResumeDecision = decideFromTheLastRecord(records, { groupId });
  const refused: TheTailOfAnOpenGroup = Object.freeze({
    carried: false,
    action: decision.action,
    state: decision.state,
    ...(decision.says === undefined ? {} : { says: decision.says }),
  });
  if (!(TAIL_ACTIONS_OF_THE_RESUME as readonly string[]).includes(decision.action)) return refused;
  // A worker whose last record is `worker_started` needs its pass restarted —
  // a worker process, which no part of this slice starts (F143-FR-025 state 2).
  if (decision.workers.some((worker) => worker.then === "restart")) return refused;

  /* ---- THE FACTS OF THE GROUP, from the ledger. ---- */
  const ofTheGroup = recordsOfTheGroup(records, groupId);
  const started = ofTheGroup.find((record) => record.kind === "group_started");
  const baseTreeId =
    typeof started?.data?.["baseTree"] === "string" ? (started.data["baseTree"] as string) : "";
  const fingerprintAtStart =
    typeof started?.data?.["workspaceFingerprint"] === "string"
      ? (started.data["workspaceFingerprint"] as string)
      : baseTreeId;
  const tasksOfTheGroup = theTasksOfTheGroup(ofTheGroup);
  const taskOf = theTaskOfAWorker(ofTheGroup);
  const workerIds = decision.workers.map((worker) => worker.workerId);

  /* The trees the store still holds for this group, by worker (F143-FR-005:
   * the worker root is named by the run id alone, so the interrupted run's
   * trees are findable under this run's own places). */
  const places: StorePlaces = open.places;
  const held = treesStillHeld(places);
  const treePathOf = new Map<string, string>();
  for (const worker of decision.workers) {
    const found = held.find(
      (entry) =>
        entry.runId === open.runId &&
        entry.groupId === groupId &&
        entry.workerId === worker.workerId &&
        existsSync(entry.tree),
    );
    if (found !== undefined) treePathOf.set(worker.workerId, found.tree);
  }

  /* ---- THE LEDGER AND THE STORE, opened over what stands. ---- */
  const ledger = openTheLedgerOfTheRun({
    controlRoot: input.controlRoot,
    runId: open.runId,
    groupId,
    countersOf: theCountersOfTheLedger({
      ledgerFile: open.ledgerFile,
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
    }),
  });
  const events: EventRequest[] = [];
  const emit = (event: EventRequest): void => {
    events.push(event);
    drive.emit(event.type, event.data);
  };
  try {
    const store = treeStore(initStore(places), {
      seedSource: drive.workspace,
      ...(drive.taskListPath === undefined ? {} : { taskListPath: drive.taskListPath }),
      runId: open.runId,
      groupId,
      ...(baseTreeId === "" ? {} : { baseTreeId }),
      recordAhead: theRecordAheadOfTheWriter(ledger.writer),
    });

    /* The fingerprint of every worker's tree, taken AGAIN (F143-FR-017's
     * reading, after the crash): where the tree moved since its final
     * snapshot, that is an end-refusal, and where it is gone the snapshot is
     * empty. */
    const fingerprintNowOf = new Map<string, string>();
    for (const worker of decision.workers) {
      const treePath = treePathOf.get(worker.workerId);
      if (treePath === undefined) continue;
      fingerprintNowOf.set(worker.workerId, await store.snapshot(treePath));
    }

    /* The rows of the barrier, rebuilt from the ledger and the store. The
     * checkpoint of a worker is read from ITS OWN outbox where the tree
     * stands; where the tree is gone but its final snapshot stands in the
     * store, the checkpoint the pass wrote is named by the task it carried —
     * the shape the reference engine reads the ledger back with. */
    const endRefusalOf = new Map<string, "tree-changed-after-end">();
    const perWorker = decision.workers.map((worker) => {
      const finalTreeId = worker.treeId ?? "";
      const now = fingerprintNowOf.get(worker.workerId);
      const treeChangedAfterTheFinalSnapshot = now !== undefined && now !== finalTreeId;
      if (treeChangedAfterTheFinalSnapshot)
        endRefusalOf.set(worker.workerId, "tree-changed-after-end");
      const task = taskOf.get(worker.workerId) ?? "";
      const treePath = treePathOf.get(worker.workerId);
      const fromTheOutbox =
        treePath === undefined
          ? undefined
          : readTheWorkerCheckpoint(join(treePath, outboxOfAWorker(drive.slug)), task);
      const checkpoint =
        fromTheOutbox ?? (finalTreeId === "" || treePath !== undefined ? undefined : { task });
      const outcome: DerivedOutcome = outcomeOfWorker({
        workerId: worker.workerId,
        assignedTask: task,
        end: (worker.endCause ?? "ended") as WorkerEnd,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(treeChangedAfterTheFinalSnapshot ? { treeChangedAfterTheFinalSnapshot: true } : {}),
      });
      return Object.freeze({
        workerId: worker.workerId,
        finalTreeId,
        fingerprintAtTheBarrier: now ?? "",
        treeChangedAfterTheFinalSnapshot,
        processesEnded: Object.freeze([] as readonly number[]),
        outcome,
      });
    });
    const barrier: BarrierResult = Object.freeze({
      perWorker,
      // No process of this engine start is inside any tree: protection is the
      // reading of a barrier over trees nobody is writing.
      protection: PROTECTION_WHEN_NOT_GUARANTEED,
      integrationMayStart: true,
      candidates: Object.freeze(
        perWorker.filter((row) => row.outcome.outcome === "integrated").map((row) => row.workerId),
      ),
    });

    /* ---- STATE 3 — the tree id of every worker that ended, verified. ---- */
    if (decision.action === "verify-the-tree-id") {
      for (const worker of decision.workers) {
        const inTheLedger = worker.treeId ?? "";
        let inTheStore = "";
        if (inTheLedger !== "") {
          // The store answers for a snapshot it holds and throws for one it
          // does not: the reading IS the verification.
          try {
            await store.changed(baseTreeId, inTheLedger);
            inTheStore = inTheLedger;
          } catch {
            inTheStore = "";
          }
        }
        // A snapshot the store does not hold refuses the worker (the core's
        // own reading of state 3): it is marked in the barrier's rows and the
        // audits see it as the end-refusal `tree-changed-after-end`.
        if (!treeIdAgreesWithTheLedger({ inTheLedger, inTheStore }) && inTheLedger !== "") {
          endRefusalOf.set(worker.workerId, "tree-changed-after-end");
        }
      }
      // The barrier is closed again: the `worker_ended` records stand, only
      // `group_barrier` is written, ahead of the audits, with the workspace
      // fingerprint now and each tree's fingerprint taken again.
      await ledger.writer.ahead(
        "group_barrier",
        dataOfTheKind("group_barrier", {
          fingerprint: await store.snapshot(drive.workspace),
          perWorkerFingerprint: Object.fromEntries(
            perWorker.map((row) => [row.workerId, row.fingerprintAtTheBarrier]),
          ),
        }),
        () => Promise.resolve(),
      );
    }

    /* ---- STATE 4 — the workspace, against the fingerprint at group start. ---- */
    let workspaceChanged = false;
    if (decision.action === "repeat-from-the-audits") {
      const now = await store.snapshot(drive.workspace);
      workspaceChanged = !workspaceIsAtTheFingerprintOfGroupStart({
        fingerprintAtGroupStart: fingerprintAtStart,
        fingerprintNow: now,
      });
    }

    /* ---- THE AUDITS — repeated where this slice reaches them, read from the
     * ledger where it does not (states 5 to 8: the `audit_done` record the
     * interrupted start wrote ahead of the composition stands). ---- */
    let audit: GroupAudit;
    let pathCountOfTheAudit = 0;
    if (decision.action === "verify-the-tree-id" || decision.action === "repeat-from-the-audits") {
      const deltas = await readTheDeltasOfTheGroup({
        store,
        baseTreeId,
        workers: perWorker.map((row) => ({
          workerId: row.workerId,
          treeId: row.finalTreeId,
          treePath: treePathOf.get(row.workerId) ?? "",
        })),
      });
      audit = await auditTheGroupThroughTheStore({
        writer: ledger.writer,
        deltas,
        prefixesOf:
          drive.prefixesOf ??
          ((workerId) => {
            const task = taskOf.get(workerId);
            const member = membersOfTheGroup(drive.plan, drive.phase, drive.groupOrdinal).find(
              (row) => row.taskId === task,
            );
            return member?.scopePrefixes ?? [];
          }),
        protectedSet: drive.protectedSet ?? { paths: [], patterns: [] },
        taskTextAtLaunch: drive.taskTextAtLaunch,
        // The token of a worker of the interrupted start is not held any more;
        // the leak search is given an empty per-worker token, and searches the
        // worker root, the store and the control plane as they stand.
        secretsOf: (workerId) => drive.secretsOf(workerId, ""),
        singleWriter: drive.singleWriter,
        ...(endRefusalOf.size === 0
          ? {}
          : { endRefusalOf: (workerId) => endRefusalOf.get(workerId) }),
        ...(workspaceChanged ? { workspaceChanged: true } : {}),
      });
      pathCountOfTheAudit = deltas.reduce((sum, delta) => sum + delta.paths.length, 0);
      emit(integrationEvent({ groupId, step: "audit", pathCount: pathCountOfTheAudit }));
    } else {
      audit = theAuditOfTheLedger(theVerdictsOfTheLedger(ofTheGroup), workerIds);
    }

    /* ---- THE WORKERS INTEGRATION RECEIVES, from the rebuilt barrier and the
     * verdicts. ---- */
    const forIntegration = await theWorkersForIntegration({
      store,
      baseTreeId,
      barrier,
      taskOf: (workerId) => taskOf.get(workerId) ?? "",
      ends: new Map(
        decision.workers.map((worker) => [
          worker.workerId,
          (worker.endCause ?? "ended") as WorkerEnd,
        ]),
      ),
      verdicts: audit.verdicts,
    });
    const integrated = forIntegration.filter((worker) => worker.outcome.outcome === "integrated");

    const failedWith = async (
      facts: { integration?: unknown } = {},
    ): Promise<TheTailOfAnOpenGroup> => {
      const closed = await closeTheGroupRun({
        places,
        writer: ledger.writer,
        store,
        runId: open.runId,
        groupId,
        outcome: "failed",
        workerOutcomes: Object.fromEntries(
          perWorker.map((row) => [row.workerId, row.outcome.outcome]),
        ),
      });
      emit(groupEndedEvent({ groupId, outcome: "failed" }));
      const attempt: TheGroupAttempt = Object.freeze({
        ok: true,
        groupId,
        outcome: "failed",
        directive: "none",
        layerOff: null,
        keptUnits: [],
        handoff: handoffText([]),
        tasksOnTheMainLine: tasksOfTheGroup,
        baseTreeId,
        barrier,
        audit,
        ...(facts.integration === undefined ? {} : { integration: facts.integration as never }),
        closed,
        counts: { refused: audit.refused.length, wallMs: Date.now() - startedAtMs, agentMs: 0 },
        events: Object.freeze([...events]),
      });
      return Object.freeze({
        carried: true,
        action: decision.action as TailActionOfTheResume,
        state: decision.state,
        attempt,
      });
    };

    // A group that integrates nothing reaches no composition: no composition,
    // no application, no ticks, no merge check (F142-FR-059) — the group
    // fails with the directive `none`, exactly as a fresh run does. Past the
    // composition (states 5 to 8) the ledger says one stood; the verification
    // below governs, and the composition is repeated as the ledger carries it.
    if (
      (decision.action === "verify-the-tree-id" || decision.action === "repeat-from-the-audits") &&
      integrated.length === 0
    ) {
      return await failedWith();
    }

    /* ---- STATES 5 AND 6 — the verification before the application is
     * repeated, over the planned paths the `apply_started` record carries
     * (F143-FR-020 wrote them write-ahead, with each path's base and
     * composed object id — the delta the verification reads). ---- */
    let stopped: TheStoppedOfTheResume | undefined;
    if (decision.action === "repeat-the-application") {
      const appliedRecord = ofTheGroup.find((record) => record.kind === "apply_started");
      const written = appliedRecord?.data?.["paths"];
      const delta: PathOfTheDelta[] = Array.isArray(written)
        ? (written as Readonly<Record<string, unknown>>[])
            .filter((entry) => typeof entry?.["path"] === "string")
            .map((entry) => {
              const base = entry["baseOid"];
              const composed = entry["composedOid"];
              return {
                path: entry["path"] as string,
                ...(typeof base === "string" ? { base } : {}),
                ...(typeof composed === "string" ? { composed } : {}),
              };
            })
        : [];
      const found: Record<string, string | undefined> = {};
      for (const entry of delta) {
        const path = join(drive.workspace, entry.path);
        found[entry.path] = existsSync(path)
          ? objectIdOfBytes(places, readFileSync(path))
          : undefined;
      }
      const ofTheDelta = new Set(delta.map((entry) => entry.path));
      const snapshotNow = await store.snapshot(drive.workspace);
      const outside = (await store.changed(baseTreeId, snapshotNow))
        .map((changed) => changed.path)
        .filter((path) => !ofTheDelta.has(path));
      const verification = verifyBeforeTheApplicationIsRepeated({
        delta,
        found,
        fingerprintAtGroupStart: fingerprintAtStart,
        pathsThatDifferOutsideTheDelta: outside,
        fingerprintNow: snapshotNow,
      });
      if (verification.state === 6) {
        stopped = Object.freeze({
          event: verification.event,
          integrityKind: verification.integrityKind,
          neither: Object.freeze([...verification.neither]),
          outside: Object.freeze([...verification.outside]),
        });
        drive.emit(stopped.event, {
          groupId,
          integrityKind: stopped.integrityKind,
          neither: [...stopped.neither],
          outside: [...stopped.outside],
          loopLayerOffFor: verification.loopLayerOffFor,
        });
      }
    }

    /* ---- THE COMPOSITION, THE APPLICATION AND THE TICKS. ---- */
    let integration: Awaited<ReturnType<typeof integrateThroughTheStore>> | undefined;
    let ticked: readonly string[] = [];
    if (stopped === undefined) {
      if (decision.action === "write-the-ticks") {
        // State 7 — the ticks alone: `applied` stands, `ticks_applied` does
        // not. The ticks go through the spec-format adapter and are recorded
        // under `ticks_applied` with the task ids they ticked (F143-FR-021).
        ticked = tasksOfIntegrated(integrated);
        await drive.tick(ticked);
        await ledger.writer.record(
          "ticks_applied",
          dataOfTheKind("ticks_applied", { taskIds: [...ticked] }),
        );
        emit(integrationEvent({ groupId, step: "tick", pathCount: ticked.length }));
      } else if (decision.action !== "run-the-merge-check") {
        // States 3, 4 and 5 — the composition and the application are made
        // here; state 5 repeats the application IN FULL (F143-FR-020).
        integration = await integrateThroughTheStore({
          store,
          writer: ledger.writer,
          tick: drive.tick,
          baseTreeId,
          workspace: drive.workspace,
          workers: forIntegration,
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
          // so no merge check runs either (F142-FR-059).
          return await failedWith({ integration });
        }
        emit(integrationEvent({ groupId, step: "apply", pathCount: integration.paths.length }));
        emit(integrationEvent({ groupId, step: "tick", pathCount: integration.ticked.length }));
        ticked = integration.ticked;
      } else {
        // State 8 — the ticks stand: the tasks they named are the tasks the
        // merge check checks.
        const ticksRecord = ofTheGroup.find((record) => record.kind === "ticks_applied");
        const named = ticksRecord?.data?.["taskIds"];
        ticked = Array.isArray(named)
          ? named.filter((task): task is string => typeof task === "string")
          : tasksOfIntegrated(integrated);
      }
    }

    /* ---- THE MERGE CHECK (F142-FR-059 to F142-FR-061), in the workspace. ---- */
    let merge: TheMergeCheck | undefined;
    if (stopped === undefined) {
      merge = await theMergeCheckOfTheGroup({
        store,
        writer: ledger.writer,
        runner: drive.runner,
        innerCheckSet: drive.innerCheckSet,
        workspace: drive.workspace,
        containment: drive.containment,
        ...(drive.environmentAllowList === undefined
          ? {}
          : { environmentAllowList: drive.environmentAllowList }),
        tasks: ticked,
        hash: drive.hash,
      });
      emit(
        integrationEvent({ groupId, step: "merge-check", pathCount: merge.run.commands.length }),
      );
    }

    /* ---- THE OUTCOME, THE DIRECTIVE, THE CLOSE (F143-FR-027). ---- */
    const outcomeOfTheCheck = merge?.outcome;
    let outcome: GroupOutcome;
    let directive: GroupAttemptDirective;
    let layerOff: LayerOffDecision | null = null;
    let keptUnits: readonly (readonly string[])[] = [];
    if (stopped !== undefined) {
      // State 6: the group failed; its tasks go back to the main line and the
      // loop layer goes off for the run (the wiring carries the run switch).
      outcome = "failed";
      directive = "none";
    } else if (outcomeOfTheCheck?.directive === "keep") {
      outcome = "kept";
      directive = "keep";
      keptUnits = [Object.freeze([...ticked].sort())];
    } else if (outcomeOfTheCheck?.directive === "repair") {
      outcome = "repair";
      directive = "repair";
    } else {
      // `layerOffForAttempt` — the inner check set was empty when the merge
      // check was due (F142-FR-023).
      outcome = "failed";
      directive = "layerOffForAttempt";
      layerOff = layerOffFor("unchecked", {
        groupId,
        detail:
          outcomeOfTheCheck !== undefined && "reason" in outcomeOfTheCheck
            ? String(outcomeOfTheCheck.reason)
            : "",
      });
    }
    const closed = await closeTheGroupRun({
      places,
      writer: ledger.writer,
      store,
      runId: open.runId,
      groupId,
      outcome: outcome === "kept" ? "closed" : "failed",
      workerOutcomes: Object.fromEntries(
        perWorker.map((row) => [row.workerId, row.outcome.outcome]),
      ),
    });
    emit(groupEndedEvent({ groupId, outcome, refused: audit.refused.length }));
    const attempt: TheGroupAttempt = Object.freeze({
      ok: true,
      groupId,
      outcome,
      directive,
      layerOff,
      keptUnits,
      handoff: handoffText(keptUnits),
      tasksOnTheMainLine:
        stopped === undefined && outcome === "kept"
          ? tasksOfTheGroup.filter((task) => !ticked.includes(task))
          : tasksOfTheGroup,
      baseTreeId,
      barrier,
      audit,
      ...(integration === undefined ? {} : { integration }),
      ...(merge === undefined ? {} : { merge }),
      closed,
      counts: { refused: audit.refused.length, wallMs: Date.now() - startedAtMs, agentMs: 0 },
      events: Object.freeze([...events]),
    });
    return Object.freeze({
      carried: true,
      action: decision.action as TailActionOfTheResume,
      state: decision.state,
      attempt,
      ...(stopped === undefined ? {} : { stopped }),
    });
  } finally {
    releaseTheWriter(`${open.runId}:ledger`);
  }
}

/** The tasks of the workers integration accepted, in the order of the workers. */
function tasksOfIntegrated(integrated: readonly { readonly task: string }[]): readonly string[] {
  return Object.freeze([...new Set(integrated.map((worker) => worker.task))]);
}
