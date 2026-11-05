/**
 * T042 — the lease of the runtime root (F122-FR-005, F122-FR-008,
 * F122-FR-014, F122-FR-032; annex B, §B.8).
 *
 * Four things, and they are the four the task names:
 *
 *   1. **write with the launch nonce** — `writeTheLease` publishes the record
 *      of §B.8 at the logical name `run:<runId>:lease`, carrying the launch
 *      nonce of the launch record of this launch. This is the ONE thing the
 *      CLI's bounded wait looks for (F100-FR-160: *readiness is confirmed by
 *      the lease that carries the launch nonce, whatever the detach
 *      strategy*), so it is also the one thing that must not be written by
 *      anyone but the owner.
 *   2. **heartbeat at the interval** — `startHeartbeat` writes one every
 *      `heartbeatEverySeconds`.
 *   3. **`validUntil`** — heartbeat plus grace, through the single formula of
 *      `./timing.ts`.
 *   4. **heartbeat at once after a gap** — F122-FR-032. The timer is never
 *      trusted: every tick reads the heartbeat time BACK OFF THE DISK and
 *      asks whether a gap has opened. Where one has, the heartbeat is written
 *      at once and the interval is measured again from the recorded time. A
 *      machine that slept through four ticks therefore wakes with one
 *      immediate write and a lease whose `validUntil` lies in the future,
 *      which is exactly what keeps readers from deriving `dead` for a run
 *      that is perfectly alive.
 *
 * WHY THE LEASE IS PUBLISHED AND NOT ONLY HELD. The shipped lock provider
 * keeps a copy of the lease INSIDE the lock directory, because EP-13 says a
 * lock never exists without its owner record and the lease travels with it.
 * That copy is the provider's own, and the inside of the lock is EP-13's
 * business (`../lock/paths.ts`). §B.8 gives the lease a logical name of its
 * own, `run:<runId>:lease`, whose writer is the runtime root and whose readers
 * are the engine, the CLI, RunView and the doctor. This module writes THAT
 * one. A reader of a run never opens the lock directory, and re-attachment
 * stays reading (F122-FR-008).
 */
import { readFileSync } from "node:fs";
import { atomicWriteJson } from "@specstride/kernel";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import {
  LOGICAL_NAME as LEASE_LOGICAL_NAME,
  SCHEMA_ID as LEASE_SCHEMA_ID,
  isLease,
  statusLineIsStale,
  tryReadLease,
  type Lease,
} from "@specstride/contracts/records/lease";
import { FILE_MODE } from "../root/control-root.ts";
import { GRACE_FIELD, SHIPPED_PROVIDER_ID } from "../lock/directory-lock.ts";
import type { LockPlace } from "../lock/paths.ts";
import type { OwnerRecord } from "../lock/owner-record.ts";
import {
  GRACE_SECONDS,
  HEARTBEAT_EVERY_SECONDS,
  gapSinceTheHeartbeat,
  heartbeatIsOld,
  leaseTimes,
  remainingWaitMsFrom,
  validUntilOf,
  type LeaseTimes,
} from "./timing.ts";

export {
  LEASE_LOGICAL_NAME,
  LEASE_SCHEMA_ID,
  GRACE_SECONDS,
  HEARTBEAT_EVERY_SECONDS,
  gapSinceTheHeartbeat,
  heartbeatIsOld,
  leaseTimes,
  remainingWaitMsFrom,
  validUntilOf,
};
export type { Lease, LeaseTimes };

/** The requirements this module carries. */
export const LEASE_REQUIREMENTS = [
  "F122-FR-005",
  "F122-FR-008",
  "F122-FR-014",
  "F122-FR-032",
] as const;

/** §B.8 — the writer of `run:<runId>:lease`, and the only one (F100-FR-051). */
export const LEASE_WRITER = "the runtime root (the engine in start mode `standalone`)" as const;

/** F122-FR-014 — liveness is never written as an event. */
export const LIVENESS_IS_AN_EVENT = false as const;

/** Which run a lease belongs to, and where its control root is. */
export type LeasePlace = {
  readonly place: LockPlace;
  /** The feature slug of the run, which `run:<runId>:lease` is keyed by. */
  readonly slug: string;
  readonly runId: string;
};

/**
 * The path of `run:<runId>:lease` (annex B, §B.5). Never written out as a
 * literal: the layout table says where it is, and a change of the table moves
 * this file with it.
 */
export function leasePathOf(where: LeasePlace): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: where.place.workspaceRealPath,
    workspaceId: "",
    controlRoot: where.place.controlRoot,
    workerRoot: "",
  });
  return resolve(LEASE_LOGICAL_NAME, { "<slug>": where.slug, "<runId>": where.runId }, roots);
}

/** What the owner brings to its lease (§B.8). */
export type WriteLeaseInput = {
  readonly where: LeasePlace;
  readonly launchId: string;
  /** F122-FR-005 — the launch nonce of the launch record of THIS launch. */
  readonly launchNonce: string;
  readonly owner: OwnerRecord;
  readonly lockProvider?: string | undefined;
  /** The hash of the token handed down; the lease holds only the hash. */
  readonly leaseTokenHash: string;
  readonly times?: Partial<LeaseTimes> | undefined;
  readonly now?: (() => Date) | undefined;
};

/** The lease record of §B.8, built and never written. */
export function buildLease(input: WriteLeaseInput): Lease {
  const times = leaseTimes(input.times);
  const at = (input.now ?? ((): Date => new Date()))();
  const heartbeatAt = at.toISOString();
  return Object.freeze({
    schema: LEASE_SCHEMA_ID,
    runId: input.where.runId,
    launchId: input.launchId,
    launchNonce: input.launchNonce,
    owner: input.owner as unknown as Record<string, unknown>,
    lockProvider: input.lockProvider ?? SHIPPED_PROVIDER_ID,
    heartbeatAt,
    heartbeatEverySeconds: times.heartbeatEverySeconds,
    validUntil: validUntilOf(heartbeatAt, times.graceSeconds),
    [GRACE_FIELD]: times.graceSeconds,
    leaseTokenHash: input.leaseTokenHash,
  }) as unknown as Lease;
}

/** A record that does not validate against `specstride.lease/1`. */
export class LeaseRefusedError extends Error {
  readonly logicalName = LEASE_LOGICAL_NAME;
  constructor(detail: string) {
    super(`the lease of \`${LEASE_LOGICAL_NAME}\` was refused: ${detail}`);
    this.name = "LeaseRefusedError";
  }
}

/**
 * F122-FR-005 — write the lease with the launch nonce. The record is validated
 * against the schema of feature 100 BEFORE it reaches the disk, because a
 * lease is what every reader of the run trusts, and a lease that does not
 * validate would be read as *no lease*, which is `dead`.
 *
 * The write is atomic (the kernel's): a reader that looks while the owner
 * writes sees the old lease or the new one and never half of either.
 */
export function writeTheLease(input: WriteLeaseInput): { lease: Lease; path: string } {
  const lease = buildLease(input);
  if (!isLease(lease)) {
    const read = tryReadLease(lease);
    throw new LeaseRefusedError(read.ok ? "it does not validate" : read.error.message);
  }
  const path = leasePathOf(input.where);
  atomicWriteJson(path, lease, { mode: FILE_MODE, createDirectory: true });
  return { lease, path };
}

/** The published lease of a run as it lies on disk, or `null` (F122-FR-008). */
export function readTheLease(where: LeasePlace): Lease | null {
  return readLeaseAt(leasePathOf(where));
}

/** The published lease at a path, or `null` where there is none to read. */
export function readLeaseAt(path: string): Lease | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A torn read of a non-atomic writer, or a file that is not a lease.
    return null;
  }
  const read = tryReadLease(parsed);
  return read.ok ? read.record : null;
}

/** The grace a lease was written with; the shipped default where it has none. */
export function graceOf(lease: Lease): number {
  const value = (lease as unknown as Record<string, unknown>)[GRACE_FIELD];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : GRACE_SECONDS;
}

/**
 * F100-FR-160 — true when this lease confirms readiness for a launch: it
 * carries that launch's nonce. Asked of the lease and not of the strategy,
 * whatever the strategy was.
 */
export function leaseCarriesTheNonce(lease: Lease | null, launchNonce: string): boolean {
  return lease !== null && String(lease.launchNonce) === String(launchNonce);
}

/* ------------------------------------------------------------------ *
 * The heartbeat.
 * ------------------------------------------------------------------ */

/** One beat: what was written, and whether a gap made it happen at once. */
export type Beat = {
  readonly lease: Lease;
  readonly heartbeatAt: string;
  readonly validUntil: string;
  /** F122-FR-032 — this beat was written at once because a gap had opened. */
  readonly afterAGap: boolean;
  /** Milliseconds until the next beat, computed from `heartbeatAt` on disk. */
  readonly nextInMs: number;
};

/**
 * F122-FR-014, F122-FR-032 — write one heartbeat into the published lease and
 * say when the next one is due.
 *
 * Everything here is read off the disk first. The lease on disk is the state;
 * what this process remembers is not. That is what makes the answer survive a
 * sleep of the machine, a reclaim by another launch, and a heartbeat written
 * by a predecessor.
 *
 * F129-FR-028 — the optional `rewriteStatusLine` hook is called with the lease
 * just written, AFTER it, at every beat. The owner of a run hands in a rewrite
 * of the precomputed status line (`../state/status-line.ts`, through the
 * injected renderer of `@specstride/view`), so the line is rewritten before
 * its `validUntil` passes for as long as the lease lives. The hook runs only
 * after the lease is durably on the disk, never on a beat that wrote nothing.
 */
export function beat(
  where: LeasePlace,
  options: {
    readonly now?: (() => Date) | undefined;
    readonly rewriteStatusLine?: ((lease: Lease) => void) | undefined;
  } = {},
): Beat | null {
  const path = leasePathOf(where);
  const current = readLeaseAt(path);
  if (current === null) return null;
  const now = (options.now ?? ((): Date => new Date()))();
  const grace = graceOf(current);
  const every = current.heartbeatEverySeconds || HEARTBEAT_EVERY_SECONDS;
  const afterAGap = gapSinceTheHeartbeat(String(current.heartbeatAt), every, now);
  const heartbeatAt = now.toISOString();
  const validUntil = validUntilOf(heartbeatAt, grace);
  const next = Object.freeze({
    ...(current as unknown as Record<string, unknown>),
    heartbeatAt,
    validUntil,
  }) as unknown as Lease;
  atomicWriteJson(path, next, { mode: FILE_MODE, createDirectory: true });
  options.rewriteStatusLine?.(next);
  return Object.freeze({
    lease: next,
    heartbeatAt,
    validUntil,
    afterAGap,
    // The next beat is due an interval after the time just RECORDED, never an
    // interval after whenever a timer happens to fire (F122-FR-032).
    nextInMs: remainingWaitMsFrom(heartbeatAt, every, now),
  });
}

/** A running heartbeat, which the end of the root stops. */
export type Heartbeat = {
  /** Write one beat now, whatever the timer thinks. */
  beatNow(): Beat | null;
  /** Stop beating. Called on every exit path of the owner (F122-FR-020). */
  stop(): void;
  readonly stopped: boolean;
  /** Every beat written, in order; a test reads it. */
  readonly beats: readonly Beat[];
};

/** What a heartbeat is driven by, so that a test drives it without waiting. */
export type HeartbeatDriver = {
  readonly setTimer: (fire: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
};

/** The platform's timers, which never hold the event loop of the root open. */
export const platformHeartbeatDriver: HeartbeatDriver = Object.freeze({
  setTimer: (fire: () => void, ms: number): unknown => {
    const handle = setTimeout(fire, ms);
    // The heartbeat is not a reason for the root to stay alive; the work is.
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      (handle as { unref: () => void }).unref();
    }
    return handle;
  },
  clearTimer: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout),
});

/**
 * F122-FR-014, F122-FR-032 — the heartbeat of the owner: one write every
 * interval, and one AT ONCE after a gap.
 *
 * The loop re-reads the recorded heartbeat time at every tick and schedules
 * the next tick from it, so the schedule is derived from the disk and not
 * accumulated in this process. After a sleep the first tick finds a gap,
 * writes at once, and `afterAGap` of that beat is `true`.
 */
export function startHeartbeat(
  where: LeasePlace,
  options: {
    readonly now?: (() => Date) | undefined;
    readonly driver?: HeartbeatDriver | undefined;
    /** Called with every beat, so the root can log or test it. */
    readonly onBeat?: ((one: Beat) => void) | undefined;
  } = {},
): Heartbeat {
  const driver = options.driver ?? platformHeartbeatDriver;
  const written: Beat[] = [];
  let timer: unknown = null;
  let stopped = false;

  const beatNow = (): Beat | null => {
    if (stopped) return null;
    const one = beat(where, { ...(options.now === undefined ? {} : { now: options.now }) });
    if (one === null) return null;
    written.push(one);
    options.onBeat?.(one);
    return one;
  };

  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = driver.setTimer(tick, ms);
  };

  const tick = (): void => {
    const one = beatNow();
    // No lease to beat on: the owner no longer holds one. Stop rather than
    // spin — a lease that was reclaimed belongs to another launch now, and
    // writing into it would be a second writer of one state file.
    if (one === null) return;
    schedule(one.nextInMs);
  };

  // The first beat is the lease's own write; the loop starts an interval after
  // the time the lease on disk records, which is where `writeTheLease` left it.
  const current = readTheLease(where);
  const every = current?.heartbeatEverySeconds ?? HEARTBEAT_EVERY_SECONDS;
  const first =
    current === null
      ? every * 1_000
      : remainingWaitMsFrom(
          String(current.heartbeatAt),
          every,
          (options.now ?? ((): Date => new Date()))(),
        );
  schedule(first);

  return Object.freeze({
    beatNow,
    stop(): void {
      stopped = true;
      if (timer !== null) driver.clearTimer(timer);
      timer = null;
    },
    get stopped(): boolean {
      return stopped;
    },
    get beats(): readonly Beat[] {
      return Object.freeze([...written]);
    },
  });
}

/* ------------------------------------------------------------------ *
 * What a reader gets, and nothing more (F122-FR-008).
 * ------------------------------------------------------------------ */

/**
 * F122-FR-008 — *this feature MUST give a reader everything it needs through
 * the lease and a probe of the lock: the owner record, the time of the last
 * heartbeat, and `validUntil`.* These three, read from a file, are it.
 */
export type ReaderView = {
  readonly owner: OwnerRecord | null;
  readonly heartbeatAt: string | null;
  readonly validUntil: string | null;
  readonly launchNonce: string | null;
  /** True where `validUntil` has passed: the precomputed line is stale. */
  readonly stale: boolean;
  /** F122-FR-008 — nothing here opened a channel to the runtime root. */
  readonly openedAChannel: false;
};

/** F122-FR-008 — no operation of this feature opens a channel to a live root. */
export const OPENS_A_CHANNEL_TO_THE_RUNTIME_ROOT = false as const;

/** Read the three things a re-attaching reader needs. A read, and nothing else. */
export function readerView(where: LeasePlace, now: Date = new Date()): ReaderView {
  const lease = readTheLease(where);
  if (lease === null) {
    return Object.freeze({
      owner: null,
      heartbeatAt: null,
      validUntil: null,
      launchNonce: null,
      stale: true,
      openedAChannel: false as const,
    });
  }
  return Object.freeze({
    owner: lease.owner as unknown as OwnerRecord,
    heartbeatAt: String(lease.heartbeatAt),
    validUntil: String(lease.validUntil),
    launchNonce: String(lease.launchNonce),
    stale: statusLineIsStale(lease, now),
    openedAChannel: false as const,
  });
}
