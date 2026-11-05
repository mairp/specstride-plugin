/**
 * T037 and T041 — INTEGRATION (F143-FR-014, F143-FR-021; R29 PU-27, PU-46;
 * R29v PU-94; ruling P5).
 *
 *  T037, F143-FR-014 — THE WORK OF A KILLED WORKER IS DISCARDED FROM
 *    INTEGRATION, AND ITS TASK RETURNS TO THE MAIN LINE. ITS SNAPSHOT STAYS
 *    IN THE STORE UNTIL THE PHASE ATTEMPT ENDS. The two halves pull in
 *    opposite directions and both are required: the work is not integrated,
 *    and the record of it is not thrown away either — a killed worker is the
 *    case where someone will want to know afterwards what was in the tree, so
 *    the snapshot outlives the group and leaves the store with `sweep` at the
 *    end of the phase attempt and never with `release` (CQ-237).
 *
 *  T041, F143-FR-021 — THE TICKS ARE THE OTHER WRITE. After the ledger record
 *    `applied` and BEFORE THE MERGE CHECK, the integrated tasks are ticked
 *    THROUGH THE SPEC-FORMAT ADAPTER, under a ledger record that lists the
 *    task ids. The ticks are IDEMPOTENT. ANY CHANGE A WORKER MADE TO THE TASK
 *    LIST IS DROPPED; a tick remains the claim of the worker.
 *
 * WHY THE TICKS GO THROUGH THE ADAPTER AND NOT THROUGH THE STORE. The
 * application writes the bytes of stored objects on the paths of audited
 * deltas; a tick is not that. It is an edit of one checkbox of the task list,
 * and the task list is the one file whose grammar belongs to a single owner
 * (the constitution, Principle IV). So the task list is DROPPED FROM EVERY
 * DELTA (F143-FR-008) — a worker's own edit of it never reaches the workspace
 * — and the runtime then makes the tick itself, through the operation `tick`
 * of `specstride.spec-format/1`, which changes checkboxes only and keeps
 * every other byte.
 *
 * THE ORDER IS THE STATE SEQUENCE. `applied` → `ticks_applied` →
 * `merge_check_started`. Nothing here may run before `applied` is on disk,
 * because a tick on a workspace the application did not finish writing would
 * be a claim about work that is not there.
 *
 * WHY THIS FILE WRITES NOTHING ITSELF. It is a module of the core: it starts
 * no process and touches no file (annex A, §A.3). The store, the spec-format
 * adapter and the ledger are handed in as `IntegrationPorts`.
 */
import type { AuditedDelta, ComposeResult } from "@specstride/contracts/ep/tree-store";
import {
  KINDS_THAT_CARRY_WORKER_ID,
  LEDGER_SCHEMA,
  NAMESPACE,
  PARALLEL_LEDGER_KINDS,
  isParallelLedgerKind,
  registrationOf,
} from "./ledger-kinds.ts";
import type { ParallelLedgerKind } from "./ledger-kinds.ts";
import type { DerivedOutcome, WorkerOutcome } from "./barrier.ts";

/* ------------------------------------------------------------------ *
 * T037 — the work of a killed worker (F143-FR-014).
 * ------------------------------------------------------------------ */

/** F143-FR-014 — the outcomes whose work takes no part in integration. */
export const OUTCOMES_LEFT_OUT_OF_INTEGRATION: readonly WorkerOutcome[] = Object.freeze([
  "killed",
  "refused",
  "paused",
]);

/** F143-FR-014 — the one outcome whose delta may be composed. */
export const THE_ONLY_OUTCOME_THAT_IS_INTEGRATED: WorkerOutcome = "integrated";

/** F143-FR-014 — the snapshot of a killed worker stays in the store until this. */
export const SNAPSHOT_OF_A_KILLED_WORKER_IS_KEPT_UNTIL = "the end of the phase attempt" as const;

/**
 * F143-FR-027, CQ-237 — the operation that removes a snapshot from the store.
 * `release` removes a TREE and its temporary directory and leaves the store
 * as it was; a snapshot leaves the store with `sweep`, which is why the
 * snapshot of a killed worker survives the close of its group.
 */
export const A_SNAPSHOT_LEAVES_THE_STORE_WITH = "sweep" as const;
export const A_SNAPSHOT_LEAVES_THE_STORE_WITH_RELEASE = false as const;

/** One worker as integration receives it: its outcome, its delta, its snapshot. */
export type WorkerForIntegration = {
  readonly workerId: string;
  /** The task assigned at launch; the position in this list is the task order. */
  readonly task: string;
  /** The tree id of its final snapshot. */
  readonly finalTreeId: string;
  /** The paths of its delta, as `changed` gave them. */
  readonly paths: readonly string[];
  /** The outcome the barrier derived (F143-FR-012). */
  readonly outcome: DerivedOutcome;
};

/**
 * F143-FR-014 — THE DELTAS THAT TAKE PART IN COMPOSITION: the workers whose
 * outcome is `integrated`, IN THE ORDER OF THE TASKS AT LAUNCH. A killed
 * worker contributes nothing, and neither does a refused or a paused one.
 *
 * The order is the order of `workers` as the caller holds it, which is the
 * order of the tasks at launch and never the order of completion
 * (F143-FR-019): the refusal `overlap` must name the worker the plan decided
 * and not the one the clock did.
 */
export function deltasForIntegration(
  workers: readonly WorkerForIntegration[],
): readonly AuditedDelta[] {
  return Object.freeze(
    workers
      .filter((w) => w.outcome.outcome === THE_ONLY_OUTCOME_THAT_IS_INTEGRATED)
      .map((w) =>
        Object.freeze({
          workerId: w.workerId,
          treeId: w.finalTreeId,
          paths: Object.freeze([...w.paths]),
        }),
      ),
  );
}

/**
 * F143-FR-014 — the workers whose work is left out of integration, with the
 * outcome that left it out. The counterpart of `deltasForIntegration`, so
 * that a caller — and a test — can read both sides of the same decision.
 */
export function leftOutOfIntegration(
  workers: readonly WorkerForIntegration[],
): readonly { readonly workerId: string; readonly outcome: WorkerOutcome }[] {
  return Object.freeze(
    workers
      .filter((w) => w.outcome.outcome !== THE_ONLY_OUTCOME_THAT_IS_INTEGRATED)
      .map((w) => Object.freeze({ workerId: w.workerId, outcome: w.outcome.outcome })),
  );
}

/**
 * F143-FR-014 — the tasks that return to the main line: those of every worker
 * that was not integrated, with their counts as they were (F143-FR-012).
 */
export function tasksThatReturnToTheMainLine(
  workers: readonly WorkerForIntegration[],
): readonly string[] {
  return Object.freeze(
    workers
      .filter((w) => w.outcome.taskReturnsToTheMainLine)
      .map((w) => w.task)
      .sort(),
  );
}

/**
 * F143-FR-014 — the tree ids that must still be in the store when the group
 * closes: the final snapshot of every worker that was killed. `release` of
 * the group's trees does not remove them, and `sweep` does, at the end of the
 * phase attempt.
 */
export function snapshotsKeptUntilThePhaseAttemptEnds(
  workers: readonly WorkerForIntegration[],
): readonly string[] {
  return Object.freeze(
    workers
      .filter((w) => w.outcome.outcome === "killed")
      .map((w) => w.finalTreeId)
      .sort(),
  );
}

/* ------------------------------------------------------------------ *
 * T041 — the ticks (F143-FR-021).
 * ------------------------------------------------------------------ */

/** F143-FR-021 — the ledger kind the ticks are written under. */
export const TICKS_KIND: ParallelLedgerKind = "ticks_applied";

/** F143-FR-021 — the record the ticks come after, and the one they come before. */
export const TICKS_COME_AFTER: ParallelLedgerKind = "applied";
export const TICKS_COME_BEFORE: ParallelLedgerKind = "merge_check_started";

/** F143-FR-021 — the ticks go through the spec-format adapter and nowhere else. */
export const TICKS_GO_THROUGH = "specstride.spec-format/1" as const;
export const TICKS_OPERATION = "tick" as const;

/** F143-FR-021 — the ticks are idempotent. */
export const TICKS_ARE_IDEMPOTENT = true as const;

/**
 * F143-FR-021, F143-FR-008 — any change a worker made to the task list is
 * dropped; a tick remains the claim of the worker. The drop happens in the
 * delta (`changed` of the store never names the task list), so by the time
 * integration runs there is nothing left to drop — this constant states the
 * rule the delta keeps.
 */
export const A_CHANGE_A_WORKER_MADE_TO_THE_TASK_LIST_IS_DROPPED = true as const;

/** F143-FR-021 — a tick remains the claim of the worker. */
export const A_TICK_REMAINS_THE_CLAIM_OF_THE_WORKER = true as const;

/**
 * F143-FR-021 — the tasks to tick: the task of every worker that was
 * integrated, in the order of the tasks at launch. A task whose worker was
 * killed, refused or paused is NOT ticked: it went back to the main line.
 */
export function tasksToTick(workers: readonly WorkerForIntegration[]): readonly string[] {
  return Object.freeze(
    workers
      .filter((w) => w.outcome.outcome === THE_ONLY_OUTCOME_THAT_IS_INTEGRATED)
      .map((w) => w.task),
  );
}

/** The result of the operation `tick` of the spec-format adapter (annex C, §C.7). */
export type TickOutcome = {
  readonly ticked: readonly { readonly taskId: string; readonly line: number }[];
  /** The task ids `tick` was asked for and did not find. */
  readonly notFound?: readonly string[];
};

/** What integration is handed. Each member is something the core may not do itself. */
export type IntegrationPorts = {
  /** `compose(base, deltas)` of the store, behind its interface. */
  compose(baseTreeId: string, deltas: readonly AuditedDelta[]): Promise<ComposeResult>;
  /** `apply(base, composed, workspace)` of the store: the paths written. */
  apply(baseTreeId: string, composed: string, workspace: string): Promise<readonly string[]>;
  /** The fingerprint of the workspace, for the record `applied`. */
  fingerprint(directory: string): Promise<string>;
  /** The operation `tick` of `specstride.spec-format/1`, and nothing else. */
  tick(taskIds: readonly string[]): Promise<TickOutcome>;
  /** Write one record of the parallel namespace, through the one writer. */
  record(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): Promise<void>;
};

/**
 * F143-FR-021 — TICK THE INTEGRATED TASKS. Called after the record `applied`
 * and before the merge check, under the record `ticks_applied`, which lists
 * the task ids.
 *
 * IDEMPOTENCE is the adapter's, not this module's: `tick` changes checkboxes
 * only and leaves an already-ticked box as it is (annex C, §C.7, the failure
 * path "the file is left unchanged and it is reported; it never undoes an
 * approval"). Calling this function twice with the same tasks therefore
 * leaves the same file, which is what `CT-143-121` observes from disk.
 */
export async function applyTheTicks(
  ports: IntegrationPorts,
  workers: readonly WorkerForIntegration[],
): Promise<{ readonly taskIds: readonly string[]; readonly outcome: TickOutcome }> {
  const taskIds = tasksToTick(workers);
  const outcome = await ports.tick(taskIds);
  await ports.record(TICKS_KIND, { taskIds: [...taskIds] });
  return Object.freeze({ taskIds, outcome });
}

/* ------------------------------------------------------------------ *
 * The whole of integration, in the order of the state sequence.
 * ------------------------------------------------------------------ */

/** What integration gave. */
export type IntegrationResult =
  | {
      readonly integrated: true;
      /** The tree id of the composed tree. */
      readonly composedTreeId: string;
      /** The paths the application wrote and deleted. */
      readonly paths: readonly string[];
      /** The task ids that were ticked (F143-FR-021). */
      readonly ticked: readonly string[];
      /** The workers whose work was left out, with the outcome (F143-FR-014). */
      readonly leftOut: readonly { readonly workerId: string; readonly outcome: WorkerOutcome }[];
      /** The tasks that returned to the main line (F143-FR-014). */
      readonly tasksReturned: readonly string[];
      /** The snapshots the store keeps until the phase attempt ends (F143-FR-014). */
      readonly snapshotsKept: readonly string[];
    }
  | {
      readonly integrated: false;
      /** `overlap`, the one refusal reason of `compose` (F143-FR-019). */
      readonly reason: string;
      readonly paths: readonly string[];
      readonly workerId: string;
    };

/**
 * F143-FR-014, F143-FR-019 to F143-FR-021 — INTEGRATE A GROUP, in the order
 * of the state sequence of `data-model.md`:
 *
 *     merge_done → apply_started → applied → ticks_applied
 *
 * The work of a killed worker never reaches `compose` (F143-FR-014); the
 * application is recorded before it is made, which is the store's own
 * business (F143-FR-020, `apply_started` is written by the write-ahead
 * recorder the store is given); and the ticks come after `applied`.
 */
export async function integrateGroup(
  ports: IntegrationPorts,
  input: {
    readonly baseTreeId: string;
    readonly workspace: string;
    readonly workers: readonly WorkerForIntegration[];
  },
): Promise<IntegrationResult> {
  const deltas = deltasForIntegration(input.workers);
  const composed = await ports.compose(input.baseTreeId, deltas);
  if (!composed.composed) {
    return Object.freeze({
      integrated: false as const,
      reason: composed.reason,
      paths: composed.paths,
      workerId: composed.workerId,
    });
  }
  await ports.record("merge_done", {
    treeId: composed.treeId,
    workers: deltas.map((d) => d.workerId),
  });

  const paths = await ports.apply(input.baseTreeId, composed.treeId, input.workspace);
  await ports.record("applied", { fingerprint: await ports.fingerprint(input.workspace) });

  const ticks = await applyTheTicks(ports, input.workers);

  return Object.freeze({
    integrated: true as const,
    composedTreeId: composed.treeId,
    paths,
    ticked: ticks.taskIds,
    leftOut: leftOutOfIntegration(input.workers),
    tasksReturned: tasksThatReturnToTheMainLine(input.workers),
    snapshotsKept: snapshotsKeptUntilThePhaseAttemptEnds(input.workers),
  });
}

/* ================================================================== *
 * T063 — F143-FR-023: THE THIRTEEN RECORD KINDS, WRITTEN AHEAD,
 * THROUGH THE ONE WRITER (R29 PU-55, PU-56; R29v PU-94, PU-98).
 * ================================================================== */

/**
 * F143-FR-023 — five clauses, and each is a thing a reader can check here:
 *
 *  1 "A run MUST have one ledger and one writer."  `theOneWriter` is that
 *    writer, and `writers()` counts the writers a run made: a second call of
 *    `theOneWriter` over the same ledger is a SECOND WRITER and is refused,
 *    rather than quietly working and interleaving two `seq` sequences.
 *  2 "The records of a group join the ledger of the run in the namespace
 *    parallel, WRITTEN AHEAD, from the closed set of thirteen kinds."
 *    `ahead()` is the only way to take a step: it writes the record and THEN
 *    carries out the effect, so a crash between them leaves a record of an
 *    intention and never an effect with no record. That asymmetry is what
 *    F143-FR-025 reads: every one of its eight states is "this record is on
 *    disk, so this step may have happened — check and repeat it".
 *  3 "Every record of a worker MUST carry `workerId`."  Checked at the write,
 *    not at the read: a record that should carry one and does not is REFUSED
 *    before it reaches the ledger.
 *  4 "While a group is open the engine MUST be the only writer of the event
 *    file and of the ledger; workers MUST write no file of the control plane."
 *    Stated as values, and kept by the fact that a worker is a harness
 *    process with its own tree as its write root (F143-FR-009, F143-FR-010):
 *    nothing of the runtime runs in a worker tree.
 *  5 "A truncated, reordered or edited ledger inside a group MUST be detected
 *    and MUST switch the loop layer off for the phase attempt."
 *    `ledgerIntegrityInsideAGroup` is that detection, and it is three checks
 *    and not one, because the three faults leave three different marks.
 *
 * WHY HERE. Integration is the half of a group that WRITES THE WORKSPACE, so
 * it is the half for which "written ahead" is not bookkeeping: `apply_started`
 * on disk before the first byte is written is the only reason an interrupted
 * application can be told apart from a workspace somebody else edited.
 */

/** F143-FR-023 — one ledger, and one writer of it. */
export const LEDGERS_PER_RUN = 1 as const;
export const WRITERS_PER_RUN = 1 as const;

/** F143-FR-023 — the records are written AHEAD of the step they describe. */
export const RECORDS_ARE_WRITTEN = "ahead" as const;

/** F143-FR-023 — what the engine is the only writer of while a group is open. */
export const THE_ENGINE_IS_THE_ONLY_WRITER_OF = ["the event file", "the ledger"] as const;

/** R29v PU-98, in the words of LR-4 and LR-5 — and workers write none of it. */
export const WORKERS_WRITE_NO_FILE_OF_THE_CONTROL_PLANE = true as const;

/** F143-FR-023 — the thirteen kinds, from the closed set that owns them. */
export const THE_THIRTEEN_KINDS = PARALLEL_LEDGER_KINDS;

/**
 * F143-FR-023 — "written ahead", read exactly. NINE of the thirteen kinds
 * carry data that is known BEFORE the step they describe, so each is on disk
 * before its effect runs and `ahead()` is how it gets there. The other FOUR
 * carry the OUTCOME of their step — `worker_started` the pid the spawn
 * returned, `worker_ended` the end cause and the final tree id, `applied` the
 * fingerprint of the workspace after the write, `merge_check_finished` the
 * result of the check — so no honest record of them can precede the step, and
 * each is written the moment its step ends and before any LATER step begins.
 *
 * The distinction is not a softening of the requirement: it is what makes
 * F143-FR-025 work. Every one of the eight resume states is of the form "this
 * record is on disk, so this step MAY have happened — verify and repeat it",
 * and that reading is available exactly because the record of an intention
 * precedes the irreversible effect while the record of an outcome follows it.
 * `apply_started` is the case that matters most, and it is in the first set.
 */
export const KINDS_WRITTEN_AHEAD_OF_THEIR_EFFECT: readonly ParallelLedgerKind[] = Object.freeze([
  "group_planned",
  "group_started",
  "group_barrier",
  "audit_done",
  "merge_done",
  "apply_started",
  "ticks_applied",
  "merge_check_started",
  "group_closed",
]);

/** And the four that record the outcome of their own step. */
export const KINDS_THAT_RECORD_AN_OUTCOME: readonly ParallelLedgerKind[] = Object.freeze([
  "worker_started",
  "worker_ended",
  "applied",
  "merge_check_finished",
]);

/** F143-FR-023 — the effect of a truncated, reordered or edited ledger. */
export const EFFECT_OF_A_BROKEN_LEDGER_INSIDE_A_GROUP =
  "loop-layers-off-for-the-phase-attempt" as const;

/** And it is never a stop of the run. */
export const A_BROKEN_LEDGER_STOPS_THE_RUN = false as const;

/** Why one write of the ledger was refused. */
export const WRITE_REFUSALS = [
  "kind-is-not-of-the-closed-set",
  "a-record-of-a-worker-must-carry-workerId",
  "this-record-must-not-carry-workerId",
  "a-second-writer-of-the-ledger",
] as const;
export type WriteRefusal = (typeof WRITE_REFUSALS)[number];

/** A write of the ledger that F143-FR-023 forbids. */
export class LedgerWriteRefused extends Error {
  readonly because: WriteRefusal;
  readonly kind: string;
  constructor(because: WriteRefusal, kind: string) {
    super(`the ledger refused a record of kind \`${kind}\`: ${because}`);
    this.name = "LedgerWriteRefused";
    this.because = because;
    this.kind = kind;
  }
}

/** What the one writer is handed. The append itself is a port. */
export type OneWriterPorts = {
  /**
   * Append one record of the parallel namespace. ONE WHOLE LINE, ONE CALL —
   * ordinarily the queue of `queue.ts`, which assigns `seq` at the append.
   */
  append(record: Readonly<Record<string, unknown>>): Promise<void>;
  /**
   * Append one record SYNCHRONOUSLY — `appendNow` of the queue. A WRITE-AHEAD
   * record cannot be left to a promise: `apply_started` must be on disk before
   * the first byte of the application is written, and a caller inside a
   * synchronous write-ahead callback of the store has no `await` to give.
   */
  appendNow?(record: Readonly<Record<string, unknown>>): void;
};

/** One record the writer wrote, as it wrote it. */
export type WrittenRecord = {
  readonly kind: ParallelLedgerKind;
  readonly workerId?: string;
  readonly groupId: string;
  readonly data: Readonly<Record<string, unknown>>;
};

/** The one writer of the ledger of a run (F143-FR-023). */
export type OneWriter = {
  /** Write one record. Refuses a kind outside the closed set. */
  record(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): Promise<WrittenRecord>;
  /**
   * F143-FR-023 — TAKE ONE STEP, RECORD AHEAD OF IT. The record is on disk
   * before `effect` runs; `effect`'s own result comes back untouched. A
   * failing effect does NOT unwrite the record: that is the point.
   */
  ahead<T>(
    kind: ParallelLedgerKind,
    data: Readonly<Record<string, unknown>>,
    effect: () => Promise<T>,
  ): Promise<T>;
  /**
   * Write one record SYNCHRONOUSLY, for a write-ahead record whose effect
   * follows it in the same turn. Refuses where the port gives no `appendNow`.
   */
  recordNow(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): WrittenRecord;
  /** Every record this writer wrote, in order. */
  written(): readonly WrittenRecord[];
  /** The kinds it wrote, in order. */
  kinds(): readonly ParallelLedgerKind[];
  /** The kinds of the closed set it has not written yet. */
  kindsNotYetWritten(): readonly ParallelLedgerKind[];
};

/**
 * THE REGISTER OF WRITERS. F143-FR-023 says one writer per run, so the claim
 * has to be checkable: `theOneWriter` registers itself under the logical name
 * of the ledger and refuses a second registration for the same name. A test
 * can then ask for two and be told no, rather than having to prove a negative.
 */
const writersOfALedger = new Map<string, number>();

/** How many writers were made for this ledger. One, or the run is wrong. */
export function writersOf(ledgerName: string): number {
  return writersOfALedger.get(ledgerName) ?? 0;
}

/** Give up the writer of a ledger, so that a later run may take it. */
export function releaseTheWriter(ledgerName: string): void {
  writersOfALedger.delete(ledgerName);
}

/**
 * F143-FR-023 — THE ONE WRITER of the ledger of a run. Every record of a
 * group goes through it: the group executor's, the barrier's and integration's
 * alike, which is why its type is the shape of the `record` port those three
 * modules already take.
 */
export function theOneWriter(
  ports: OneWriterPorts,
  input: {
    readonly groupId: string;
    readonly ledgerName: string;
    /**
     * F143-FR-028 — where the counters of the layer come from. The writer is
     * the ONE place every record passes, so it is the one place the envelope
     * field `counters` of annex B §B.13 is attached: the callback is given the
     * envelope as it is about to be written — the record included — and the
     * record carries the counters AS THEY STAND AFTER IT. Where the callback
     * is absent no field is written, which keeps the writer honest about what
     * it does not know.
     */
    readonly countersOf?: (
      envelope: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>> | undefined;
  },
): OneWriter {
  const already = writersOf(input.ledgerName);
  if (already > 0) throw new LedgerWriteRefused("a-second-writer-of-the-ledger", "<any>");
  writersOfALedger.set(input.ledgerName, already + 1);

  const written: WrittenRecord[] = [];

  /** The envelope and the two refusals that guard it, for both write paths. */
  const envelopeOf = (
    kind: ParallelLedgerKind,
    data: Readonly<Record<string, unknown>>,
  ): { readonly envelope: Record<string, unknown>; readonly kept: WrittenRecord } => {
    if (!isParallelLedgerKind(kind)) {
      throw new LedgerWriteRefused("kind-is-not-of-the-closed-set", String(kind));
    }
    const { workerId, ...rest } = data as { workerId?: unknown };
    const carries = (KINDS_THAT_CARRY_WORKER_ID as readonly string[]).includes(kind);
    if (carries && typeof workerId !== "string") {
      throw new LedgerWriteRefused("a-record-of-a-worker-must-carry-workerId", kind);
    }
    if (!carries && workerId !== undefined) {
      throw new LedgerWriteRefused("this-record-must-not-carry-workerId", kind);
    }
    const preEnvelope = {
      schema: LEDGER_SCHEMA,
      ns: NAMESPACE,
      kind,
      ...(carries ? { workerId: workerId as string } : {}),
      groupId: input.groupId,
      data: rest as Record<string, unknown>,
    };
    const counters = input.countersOf?.(preEnvelope);
    return {
      envelope: { ...preEnvelope, ...(counters === undefined ? {} : { counters }) },
      kept: Object.freeze({
        kind,
        ...(carries ? { workerId: workerId as string } : {}),
        groupId: input.groupId,
        data: Object.freeze(rest as Record<string, unknown>),
      }),
    };
  };

  const record = async (
    kind: ParallelLedgerKind,
    data: Readonly<Record<string, unknown>>,
  ): Promise<WrittenRecord> => {
    const { envelope, kept } = envelopeOf(kind, data);
    await ports.append(envelope);
    written.push(kept);
    return kept;
  };

  const recordNow = (
    kind: ParallelLedgerKind,
    data: Readonly<Record<string, unknown>>,
  ): WrittenRecord => {
    if (ports.appendNow === undefined) {
      throw new Error(
        `this writer has no synchronous append: a write-ahead record of kind \`${kind}\` cannot ` +
          `be guaranteed on disk before its effect (F143-FR-023)`,
      );
    }
    const { envelope, kept } = envelopeOf(kind, data);
    ports.appendNow(envelope);
    written.push(kept);
    return kept;
  };

  return Object.freeze({
    record,
    recordNow,
    async ahead<T>(
      kind: ParallelLedgerKind,
      data: Readonly<Record<string, unknown>>,
      effect: () => Promise<T>,
    ): Promise<T> {
      // THE RECORD FIRST. A crash here leaves a record and no effect, which
      // is the state F143-FR-025 is written for.
      await record(kind, data);
      return await effect();
    },
    written: () => Object.freeze([...written]),
    kinds: () => Object.freeze(written.map((r) => r.kind)),
    kindsNotYetWritten: () =>
      Object.freeze(PARALLEL_LEDGER_KINDS.filter((kind) => !written.some((r) => r.kind === kind))),
  });
}

/* ------------------------------------------------------------------ *
 * The detection of a truncated, reordered or edited ledger.
 * ------------------------------------------------------------------ */

/** One record of the ledger as the detection reads it. */
export type LedgerLineRead = {
  readonly schema?: string;
  readonly ns?: string;
  readonly kind?: string;
  readonly seq?: number;
  readonly prev?: string;
  readonly workerId?: string;
  readonly groupId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
};

/** The three faults F143-FR-023 names, and the marks each leaves. */
export const LEDGER_FAULTS = ["truncated", "reordered", "edited"] as const;
export type LedgerFault = (typeof LEDGER_FAULTS)[number];

/** One thing the detection found. */
export type LedgerRefusal = {
  readonly fault: LedgerFault;
  /** What was found, for a failure message. */
  readonly detail: string;
  /** The `seq` of the record it was found at, where there is one. */
  readonly seq?: number;
};

/** What the detection came to. */
export type LedgerIntegrity = {
  /** True where nothing was found. */
  readonly sound: boolean;
  readonly refusals: readonly LedgerRefusal[];
  /** F143-FR-023 — what an unsound ledger does, and it is not a stop. */
  readonly effect: typeof EFFECT_OF_A_BROKEN_LEDGER_INSIDE_A_GROUP;
  readonly stopsTheRun: false;
};

/**
 * F143-FR-023 — DETECT A TRUNCATED, REORDERED OR EDITED LEDGER INSIDE A
 * GROUP. Three checks, because the three faults leave three different marks
 * and no single check sees all of them:
 *
 *  TRUNCATED — `seq` runs `1, 2, … n` without a gap (annex B §B.13 types it
 *    "position in the ledger, from 1, without gaps"). A record taken out of
 *    the middle leaves a gap; a record taken off the END leaves a chain that
 *    is still sound, so truncation of the tail is caught by the SECOND check
 *    instead: the kinds of an open group must be a PREFIX of the state
 *    sequence, and a group whose `group_closed` is present while an earlier
 *    kind is missing has had its middle removed.
 *
 *  REORDERED — the kinds of one group must follow the state sequence of
 *    `data-model.md`: the ordinal of each kind is non-decreasing. The two
 *    per-worker kinds repeat, once per worker, which is why the check is on
 *    the ordinal and not on equality with the sequence.
 *
 *  EDITED — `prev` is the hash of the record before. The hash is a PORT,
 *    because the core does not hash (annex A, §A.3); where no `hashOf` is
 *    given the chain is not checked and the other two still are.
 */
export function ledgerIntegrityInsideAGroup(
  ledger: readonly LedgerLineRead[],
  options: {
    readonly groupId?: string;
    /** The hash of one record, as the ledger key signs it. */
    readonly hashOf?: (record: LedgerLineRead) => string;
    /** True where the group is known to be closed, for the prefix check. */
    readonly groupIsClosed?: boolean;
  } = {},
): LedgerIntegrity {
  const refusals: LedgerRefusal[] = [];
  const ours = ledger.filter(
    (line) =>
      line.ns === NAMESPACE &&
      isParallelLedgerKind(line.kind ?? "") &&
      (options.groupId === undefined || line.groupId === options.groupId),
  );

  // TRUNCATED — `seq` without a gap, over the whole ledger as it was read.
  const withSeq = ledger.filter((line) => typeof line.seq === "number");
  for (const [index, line] of withSeq.entries()) {
    if (line.seq !== index + 1) {
      refusals.push({
        fault: "truncated",
        detail: `\`seq\` is ${String(line.seq)} at position ${String(index + 1)}`,
        ...(line.seq === undefined ? {} : { seq: line.seq }),
      });
      break;
    }
  }

  // REORDERED — the ordinal of the kinds of the group never falls.
  let highest = 0;
  for (const line of ours) {
    const ordinal = registrationOf(line.kind as ParallelLedgerKind).ordinal;
    if (ordinal < highest) {
      refusals.push({
        fault: "reordered",
        detail: `\`${String(line.kind)}\` (ordinal ${String(ordinal)}) comes after ordinal ${String(highest)}`,
        ...(line.seq === undefined ? {} : { seq: line.seq }),
      });
      break;
    }
    highest = ordinal;
  }

  // TRUNCATED, the other mark — a closed group whose kinds are not the whole
  // sequence has had records removed from its middle.
  if (options.groupIsClosed === true || ours.some((line) => line.kind === "group_closed")) {
    const present = new Set(ours.map((line) => line.kind));
    const missing = PARALLEL_LEDGER_KINDS.filter((kind) => !present.has(kind));
    if (missing.length > 0) {
      refusals.push({
        fault: "truncated",
        detail: `the group is closed and these kinds are absent: ${missing.join(", ")}`,
      });
    }
  }

  // EDITED — the chain, where a hash was given.
  if (options.hashOf !== undefined) {
    for (let index = 1; index < withSeq.length; index += 1) {
      const line = withSeq[index] as LedgerLineRead;
      const before = withSeq[index - 1] as LedgerLineRead;
      if (line.prev !== undefined && line.prev !== options.hashOf(before)) {
        refusals.push({
          fault: "edited",
          detail: `\`prev\` does not hash the record before it`,
          ...(line.seq === undefined ? {} : { seq: line.seq }),
        });
        break;
      }
    }
  }

  // EDITED, the other mark — a record of a worker without its `workerId`, or
  // a record of the group with one (F143-FR-023).
  for (const line of ours) {
    const carries = (KINDS_THAT_CARRY_WORKER_ID as readonly string[]).includes(line.kind ?? "");
    if (carries && typeof line.workerId !== "string") {
      refusals.push({
        fault: "edited",
        detail: `\`${String(line.kind)}\` carries no \`workerId\``,
        ...(line.seq === undefined ? {} : { seq: line.seq }),
      });
      break;
    }
    if (!carries && line.workerId !== undefined) {
      refusals.push({
        fault: "edited",
        detail: `\`${String(line.kind)}\` carries a \`workerId\` and must not`,
        ...(line.seq === undefined ? {} : { seq: line.seq }),
      });
      break;
    }
  }

  return Object.freeze({
    sound: refusals.length === 0,
    refusals: Object.freeze(refusals.map((r) => Object.freeze(r))),
    effect: EFFECT_OF_A_BROKEN_LEDGER_INSIDE_A_GROUP,
    stopsTheRun: false as const,
  });
}
