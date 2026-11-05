/**
 * T039 — CT-122-31 and CT-122-32: the runtime root dies, and the machine sleeps
 * (F122-FR-031, F122-FR-032, F122-FR-014).
 *
 * **CT-122-31** is the whole of F122-FR-031, in order: *when the runtime root
 * dies or the machine reboots, nothing of this feature MUST relaunch the run by
 * itself. Readers MUST derive `dead` from a run record in a live state and a
 * probe that says `stale-owner-dead`; no process writes `dead`. The next launch
 * or `resume` MUST reclaim the lock and, as the first writer of the event file,
 * MUST write the closing event of the dead launch, `run.ended` marked as
 * synthesized, before any other event.*
 *
 * The root is a REAL process of its own, killed without warning, because that is
 * the only way "nothing of the product runs" can be true. Nothing is simulated,
 * and three things are read back off the disk afterwards: that the lock is still
 * there (a killed process releases nothing), that a reader derives `dead`
 * without anything having written the word, and that the event file of the next
 * launch begins with the synthesized closing event of the dead one.
 *
 * **CT-122-32** is F122-FR-032: *no wait of the runtime root MUST depend on a
 * timer that ran through a sleep of the machine. After a gap in its heartbeats
 * the runtime root MUST write a heartbeat at once and MUST compute every
 * remaining wait from the times recorded on disk.* A sleep of the machine cannot
 * be caused in a test, so it is caused where it is observable: the clock the
 * lease reads is moved forward past several intervals, which is exactly what a
 * process sees when it wakes. The heartbeat must then be written AT ONCE, the
 * owner must NOT read as dead, and the next wait must be computed from the time
 * just recorded.
 *
 * HOST SAFETY. Every signal here names ONE process id through the helper that
 * refuses an id that is not an integer above one (the owner's ruling of
 * 2026-10-02). No group is signalled anywhere in this file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { SYNTHESIZED_FIELD } from "@specstride/contracts/envelope/event";
import { derivedCondition, statusLineIsStale } from "@specstride/contracts/records/lease";
import { AFTER_A_KILL, endTheRoot, installTheEndOfTheRoot } from "../../src/root/end.ts";
import {
  DEAD_IS_WRITTEN_BY_A_PROCESS,
  RELAUNCHES_BY_ITSELF,
  RUN_ENDED,
  RUN_LAUNCHED,
  deadPredecessorOf,
  eventsPathOf,
  readEvents,
  startTheRoot,
  type RootPlace,
} from "../../src/root/start.ts";
import {
  GRACE_SECONDS,
  HEARTBEAT_EVERY_SECONDS,
  beat,
  gapSinceTheHeartbeat,
  heartbeatIsOld,
  leasePathOf,
  readTheLease,
  remainingWaitMsFrom,
  startHeartbeat,
  validUntilOf,
  writeTheLease,
} from "../../src/lease/lease.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { lockPathsOf } from "../../src/lock/paths.ts";
import { probeLock } from "../../src/lock/probe.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import { spawnLockOwner } from "../helpers/lock-owner.ts";

const SLUG = "122-detached-runtime";
const RUN = "run-crash";

type Scratch = {
  readonly place: { controlRoot: string; workspaceRealPath: string };
  readonly where: RootPlace;
  readonly runtimeDirectory: string;
  dispose(): void;
};

function scratch(label: string): Scratch {
  const controlRoot = mkdtempSync(join(tmpdir(), `crash-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `crash-${label}-w-`));
  const runtimeDirectory = mkdtempSync(join(tmpdir(), `crash-${label}-r-`));
  const place = { controlRoot, workspaceRealPath };
  return {
    place,
    where: { place, slug: SLUG, runId: RUN },
    runtimeDirectory,
    dispose(): void {
      for (const path of [controlRoot, workspaceRealPath, runtimeDirectory]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * CT-122-31 — the root was killed.
 * ------------------------------------------------------------------ */

test("CT-122-31: after the root was killed nothing restarts, readers derive `dead`, and the next launch reclaims and writes the synthesized closing event FIRST (F122-FR-031)", async () => {
  const s = scratch("root-dies");
  let owner: Awaited<ReturnType<typeof spawnLockOwner>> | null = null;
  let next: Awaited<ReturnType<typeof startTheRoot>> | null = null;
  try {
    // A real root of a real launch, in a process of its own.
    owner = await spawnLockOwner({
      controlRoot: s.place.controlRoot,
      workspaceRealPath: s.place.workspaceRealPath,
      runtimeDirectory: s.runtimeDirectory,
      runId: RUN,
      launchId: "launch-dead",
      launchNonce: "nonce-dead",
    });
    assert.equal(owner.ready.acquired, true, "the first root took the lock");

    // It also publishes its lease, as step 3 does, so that a reader has the
    // record §B.8 gives it.
    writeTheLease({
      where: s.where,
      launchId: "launch-dead",
      launchNonce: "nonce-dead",
      owner: buildOwnerRecord({
        launchId: "launch-dead",
        runTokenHash: "dead-token-hash",
        pid: owner.pid,
      }),
      leaseTokenHash: "dead-lease-hash",
    });

    const killedPid = owner.pid;
    await owner.kill();
    owner = null;

    // 1 — a killed process releases NOTHING. The lock is still on disk.
    assert.equal(
      existsSync(lockPathsOf(s.place).lockDirectory),
      true,
      "the lock of the dead root is still there: nothing of the product ran when it died",
    );

    // 2 — nothing restarts the run by itself. Read as a fact of this module and
    // as a fact of the disk: no second lease, no event, no new launch record
    // appeared in the time it took the probe to run.
    assert.equal(RELAUNCHES_BY_ITSELF, false);
    assert.equal(AFTER_A_KILL.nothingRestartsTheRun, true);
    const before = readEvents(s.where).length;
    await new Promise((done) => setTimeout(done, 250));
    assert.equal(readEvents(s.where).length, before, "no event appeared by itself");

    // 3 — readers DERIVE `dead`: a run record in a live state plus a probe that
    // says `stale-owner-dead`. The probe is taken for real.
    const probed = await probeLock(s.place);
    assert.equal(
      probed.result,
      "stale-owner-dead",
      "the probe says the owner of the lock is dead and nothing it owned is left",
    );
    assert.equal(
      derivedCondition({
        runStateIsLive: true,
        ownerIsLive: false,
        heartbeatIsOld: false,
        newestEventIsOld: false,
      }),
      "dead",
      "a reader derives `dead` from a live run state and a lease with no live owner",
    );
    // And nobody wrote the word. The whole control root is read for it.
    assert.equal(DEAD_IS_WRITTEN_BY_A_PROCESS, false);
    const leaseText = readFileSync(leasePathOf(s.where), "utf8");
    assert.equal(leaseText.includes('"dead"'), false, "`dead` is nowhere in the lease");
    assert.equal(
      existsSync(eventsPathOf(s.where)),
      false,
      "and no event file was written at all: `dead` is derived, never recorded",
    );
    // The dead owner the next launch will close is found by reading the lock.
    const predecessor = deadPredecessorOf(s.place, probed.result);
    assert.notEqual(predecessor, null);
    assert.equal(
      predecessor?.launchId,
      "launch-dead",
      "the predecessor is named by the lease INSIDE the dead lock, not by this launch",
    );
    assert.equal(predecessor?.probe, "stale-owner-dead");

    // 4 — the next launch reclaims and writes the synthesized closing event
    // BEFORE any other event.
    const token = mintRunToken();
    next = await startTheRoot({
      where: s.where,
      launchId: "launch-after",
      launchNonce: "nonce-after",
      owner: buildOwnerRecord({ launchId: "launch-after", runTokenHash: token.hash }),
    });
    assert.equal(next.started, true, "the next launch reclaimed the lock");
    if (!next.started) return;
    assert.equal(next.reclaimed, true, "it reclaimed rather than acquired a free lock");
    assert.notEqual(next.closedThePredecessor, null, "it wrote the closing event");

    // Read the stream back off the disk and look at the ORDER.
    const events = readEvents(s.where);
    assert.ok(events.length >= 2, "the stream holds the closing event and the launch");
    const first = events[0] as EventEnvelope & { synthesized?: boolean };
    assert.equal(first.type, RUN_ENDED, "the FIRST event of the file closes the dead launch");
    assert.equal(
      first[SYNTHESIZED_FIELD as "synthesized"],
      true,
      "and it is marked as synthesized (F100-FR-200)",
    );
    assert.equal(first.launchId, "launch-dead", "it carries the DEAD launch's id, not the new one");
    assert.equal(first.seq, 1, "it is the first position of the stream");
    assert.equal((first.data as Record<string, unknown>).cause, "crash");
    const second = events[1] as EventEnvelope;
    assert.equal(second.type, RUN_LAUNCHED, "only then is this launch reported");
    assert.equal(second.launchId, "launch-after");
    assert.equal(second.seq, 2);
    assert.equal((second.data as Record<string, unknown>).closedThePredecessor, "launch-dead");

    // The killed process is gone, and the lock is the new root's.
    let there = true;
    try {
      process.kill(killedPid, 0);
    } catch {
      there = false;
    }
    assert.equal(there, false, "the first root is gone");
  } finally {
    if (owner !== null) await owner.kill();
    if (next !== null && next.started) {
      await endTheRoot(
        {
          where: s.where,
          launchId: "launch-after",
          provider: next.provider,
          lease: next.lease,
          heartbeat: next.heartbeat,
        },
        "completed",
      );
    }
    s.dispose();
  }
});

test("CT-122-31: the end of the root releases the lock and removes the marker on every exit path it can observe, and says which it cannot (F122-FR-020, F122-FR-031)", async () => {
  const s = scratch("exit-paths");
  try {
    const token = mintRunToken();
    const started = await startTheRoot({
      where: s.where,
      launchId: "launch-exit",
      launchNonce: "nonce-exit",
      owner: buildOwnerRecord({ launchId: "launch-exit", runTokenHash: token.hash }),
    });
    assert.equal(started.started, true);
    if (!started.started) return;

    const paths = lockPathsOf(s.place);
    assert.equal(existsSync(paths.lockDirectory), true, "the lock is held");
    assert.equal(existsSync(paths.advisoryMarkerFile), true, "the marker is there (F122-FR-038)");

    // The handlers are installed on every path the root can observe.
    const installed = installTheEndOfTheRoot(
      {
        where: s.where,
        launchId: "launch-exit",
        provider: started.provider,
        lease: started.lease,
        heartbeat: started.heartbeat,
      },
      {
        on: new (class extends (await import("node:events")).EventEmitter {
          pid = process.pid;
          kill(): void {}
        })() as unknown as NodeJS.Process,
      },
    );
    for (const name of [
      "exit",
      "SIGTERM",
      "SIGINT",
      "SIGHUP",
      "uncaughtException",
      "unhandledRejection",
    ]) {
      assert.ok(installed.installed.includes(name), `a handler is installed for ${name}`);
    }

    const outcome = await installed.end("completed");
    installed.uninstall();
    assert.equal(outcome.lockReleased, true);
    assert.equal(outcome.markerRemoved, true);
    assert.equal(existsSync(paths.lockDirectory), false, "the lock is gone");
    assert.equal(existsSync(paths.advisoryMarkerFile), false, "the marker is gone");
    assert.equal(started.heartbeat.stopped, true, "the heartbeat stopped first");
    assert.deepEqual(
      [...outcome.order].slice(0, 2),
      ["heartbeat stopped", "closing event written"],
      "the heartbeat stops before anything is given back",
    );
    assert.equal(outcome.ended?.type, RUN_ENDED);

    // A second end is harmless: three of the paths can fire in a row.
    const again = await endTheRoot(
      {
        where: s.where,
        launchId: "launch-exit",
        provider: started.provider,
        lease: started.lease,
        heartbeat: started.heartbeat,
      },
      "completed",
    );
    assert.equal(again.lockReleased, true);
    assert.equal(again.ended, null, "and it writes no second closing event");

    // And the module is honest about the two paths no handler reaches.
    const { EXIT_PATHS_NO_HANDLER_REACHES } = await import("../../src/root/end.ts");
    assert.deepEqual([...EXIT_PATHS_NO_HANDLER_REACHES], ["SIGKILL", "a reboot"]);
  } finally {
    s.dispose();
  }
});

test("CT-122-31: the end of the root removes the advisory marker ITSELF, and not only because the shipped provider happens to (F122-FR-038)", async () => {
  const s = scratch("marker");
  try {
    const token = mintRunToken();
    const started = await startTheRoot({
      where: s.where,
      launchId: "launch-marker",
      launchNonce: "nonce-marker",
      owner: buildOwnerRecord({ launchId: "launch-marker", runTokenHash: token.hash }),
    });
    assert.equal(started.started, true);
    if (!started.started) return;
    const paths = lockPathsOf(s.place);
    assert.equal(existsSync(paths.advisoryMarkerFile), true, "the marker is there");

    // A provider of another implementation of EP-13: its `release` gives the
    // LOCK back and knows nothing of `workspace:active`, which is feature 122's
    // record and not the point's. The end of the root must still remove it.
    let released = false;
    const foreignProvider = {
      ...started.provider,
      release: (): Promise<void> => {
        released = true;
        rmSync(paths.lockDirectory, { recursive: true, force: true });
        return Promise.resolve();
      },
    } as unknown as typeof started.provider;

    const outcome = await endTheRoot(
      {
        where: s.where,
        launchId: "launch-marker",
        provider: foreignProvider,
        lease: started.lease,
        heartbeat: started.heartbeat,
      },
      "completed",
    );
    assert.equal(released, true, "the foreign provider's `release` was the one that ran");
    assert.equal(outcome.markerRemoved, true);
    assert.ok(
      outcome.order.includes("marker removed"),
      "the end of the root removed the marker itself (F122-FR-038)",
    );
    assert.equal(existsSync(paths.advisoryMarkerFile), false, "and it is gone");
    assert.equal(existsSync(paths.lockDirectory), false);

    // The endpoint of the real provider is still open; give it back.
    await started.provider.release(started.lease);
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * CT-122-32 — the machine slept.
 * ------------------------------------------------------------------ */

test("CT-122-32: after a gap in the heartbeats the owner is NOT read as dead, the heartbeat is written at once, and the next wait is recomputed from the recorded time (F122-FR-032, F122-FR-014)", () => {
  const s = scratch("sleep");
  try {
    // A clock this test moves, which is what a process sees when the machine
    // wakes: the wall clock jumped and no timer fired in between.
    let nowMs = Date.parse("2026-10-02T12:00:00.000Z");
    const now = (): Date => new Date(nowMs);

    const written = writeTheLease({
      where: s.where,
      launchId: "launch-sleep",
      launchNonce: "nonce-sleep",
      owner: buildOwnerRecord({ launchId: "launch-sleep", runTokenHash: "sleep-token" }),
      leaseTokenHash: "sleep-lease",
      now,
    });
    assert.equal(
      written.lease.validUntil,
      validUntilOf(written.lease.heartbeatAt, GRACE_SECONDS),
      "`validUntil` is the heartbeat plus the grace, and nothing else (annex B, §B.8)",
    );

    // The machine sleeps for four intervals and a bit.
    const slept = (HEARTBEAT_EVERY_SECONDS * 4 + 3) * 1_000;
    nowMs += slept;

    // 1 — the heartbeat on disk is now OLD, and `validUntil` has passed.
    const stale = readTheLease(s.where);
    assert.notEqual(stale, null);
    assert.equal(
      gapSinceTheHeartbeat(String(stale?.heartbeatAt), HEARTBEAT_EVERY_SECONDS, now()),
      true,
      "a gap has opened: no timer fired for several intervals",
    );
    assert.equal(
      heartbeatIsOld(String(stale?.heartbeatAt), GRACE_SECONDS, now()),
      true,
      "and the newest heartbeat is older than the grace allows",
    );

    // 2 — an old heartbeat with a LIVE owner is `stale`, never `dead`
    // (F122-FR-014). The owner here is this very process, so it lives.
    assert.equal(
      derivedCondition({
        runStateIsLive: true,
        ownerIsLive: true,
        heartbeatIsOld: true,
        newestEventIsOld: true,
      }),
      "stale",
      "an old heartbeat with a live owner reads as `stale` and never as `dead`",
    );
    assert.notEqual(
      derivedCondition({
        runStateIsLive: true,
        ownerIsLive: true,
        heartbeatIsOld: true,
        newestEventIsOld: true,
      }),
      "dead",
    );

    // 3 — the heartbeat is written AT ONCE, and says it was after a gap.
    const one = beat(s.where, { now });
    assert.notEqual(one, null);
    assert.equal(one?.afterAGap, true, "the beat reports that it closed a gap");
    assert.equal(one?.heartbeatAt, now().toISOString(), "it was written at once, not later");
    assert.equal(one?.validUntil, validUntilOf(one?.heartbeatAt ?? "", GRACE_SECONDS));

    // 4 — and the owner is no longer read as stale at all: the record on disk
    // carries a `validUntil` in the future again.
    const fresh = readTheLease(s.where);
    assert.equal(statusLineIsStale(fresh as never, now()), false);

    // 5 — every remaining wait is computed from the time RECORDED, not from a
    // timer. The next beat is due an interval after `heartbeatAt`.
    assert.equal(one?.nextInMs, HEARTBEAT_EVERY_SECONDS * 1_000);
    assert.equal(
      remainingWaitMsFrom(String(fresh?.heartbeatAt), HEARTBEAT_EVERY_SECONDS, now()),
      HEARTBEAT_EVERY_SECONDS * 1_000,
    );
    // Half an interval later, half an interval is left — read from the disk.
    nowMs += (HEARTBEAT_EVERY_SECONDS / 2) * 1_000;
    assert.equal(
      remainingWaitMsFrom(String(fresh?.heartbeatAt), HEARTBEAT_EVERY_SECONDS, now()),
      (HEARTBEAT_EVERY_SECONDS / 2) * 1_000,
    );
    // And a wait whose time has passed is zero and never negative.
    nowMs += HEARTBEAT_EVERY_SECONDS * 10 * 1_000;
    assert.equal(
      remainingWaitMsFrom(String(fresh?.heartbeatAt), HEARTBEAT_EVERY_SECONDS, now()),
      0,
    );

    // 6 — the nonce survived every beat: a heartbeat changes the two times and
    // nothing else (F122-FR-005).
    assert.equal(String(fresh?.launchNonce), "nonce-sleep");
    assert.equal(String(fresh?.launchId), "launch-sleep");
    assert.equal(
      JSON.stringify((fresh?.owner as Record<string, unknown>) ?? {}),
      JSON.stringify((written.lease.owner as Record<string, unknown>) ?? {}),
    );
  } finally {
    s.dispose();
  }
});

test("CT-122-32: the heartbeat loop schedules every tick from the time recorded on disk, so a sleep costs one beat and not a lost schedule (F122-FR-032)", () => {
  const s = scratch("loop");
  try {
    let nowMs = Date.parse("2026-10-02T12:00:00.000Z");
    const now = (): Date => new Date(nowMs);
    // A driver this test fires by hand: no real time passes, and the delay the
    // loop asked for is recorded so the schedule can be read.
    const asked: number[] = [];
    const scheduled: (() => void)[] = [];
    const fire = (): void => {
      const next = scheduled.pop();
      assert.notEqual(next, undefined, "a tick was scheduled");
      next?.();
    };
    const driver = {
      setTimer: (f: () => void, ms: number): unknown => {
        asked.push(ms);
        scheduled.push(f);
        return asked.length;
      },
      clearTimer: (): void => {
        scheduled.length = 0;
      },
    };

    writeTheLease({
      where: s.where,
      launchId: "launch-loop",
      launchNonce: "nonce-loop",
      owner: buildOwnerRecord({ launchId: "launch-loop", runTokenHash: "loop-token" }),
      leaseTokenHash: "loop-lease",
      now,
    });

    const heartbeat = startHeartbeat(s.where, { now, driver });
    // The first tick is due a full interval after the lease's own write.
    assert.deepEqual(asked, [HEARTBEAT_EVERY_SECONDS * 1_000]);

    // The machine sleeps through three intervals; then the timer fires.
    nowMs += HEARTBEAT_EVERY_SECONDS * 3 * 1_000;
    fire();
    assert.equal(heartbeat.beats.length, 1, "one beat, written at once");
    assert.equal(heartbeat.beats[0]?.afterAGap, true);
    // And the NEXT tick is a full interval from the time just recorded — not
    // three intervals' worth of catching up.
    assert.deepEqual(asked, [HEARTBEAT_EVERY_SECONDS * 1_000, HEARTBEAT_EVERY_SECONDS * 1_000]);

    // An ordinary tick, exactly on time, is not a gap.
    nowMs += HEARTBEAT_EVERY_SECONDS * 1_000;
    fire();
    assert.equal(heartbeat.beats.length, 2);
    assert.equal(heartbeat.beats[1]?.afterAGap, false, "an on-time tick is no gap");

    // A lease that was reclaimed by another launch stops the loop rather than
    // writing into a state file that is no longer this owner's.
    rmSync(leasePathOf(s.where), { force: true });
    nowMs += HEARTBEAT_EVERY_SECONDS * 1_000;
    const beforeStop = asked.length;
    fire();
    assert.equal(heartbeat.beats.length, 2, "no beat was written onto a lease that is gone");
    assert.equal(asked.length, beforeStop, "and no further tick was scheduled");

    heartbeat.stop();
    assert.equal(heartbeat.stopped, true);
  } finally {
    s.dispose();
  }
});
