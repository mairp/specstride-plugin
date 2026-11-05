/**
 * T057 — the adoption of `adoptable` entries (F122-FR-028).
 *
 * *A process of class `adoptable` MUST survive a stop, `stop --now`, the end
 * of the engine and the end of the runtime root. The next engine start MUST
 * adopt it: it checks the identity of every open entry of class `adoptable`,
 * keeps the entries whose process lives, and closes the others with the end
 * cause `gone`. An `adoptable` process MUST be ended only on an explicit
 * request, which is the field `jobs` of a stop request.*
 *
 * The requirement is mostly a list of things that must NOT happen, and this
 * module is where each of them is refused:
 *
 *   - `SURVIVES` names the four events a job lives through, as data, so a
 *     test reads the list rather than trusting four separate code paths;
 *   - `adoptOpenAdoptableEntries` is the whole of "adopt or close as `gone`".
 *     It signals nothing: there is no signaller among its arguments;
 *   - `mayEndAnAdoptableProcess` is the one gate to ending one, and it reads
 *     the field `jobs` of the stop request and nothing else — not `now`, not
 *     the mode, not a flag of the caller.
 */
import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";
import type { GroupSignal } from "@specstride/contracts/ep/kernel-services";
import type { Clock } from "@specstride/contracts/ep/kernel-services";
import { systemClock } from "@specstride/kernel";
import {
  checkIdentity,
  kernelSignaller,
  signalUnderTheIdentityCheck,
  type IdentityDependencies,
  type IdentityResult,
  type MismatchRecord,
  type Signaller,
} from "./identity.ts";
import {
  closeEntry,
  readOpenEntriesOfClass,
  type ProcsPlace,
  type RegistryEndCause,
} from "./registry.ts";

/** The requirement this module carries. */
export const ADOPT_REQUIREMENTS = ["F122-FR-028"] as const;

/** F122-FR-028 — the four events a process of class `adoptable` lives through. */
export const SURVIVES = Object.freeze([
  "a stop",
  "`stop --now`",
  "the end of the engine",
  "the end of the runtime root",
]);

/** F122-FR-028 — the end cause an entry whose process is gone is closed with. */
export const GONE: RegistryEndCause = "gone";

/** F122-FR-028 — the end cause of an entry that was adopted and stays open. */
export const ADOPTED = "adopted" as const;

/** What happened to one open `adoptable` entry at an engine start. */
export type AdoptionOutcome = {
  readonly entry: ProcessRegistry;
  /** True where the process lives and the entry was kept open. */
  readonly adopted: boolean;
  /** The end cause the entry was closed with, where it was closed. */
  readonly closedWith: string | null;
  readonly identity: IdentityResult;
};

/** What the whole adoption pass did. */
export type AdoptionResult = {
  readonly outcomes: readonly AdoptionOutcome[];
  readonly adopted: readonly ProcessRegistry[];
  readonly closedAsGone: readonly ProcessRegistry[];
  /** F122-FR-028 — an adoption never signals anything. */
  readonly signalsSent: 0;
};

/**
 * F122-FR-028 — the adoption pass of an engine start: check the identity of
 * every open entry of class `adoptable`, keep the entries whose process
 * lives, and close the others with the end cause `gone`.
 *
 * It SIGNALS NOTHING, and cannot: no signaller is among its arguments, and
 * `signalsSent` is the literal 0 in its type.
 */
export function adoptOpenAdoptableEntries(
  place: ProcsPlace,
  dependencies: IdentityDependencies & { readonly writer?: string; readonly clock?: Clock } = {},
): AdoptionResult {
  const writer = dependencies.writer ?? "engine";
  const clock = dependencies.clock ?? systemClock;
  const outcomes: AdoptionOutcome[] = [];
  const adopted: ProcessRegistry[] = [];
  const closedAsGone: ProcessRegistry[] = [];

  for (const entry of readOpenEntriesOfClass(place, "adoptable")) {
    const identity = checkIdentity(entry, dependencies);
    if (identity.matches) {
      adopted.push(entry);
      outcomes.push(Object.freeze({ entry, adopted: true, closedWith: null, identity }));
      continue;
    }
    closeEntry(place, writer, entry, GONE, clock);
    closedAsGone.push(entry);
    outcomes.push(Object.freeze({ entry, adopted: false, closedWith: GONE, identity }));
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    adopted: Object.freeze(adopted),
    closedAsGone: Object.freeze(closedAsGone),
    signalsSent: 0,
  });
}

/* ------------------------------------------------------------------ *
 * Ending one, which takes an explicit request and nothing else.
 * ------------------------------------------------------------------ */

/** The field of a stop request that ends jobs, and the only one (annex B §B.11). */
export const THE_FIELD_THAT_ENDS_A_JOB = "jobs" as const;

/**
 * F122-FR-028 — may a process of class `adoptable` be ended? Only on an
 * explicit request, which is the field `jobs` of a stop request. `now` does
 * not do it, the mode does not do it, and neither does the end of the root:
 * this function reads one field and nothing else.
 */
export function mayEndAnAdoptableProcess(
  request: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return request?.[THE_FIELD_THAT_ENDS_A_JOB] === true;
}

/** What ending the jobs did. */
export type EndJobsResult = {
  /** False where the request did not carry `jobs`; then nothing was done. */
  readonly requested: boolean;
  readonly signalsSent: number;
  readonly ended: readonly string[];
  readonly mismatches: readonly MismatchRecord[];
};

/**
 * F122-FR-028 — end the open `adoptable` jobs of a run, on the explicit
 * request. Without the field `jobs` nothing is read, nothing is signalled and
 * nothing is closed; the refusal is the first line of the function, so no
 * later branch can reach a signal.
 */
export function endAdoptableJobs(
  place: ProcsPlace,
  request: Readonly<Record<string, unknown>> | null | undefined,
  signal: GroupSignal = "terminate",
  dependencies: IdentityDependencies & {
    readonly signaller?: Signaller;
    readonly writer?: string;
    readonly clock?: Clock;
  } = {},
): EndJobsResult {
  if (!mayEndAnAdoptableProcess(request)) {
    return Object.freeze({
      requested: false,
      signalsSent: 0,
      ended: Object.freeze([]),
      mismatches: Object.freeze([]),
    });
  }
  const signaller = dependencies.signaller ?? kernelSignaller;
  const writer = dependencies.writer ?? "runtime-root";
  const clock = dependencies.clock ?? systemClock;
  const ended: string[] = [];
  const mismatches: MismatchRecord[] = [];
  let signalsSent = 0;

  for (const entry of readOpenEntriesOfClass(place, "adoptable")) {
    const guarded = signalUnderTheIdentityCheck(entry, signal, { ...dependencies, signaller });
    signalsSent += guarded.signalsSent;
    if (guarded.outcome === "signalled") {
      ended.push(entry.procId);
      closeEntry(place, writer, entry, "ended-by-the-root", clock);
      continue;
    }
    if (guarded.record !== null) mismatches.push(guarded.record);
    closeEntry(place, writer, entry, "identity-mismatch", clock);
  }

  return Object.freeze({
    requested: true,
    signalsSent,
    ended: Object.freeze(ended),
    mismatches: Object.freeze(mismatches),
  });
}
