/**
 * T051 — CT-122-26 and CT-122-27: the engine killed by a signal (F122-FR-026,
 * F122-FR-027, F122-SC-004).
 *
 * Quickstart scenario 7: *With the root alive: the stub harness process is
 * gone before the next engine start. With the root dead: the survivor is
 * reported, then ended by `resume`.*
 *
 * Every process here is a stub (quickstart, "Prerequisites": every scenario
 * uses stub processes) started detached, so each leads a session and a group
 * of its own and its group id is its own process id — a group the runtime
 * created, and the only kind anything here signals. The engine is killed with
 * `SIGKILL`, which runs no handler and closes no record: that is what a crash
 * does, and a polite signal would prove the wrong thing.
 *
 * The read path for "it is gone" is always the process table, read by
 * `stillRunning` below straight out of `/proc/<pid>/stat`, and never the
 * return value of the call under test.
 *
 * HOST SAFETY (the owner's ruling of 2026-10-02): this file runs inside the
 * PID namespace of `test/isolate.ts` (`npm run test:crash -w
 * @specstride/runtime`), and no group id of 0, 1 or a negative number can
 * reach a signal — the identity check refuses any recorded group that is not
 * the recorded process id, and the kernel's `signalGroup` refuses the three
 * dangerous ids underneath that.
 */
import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import {
  openEntry,
  readEntries,
  readOpenEntries,
  type ProcsPlace,
} from "../../src/procs/registry.ts";
import {
  endOwnedProcessesOfEngineStart,
  relaunchOnlyAfterTheOwnedProcessesEnded,
  OwnedProcessesStillLiveError,
} from "../../src/root/end-owned.ts";
import {
  endSurvivors,
  findSurvivors,
  reportSurvivors,
  runTokenHashesOf,
} from "../../src/procs/survivors.ts";
import { startTimeOfProcess } from "../../src/procs/platform.ts";
import { mintRunToken, RUN_TOKEN_VAR, type MintedToken } from "../../src/procs/run-token.ts";
import { makeScratchControlRoot } from "../helpers/scratch-control-root.ts";
import { spawnStubProcess, type StubProcess } from "../helpers/stub-process.ts";
import { killAndWait } from "../helpers/kill.ts";
import { readFileSync } from "node:fs";

const SLUG = "122-detached-runtime";

/**
 * Whether a process is still RUNNING, read straight out of the process table
 * and not through any module of this feature.
 *
 * `kill(pid, 0)` is not the question here. A process that has exited and has
 * not yet been collected by its parent still answers a signal of zero, and
 * every stub in this file is a child of the test runner, so each spends a
 * moment in state `Z` between its death and the runner collecting it. It runs
 * no code and holds nothing in that moment: F122-FR-042 says in so many words
 * that such a process is NOT alive, so a witness built on `kill(pid, 0)`
 * would report a dead process as a survivor and make this file flaky.
 */
function stillRunning(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false; // no such process
  }
}

/** Wait until the process is no longer running, or throw. */
async function waitUntilNotRunning(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (stillRunning(pid)) {
    if (Date.now() > deadline) throw new Error(`the process ${pid} was still running`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function placeIn(controlRoot: string, runId = "run-crash"): ProcsPlace {
  return Object.freeze({ controlRoot, featureSlug: SLUG, runId });
}

/** A stub that holds the run token, in a session and a group of its own. */
async function child(token: MintedToken): Promise<StubProcess> {
  return spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: token.secret() },
    detached: true,
    ttlMs: 30_000,
  });
}

/** Record a live stub in the registry, with the identity the platform reports. */
function record(
  place: ProcsPlace,
  writer: string,
  stub: StubProcess,
  token: MintedToken,
  one: { procId: string; kind: "engine" | "harness-pass" | "worker-pass"; workerId?: string },
): void {
  const startTimeMs = startTimeOfProcess(stub.pid);
  assert.ok(startTimeMs !== null, `the platform reports the start time of ${stub.pid}`);
  assert.equal(stub.ready.pgid, stub.pid, "a detached stub leads its own group");
  openEntry(place, writer, {
    procId: one.procId,
    kind: one.kind,
    pid: stub.pid,
    processGroup: stub.pid,
    processSession: stub.pid,
    startTimeMs: startTimeMs as number,
    runTokenHash: token.hash,
    engineStartId: "es-1",
    ...(one.workerId === undefined ? {} : { workerId: one.workerId }),
  });
}

test("CT-122-26: the engine is killed and the root ends the owned process before it relaunches", async () => {
  const root = makeScratchControlRoot("crash-26");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const engine = await child(token);
  const harness = await child(token);
  try {
    record(place, "runtime-root", engine, token, { procId: "p-engine", kind: "engine" });
    record(place, "engine", harness, token, { procId: "p-harness", kind: "harness-pass" });
    assert.equal(readOpenEntries(place).length, 2);

    // The engine dies the way a crash kills one: no handler, no record closed.
    await killAndWait(engine.pid);
    assert.equal(stillRunning(engine.pid), false);
    assert.equal(stillRunning(harness.pid), true, "the harness process outlived the engine");

    // The root reacts. What the relaunch sees is the whole point, so the
    // observation is taken INSIDE the relaunch, through the process table.
    let relaunchSaw: { harnessAlive: boolean } | null = null;
    const result = await relaunchOnlyAfterTheOwnedProcessesEnded(
      place,
      "es-1",
      "signal",
      (ended) => {
        relaunchSaw = { harnessAlive: stillRunning(harness.pid) };
        return ended;
      },
      { roundWaitMs: 1_000 },
    );

    assert.ok(relaunchSaw !== null, "the relaunch ran");
    assert.equal(
      (relaunchSaw as { harnessAlive: boolean }).harnessAlive,
      false,
      "F122-SC-004: 0 processes of class `owned` live when the next engine start begins",
    );
    assert.equal(result.noneLeft, true);

    // The records say what happened: the engine was already gone, the harness
    // was ended by the root. Read back out of the registry file.
    const all = readEntries(place);
    assert.equal(all.find((one) => one.procId === "p-engine")?.endCause, "gone");
    assert.equal(all.find((one) => one.procId === "p-harness")?.endCause, "ended-by-the-root");
    assert.equal(readOpenEntries(place).length, 0, "no entry is left open");
  } finally {
    await engine.kill();
    await harness.kill();
    root.dispose();
  }
});

test("CT-122-26: the root does not relaunch while an owned process is still there", async () => {
  const root = makeScratchControlRoot("crash-26b");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const harness = await child(token);
  try {
    record(place, "engine", harness, token, { procId: "p-harness", kind: "harness-pass" });

    let relaunched = 0;
    // A signaller that does nothing is a platform on which the ladder fails.
    await assert.rejects(
      () =>
        relaunchOnlyAfterTheOwnedProcessesEnded(
          place,
          "es-1",
          "signal",
          () => {
            relaunched += 1;
            return 0;
          },
          { roundWaitMs: 20, signaller: () => undefined },
        ),
      OwnedProcessesStillLiveError,
    );
    assert.equal(relaunched, 0, "the relaunch never ran");
    assert.equal(stillRunning(harness.pid), true);
  } finally {
    await harness.kill();
    root.dispose();
  }
});

test("CT-122-26: with four worker entries all four are ended", async () => {
  const root = makeScratchControlRoot("crash-26c");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const workers: StubProcess[] = [];
  for (let n = 1; n <= 4; n += 1) workers.push(await child(token));
  try {
    workers.forEach((worker, index) =>
      record(place, "engine", worker, token, {
        procId: `p-worker-${index + 1}`,
        kind: "worker-pass",
        workerId: `w${index + 1}`,
      }),
    );
    assert.equal(readOpenEntries(place).length, 4);
    for (const worker of workers) assert.equal(stillRunning(worker.pid), true);

    const result = await endOwnedProcessesOfEngineStart(place, "es-1", "signal", {
      roundWaitMs: 1_000,
    });

    for (const worker of workers) await waitUntilNotRunning(worker.pid);
    for (const worker of workers) {
      assert.equal(stillRunning(worker.pid), false, `worker ${worker.pid} is gone`);
    }
    assert.equal(result.ended.length, 4, "all four were ended");
    assert.equal(result.noneLeft, true);
    assert.equal(readOpenEntries(place).length, 0);
    const all = readEntries(place);
    assert.deepEqual(
      all.filter((one) => one.kind === "worker-pass").map((one) => one.endCause),
      ["ended-by-the-root", "ended-by-the-root", "ended-by-the-root", "ended-by-the-root"],
    );
    assert.deepEqual(
      all.filter((one) => one.kind === "worker-pass").map((one) => one.workerId),
      ["w1", "w2", "w3", "w4"],
    );
  } finally {
    for (const worker of workers) await worker.kill();
    root.dispose();
  }
});

test("CT-122-27: with the root gone the survivor is reported, and `resume` ends it", async () => {
  const root = makeScratchControlRoot("crash-27");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const engine = await child(token);
  const harness = await child(token);
  try {
    record(place, "runtime-root", engine, token, { procId: "p-engine", kind: "engine" });
    record(place, "engine", harness, token, { procId: "p-harness", kind: "harness-pass" });

    // The root and the engine are both gone, killed without warning. Nothing
    // closed a record: that is the state F122-FR-027 is about.
    await killAndWait(engine.pid);

    const hashes = runTokenHashesOf(place);
    assert.equal(hashes.has(token.hash), true, "the records hold the hash of the run token");

    // 1. Reported. `status` and the doctor use this call and it ends nothing.
    const report = reportSurvivors(place, hashes);
    assert.equal(report.endsNothing, true);
    const pids = report.survivors.map((one) => one.pid);
    assert.ok(pids.includes(harness.pid), "the survivor is named");
    assert.equal(pids.includes(engine.pid), false, "the dead engine is not a survivor");
    assert.ok(
      report.lines.some(
        (line) => line.includes(`pid=${harness.pid}`) && line.includes("harness-pass"),
      ),
      "the line carries the process id and the kind",
    );
    assert.equal(stillRunning(harness.pid), true, "reporting ended nothing");

    // 2. `resume` ends it: the same search, then the ending call.
    const found = findSurvivors(place, hashes);
    const ending = endSurvivors(place, found, "kill");
    await waitUntilNotRunning(harness.pid);
    assert.equal(stillRunning(harness.pid), false, "the survivor is gone");
    assert.ok(ending.ended.includes(harness.pid));
    assert.equal(ending.signalsSent >= 1, true);

    // And nothing survives a second search.
    assert.deepEqual(
      [...findSurvivors(place, runTokenHashesOf(place))].map((o) => o.pid),
      [],
    );
  } finally {
    await engine.kill();
    await harness.kill();
    root.dispose();
  }
});

test("CT-122-27: a survivor of an earlier launch is found by the hash the records kept", async () => {
  const root = makeScratchControlRoot("crash-27b");
  const place = placeIn(root.path);
  const older = mintRunToken();
  const current = mintRunToken();
  const leftOver = await child(older);
  try {
    // The entry of the earlier launch was closed when its engine ended, but
    // F122-FR-024 keeps its hash in the records, so the process is still
    // recognisable — and it has no OPEN entry, which is the hard case.
    const entry = openEntry(place, "runtime-root", {
      procId: "p-older",
      kind: "harness-pass",
      pid: leftOver.pid,
      processGroup: leftOver.pid,
      processSession: leftOver.pid,
      startTimeMs: startTimeOfProcess(leftOver.pid) ?? 0,
      runTokenHash: older.hash,
      engineStartId: "es-0",
    });
    const { closeEntry } = await import("../../src/procs/registry.ts");
    closeEntry(place, "runtime-root", entry, "exited");
    openEntry(place, "runtime-root", {
      procId: "p-now",
      kind: "engine",
      pid: process.pid,
      processGroup: process.pid,
      processSession: process.pid,
      startTimeMs: startTimeOfProcess(process.pid) ?? 0,
      runTokenHash: current.hash,
      engineStartId: "es-1",
    });
    assert.equal(
      readOpenEntries(place).some((one) => one.pid === leftOver.pid),
      false,
    );

    const hashes = runTokenHashesOf(place);
    assert.equal(hashes.has(older.hash), true, "the hash of the earlier launch is kept");
    const found = findSurvivors(place, hashes);
    assert.ok(
      found.some((one) => one.pid === leftOver.pid),
      "the process of the earlier launch is recognised",
    );
    const survivor = found.find((one) => one.pid === leftOver.pid);
    assert.equal(survivor?.entry, null, "it has no open entry");
    assert.equal(survivor?.runTokenHash, older.hash);

    const ending = endSurvivors(
      place,
      found.filter((one) => one.pid === leftOver.pid),
      "kill",
    );
    await waitUntilNotRunning(leftOver.pid);
    assert.equal(stillRunning(leftOver.pid), false);
    assert.ok(ending.ended.includes(leftOver.pid));
  } finally {
    await leftOver.kill();
    root.dispose();
  }
});

test("CT-122-27: `resume` ends the survivors but never a live `adoptable` job", async () => {
  const root = makeScratchControlRoot("crash-27c");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const harness = await child(token);
  const detachedJob = await child(token);
  try {
    record(place, "engine", harness, token, { procId: "p-harness", kind: "harness-pass" });
    // The detached job of an accepted yield: the one class that survives
    // (F122-FR-027: *end the survivors that are not live entries of class
    // `adoptable`*; F122-FR-028).
    openEntry(place, "engine", {
      procId: "p-job",
      kind: "detached-job",
      pid: detachedJob.pid,
      processGroup: detachedJob.pid,
      processSession: detachedJob.pid,
      startTimeMs: startTimeOfProcess(detachedJob.pid) ?? 0,
      runTokenHash: token.hash,
      engineStartId: "es-1",
      jobId: "job-1",
    });

    const hashes = runTokenHashesOf(place);
    const found = findSurvivors(place, hashes);
    assert.deepEqual(
      found.map((one) => one.class).sort(),
      ["adoptable", "owned"],
      "both are survivors, of different classes",
    );

    const ending = endSurvivors(place, found, "kill");
    await waitUntilNotRunning(harness.pid);

    assert.equal(stillRunning(harness.pid), false, "the `owned` survivor is ended");
    assert.equal(stillRunning(detachedJob.pid), true, "the `adoptable` job is NOT");
    assert.deepEqual([...ending.ended], [harness.pid]);
    assert.deepEqual([...ending.adopted], [detachedJob.pid]);
    assert.equal(ending.signalsSent, 1, "exactly one group was signalled");
    assert.equal(
      ending.outcomes.find((one) => one.survivor.pid === detachedJob.pid)?.reason,
      "adoptable",
    );
    assert.equal(
      ending.outcomes.find((one) => one.survivor.pid === detachedJob.pid)?.signalsSent,
      0,
      "and nothing was sent at it",
    );
    // Its entry is still open, so the next engine start can adopt it.
    assert.deepEqual(
      readOpenEntries(place).map((one) => one.procId),
      ["p-job"],
    );
  } finally {
    await harness.kill();
    await detachedJob.kill();
    root.dispose();
  }
});
