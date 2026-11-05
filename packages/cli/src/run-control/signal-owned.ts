/**
 * T025 — `--now` and `--jobs`: ending owned processes (and, only when asked,
 * adoptable jobs) under the identity check, through the process primitive of
 * the kernel (F102-FR-006, F102-FR-007, F102-FR-008).
 *
 * F102-FR-006 — `stop --now` writes the SAME request as `stop` (the caller
 * does that, through `writeStopRequest`) and ALSO ends the owned processes of
 * the pass in flight: the entries of class `owned` of the process registry
 * (`run:<runId>:procs`), with every descendant of theirs that is not an
 * `adoptable` job. THE SIGNAL IS A TERMINATION SIGNAL ONLY — no forced kill,
 * no KILL escalation (B-1566) — and a failure to signal is IGNORED.
 *
 * F102-FR-007 — BEFORE any signal, the identity check: the pid, the start
 * time and the run token of the registry entry must all match the live
 * process (the same three facets the runtime root checks, F122-FR-025). On a
 * mismatch NO signal is sent and the mismatch is recorded, so the check is
 * observable from the outside (F102-SC-002: a reused pid sends no signal).
 * Only entries of class `owned` are considered at all.
 *
 * F102-FR-008 — an `adoptable` detached job is NEVER ended by `stop` or
 * `stop --now`. `--jobs` (with or without `--now`) is the separate, explicit
 * request that also ends adoptable jobs, again only after the same identity
 * check.
 *
 * THE SEAMS. Everything that could reach the machine is a parameter: the
 * reader of the start time, the reader of a process environment, the answer
 * of a signal, and the signaller itself. The defaults call the KERNEL's
 * process primitive — `startTimeOf` and `processGroupOf` of the process
 * table, `signalGroup` of `@specstride/kernel/proc` — and nothing else; this
 * module never opens `/proc` by hand and never signals a bare pid. A group is
 * signalled only where the recorded group IS the recorded pid, which is the
 * shape of a group the runtime created (its started children are detached, so
 * each is the leader of its own session); that is the same predicate
 * `theRuntimeCreatedTheGroup` of feature 122 states, restated here because
 * the CLI (L6) imports no L5 package — between the CLI and the runtime root
 * there are only files.
 */
import { createHash } from "node:crypto";

import {
  platformProcessTableIo,
  processGroupOf,
  signalGroup,
  startTimeOf,
  type ProcessTableIo,
} from "@specstride/kernel";
import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";
import { PROCESS_CLASSES } from "@specstride/contracts/records/process-registry";

/** The requirements this module carries out. */
export const SIGNAL_OWNED_REQUIREMENTS = ["F102-FR-006", "F102-FR-007", "F102-FR-008"] as const;

/** The variable the run token is carried in (F122-FR-024; annex B §B.10). */
export const RUN_TOKEN_VAR = "SPECSTRIDE_RUN_TOKEN" as const;

/**
 * The start time of the platform and the recorded one may differ by a
 * clock tick's rounding; the runtime root allows one second, and so does
 * this check — the same number, restated, because L6 imports no L5 package.
 */
export const START_TIME_TOLERANCE_MS = 1_000 as const;

/** The one signal this module sends: termination, never a forced kill (B-1566). */
export const THE_SIGNAL = "terminate" as const;

/** A failure to signal is ignored (F102-FR-006). */
export const A_SIGNAL_FAILURE_IS_IGNORED = true as const;

/** No KILL escalation exists here (B-1566). */
export const KILL_ESCALATION = false as const;

/** The classes `stop` considers: `owned` always; `adoptable` only with `--jobs`. */
export function classesConsidered(jobs: boolean): readonly (typeof PROCESS_CLASSES)[number][] {
  return jobs ? PROCESS_CLASSES : (["owned"] as const);
}

/** The smallest id this module will ask the platform about. */
export const MINIMUM_PID = 2 as const;

/** What one entry came to. */
export type SignalOutcome = {
  /** The id of the entry in the registry file, where the file names one. */
  readonly procId: string | null;
  readonly pid: number;
  /** The class of the entry: `owned` or `adoptable`. */
  readonly cls: string;
  /** `signalled`, `not-running` or `identity-mismatch`. */
  readonly outcome: "signalled" | "not-running" | "identity-mismatch";
  /** Every identity facet that disagreed, for the mismatch record. */
  readonly mismatch: readonly string[];
};

/** What one `--now` (or `--jobs`) pass came to. */
export type SignalOwnedResult = {
  /** The entries considered, in the order of the registry. */
  readonly outcomes: readonly SignalOutcome[];
  /** How many signals left this process. */
  readonly signalsSent: number;
  /** How many processes ended, counted as signalled entries (the `ended` key). */
  readonly ended: number;
  /** The pid of the first owned entry, where one was recorded — the pass in flight. */
  readonly passPid: number | null;
  /** True where no entry was recorded at all: the flag-only stop (B-1551). */
  readonly noRecord: boolean;
};

/** Everything that could reach the machine, as seams. */
export type SignalOwnedDependencies = {
  /** The start time the platform reports for a pid, in epoch ms; null where it is gone. */
  readonly startTimeOfPid?: (pid: number) => number | null;
  /** The environment of a live process, or null where it cannot be read. */
  readonly environmentOf?: (pid: number) => Readonly<Record<string, string>> | null;
  /** Whether the platform would deliver a signal to the pid (no signal sent). */
  readonly aliveOf?: (pid: number) => boolean;
  /** The process group of a live pid, or null. */
  readonly groupOf?: (pid: number) => number | null;
  /** The signaller: the kernel's `signalGroup` by default. */
  readonly signal?: (pgid: number, signal: "terminate") => void;
};

const defaultDeps: SignalOwnedDependencies = {
  startTimeOfPid: (pid) => startTimeOf(pid, platformProcessTableIo),
  environmentOf: (pid) => {
    // Through the primitive's io, never by hand: the table reader of the
    // kernel is the one place that opens the process file system.
    const io: ProcessTableIo = platformProcessTableIo;
    const text = io.readFile?.(`/proc/${pid}/environ`) ?? null;
    if (text === null) return null;
    const environment: Record<string, string> = {};
    for (const entry of text.split("\0")) {
      const eq = entry.indexOf("=");
      if (eq <= 0) continue;
      environment[entry.slice(0, eq) as string] = entry.slice(eq + 1);
    }
    return environment;
  },
  aliveOf: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  groupOf: (pid) => processGroupOf(pid),
  signal: (pgid, signal) => {
    // The kernel's own guard: it refuses 0, 1 and every negative id.
    signalGroup(pgid, signal);
  },
};

/** SHA-256 of the run token, as a record holds it (annex B §B.10). */
export function hashOfToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The identity check of F102-FR-007: pid, start time and run token must ALL
 * match. Answers with every facet that disagreed, so a mismatch is
 * recordable, and never with a signal.
 */
export function identityMismatchesOf(
  entry: Pick<ProcessRegistry, "pid" | "startTime" | "runTokenHash">,
  deps: SignalOwnedDependencies = {},
): readonly string[] {
  const readStart = deps.startTimeOfPid ?? defaultDeps.startTimeOfPid!;
  const readEnvironment = deps.environmentOf ?? defaultDeps.environmentOf!;
  const mismatches: string[] = [];

  // The pid: an integer above one (never a group id, never init).
  if (!Number.isInteger(entry.pid) || (entry.pid as number) < MINIMUM_PID) {
    return ["pid-not-a-process"];
  }
  // The start time.
  const observed = readStart(entry.pid);
  const recorded = Date.parse(entry.startTime);
  if (observed === null || Number.isNaN(observed)) {
    mismatches.push("start-time-unreadable");
  } else if (Number.isNaN(recorded) || Math.abs(observed - recorded) > START_TIME_TOLERANCE_MS) {
    mismatches.push("start-time-differs");
  }
  // The run token: the process must hold the token whose HASH the entry
  // recorded; the token itself is in no record (F122-FR-024).
  const environment = readEnvironment(entry.pid);
  const token = environment === null ? undefined : environment[RUN_TOKEN_VAR];
  if (token === undefined) mismatches.push("run-token-absent");
  else if (hashOfToken(token) !== entry.runTokenHash) mismatches.push("run-token-differs");
  return Object.freeze(mismatches);
}

/**
 * End the recorded processes of the pass in flight (F102-FR-006), and the
 * adoptable jobs too only when `jobs` is true (F102-FR-008). Every entry:
 * class filter first, identity check second, signal last — a termination
 * signal to the process group the runtime created (recorded group = recorded
 * pid), whose delivery reaches the leader and its children. A failure to
 * signal is ignored (F102-FR-006); a mismatch sends nothing (F102-FR-007).
 */
export function signalOwnedEntries(
  entries: readonly ProcessRegistry[],
  options: { readonly jobs?: boolean | undefined } & SignalOwnedDependencies = {},
): SignalOwnedResult {
  const jobs = options.jobs === true;
  const aliveOf = options.aliveOf ?? defaultDeps.aliveOf!;
  const groupOf = options.groupOf ?? defaultDeps.groupOf!;
  const signal = options.signal ?? defaultDeps.signal!;
  const considered = new Set(classesConsidered(jobs));

  const outcomes: SignalOutcome[] = [];
  let signalsSent = 0;
  let passPid: number | null = null;

  for (const entry of entries) {
    if (!considered.has(entry.class)) continue;
    if (passPid === null && entry.class === "owned") passPid = entry.pid;
    if (!aliveOf(entry.pid)) {
      outcomes.push(
        Object.freeze({
          procId: entry.procId ?? null,
          pid: entry.pid,
          cls: entry.class,
          outcome: "not-running",
          mismatch: Object.freeze([]),
        }),
      );
      continue;
    }
    const mismatch = identityMismatchesOf(entry, options);
    if (mismatch.length > 0) {
      // F102-FR-007: on ANY mismatch, no signal is sent.
      outcomes.push(
        Object.freeze({
          procId: entry.procId ?? null,
          pid: entry.pid,
          cls: entry.class,
          outcome: "identity-mismatch",
          mismatch,
        }),
      );
      continue;
    }
    // The group the runtime created: the recorded group IS the recorded pid
    // (its children are detached session leaders), and the platform must
    // report the same group now. Anything else is never signalled — the
    // blast-radius guard of F122-FR-025, restated.
    const group = groupOf(entry.pid);
    if (entry.processGroup !== entry.pid || group !== entry.processGroup) {
      outcomes.push(
        Object.freeze({
          procId: entry.procId ?? null,
          pid: entry.pid,
          cls: entry.class,
          outcome: "identity-mismatch",
          mismatch: Object.freeze(["group-not-created-by-the-runtime"]),
        }),
      );
      continue;
    }
    try {
      signal(group, THE_SIGNAL);
      signalsSent += 1;
      outcomes.push(
        Object.freeze({
          procId: entry.procId ?? null,
          pid: entry.pid,
          cls: entry.class,
          outcome: "signalled",
          mismatch: Object.freeze([]),
        }),
      );
    } catch {
      // A failure to signal is ignored (F102-FR-006; B-1566).
      outcomes.push(
        Object.freeze({
          procId: entry.procId ?? null,
          pid: entry.pid,
          cls: entry.class,
          outcome: "not-running",
          mismatch: Object.freeze([]),
        }),
      );
    }
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    signalsSent,
    ended: signalsSent,
    passPid,
    noRecord: entries.length === 0,
  });
}

/** Which of the three as-is `--now` lines the outcome chooses (B-1549, B-1550, B-1551). */
export function nowLineKindOf(result: SignalOwnedResult): "killed" | "not-running" | "no-record" {
  if (result.noRecord) return "no-record";
  if (result.signalsSent > 0) return "killed";
  return "not-running";
}
