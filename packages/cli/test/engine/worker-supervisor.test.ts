/**
 * The supervision of N workers of one group (step 2 of
 * `prompts/specstride-parallel-units.md`; F143-FR-010, F143-FR-013,
 * F143-FR-018). One module under test, real processes throughout:
 *
 *  - the worker sender and the worker guard REFUSE a live process whose
 *    recorded start time differs — A REUSED PID IS NEVER SIGNALLED, the
 *    clause of the step's gate — and a proven worker is ended THROUGH ITS
 *    OWN GROUP, so the reach covers the worker's whole tree;
 *  - the ladder stops at the polite rung where it sufficed, escalates a
 *    SIGTERM-ignoring worker to the kill, and falls to the engine's own
 *    handle where the sender refuses;
 *  - THREE STUB WORKERS RUNNING `sleep 600`, each in its own group, each
 *    under its own guard: the SIGKILL of the engine stand-in ends all three
 *    within 5 s, and the guards retire; while the engine lives, nothing is
 *    signalled;
 *  - the supervised start observes the identity ONCE, plants the guard
 *    before the record exists, and hands the registry the `owned` fields of
 *    F143-FR-010.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  platformProcessTableIo,
  processGroupOf,
  startTimeOf,
  type ProcessTableIo,
} from "@specstride/kernel";
import type { SignalRefusal, SignalSender } from "../../../core/src/pass-supervision/ports.ts";
import {
  readWorkerIdentityRecord,
  startSupervisedWorker,
  startWorkerGuard,
  startWorkerWatchdog,
  stopTheWorker,
  workerSignalSender,
  writeWorkerGuardScript,
  writeWorkerIdentityRecord,
  type WorkerIdentityRecord,
} from "../../src/engine/worker-supervisor.ts";

/* ------------------------------------------------------------------ *
 * Helpers — a worker is a REAL stub process in its own group.
 * ------------------------------------------------------------------ */

/** A stand-in engine: lives until the test kills it. */
function stubEngine(): ChildProcess & { pid: number } {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  }) as ChildProcess & { pid: number };
}

/** Kills a child that has nowhere to run, and waits for it to be dead. */
async function reap(child: ChildProcess): Promise<void> {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  // Poll rather than lean on the `exit` event alone: a child that raced it,
  // or a loop with nothing else pending, must never hang the test. A corpse
  // the runner has not reaped is a zombie — dead by every reading that
  // matters.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.pid === undefined || !alive(child.pid)) return;
    await new Promise((done) => setTimeout(done, 25));
  }
}

/**
 * A stub worker (`sleep 600`) of its own process group, as the harness
 * starts it: detached, so it LEADS the group (F143-FR-010).
 */
function stubWorker(): { pid: number; group: number; end: () => Promise<void> } {
  const child = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }) as ChildProcess & {
    pid: number;
  };
  const pid = child.pid;
  const end = async (): Promise<void> => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await reap(child);
  };
  return { pid, group: pid, end };
}

/**
 * A stub worker that holds a child of its own in its group — a shell that
 * starts a `sleep 600` beside it and writes the child's pid where the test
 * reads it. The group signal must reach BOTH.
 */
function workerWithTreeChild(dir: string): {
  pid: number;
  group: number;
  innerPid: () => number;
  end: () => Promise<void>;
} {
  const innerPidPath = join(dir, "inner.pid");
  const child = spawn("sh", ["-c", `sleep 600 & echo $! > ${JSON.stringify(innerPidPath)}; wait`], {
    detached: true,
    stdio: "ignore",
  }) as ChildProcess & { pid: number };
  const pid = child.pid;
  const innerPid = (): number => Number(readFileSync(innerPidPath, "utf8").trim());
  const end = async (): Promise<void> => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await reap(child);
  };
  return { pid, group: pid, innerPid, end };
}

/** A stub worker that IGNORES SIGTERM, alive until something kills it. */
async function stubbornWorker(): Promise<{
  pid: number;
  group: number;
  dir: string;
  end: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), "worker-stubborn-"));
  const bin = join(dir, "dsh");
  symlinkSync(process.execPath, bin);
  chmodSync(bin, 0o755);
  // The worker writes its ready file AFTER the SIGTERM handler is
  // registered, so a ready file is proof the handler is in place — no
  // timing settle, and the default disposition can never win the race.
  const readyPath = join(dir, "ready");
  const child = spawn(
    bin,
    [
      "-e",
      "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], 'r'); setInterval(() => {}, 1000)",
      readyPath,
    ],
    { detached: true, stdio: "ignore" },
  ) as ChildProcess & { pid: number };
  const pid = child.pid;
  const began = Date.now();
  while (!existsSync(readyPath) && Date.now() - began < 5_000) {
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.ok(existsSync(readyPath), "the stubborn worker installed its SIGTERM handler");
  const end = async (): Promise<void> => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await reap(child);
  };
  return { pid, group: pid, dir, end };
}

/** Whether a pid answers at all — a corpse the reaper has not collected does not count. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close >= 0 && stat.slice(close + 2).split(" ")[0] === "Z") return false;
  } catch {
    // No /proc: the kill probe above is the whole answer.
  }
  return true;
}

/** Waits until the pid is gone; true only when it is. */
async function gone(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return !alive(pid);
}

/** The start time of a live pid, as the engine records it at the start. */
function recordedStart(pid: number): number {
  const startedAtMs = startTimeOf(pid);
  assert.notEqual(startedAtMs, null, "the host answered the start time");
  return startedAtMs as number;
}

/** The target of a signal for one worker: the identity recorded at its start. */
function targetOf(pid: number, runTokenHash = "a".repeat(64)) {
  return { pid, startedAtMs: recordedStart(pid), runTokenHash, processGroup: pid };
}

/** A registry entry of one worker, as the engine registers it (F143-FR-010). */
function entryOf(record: WorkerIdentityRecord) {
  return {
    logicalName: `worker:${record.workerId}`,
    registryClass: "owned" as const,
    identity: {
      pid: record.pid,
      processGroup: record.processGroup,
      runTokenHash: record.runTokenHash,
    },
  };
}

/** A table that answers nothing, as one without the process file system does. */
function tableThatAnswersNothing(): ProcessTableIo {
  return {
    ...platformProcessTableIo,
    platform: "darwin",
    readFile: () => null,
    readDirectory: () => null,
    ownerOf: () => null,
    runPs: () => null,
  };
}

/** A sender that always refuses with one reason. */
function refusingSender(reason: SignalRefusal): SignalSender {
  return { signal: () => reason };
}

/* ------------------------------------------------------------------ *
 * The sender and the guard: a reused pid is never signalled.
 * ------------------------------------------------------------------ */

test("the worker sender never signals a pid whose start time differs from the record", async () => {
  const worker = stubWorker();
  try {
    assert.equal(processGroupOf(worker.pid), worker.pid, "the stub worker leads its own group");
    const sender = workerSignalSender(() => undefined);
    // The record names a start time one minute before the process existed:
    // whatever holds the pid NOW, it is not the process the record was
    // written for — the gate's clause.
    const reused = {
      pid: worker.pid,
      startedAtMs: recordedStart(worker.pid) - 60_000,
      runTokenHash: "a".repeat(64),
    };
    assert.equal(
      sender.signal(reused, "terminate"),
      "start-time-mismatch",
      "a reused pid is refused by the start time",
    );
    assert.ok(alive(worker.pid), "the worker holding the reused pid was not signalled");
  } finally {
    await worker.end();
  }
});

test("the worker guard never signals a worker whose start time differs from its record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-guard-reuse-"));
  const script = join(dir, "worker-guard.mjs");
  writeWorkerGuardScript(script);
  const engine = stubEngine();
  const worker = stubWorker();
  let guard: ChildProcess | undefined;
  try {
    // The guard watches an engine that will die, and holds a start time one
    // minute before the worker existed: the pid it was given names someone
    // else by now, as a reused pid does.
    guard = startWorkerGuard({
      scriptPath: script,
      enginePid: engine.pid,
      engineStartedAtMs: recordedStart(engine.pid),
      workerPid: worker.pid,
      workerStartedAtMs: recordedStart(worker.pid) - 60_000,
      workerGroup: worker.group,
      pollMs: 100,
      graceMs: 500,
    });
    await new Promise((done) => setTimeout(done, 300));
    assert.ok(alive(worker.pid), "the worker lives while its engine lives");
    process.kill(engine.pid, "SIGKILL");
    await new Promise((done) => setTimeout(done, 700));
    assert.ok(alive(worker.pid), "the guard did not signal a worker of another start time");
    assert.ok(await gone(guard.pid as number, 3_000), "the guard retired without a signal");
  } finally {
    await worker.end();
    await reap(engine);
    if (guard !== undefined) await reap(guard);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the worker sender ends a proven worker through its own group, its tree with it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-group-reach-"));
  const worker = workerWithTreeChild(dir);
  try {
    assert.equal(processGroupOf(worker.pid), worker.pid, "the worker leads its own group");
    // The child of the worker's tree is IN that group, as the shell started it.
    const began = Date.now();
    while (!existsSync(join(dir, "inner.pid")) && Date.now() - began < 2_000) {
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.ok(existsSync(join(dir, "inner.pid")), "the worker's child is up");
    const inner = worker.innerPid();
    // The registry entry is read ONCE, while the worker is alive: the sender
    // must never lean on a registry that re-reads a dead worker.
    const entry = entryOf({
      workerId: "w-1",
      pid: worker.pid,
      startedAtMs: recordedStart(worker.pid),
      processGroup: worker.group,
      runTokenHash: "a".repeat(64),
    });
    const sender = workerSignalSender(() => entry);
    const proven = targetOf(worker.pid);
    assert.equal(sender.signal(proven, "terminate"), undefined, "a proven worker is signalled");
    const leaderGone = await gone(worker.pid);
    const childGone = await gone(inner);
    assert.ok(leaderGone, "the leader of the group was ended");
    assert.ok(childGone, "the child of the worker's tree was ended by the group signal");
    // A gone worker keeps its precise refusal.
    assert.equal(sender.signal(proven, "kill"), "no-such-process");
  } finally {
    await worker.end();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the worker sender refuses what it cannot identify, and honours the registry's run token", async () => {
  const worker = stubWorker();
  try {
    // A table that answers nothing: the start time is unobservable, and an
    // unobservable process is never signalled.
    const blind = workerSignalSender(() => undefined, tableThatAnswersNothing());
    assert.equal(blind.signal(targetOf(worker.pid), "terminate"), "start-time-unobservable");
    assert.ok(alive(worker.pid), "the worker of an unreadable table was not signalled");
    // A registry entry that names another run token: refused, untouched.
    const stranger = entryOf({
      workerId: "w-9",
      pid: worker.pid,
      startedAtMs: recordedStart(worker.pid),
      processGroup: worker.group,
      runTokenHash: "b".repeat(64),
    });
    const other = workerSignalSender(() => stranger);
    assert.equal(other.signal(targetOf(worker.pid), "terminate"), "run-token-mismatch");
    assert.ok(alive(worker.pid), "a worker of another run token was not signalled");
    // And the pids that identify nothing at all.
    const sender = workerSignalSender(() => undefined);
    assert.equal(
      sender.signal({ pid: 0, startedAtMs: 0, runTokenHash: "" }, "kill"),
      "not-an-integer-above-one",
    );
    assert.equal(
      sender.signal({ pid: 1, startedAtMs: 0, runTokenHash: "" }, "kill"),
      "not-an-integer-above-one",
    );
  } finally {
    await worker.end();
  }
});

/* ------------------------------------------------------------------ *
 * The ladder: terminate, then kill, then the engine's own handle.
 * ------------------------------------------------------------------ */

test("the ladder stops at the polite rung where it sufficed", async () => {
  const worker = stubWorker();
  try {
    const stop = await stopTheWorker({
      sender: workerSignalSender(() => undefined),
      target: targetOf(worker.pid),
      graceMs: 300,
    });
    assert.equal(stop.reached, "terminate", "the polite rung sufficed for a stub worker");
    assert.deepEqual(stop.refusals, [], "the sender never refused a proven worker");
    assert.ok(await gone(worker.pid), "the worker was ended by the ladder");
  } finally {
    await worker.end();
  }
});

test("the ladder escalates a SIGTERM-ignoring worker to the kill", async () => {
  const worker = await stubbornWorker();
  try {
    const stop = await stopTheWorker({
      sender: workerSignalSender(() => undefined),
      target: targetOf(worker.pid),
      graceMs: 400,
    });
    assert.equal(stop.reached, "kill", "the kill rung was reached");
    assert.deepEqual(stop.refusals, [], "the sender never refused a proven worker");
    assert.ok(await gone(worker.pid), "the stubborn worker was ended by the ladder");
  } finally {
    await worker.end();
    rmSync(worker.dir, { recursive: true, force: true });
  }
});

test("the ladder falls to the engine's handle where the sender refuses", async () => {
  const handled: string[] = [];
  const stop = await stopTheWorker({
    sender: refusingSender("start-time-unobservable"),
    target: { pid: 424_242, startedAtMs: 1, runTokenHash: "c".repeat(64) },
    graceMs: 20,
    settleMs: async (ms) => {
      await new Promise((done) => setTimeout(done, Math.min(ms, 50)));
    },
    endTheChild: (signal) => {
      handled.push(signal);
    },
  });
  assert.equal(stop.reached, "handle", "the handle is the last rung");
  assert.deepEqual(stop.refusals, ["start-time-unobservable", "start-time-unobservable"]);
  assert.deepEqual(handled, ["SIGTERM", "SIGKILL"], "the handle ended the worker, politely first");
});

/* ------------------------------------------------------------------ *
 * Three stub workers, three guards, one SIGKILL of the engine.
 * ------------------------------------------------------------------ */

test("SIGKILL of the engine ends every worker of the group within 5 s, each by its own guard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-group-"));
  const script = join(dir, "worker-guard.mjs");
  writeWorkerGuardScript(script);
  const engine = stubEngine();
  const workers = [stubWorker(), stubWorker(), stubWorker()];
  const guards = workers.map((worker) =>
    startWorkerGuard({
      scriptPath: script,
      enginePid: engine.pid,
      engineStartedAtMs: recordedStart(engine.pid),
      workerPid: worker.pid,
      workerStartedAtMs: recordedStart(worker.pid),
      workerGroup: worker.group,
      pollMs: 100,
      graceMs: 500,
    }),
  );
  assert.equal(guards.length, 3);
  assert.ok(
    guards.every((guard) => guard?.pid !== undefined),
    "one guard stands per worker",
  );
  try {
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(
      workers.every((worker) => alive(worker.pid)),
      "all three workers live with their engine",
    );
    // SIGKILL of the engine stand-in ONLY. No resume is started, ever.
    process.kill(engine.pid, "SIGKILL");
    const began = Date.now();
    for (const worker of workers) {
      assert.ok(await gone(worker.pid, 5_000), `worker ${String(worker.pid)} ended within 5 s`);
    }
    const spentMs = Date.now() - began;
    assert.ok(spentMs <= 5_000, `all three ended in ${String(spentMs)} ms, within 5 s`);
    // The guards retire with their workers.
    for (const guard of guards) {
      assert.ok(await gone(guard?.pid as number, 3_000), "the guard retired with its worker");
    }
  } finally {
    for (const worker of workers) await worker.end();
    await reap(engine);
    for (const guard of guards) {
      if (guard !== undefined) await reap(guard);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the guards leave the workers alone while the engine lives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-group-live-"));
  const script = join(dir, "worker-guard.mjs");
  writeWorkerGuardScript(script);
  const engine = stubEngine();
  const workers = [stubWorker(), stubWorker(), stubWorker()];
  const guards = workers.map((worker) =>
    startWorkerGuard({
      scriptPath: script,
      enginePid: engine.pid,
      engineStartedAtMs: recordedStart(engine.pid),
      workerPid: worker.pid,
      workerStartedAtMs: recordedStart(worker.pid),
      workerGroup: worker.group,
      pollMs: 100,
      graceMs: 500,
    }),
  );
  try {
    await new Promise((done) => setTimeout(done, 700));
    assert.ok(
      workers.every((worker) => alive(worker.pid)),
      "a living engine holds its workers, guards and all",
    );
    assert.ok(
      guards.every((guard) => alive(guard?.pid as number)),
      "the guards stand watch",
    );
  } finally {
    for (const worker of workers) await worker.end();
    await reap(engine);
    for (const guard of guards) {
      if (guard !== undefined) await reap(guard);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * The identity record, the supervised start, and the watchdog.
 * ------------------------------------------------------------------ */

test("the identity record of a worker round-trips, and junk is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-record-"));
  const path = join(dir, "workers", "w-1.pid");
  const record: WorkerIdentityRecord = Object.freeze({
    workerId: "sess-1",
    pid: 4_194,
    startedAtMs: 1_799_000_000_000,
    processGroup: 4_194,
    runTokenHash: "d".repeat(64),
  });
  writeWorkerIdentityRecord(path, record);
  assert.deepEqual(readWorkerIdentityRecord(path), record, "the record is read back whole");
  assert.equal(readWorkerIdentityRecord(join(dir, "absent.pid")), undefined);
  writeFileSync(join(dir, "junk.pid"), "{not json");
  assert.equal(readWorkerIdentityRecord(join(dir, "junk.pid")), undefined);
  writeFileSync(
    path,
    JSON.stringify({
      workerId: "sess-1",
      pid: 0,
      startedAtMs: 1,
      processGroup: 1,
      runTokenHash: "x",
    }),
  );
  assert.equal(readWorkerIdentityRecord(path), undefined, "a pid of zero is no worker");
  assert.ok(existsSync(path));
  rmSync(dir, { recursive: true, force: true });
});

test("a supervised start observes the identity once, plants the guard, registers `owned`", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-start-"));
  const script = join(dir, "worker-guard.mjs");
  writeWorkerGuardScript(script);
  const recordPath = join(dir, "workers", "w-1.pid");
  const engine = stubEngine();
  const worker = stubWorker();
  const registered: Array<Record<string, unknown>> = [];
  try {
    const supervised = await startSupervisedWorker({
      start: async (workerId) => {
        assert.equal(workerId, "sess-1", "the worker is started under its own id");
        return {
          workerId,
          pid: worker.pid,
          processGroup: worker.group,
          runTokenHash: "e".repeat(64),
        };
      },
      workerId: "sess-1",
      enginePid: engine.pid,
      engineStartedAtMs: recordedStart(engine.pid),
      recordPath,
      guardScriptPath: script,
      guardPollMs: 100,
      guardGraceMs: 500,
      register: (entry) => {
        registered.push({ ...entry });
      },
    });
    // The observed start time is the platform's, not a clock's fallback.
    const startedAt = supervised.record.startedAtMs;
    assert.equal(startedAt, recordedStart(worker.pid), "the start time was observed once");
    assert.deepEqual(supervised.record, {
      workerId: "sess-1",
      pid: worker.pid,
      startedAtMs: startedAt,
      processGroup: worker.group,
      runTokenHash: "e".repeat(64),
    });
    // The registry is handed the fields of F143-FR-010.
    assert.deepEqual(registered, [
      {
        kind: "worker-pass",
        class: "owned",
        pid: worker.pid,
        startedAtMs: startedAt,
        runTokenHash: "e".repeat(64),
        workerId: "sess-1",
        processGroup: worker.group,
      },
    ]);
    // The record is on disk, and the guard stands beside the worker.
    assert.deepEqual(readWorkerIdentityRecord(recordPath), supervised.record);
    assert.ok(supervised.guard?.pid !== undefined, "the guard stands");
    const argv = readFileSync(`/proc/${String(supervised.guard.pid)}/cmdline`, "utf8").split("\0");
    assert.ok(argv.includes(script), "the guard runs the worker-guard script");
    assert.ok(
      argv.includes(worker.pid.toString()),
      "the guard watches this worker by pid and start time",
    );
  } finally {
    await worker.end();
    await reap(engine);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the watchdog of a worker kills a hung worker over its ceiling, through the ladder", async () => {
  const hung = stubWorker();
  const patient = stubWorker();
  try {
    const sender = workerSignalSender(() => undefined);
    const kills: string[] = [];
    const watchdog = startWorkerWatchdog({
      sender,
      target: targetOf(hung.pid),
      startedAtMs: Date.now() - 2_000, // already over its ceiling
      ceilingSec: 1,
      tickMs: 100,
      graceMs: 300,
      onKilled: (reason) => {
        kills.push(reason);
      },
    });
    const patientWatchdog = startWorkerWatchdog({
      sender,
      target: targetOf(patient.pid),
      startedAtMs: Date.now(),
      ceilingSec: 3_600,
      tickMs: 100,
      graceMs: 300,
    });
    try {
      assert.ok(await gone(hung.pid, 5_000), "the hung worker was ended");
      // The reason is told once the ladder has run — after its grace — so
      // the test waits for the telling, not for the process alone.
      const toldBy = Date.now() + 3_000;
      while (kills.length === 0 && Date.now() < toldBy) {
        await new Promise((done) => setTimeout(done, 25));
      }
      assert.deepEqual(kills, ["hard_cap"], "the watchdog named the reason");
      await new Promise((done) => setTimeout(done, 400));
      assert.ok(alive(patient.pid), "the worker under its ceiling was not touched");
      const killResult = watchdog.kill();
      assert.equal(killResult?.reason, "hard_cap", "the decision is readable after the kill");
      assert.equal(killResult?.reached, "terminate", "the ladder's reach is told with the kill");
    } finally {
      watchdog.stop();
      patientWatchdog.stop();
    }
  } finally {
    await hung.end();
    await patient.end();
  }
});
