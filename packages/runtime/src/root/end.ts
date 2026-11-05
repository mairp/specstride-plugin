/**
 * T046 — the end of the runtime root: *release and removal of the marker on
 * EVERY exit path* (F122-FR-014, F122-FR-020, F122-FR-031, F122-FR-038).
 *
 * `./start.ts` takes four things: the lock, the lease, the heartbeat and the
 * advisory marker. This module gives them all back, and the hard part is not
 * what it does but WHEN. "Every exit path" is a list, not a sentiment:
 *
 *   - the work ended and the root returns normally;
 *   - the root threw, and the error reaches the top;
 *   - a promise was rejected and nothing handled it;
 *   - the consumer or a supervisor sent `SIGTERM`, `SIGINT` or `SIGHUP`;
 *   - something called `process.exit` from inside the root.
 *
 * `installTheEndOfTheRoot` covers all five. What it canNOT cover is `SIGKILL`
 * and a reboot — no handler runs for either — and that is exactly the case
 * F122-FR-031 is about: the lock is left behind, readers DERIVE `dead` from a
 * run record in a live state and a probe that says `stale-owner-dead`, and the
 * next launch reclaims and writes the synthesized closing event. So the
 * guarantee of this module is "every path the root can observe", and the
 * guarantee of F122-FR-031 is the rest. Neither pretends to be the other.
 *
 * THE ORDER OF THE RELEASE matters and is the provider's: the lock directory
 * goes first, because that is what another launch waits on; then the liveness
 * endpoint; then the marker. Before any of it the heartbeat stops, so that no
 * beat can land on a lease that is about to be released — a beat after the
 * release would recreate the lease file of a run that has ended.
 */
import process from "node:process";
import { existsSync, rmSync } from "node:fs";
import type { Lease } from "@specstride/contracts/records/lease";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import type { DirectoryLock } from "../lock/directory-lock.ts";
import { lockPathsOf, type LockPlace } from "../lock/paths.ts";
import { leasePathOf, type Heartbeat } from "../lease/lease.ts";
import { RUN_ENDED, appendEvent, type RootPlace } from "./start.ts";

/** The requirements this module carries. */
export const END_REQUIREMENTS = [
  "F122-FR-014",
  "F122-FR-020",
  "F122-FR-031",
  "F122-FR-038",
] as const;

/**
 * The exit paths the root releases on. The first is the ordinary one; the next
 * four are the ones a handler covers; the last two are named so that the list
 * is honest about what no handler can reach.
 */
export const EXIT_PATHS = [
  "a normal return",
  "an error that reached the top",
  "a rejection nothing handled",
  "a signal: SIGTERM, SIGINT or SIGHUP",
  "a call of `process.exit` from inside the root",
] as const;

/** The paths no handler can cover; F122-FR-031 covers them instead. */
export const EXIT_PATHS_NO_HANDLER_REACHES = ["SIGKILL", "a reboot"] as const;

/** The signals a handler is installed for. */
export const SIGNALS_HANDLED = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

/** F122-FR-031 — after a root was killed nothing of this feature restarts it. */
export const RESTARTS_AFTER_A_KILL = false as const;

/** What the root must give back, as `startTheRoot` handed it over. */
export type RootResources = {
  readonly where: RootPlace;
  readonly launchId: string;
  readonly provider: DirectoryLock;
  readonly lease: Lease;
  readonly heartbeat: Heartbeat;
};

/** Why the root ended; it reaches the closing event as `cause`. */
export const END_CAUSES = ["completed", "stopped", "failed", "crash", "signal"] as const;
export type EndCause = (typeof END_CAUSES)[number];

/** What the end of the root did, so that a caller can read it back. */
export type EndOutcome = {
  readonly heartbeatStopped: boolean;
  readonly lockReleased: boolean;
  readonly markerRemoved: boolean;
  readonly leaseRemoved: boolean;
  /** The closing event, where this end wrote one. */
  readonly ended: EventEnvelope | null;
  /** The paths actually taken, in order; a test reads it. */
  readonly order: readonly string[];
};

/**
 * F122-FR-020, F122-FR-038 — end the root: stop beating, write the closing
 * event, release the lock, remove the marker and the lease.
 *
 * It is IDEMPOTENT. Three of the five exit paths can happen in a row — a throw
 * that reaches the top also ends the process, which also fires `exit` — so a
 * second call must be harmless, not a second release of a lock another launch
 * may hold by then. Every removal below is conditional on the thing being
 * there, and `release` of the provider is itself a removal of a directory that
 * tolerates absence.
 */
export async function endTheRoot(
  resources: RootResources,
  cause: EndCause = "completed",
  options: {
    readonly writeTheClosingEvent?: boolean | undefined;
    readonly now?: (() => Date) | undefined;
  } = {},
): Promise<EndOutcome> {
  const order: string[] = [];

  // 1 — the heartbeat, before anything is given back.
  const alreadyStopped = resources.heartbeat.stopped;
  resources.heartbeat.stop();
  if (!alreadyStopped) order.push("heartbeat stopped");

  // 2 — the closing event. Every event that opens something has a matching
  // event that closes it (F100-FR-200), and `run.launched` of step 3 is what
  // this closes. It is written BEFORE the release: after the release another
  // launch may own the workspace, and its first act is to look for an
  // unclosed run.
  let ended: EventEnvelope | null = null;
  if (options.writeTheClosingEvent !== false && !alreadyStopped) {
    ended = appendEvent({
      where: resources.where,
      type: RUN_ENDED,
      launchId: resources.launchId,
      data: { cause },
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    order.push("closing event written");
  }

  // 3 — the lock, the endpoint and the marker, in the provider's order.
  const paths = lockPathsOf(resources.where.place);
  await resources.provider.release(resources.lease);
  order.push("lock released");
  // The marker is removed HERE and not only by the provider. EP-13 is an open
  // registry: the shipped provider happens to remove `workspace:active` in its
  // own `release`, but the marker is feature 122's record and not EP-13's, so a
  // consumer's provider has no reason to touch it. Without this line such a
  // workspace would keep a marker naming a run that has ended, and F122-FR-038
  // would hold for the shipped provider only.
  const markerRemoved = removeIfThere(paths.advisoryMarkerFile);
  if (markerRemoved) order.push("marker removed");

  // 4 — the published lease. A lease left behind would say a dead owner holds
  // this run; `validUntil` would expire and readers would derive `stale` of a
  // run that ENDED. The run record, not the lease, is where an ended run is
  // read from.
  const leaseRemoved = removeIfThere(leasePathOf(resources.where));
  if (leaseRemoved) order.push("lease removed");

  return Object.freeze({
    heartbeatStopped: true,
    lockReleased: !existsSync(paths.lockDirectory),
    markerRemoved: !existsSync(paths.advisoryMarkerFile),
    leaseRemoved: !existsSync(leasePathOf(resources.where)),
    ended,
    order: Object.freeze(order),
  });
}

/** Remove a file that may not be there. True where one was removed. */
function removeIfThere(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true, recursive: true });
  return true;
}

/** What `installTheEndOfTheRoot` hands back, so a caller can take it off again. */
export type InstalledEnd = {
  /** End the root now, by hand. */
  end(cause?: EndCause): Promise<EndOutcome>;
  /** Take the handlers off; for a test, and for a root that hands over. */
  uninstall(): void;
  /** The handlers that are on, by name. */
  readonly installed: readonly string[];
};

/**
 * F122-FR-020 — install the release on every exit path the root can observe.
 *
 * The signal handlers end the root and then re-raise the signal with the
 * default disposition, so that the root's own exit status still says it was
 * signalled: a root that swallowed `SIGTERM` and exited 0 would tell a
 * supervisor the run finished.
 */
export function installTheEndOfTheRoot(
  resources: RootResources,
  options: {
    readonly on?: NodeJS.Process | undefined;
    /** For a test: what to do instead of re-raising a signal. */
    readonly afterASignal?: ((signal: NodeJS.Signals) => void) | undefined;
  } = {},
): InstalledEnd {
  const on = options.on ?? process;
  const installed: string[] = [];
  let done = false;

  const end = async (cause: EndCause = "completed"): Promise<EndOutcome> => {
    const outcome = await endTheRoot(resources, cause);
    done = true;
    return outcome;
  };

  // `exit` is synchronous: no promise settles after it. The release of the
  // marker, the lease and the lock directory is synchronous too — only
  // `provider.release` is a promise, and what it awaits is the close of the
  // liveness endpoint, which the kernel closes with the process anyway. So the
  // handler does the synchronous part and the kernel does the rest.
  const onExit = (): void => {
    if (done) return;
    resources.heartbeat.stop();
    const paths = lockPathsOf(resources.where.place);
    removeIfThere(paths.lockDirectory);
    removeIfThere(paths.advisoryMarkerFile);
    removeIfThere(leasePathOf(resources.where));
    done = true;
  };
  on.on("exit", onExit);
  installed.push("exit");

  const onSignal = (signal: NodeJS.Signals): void => {
    void end("signal").then(() => {
      if (options.afterASignal !== undefined) {
        options.afterASignal(signal);
        return;
      }
      // The default disposition, so the exit status still names the signal.
      on.removeListener(signal, onSignal);
      on.kill(on.pid, signal);
    });
  };
  for (const signal of SIGNALS_HANDLED) {
    on.on(signal, onSignal);
    installed.push(signal);
  }

  const onError = (): void => {
    if (done) return;
    void end("crash");
  };
  on.on("uncaughtException", onError);
  on.on("unhandledRejection", onError);
  installed.push("uncaughtException", "unhandledRejection");

  return Object.freeze({
    end,
    uninstall(): void {
      on.removeListener("exit", onExit);
      for (const signal of SIGNALS_HANDLED) on.removeListener(signal, onSignal);
      on.removeListener("uncaughtException", onError);
      on.removeListener("unhandledRejection", onError);
    },
    get installed(): readonly string[] {
      return Object.freeze([...installed]);
    },
  });
}

/**
 * F122-FR-031 — what a reader derives after the root was killed, and what the
 * next launch does. Stated here as data because this module is the one that
 * knows what it could NOT release.
 */
export const AFTER_A_KILL = Object.freeze({
  nothingRestartsTheRun: true as const,
  readersDerive: "dead" as const,
  derivedFrom: "a run record in a live state and a probe that says `stale-owner-dead`" as const,
  theNextLaunchReclaims: true as const,
  andWritesFirst: "the synthesized closing event of the dead launch" as const,
});

/** The place of the lock, re-exported so a caller need not reach past this. */
export type { LockPlace };
