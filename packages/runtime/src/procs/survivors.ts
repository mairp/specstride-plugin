/**
 * T057 — the search for survivors (F122-FR-027, F122-SC-004).
 *
 * *This feature MUST offer an operation that searches the process table of the
 * machine for processes that hold a run token whose hash the records of the
 * run hold, and returns them as survivors, each with its process id, its start
 * time and, where an entry exists, its kind and class. Every engine start and
 * every `resume` MUST call it and MUST end the survivors that are not live
 * entries of class `adoptable`, after the identity check, before any pass
 * starts. `status` and the doctor read the survivors through the same
 * operation and report them; they end nothing.*
 *
 * Three things in that sentence are easy to get wrong, and each has a shape
 * here rather than a comment:
 *
 *   - **the records hold the HASH, never the token.** So the search cannot
 *     call `findByRunToken` with a token it does not have. It walks the
 *     processes of the user, reads the environment of each, hashes the token
 *     it finds there and compares the HASH. The environment itself is never
 *     returned: it may hold a credential (T010, D-8).
 *   - **"the records of the run"**, plural and historical. F122-FR-024: *the
 *     hashes of the run tokens of earlier launches of a run stay in its
 *     records, so that a process of an earlier launch can be recognised.* A
 *     survivor of the launch before last is still a survivor.
 *   - **`status` and the doctor end nothing.** That is not a convention to be
 *     remembered: `findSurvivors` has no way to signal anything, and the
 *     ending lives in a separate call whose name says so.
 */
import type { GroupSignal, ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";
import type { ProcessClass, ProcessRegistry } from "@specstride/contracts/records/process-registry";
import {
  environmentOfAProcessOfTheSameUser,
  isAskableProcessId,
  platformIo,
  processesOfTheUser,
  startTimeOfProcess,
  type PlatformIo,
} from "./platform.ts";
import { hashToken, runTokenOf } from "./run-token.ts";
import { closeEntry, readEntries, readOpenEntries, type ProcsPlace } from "./registry.ts";
import {
  checkIdentity,
  kernelSignaller,
  signalUnderTheIdentityCheck,
  type IdentityDependencies,
  type IdentityResult,
  type MismatchRecord,
  type Signaller,
} from "./identity.ts";
import { processGroupOf, sessionOf, systemClock } from "@specstride/kernel";
import type { Clock } from "@specstride/contracts/ep/kernel-services";

/** The requirements this module carries. */
export const SURVIVOR_REQUIREMENTS = ["F122-FR-027", "F122-SC-004"] as const;

/** F122-FR-027 — the two callers that must end survivors before any pass. */
export const CALLERS_THAT_END_SURVIVORS = ["engine-start", "resume"] as const;

/** F122-FR-027 — the two callers that report them and end nothing. */
export const CALLERS_THAT_ONLY_REPORT = ["status", "doctor"] as const;

/** One process of the machine that holds a run token of this run. */
export type Survivor = {
  readonly pid: number;
  /** The start time the platform reports now, in milliseconds. */
  readonly startTimeMs: number | null;
  /** The hash of the run token it holds; one of the hashes of the records. */
  readonly runTokenHash: string;
  /** The process group the platform reports now. */
  readonly processGroup: number | null;
  /** The process session the platform reports now. */
  readonly processSession: number | null;
  /** The entry of the registry, where one is open for this process. */
  readonly entry: ProcessRegistry | null;
  /** From the entry, where there is one (F122-FR-027). */
  readonly kind: string | null;
  readonly class: ProcessClass | null;
};

/** What the search reads the machine through. */
export type SurvivorDependencies = {
  readonly io?: PlatformIo;
  readonly primitive?: ProcessPrimitive;
  /** The environment of a process of the same user; the platform's by default. */
  readonly environmentOf?: (pid: number) => Readonly<Record<string, string>> | null;
  /** The processes of the user; the platform's by default. */
  readonly processIds?: () => readonly number[];
};

/**
 * F122-FR-024 — every run token hash the records of the run hold, the hashes
 * of earlier launches included. The registry is the record that holds them.
 */
export function runTokenHashesOf(
  place: ProcsPlace,
  extra: readonly string[] = [],
): ReadonlySet<string> {
  const hashes = new Set<string>(extra);
  for (const entry of readEntries(place)) hashes.add(entry.runTokenHash);
  return hashes;
}

/**
 * F122-FR-027 — the survivors: the processes of the user that hold a run token
 * whose hash the records of the run hold.
 *
 * It SIGNALS NOTHING. There is no signaller among its arguments, so `status`
 * and the doctor cannot end anything by calling it, however they call it.
 */
export function findSurvivors(
  place: ProcsPlace,
  hashes: ReadonlySet<string>,
  dependencies: SurvivorDependencies = {},
): readonly Survivor[] {
  const io = dependencies.io ?? platformIo;
  const primitive = dependencies.primitive;
  const readEnvironment =
    dependencies.environmentOf ?? ((pid: number) => environmentOfAProcessOfTheSameUser(pid, io));
  const ids = dependencies.processIds ?? (() => processesOfTheUser(io).map((one) => one.pid));
  const open = readOpenEntries(place);
  const byPid = new Map<number, ProcessRegistry>();
  for (const entry of open) byPid.set(entry.pid, entry);

  const found: Survivor[] = [];
  for (const pid of ids()) {
    if (!isAskableProcessId(pid)) continue;
    if (pid === process.pid) continue;
    const environment = readEnvironment(pid);
    if (environment === null) continue;
    const secret = runTokenOf(environment);
    if (secret === null) continue;
    const hash = hashToken(secret);
    if (!hashes.has(hash)) continue;
    const entry = byPid.get(pid) ?? null;
    found.push(
      Object.freeze({
        pid,
        startTimeMs:
          primitive === undefined ? startTimeOfProcess(pid) : startTimeOfProcess(pid, primitive),
        runTokenHash: hash,
        processGroup: processGroupOf(pid, io),
        processSession: sessionOf(pid, io),
        entry,
        kind: entry?.kind ?? null,
        class: entry?.class ?? null,
      }),
    );
  }
  return Object.freeze(found.sort((a, b) => a.pid - b.pid));
}

/** F122-FR-027 — `status` and the doctor read through this and end nothing. */
export const REPORTING_ENDS_NOTHING = true as const;

/** One line per survivor, for `status`, the doctor and a refusal. */
export function survivorLines(survivors: readonly Survivor[]): readonly string[] {
  return Object.freeze(
    survivors.map(
      (one) =>
        `pid=${one.pid} kind=${one.kind ?? "unknown"} class=${one.class ?? "unknown"} ` +
        `startTime=${one.startTimeMs ?? "unknown"}`,
    ),
  );
}

/**
 * F122-FR-027 — read the survivors and report them. The same operation
 * `status` and the doctor use; it ends nothing, and the type says so.
 */
export function reportSurvivors(
  place: ProcsPlace,
  hashes: ReadonlySet<string>,
  dependencies: SurvivorDependencies = {},
): {
  readonly survivors: readonly Survivor[];
  readonly lines: readonly string[];
  readonly endsNothing: true;
} {
  const survivors = findSurvivors(place, hashes, dependencies);
  return Object.freeze({
    survivors,
    lines: survivorLines(survivors),
    endsNothing: REPORTING_ENDS_NOTHING,
  });
}

/* ------------------------------------------------------------------ *
 * Ending them.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-027, F122-FR-028 — a survivor is ended unless it is a LIVE ENTRY OF
 * CLASS `adoptable`. The entry must be open and its class `adoptable`: a
 * closed entry of an `adoptable` job whose process still holds a token is a
 * job the run has already let go of, and it is ended like any other survivor.
 */
export function isALiveAdoptableEntry(survivor: Survivor): boolean {
  return survivor.entry !== null && survivor.entry.class === "adoptable";
}

/** Why a survivor was not ended. */
export const NOT_ENDED_REASONS = [
  /** It is a live entry of class `adoptable`: it is adopted, not ended. */
  "adoptable",
  /** The identity check refused: 0 signals (F122-FR-025, F122-SC-005). */
  "identity-mismatch",
  /**
   * It is not the leader of its process group, and no survivor leads that
   * group either. The runtime did not create that group, so it is never
   * signalled; it is reported instead.
   */
  "group-not-created-by-the-runtime",
  /** Its group was signalled through the leader of the same group. */
  "covered-by-its-group-leader",
] as const;
export type NotEndedReason = (typeof NOT_ENDED_REASONS)[number];

/** What happened to one survivor. */
export type SurvivorOutcome = {
  readonly survivor: Survivor;
  readonly ended: boolean;
  readonly signalsSent: number;
  readonly reason: NotEndedReason | "signalled";
  readonly identity: IdentityResult | null;
  readonly mismatch: MismatchRecord | null;
};

/** What the whole pass over the survivors did. */
export type EndSurvivorsResult = {
  readonly outcomes: readonly SurvivorOutcome[];
  readonly signalsSent: number;
  readonly ended: readonly number[];
  readonly adopted: readonly number[];
  readonly mismatches: readonly MismatchRecord[];
  readonly reported: readonly string[];
};

/**
 * Build the entry the identity check is made against. Where the registry has
 * one, it IS the entry — the recorded start time and hash are what a planted
 * entry would be caught by. Where the registry has none, the survivor is a
 * process of an earlier launch that outlived its records; the check is then
 * made against what was just observed, and the group guard still has to pass,
 * which it does only for the leader of a group the runtime created.
 */
export function entryForTheCheck(survivor: Survivor, runId: string): ProcessRegistry | null {
  if (survivor.entry !== null) return survivor.entry;
  if (survivor.startTimeMs === null) return null;
  const group = survivor.processGroup;
  if (group === null) return null;
  return Object.freeze({
    schema: "specstride.procs/1",
    procId: `survivor-${survivor.pid}`,
    class: "owned" as const,
    kind: "harness-pass" as const,
    pid: survivor.pid,
    processGroup: group,
    processSession: survivor.processSession ?? survivor.pid,
    startTime: String(survivor.startTimeMs),
    runTokenHash: survivor.runTokenHash,
    runId,
    engineStartId: "unknown",
  });
}

/**
 * F122-FR-027 — end the survivors that are not live entries of class
 * `adoptable`, after the identity check, before any pass starts.
 *
 * The order of the ladder is the kernel's: polite, then terminate, then kill.
 * This call sends ONE round; `endOwnedProcesses` of T056 runs the ladder,
 * because it is the one that can wait between the rounds.
 */
export function endSurvivors(
  place: ProcsPlace,
  survivors: readonly Survivor[],
  signal: GroupSignal = "terminate",
  dependencies: IdentityDependencies & {
    readonly signaller?: Signaller;
    readonly writer?: string;
    readonly clock?: Clock;
  } = {},
): EndSurvivorsResult {
  const signaller = dependencies.signaller ?? kernelSignaller;
  const clock = dependencies.clock ?? systemClock;
  const writer = dependencies.writer ?? "runtime-root";
  const outcomes: SurvivorOutcome[] = [];
  const mismatches: MismatchRecord[] = [];
  const ended: number[] = [];
  const adopted: number[] = [];
  let signalsSent = 0;

  // The groups that a leader among the survivors will have signalled, so a
  // member of the same group is not signalled a second time.
  const leaders = new Set<number>();
  for (const one of survivors) {
    if (isALiveAdoptableEntry(one)) continue;
    if (one.processGroup !== null && one.processGroup === one.pid) leaders.add(one.pid);
  }

  for (const survivor of survivors) {
    if (isALiveAdoptableEntry(survivor)) {
      adopted.push(survivor.pid);
      outcomes.push(
        Object.freeze({
          survivor,
          ended: false,
          signalsSent: 0,
          reason: "adoptable" as const,
          identity: null,
          mismatch: null,
        }),
      );
      continue;
    }
    const isLeader = survivor.processGroup !== null && survivor.processGroup === survivor.pid;
    if (!isLeader) {
      const covered = survivor.processGroup !== null && leaders.has(survivor.processGroup);
      outcomes.push(
        Object.freeze({
          survivor,
          ended: covered,
          signalsSent: 0,
          reason: covered
            ? ("covered-by-its-group-leader" as const)
            : ("group-not-created-by-the-runtime" as const),
          identity: null,
          mismatch: null,
        }),
      );
      continue;
    }
    const entry = entryForTheCheck(survivor, place.runId);
    if (entry === null) {
      outcomes.push(
        Object.freeze({
          survivor,
          ended: false,
          signalsSent: 0,
          reason: "group-not-created-by-the-runtime" as const,
          identity: null,
          mismatch: null,
        }),
      );
      continue;
    }
    const guarded = signalUnderTheIdentityCheck(entry, signal, { ...dependencies, signaller });
    signalsSent += guarded.signalsSent;
    if (guarded.outcome === "signalled") {
      ended.push(survivor.pid);
      // F122-FR-023 — an entry is closed when its process ends, and the run
      // has just ended this one. Closing it keeps the registry honest: a
      // survivor the run decided to end is not an open entry any more. It
      // costs nothing if the process outlives one round of the ladder,
      // because the next search reads the PROCESS TABLE and not the registry,
      // so a process that is still there is found again.
      if (survivor.entry !== null) {
        closeEntry(place, writer, survivor.entry, "ended-by-the-root", clock);
      }
      outcomes.push(
        Object.freeze({
          survivor,
          ended: true,
          signalsSent: guarded.signalsSent,
          reason: "signalled" as const,
          identity: guarded.identity,
          mismatch: null,
        }),
      );
      continue;
    }
    if (guarded.record !== null) mismatches.push(guarded.record);
    // F122-FR-025 — the entry is closed with the end cause of the mismatch.
    if (survivor.entry !== null) {
      closeEntry(place, writer, survivor.entry, "identity-mismatch", clock);
    }
    outcomes.push(
      Object.freeze({
        survivor,
        ended: false,
        signalsSent: 0,
        reason: "identity-mismatch" as const,
        identity: guarded.identity,
        mismatch: guarded.record,
      }),
    );
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    signalsSent,
    ended: Object.freeze(ended),
    adopted: Object.freeze(adopted),
    mismatches: Object.freeze(mismatches),
    reported: survivorLines(survivors),
  });
}

/** The identity check of one survivor, for a caller that only wants to look. */
export function identityOfASurvivor(
  survivor: Survivor,
  runId: string,
  dependencies: IdentityDependencies = {},
): IdentityResult | null {
  const entry = entryForTheCheck(survivor, runId);
  return entry === null ? null : checkIdentity(entry, dependencies);
}
