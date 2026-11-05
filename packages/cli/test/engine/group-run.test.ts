/**
 * THE RUN OF N SUPERVISED WORKERS OF ONE GROUP, at the engine level (step 2
 * of `prompts/specstride-parallel-units.md`; F143-FR-010, F143-FR-013,
 * F143-FR-015, F143-FR-016, F143-FR-018). Real processes throughout — every
 * worker is `sleep 600` in a group of its own:
 *
 *  - THE SURVIVOR SEARCH of F143-FR-018 ends the holders of THIS run's
 *    token an earlier engine left, leaves another run's token alone, clears
 *    the stale record of a worker that is already gone, and NEVER signals a
 *    reused pid whose start time differs — the clause of the step's gate —
 *    while a holder under its true identity is ended;
 *  - THREE (and five, in two slices) workers of one group start supervised:
 *    each its own group leader, each under its own guard, each with its
 *    identity record on disk and its `owned` entry in a REAL registry file;
 *  - THE SIGKILL OF AN ENGINE THAT IS RUNNING THE GROUP — a real child
 *    process driving `startGroupWorkers` — ends every worker and every
 *    guard within 5 s, nothing resumes them, and the next start's survivor
 *    search finds only stale records;
 *  - THE WATCHDOG of the runner kills a hung worker over its ceiling; the
 *    kill itself is never a restart (the gate-tension decision of
 *    `results/par-2.progress`); a relaunch admits exactly one restart; the
 *    second failure returns the task to the main line;
 *  - THE GROUP PAUSE gives every live worker the polite stop, keeps the
 *    trees, and writes the ONE record and the ONE event; a sibling's signal
 *    changes nothing;
 *  - THE CAP is evaluated on the sum over the live workers, and crossing it
 *    ends EVERY worker of the group.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { processGroupOf, startTimeOf } from "@specstride/kernel";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import {
  endTheLeftoverWorkers,
  startGroupWorkers,
  workerRecordPathOf,
  workerRecordsOf,
  workerRegistryEntryOf,
  workersDirectoryOf,
  type PlannedGroupWorker,
} from "../../src/engine/group-run.ts";
import {
  writeWorkerGuardScript,
  writeWorkerIdentityRecord,
  type WorkerIdentityRecord,
} from "../../src/engine/worker-supervisor.ts";

/* ------------------------------------------------------------------ *
 * Helpers — real stub processes, real files, real registries.
 * ------------------------------------------------------------------ */

/** Whether a pid answers a liveness probe (a zombie still does). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Every live pid whose command line carries the fragment (no `pgrep -f`). */
function pidsWithCmdlineFragment(fragment: string): number[] {
  const found: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`).includes(Buffer.from(fragment))) {
        found.push(Number(entry));
      }
    } catch {
      // The process vanished while it was being read.
    }
  }
  return found;
}

/** A stub worker (`sleep 600`) of its own process group, as the harness starts it. */
function stubWorker(): { pid: number; group: number; end: () => Promise<void> } {
  const child = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }) as ChildProcess & {
    pid: number;
  };
  const pid = child.pid;
  child.unref();
  const end = async (): Promise<void> => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  return { pid, group: pid, end };
}

/** Waits until the host can observe the start time of a fresh process. */
async function untilObservable(pid: number): Promise<number> {
  const deadline = Date.now() + 2_000;
  let startedAtMs: number | null = null;
  while (startedAtMs === null && Date.now() < deadline) {
    startedAtMs = startTimeOf(pid);
    if (startedAtMs === null) await new Promise((done) => setTimeout(done, 20));
  }
  assert.notEqual(startedAtMs, null, `the start time of pid ${String(pid)} stayed unobservable`);
  return startedAtMs as number;
}

/** Waits for a condition with a deadline, ticking every 25 ms. */
async function until(what: () => boolean, withinMs: number, why: string): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!what()) {
    if (Date.now() > deadline) assert.fail(`timed out: ${why}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** The process registry over one real `specstride.procs/1` file (F118-FR-031). */
function registryAccessOf(path: string): RegistryAccess {
  const readAll = (): Record<string, RegistryEntry> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, RegistryEntry>;
    } catch {
      return {};
    }
  };
  const writeAll = (entries: Record<string, RegistryEntry>): void => {
    writeFileSync(path, JSON.stringify(entries, null, 2));
  };
  return {
    get: (logicalName) => readAll()[logicalName],
    put: (entry) => {
      const all = readAll();
      all[entry.logicalName] = entry;
      writeAll(all);
    },
    remove: (logicalName) => {
      const all = readAll();
      if (all[logicalName] === undefined) return;
      delete all[logicalName];
      writeAll(all);
    },
    adoptable: () =>
      Object.values(readAll()).filter((entry) => entry.registryClass === "adoptable"),
  };
}

/** One fixture: a control root with its workers directory, guard, registry, token. */
function fixtureOf(name: string): {
  readonly root: string;
  readonly workersDir: string;
  readonly guardScriptPath: string;
  readonly registryPath: string;
  readonly registry: RegistryAccess;
  readonly runTokenHash: string;
} {
  const root = mkdtempSync(join(tmpdir(), `group-run-${name}-`));
  const workersDir = workersDirectoryOf(root, "par-two");
  const guardScriptPath = join(root, "worker-guard.mjs");
  writeWorkerGuardScript(guardScriptPath);
  const registryPath = join(root, "procs.json");
  const runTokenHash = createHash("sha256").update(`run-${name}`).digest("hex");
  return {
    root,
    workersDir,
    guardScriptPath,
    registryPath,
    registry: registryAccessOf(registryPath),
    runTokenHash,
  };
}

/** The stub `start` of a worker: a `sleep 600` of its own group, detached. */
function stubStartOf(runTokenHash: string): (workerId: string) => Promise<{
  workerId: string;
  pid: number;
  processGroup: number;
  runTokenHash: string;
}> {
  return async (workerId) => {
    const worker = stubWorker();
    return {
      workerId,
      pid: worker.pid,
      processGroup: worker.group,
      runTokenHash,
    };
  };
}

/** Ends every stub worker of a test, by its group, whoever holds the handle. */
async function endPids(pids: readonly number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  await new Promise((done) => setTimeout(done, 100));
}

const RUN_GROUP_RUNNER = /* js */ `
import { readFileSync, writeFileSync } from "node:fs";
const [moduleUrl, bootPath, configPath, readyPath] = process.argv.slice(1);
const mod = await import(moduleUrl);
writeFileSync(bootPath, "booted");
let config = null;
const deadline = Date.now() + 15_000;
while (config === null && Date.now() < deadline) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    await new Promise((done) => setTimeout(done, 50));
  }
}
if (config === null) {
  writeFileSync(readyPath, JSON.stringify({ error: "no config" }));
  process.exit(3);
}
const readRegistry = () => {
  try {
    return JSON.parse(readFileSync(config.registryPath, "utf8"));
  } catch {
    return {};
  }
};
const registry = {
  get: (logicalName) => readRegistry()[logicalName],
  put: (entry) => {
    const all = readRegistry();
    all[entry.logicalName] = entry;
    writeFileSync(config.registryPath, JSON.stringify(all, null, 2));
  },
  remove: (logicalName) => {
    const all = readRegistry();
    if (all[logicalName] === undefined) return;
    delete all[logicalName];
    writeFileSync(config.registryPath, JSON.stringify(all, null, 2));
  },
  adoptable: () => [],
};
const { spawn: spawnChild } = await import("node:child_process");
const group = await mod.startGroupWorkers({
  planned: config.planned,
  workersAtATime: 3,
  runTokenHash: config.runTokenHash,
  enginePid: process.pid,
  engineStartedAtMs: config.engineStartedAtMs,
  workersDir: config.workersDir,
  guardScriptPath: config.guardScriptPath,
  guardPollMs: 100,
  guardGraceMs: 400,
  ceilingSec: 3600,
  watchdogTickMs: 30_000,
  graceMs: 400,
  start: async (workerId) => {
    const child = spawnChild("sleep", ["600"], { detached: true, stdio: "ignore" });
    child.unref();
    return { workerId, pid: child.pid, processGroup: child.pid, runTokenHash: config.runTokenHash };
  },
  registry,
  say: () => {},
});
writeFileSync(readyPath, JSON.stringify({ pids: group.rows().map((row) => row.pid) }));
setInterval(() => {}, 10_000);
`;

/* ------------------------------------------------------------------ *
 * F143-FR-018 — the survivor search at engine start and at resume.
 * ------------------------------------------------------------------ */

test("the survivor search ends this run's holders, leaves another run's token alone", async () => {
  const fx = fixtureOf("search");
  const leftA = stubWorker();
  const leftB = stubWorker();
  const otherRun = stubWorker();
  const recordOf = (workerId: string, pid: number, tokenHash: string): WorkerIdentityRecord => ({
    workerId,
    pid,
    startedAtMs: startTimeOf(pid) ?? 1,
    processGroup: pid,
    runTokenHash: tokenHash,
  });
  try {
    await untilObservable(leftA.pid);
    await untilObservable(leftB.pid);
    await untilObservable(otherRun.pid);
    writeWorkerIdentityRecord(
      workerRecordPathOf(fx.workersDir, "w-left-1"),
      recordOf("w-left-1", leftA.pid, fx.runTokenHash),
    );
    writeWorkerIdentityRecord(
      workerRecordPathOf(fx.workersDir, "w-left-2"),
      recordOf("w-left-2", leftB.pid, fx.runTokenHash),
    );
    writeWorkerIdentityRecord(
      workerRecordPathOf(fx.workersDir, "w-other"),
      recordOf("w-other", otherRun.pid, createHash("sha256").update("run-other").digest("hex")),
    );

    const report = await endTheLeftoverWorkers({
      workersDir: fx.workersDir,
      runTokenHash: fx.runTokenHash,
      graceMs: 200,
    });

    assert.deepEqual(
      report.holders.map((h) => h.workerId).sort(),
      ["w-left-1", "w-left-2"],
      "the holders of THIS run's token, and only them",
    );
    assert.deepEqual(
      report.ended.map((h) => h.workerId).sort(),
      ["w-left-1", "w-left-2"],
      "both were ended",
    );
    assert.equal(report.leftForAnotherToken, 1, "the other run's record was left");
    assert.equal(report.refused.length, 0, "nothing was refused");
    assert.equal(report.stillAlive.length, 0, "nothing stayed alive under the ladder");
    await until(() => !alive(leftA.pid) && !alive(leftB.pid), 2_000, "the holders are gone");
    assert.ok(alive(otherRun.pid), "the holder of ANOTHER run's token was never touched");
    assert.deepEqual(
      workerRecordsOf(fx.workersDir).map((l) => l.record.workerId),
      ["w-other"],
      "the ended holders' records are gone; the other run's record stays",
    );
  } finally {
    await endPids([leftA.pid, leftB.pid, otherRun.pid]);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the search NEVER signals a reused pid whose start time differs, and ends the true holder", async () => {
  const fx = fixtureOf("reused-pid");
  const stranger = stubWorker();
  try {
    const trueStart = await untilObservable(stranger.pid);
    // The record of the worker that DIED holds a start time an hour earlier;
    // the pid now belongs to the stranger above.
    writeWorkerIdentityRecord(workerRecordPathOf(fx.workersDir, "w-gone"), {
      workerId: "w-gone",
      pid: stranger.pid,
      startedAtMs: trueStart - 60_000,
      processGroup: stranger.pid,
      runTokenHash: fx.runTokenHash,
    });

    const refusedReport = await endTheLeftoverWorkers({
      workersDir: fx.workersDir,
      runTokenHash: fx.runTokenHash,
      graceMs: 200,
    });

    assert.equal(refusedReport.refused.length, 1, "the reused pid was refused");
    assert.equal(refusedReport.refused[0].because, "start-time-mismatch");
    assert.equal(refusedReport.ended.length, 0, "nothing was ended");
    assert.ok(alive(stranger.pid), "the live process holding the pid was never signalled");
    assert.equal(
      workerRecordsOf(fx.workersDir).length,
      1,
      "the refused record is kept for the next start",
    );

    // The same search under the record's TRUE identity ends the true holder.
    rmSync(workerRecordPathOf(fx.workersDir, "w-gone"), { force: true });
    writeWorkerIdentityRecord(workerRecordPathOf(fx.workersDir, "w-gone"), {
      workerId: "w-gone",
      pid: stranger.pid,
      startedAtMs: trueStart,
      processGroup: stranger.pid,
      runTokenHash: fx.runTokenHash,
    });
    const trueReport = await endTheLeftoverWorkers({
      workersDir: fx.workersDir,
      runTokenHash: fx.runTokenHash,
      graceMs: 200,
    });
    assert.equal(trueReport.ended.length, 1, "the true holder was ended");
    await until(() => !alive(stranger.pid), 2_000, "the true holder is gone");
    assert.equal(workerRecordsOf(fx.workersDir).length, 0, "its record is gone with it");
  } finally {
    await endPids([stranger.pid]);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a stale record of a worker already gone is cleared, not signalled", async () => {
  const fx = fixtureOf("stale");
  try {
    writeWorkerIdentityRecord(workerRecordPathOf(fx.workersDir, "w-dead"), {
      workerId: "w-dead",
      pid: 2_000_000,
      startedAtMs: 1,
      processGroup: 2_000_000,
      runTokenHash: fx.runTokenHash,
    });
    const report = await endTheLeftoverWorkers({
      workersDir: fx.workersDir,
      runTokenHash: fx.runTokenHash,
      graceMs: 200,
    });
    assert.equal(report.alreadyGone.length, 1, "the stale holder is reported already gone");
    assert.equal(report.ended.length, 0);
    assert.equal(report.refused.length, 0);
    assert.equal(workerRecordsOf(fx.workersDir).length, 0, "the stale record is cleared");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * F143-FR-010 — N workers of one group, supervised, registered owned.
 * ------------------------------------------------------------------ */

test("five workers start supervised in two slices, each registered owned in a real registry", async () => {
  const fx = fixtureOf("start");
  const planned: PlannedGroupWorker[] = [1, 2, 3, 4, 5].map((n) => ({
    workerId: `w-${String(n)}`,
    task: `task ${String(n)}`,
    taskPosition: n,
    tree: `/trees/tree-${String(n)}`,
  }));
  try {
    const group = await startGroupWorkers({
      planned,
      workersAtATime: 3,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 3600,
      graceMs: 300,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });
    const rows = group.rows();
    assert.equal(rows.length, 5, "all five started");
    for (const row of rows) {
      assert.equal(row.processGroup, row.pid, "each worker leads its own group (F143-FR-010)");
      const record = workerRecordsOf(fx.workersDir).find((l) => l.record.workerId === row.workerId);
      assert.notEqual(record, undefined, "each worker has its identity record on disk");
      assert.equal(record?.record.pid, row.pid);
      assert.equal(record?.record.startedAtMs, row.startedAtMs);
      assert.equal(record?.record.runTokenHash, fx.runTokenHash);
      const entry = fx.registry.get(`worker:${row.workerId}`);
      assert.notEqual(entry, undefined, "each worker is registered");
      assert.deepEqual(
        entry,
        workerRegistryEntryOf({
          workerId: row.workerId,
          pid: row.pid,
          startedAtMs: row.startedAtMs,
          processGroup: row.pid,
          runTokenHash: fx.runTokenHash,
        }),
        "the entry is the `owned` entry of F143-FR-010, class pass, never adoptable",
      );
      assert.equal(entry?.registryClass, "pass");
      assert.equal(entry?.survivesStop, false);
      assert.ok(processGroupOf(row.pid) === row.pid, "the group is live on the host");
    }

    const ended = await group.endAllOfTheGroup("killed");
    assert.equal(ended.length, 5, "the stop of the run ends every worker of the group");
    for (const row of rows) await until(() => !alive(row.pid), 3_000, "every worker is gone");
    assert.equal(workerRecordsOf(fx.workersDir).length, 0, "the records are gone with them");
    const leftInRegistry = Object.keys(JSON.parse(readFileSync(fx.registryPath, "utf8"))).filter(
      (name) => name.startsWith("worker:"),
    );
    assert.equal(leftInRegistry.length, 0, "the registry holds no worker entry any more");
  } finally {
    const leftovers = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(leftovers);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * THE GATE — SIGKILL of an engine RUNNING the group.
 * ------------------------------------------------------------------ */

test("SIGKILL of the engine running the group ends every worker and guard within 5 s, no resume", async () => {
  const fx = fixtureOf("sigkill");
  const bootPath = join(fx.root, "booted");
  const configPath = join(fx.root, "config.json");
  const readyPath = join(fx.root, "ready.json");
  const moduleUrl = pathToFileURL(join(import.meta.dirname, "../../src/engine/group-run.ts")).href;
  const engine = spawn(
    process.execPath,
    ["--input-type=module", "-e", RUN_GROUP_RUNNER, moduleUrl, bootPath, configPath, readyPath],
    {
      cwd: fx.root,
      stdio: "ignore",
    },
  );
  try {
    await until(
      () => {
        try {
          return readFileSync(bootPath, "utf8") === "booted";
        } catch {
          return false;
        }
      },
      5_000,
      "the engine booted",
    );
    const engineStartedAtMs = (await untilObservable(engine.pid as number)) ?? 0;
    writeFileSync(
      configPath,
      JSON.stringify({
        planned: [1, 2, 3].map((n) => ({
          workerId: `w-${String(n)}`,
          task: `task ${String(n)}`,
          taskPosition: n,
          tree: join(fx.root, `tree-${String(n)}`),
        })),
        runTokenHash: fx.runTokenHash,
        engineStartedAtMs,
        workersDir: fx.workersDir,
        guardScriptPath: fx.guardScriptPath,
        registryPath: fx.registryPath,
      }),
    );
    await until(
      () => {
        try {
          return readFileSync(readyPath, "utf8").includes("pids");
        } catch {
          return false;
        }
      },
      10_000,
      "the engine started its three workers",
    );
    const ready = JSON.parse(readFileSync(readyPath, "utf8")) as { pids: number[] };
    assert.equal(ready.pids.length, 3, "three workers of the group");
    for (const pid of ready.pids) {
      assert.equal(processGroupOf(pid), pid, "each worker leads its own group");
    }
    const guardsBefore = pidsWithCmdlineFragment(fx.guardScriptPath);
    assert.equal(guardsBefore.length, 3, "one guard per worker, standing beside it");

    // THE KILL.
    const killedAt = Date.now();
    engine.kill("SIGKILL");
    await until(
      () => ready.pids.every((pid) => !alive(pid)),
      5_000,
      "every worker is ended within 5 s of the SIGKILL of the engine",
    );
    const withinMs = Date.now() - killedAt;
    assert.ok(withinMs < 5_000, `every worker was ended in ${String(withinMs)} ms (< 5000)`);
    await until(
      () => pidsWithCmdlineFragment(fx.guardScriptPath).length === 0,
      3_000,
      "every guard retired",
    );
    // NO RESUME: a second later, everything is still ended.
    await new Promise((done) => setTimeout(done, 1_200));
    for (const pid of ready.pids) {
      assert.ok(!alive(pid), `pid ${String(pid)} was not resumed`);
    }
    assert.equal(engine.signalCode, "SIGKILL", "the engine died by the SIGKILL");

    // The NEXT start's survivor search finds only stale records.
    const report = await endTheLeftoverWorkers({
      workersDir: fx.workersDir,
      runTokenHash: fx.runTokenHash,
      graceMs: 200,
    });
    assert.equal(report.holders.length, 3, "the three records under the run token are found");
    assert.equal(report.alreadyGone.length, 3, "all three were already gone");
    assert.equal(report.ended.length, 0);
    assert.equal(report.refused.length, 0);
    assert.equal(report.stillAlive.length, 0);
    assert.equal(workerRecordsOf(fx.workersDir).length, 0, "the records are cleared");
  } finally {
    if (engine.exitCode === null && engine.signalCode === null) engine.kill("SIGKILL");
    const strays = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(strays);
    for (const pid of pidsWithCmdlineFragment(fx.guardScriptPath)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already retired.
      }
    }
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * F143-FR-013 — the watchdog kill, the restart once, the main line.
 * ------------------------------------------------------------------ */

test("the watchdog kills a hung worker; a relaunch restarts it once; the second failure goes to the main line", async () => {
  const fx = fixtureOf("watchdog");
  const workerId = "w-hung";
  try {
    // THE FIRST ENGINE: the watchdog ends the hung worker over its ceiling.
    const first = await startGroupWorkers({
      planned: [{ workerId, task: "write the parser", taskPosition: 7 }],
      workersAtATime: 2,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 1,
      watchdogTickMs: 150,
      graceMs: 200,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });
    await until(
      () => first.theEndOf(workerId) === "killed",
      8_000,
      "the watchdog killed the hung worker",
    );
    const outcome = first.outcomeOfTheEnd(workerId);
    assert.equal(outcome.outcome, "killed", "the end of a watchdog kill is `killed`");
    assert.equal(outcome.chargesItsTask, false, "a killed worker charges nothing");
    assert.equal(outcome.taskReturnsToTheMainLine, true, "the task returns to the main line");

    // The kill itself is NOT a restart (the gate-tension decision): a worker
    // the runtime stopped is not given a second proposal for it.
    const forTheKill = first.mayRestartTheWorker(workerId, "killed");
    assert.deepEqual(forTheKill, {
      restart: false,
      because: "the interruption was the worker's own",
    });

    // THE RELAUNCH — an interruption the worker did not cause — restarts it
    // ONCE, in its tree, in a fresh session.
    const once = first.mayRestartTheWorker(workerId, "a relaunch");
    assert.equal(once.restart, true, "the first relaunch admits the restart");
    if (once.restart) {
      assert.equal(once.session, "fresh");
      assert.equal(once.restartIndex, 1);
      assert.equal(once.inItsTree, "", "the tree is the tree store's to make (step 3)");
    }

    // THE SECOND ENGINE: the plan it is handed carries the restart used
    // (F143-FR-025 persists it — step 4; the plan carries it here). The
    // restart is spent, and the second failure returns the task to the main
    // line, where the single-pass loop finishes it.
    const second = await startGroupWorkers({
      planned: [{ workerId, task: "write the parser", taskPosition: 7, restartsUsed: 1 }],
      workersAtATime: 2,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 1,
      watchdogTickMs: 150,
      graceMs: 200,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });
    const again = second.mayRestartTheWorker(workerId, "a relaunch");
    assert.deepEqual(again, { restart: false, because: "the restart was already used" });
    await until(
      () => second.theEndOf(workerId) === "killed",
      8_000,
      "the second failure is a watchdog kill too",
    );
    const secondOutcome = second.outcomeOfTheEnd(workerId);
    assert.equal(
      secondOutcome.taskReturnsToTheMainLine,
      true,
      "the second failure returns the task to the main line",
    );
    second.retire();
  } finally {
    const strays = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(strays);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * F143-FR-015 — the group pause.
 * ------------------------------------------------------------------ */

test("the group pause gives every live worker the polite stop, keeps the trees, one record, one event", async () => {
  const fx = fixtureOf("pause");
  const planned: PlannedGroupWorker[] = [1, 2, 3].map((n) => ({
    workerId: `w-${String(n)}`,
    task: `task ${String(n)}`,
    taskPosition: n,
    tree: `/trees/tree-${String(n)}`,
  }));
  const records: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  try {
    const group = await startGroupWorkers({
      planned,
      workersAtATime: 3,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 3600,
      graceMs: 300,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });
    const live = group.liveWorkers();
    assert.equal(live.length, 3);

    const pause = await group.carryOutTheGroupPause({
      signal: { workerId: "w-2", classification: "quota" },
      groupId: "group-1",
      doors: {
        pauseRecord: (record) => {
          records.push({ ...record });
        },
        emitEvent: (event) => {
          events.push({ ...event });
        },
      },
    });
    assert.deepEqual(
      [...pause.politelyStopped].sort(),
      ["w-1", "w-2", "w-3"],
      "every live worker got the polite stop",
    );
    assert.deepEqual(
      [...pause.treesKept].sort(),
      ["/trees/tree-1", "/trees/tree-2", "/trees/tree-3"],
      "the trees are kept (F143-FR-015)",
    );
    assert.equal(pause.recordsWritten, 1, "THE ONE pause record");
    assert.equal(pause.eventsEmitted, 1, "THE ONE pause event");
    assert.equal(records.length, 1);
    assert.equal(events.length, 1);
    assert.equal(
      records[0]["cause"],
      "quota_pause",
      "the passes closed with the cause of the pause",
    );
    for (const row of group.rows()) {
      assert.equal(row.end, "paused", "the end of a paused worker is `paused`");
      const outcome = group.outcomeOfTheEnd(row.workerId);
      assert.equal(outcome.outcome, "paused");
      assert.equal(outcome.taskReturnsToTheMainLine, false, "a paused task does not return yet");
    }
    await until(() => group.rows().length === 0, 5_000, "the politely stopped workers are gone");
    assert.equal(
      workerRecordsOf(fx.workersDir).length,
      0,
      "their records and entries closed with them",
    );
    const leftInRegistry = Object.keys(JSON.parse(readFileSync(fx.registryPath, "utf8"))).filter(
      (name) => name.startsWith("worker:"),
    );
    assert.equal(leftInRegistry.length, 0);

    // A sibling's signal after the pause: NOTHING more is written (F143-SC-003).
    const again = await group.carryOutTheGroupPause({
      signal: { workerId: "w-3", classification: "quota" },
      groupId: "group-1",
      doors: {
        pauseRecord: (record) => {
          records.push({ ...record });
        },
        emitEvent: (event) => {
          events.push({ ...event });
        },
      },
    });
    assert.equal(again.recordsWritten, 0);
    assert.equal(again.eventsEmitted, 0);
    assert.equal(records.length, 1, "still the one record");
    assert.equal(events.length, 1, "still the one event");
  } finally {
    const strays = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(strays);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * F143-FR-016 — the spending-limit cap.
 * ------------------------------------------------------------------ */

test("the cap is evaluated on the sum over live workers; crossing it ends EVERY worker", async () => {
  const fx = fixtureOf("cap");
  const planned: PlannedGroupWorker[] = [1, 2, 3].map((n) => ({
    workerId: `w-${String(n)}`,
    task: `task ${String(n)}`,
    taskPosition: n,
  }));
  try {
    const group = await startGroupWorkers({
      planned,
      workersAtATime: 3,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 3600,
      graceMs: 300,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });

    const under = await group.recordUsage("w-1", 0.4, 1.0);
    assert.equal(under.crossed, false, "0.4 is under the cap of 1.0");
    assert.deepEqual([...under.endTheseWorkers], [], "nothing ends under the cap");
    assert.equal(group.rows().length, 3, "every worker still runs");

    const crossing = await group.recordUsage("w-2", 0.7, 1.0);
    assert.equal(crossing.sumOverLiveWorkers, 1.1, "the sum over the LIVE workers");
    assert.equal(crossing.crossed, true, "1.1 crosses the cap of 1.0");
    assert.deepEqual(
      [...crossing.endTheseWorkers].sort(),
      ["w-1", "w-2", "w-3"],
      "crossing ends every worker of the group",
    );
    await until(() => group.rows().length === 0, 8_000, "every worker is ended");
    for (const row of planned) {
      assert.equal(group.theEndOf(row.workerId), "killed", "the end of a cap crossing is `killed`");
    }
    assert.equal(workerRecordsOf(fx.workersDir).length, 0, "the records are gone with them");
    const leftInRegistry = Object.keys(JSON.parse(readFileSync(fx.registryPath, "utf8"))).filter(
      (name) => name.startsWith("worker:"),
    );
    assert.equal(leftInRegistry.length, 0, "the registry holds no worker entry any more");
  } finally {
    const strays = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(strays);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * The bookkeeping of a run that closes.
 * ------------------------------------------------------------------ */

test("retire() stops the watchdogs and the guards and does NOT end the live workers", async () => {
  const fx = fixtureOf("retire");
  const planned: PlannedGroupWorker[] = [1, 2].map((n) => ({
    workerId: `w-${String(n)}`,
    task: `task ${String(n)}`,
    taskPosition: n,
  }));
  try {
    const group = await startGroupWorkers({
      planned,
      workersAtATime: 2,
      runTokenHash: fx.runTokenHash,
      enginePid: process.pid,
      engineStartedAtMs: startTimeOf(process.pid) ?? 0,
      workersDir: fx.workersDir,
      guardScriptPath: fx.guardScriptPath,
      ceilingSec: 3600,
      graceMs: 300,
      start: stubStartOf(fx.runTokenHash),
      registry: fx.registry,
    });
    const rows = group.rows();
    assert.equal(rows.length, 2);
    group.retire();
    await new Promise((done) => setTimeout(done, 400));
    assert.equal(group.rows().length, 2, "an ordinary close lets the group run on (F143-FR-026)");
    for (const row of rows) {
      assert.ok(alive(row.pid), "the live worker was not ended by the retire");
      assert.equal(group.theEndOf(row.workerId), undefined);
    }
    const ended = await group.endAllOfTheGroup("killed");
    assert.equal(ended.length, 2, "the caller that ends them says so explicitly");
    for (const row of rows) await until(() => !alive(row.pid), 3_000, "the workers are gone");
  } finally {
    const strays = workerRecordsOf(fx.workersDir).map((l) => l.record.pid);
    await endPids(strays);
    rmSync(fx.root, { recursive: true, force: true });
  }
});
