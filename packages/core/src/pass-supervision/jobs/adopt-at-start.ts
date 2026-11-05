/**
 * T067 of feature 118 — the adoption of detached jobs at the engine start
 * (F118-FR-031). A stop, `stop --now` and the end of the engine leave an
 * `adoptable` job alive; the next engine start reads the registry and the
 * job's record, and for each `adoptable` entry whose process id, start time
 * and run token all match continues the wait with the same predicate and the
 * REMAINING deadline of the yield. An entry that does not match is treated
 * as ended and is NEVER signalled — a reused pid or a job of another run
 * must not receive a signal that was meant for the old job.
 *
 * The wait after an adoption starts a new pass, with a fresh session, when
 * it ends (owner ruling 55): every adopted outcome of this module carries
 * `requiresFreshPassSession: true`.
 *
 * No process is started and no signal is sent here: the module reads the
 * registry and the process list through the ports and only decides. The
 * core imports neither `node:fs` nor `node:child_process`.
 */
import type { Clock, ProcessList, RegistryAccess } from "../ports.ts";
import { identityMatches, isAdoptableEntry } from "./registry.ts";

/** The kinds of predicate a job's record can carry (contract `yield-predicates.md`). */
export type AdoptedPredicateKind =
  "pid" | "exit_code_file" | "file_exists" | "file_stable" | "grep" | "command" | "first_failure";

/** The predicate a job's record carries, written back unchanged on adoption. */
export interface AdoptedPredicate {
  readonly kind: AdoptedPredicateKind;
  readonly path?: string | undefined;
  readonly pattern?: string | undefined;
  readonly stableSec?: number | undefined;
  readonly pid?: number | undefined;
  readonly argv?: readonly string[] | undefined;
}

/**
 * The job record `job:<jobId>:record` (data model): what the next engine
 * start reads beside the registry entry to re-enter the wait.
 */
export interface JobRecord {
  readonly jobId: string;
  readonly mode: "launch" | "adopt";
  readonly predicate: AdoptedPredicate;
  /** When the wait of the yield ends, in ms since the epoch. */
  readonly deadlineAtMs: number;
  /** When the wait started, in ms since the epoch. */
  readonly waitStartedAtMs: number;
  /** The index of the yield inside its attempt. */
  readonly yieldIndex: number;
  /** Whether the runtime launched the job itself (F118-FR-039 gating). */
  readonly launchedByRuntime: boolean;
}

/** What the adoption decided about one `adoptable` entry. */
export type AdoptionOutcome =
  | {
      readonly logicalName: string;
      readonly jobId: string;
      readonly disposition: "adopted";
      /** The remaining deadline, in ms; the wait re-enters `waiting` with it. */
      readonly remainingDeadlineMs: number;
      readonly predicate: AdoptedPredicate;
      /** Ruling 55: the wait after an adoption ends into a fresh pass session. */
      readonly requiresFreshPassSession: true;
    }
  | {
      readonly logicalName: string;
      readonly jobId: string;
      readonly disposition: "ended";
      readonly reason:
        | "no-record"
        | "process-gone"
        | "start-time-mismatch"
        | "run-token-mismatch"
        | "deadline-expired-before-adoption";
      /** An ended job is never signalled, whatever the reason (F118-FR-031). */
      readonly signalled: false;
    };

/** The ports the adoption needs. */
export interface AdoptAtStartDeps {
  readonly registry: RegistryAccess;
  readonly processes: ProcessList;
  readonly clock: Clock;
  /** The run-token hash of this engine start (F118-FR-031: the match rule). */
  readonly runTokenHash: string;
  /** Read the record of a job, or `undefined` when there is none. */
  readRecord(logicalName: string): JobRecord | undefined;
  /** Drop the entry of an ended job from the registry (an atomic write). */
  removeEntry(logicalName: string): void;
}

/**
 * Adopt the `adoptable` jobs of the previous run at the engine start
 * (F118-FR-031). For each `adoptable` entry: read its record; find the live
 * process; require the pid, the start time and the run token to all match.
 * A match re-enters the wait with the same predicate and the remaining
 * deadline; anything else is treated as ended, its entry is dropped, and
 * nothing is signalled.
 */
export function adoptAtStart(deps: AdoptAtStartDeps): readonly AdoptionOutcome[] {
  const nowMs = deps.clock.nowMs();
  const outcomes: AdoptionOutcome[] = [];
  for (const entry of deps.registry.adoptable()) {
    if (!isAdoptableEntry(entry)) continue;
    const logicalName = entry.logicalName;
    const record = deps.readRecord(logicalName);
    if (record === undefined) {
      deps.removeEntry(logicalName);
      outcomes.push({
        logicalName,
        jobId: logicalName,
        disposition: "ended",
        reason: "no-record",
        signalled: false,
      });
      continue;
    }
    const tree = deps.processes.tree(entry.identity.pid);
    const live = tree.find((p) => p.pid === entry.identity.pid);
    if (live === undefined) {
      deps.removeEntry(logicalName);
      outcomes.push({
        logicalName,
        jobId: record.jobId,
        disposition: "ended",
        reason: "process-gone",
        signalled: false,
      });
      continue;
    }
    if (
      !identityMatches(entry, {
        pid: live.pid,
        startedAtMs: live.startedAtMs,
        runTokenHash: deps.runTokenHash,
      })
    ) {
      // A reused pid or a job of another run: ended, and NEVER signalled.
      const reason =
        live.startedAtMs === entry.identity.startedAtMs
          ? "run-token-mismatch"
          : "start-time-mismatch";
      deps.removeEntry(logicalName);
      outcomes.push({
        logicalName,
        jobId: record.jobId,
        disposition: "ended",
        reason,
        signalled: false,
      });
      continue;
    }
    const remainingDeadlineMs = record.deadlineAtMs - nowMs;
    if (remainingDeadlineMs <= 0) {
      deps.removeEntry(logicalName);
      outcomes.push({
        logicalName,
        jobId: record.jobId,
        disposition: "ended",
        reason: "deadline-expired-before-adoption",
        signalled: false,
      });
      continue;
    }
    outcomes.push({
      logicalName,
      jobId: record.jobId,
      disposition: "adopted",
      remainingDeadlineMs,
      predicate: record.predicate,
      requiresFreshPassSession: true,
    });
  }
  return outcomes;
}
