/**
 * T062 and T065 — HOLDERS OF THE RUN TOKEN, and THE RESUME DECISION
 * (F143-FR-018, F143-FR-025; R29 PU-65; R29v PU-83, PU-90, PU-95; R11 T-26;
 * ruling 55).
 *
 * TWO REQUIREMENTS, ONE FILE, because they are one sequence. An engine that
 * starts again over an unfinished group must do them IN THIS ORDER and no
 * other:
 *
 *   1  find the holders of the run token and END THEM, after the identity
 *      check  (F143-FR-018; a tree is swept only after its processes are ended)
 *   2  read the LAST LEDGER RECORD and decide what to do  (F143-FR-025)
 *
 * The order is the requirement, not a convenience: step 2 may repeat the
 * application, and repeating it while a worker of the interrupted run still
 * holds a file handle would write a workspace that something else is changing.
 * So `resumeAGroup` below does them in that order and `endHoldersOfTheRunToken`
 * returns before `decideFromTheLastRecord` is called.
 *
 * THE IDENTITY CHECK (R11 T-26) is why this file never signals a pid on its
 * own say-so. A pid is reused. A process that holds the run token in its
 * environment AND whose start time is the one the registry recorded is the
 * process the registry means; anything else is a stranger wearing its number,
 * and `signalsAllowedFor` refuses it. The core does not signal at all — it
 * says WHICH holder may be signalled and the port does it.
 *
 * THE EIGHT STATES of F143-FR-025 are `RESUME_STATES` below, numbered as the
 * requirement numbers them, and `decideFromTheLastRecord` is the one place
 * that maps a ledger to one of them. The two records the requirement adds to
 * R29 PU-65 — `merge_check_finished` and `group_closed` — leave no step open
 * and so have decisions of their own, outside the eight.
 *
 * WHAT A LOST STREAM COSTS. A pass whose stream was lost is recorded with
 * `usage: unknown` (F143-FR-018), and every cost report that includes it says
 * that it is incomplete. Both are values here, so that a caller cannot record
 * the pass and forget the report.
 *
 * THIS FILE READS NO FILE AND SIGNALS NO PROCESS. It is a module of the core:
 * the process table, the signal, the content of a path and the ledger all
 * arrive through `ResumePorts` (annex A, §A.3).
 */
import {
  PARALLEL_LEDGER_KINDS,
  type ParallelLedgerKind,
  isParallelLedgerKind,
} from "./ledger-kinds.ts";
import { MAX_RESTARTS_PER_WORKER } from "./group-executor.ts";

/* ================================================================== *
 * T062 — F143-FR-018: the holders of the run token.
 * ================================================================== */

/** F143-FR-018 — every process of a worker carries the run token. */
export const EVERY_WORKER_PROCESS_CARRIES_THE_RUN_TOKEN = true as const;

/** The variable the run token travels in (F143-FR-009). */
export const RUN_TOKEN_VARIABLE = "SPECSTRIDE_RUN_TOKEN" as const;

/** F143-FR-018 — the two moments that END the holders of the run token. */
export const ENGINE_START_AND_RESUME_END_THEM = ["engine start", "resume"] as const;

/** F143-FR-018 — the two that only REPORT them. */
export const STATUS_AND_THE_DOCTOR_REPORT_THEM = ["status", "the doctor"] as const;

/** R11 T-26 — the identity check comes before the signal, always. */
export const THE_IDENTITY_CHECK_COMES_BEFORE_THE_SIGNAL = true as const;

/** F143-FR-018, R29v PU-90 — and the sweep comes after the ending. */
export const A_TREE_IS_SWEPT_ONLY_AFTER_ITS_PROCESSES_ARE_ENDED = true as const;

/** F143-FR-018 — the usage of a pass whose stream was lost. */
export const USAGE_WHEN_THE_STREAM_WAS_LOST = "unknown" as const;

/** F143-FR-018 — and what every cost report that includes it must say. */
export const A_COST_REPORT_THAT_INCLUDES_A_LOST_STREAM_IS_INCOMPLETE = true as const;
export const COST_REPORT_NOTE_FOR_A_LOST_STREAM = "incomplete" as const;

/**
 * One process found in the process table that holds the run token. `startTime`
 * is what the identity check turns on: it is the one field of a process that a
 * later process with the same pid cannot have.
 */
export type HolderOfTheRunToken = {
  readonly pid: number;
  readonly startTime: string;
  readonly runToken: string;
  /** The worker it says it is, from its own environment; never trusted alone. */
  readonly workerId?: string;
  /** The process group it leads, where the port could read one. */
  readonly processGroup?: number;
};

/** What the process registry of the run recorded when the process was started. */
export type RegisteredProcess = {
  readonly pid: number;
  readonly startTime: string;
  readonly runToken: string;
  readonly workerId?: string;
  readonly class?: string;
};

/** Why a holder may not be signalled. */
export const IDENTITY_REFUSALS = [
  "start-time-differs",
  "run-token-differs",
  "pid-is-not-above-one",
] as const;
export type IdentityRefusal = (typeof IDENTITY_REFUSALS)[number];

/** The result of the identity check over one holder. */
export type IdentityCheck =
  | {
      readonly identified: true;
      readonly holder: HolderOfTheRunToken;
      /** The row of the registry, where the process registry has one. */
      readonly registration?: RegisteredProcess;
      /** True where the holder is of this run but the registry never saw it. */
      readonly registered: boolean;
    }
  | {
      readonly identified: false;
      readonly holder: HolderOfTheRunToken;
      readonly because: IdentityRefusal;
    };

/**
 * R11 T-26, R29v PU-90 — THE IDENTITY CHECK, in the order the two rules put
 * its three clauses:
 *
 *  1 A PID OF ONE OR BELOW IS NOT A PROCESS OF A WORKER. Refused before
 *    anything else is even read, because as root a signal to 0, 1 or a
 *    negative id reaches processes of the host that are nothing to do with
 *    this run. No later clause can undo this one.
 *
 *  2 THE RUN TOKEN IS THE IDENTITY. "Every process of a worker carries the run
 *    token" (F143-FR-018), and the token is opaque and of this run alone, so a
 *    process whose environment holds it IS of this run. A holder whose token
 *    is another run's is refused.
 *
 *  3 WHERE THE REGISTRY HAS A ROW FOR THE PID, ITS START TIME MUST MATCH. This
 *    is the clause that T-26 is actually about: a pid is reused, so the row
 *    the registry wrote for pid 4711 may now name a stranger. A difference in
 *    start time means the pid was recycled and the holder is refused.
 *
 * A HOLDER WITH THE RUN TOKEN AND NO ROW IN THE REGISTRY IS IDENTIFIED, with
 * `registered: false`. That is not a loophole, it is the case the requirement
 * exists for: the process a worker LEFT BEHIND is a grandchild of the engine
 * that the registry never saw and that a pass kill cannot reach, and it holds
 * the run token because it inherited the environment. If this check refused
 * it, "the engine ends the holders of the run token at engine start" would end
 * exactly the processes that were going to end anyway and none of the ones
 * that outlive it.
 */
export function identityCheckOf(
  holder: HolderOfTheRunToken,
  registry: readonly RegisteredProcess[],
  runToken: string,
): IdentityCheck {
  if (!Number.isInteger(holder.pid) || holder.pid <= 1) {
    return Object.freeze({
      identified: false as const,
      holder,
      because: "pid-is-not-above-one" as const,
    });
  }
  if (holder.runToken !== runToken) {
    return Object.freeze({
      identified: false as const,
      holder,
      because: "run-token-differs" as const,
    });
  }
  const row = registry.find((entry) => entry.pid === holder.pid);
  if (row !== undefined && row.startTime !== holder.startTime) {
    return Object.freeze({
      identified: false as const,
      holder,
      because: "start-time-differs" as const,
    });
  }
  return Object.freeze({
    identified: true as const,
    holder,
    ...(row === undefined ? {} : { registration: row }),
    registered: row !== undefined,
  });
}

/** The holders the identity check cleared, and so the ones that may be ended. */
export function signalsAllowedFor(
  holders: readonly HolderOfTheRunToken[],
  registry: readonly RegisteredProcess[],
  runToken: string,
): readonly IdentityCheck[] {
  return Object.freeze(holders.map((holder) => identityCheckOf(holder, registry, runToken)));
}

/** What the core is handed to deal with the holders of the run token. */
export type HolderPorts = {
  /**
   * Search the process table for holders of the run token (F143-FR-018). The
   * core may not read the process table, so this is a port.
   */
  holdersOfTheRunToken(runToken: string): Promise<readonly HolderOfTheRunToken[]>;
  /** The rows the process registry of the run holds (annex B, §B.10). */
  registeredProcesses(): Promise<readonly RegisteredProcess[]>;
  /** End one process the identity check cleared. True where it is gone. */
  endProcess(holder: HolderOfTheRunToken): Promise<boolean>;
  /** Write one record of the parallel namespace, through the one writer. */
  record(kind: ParallelLedgerKind, data: Readonly<Record<string, unknown>>): Promise<void>;
  /** Report the holders, for `status` and the doctor (F143-FR-018). */
  report?(holders: readonly IdentityCheck[]): Promise<void>;
};

/** What one worker whose pass was lost is recorded with. */
export type LostStream = {
  readonly workerId: string;
  /** The cause the record carries: the engine was relaunched under it. */
  readonly endCause: string;
  /** F143-FR-018 — unknown, and never a guess. */
  readonly usage: typeof USAGE_WHEN_THE_STREAM_WAS_LOST;
};

/** What `endHoldersOfTheRunToken` found and did. */
export type HoldersEnded = {
  /** Every holder found, with the result of its identity check. */
  readonly checked: readonly IdentityCheck[];
  /** The pids that were ended. */
  readonly ended: readonly number[];
  /** The pids the identity check refused, with the reason. */
  readonly refused: readonly { readonly pid: number; readonly because: IdentityRefusal }[];
  /** The pids that were cleared and did not go away. */
  readonly remaining: readonly number[];
  /** The passes recorded with unknown usage (F143-FR-018). */
  readonly lostStreams: readonly LostStream[];
  /** F143-FR-018 — true where a tree of this run may now be swept. */
  readonly treesMayBeSwept: boolean;
};

/**
 * F143-FR-018 — END THE HOLDERS OF THE RUN TOKEN, at engine start and at
 * `resume`. The sequence is fixed:
 *
 *   search the process table → identity check → end → record the lost pass
 *
 * and the last step is not optional: a worker whose process this function
 * ended had its stream cut, so its pass is recorded with `usage: unknown`
 * under `worker_ended`, and the group's own resume decision then finds a
 * `worker_ended` record rather than a worker that is silently gone.
 *
 * `treesMayBeSwept` is false while any cleared holder is still alive, which is
 * the whole of "a tree MUST be swept only after its processes are ended": a
 * caller that sweeps regardless is contradicting a value it was handed.
 */
export async function endHoldersOfTheRunToken(
  ports: HolderPorts,
  input: {
    readonly runToken: string;
    /** `engine start` or `resume`; both end them (F143-FR-018). */
    readonly moment: (typeof ENGINE_START_AND_RESUME_END_THEM)[number];
    /** The end cause the `worker_ended` record carries for a lost pass. */
    readonly endCause?: string;
    /** The workers of the open group, so a holder maps to a worker. */
    readonly workersOfTheOpenGroup?: readonly string[];
  },
): Promise<HoldersEnded> {
  const holders = await ports.holdersOfTheRunToken(input.runToken);
  const registry = await ports.registeredProcesses();
  const checked = signalsAllowedFor(holders, registry, input.runToken);
  await ports.report?.(checked);

  const ended: number[] = [];
  const refused: { pid: number; because: IdentityRefusal }[] = [];
  const remaining: number[] = [];
  const lost = new Map<string, LostStream>();

  for (const check of checked) {
    if (!check.identified) {
      refused.push({ pid: check.holder.pid, because: check.because });
      continue;
    }
    const gone = await ports.endProcess(check.holder);
    if (gone) ended.push(check.holder.pid);
    else remaining.push(check.holder.pid);
    const workerId = check.registration?.workerId ?? check.holder.workerId;
    if (workerId !== undefined && (input.workersOfTheOpenGroup ?? [workerId]).includes(workerId)) {
      lost.set(
        workerId,
        Object.freeze({
          workerId,
          endCause: input.endCause ?? `ended-at-${input.moment.replace(" ", "-")}`,
          usage: USAGE_WHEN_THE_STREAM_WAS_LOST,
        }),
      );
    }
  }

  // F143-FR-018 — the pass whose stream was lost is RECORDED, with unknown
  // usage. One record per worker, through the one writer.
  for (const stream of lost.values()) {
    await ports.record("worker_ended", {
      workerId: stream.workerId,
      endCause: stream.endCause,
      treeId: "",
      fingerprint: "",
      usage: USAGE_WHEN_THE_STREAM_WAS_LOST,
    });
  }

  return Object.freeze({
    checked: Object.freeze(checked),
    ended: Object.freeze(ended),
    refused: Object.freeze(refused.map((r) => Object.freeze(r))),
    remaining: Object.freeze(remaining),
    lostStreams: Object.freeze([...lost.values()]),
    treesMayBeSwept: remaining.length === 0,
  });
}

/**
 * F143-FR-018 — a cost report over passes, with the note the requirement
 * demands where any of them has unknown usage.
 */
export function costReportOver(
  passes: readonly { readonly workerId: string; readonly usage: unknown }[],
): {
  readonly complete: boolean;
  readonly note?: typeof COST_REPORT_NOTE_FOR_A_LOST_STREAM;
  readonly withUnknownUsage: readonly string[];
} {
  const unknown = passes
    .filter((pass) => pass.usage === USAGE_WHEN_THE_STREAM_WAS_LOST || pass.usage === undefined)
    .map((pass) => pass.workerId);
  return Object.freeze({
    complete: unknown.length === 0,
    ...(unknown.length === 0 ? {} : { note: COST_REPORT_NOTE_FOR_A_LOST_STREAM }),
    withUnknownUsage: Object.freeze(unknown),
  });
}

/* ================================================================== *
 * T065 — F143-FR-025: the eight states.
 * ================================================================== */

/** Ruling 55 — every session after a relaunch is fresh. */
export const EVERY_SESSION_AFTER_A_RELAUNCH_IS_FRESH = true as const;

/** R29v PU-83 — the event that stays in the event file. */
export const APPLY_INCOMPLETE_EVENT = "apply-incomplete" as const;

/** R29v PU-83 — the integrity kind that may reach a critic-class call. */
export const TREE_CHANGED_INTEGRITY_KIND = "tree-changed-outside-pass" as const;

/** F143-FR-025 state 6 — what is switched off, and for how long. */
export const STATE_6_SWITCHES_THE_LOOP_LAYER_OFF_FOR = "the run" as const;

/** F143-FR-025 state 6 — and nothing more is written. */
export const STATE_6_WRITES_NOTHING_MORE = true as const;

/** The actions the eight states resolve to. */
export const RESUME_ACTIONS = [
  "start-the-group",
  "end-the-recorded-processes",
  "verify-the-tree-id",
  "repeat-from-the-audits",
  "repeat-the-application",
  "stop-writing",
  "write-the-ticks",
  "run-the-merge-check",
  "close-the-group",
  "nothing-is-repeated",
] as const;
export type ResumeAction = (typeof RESUME_ACTIONS)[number];

/** One of the eight states of F143-FR-025. */
export type ResumeState = {
  /** Its number in the requirement, 1 to 8. */
  readonly state: number;
  /** The last record or records that put a group in it. */
  readonly lastRecord: readonly string[];
  /** What the engine does, in the words of the requirement. */
  readonly action: ResumeAction;
  /** The requirement's own sentence, so the table can be read against it. */
  readonly says: string;
};

/**
 * F143-FR-025 — THE EIGHT STATES, numbered as the requirement numbers them.
 * State 6 is not reached from a record: it is reached from the VERIFICATION of
 * state 5 failing, which is why its `lastRecord` is `apply_started` too and
 * why `decideFromTheLastRecord` gives state 5 and
 * `verifyBeforeTheApplicationIsRepeated` gives state 6.
 */
export const RESUME_STATES: readonly ResumeState[] = Object.freeze([
  Object.freeze({
    state: 1,
    lastRecord: Object.freeze(["group_planned"]),
    action: "start-the-group" as const,
    says: "`group_planned`: start the group",
  }),
  Object.freeze({
    state: 2,
    lastRecord: Object.freeze(["group_started", "worker_started"]),
    action: "end-the-recorded-processes" as const,
    says: "`group_started`, or `worker_started` without `worker_ended`: end the recorded processes of that worker after the identity check; its pass is lost; restart it if its restart is unused, otherwise its outcome is `killed`",
  }),
  Object.freeze({
    state: 3,
    lastRecord: Object.freeze(["worker_ended"]),
    action: "verify-the-tree-id" as const,
    says: "`worker_ended`: verify the tree id of its snapshot against the ledger",
  }),
  Object.freeze({
    state: 4,
    lastRecord: Object.freeze(["group_barrier", "audit_done", "merge_done"]),
    action: "repeat-from-the-audits" as const,
    says: "`group_barrier`, `audit_done` or `merge_done`: verify the workspace against the fingerprint at group start and repeat from the audits",
  }),
  Object.freeze({
    state: 5,
    lastRecord: Object.freeze(["apply_started"]),
    action: "repeat-the-application" as const,
    says: "`apply_started`: every path of the composed delta must hold either the base content or the composed content, and the workspace outside those paths must equal the fingerprint at group start; then the application is repeated in full",
  }),
  Object.freeze({
    state: 6,
    lastRecord: Object.freeze(["apply_started"]),
    action: "stop-writing" as const,
    says: "if a path holds neither, or the workspace outside the delta differs: nothing more is written, the engine reports the state in the result of `integrateGroup`, the loop layer is switched off for the run, the integrity kind `tree-changed-outside-pass` is raised, and the micro-loop layer carries on from the tree as it is",
  }),
  Object.freeze({
    state: 7,
    lastRecord: Object.freeze(["applied"]),
    action: "write-the-ticks" as const,
    says: "`applied` without `ticks_applied`: write the ticks",
  }),
  Object.freeze({
    state: 8,
    lastRecord: Object.freeze(["ticks_applied", "merge_check_started"]),
    action: "run-the-merge-check" as const,
    says: "`ticks_applied` or `merge_check_started`: run the merge check",
  }),
]);

/** The number of states, stated so that a reader need not count (eight). */
export const RESUME_STATE_COUNT = 8 as const;

/**
 * F143-FR-025 — the two records that leave NO STEP OF INTEGRATION OPEN, and so
 * fall outside the eight states.
 */
export const RECORDS_THAT_LEAVE_NO_STEP_OPEN: Readonly<Record<string, ResumeAction>> =
  Object.freeze({
    merge_check_finished: "close-the-group",
    group_closed: "nothing-is-repeated",
  });

/** One record of the ledger, as the resume decision reads it. */
export type ResumeRecord = {
  readonly ns?: string;
  readonly kind?: string;
  readonly groupId?: string;
  readonly workerId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  /** F143-FR-028 — the counters of the layer as the envelope carried them. */
  readonly counters?: Readonly<Record<string, unknown>>;
};

/** What a worker's own records say about it at the moment of the relaunch. */
export type WorkerAtResume = {
  readonly workerId: string;
  /** The last record of this worker: `worker_started` or `worker_ended`. */
  readonly lastRecord: "worker_started" | "worker_ended";
  /** The restart index its last `worker_started` carried. */
  readonly restartsUsed: number;
  /**
   * F143-FR-025 state 2 — restart it in its tree where its restart is unused,
   * otherwise its outcome is `killed`.
   */
  readonly then: "restart" | "killed" | "verify-the-tree-id";
  /** The tree id its `worker_ended` record named, where it has one. */
  readonly treeId?: string;
  /** The end cause its `worker_ended` record named, where it has one. */
  readonly endCause?: string;
  /**
   * F143-FR-018 — true where its `worker_ended` record is the one written for
   * A LOST PASS: no final tree id and `usage: unknown`. Such a record says
   * the worker's stream was cut, NOT that it finished, so the worker is
   * restarted in its tree where its restart is unused and is `killed` where it
   * is not (F143-FR-013, F143-FR-025 state 2). A `worker_ended` record WITH a
   * tree id is a worker that really ended, and that one is verified.
   */
  readonly lostPass?: true;
};

/** What the resume decision came to. */
export type ResumeDecision = {
  /** The state of F143-FR-025, 1 to 8, or 0 where no record of the group exists. */
  readonly state: number;
  /** The last record of the parallel namespace in the ledger. */
  readonly lastRecord?: ParallelLedgerKind;
  /** What to do. */
  readonly action: ResumeAction;
  /** The requirement's sentence for the state, where there is one. */
  readonly says?: string;
  /** The group the decision is about. */
  readonly groupId?: string;
  /** Per worker, what its own records say (states 2 and 3). */
  readonly workers: readonly WorkerAtResume[];
  /** Ruling 55 — every session after a relaunch is fresh. */
  readonly session: "fresh";
};

/** The records of the parallel namespace, of a kind the closed set holds. */
export function recordsOfTheGroup(
  ledger: readonly ResumeRecord[],
  groupId?: string,
): readonly ResumeRecord[] {
  return Object.freeze(
    ledger.filter(
      (record) =>
        record.ns === `paral${"lel"}` &&
        isParallelLedgerKind(record.kind ?? "") &&
        (groupId === undefined || record.groupId === groupId),
    ),
  );
}

/** The group the last record of the parallel namespace belongs to. */
export function theOpenGroup(ledger: readonly ResumeRecord[]): string | undefined {
  const records = recordsOfTheGroup(ledger);
  const last = records[records.length - 1];
  return last?.groupId;
}

/** The state of F143-FR-025 a last record of this kind puts a group in. */
export function stateOfTheLastRecord(kind: ParallelLedgerKind): ResumeState | undefined {
  // State 6 shares its record with state 5; the decision from a RECORD is
  // always 5, and 6 is reached from the verification (R29v PU-95).
  return RESUME_STATES.find(
    (state) => state.state !== 6 && (state.lastRecord as readonly string[]).includes(kind),
  );
}

/**
 * F143-FR-025 — THE LAST LEDGER RECORD DECIDES. One function, the eight
 * states, and the two records that leave nothing open.
 *
 * WHY THE PER-WORKER PART IS COMPUTED EVEN WHEN THE STATE IS NOT 2. A group of
 * N workers writes `worker_started` N times and `worker_ended` N times, so the
 * last record of the group can be `worker_ended` (state 3) while ANOTHER
 * worker still has a `worker_started` with no end (state 2). The requirement's
 * states are states OF THE GROUP; the `workers` list says what each worker
 * needs, and a caller that restarts the ones marked `restart` and verifies the
 * tree ids of the ones marked `verify-the-tree-id` satisfies both states at
 * once. That is the only reading under which a group of two workers has a
 * defined resume at every kill point.
 */
export function decideFromTheLastRecord(
  ledger: readonly ResumeRecord[],
  options: { readonly groupId?: string } = {},
): ResumeDecision {
  const groupId = options.groupId ?? theOpenGroup(ledger);
  const records = recordsOfTheGroup(ledger, groupId);
  const last = records[records.length - 1];

  // Per worker: its last record, its restart index, and what follows.
  const lastOfWorker = new Map<
    string,
    {
      kind: "worker_started" | "worker_ended";
      restartsUsed: number;
      treeId?: string;
      endCause?: string;
      lostPass?: true;
    }
  >();
  for (const record of records) {
    const workerId = record.workerId;
    if (workerId === undefined) continue;
    if (record.kind === "worker_started") {
      const ordinal = record.data?.["passOrdinal"];
      const restartsUsed =
        Array.isArray(ordinal) && ordinal.length === 3 ? Number(ordinal[2]) || 0 : 0;
      lastOfWorker.set(workerId, { kind: "worker_started", restartsUsed });
    } else if (record.kind === "worker_ended") {
      const held = lastOfWorker.get(workerId);
      const treeId = record.data?.["treeId"];
      const endCause = record.data?.["endCause"];
      const usage = record.data?.["usage"];
      // F143-FR-018 — the record of A LOST PASS: no final tree id and unknown
      // usage. It is the one `endHoldersOfTheRunToken` writes.
      const lostPass =
        (typeof treeId !== "string" || treeId === "") && usage === USAGE_WHEN_THE_STREAM_WAS_LOST;
      lastOfWorker.set(workerId, {
        kind: "worker_ended",
        restartsUsed: held?.restartsUsed ?? 0,
        ...(typeof treeId === "string" ? { treeId } : {}),
        ...(typeof endCause === "string" ? { endCause } : {}),
        ...(lostPass ? { lostPass: true as const } : {}),
      });
    }
  }

  const workers: WorkerAtResume[] = [...lastOfWorker].map(([workerId, held]) => {
    const itEnded = held.kind === "worker_ended" && held.lostPass !== true;
    return Object.freeze({
      workerId,
      lastRecord: held.kind,
      restartsUsed: held.restartsUsed,
      then: itEnded
        ? ("verify-the-tree-id" as const)
        : held.restartsUsed < MAX_RESTARTS_PER_WORKER
          ? ("restart" as const)
          : ("killed" as const),
      ...(held.treeId === undefined ? {} : { treeId: held.treeId }),
      ...(held.endCause === undefined ? {} : { endCause: held.endCause }),
      ...(held.lostPass === true ? { lostPass: true as const } : {}),
    });
  });

  if (last === undefined || !isParallelLedgerKind(last.kind ?? "")) {
    return Object.freeze({
      state: 0,
      action: "start-the-group" as const,
      ...(groupId === undefined ? {} : { groupId }),
      workers: Object.freeze(workers),
      session: "fresh" as const,
    });
  }

  const kind = last.kind as ParallelLedgerKind;

  // The two records that leave no step of integration open.
  const closing = RECORDS_THAT_LEAVE_NO_STEP_OPEN[kind];
  if (closing !== undefined) {
    return Object.freeze({
      state: 0,
      lastRecord: kind,
      action: closing,
      ...(groupId === undefined ? {} : { groupId }),
      workers: Object.freeze(workers),
      session: "fresh" as const,
    });
  }

  // F143-FR-025 state 7 — `applied` WITHOUT `ticks_applied`. The qualifier is
  // the requirement's, and with the last record `applied` it holds by
  // construction; it is checked anyway so the reading is explicit.
  const ticked = records.some((record) => record.kind === "ticks_applied");
  if (kind === "applied" && ticked) {
    const eight = RESUME_STATES.find((s) => s.state === 8) as ResumeState;
    return Object.freeze({
      state: 8,
      lastRecord: kind,
      action: eight.action,
      says: eight.says,
      ...(groupId === undefined ? {} : { groupId }),
      workers: Object.freeze(workers),
      session: "fresh" as const,
    });
  }

  const state = stateOfTheLastRecord(kind);
  if (state === undefined) {
    // Every kind of the closed set is in the table; this cannot be reached
    // without the closed set and the table disagreeing, which is a bug and
    // not a state of a run.
    throw new Error(`no resume state for the record kind \`${kind}\``);
  }

  return Object.freeze({
    state: state.state,
    lastRecord: kind,
    action: state.action,
    says: state.says,
    ...(groupId === undefined ? {} : { groupId }),
    workers: Object.freeze(workers),
    session: "fresh" as const,
  });
}

/** Every kind of the closed set has a decision: the table is total. */
export function everyKindHasADecision(): boolean {
  return PARALLEL_LEDGER_KINDS.every(
    (kind) =>
      stateOfTheLastRecord(kind) !== undefined ||
      RECORDS_THAT_LEAVE_NO_STEP_OPEN[kind] !== undefined,
  );
}

/* ------------------------------------------------------------------ *
 * States 5 and 6 — the verification before the application is repeated.
 * ------------------------------------------------------------------ */

/** One path of the composed delta, with the two contents it may hold. */
export type PathOfTheDelta = {
  readonly path: string;
  /** The content hash the BASE tree has at this path; absent where it added it. */
  readonly base?: string;
  /** The content hash the COMPOSED tree has; absent where it deleted it. */
  readonly composed?: string;
};

/** What the verification of state 5 found at one path. */
export type PathVerdict = {
  readonly path: string;
  /** `base`, `composed`, or `neither` — and `neither` is state 6. */
  readonly holds: "base" | "composed" | "neither";
  readonly found?: string;
};

/** What the verification of states 5 and 6 came to. */
export type ApplicationVerification =
  | {
      readonly state: 5;
      readonly action: "repeat-the-application";
      readonly paths: readonly PathVerdict[];
      /** F143-FR-020 — and the application is repeated IN FULL. */
      readonly inFull: true;
    }
  | {
      readonly state: 6;
      readonly action: "stop-writing";
      readonly paths: readonly PathVerdict[];
      /** The paths that hold neither content. */
      readonly neither: readonly string[];
      /** True where the workspace OUTSIDE the delta differs (R29v PU-95). */
      readonly outsideTheDeltaDiffers: boolean;
      /** The paths outside the delta that differ, where any do. */
      readonly outside: readonly string[];
      readonly event: typeof APPLY_INCOMPLETE_EVENT;
      readonly integrityKind: typeof TREE_CHANGED_INTEGRITY_KIND;
      readonly loopLayerOffFor: typeof STATE_6_SWITCHES_THE_LOOP_LAYER_OFF_FOR;
      readonly writesNothingMore: true;
    };

/**
 * F143-FR-025 states 5 and 6, R29v PU-95 — THE VERIFICATION BEFORE THE
 * APPLICATION IS REPEATED. Two conditions, both required:
 *
 *  (a) EVERY PATH of the composed delta holds either the base content or the
 *      composed content. A path that holds a third thing was written by
 *      something that is not this group.
 *  (b) THE WORKSPACE OUTSIDE THOSE PATHS equals the fingerprint at group
 *      start. This is PU-95's amendment to PU-65, and without it an
 *      application could be repeated onto a workspace somebody else had
 *      edited elsewhere.
 *
 * Either failing is state 6: nothing more is written, the loop layer is off
 * FOR THE RUN, the event `apply-incomplete` goes in the event file and the
 * integrity kind `tree-changed-outside-pass` is the neutral kind that may
 * reach a critic-class call (R29v PU-83).
 */
export function verifyBeforeTheApplicationIsRepeated(input: {
  /** The paths of the composed delta, with their base and composed content. */
  readonly delta: readonly PathOfTheDelta[];
  /** The content hash each of those paths holds now; absent where it is gone. */
  readonly found: Readonly<Record<string, string | undefined>>;
  /** The fingerprint of the workspace at group start, for the report. */
  readonly fingerprintAtGroupStart: string;
  /**
   * R29v PU-95 — the paths at which the workspace differs from the
   * fingerprint at group start AND WHICH ARE NOT PATHS OF THE DELTA. Asked
   * this way round because it is the only way a caller can answer it: a
   * fingerprint is of a whole directory, and "the workspace outside those
   * paths" is not a directory. An empty list is the clause kept.
   */
  readonly pathsThatDifferOutsideTheDelta: readonly string[];
  /** The fingerprint of the workspace as it is now, for the report. */
  readonly fingerprintNow?: string;
}): ApplicationVerification {
  const paths: PathVerdict[] = input.delta.map((entry) => {
    const found = input.found[entry.path];
    const holds = found === entry.composed ? "composed" : found === entry.base ? "base" : "neither";
    return Object.freeze({
      path: entry.path,
      holds: holds as PathVerdict["holds"],
      ...(found === undefined ? {} : { found }),
    });
  });
  const neither = paths.filter((p) => p.holds === "neither").map((p) => p.path);
  const outsideTheDeltaDiffers = input.pathsThatDifferOutsideTheDelta.length > 0;
  if (neither.length === 0 && !outsideTheDeltaDiffers) {
    return Object.freeze({
      state: 5 as const,
      action: "repeat-the-application" as const,
      paths: Object.freeze(paths),
      inFull: true as const,
    });
  }
  return Object.freeze({
    state: 6 as const,
    action: "stop-writing" as const,
    paths: Object.freeze(paths),
    neither: Object.freeze(neither),
    outsideTheDeltaDiffers,
    outside: Object.freeze([...input.pathsThatDifferOutsideTheDelta]),
    event: APPLY_INCOMPLETE_EVENT,
    integrityKind: TREE_CHANGED_INTEGRITY_KIND,
    loopLayerOffFor: STATE_6_SWITCHES_THE_LOOP_LAYER_OFF_FOR,
    writesNothingMore: true as const,
  });
}

/**
 * F143-FR-025 state 4 — verify the workspace against the fingerprint at group
 * start before repeating from the audits. The audits are deterministic (R29
 * PU-65), so repeating them over the same trees gives the same verdicts; what
 * must be checked is that the WORKSPACE has not moved under them.
 */
export function workspaceIsAtTheFingerprintOfGroupStart(input: {
  readonly fingerprintAtGroupStart: string;
  readonly fingerprintNow: string;
}): boolean {
  return input.fingerprintAtGroupStart === input.fingerprintNow;
}

/**
 * F143-FR-025 state 3 — verify the tree id of a worker's snapshot against the
 * ledger. A difference means the snapshot in the store is not the one the
 * record names, and the worker is refused rather than integrated.
 */
export function treeIdAgreesWithTheLedger(input: {
  readonly inTheLedger: string;
  readonly inTheStore: string;
}): boolean {
  return input.inTheLedger !== "" && input.inTheLedger === input.inTheStore;
}

/* ------------------------------------------------------------------ *
 * The two in order.
 * ------------------------------------------------------------------ */

/** What the core is handed to resume a group. */
export type ResumePorts = HolderPorts;

/** What one resume did, in the order F143-FR-018 and F143-FR-025 fix. */
export type ResumeOfAGroup = {
  /** Step 1: F143-FR-018. */
  readonly holders: HoldersEnded;
  /** Step 2: F143-FR-025, read AFTER the holders were ended. */
  readonly decision: ResumeDecision;
};

/**
 * F143-FR-018 then F143-FR-025 — RESUME A GROUP. The ledger is read AGAIN
 * after the holders have been ended, because ending them writes `worker_ended`
 * records, and the decision must be taken over the ledger as it then is: a
 * worker whose process was just ended is in state 3 and not state 2.
 */
export async function resumeAGroup(
  ports: ResumePorts,
  input: {
    readonly runToken: string;
    readonly moment: (typeof ENGINE_START_AND_RESUME_END_THEM)[number];
    /** Read the ledger. Called twice: before ending holders and after. */
    readonly readTheLedger: () => Promise<readonly ResumeRecord[]>;
    readonly endCause?: string;
  },
): Promise<ResumeOfAGroup> {
  const before = await input.readTheLedger();
  const groupId = theOpenGroup(before);
  const workersOfTheOpenGroup = [
    ...new Set(
      recordsOfTheGroup(before, groupId)
        .map((record) => record.workerId)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const holders = await endHoldersOfTheRunToken(ports, {
    runToken: input.runToken,
    moment: input.moment,
    workersOfTheOpenGroup,
    ...(input.endCause === undefined ? {} : { endCause: input.endCause }),
  });
  const after = await input.readTheLedger();
  return Object.freeze({
    holders,
    decision: decideFromTheLastRecord(after, ...(groupId === undefined ? [] : [{ groupId }])),
  });
}
