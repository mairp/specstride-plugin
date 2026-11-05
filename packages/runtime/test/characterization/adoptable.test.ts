/**
 * T052 — CT-122-28: the detached job of an accepted yield (F122-FR-028).
 *
 * *A process of class `adoptable` MUST survive a stop, `stop --now`, the end
 * of the engine and the end of the runtime root. The next engine start MUST
 * adopt it: it checks the identity of every open entry of class `adoptable`,
 * keeps the entries whose process lives, and closes the others with the end
 * cause `gone`. An `adoptable` process MUST be ended only on an explicit
 * request, which is the field `jobs` of a stop request.*
 *
 * The case walks the life of one job: it is recorded, it lives through a
 * stop, through `stop --now`, through the end of every `owned` process of the
 * engine start and through the end of the root; the next engine start adopts
 * it; a job whose process has gone is closed as `gone`; and only a stop
 * request carrying `jobs` ends it.
 *
 * Every "it is still there" is read from the process table and every "the
 * entry says so" is read back out of the registry file.
 *
 * HOST SAFETY (the owner's ruling of 2026-10-02): the job is a stub started
 * detached, so it leads a session and a group of its own; the only group
 * signalled is its own, and the suite runs inside the PID namespace of
 * `test/isolate.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import {
  openEntry,
  readEntries,
  readOpenEntries,
  readOpenEntriesOfClass,
  type ProcsPlace,
} from "../../src/procs/registry.ts";
import {
  adoptOpenAdoptableEntries,
  endAdoptableJobs,
  mayEndAnAdoptableProcess,
  GONE,
  SURVIVES,
  THE_FIELD_THAT_ENDS_A_JOB,
} from "../../src/procs/adopt.ts";
import { StopController, stopNowUnderTheIdentityCheck } from "../../src/procs/stop-primitives.ts";
import { endOwnedProcessesOfEngineStart } from "../../src/root/end-owned.ts";
import { EXIT_PATHS } from "../../src/root/end.ts";
import { startTimeOfProcess } from "../../src/procs/platform.ts";
import { mintRunToken, RUN_TOKEN_VAR, type MintedToken } from "../../src/procs/run-token.ts";
import { makeScratchControlRoot } from "../helpers/scratch-control-root.ts";
import { spawnStubProcess, type StubProcess } from "../helpers/stub-process.ts";

const SLUG = "122-detached-runtime";

function placeIn(controlRoot: string, runId = "run-adopt"): ProcsPlace {
  return Object.freeze({ controlRoot, featureSlug: SLUG, runId });
}

/** Still running, read from the process table; a collected or zombie process is not. */
function stillRunning(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false;
  }
}

async function waitUntilNotRunning(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (stillRunning(pid)) {
    if (Date.now() > deadline) throw new Error(`the process ${pid} was still running`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

async function job(token: MintedToken): Promise<StubProcess> {
  return spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: token.secret() },
    detached: true,
    ttlMs: 30_000,
  });
}

function recordTheJob(place: ProcsPlace, stub: StubProcess, token: MintedToken): void {
  const startTimeMs = startTimeOfProcess(stub.pid);
  assert.ok(startTimeMs !== null);
  assert.equal(stub.ready.pgid, stub.pid, "a detached job leads its own group");
  openEntry(place, "engine", {
    procId: "p-job",
    kind: "detached-job",
    pid: stub.pid,
    processGroup: stub.pid,
    processSession: stub.pid,
    startTimeMs: startTimeMs as number,
    runTokenHash: token.hash,
    engineStartId: "es-1",
    jobId: "job-1",
  });
}

test("CT-122-28: a detached job survives a stop, `stop --now` and the end of the engine", async () => {
  const root = makeScratchControlRoot("adopt-28");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const detached = await job(token);
  try {
    recordTheJob(place, detached, token);
    const entry = readOpenEntriesOfClass(place, "adoptable")[0];
    assert.equal(entry?.class, "adoptable", "the detached job of a yield is `adoptable`");
    assert.deepEqual(
      [...SURVIVES],
      ["a stop", "`stop --now`", "the end of the engine", "the end of the runtime root"],
    );

    // 1. A stop. The request is written and the job is untouched.
    const stop = new StopController(root.path);
    stop.request({ by: "operator" });
    assert.equal(existsSync(stop.stopRequestPath), true);
    assert.equal(stillRunning(detached.pid), true, "the job survives a stop");

    // 2. `stop --now`. It is a forced stop of the PASS, and the pass is not
    //    the job: no entry is handed to it, so nothing is signalled.
    let signals = 0;
    const forced = stopNowUnderTheIdentityCheck(root.path, null, {
      signaller: () => (signals += 1),
    });
    assert.equal(forced.signalsSent, 0);
    assert.equal(signals, 0);
    assert.equal(stillRunning(detached.pid), true, "the job survives `stop --now`");

    // 3. The end of every `owned` process of the engine start. The job is of
    //    class `adoptable`, so it is not in the set at all.
    const ended = await endOwnedProcessesOfEngineStart(place, "es-1", "stopped", {
      signaller: () => (signals += 1),
      roundWaitMs: 20,
    });
    assert.deepEqual([...ended.outcomes], [], "no `owned` process of this start");
    assert.equal(signals, 0);
    assert.equal(stillRunning(detached.pid), true, "the job survives the end of the engine");

    // Its entry is still open through all three.
    assert.equal(readOpenEntriesOfClass(place, "adoptable").length, 1);
  } finally {
    await detached.kill();
    root.dispose();
  }
});

test("CT-122-28: a detached job survives the end of the runtime root that started it", async () => {
  const root = makeScratchControlRoot("adopt-28-root");
  const place = placeIn(root.path);
  const token = mintRunToken();

  // A stand-in for the runtime root: a real process that starts the job
  // DETACHED — a session and a group of its own — and prints its id. The
  // root is then killed without warning, which is the harshest of the exit
  // paths `end.ts` lists and the one no handler of the root can reach.
  const rootProcess = spawn(
    process.execPath,
    [
      "-e",
      `const {spawn}=require("node:child_process");` +
        `const j=spawn(process.execPath,["-e","setTimeout(()=>process.exit(0),30000)"],` +
        `{stdio:"ignore",detached:true,env:{...process.env,` +
        `${JSON.stringify(RUN_TOKEN_VAR)}:${JSON.stringify(token.secret())}}});` +
        `j.unref();process.stdout.write(String(j.pid)+"\\n");` +
        `setTimeout(()=>process.exit(0),30000);`,
    ],
    { stdio: ["ignore", "pipe", "ignore"], detached: true },
  );
  const jobPid = await new Promise<number>((done, fail) => {
    const timer = setTimeout(() => fail(new Error("the root printed no job id")), 10_000);
    rootProcess.stdout?.once("data", (chunk: Buffer) => {
      clearTimeout(timer);
      done(Number(String(chunk).trim()));
    });
  });
  rootProcess.unref();
  try {
    assert.ok(Number.isInteger(jobPid) && jobPid > 1);
    assert.equal(stillRunning(jobPid), true, "the job is up");
    assert.ok(EXIT_PATHS.length > 0, "the root has exit paths; none of them ends a job");

    const startTimeMs = startTimeOfProcess(jobPid);
    assert.ok(startTimeMs !== null);
    openEntry(place, "runtime-root", {
      procId: "p-job",
      kind: "detached-job",
      pid: jobPid,
      processGroup: jobPid,
      processSession: jobPid,
      startTimeMs: startTimeMs as number,
      runTokenHash: token.hash,
      engineStartId: "es-1",
      jobId: "job-1",
    });

    // The root dies without warning: no handler runs, nothing is released.
    const rootPid = rootProcess.pid as number;
    process.kill(rootPid, "SIGKILL");
    await waitUntilNotRunning(rootPid);

    assert.equal(stillRunning(jobPid), true, "the job survives the end of the runtime root");

    // And the next engine start adopts it rather than finding it orphaned.
    const adoption = adoptOpenAdoptableEntries(place);
    assert.equal(adoption.adopted.length, 1);
    assert.equal(adoption.signalsSent, 0);
  } finally {
    for (const pid of [jobPid, rootProcess.pid]) {
      if (typeof pid === "number" && pid > 1) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    root.dispose();
  }
});

test("CT-122-28: the next engine start adopts a job that lives", async () => {
  const root = makeScratchControlRoot("adopt-28b");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const detached = await job(token);
  try {
    recordTheJob(place, detached, token);

    const adoption = adoptOpenAdoptableEntries(place);
    assert.equal(adoption.signalsSent, 0, "an adoption signals nothing");
    assert.equal(adoption.adopted.length, 1);
    assert.equal(adoption.closedAsGone.length, 0);
    assert.equal(adoption.outcomes[0]?.identity.matches, true);
    assert.equal(stillRunning(detached.pid), true);

    // The entry is still open, read back out of the registry file.
    assert.equal(readOpenEntriesOfClass(place, "adoptable").length, 1);
    assert.equal(readEntries(place).find((one) => one.procId === "p-job")?.endCause, undefined);
  } finally {
    await detached.kill();
    root.dispose();
  }
});

test("CT-122-28: the next engine start closes the entry of a job that has gone as `gone`", async () => {
  const root = makeScratchControlRoot("adopt-28c");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const detached = await job(token);
  try {
    recordTheJob(place, detached, token);
    await detached.kill();
    await waitUntilNotRunning(detached.pid);

    const adoption = adoptOpenAdoptableEntries(place);
    assert.equal(adoption.signalsSent, 0);
    assert.equal(adoption.adopted.length, 0);
    assert.equal(adoption.closedAsGone.length, 1);

    const closed = readEntries(place).find((one) => one.procId === "p-job");
    assert.equal(closed?.endCause, GONE);
    assert.ok(typeof closed?.endedAt === "string" && closed.endedAt !== "");
    assert.equal(readOpenEntries(place).length, 0);
  } finally {
    root.dispose();
  }
});

test("CT-122-28: only a stop request with `jobs` ends a job", async () => {
  const root = makeScratchControlRoot("adopt-28d");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const detached = await job(token);
  try {
    recordTheJob(place, detached, token);
    assert.equal(THE_FIELD_THAT_ENDS_A_JOB, "jobs");

    // Everything that is NOT the field `jobs` leaves the job alone.
    for (const request of [
      null,
      undefined,
      {},
      { mode: "now" },
      { now: true },
      { jobs: false },
      { jobs: "yes" },
      { jobs: 1 },
    ]) {
      assert.equal(mayEndAnAdoptableProcess(request), false, JSON.stringify(request ?? null));
      let signals = 0;
      const result = endAdoptableJobs(place, request, "terminate", {
        signaller: () => (signals += 1),
      });
      assert.equal(result.requested, false);
      assert.equal(result.signalsSent, 0);
      assert.equal(signals, 0);
    }
    assert.equal(stillRunning(detached.pid), true, "the job is still there");
    assert.equal(readOpenEntriesOfClass(place, "adoptable").length, 1);

    // And the explicit request ends it.
    assert.equal(mayEndAnAdoptableProcess({ jobs: true }), true);
    const ended = endAdoptableJobs(place, { jobs: true }, "kill");
    assert.equal(ended.requested, true);
    assert.equal(ended.signalsSent, 1);
    await waitUntilNotRunning(detached.pid);
    assert.equal(stillRunning(detached.pid), false, "the job is gone");
    assert.deepEqual([...ended.ended], ["p-job"]);
    assert.equal(
      readEntries(place).find((one) => one.procId === "p-job")?.endCause,
      "ended-by-the-root",
    );
  } finally {
    await detached.kill();
    root.dispose();
  }
});

test("CT-122-28: a stop request that carries `jobs` is read back from the disk", () => {
  const root = makeScratchControlRoot("adopt-28e");
  try {
    const stop = new StopController(root.path);
    stop.request({ mode: "now", jobs: true, by: "operator" });
    const onDisk = JSON.parse(readFileSync(stop.stopRequestPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(onDisk["jobs"], true);
    assert.equal(stop.endsAdoptableJobs(), true);
    assert.equal(mayEndAnAdoptableProcess(stop.read() as Record<string, unknown>), true);

    stop.request({ mode: "now" });
    assert.equal(stop.endsAdoptableJobs(), false, "a plain `--now` does not carry `jobs`");
    assert.equal(mayEndAnAdoptableProcess(stop.read() as Record<string, unknown>), false);
  } finally {
    root.dispose();
  }
});
