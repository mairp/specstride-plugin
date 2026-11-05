/**
 * THE RESUME OF AN OPEN GROUP AT THE COMPOSITION ROOT (step 4 of
 * `prompts/specstride-parallel-units.md`; F143-FR-025 joined to the engine's
 * resume path — FIRST SLICE).
 *
 * A group lives longer than the engine that started it: a SIGKILL, a crash or
 * a stop leaves a ledger whose last record names a step of the integration
 * that never ran. When an engine starts again over that feature, the join
 * below answers the one question the fresh start must not answer by
 * starting: IS A GROUP OPEN?
 *
 * THE THREE STEPS, IN THE ORDER THE CORE REQUIRES THEM
 * (`resume.ts` of the core states the order as the requirement, not a
 * convenience):
 *
 *   1. `theOpenParallelGroupOf` — DISCOVERY. Every ledger of every run of the
 *      control root is read as the file stands, `decideFromTheLastRecord`
 *      decides over it, and the newest run whose last record leaves a step
 *      open is the open group. A run whose last record is `group_closed`
 *      holds no open group, whatever older runs hold. The decision carries
 *      the interrupted run's id and group id, which name everything else:
 *      the ledger file the records go on (so `seq` rises without a gap
 *      across the relaunch, F143-FR-024), and the worker root the trees live
 *      under, which is named by the run alone (F143-FR-005).
 *   2. `endTheHoldersOfTheOpenGroup` — the survivor search of F143-FR-018,
 *      over the INTERRUPTED run's token: the identity records in that run's
 *      own workers directory name the hash of the token they were started
 *      with, and a worker of the dead engine is a holder of THAT token, not
 *      of the new engine's. The search ends each holder after the identity
 *      check and never signals a reused pid whose start time differs.
 *   3. `carryOutTheResumeOfTheOpenGroup` — THE CARRY-OUT of the decision.
 *      `nothing-is-repeated` (the last record is `group_closed`; nothing is
 *      written), `close-the-group` (the last record is `merge_check_finished`;
 *      the only step left is the close, which runs the real close over the
 *      interrupted run's places — trees released, `group_closed` written, the
 *      store swept), and — where the caller hands the drive facts of the pass
 *      boundary in — THE TAIL of the eight states, carried out by
 *      `parallel-resume-drive.ts`: the five states the ledger answers with no
 *      worker process to start (3, 4, 5, 6, 7 and 8 of F143-FR-025), each
 *      returned as ONE group attempt of this engine start.
 *
 * WHAT IS STILL ANSWERED `carried: false`, AND SAYS SO: states 1 and 2, and
 * any per-worker verdict `restart` — those need a worker process to start.
 * The carry-out answers `carried: false` with the state, the action and the
 * requirement's own sentence, WRITES NOTHING, and the wiring WITHHOLDS the
 * fresh start of the group: an engine that cannot carry a state out must
 * never answer it by starting the group again over the open ledger.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { readAppendedRecords, type AppendedRecord } from "../../../core/src/parallel/queue.ts";
import {
  decideFromTheLastRecord,
  type ResumeAction,
  type ResumeDecision,
  type ResumeRecord,
} from "../../../core/src/parallel/resume.ts";
import { initStore, treeStore, type StorePlaces } from "../../../tree-store/src/index.ts";
import {
  hashOfTheRunToken,
  type TheGroupAttempt,
  type TheGroupAttemptStoppedNow,
} from "./parallel-attempt.ts";
import {
  carryOutTheTailOfTheOpenGroup,
  type TheStoppedOfTheResume,
  type TheTailOfTheResumeDrive,
} from "./parallel-resume-drive.ts";
import {
  carryOutTheStartOrRestartOfTheOpenGroup,
  type TheRestartOfTheResumeDrive,
} from "./parallel-resume-restart.ts";
import {
  closeTheGroupRun,
  openTheLedgerOfTheRun,
  parallelLedgerPathOf,
  theCountersOfTheLedger,
  theRecordAheadOfTheWriter,
  type ClosedGroupRun,
} from "./parallel-drive.ts";
import { endTheLeftoverWorkers, type LeftoverWorkersReport } from "./group-run.ts";
import { placesOfTheParallelStore, theParallelHomeOfARun } from "./parallel-group.ts";

/* ------------------------------------------------------------------ *
 * 1. DISCOVERY — the open group of the control root.
 * ------------------------------------------------------------------ */

/** One run of the control root that holds a parallel ledger file. */
export type TheLedgerFileOfARun = {
  readonly runId: string;
  readonly ledgerFile: string;
};

/**
 * EVERY PARALLEL LEDGER OF THE CONTROL ROOT, newest first. The order is the
 * directory's own modification times: the run an engine died in is the run
 * whose files were touched last, and an older closed run must never answer
 * for it.
 */
export function theLedgersOfTheRuns(controlRoot: string): readonly TheLedgerFileOfARun[] {
  const runsDirectory = join(controlRoot, "runs");
  if (!existsSync(runsDirectory)) return Object.freeze([]);
  const out: { runId: string; ledgerFile: string; mtimeMs: number }[] = [];
  let entries: string[];
  try {
    entries = readdirSync(runsDirectory);
  } catch {
    return Object.freeze([]);
  }
  for (const name of entries) {
    if (!name.startsWith("run-")) continue;
    const ledgerFile = parallelLedgerPathOf(controlRoot, name);
    if (!existsSync(ledgerFile)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(ledgerFile).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    out.push({ runId: name, ledgerFile, mtimeMs });
  }
  return Object.freeze(
    out
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(({ runId, ledgerFile }) => ({ runId, ledgerFile })),
  );
}

/** The parallel records a ledger file holds, as the file stands. */
function theRecordsOfTheLedger(ledgerFile: string): readonly AppendedRecord[] {
  try {
    return readAppendedRecords(readFileSync(ledgerFile, "utf8")).records;
  } catch {
    return Object.freeze([]);
  }
}

/**
 * THE OPEN GROUP of the control root, or `undefined` where no group stands
 * open. A group stands open where the LAST record of its run's ledger leaves
 * a step of the integration open — every kind but `group_closed`. The decision
 * is core's own (`decideFromTheLastRecord`), over the records of the group the
 * last record belongs to, so the join never re-decides what the core decides.
 */
export function theOpenParallelGroupOf(input: {
  readonly controlRoot: string;
}): TheOpenParallelGroup | undefined {
  for (const ledger of theLedgersOfTheRuns(input.controlRoot)) {
    const records = theRecordsOfTheLedger(ledger.ledgerFile);
    if (records.length === 0) continue;
    const decision = decideFromTheLastRecord(records as readonly ResumeRecord[]);
    if (decision.action === "nothing-is-repeated") continue;
    const groupId = decision.groupId;
    if (groupId === undefined) continue;
    return Object.freeze({
      runId: ledger.runId,
      groupId,
      ledgerFile: ledger.ledgerFile,
      records: Object.freeze(records as readonly ResumeRecord[]),
      decision,
      // The INTERRUPTED run's places, under THE INTERRUPTED RUN'S OWN home:
      // the trees stand where that run's start materialized them, never
      // under this start's (a relaunch is a new run id, and its scratch
      // directory is a different, empty one).
      places: placesOfTheParallelStore({
        controlRoot: input.controlRoot,
        runId: ledger.runId,
        home: theParallelHomeOfARun(ledger.runId),
      }),
    });
  }
  return undefined;
}

/** What discovery found, with the decision already made over it. */
export type TheOpenParallelGroup = {
  /** The run the open group belongs to — NOT the running engine's run id. */
  readonly runId: string;
  readonly groupId: string;
  /** The file the records of the group go on, across the relaunch. */
  readonly ledgerFile: string;
  /** The whole records the file held when discovery read it. */
  readonly records: readonly ResumeRecord[];
  /** The resume decision of F143-FR-025, as the core made it. */
  readonly decision: ResumeDecision;
  /** The interrupted run's own places: its worker root names its trees. */
  readonly places: StorePlaces;
};

/* ------------------------------------------------------------------ *
 * 2. THE HOLDERS OF THE INTERRUPTED RUN'S TOKEN (F143-FR-018).
 * ------------------------------------------------------------------ */

/**
 * END THE HOLDERS OF THE OPEN GROUP'S RUN TOKEN, before the carry-out. The
 * search is the survivor search of F143-FR-018 over the INTERRUPTED run's own
 * workers directory — the directory `runTheGroupWorkers` wrote the identity
 * records of that group into (`runs/<runId>/workers`, named by the run, which
 * outlives the engine) — with the hash of that run's token: the records there
 * carry the hash of the token their worker was started with, and the workers
 * of a dead engine hold that engine's token, never this engine's. The search
 * ends each holder after the identity check and never signals a reused pid
 * whose start time differs.
 */
export async function endTheHoldersOfTheOpenGroup(input: {
  readonly open: TheOpenParallelGroup;
  readonly controlRoot: string;
  /** The polite rung's grace; the engine hands none and the default stands. */
  readonly graceMs?: number | undefined;
  readonly say?: ((line: string) => void) | undefined;
}): Promise<LeftoverWorkersReport> {
  return await endTheLeftoverWorkers({
    workersDir: theWorkersDirectoryOfTheRun(input.controlRoot, input.open.runId),
    runTokenHash: hashOfTheRunToken(input.open.runId),
    ...(input.graceMs === undefined ? {} : { graceMs: input.graceMs }),
    ...(input.say === undefined ? {} : { say: input.say }),
  });
}

/**
 * The workers directory of ONE RUN, as the runner of a group names it when it
 * starts the workers of that run (F143-FR-010): the same directory, read back
 * after the crash, is what makes the records findable.
 */
export function theWorkersDirectoryOfTheRun(controlRoot: string, runId: string): string {
  return join(controlRoot, "runs", runId, "workers");
}

/* ------------------------------------------------------------------ *
 * 3. THE CARRY-OUT of the decision.
 * ------------------------------------------------------------------ */

/** What carrying the decision out gave, as the wiring reads it. */
export type TheResumeOfAnOpenGroup =
  | {
      readonly carried: true;
      readonly action: "nothing-is-repeated";
    }
  | {
      readonly carried: true;
      readonly action: "close-the-group";
      /** The close the carry-out ran: trees released, `group_closed`, sweep. */
      readonly closed: ClosedGroupRun;
    }
  | {
      readonly carried: true;
      readonly action:
        | "verify-the-tree-id"
        | "repeat-from-the-audits"
        | "repeat-the-application"
        | "write-the-ticks"
        | "run-the-merge-check"
        | "start-the-group"
        | "end-the-recorded-processes";
      /** The state of F143-FR-025 the ledger answered with, 1 to 8. */
      readonly state: number;
      /**
       * The carried group, as ONE group attempt of this engine start: the
       * restart may hand the CUT ITSELF where `stop --now` ended the
       * restarted workers (F143-FR-026, owed item 4 of par-4) —
       * `stoppedByStopNow` — or the tail's attempt marked
       * `stopAfterTheGroup` where a clean stop stood at a polled boundary.
       */
      readonly attempt: TheGroupAttempt | TheGroupAttemptStoppedNow;
      /** F143-FR-025 state 6 only: the stop-writing the verification gave. */
      readonly stopped?: TheStoppedOfTheResume | undefined;
    }
  | {
      /** A state of F143-FR-025 this engine does not carry out yet. */
      readonly carried: false;
      readonly action: ResumeAction;
      /** The state of the requirement, 1 to 8. */
      readonly state: number;
      /** The requirement's own sentence for the state, where there is one. */
      readonly says?: string;
      /** The reason the carry-out itself refused the group, where it did. */
      readonly because?: string;
    };

/**
 * The outcome the close records, from the `merge_check_finished` record the
 * ledger ends with: the check the record carries decides `closed` or
 * `failed` — a failed merge check is ONE FAILED GROUP (F142-FR-023), and its
 * close says so.
 */
function theOutcomeOfTheFinishedCheck(records: readonly ResumeRecord[]): "closed" | "failed" {
  const finished = records.find((record) => record.kind === "merge_check_finished");
  const check = (finished?.data as Readonly<Record<string, unknown>> | undefined)?.["check"];
  return check === "pass" ? "closed" : "failed";
}

/**
 * CARRY THE DECISION OUT. The two ends the slice carries write through the
 * ONE WRITER over the INTERRUPTED run's ledger file, opened over the file AS
 * IT STANDS, so `seq` rises without a gap across the relaunch (F143-FR-024)
 * and the counters continue from the file (F143-FR-028). A state the slice
 * does not carry out yet is answered `carried: false` and NOTHING IS
 * WRITTEN.
 */
export async function carryOutTheResumeOfTheOpenGroup(input: {
  readonly open: TheOpenParallelGroup;
  readonly controlRoot: string;
  /** `--reset-counts` (F100-FR-045): zeroes the counters THIS start writes. */
  readonly resetCounts?: boolean | undefined;
  readonly say?: ((line: string) => void) | undefined;
  /**
   * THE DRIVE FACTS of the pass boundary. Where they are handed in, the tail
   * of the eight states (3 to 8, no worker process needed) is carried out and
   * answered as ONE group attempt of this engine start; where they are not,
   * those states are answered `carried: false` and nothing is written.
   */
  readonly drive?: TheTailOfTheResumeDrive | undefined;
  /**
   * THE DRIVE FACTS OF A RESTART (states 1 and 2 of F143-FR-025 — the states
   * a worker process has to start for). Where they are handed in AND the
   * ledger answers with one of those two states, the restart carry-out of
   * `parallel-resume-restart.ts` runs: the lost passes are recorded, the
   * restart-marked workers run again in their own trees, the barrier is
   * closed, and the group goes on through the tail — answered as ONE group
   * attempt of this engine start, over the INTERRUPTED run's ledger.
   */
  readonly restart?: TheRestartOfTheResumeDrive | undefined;
  /**
   * THE PATH OF THE STOP REQUEST the restart runs under (F143-FR-026, owed
   * item 4 of par-4): handed to the restart carry-out, whose worker passes
   * are polled at their boundaries exactly as a fresh group's are. The tail
   * (states 3 to 8) runs no worker process, so it polls nothing.
   */
  readonly stopRequestPath?: string | undefined;
}): Promise<TheResumeOfAnOpenGroup> {
  const { open } = input;
  const { decision } = open;
  if (decision.action === "nothing-is-repeated") {
    return Object.freeze({ carried: true, action: "nothing-is-repeated" });
  }
  if (decision.action === "close-the-group") {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: input.controlRoot,
      runId: open.runId,
      groupId: open.groupId,
      countersOf: theCountersOfTheLedger({
        ledgerFile: open.ledgerFile,
        ...(input.resetCounts === true ? { resetCounts: true } : {}),
      }),
    });
    initStore(open.places);
    const store = treeStore(open.places, {
      runId: open.runId,
      groupId: open.groupId,
      recordAhead: theRecordAheadOfTheWriter(ledger.writer),
    });
    const outcome = theOutcomeOfTheFinishedCheck(open.records);
    const closed = await closeTheGroupRun({
      places: open.places,
      writer: ledger.writer,
      store,
      runId: open.runId,
      groupId: open.groupId,
      outcome,
    });
    input.say?.(
      `[LOOP] parallel: the group ${open.groupId} of run ${open.runId} was closed by the resume of the engine (the merge check had finished; outcome ${outcome})`,
    );
    return Object.freeze({ carried: true, action: "close-the-group", closed });
  }
  // THE RESTART of the two states a worker process has to start for (states
  // 1 and 2), where the drive facts of a restart are handed in: the lost
  // passes are recorded, the restart-marked workers run again in their own
  // trees, and the group goes on through the tail.
  if (
    input.restart !== undefined &&
    (decision.action === "start-the-group" || decision.action === "end-the-recorded-processes")
  ) {
    return await carryOutTheStartOrRestartOfTheOpenGroup({
      open,
      controlRoot: input.controlRoot,
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
      ...(input.stopRequestPath === undefined ? {} : { stopRequestPath: input.stopRequestPath }),
      drive: input.restart,
    });
  }
  // THE TAIL of the eight states, where the drive facts are handed in: the
  // five actions the ledger answers with no worker process to start, carried
  // out over the interrupted run's ledger and answered as one group attempt.
  if (input.drive !== undefined) {
    return await carryOutTheTailOfTheOpenGroup({
      open,
      controlRoot: input.controlRoot,
      ...(input.resetCounts === true ? { resetCounts: true } : {}),
      drive: input.drive,
    });
  }
  // A state of the eight this slice does not carry out yet: nothing is
  // written, and the wiring withholds the fresh start.
  return Object.freeze({
    carried: false,
    action: decision.action,
    state: decision.state,
    ...(decision.says === undefined ? {} : { says: decision.says }),
  });
}
