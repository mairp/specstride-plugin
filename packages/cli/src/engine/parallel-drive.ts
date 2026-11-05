/**
 * THE DRIVE OF ONE GROUP, FROM THE BARRIER TO THE CLOSE, at the composition
 * root (step 3 of `prompts/specstride-parallel-units.md`; F143-FR-020 to
 * F143-FR-023, F142-FR-054 to F142-FR-064). `parallel-group.ts` prepared the
 * trees, ran the workers and closed the barrier; this module carries the group
 * from there to its last record, over REAL ports — the tree store of the run,
 * the ledger file of the run, the check runner of the gate — and it is the
 * slice that makes the records and the events of the layer real:
 *
 *  - `openTheLedgerOfTheRun` — THE ONE QUEUE of core over the ledger file of
 *    the run, opened over the file AS IT IS, so `seq` rises without a gap
 *    across a relaunch (F143-FR-024), and THE ONE WRITER of core, which builds
 *    every envelope and refuses a kind outside the closed set (F143-FR-023);
 *  - `readTheDeltasOfTheGroup` — the delta of every worker read through the
 *    store's `changed`, the text of the added and changed objects read from
 *    the worker's tree, because the path-leak audit searches text (F142-FR-056);
 *  - `auditTheGroupThroughTheStore` — the three audits of core (scope,
 *    protected set, path leak), then `audit_done` WRITTEN AHEAD of the
 *    composition (F142-FR-054 to F142-FR-058);
 *  - `theWorkersForIntegration` — the workers integration receives: the
 *    barrier's outcomes, overridden where the audits refused (the verdict is
 *    the record of why; the outcome is the core's own refusal);
 *  - `integrateThroughTheStore` — `integrateGroup` of core over the real
 *    store: compose, apply, ticks (F143-FR-014, F143-FR-019 to F143-FR-021);
 *  - `theMergeCheckOfTheGroup` — `merge_check_started` written ahead, every
 *    command of the inner check set in the workspace and in no worker tree
 *    (F142-FR-059), `merge_check_finished` after, and the outcome (F142-FR-060,
 *    F142-FR-061);
 *  - `closeTheGroupRun` — the worker trees of the group released on success
 *    and on failure alike, `group_closed` ahead, then the sweep of the store
 *    (F143-FR-027).
 *
 * THE FIELD NAMES OF THE LEDGER are the registry's
 * (`PARALLEL_LEDGER_KIND_REGISTRY`), and the core modules do not all speak
 * them — `closeTheBarrier` says `fingerprint` where the registry says
 * `workspaceFingerprint`, `integrateGroup` says `treeId` and `workers` where
 * the registry says `composedTreeId` and `acceptedWorkers`. The record door of
 * this module renames at the write (`dataOfTheKind`), so the ledger on disk
 * always carries the closed set's own names and no reader of the file has to
 * know which core module wrote the record.
 *
 * WHAT IS NOT HERE: the run-record fields' file home, the `[LOOP] parallel=`
 * line, and the call sites in `run-feature.ts` — the wiring slice. The doors
 * this module returns are what that slice joins.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  ContainmentLevel,
  ManifestEntry,
  CheckRunner,
} from "@specstride/contracts/ep/check-runner";
import type {
  ChangedPath,
  ComposeResult,
  TreeId,
  TreeStoreService,
} from "@specstride/contracts/ep/tree-store";
import type { ApplicationPlan, StorePlaces } from "../../../tree-store/src/index.ts";
import { releaseTheTreesOfTheGroup } from "../../../tree-store/src/index.ts";
import {
  auditTheGroup,
  isAccepted,
  isSearched,
  refusalOf,
  type AuditedPath,
  type AuditInput,
  type DeltaRefusalReason,
  type EndThatRefuses,
  type PathLeakSecrets,
  type ProtectedSet,
  type SingleWriterReading,
  type WorkerAuditVerdict,
  type WorkerDelta,
} from "../../../core/src/parallel/audits.ts";
import type { DerivedOutcome, WorkerEnd } from "../../../core/src/parallel/barrier.ts";
import type { BarrierResult } from "../../../core/src/parallel/barrier.ts";
import {
  integrateGroup,
  theOneWriter,
  type IntegrationResult,
  type IntegrationPorts,
  type OneWriterPorts,
  type OneWriter,
  type TickOutcome,
  type WorkerForIntegration,
} from "../../../core/src/parallel/integrate.ts";
import type { ParallelLedgerKind } from "../../../core/src/parallel/ledger-kinds.ts";
import {
  dataFieldsOf,
  PARALLEL_LEDGER_KIND_REGISTRY,
} from "../../../core/src/parallel/ledger-kinds.ts";
import type { CountedRecord } from "../../../core/src/parallel/counters.ts";
import { countersFromTheLedger, flatten } from "../../../core/src/parallel/counters.ts";
import {
  continuationOf,
  oneQueue,
  readAppendedRecords,
  type AppendedRecord,
  type OneQueue,
} from "../../../core/src/parallel/queue.ts";
import {
  outcomeOfTheMergeCheck,
  runMergeCheck,
  type MergeCheckOutcome,
  type MergeCheckRun,
} from "../../../core/src/parallel/merge-check.ts";
import { outcomeOfWorker } from "../../../core/src/parallel/barrier.ts";
import type { PreparedGroup } from "./parallel-group.ts";
import { removeTheTemporaryDirectories } from "./parallel-group.ts";

/* ------------------------------------------------------------------ *
 * The ledger of the run: the place, the one queue, the one writer.
 * ------------------------------------------------------------------ */

/**
 * THE LEDGER FILE of the parallel records of one run, in the control plane of
 * the run, beside the plan (`runs/<runId>/parallel-plan.json`). The engine's
 * decision: the records of a group are a log of the run, one file, JSON lines
 * with the newline at the end of each — the shape the one queue appends and
 * `readAppendedRecords` reads back over a crash.
 */
export function parallelLedgerPathOf(controlRoot: string, runId: string): string {
  return join(controlRoot, "runs", runId, "parallel-ledger.jsonl");
}

/** The ledger of a run, as opened: the one queue over the file, the one writer. */
export type TheLedgerOfARun = {
  /** The file the queue appends to. */
  readonly ledgerFile: string;
  readonly queue: OneQueue;
  readonly writer: OneWriter;
  /** The whole records the file already held when the queue opened. */
  readonly held: readonly AppendedRecord[];
  /** The bytes of a torn last line, where a crash cut one. */
  readonly tornLastLine?: string;
};

/**
 * OPEN THE LEDGER OF ONE RUN. The queue opens over the file AS IT IS, so a
 * relaunched engine goes on numbering where the file left off, without a gap
 * (F143-FR-024), and `prev` chains to the hash of the last whole line. The
 * writer is THE ONE WRITER of core: a second opening over the same ledger
 * name in the same process is refused, not interleaved.
 */
export function openTheLedgerOfTheRun(input: {
  readonly controlRoot: string;
  readonly runId: string;
  /** The group id every record of this opening carries. */
  readonly groupId: string;
  readonly countersOf?:
    | ((
        envelope: Readonly<Record<string, unknown>>,
      ) => Readonly<Record<string, unknown>> | undefined)
    | undefined;
}): TheLedgerOfARun {
  const ledgerFile = parallelLedgerPathOf(input.controlRoot, input.runId);
  mkdirSync(dirname(ledgerFile), { recursive: true, mode: 0o700 });
  const before = readAppendedRecords(
    existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "",
  );
  const hashOf = (line: string): string => createHash("sha256").update(line).digest("hex");
  const queue = oneQueue(
    {
      // ONE WHOLE LINE, ONE call — the contract that makes a torn line a
      // property of a crash and never of the queue.
      appendLine: (line) => appendFileSync(ledgerFile, line),
      hashOf,
    },
    continuationOf(before, hashOf),
  );
  const ports: OneWriterPorts = {
    append: (record) => {
      queue.appendNow(record);
      return Promise.resolve();
    },
    appendNow: (record) => {
      queue.appendNow(record);
    },
  };
  const writer = theOneWriter(ports, {
    groupId: input.groupId,
    ledgerName: `${input.runId}:ledger`,
    ...(input.countersOf === undefined ? {} : { countersOf: input.countersOf }),
  });
  return {
    ledgerFile,
    queue,
    writer,
    held: before.records,
    ...(before.tornLastLine === undefined ? {} : { tornLastLine: before.tornLastLine }),
  };
}

/* ------------------------------------------------------------------ *
 * The data of a record, in the names of the closed set.
 * ------------------------------------------------------------------ */

/**
 * THE DATA OF ONE RECORD, in the field names of the registry. The core's
 * modules decide WHAT a record carries; the names on disk are the closed
 * set's. Everything a module hands in that the registry does not name is
 * renamed here; anything already named is kept; anything else is kept too,
 * because the closed set states REQUIRED fields and is not a prohibition on
 * more.
 */
export function dataOfTheKind(
  kind: ParallelLedgerKind,
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const renames: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    // `closeTheBarrier` writes the barrier's fingerprints under two names of
    // its own; the registry names them `workspaceFingerprint` and
    // `workerFingerprints`.
    group_barrier: {
      fingerprint: "workspaceFingerprint",
      perWorkerFingerprint: "workerFingerprints",
    },
    // The barrier's final snapshot names the tree fingerprint `fingerprint`.
    worker_ended: { fingerprint: "treeFingerprint" },
    // `integrateGroup` names the composed tree `treeId` and the workers whose
    // deltas were composed `workers`.
    merge_done: { treeId: "composedTreeId", workers: "acceptedWorkers" },
    // `integrateGroup` and `closeTheBarrier` name a workspace fingerprint
    // `fingerprint`.
    applied: { fingerprint: "workspaceFingerprint" },
    group_started: { fingerprint: "workspaceFingerprint" },
  };
  const table = renames[kind];
  if (table === undefined) return data;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data)) out[table[field] ?? field] = value;
  return out;
}

/* ------------------------------------------------------------------ *
 * The counters of the layer, on the ledger (F143-FR-028).
 * ------------------------------------------------------------------ */

/**
 * THE COUNTERS DOOR of the ledger: the `countersOf` the one writer takes, so
 * that every record of the namespace leaves the disk carrying the counters of
 * the layer AS THEY STAND AFTER IT, in the envelope field `counters` of annex
 * B §B.13 (F143-FR-028).
 *
 * DERIVED FROM THE FILE, never held in memory: every call reads the ledger AS
 * IT IS ON DISK — each record an earlier write of this opening, or of an
 * earlier engine start, left there — counts the record being written on top
 * of them, and answers with the flat form. That is what makes the counters
 * CONTINUE after a resume and a relaunch with no mechanism beyond the file:
 * the next opening of the same ledger derives from the same records and
 * arrives at the same numbers, only higher. A record whose append failed is
 * not on the disk and so is never counted — the file, not a caller's memory,
 * is the truth of the count.
 *
 * `resetCounts` is `--reset-counts` (F100-FR-045): the engine start that asks
 * for it writes zeroes on every record it writes, which is the counters of
 * this layer reset WITH the others, for the one start that asked — the flag
 * is accepted from the command line and is never a state of the run.
 */
export function theCountersOfTheLedger(input: {
  readonly ledgerFile: string;
  readonly resetCounts?: boolean | undefined;
}): (envelope: Readonly<Record<string, unknown>>) => Readonly<Record<string, number>> {
  return (envelope) => {
    const before = readAppendedRecords(
      existsSync(input.ledgerFile) ? readFileSync(input.ledgerFile, "utf8") : "",
    ).records;
    return flatten(
      countersFromTheLedger([...before, envelope as CountedRecord], {
        ...(input.resetCounts === true ? { resetCounts: true } : {}),
      }),
    );
  };
}

/* ------------------------------------------------------------------ *
 * The deltas of the group.
 * ------------------------------------------------------------------ */

/**
 * THE TEXT CAP of one object of a delta, for the path-leak search. An object
 * bigger than this arrives without its text: the search reads what a worker
 * could have written into a file, and a file of megabytes is not that.
 */
export const THE_TEXT_CAP_OF_A_DELTA_OBJECT = 256 * 1024;

/** The text of one added or changed object, read from the worker's tree. */
function textOf(workerTree: string, path: string): string | undefined {
  const path_ = join(workerTree, path);
  if (!existsSync(path_)) return undefined;
  try {
    if (!lstatSync(path_).isFile()) return undefined;
    if (lstatSync(path_).size > THE_TEXT_CAP_OF_A_DELTA_OBJECT) return undefined;
    return readFileSync(path_, "utf8");
  } catch {
    return undefined;
  }
}

/** Map the store's changed paths onto the paths the audits read. */
function auditedPaths(workerTree: string, changed: readonly ChangedPath[]): readonly AuditedPath[] {
  return changed.map((entry): AuditedPath => {
    return isSearched(entry.kind)
      ? {
          path: entry.path,
          kind: entry.kind,
          ...((): { text?: string } => {
            const text = textOf(workerTree, entry.path);
            return text === undefined ? {} : { text };
          })(),
        }
      : { path: entry.path, kind: entry.kind };
  });
}

/**
 * THE DELTA OF EVERY WORKER OF THE GROUP, read through the store's `changed`
 * from the base snapshot to the worker's final snapshot, with the text of the
 * added and changed objects read from the worker's tree. `source` is `store`
 * — the only source the audits accept (`THE_AUDITS_READ`).
 */
export async function readTheDeltasOfTheGroup(input: {
  readonly store: TreeStoreService;
  readonly baseTreeId: TreeId;
  /** The final snapshot and the tree path of each worker, from the barrier. */
  readonly workers: readonly {
    readonly workerId: string;
    readonly treeId: TreeId;
    readonly treePath: string;
  }[];
}): Promise<readonly WorkerDelta[]> {
  const deltas: WorkerDelta[] = [];
  for (const worker of input.workers) {
    const changed =
      worker.treeId === "" ? [] : await input.store.changed(input.baseTreeId, worker.treeId);
    deltas.push(
      Object.freeze({
        workerId: worker.workerId,
        treeId: worker.treeId,
        paths: auditedPaths(worker.treePath, changed),
        source: "store" as const,
      }),
    );
  }
  return Object.freeze(deltas);
}

/* ------------------------------------------------------------------ *
 * The audits, and the record `audit_done`.
 * ------------------------------------------------------------------ */

/** What the audits of the group gave. */
export type GroupAudit = {
  /** The verdict of every worker, in the order the deltas were given. */
  readonly verdicts: ReadonlyMap<string, WorkerAuditVerdict>;
  /** The workers whose delta every audit accepted — the composition's input. */
  readonly accepted: readonly string[];
  /** The workers an audit refused, each with its one reason. */
  readonly refused: readonly { readonly workerId: string; readonly reason: DeltaRefusalReason }[];
};

/**
 * AUDIT THE DELTAS OF THE GROUP (F142-FR-054 to F142-FR-058): scope, then the
 * protected set, then the path leak, the first refusal standing. An end that
 * already refuses the worker — no checkpoint, a yield artifact, a tree that
 * moved — skips the audits (`ENDS_THAT_REFUSE_BEFORE_THE_AUDITS`), and a
 * workspace that moved between the group's start and the barrier refuses
 * every worker (`workspace-changed`, F142-FR-064). `audit_done` is written
 * AHEAD of the composition, whatever the verdicts are: it is the record of an
 * intention, and F143-FR-025 reads it.
 *
 * The secrets are PER WORKER: the token of the leak search is the token of
 * this worker, which no other worker holds.
 */
export async function auditTheGroupThroughTheStore(input: {
  readonly writer: OneWriter;
  readonly deltas: readonly WorkerDelta[];
  readonly prefixesOf: (workerId: string) => readonly string[];
  readonly protectedSet: ProtectedSet;
  /** The task list exactly as it was read at launch (F142-FR-055). */
  readonly taskTextAtLaunch: string;
  readonly secretsOf: (workerId: string) => PathLeakSecrets;
  readonly singleWriter: SingleWriterReading;
  /** The end-refusals, worker by worker, from the barrier. */
  readonly endRefusalOf?: ((workerId: string) => EndThatRefuses | undefined) | undefined;
  /** Set where the workspace at the barrier differs from the workspace at group start. */
  readonly workspaceChanged?: boolean | undefined;
  readonly caseFolds?: boolean | undefined;
}): Promise<GroupAudit> {
  const audits: AuditInput[] = input.deltas.map((delta) => ({
    delta,
    prefixes: [...input.prefixesOf(delta.workerId)],
    protectedSet: input.protectedSet,
    taskTextAtLaunch: input.taskTextAtLaunch,
    secrets: input.secretsOf(delta.workerId),
    singleWriter: input.singleWriter,
    ...(input.endRefusalOf?.(delta.workerId) !== undefined
      ? { endRefuses: input.endRefusalOf?.(delta.workerId) }
      : {}),
    ...(input.workspaceChanged === true ? { workspaceChanged: true } : {}),
    ...(input.caseFolds === undefined ? {} : { caseFolds: input.caseFolds }),
  }));
  const verdicts = auditTheGroup(audits);
  const byWorker = new Map<string, WorkerAuditVerdict>();
  for (const verdict of verdicts) byWorker.set(verdict.workerId, verdict);
  const accepted: string[] = [];
  const refused: { workerId: string; reason: DeltaRefusalReason }[] = [];
  for (const delta of input.deltas) {
    const verdict = byWorker.get(delta.workerId);
    const reason = verdict === undefined ? undefined : refusalOf(verdict.verdict);
    if (verdict === undefined || isAccepted(verdict.verdict)) accepted.push(delta.workerId);
    else refused.push({ workerId: delta.workerId, reason: reason ?? "scope" });
  }
  await input.writer.ahead(
    "audit_done",
    dataOfTheKind("audit_done", {
      audits: Object.fromEntries(
        input.deltas.map((delta) => {
          const verdict = byWorker.get(delta.workerId);
          const reason = verdict === undefined ? undefined : refusalOf(verdict.verdict);
          return [
            delta.workerId,
            verdict === undefined || isAccepted(verdict.verdict) ? "accepted" : (reason ?? "scope"),
          ];
        }),
      ),
    }),
    () => Promise.resolve(),
  );
  return { verdicts: byWorker, accepted: Object.freeze(accepted), refused: Object.freeze(refused) };
}

/* ------------------------------------------------------------------ *
 * The workers for integration.
 * ------------------------------------------------------------------ */

/**
 * THE WORKERS INTEGRATION RECEIVES: one per worker of the group, in the order
 * of the tasks at launch, each with its final snapshot, the paths of its
 * delta, and its outcome. Where an audit refused the worker, the outcome is
 * THE CORE'S OWN REFUSAL, derived again without a checkpoint — the verdict in
 * `audit_done` is the record of why, and the outcome is the closed set's
 * (`F143-FR-012`); the two are read together.
 */
export async function theWorkersForIntegration(input: {
  readonly store: TreeStoreService;
  readonly baseTreeId: TreeId;
  readonly barrier: BarrierResult;
  /** The task of a worker, as the plan assigned it. */
  readonly taskOf: (workerId: string) => string;
  /** The end of each worker's pass, as the runner observed it. */
  readonly ends: ReadonlyMap<string, WorkerEnd>;
  /** The verdicts of the audits, from `auditTheGroupThroughTheStore`. */
  readonly verdicts: ReadonlyMap<string, WorkerAuditVerdict>;
}): Promise<readonly WorkerForIntegration[]> {
  const out: WorkerForIntegration[] = [];
  for (const row of input.barrier.perWorker) {
    const task = input.taskOf(row.workerId);
    const paths =
      row.finalTreeId === ""
        ? []
        : (await input.store.changed(input.baseTreeId, row.finalTreeId)).map((c) => c.path);
    const verdict = input.verdicts.get(row.workerId);
    const auditedRefusal = verdict === undefined ? undefined : refusalOf(verdict.verdict);
    const outcome: DerivedOutcome =
      auditedRefusal === undefined
        ? row.outcome
        : outcomeOfWorker({
            workerId: row.workerId,
            assignedTask: task,
            end: input.ends.get(row.workerId) ?? "ended",
          });
    out.push(
      Object.freeze({
        workerId: row.workerId,
        task,
        finalTreeId: row.finalTreeId,
        paths,
        outcome,
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * THE WRITE-AHEAD RECORDER OF THE APPLICATION, for the options of the tree
 * store (F143-FR-020, F143-FR-023). `apply_started` is the write-ahead record
 * OF THE STORE: it goes on disk synchronously, through the one writer, before
 * one byte of the workspace is written. The engine hands this to
 * `treeStore(places, { recordAhead, … })` when it builds the store of a run.
 */
export function theRecordAheadOfTheWriter(writer: OneWriter): (plan: ApplicationPlan) => void {
  return (plan) => {
    writer.recordNow("apply_started", dataOfTheKind("apply_started", { paths: plan.paths }));
  };
}

/* ------------------------------------------------------------------ *
 * The integration, through the real store.
 * ------------------------------------------------------------------ */

/**
 * INTEGRATE THE GROUP THROUGH THE REAL STORE (F143-FR-014, F143-FR-019 to
 * F143-FR-021): `compose` of the store, `merge_done` on disk, `apply` of the
 * store — the one operation that writes a path of the workspace — `applied`,
 * then the ticks and `ticks_applied`. The ticks are handed in: ticking is the
 * spec-format adapter's business, which the engine already owns.
 */
export async function integrateThroughTheStore(input: {
  readonly store: TreeStoreService;
  readonly writer: OneWriter;
  /** The operation `tick` of the spec-format adapter, as the engine runs it. */
  readonly tick: (taskIds: readonly string[]) => Promise<TickOutcome>;
  /** The fingerprint of the workspace, ordinarily the store's own snapshot. */
  readonly fingerprintOf?: ((directory: string) => Promise<string>) | undefined;
  readonly baseTreeId: TreeId;
  readonly workspace: string;
  readonly workers: readonly WorkerForIntegration[];
}): Promise<IntegrationResult> {
  const ports: IntegrationPorts = {
    compose: (base, deltas): Promise<ComposeResult> => input.store.compose(base, deltas),
    apply: (base, composed, workspace) => input.store.apply(base, composed, workspace),
    fingerprint: (directory) =>
      (input.fingerprintOf ?? ((directory: string) => input.store.snapshot(directory)))(directory),
    tick: input.tick,
    record: async (kind, data) => {
      await input.writer.record(kind, dataOfTheKind(kind, data));
    },
  };
  return integrateGroup(ports, {
    baseTreeId: input.baseTreeId,
    workspace: input.workspace,
    workers: input.workers,
  });
}

/* ------------------------------------------------------------------ *
 * The merge check.
 * ------------------------------------------------------------------ */

/** What the merge check of one group gave: the run and the outcome. */
export type TheMergeCheck = {
  readonly run: MergeCheckRun;
  readonly outcome: MergeCheckOutcome;
};

/**
 * THE MERGE CHECK OF ONE GROUP (F142-FR-059 to F142-FR-061). `merge_check_started`
 * is on disk BEFORE the first command runs — the record ahead of its effect —
 * with the fingerprint of the workspace and the hash of the check manifest;
 * then every command of the inner check set runs, IN THE WORKSPACE and in no
 * worker tree, none skipped at a failure; `merge_check_finished` records the
 * result per command and the conditions; the outcome decides keep, repair or
 * `layerOffForAttempt`.
 */
export async function theMergeCheckOfTheGroup(input: {
  readonly store: TreeStoreService;
  readonly writer: OneWriter;
  readonly runner: CheckRunner;
  readonly innerCheckSet: readonly ManifestEntry[];
  readonly workspace: string;
  readonly workerTrees?: readonly string[] | undefined;
  readonly containment?: ContainmentLevel | undefined;
  readonly environmentAllowList?: readonly string[] | undefined;
  /** The tasks the integrated workers named, for the unit and the charges. */
  readonly tasks: readonly string[];
  /** The canonical hash of annex X §X.5, which names the unit. */
  readonly hash: (text: string) => string;
}): Promise<TheMergeCheck> {
  const fingerprintBefore = await input.store.snapshot(input.workspace);
  const manifestHash = input.hash(JSON.stringify(input.innerCheckSet.map((entry) => entry.id)));
  const run = await input.writer.ahead(
    "merge_check_started",
    dataOfTheKind("merge_check_started", {
      fingerprint: fingerprintBefore,
      checkManifestHash: manifestHash,
    }),
    () =>
      runMergeCheck({
        runner: input.runner,
        innerCheckSet: input.innerCheckSet,
        workspace: input.workspace,
        ...(input.workerTrees === undefined ? {} : { workerTrees: input.workerTrees }),
        ...(input.containment === undefined ? {} : { containment: input.containment }),
        ...(input.environmentAllowList === undefined
          ? {}
          : { environmentAllowList: input.environmentAllowList }),
        fingerprintOfTheWorkspace: () => input.store.snapshot(input.workspace),
      }),
  );
  await input.writer.record(
    "merge_check_finished",
    dataOfTheKind("merge_check_finished", {
      fingerprint: run.fingerprintAfter,
      results: Object.fromEntries(
        run.commands.map((command) => [
          command.id,
          command.exitCode === 0 && command.condition === null
            ? "pass"
            : `exit ${command.exitCode}`,
        ]),
      ),
      conditions: run.commands
        .filter((command) => command.condition !== null)
        .map((command) => command.condition),
    }),
  );
  return {
    run,
    outcome: outcomeOfTheMergeCheck({ run, tasks: input.tasks, hash: input.hash }),
  };
}

/* ------------------------------------------------------------------ *
 * The close of the run of the group.
 * ------------------------------------------------------------------ */

/** What closing the run of the group did. */
export type ClosedGroupRun = {
  /** The opaque names of the worker trees the close removed. */
  readonly treesRemoved: readonly string[];
  /** The snapshots the sweep removed from the store. */
  readonly swept: readonly TreeId[];
  /** The per-worker outcomes the `group_closed` record carries. */
  readonly workerOutcomes: Readonly<Record<string, string>>;
};

/**
 * CLOSE THE RUN OF ONE GROUP (F143-FR-027): the worker trees of the group are
 * removed on success and on failure ALIKE, the temporary directories beside
 * them with them; then `group_closed` — the record ahead of the sweep, so a
 * crash between the two is a group closed with a store that still holds its
 * snapshots, which the next start's sweep takes; then the sweep. Where the
 * group ran, `prepared` carries the trees; where it did not, the close is the
 * record and the sweep alone.
 */
export async function closeTheGroupRun(input: {
  readonly places: StorePlaces;
  readonly writer: OneWriter;
  readonly store: TreeStoreService;
  readonly runId: string;
  readonly groupId: string;
  /** `closed` where the group closed whole, `failed` where anything refused it. */
  readonly outcome: "closed" | "failed";
  readonly prepared?: PreparedGroup | undefined;
  /** The outcome of every worker, for the record. */
  readonly workerOutcomes?: Readonly<Record<string, string>> | undefined;
}): Promise<ClosedGroupRun> {
  if (input.prepared !== undefined) removeTheTemporaryDirectories(input.prepared);
  const released = releaseTheTreesOfTheGroup(input.places, {
    runId: input.runId,
    groupId: input.groupId,
    outcome: input.outcome === "closed" ? "success" : "failure",
  });
  const workerOutcomes = input.workerOutcomes ?? {};
  await input.writer.ahead(
    "group_closed",
    dataOfTheKind("group_closed", {
      outcome: input.outcome,
      workerOutcomes,
      treesRemoved: [...released.opaques],
    }),
    () => Promise.resolve(),
  );
  const swept = await input.store.sweep();
  return {
    treesRemoved: Object.freeze([...released.opaques]),
    swept: Object.freeze([...swept]),
    workerOutcomes: Object.freeze({ ...workerOutcomes }),
  };
}

/** The registrations of the closed set, exported for the wiring's say of them. */
export const THE_PARALLEL_LEDGER_REGISTRY = PARALLEL_LEDGER_KIND_REGISTRY;

/** The fields of the `data` of one kind, in the order of the annex. */
export const dataFieldsOfTheKind = dataFieldsOf;
