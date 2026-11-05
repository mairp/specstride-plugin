/**
 * T066 of feature 118 — the registry entries of class `adoptable`
 * (F118-FR-031). The detached job of an accepted yield is entered in the
 * process registry `specstride.procs/1` (feature 100) with the class
 * `adoptable` and the kind `detached-job`, with its process id, process
 * group, process session, start time and run-token hash.
 *
 * A stop, `stop --now` and the end of the engine leave an `adoptable` entry
 * alive (F100-FR-064); only `stop --jobs` — an explicit request — ends it.
 * The matching rule here is the one the next engine start (T067,
 * `adopt-at-start.ts`) applies: an entry is adoptable only when its process
 * id, its start time and its run token ALL match; any other entry is treated
 * as ended and is never signalled.
 *
 * The class and the kind come from `@specstride/contracts`
 * (`PROCESS_CLASSES`, `PROCESS_KINDS`, `classOfKind`): this module does not
 * invent a spelling of either.
 */
import type { RegistryClass, RegistryEntry, RegistryIdentity } from "../ports.ts";

/** The kind of every `adoptable` entry of this feature (annex B §B.10). */
export const DETACHED_JOB_KIND = "detached-job" as const;

/** The class of a detached job in the registry (F118-FR-031). */
export const DETACHED_JOB_CLASS: RegistryClass = "adoptable";

/**
 * The stop requests that touch a run. A stop, `stop --now` and the end of
 * the engine leave an `adoptable` job alive; only `stop --jobs` ends it
 * (F118-FR-031; F100-FR-064).
 */
export type StopRequest = "stop" | "stop-now" | "stop-jobs" | "engine-end";

/** The requests that end an `adoptable` job: exactly one, `stop --jobs`. */
export const ENDS_AN_ADOPTABLE_JOB: readonly StopRequest[] = Object.freeze(["stop-jobs"]);

/** The requests that leave an `adoptable` job alive. */
export const LEAVES_AN_ADOPTABLE_JOB_ALIVE: readonly StopRequest[] = Object.freeze([
  "stop",
  "stop-now",
  "engine-end",
]);

/**
 * True when `request` ends an `adoptable` job. Only the explicit
 * `stop --jobs` does; a stop, a `stop --now` and the end of the engine do
 * not (F118-FR-031).
 */
export function stopEndsAdoptable(request: StopRequest): boolean {
  return ENDS_AN_ADOPTABLE_JOB.includes(request);
}

/**
 * The registry entry of the detached job of an accepted yield
 * (F118-FR-031): class `adoptable`, kind `detached-job`, survives the stop
 * of the run. The identity carries the process id, the process group, the
 * process session, the start time and the run-token hash.
 */
export function adoptableJobEntry(logicalName: string, identity: RegistryIdentity): RegistryEntry {
  return {
    logicalName,
    identity,
    registryClass: DETACHED_JOB_CLASS,
    survivesStop: true,
  };
}

/**
 * The observed identity of a live process, as the adoption reads it.
 */
export interface ObservedIdentity {
  readonly pid: number;
  readonly startedAtMs: number;
  readonly runTokenHash: string;
}

/**
 * The match rule of F118-FR-031: the process id, the start time AND the run
 * token of the entry must all match what is observed. A reused pid fails the
 * start-time check; a job of another run fails the run-token check; either
 * way the entry is not adoptable and is treated as ended.
 */
export function identityMatches(entry: RegistryEntry, observed: ObservedIdentity): boolean {
  return (
    entry.identity.pid === observed.pid &&
    entry.identity.startedAtMs === observed.startedAtMs &&
    entry.identity.runTokenHash === observed.runTokenHash
  );
}

/**
 * True when the entry is one this feature adopts: class `adoptable` (the
 * detached job of a yield, F118-FR-031). Anything else is not the
 * adoption's business and is left where it is.
 */
export function isAdoptableEntry(entry: RegistryEntry): boolean {
  return entry.registryClass === DETACHED_JOB_CLASS;
}
