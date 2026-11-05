/**
 * THE RESUME OF AN OPEN GROUP AT THE COMPOSITION ROOT (step 4 of
 * `prompts/specstride-parallel-units.md`; F143-FR-025 joined to the engine's
 * resume path — FIRST SLICE), over the REAL seams: a real git workspace, a
 * real tree store with real worker trees and its real tree index, a real
 * ledger file written through the ONE WRITER, real worker processes under
 * real identity records for the survivor search, and the real wiring of the
 * attempt:
 *
 *  - DISCOVERY finds the open group of the newest run that holds one, from
 *    the file, with the decision of the core over the last record — the
 *    state, the action, the requirement's own sentence, and the per-worker
 *    verdicts that read the restart index out of the `passOrdinal` triple;
 *  - THE HOLDERS OF THE INTERRUPTED RUN'S TOKEN are ended after the identity
 *    check, and the records of another token are left where they are
 *    (F143-FR-018);
 *  - A STATE THE SLICE DOES NOT CARRY OUT YET is answered `carried: false`
 *    with the state, the action and the sentence, and NOTHING IS WRITTEN;
 *  - THE CLOSE of a group whose merge check had finished is carried out over
 *    the interrupted run's own places: `group_closed` written on the
 *    interrupted run's own ledger with `seq` rising without a gap
 *    (F143-FR-024) and the counters continuing from the file (F143-FR-028),
 *    the worker trees released, and nothing left open afterwards;
 *  - THE WIRING refuses to start a fresh group over an open one, and starts
 *    as before where no group stands open.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import { startTimeOf } from "@specstride/kernel";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { initStore, treeStore } from "../../../tree-store/src/index.ts";
import { workerRecordPathOf } from "../../src/engine/group-run.ts";
import {
  carryOutTheResumeOfTheOpenGroup,
  endTheHoldersOfTheOpenGroup,
  theOpenParallelGroupOf,
  theWorkersDirectoryOfTheRun,
} from "../../src/engine/parallel-resume.ts";
import { dataOfTheKind, openTheLedgerOfTheRun } from "../../src/engine/parallel-drive.ts";
import {
  placesOfTheParallelStore,
  theParallelHomeOfARun,
  prepareTheGroupTrees,
  type PreparedWorker,
} from "../../src/engine/parallel-group.ts";
import { hashOfTheRunToken } from "../../src/engine/parallel-attempt.ts";
import {
  writeWorkerIdentityRecord,
  writeWorkerGuardScript,
} from "../../src/engine/worker-supervisor.ts";
import { parallelWiringOfTheAttempt } from "../../src/engine/parallel-wiring.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-resume";
const GROUP_ID = "g-2-1";

/** The hash of annex X §X.5, as the engine computes it. */
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

type Fixture = {
  readonly root: string;
  readonly workspace: string;
  readonly controlRoot: string;
  readonly home: string;
  readonly runId: string;
  readonly registry: RegistryAccess;
  cleanup: () => void;
};

function git(cwd: string, ...argv: readonly string[]): void {
  const done = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(done.status, 0, `git ${argv.join(" ")} failed: ${done.stderr}`);
}

function fixtureOf(name: string, runId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `par-resume-${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  // The bench commits with its own identity, as the other engine tests do: a runner with no git
  // identity (CI) must not fail the setup.
  git(workspace, "config", "user.email", "t@t");
  git(workspace, "config", "user.name", "t");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(
    join(workspace, TASK_LIST),
    "- [ ] 2-a the first task\n- [ ] 2-b the second task\n- [ ] 2-c the third\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the resume bench");
  const controlRoot = join(root, "control");
  // The home of the fixture run, as THE ENGINE builds it: named by the run
  // id alone (theParallelHomeOfARun), so discovery across a simulated
  // relaunch resolves the same places the preparation materialized into.
  const home = theParallelHomeOfARun(runId);
  mkdirSync(home, { recursive: true });
  mkdirSync(join(controlRoot, "runs", runId), { recursive: true });
  const guardScriptPath = join(root, "worker-guard.mjs");
  writeWorkerGuardScript(guardScriptPath);
  return {
    root,
    workspace,
    controlRoot,
    home,
    runId,
    registry: registryAccessOf(join(controlRoot, "process-registry.json")),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      // The run's own worker-root subtree: theParallelHomeOfARun is named by
      // the run id, and only this run's subtree is this fixture's to remove.
      rmSync(join(home, ".specstride", "worker-roots", runId), {
        recursive: true,
        force: true,
      });
    },
  };
}

/** The process registry over one real file (F118-FR-031), as step 2 tests it. */
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
    adoptable: () => Object.values(readAll()),
  };
}

/** The plan of phase 2: one group holding the tasks named, `2-c` serial. */
function planOfGroup(runId: string, groupTasks: readonly string[]): ParallelPlan {
  const scope = { prefixes: ["src"], source: "task-text" as const };
  return {
    schema: "specstride.parallel-plan/1",
    runId,
    hash: "plan-hash-resume",
    workers: groupTasks.length,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: [...groupTasks] }],
        tasks: groupTasks.map((id) => ({ id, scope, checks: [] })),
        serial: ["2-c"],
        ceiling: groupTasks.length,
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Writing a real ledger, through the one writer, over real trees.
 * ------------------------------------------------------------------ */

/** The records of a run's ledger, as the file holds them. */
function ledgerOf(
  controlRoot: string,
  runId: string,
): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(controlRoot, "runs", runId, "parallel-ledger.jsonl");
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

const ledgerFileOf = (controlRoot: string, runId: string): string =>
  join(controlRoot, "runs", runId, "parallel-ledger.jsonl");

/**
 * A REAL OPEN GROUP, on the disk: the base snapshot of the workspace, one
 * worker tree per member, the `group_started` and the `worker_started` of
 * each member written through the one writer, and the writer RELEASED — the
 * fixture is the state an engine leaves when it dies in the middle of its
 * workers.
 */
async function openGroupLedgerOf(input: {
  readonly fixture: Fixture;
  readonly tasks: readonly string[];
  /** The restart index of each worker's pass, by worker id. */
  readonly restartIndexOf?: Readonly<Record<string, number>> | undefined;
}): Promise<{ readonly trees: readonly string[] }> {
  const { fixture } = input;
  const ledger = openTheLedgerOfTheRun({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    groupId: GROUP_ID,
  });
  const places = placesOfTheParallelStore({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    home: fixture.home,
  });
  initStore(places);
  const store = treeStore(places, {
    runId: fixture.runId,
    groupId: GROUP_ID,
    taskListPath: TASK_LIST,
  });
  const baseTreeId = await store.snapshot(fixture.workspace);
  const prepared = await prepareTheGroupTrees({
    store,
    workspace: fixture.workspace,
    members: input.tasks.map((taskId) => ({ taskId, scopePrefixes: ["src"] })),
    slug: SLUG,
    baseFingerprint: baseTreeId,
    baseTreeId,
  });
  await ledger.writer.ahead(
    "group_started",
    dataOfTheKind("group_started", {
      baseTree: prepared.baseTreeId,
      workspaceFingerprint: baseTreeId,
    }),
    () => Promise.resolve(),
  );
  const fingerprints = new Map<string, string>();
  for (const worker of prepared.workers) {
    fingerprints.set(worker.workerId, await store.snapshot(worker.tree));
  }
  let position = 0;
  for (const worker of prepared.workers) {
    position += 1;
    const restartIndex = input.restartIndexOf?.[worker.workerId] ?? 0;
    await ledger.writer.record(
      "worker_started",
      dataOfTheKind("worker_started", {
        workerId: worker.workerId,
        task: worker.taskId,
        passId: `${GROUP_ID}:${worker.workerId}:pass${String(restartIndex + 1)}`,
        passOrdinal: [...passOrdinalOf({ groupOrdinal: 1, taskPosition: position, restartIndex })],
        treeFingerprint: fingerprints.get(worker.workerId) ?? "",
        pid: 0,
        startTime: "",
      }),
    );
  }
  releaseTheWriter(`${fixture.runId}:ledger`);
  return { trees: prepared.workers.map((worker) => worker.tree) };
}

/** The workers directory of the fixture's own interrupted run. */
const workersDirOf = (fixture: Fixture): string =>
  theWorkersDirectoryOfTheRun(fixture.controlRoot, fixture.runId);

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("a control root whose runs hold no ledger holds no open group", () => {
  const fixture = fixtureOf("empty", "run-resume-empty");
  try {
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
    // A run directory without a ledger is not an open group either.
    mkdirSync(join(fixture.controlRoot, "runs", "run-resume-bare"), { recursive: true });
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("an open group mid-pass is discovered with the decision of the core", async () => {
  const fixture = fixtureOf("midpass", "run-resume-mid");
  try {
    const { trees } = await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined, "the open group was not discovered");
    assert.equal(open.runId, "run-resume-mid");
    assert.equal(open.groupId, GROUP_ID);
    assert.equal(open.ledgerFile, ledgerFileOf(fixture.controlRoot, "run-resume-mid"));
    // The decision is the state of the requirement, with its own sentence.
    assert.equal(open.decision.state, 2);
    assert.equal(open.decision.action, "end-the-recorded-processes");
    assert.ok(
      (open.decision.says ?? "").includes("end the recorded processes"),
      `the sentence is missing: ${open.decision.says ?? ""}`,
    );
    // The per-worker verdicts read the restart index out of the triple, and
    // the worker root named by the INTERRUPTED run holds the trees.
    const byWorker = new Map(open.decision.workers.map((worker) => [worker.workerId, worker]));
    assert.equal(byWorker.get("w-1")?.then, "restart");
    assert.equal(byWorker.get("w-1")?.restartsUsed, 0);
    assert.equal(byWorker.get("w-2")?.then, "restart");
    assert.equal(open.places.workerRoot.endsWith("run-resume-mid"), true);
    for (const tree of trees) assert.equal(existsSync(tree), true, `the tree ${tree} is gone`);
  } finally {
    fixture.cleanup();
  }
});

test("a used restart makes the worker `killed`, not `restart`", async () => {
  const fixture = fixtureOf("restart-used", "run-resume-used");
  try {
    await openGroupLedgerOf({
      fixture,
      tasks: ["2-a", "2-b"],
      restartIndexOf: { "w-2": 1 },
    });
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined);
    const byWorker = new Map(open.decision.workers.map((worker) => [worker.workerId, worker]));
    assert.equal(byWorker.get("w-1")?.then, "restart");
    assert.equal(byWorker.get("w-2")?.then, "killed");
    assert.equal(byWorker.get("w-2")?.restartsUsed, 1);
  } finally {
    fixture.cleanup();
  }
});

test("the holders of the interrupted run's token are ended; another token's records stay", async () => {
  const fixture = fixtureOf("holders", "run-resume-holders");
  const children: ChildProcess[] = [];
  /** The exit of a child, watched from the moment it is spawned. */
  const exitOf = (child: ChildProcess): Promise<void> =>
    new Promise((done) => child.once("exit", () => done()));
  const bounded = (waiting: Promise<void>, ms: number): Promise<void> =>
    Promise.race([waiting, new Promise<void>((done) => setTimeout(done, ms))]);
  try {
    await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    const workersDir = workersDirOf(fixture);
    // Two REAL sleeping processes, each with the identity record a worker of
    // this group would carry: one under the interrupted run's token, one
    // under another run's. The exit watchers attach BEFORE anything can end
    // the children, so no exit is lost.
    const under = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const other = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    children.push(under, other);
    const underExit = exitOf(under);
    const pidOf = (child: ChildProcess): number => child.pid as number;
    writeWorkerIdentityRecord(workerRecordPathOf(workersDir, "w-1"), {
      workerId: "w-1",
      pid: pidOf(under),
      startedAtMs: startTimeOf(pidOf(under)) ?? Date.now(),
      processGroup: pidOf(under),
      runTokenHash: hashOfTheRunToken(fixture.runId),
    });
    writeWorkerIdentityRecord(workerRecordPathOf(workersDir, "w-2"), {
      workerId: "w-2",
      pid: pidOf(other),
      startedAtMs: startTimeOf(pidOf(other)) ?? Date.now(),
      processGroup: pidOf(other),
      runTokenHash: hashOfTheRunToken("run-of-another-token"),
    });
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined);
    const search = await endTheHoldersOfTheOpenGroup({
      open,
      controlRoot: fixture.controlRoot,
      graceMs: 300,
    });
    // The holder of the interrupted run's token was ended, its record is off
    // the disk, and the search never signalled the other token's process.
    assert.deepEqual(search.ended, [{ workerId: "w-1", pid: pidOf(under) }]);
    assert.equal(search.refused.length, 0);
    assert.equal(search.leftForAnotherToken, 1);
    assert.equal(existsSync(workerRecordPathOf(workersDir, "w-1")), false);
    assert.equal(existsSync(workerRecordPathOf(workersDir, "w-2")), true);
    await bounded(underExit, 5_000);
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGKILL");
    }
    fixture.cleanup();
  }
});

test("a state the slice does not carry out yet is reported, and nothing is written", async () => {
  const fixture = fixtureOf("barrier", "run-resume-barrier");
  try {
    const { trees } = await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    // Carry the group on to the barrier: the workers' passes ended whole, the
    // barrier closed, and the engine died before the audits ran.
    await carryTheGroupOnToTheBarrier({ fixture, trees });
    const before = readFileSync(ledgerFileOf(fixture.controlRoot, fixture.runId), "utf8");
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined);
    assert.equal(open.decision.state, 4);
    assert.equal(open.decision.action, "repeat-from-the-audits");
    const carried = await carryOutTheResumeOfTheOpenGroup({
      open,
      controlRoot: fixture.controlRoot,
    });
    assert.equal(carried.carried, false);
    if (carried.carried) return;
    assert.equal(carried.state, 4);
    assert.equal(carried.action, "repeat-from-the-audits");
    assert.ok((carried.says ?? "").includes("repeat from the audits"));
    const after = readFileSync(ledgerFileOf(fixture.controlRoot, fixture.runId), "utf8");
    assert.equal(after, before, "the carry-out wrote where it must not");
    // The trees stand: the group is still open, and its trees are its own.
    for (const tree of trees) assert.equal(existsSync(tree), true);
  } finally {
    fixture.cleanup();
  }
});

test("the close of a finished merge check is carried out over the interrupted run's places", async () => {
  const fixture = fixtureOf("close", "run-resume-close");
  try {
    const { trees } = await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    // The whole integration ran; the engine died between the finished merge
    // check and the close of the group.
    await carryTheGroupOnToTheBarrier({ fixture, trees });
    await carryTheIntegrationOnToTheFinishedCheck({ fixture, trees, check: "pass" });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(before[before.length - 1]?.kind, "merge_check_finished");
    const lastSeq = before[before.length - 1]?.seq ?? 0;

    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined);
    assert.equal(open.decision.action, "close-the-group");
    const carried = await carryOutTheResumeOfTheOpenGroup({
      open,
      controlRoot: fixture.controlRoot,
    });
    assert.equal(carried.carried, true);
    if (!carried.carried || carried.action !== "close-the-group") return;
    // Both trees were released by the close.
    assert.equal(carried.closed.treesRemoved.length, 2);
    for (const tree of trees) assert.equal(existsSync(tree), false, `the tree ${tree} stands`);
    // The record went on the interrupted run's own ledger, without a gap,
    // carrying the counters the ledger's own records state (F143-FR-028).
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(after.length, before.length + 1);
    const closedRecord = after[after.length - 1];
    assert.equal(closedRecord?.kind, "group_closed");
    assert.equal(closedRecord?.seq, lastSeq + 1);
    assert.ok(closedRecord?.counters !== undefined, "the close carries no counters");
    // And nothing stands open afterwards.
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("a failed merge check closes the group as a failure", async () => {
  const fixture = fixtureOf("close-fail", "run-resume-fail");
  try {
    const { trees } = await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    await carryTheGroupOnToTheBarrier({ fixture, trees });
    await carryTheIntegrationOnToTheFinishedCheck({ fixture, trees, check: "fail" });
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.ok(open !== undefined);
    const carried = await carryOutTheResumeOfTheOpenGroup({
      open,
      controlRoot: fixture.controlRoot,
    });
    assert.equal(carried.carried, true);
    if (!carried.carried || carried.action !== "close-the-group") return;
    assert.equal(carried.closed.treesRemoved.length, 2);
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    const closedRecord = after[after.length - 1];
    assert.equal(closedRecord?.kind, "group_closed");
    assert.equal((closedRecord?.data as Record<string, unknown>)["outcome"], "failed");
  } finally {
    fixture.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * Carrying a fixture group on, through the real records.
 * ------------------------------------------------------------------ */

/** The worker ends and the barrier of the fixture's group, as a run leaves them. */
async function carryTheGroupOnToTheBarrier(input: {
  readonly fixture: Fixture;
  readonly trees: readonly string[];
}): Promise<void> {
  const { fixture, trees } = input;
  const ledger = openTheLedgerOfTheRun({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    groupId: GROUP_ID,
  });
  const places = placesOfTheParallelStore({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    home: fixture.home,
  });
  const store = treeStore(places, { runId: fixture.runId, groupId: GROUP_ID });
  let position = 0;
  for (const tree of trees) {
    position += 1;
    const treeId = await store.snapshot(tree);
    await ledger.writer.record(
      "worker_ended",
      dataOfTheKind("worker_ended", {
        workerId: `w-${String(position)}`,
        treeId,
        treeFingerprint: treeId,
        endCause: "ended",
      }),
    );
  }
  const baseTreeId = await store.snapshot(fixture.workspace);
  await ledger.writer.ahead(
    "group_barrier",
    dataOfTheKind("group_barrier", {
      fingerprint: baseTreeId,
      perWorkerFingerprint: Object.fromEntries(
        trees.map((tree, index) => [`w-${String(index + 1)}`, baseTreeId]),
      ),
    }),
    () => Promise.resolve(),
  );
  releaseTheWriter(`${fixture.runId}:ledger`);
}

/** The audits, the application and the merge check of the fixture's group. */
async function carryTheIntegrationOnToTheFinishedCheck(input: {
  readonly fixture: Fixture;
  readonly trees: readonly string[];
  readonly check: "pass" | "fail";
}): Promise<void> {
  const { fixture, trees, check } = input;
  const ledger = openTheLedgerOfTheRun({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    groupId: GROUP_ID,
  });
  const places = placesOfTheParallelStore({
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    home: fixture.home,
  });
  const store = treeStore(places, { runId: fixture.runId, groupId: GROUP_ID });
  const baseTreeId = await store.snapshot(fixture.workspace);
  await ledger.writer.record("audit_done", { verdicts: {} });
  await ledger.writer.record("merge_done", {
    composedTreeId: baseTreeId,
    acceptedWorkers: trees.map((_, index) => `w-${String(index + 1)}`),
  });
  await ledger.writer.ahead("apply_started", { paths: [] }, () => Promise.resolve());
  await ledger.writer.record("applied", { fingerprint: baseTreeId });
  await ledger.writer.record("ticks_applied", { taskIds: ["2-a", "2-b"] });
  await ledger.writer.record("merge_check_started", { checkManifestHash: hash("manifest") });
  await ledger.writer.record("merge_check_finished", {
    check,
    ...(check === "fail" ? { conditions: ["the-probe"] } : {}),
  });
  releaseTheWriter(`${fixture.runId}:ledger`);
}

/* ------------------------------------------------------------------ *
 * The wiring: a relaunch over an open group starts no fresh group.
 * ------------------------------------------------------------------ */

/** A REAL check runner: the command runs as a process with its real exit. */
function spawnRunner(): CheckRunner {
  const results = new Map<string, { exitCode: number; durationMs: number }>();
  let next = 0;
  return {
    pin: async (entry) => ({
      kind: "command",
      executable: entry.argv[0] ?? "node",
      argv: entry.argv.slice(1),
    }),
    start: async (probe) => {
      const id = `h${String(++next)}`;
      const began = Date.now();
      const done = spawnSync(probe.identity.executable ?? "node", probe.identity.argv ?? [], {
        cwd: probe.workingDirectory,
        encoding: "utf8",
        timeout: probe.timeLimitMs,
      });
      results.set(id, { exitCode: done.status ?? 1, durationMs: Date.now() - began });
      return { id };
    },
    poll: async () => ({ state: "ended" as const }),
    result: async (handle) => {
      const one = results.get(handle.id);
      assert.ok(one !== undefined, `no result for the handle ${handle.id}`);
      return {
        exitCode: one.exitCode,
        durationMs: one.durationMs,
        output: { logicalName: "out", hash: hash("out"), size: 0 },
        tainted: false,
        cached: false,
        flaky: false,
        interrupted: false,
        unchecked: false,
      };
    },
    cancel: async () => {},
    environment: () => ({}),
  };
}

const STUB_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const [outbox, taskId, treePath, target, addition] = process.argv.slice(1);
fs.mkdirSync(outbox, { recursive: true });
fs.writeFileSync(path.join(outbox, taskId + ".checkpoint.json"), JSON.stringify({ task: taskId }));
const at = path.join(treePath, target);
fs.writeFileSync(at, fs.readFileSync(at, "utf8") + addition);
`;

type StartedWorkerPassStub = {
  readonly workerId: string;
  readonly pid: number;
  readonly startTime?: string | undefined;
  readonly processGroup?: number | undefined;
  readonly runTokenHash: string;
  readonly ended: Promise<"ended" | "killed">;
};

/** A start door whose workers edit `src/<task>.ts` and end at once. */
function stubStartDoor(): (worker: PreparedWorker) => Promise<StartedWorkerPassStub> {
  return async (worker) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        STUB_SCRIPT,
        worker.outboxPath,
        worker.taskId,
        worker.tree,
        `src/${worker.taskId.slice(2)}.ts`,
        `\n// ${worker.taskId} was here\n`,
      ],
      { detached: true, stdio: "ignore" },
    ) as ChildProcess & { pid: number };
    const pid = child.pid as number;
    child.unref();
    const ended = new Promise<"ended" | "killed">((done) => {
      child.once("exit", (code) => done(code === 0 ? "ended" : "killed"));
    });
    return {
      workerId: worker.workerId,
      pid,
      startTime: new Date().toISOString(),
      processGroup: pid,
      runTokenHash: hash("run-token-of-the-running-engine"),
      ended,
    };
  };
}

/** The wiring of one attempt over the fixture, with the doors given. */
function wiringOf(
  fixture: Fixture,
  doors: {
    readonly start?: (worker: PreparedWorker) => Promise<unknown> | undefined;
    readonly say?: ((line: string) => void) | undefined;
  },
) {
  const plan = planOfGroup(fixture.runId, ["2-a", "2-b"]);
  const probe: ManifestEntry = {
    id: "the-probe",
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", "a.ts"),
      "2-a was here",
    ],
    phase: 2,
    timeLimitMs: 30_000,
  };
  return parallelWiringOfTheAttempt({
    plan,
    phase: 2,
    evidencePresent: () => false,
    keptUnitsOf: () => [],
    failedGroupsBefore: 0,
    controlRoot: fixture.controlRoot,
    home: fixture.home,
    runId: fixture.runId,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    taskTextAtLaunch: "- [ ] 2-a the first task\n- [ ] 2-b the second task\n",
    taskTextOf: (taskId) => `the text of ${taskId}`,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: "run-token-of-the-running-engine",
    timeLimitMs: 120_000,
    enginePid: process.pid,
    engineStartedAtMs: Date.now(),
    registry: fixture.registry,
    guardScriptPath: join(fixture.root, "worker-guard.mjs"),
    hash,
    innerCheckSet: [probe],
    ...(doors.start === undefined ? {} : { startDoor: doors.start }),
    runner: spawnRunner(),
    emit: () => {},
    say: doors.say ?? (() => {}),
    onClosed: () => {},
    onHandoff: () => {},
  });
}

test("a relaunch over an open group carries the restart and starts no second group", async () => {
  const fixture = fixtureOf("wiring-open", "run-resume-open");
  let doorCalls = 0;
  try {
    await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    const lines: string[] = [];
    const wiring = wiringOf(fixture, {
      start: async (worker) => {
        doorCalls += 1;
        return await stubStartDoor()(worker);
      },
      say: (line) => lines.push(line),
    });
    // The relaunch CARRIES the open group (F143-FR-025 state 2): the cut
    // passes are restarted in their own trees as THIS start's group run.
    const ran = await wiring.startIfTheBoundaryIsClean();
    assert.equal(ran, true, "the wiring did not carry the restart of the open group");
    // The start door was called once per cut pass — the restart IS the group
    // run of this start, and no second group was started over it.
    assert.equal(doorCalls, 2, "the start door was not called once per cut pass");
    const records = ledgerOf(fixture.controlRoot, "run-resume-open");
    assert.equal(
      records.filter((record) => record.kind === "group_closed").length,
      1,
      "the group closed more than once",
    );
    assert.equal(records[records.length - 1]?.kind, "group_closed");
    assert.equal(
      (records[records.length - 1]?.data as Record<string, unknown>)["outcome"],
      "closed",
    );
    // The engine said what stood open and what it carried out.
    const said = lines.join("\n");
    assert.ok(said.includes("run-resume-open"), `the line does not name the run: ${said}`);
    assert.ok(said.includes(GROUP_ID), `the line does not name the group: ${said}`);
    assert.ok(said.includes("state 2"), `the line does not name the state: ${said}`);
    assert.ok(
      said.includes("end-the-recorded-processes"),
      `the line does not name the action: ${said}`,
    );
  } finally {
    fixture.cleanup();
  }
});

test("with the newest group closed whole, the wiring starts as before", async () => {
  const fixture = fixtureOf("wiring-closed", "run-resume-wired");
  try {
    // A run that closed its group whole: nothing stands open, and the wiring
    // of this engine start starts its own group over the same feature.
    const { trees } = await openGroupLedgerOf({ fixture, tasks: ["2-a", "2-b"] });
    await carryTheGroupOnToTheBarrier({ fixture, trees });
    await carryTheIntegrationOnToTheFinishedCheck({ fixture, trees, check: "pass" });
    const ledger = openTheLedgerOfTheRun({
      controlRoot: fixture.controlRoot,
      runId: fixture.runId,
      groupId: GROUP_ID,
    });
    await ledger.writer.record("group_closed", {
      outcome: "closed",
      treesRemoved: ["tree-a", "tree-b"],
      workerOutcomes: {},
    });
    releaseTheWriter(`${fixture.runId}:ledger`);
    const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
    assert.equal(open, undefined, "a closed group was taken for an open one");

    // The wiring starts the group of this attempt, whole, as it always did.
    let doorCalls = 0;
    const wiring = wiringOf(fixture, {
      start: async (worker) => {
        doorCalls += 1;
        return await stubStartDoor()(worker);
      },
    });
    const ran = await wiring.startIfTheBoundaryIsClean();
    assert.equal(ran, true);
    assert.equal(doorCalls, 2, "the two workers were not started");
  } finally {
    fixture.cleanup();
  }
});
