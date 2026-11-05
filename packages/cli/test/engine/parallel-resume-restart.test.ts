/**
 * THE RESTART OF THE OPEN GROUP (step 4 of `prompts/specstride-parallel-units.md`;
 * F143-FR-025 states 1 and 2 joined to the engine's resume path), over the
 * REAL seams: a real git workspace, a real tree store holding the worker
 * trees the interrupted run materialized, a real ledger file written through
 * the ONE WRITER, real audits re-run through the store after the restart, a
 * real composition and application, a real merge check over a real probe:
 *
 *  - STATE 2 — every cut pass is restarted IN ITS OWN TREE (the tree the
 *    store still holds, the same fingerprint the lost pass started from), a
 *    `worker_ended` record of the lost pass (`killed`, usage `unknown`) goes
 *    on first, the restarted pass carries the pass ordinal of its restart,
 *    and the tail carries the group whole to `kept`;
 *  - A WORKER WHOSE RESTART IS USED is not started again: it stands killed,
 *    its task returns to the main line, and only the other worker's pass
 *    runs;
 *  - A HOLDER THE SEARCH COULD NOT END refuses the restart: nothing is
 *    written;
 *  - A GROUP WITH A REAL `worker_ended` BESIDE A CUT PASS is not carried by
 *    this slice: nothing is written;
 *  - A CRASH BETWEEN `group_started` AND THE FIRST PASS: every tree that
 *    stands is restarted at restart index 0;
 *  - THE WIRING carries the restart as THIS start's group run: the start
 *    door is called once per cut pass, the say names what stood open, and
 *    the ledger of the interrupted run closes whole.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import { outboxOfAWorker, passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { initStore, treeStore, treesStillHeld } from "../../../tree-store/src/index.ts";
import {
  carryOutTheStartOrRestartOfTheOpenGroup,
  type TheRestartOfTheResumeDrive,
} from "../../src/engine/parallel-resume-restart.ts";
import { dataOfTheKind, openTheLedgerOfTheRun } from "../../src/engine/parallel-drive.ts";
import {
  placesOfTheParallelStore,
  theParallelHomeOfARun,
  prepareTheGroupTrees,
  type PreparedWorker,
  type StartedWorkerPass,
} from "../../src/engine/parallel-group.ts";
import {
  theOpenParallelGroupOf,
  type TheOpenParallelGroup,
} from "../../src/engine/parallel-resume.ts";
import type { TheTailOfTheResumeDrive } from "../../src/engine/parallel-resume-drive.ts";
import {
  parallelWiringOfTheAttempt,
  theSecretsOfTheWorker,
  theTickOfTheTaskList,
} from "../../src/engine/parallel-wiring.ts";
import type { LeftoverWorkersReport } from "../../src/engine/group-run.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-resume-restart";
const GROUP_ID = "g-2-1";
/** The tasks of the group, and the file of the workspace each one edits. */
const TASKS = ["T1", "T2"] as const;
const FILE_OF_TASK: Readonly<Record<string, string>> = { T1: "a.ts", T2: "b.ts" };
const THE_TASK_LIST_AT_LAUNCH =
  "## Phase 2: the group of the restart\n- [ ] T1 the first task\n- [ ] T2 the second task\n- [ ] T3 the third\n";
/** The run token and run id of THIS engine start, the one that resumes. */
const THE_RUN_TOKEN = "run-token-of-the-resuming-engine";
const THE_ENGINE_RUN_ID = "run-restart-engine";

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
  const root = mkdtempSync(join(tmpdir(), `par-restart-${name}-`));
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
  writeFileSync(join(workspace, TASK_LIST), THE_TASK_LIST_AT_LAUNCH);
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the restart bench");
  const controlRoot = join(root, "control");
  // The home of the fixture run, as THE ENGINE builds it: named by the run
  // id alone (theParallelHomeOfARun), so discovery across a simulated
  // relaunch resolves the same places the preparation materialized into.
  const home = theParallelHomeOfARun(runId);
  mkdirSync(home, { recursive: true });
  mkdirSync(join(controlRoot, "runs", runId), { recursive: true });
  const registry = join(controlRoot, "process-registry.json");
  const readAll = (): Record<string, RegistryEntry> => {
    try {
      return JSON.parse(readFileSync(registry, "utf8")) as Record<string, RegistryEntry>;
    } catch {
      return {};
    }
  };
  const writeAll = (entries: Record<string, RegistryEntry>): void => {
    writeFileSync(registry, JSON.stringify(entries, null, 2));
  };
  return {
    root,
    workspace,
    controlRoot,
    home,
    runId,
    registry: {
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
    },
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

/** The plan of phase 2: one group holding the tasks named, `T3` serial. */
function planOfGroup(runId: string, groupTasks: readonly string[]): ParallelPlan {
  const scope = { prefixes: ["src"], source: "task-text" as const };
  return {
    schema: "specstride.parallel-plan/1",
    runId,
    hash: "plan-hash-restart",
    workers: groupTasks.length,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: [...groupTasks] }],
        tasks: groupTasks.map((id) => ({ id, scope, checks: [] })),
        serial: ["T3"],
        ceiling: groupTasks.length,
      },
    ],
  };
}

/** The records of a run's ledger, as the file holds them. */
function ledgerOf(
  controlRoot: string,
  runId: string,
): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(controlRoot, "runs", runId, "parallel-ledger.jsonl");
  if (!readExists(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

function readExists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * A REAL GROUP CUT IN THE MIDDLE OF ITS WORKERS, on the disk: real trees
 * with the work of the lost passes standing in them, the records a run
 * leaves when the engine dies with starts on the ledger, and the writer
 * released — the state an engine leaves when it dies mid-group.
 * ------------------------------------------------------------------ */

async function openGroupCutAtTheStarts(input: {
  readonly fixture: Fixture;
  /** The restart index each worker's lost pass already carried. */
  readonly restartIndexOf?: Readonly<Record<string, number>>;
  /** A REAL `worker_ended` for `w-1`, as a pass that finished before the cut. */
  readonly endW1?: boolean;
  /** Stop after `group_started`: the crash fell before the first pass. */
  readonly beforeTheFirstPass?: boolean;
}): Promise<void> {
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
  const store = treeStore(places, { runId: fixture.runId, groupId: GROUP_ID });
  const baseTreeId = await store.snapshot(fixture.workspace);
  const prepared = await prepareTheGroupTrees({
    store,
    workspace: fixture.workspace,
    members: TASKS.map((taskId) => ({ taskId, scopePrefixes: ["src"] })),
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
  if (input.beforeTheFirstPass === true) {
    releaseTheWriter(`${fixture.runId}:ledger`);
    return;
  }
  let position = 0;
  for (const worker of prepared.workers) {
    position += 1;
    /* THE WORK OF THE LOST PASS, as the stub pass of the step-3 fixture makes
     * it: the edit in the tree, and the checkpoint the pass wrote into its own
     * outbox before its engine died. */
    const target = join(worker.tree, "src", FILE_OF_TASK[worker.taskId] ?? "");
    writeFileSync(target, readFileSync(target, "utf8") + `\n// ${worker.taskId} was here\n`);
    const outbox = join(worker.tree, outboxOfAWorker(SLUG));
    mkdirSync(outbox, { recursive: true });
    writeFileSync(
      join(outbox, `${worker.taskId}.checkpoint.json`),
      JSON.stringify({ task: worker.taskId }),
    );
    const treeId = await store.snapshot(worker.tree);
    const restartIndex = input.restartIndexOf?.[worker.workerId] ?? 0;
    await ledger.writer.record(
      "worker_started",
      dataOfTheKind("worker_started", {
        workerId: worker.workerId,
        task: worker.taskId,
        passId: `${GROUP_ID}:${worker.workerId}:pass${String(restartIndex + 1)}`,
        passOrdinal: [...passOrdinalOf({ groupOrdinal: 1, taskPosition: position, restartIndex })],
        treeFingerprint: treeId,
        pid: 0,
        startTime: "",
      }),
    );
    if (input.endW1 === true && worker.workerId === "w-1") {
      await ledger.writer.record(
        "worker_ended",
        dataOfTheKind("worker_ended", {
          workerId: worker.workerId,
          treeId,
          treeFingerprint: treeId,
          endCause: "ended",
        }),
      );
    }
  }
  releaseTheWriter(`${fixture.runId}:ledger`);
}

/* ------------------------------------------------------------------ *
 * The drive facts, the door and the runner, as the wiring holds them.
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

/** The probe of the merge check, over the file and text of ONE task. */
function probeForTask(fixture: Fixture, task: string): ManifestEntry {
  return {
    id: `the-probe-of-${task}`,
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", FILE_OF_TASK[task] ?? ""),
      `${task} was here`,
    ],
    phase: 2,
    timeLimitMs: 30_000,
  };
}

/** A search report with nothing standing: every holder ended and gone. */
function aCleanSearch(): LeftoverWorkersReport {
  return {
    searched: 0,
    holders: [],
    ended: [],
    alreadyGone: [],
    refused: [],
    stillAlive: [],
    leftForAnotherToken: 0,
  };
}

/**
 * The stub start door of the restarted passes: it does the task's work (the
 * edit in the tree) and re-writes the checkpoint into the worker's own
 * outbox — the duties of a pass — and ends the pass cleanly. The pid is
 * `0`, which every process probe treats as gone, so the barrier's
 * confirmation of the ends has nothing to signal.
 */
/** The calls of a door, as the tests count them. */
type DoorCalls = {
  readonly workerIds: string[];
  readonly tokenHashes: string[];
};

function doorOf(
  calls: DoorCalls,
  runToken: string,
): (worker: PreparedWorker) => Promise<StartedWorkerPass> {
  return async (worker) => {
    calls.workerIds.push(worker.workerId);
    const target = join(worker.tree, "src", FILE_OF_TASK[worker.taskId] ?? "");
    writeFileSync(target, readFileSync(target, "utf8") + `\n// ${worker.taskId} was here\n`);
    const outbox = join(worker.tree, outboxOfAWorker(SLUG));
    mkdirSync(outbox, { recursive: true });
    writeFileSync(
      join(outbox, `${worker.taskId}.checkpoint.json`),
      JSON.stringify({ task: worker.taskId }),
    );
    return {
      workerId: worker.workerId,
      pid: 0,
      runTokenHash: hash(runToken),
      ended: Promise.resolve("ended" as const),
    };
  };
}

/** The registry that records the identity entries as they are put. */
function aRecordingRegistry(fixture: Fixture, calls: DoorCalls): RegistryAccess {
  return {
    ...fixture.registry,
    put: (entry) => {
      calls.tokenHashes.push(entry.identity.runTokenHash);
      fixture.registry.put(entry);
    },
  };
}

/** The restart drive over the fixture, with the events collected. */
function driveOf(
  fixture: Fixture,
  search: LeftoverWorkersReport,
  events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[],
  calls: DoorCalls = { workerIds: [], tokenHashes: [] },
): TheRestartOfTheResumeDrive {
  const tail: TheTailOfTheResumeDrive = {
    plan: planOfGroup(fixture.runId, [...TASKS]),
    phase: 2,
    groupOrdinal: 1,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    taskTextAtLaunch: THE_TASK_LIST_AT_LAUNCH,
    secretsOf: theSecretsOfTheWorker({
      controlRoot: fixture.controlRoot,
      home: fixture.home,
      runId: fixture.runId,
    }),
    singleWriter: {
      taskList: join(fixture.workspace, TASK_LIST),
      phaseEvidence: [],
      notebook: join(fixture.controlRoot, "notebook.md"),
      handoff: join(fixture.home, ".specstride", "worker-roots", fixture.runId, "handoff.json"),
      workspacePart: join(fixture.workspace, ".specstride"),
    },
    tick: theTickOfTheTaskList(join(fixture.workspace, TASK_LIST)),
    runner: spawnRunner(),
    innerCheckSet: TASKS.map((task) => probeForTask(fixture, task)),
    containment: "C2",
    hash,
    emit: (type, data) => events.push({ type, data }),
  };
  return {
    tail,
    search,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: THE_RUN_TOKEN,
    runId: THE_ENGINE_RUN_ID,
    timeLimitSec: 120,
    enginePid: process.pid,
    engineStartedAtMs: Date.now(),
    workersAtATime: 2,
    guardScriptPath: join(fixture.root, "worker-guard.mjs"),
    registry: aRecordingRegistry(fixture, calls),
    promptOf: (worker) => `the prompt of ${worker.taskId}`,
    outputRootOf: (worker) => join(fixture.controlRoot, "outputs", worker.workerId),
    startDoor: doorOf(calls, THE_RUN_TOKEN),
  };
}

/** The open group of the fixture, discovered as the wiring discovers it. */
function openOf(fixture: Fixture): TheOpenParallelGroup {
  const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
  assert.ok(open !== undefined, "the open group was not found");
  return open;
}

/** The carried restart of the fixture's open group, with the drive facts. */
async function carryTheRestart(
  fixture: Fixture,
  search: LeftoverWorkersReport = aCleanSearch(),
  calls: DoorCalls = { workerIds: [], tokenHashes: [] },
): Promise<
  Extract<Awaited<ReturnType<typeof carryOutTheStartOrRestartOfTheOpenGroup>>, { carried: true }>
> {
  const events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[] = [];
  const carried = await carryOutTheStartOrRestartOfTheOpenGroup({
    open: openOf(fixture),
    controlRoot: fixture.controlRoot,
    drive: driveOf(fixture, search, events, calls),
  });
  assert.equal(carried.carried, true, `the restart was not carried: ${JSON.stringify(carried)}`);
  if (!carried.carried) throw new Error("unreachable");
  return carried;
}

/* ------------------------------------------------------------------ *
 * The shared assertions.
 * ------------------------------------------------------------------ */

/** The ledger closes whole: `group_closed` last, `seq` rising without a gap. */
function assertTheLedgerCloses(input: {
  readonly fixture: Fixture;
  readonly outcome: "closed" | "failed";
}): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const after = ledgerOf(input.fixture.controlRoot, input.fixture.runId);
  const last = after[after.length - 1];
  assert.equal(last?.kind, "group_closed", `the last record is ${String(last?.kind)}`);
  assert.equal((last?.data as Record<string, unknown>)["outcome"], input.outcome);
  for (let at = 1; at < after.length; at += 1) {
    const previous = after[at - 1]?.seq ?? 0;
    assert.equal(after[at]?.seq, previous + 1, `a gap before seq ${String(after[at]?.seq)}`);
  }
  return after;
}

/** The work of one task standing in the workspace, and its tick beside it. */
function assertTheTaskStands(fixture: Fixture, task: string, work: boolean, tick: boolean): void {
  const file = join(fixture.workspace, "src", FILE_OF_TASK[task] ?? "");
  assert.equal(
    readFileSync(file, "utf8").includes(`${task} was here`),
    work,
    `the work of ${task} standing in the workspace is ${String(work)}`,
  );
  const list = readFileSync(join(fixture.workspace, TASK_LIST), "utf8");
  assert.equal(
    list.includes(`- [x] ${task}`),
    tick,
    `the tick of ${task} standing in the task list is ${String(tick)}`,
  );
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("a relaunch resolves the interrupted run's places by the run's id and carries the restart", async () => {
  // THE DRIVE OF PAR-4 (SIGKILL mid-group, then a relaunch): the relaunch is
  // a NEW run id, so ITS scratch home is a different, empty directory. The
  // old derivation built the INTERRUPTED run's places from the calling
  // start's home and the restart refused with no tree of the group in any
  // ledger record — the group was never carried, the run went on without it.
  // The home of a run is a function of THE RUN'S OWN ID alone, so the
  // relaunch resolves the held trees exactly where the interrupted start
  // materialized them.
  const previous = process.env.SPECSTRIDE_PARALLEL_HOME;
  delete process.env.SPECSTRIDE_PARALLEL_HOME;
  const fixture = fixtureOf("relaunch-home", "run-restart-home");
  try {
    await openGroupCutAtTheStarts({ fixture });
    const open = openOf(fixture);
    // THE PLACES ARE THE INTERRUPTED RUN'S, derived from its id:
    assert.equal(
      open.places.workerRoot,
      join(theParallelHomeOfARun(fixture.runId), ".specstride", "worker-roots", fixture.runId),
      "discovery did not resolve the interrupted run's own worker root",
    );
    // ...and the derivation is per run: another run id resolves elsewhere, so
    // a relaunching engine's own home can never be mistaken for this one.
    assert.notEqual(
      theParallelHomeOfARun("run-some-other-relaunch"),
      theParallelHomeOfARun(fixture.runId),
    );
    // The held trees stand exactly there, and the carry restarts in them and
    // keeps — the whole restart, from a discovery no caller had to tell where
    // to look.
    assert.equal(
      treesStillHeld(open.places).filter((entry) => entry.runId === fixture.runId).length,
      2,
      "the cut trees are not held under the run's own home",
    );
    const carried = await carryTheRestart(fixture, aCleanSearch());
    assert.equal(carried.state, 2);
    assert.equal(carried.attempt.outcome, "kept");
  } finally {
    if (previous === undefined) delete process.env.SPECSTRIDE_PARALLEL_HOME;
    else process.env.SPECSTRIDE_PARALLEL_HOME = previous;
    fixture.cleanup();
  }
});

test("state 2 restarts every cut pass in its own tree and carries the tail whole", async () => {
  const fixture = fixtureOf("state-2", "run-restart-2");
  try {
    await openGroupCutAtTheStarts({ fixture });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(before.length, 3, "the fixture left the wrong number of records");
    const calls: DoorCalls = { workerIds: [], tokenHashes: [] };
    const carried = await carryTheRestart(fixture, aCleanSearch(), calls);
    assert.equal(carried.action, "end-the-recorded-processes");
    assert.equal(carried.state, 2);
    const attempt = carried.attempt;
    assert.equal(attempt.ok, true);
    assert.equal(attempt.outcome, "kept");
    assert.equal(attempt.directive, "keep");
    assert.deepEqual(attempt.keptUnits, [["T1", "T2"]]);
    assert.deepEqual(attempt.tasksOnTheMainLine, []);

    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    // THE LOST PASSES FIRST: one `worker_ended` of the cut pass per worker,
    // killed, with no tree id and an unknown usage (F143-FR-018), and only
    // then the records of the restarted passes.
    const kinds = after.slice(before.length).map((record) => record.kind);
    assert.deepEqual(kinds.slice(0, 7), [
      "worker_ended",
      "worker_ended",
      "worker_started",
      "worker_started",
      "worker_ended",
      "worker_ended",
      "group_barrier",
    ]);
    const lostPasses = after.filter((record) => {
      if (record.kind !== "worker_ended") return false;
      const data = record.data as Record<string, unknown>;
      return data["usage"] === "unknown" && data["treeId"] === "";
    });
    assert.equal(lostPasses.length, 2, "the lost passes were not recorded");
    for (const lost of lostPasses) {
      const data = lost.data as Record<string, unknown>;
      assert.equal(data["endCause"], "killed");
      assert.equal(data["treeId"], "");
    }
    // THE RESTARTED PASSES carry the pass ordinal of their restart: the
    // triple of the array, third place `1` — and `pass2`, not `pass1`.
    const restarted = after.filter((record) => record.kind === "worker_started");
    const byWorker = new Map<string, (typeof after)[number][]>();
    for (const record of restarted) {
      const workerId = String(record["workerId"]);
      const rows = byWorker.get(workerId) ?? [];
      rows.push(record);
      byWorker.set(workerId, rows);
    }
    for (const [workerId, rows] of byWorker) {
      assert.equal(rows.length, 2, `${workerId} did not start twice`);
      const first = rows[0]?.data as Record<string, unknown>;
      const second = rows[1]?.data as Record<string, unknown>;
      assert.deepEqual(second["passOrdinal"], [1, Number(workerId.slice(2)), 1]);
      assert.equal(second["passId"], `${GROUP_ID}:${workerId}:pass2`);
      // THE SAME TREE: the fingerprint the restart started from is the one
      // the lost pass started from — the store's tree, not a new one.
      assert.equal(second["treeFingerprint"], first["treeFingerprint"]);
    }
    // THE IDENTITY OF THE RESTARTED PASSES was registered under THIS start's
    // token: one `worker:<workerId>` entry per restarted pass, carrying the
    // hash of THIS start's token — not the interrupted run's. (The registry
    // removes the entries of the ended passes at the close, so the puts are
    // recorded as they happen.)
    assert.deepEqual(calls.workerIds.sort(), ["w-1", "w-2"]);
    assert.deepEqual([...new Set(calls.tokenHashes)], [hash(THE_RUN_TOKEN)]);
    assertTheTaskStands(fixture, "T1", true, true);
    assertTheTaskStands(fixture, "T2", true, true);
    const closed = assertTheLedgerCloses({ fixture, outcome: "closed" });
    assert.equal(
      closed.filter((record) => record.kind === "group_closed").length,
      1,
      "the group closed twice",
    );
    // The trees of the group were released, and nothing stands open.
    const places = placesOfTheParallelStore({
      controlRoot: fixture.controlRoot,
      runId: fixture.runId,
      home: fixture.home,
    });
    assert.equal(
      treesStillHeld(places).filter((entry) => entry.runId === fixture.runId).length,
      0,
      "a tree of the group was left held",
    );
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("a worker whose restart is used stays killed and its task returns to the main line", async () => {
  const fixture = fixtureOf("restart-used", "run-restart-2u");
  try {
    await openGroupCutAtTheStarts({ fixture, restartIndexOf: { "w-1": 1 } });
    const calls: DoorCalls = { workerIds: [], tokenHashes: [] };
    const events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[] =
      [];
    const base = driveOf(fixture, aCleanSearch(), events);
    const carried = await carryOutTheStartOrRestartOfTheOpenGroup({
      open: openOf(fixture),
      controlRoot: fixture.controlRoot,
      drive: {
        ...base,
        // The merge check of THIS start runs over the kept task only.
        tail: { ...base.tail, innerCheckSet: [probeForTask(fixture, "T2")] },
        startDoor: async (worker) => {
          calls.workerIds.push(worker.workerId);
          const inner = base.startDoor as (w: PreparedWorker) => Promise<StartedWorkerPass>;
          return inner(worker);
        },
      },
    });
    assert.equal(carried.carried, true);
    if (!carried.carried) return;
    // Only `w-2` was started again: `w-1`'s restart was used.
    assert.deepEqual(calls.workerIds, ["w-2"]);
    const attempt = carried.attempt;
    assert.equal(attempt.outcome, "kept");
    assert.equal(attempt.directive, "keep");
    // Only `T2` is kept: `w-1`'s restart was used, its pass stands killed,
    // and its task went back to the main line.
    assert.deepEqual(attempt.keptUnits, [["T2"]]);
    assert.deepEqual(attempt.tasksOnTheMainLine, ["T1"]);
    // `T1`'s work stands only in its TREE, which was never integrated: the
    // workspace holds neither the work nor the tick of it.
    assertTheTaskStands(fixture, "T1", false, false);
    assertTheTaskStands(fixture, "T2", true, true);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("a holder the search could not end refuses the restart, and nothing is written", async () => {
  const fixture = fixtureOf("holder-alive", "run-restart-hold");
  try {
    await openGroupCutAtTheStarts({ fixture });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    const search: LeftoverWorkersReport = {
      ...aCleanSearch(),
      stillAlive: [{ workerId: "w-1", pid: 4242 }],
    };
    const carried = await carryOutTheStartOrRestartOfTheOpenGroup({
      open: openOf(fixture),
      controlRoot: fixture.controlRoot,
      drive: driveOf(fixture, search, []),
    });
    assert.equal(carried.carried, false);
    if (carried.carried) return;
    assert.equal(carried.action, "end-the-recorded-processes");
    assert.equal(carried.state, 2);
    assert.ok(
      carried.because.includes("still answering"),
      `the reason does not name the holder: ${carried.because}`,
    );
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.deepEqual(
      after.map((record) => record.seq),
      before.map((record) => record.seq),
      "something was written over a group with a holder standing",
    );
  } finally {
    fixture.cleanup();
  }
});

test("a group with a real end beside a cut pass is not carried, and nothing is written", async () => {
  const fixture = fixtureOf("mixed", "run-restart-mixed");
  try {
    await openGroupCutAtTheStarts({ fixture, endW1: true });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    const carried = await carryOutTheStartOrRestartOfTheOpenGroup({
      open: openOf(fixture),
      controlRoot: fixture.controlRoot,
      drive: driveOf(fixture, aCleanSearch(), []),
    });
    assert.equal(carried.carried, false);
    if (carried.carried) return;
    assert.equal(carried.state, 2);
    assert.ok(
      carried.because.includes("w-1") && carried.because.includes("state 3"),
      `the reason does not name the left work: ${carried.because}`,
    );
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.deepEqual(
      after.map((record) => record.seq),
      before.map((record) => record.seq),
      "something was written over a mixed group",
    );
  } finally {
    fixture.cleanup();
  }
});

test("a crash between the group start and the first pass restarts every tree at index 0", async () => {
  const fixture = fixtureOf("before-first-pass", "run-restart-b");
  try {
    await openGroupCutAtTheStarts({ fixture, beforeTheFirstPass: true });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(before.length, 1, "the fixture left the wrong number of records");
    const carried = await carryTheRestart(fixture);
    assert.equal(carried.action, "end-the-recorded-processes");
    assert.equal(carried.state, 2);
    assert.equal(carried.attempt.outcome, "kept");
    assert.deepEqual(carried.attempt.keptUnits, [["T1", "T2"]]);
    // No lost pass stands: the first pass of every worker is its pass 1.
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    const lostPasses = after.filter((record) => {
      if (record.kind !== "worker_ended") return false;
      const data = record.data as Record<string, unknown>;
      return data["usage"] === "unknown" && data["treeId"] === "";
    });
    assert.equal(lostPasses.length, 0, "a lost pass was recorded where none was cut");
    for (const record of after.filter((row) => row.kind === "worker_started")) {
      const data = record.data as Record<string, unknown>;
      const workerId = String(record["workerId"]);
      assert.deepEqual(data["passOrdinal"], [1, Number(workerId.slice(2)), 0]);
      assert.equal(data["passId"], `${GROUP_ID}:${workerId}:pass1`);
    }
    // The restarted passes did their work: the edits stand in the workspace,
    // and the ticks of both tasks beside them.
    assertTheTaskStands(fixture, "T1", true, true);
    assertTheTaskStands(fixture, "T2", true, true);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("the wiring carries the restart as this start's group run", async () => {
  const fixture = fixtureOf("wiring-restart", "run-restart-wired");
  try {
    await openGroupCutAtTheStarts({ fixture });
    const lines: string[] = [];
    let doorCalls = 0;
    const wiring = parallelWiringOfTheAttempt({
      plan: planOfGroup(fixture.runId, [...TASKS]),
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
      taskTextAtLaunch: THE_TASK_LIST_AT_LAUNCH,
      taskTextOf: (taskId) => `the text of ${taskId}`,
      model: "stub",
      modelTierOrEffort: "stub",
      containment: "C2",
      runToken: THE_RUN_TOKEN,
      timeLimitMs: 120_000,
      enginePid: process.pid,
      engineStartedAtMs: Date.now(),
      registry: fixture.registry,
      guardScriptPath: join(fixture.root, "worker-guard.mjs"),
      hash,
      innerCheckSet: TASKS.map((task) => probeForTask(fixture, task)),
      startDoor: async (worker) => {
        doorCalls += 1;
        const outbox = join(worker.tree, outboxOfAWorker(SLUG));
        mkdirSync(outbox, { recursive: true });
        writeFileSync(
          join(outbox, `${worker.taskId}.checkpoint.json`),
          JSON.stringify({ task: worker.taskId }),
        );
        return {
          workerId: worker.workerId,
          pid: 0,
          runTokenHash: hash(THE_RUN_TOKEN),
          ended: Promise.resolve("ended" as const),
        };
      },
      runner: spawnRunner(),
      emit: () => {},
      say: (line) => lines.push(line),
      onClosed: () => {},
      onHandoff: () => {},
    });
    const ran = await wiring.startIfTheBoundaryIsClean();
    assert.equal(ran, true, "the carried restart did not run the group");
    assert.equal(doorCalls, 2, "the start door was not called once per cut pass");
    const said = lines.join("\n");
    assert.ok(said.includes(fixture.runId), `the line does not name the run: ${said}`);
    assert.ok(said.includes(GROUP_ID), `the line does not name the group: ${said}`);
    assert.ok(
      said.includes("end-the-recorded-processes"),
      `the line does not name the action: ${said}`,
    );
    assert.equal(
      wiring.layerOffForTheRun(),
      false,
      "the loop layer went off for a run the restart carried",
    );
    assertTheTaskStands(fixture, "T1", true, true);
    assertTheTaskStands(fixture, "T2", true, true);
    const closed = assertTheLedgerCloses({ fixture, outcome: "closed" });
    assert.equal(
      closed.filter((record) => record.kind === "group_closed").length,
      1,
      "the group closed twice",
    );
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
  } finally {
    fixture.cleanup();
  }
});
