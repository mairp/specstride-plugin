/**
 * T054 — the identity check and the guarded signal (F122-FR-025, F122-SC-005).
 *
 * *A signal MUST be sent to a process only after an identity check: the
 * process id, the start time that the operating system reports, and the run
 * token that the process holds MUST all match the registry entry. On a
 * mismatch no signal MUST be sent, the entry MUST be closed with the end cause
 * `identity-mismatch`, and the mismatch MUST be recorded. A signal MUST go to
 * the process group or process session that the runtime created for the
 * entry, and never to a group the runtime did not create.*
 *
 * The requirement names two guards and this module is both of them.
 *
 * **The first guard is about the TARGET.** Three readings have to agree with
 * the entry: the id, the start time, and the token. The id alone is worthless
 * — it is reused — and the start time alone cannot tell a process of this run
 * from a process of another run that happens to have started at the same
 * moment, which is what the token is for. `checkIdentity` reads all three and
 * answers with every disagreement it found, not just the first, so that the
 * record of a mismatch says what was wrong.
 *
 * **The second guard is about the BLAST RADIUS.** A process group is a
 * negative process id to the platform, and `kill(-1)` as root is the machine.
 * So a group is signalled here only when the runtime created it, and the
 * runtime creates a group exactly one way: the process primitive of the kernel
 * starts every child detached, which makes the child the leader of a new
 * session and a new group, so the group id EQUALS the process id.
 * `theRuntimeCreatedTheGroup` is that sentence as a predicate; a recorded
 * group that is not the recorded pid is a group this runtime did not make, and
 * is never signalled. The kernel's own `assertSignallableGroup` refuses 0, 1
 * and every negative id underneath, so the two guards are independent.
 *
 * Nothing here signals a bare process id. The requirement says *the process
 * group or process session that the runtime created*, and the group of a
 * session leader reaches the leader and its children both, which is what the
 * end of an `owned` process has to cover.
 */
import {
  signalGroup as kernelSignalGroup,
  processGroupOf,
  processPrimitive,
} from "@specstride/kernel";
import type { GroupSignal, ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";
import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";
import {
  environmentOfAProcessOfTheSameUser,
  isAskableProcessId,
  platformIo,
  recordedProcessLives,
  START_TIME_TOLERANCE_MS,
  type PlatformIo,
} from "./platform.ts";
import { hashToken, runTokenOf } from "./run-token.ts";
import { startTimeMsOf } from "./registry.ts";

/** The requirements this module carries. */
export const IDENTITY_REQUIREMENTS = ["F122-FR-025", "F122-SC-005"] as const;

/** The end cause a mismatch closes an entry with (F122-FR-025). */
export const IDENTITY_MISMATCH = "identity-mismatch" as const;

/** The three readings that must all match (F122-FR-025). */
export const IDENTITY_FACETS = ["pid", "startTime", "runToken"] as const;
export type IdentityFacet = (typeof IDENTITY_FACETS)[number];

/** Why an identity did not match. One entry per facet that disagreed. */
export const MISMATCH_REASONS = [
  /** The recorded id is not an id of a single process at all. */
  "pid-not-a-process",
  /** No process of that id is there. */
  "pid-gone",
  /** The id is there and belongs to a process that started at another time. */
  "start-time-differs",
  /** The platform will not say when it started, so reuse cannot be ruled out. */
  "start-time-unreadable",
  /** The process holds no run token. */
  "run-token-absent",
  /** It holds one, and it is not the one the entry recorded. */
  "run-token-differs",
  /** Its environment cannot be read, so the token cannot be compared. */
  "run-token-unreadable",
  /** The recorded group is not one the runtime created. */
  "group-not-created-by-the-runtime",
  /** The live process is not in the group the entry recorded. */
  "group-differs",
] as const;
export type MismatchReason = (typeof MISMATCH_REASONS)[number];

/** What the identity check answers. */
export type IdentityResult = {
  /** True only where all three readings matched and the group is ours. */
  readonly matches: boolean;
  /** Every disagreement found, in the order of `MISMATCH_REASONS`. */
  readonly mismatches: readonly MismatchReason[];
  /** The start time the platform reports now, where it could be read. */
  readonly observedStartTimeMs: number | null;
  /** The group the platform reports now, where it could be read. */
  readonly observedProcessGroup: number | null;
  /** The pid the entry named. */
  readonly pid: number;
  readonly procId: string;
};

/** What the check reads the machine through. */
export type IdentityDependencies = {
  readonly io?: PlatformIo;
  readonly primitive?: ProcessPrimitive;
  /** The process group of the asker, which is never signalled. */
  readonly ownProcessGroup?: () => number | null;
  /**
   * The environment of a process of the same user. `environmentOfAProcessOfTheSameUser`
   * of T010 by default; a test hands in a recorded one. The value is compared
   * and never returned by this module: an environment may hold a credential.
   */
  readonly environmentOf?: (pid: number) => Readonly<Record<string, string>> | null;
};

/**
 * How far a recorded and an observed start time may differ: the tolerance of
 * the liveness reader of T010, imported and not restated, so that the check
 * and the reader cannot drift apart. The Linux value is derived from a boot
 * time recorded in whole seconds, which is the whole reason for a tolerance.
 */
export { START_TIME_TOLERANCE_MS };

/**
 * F122-FR-025 — the group a signal may go to is one the runtime created, and
 * the runtime creates a group exactly one way: the process primitive starts
 * every child detached, so the child leads a new session and a new group and
 * the group id is the process id.
 */
export function theRuntimeCreatedTheGroup(entry: ProcessRegistry): boolean {
  return (
    Number.isInteger(entry.processGroup) &&
    entry.processGroup > 1 &&
    entry.processGroup === entry.pid &&
    isAskableProcessId(entry.pid)
  );
}

/** The process group of this process, read from the platform. */
export function ownProcessGroup(): number | null {
  return processGroupOf(process.pid);
}

/**
 * F122-FR-025 — the identity check. It sends nothing: every reading is a read
 * of the process table or of a process environment, and the liveness question
 * goes through `recordedProcessLives`, which asks the platform whether a
 * signal WOULD be delivered and delivers none.
 */
export function checkIdentity(
  entry: ProcessRegistry,
  dependencies: IdentityDependencies = {},
): IdentityResult {
  const io = dependencies.io ?? platformIo;
  const primitive = dependencies.primitive ?? processPrimitive;
  const own = (dependencies.ownProcessGroup ?? ownProcessGroup)();
  const mismatches: MismatchReason[] = [];
  const recordedStart = startTimeMsOf(entry);

  // 1. The process id.
  if (!isAskableProcessId(entry.pid)) {
    return frozen({
      matches: false,
      mismatches: ["pid-not-a-process"],
      observedStartTimeMs: null,
      observedProcessGroup: null,
      pid: entry.pid,
      procId: entry.procId,
    });
  }
  const liveness = recordedProcessLives(
    { pid: entry.pid, startTimeMs: recordedStart },
    io,
    primitive,
  );
  if (!liveness.alive && liveness.reason !== "pid-reused") mismatches.push("pid-gone");

  // 2. The start time the operating system reports.
  const observedStart = liveness.observedStartTimeMs ?? primitive.startTimeOf(entry.pid);
  if (observedStart === null) {
    mismatches.push("start-time-unreadable");
  } else if (recordedStart === null) {
    mismatches.push("start-time-unreadable");
  } else if (Math.abs(observedStart - recordedStart) > START_TIME_TOLERANCE_MS) {
    mismatches.push("start-time-differs");
  }

  // 3. The run token the process holds.
  const readEnvironment =
    dependencies.environmentOf ?? ((pid: number) => environmentOfAProcessOfTheSameUser(pid, io));
  const environment = readEnvironment(entry.pid);
  if (environment === null) {
    mismatches.push("run-token-unreadable");
  } else {
    const secret = runTokenOf(environment);
    if (secret === null) mismatches.push("run-token-absent");
    else if (hashToken(secret) !== entry.runTokenHash) mismatches.push("run-token-differs");
  }

  // 4. The group: ours to signal, and the one the process is actually in.
  const observedGroup = groupOf(entry.pid, io);
  if (!theRuntimeCreatedTheGroup(entry)) mismatches.push("group-not-created-by-the-runtime");
  else if (observedGroup !== null && observedGroup !== entry.processGroup) {
    mismatches.push("group-differs");
  }
  if (own !== null && entry.processGroup === own)
    mismatches.push("group-not-created-by-the-runtime");

  const ordered = MISMATCH_REASONS.filter((reason) => mismatches.includes(reason));
  return frozen({
    matches: ordered.length === 0,
    mismatches: ordered,
    observedStartTimeMs: observedStart,
    observedProcessGroup: observedGroup,
    pid: entry.pid,
    procId: entry.procId,
  });
}

function frozen(result: IdentityResult): IdentityResult {
  return Object.freeze({ ...result, mismatches: Object.freeze([...result.mismatches]) });
}

/** The process group the platform reports for a live process. */
function groupOf(pid: number, io: PlatformIo): number | null {
  return processGroupOf(pid, io);
}

/* ------------------------------------------------------------------ *
 * The guarded signal.
 * ------------------------------------------------------------------ */

/** What a guarded signal did. */
export const GUARDED_SIGNAL_OUTCOMES = [
  /** The identity matched and the group was signalled. */
  "signalled",
  /** The identity did not match: 0 signals, the entry closed as a mismatch. */
  IDENTITY_MISMATCH,
] as const;
export type GuardedSignalOutcome = (typeof GUARDED_SIGNAL_OUTCOMES)[number];

/** The report of one guarded signal. */
export type GuardedSignal = {
  readonly outcome: GuardedSignalOutcome;
  /** How many signals left this process for that entry. 0 on a mismatch. */
  readonly signalsSent: number;
  /** The group that was signalled, where one was. */
  readonly processGroup: number | null;
  readonly identity: IdentityResult;
  /** F122-FR-025 — the mismatch, as it is recorded. */
  readonly record: MismatchRecord | null;
};

/** F122-FR-025 — *the mismatch MUST be recorded*. This is the record. */
export type MismatchRecord = {
  readonly kind: "identity-mismatch";
  readonly procId: string;
  readonly pid: number;
  readonly recordedStartTime: string;
  readonly observedStartTimeMs: number | null;
  readonly recordedProcessGroup: number;
  readonly observedProcessGroup: number | null;
  readonly reasons: readonly MismatchReason[];
  /** Never the token, and never its hash either: a hash of a secret is a hint. */
  readonly runTokenCompared: boolean;
};

/** Build the record of a mismatch from an entry and its check. */
export function mismatchRecordOf(entry: ProcessRegistry, identity: IdentityResult): MismatchRecord {
  return Object.freeze({
    kind: IDENTITY_MISMATCH,
    procId: entry.procId,
    pid: entry.pid,
    recordedStartTime: entry.startTime,
    observedStartTimeMs: identity.observedStartTimeMs,
    recordedProcessGroup: entry.processGroup,
    observedProcessGroup: identity.observedProcessGroup,
    reasons: identity.mismatches,
    runTokenCompared: !identity.mismatches.includes("run-token-unreadable"),
  });
}

/** How a guarded signal reaches the platform; a test hands in a counter. */
export type Signaller = (pgid: number, signal: GroupSignal) => void;

/** The signaller of the product: `signalGroup` of the kernel primitive (T075). */
export const kernelSignaller: Signaller = (pgid, signal) => kernelSignalGroup(pgid, signal);

/**
 * F122-FR-025, F122-SC-005 — signal the group of an entry, and only after the
 * identity check. On a mismatch NOTHING is signalled: `signalsSent` is 0, the
 * outcome is `identity-mismatch`, and the record of the mismatch is returned
 * for the caller to close the entry with.
 *
 * The caller closes the entry rather than this module, because the writer of
 * an entry is the process that opened it (F122-FR-023) and this function is
 * called by whoever is doing the ending. `endOwnedProcesses` of T056 and the
 * stop primitives of T055 both close through the registry.
 */
export function signalUnderTheIdentityCheck(
  entry: ProcessRegistry,
  signal: GroupSignal,
  dependencies: IdentityDependencies & { readonly signaller?: Signaller } = {},
): GuardedSignal {
  const identity = checkIdentity(entry, dependencies);
  if (!identity.matches) {
    return Object.freeze({
      outcome: IDENTITY_MISMATCH,
      signalsSent: 0,
      processGroup: null,
      identity,
      record: mismatchRecordOf(entry, identity),
    });
  }
  const signaller = dependencies.signaller ?? kernelSignaller;
  // `signalGroup` of the kernel refuses 0, 1 and every negative id itself; the
  // predicate above has already refused a group this runtime did not create.
  signaller(entry.processGroup, signal);
  return Object.freeze({
    outcome: "signalled",
    signalsSent: 1,
    processGroup: entry.processGroup,
    identity,
    record: null,
  });
}
