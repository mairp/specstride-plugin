/**
 * THE STOP THE CARRIED RESTART RUNS UNDER (step 5, part B item 4 — owed item
 * 4 of par-4; F143-FR-026), over the REAL seams of
 * `parallel-resume-restart.test.ts`: a real git workspace, a real tree store,
 * a real ledger file written through the ONE WRITER, and the real poll of
 * `runTheGroupWorkers`.
 *
 * THE GAP THE ITEM NAMES. The fresh group polled `inbox:stop` at its pass
 * boundaries; the carried restart — states 1 and 2 of F143-FR-025, the
 * states a worker process has to start for — started its restarted passes
 * WITHOUT a poll, so a request written during a resumed restart was seen
 * only at the next fresh boundary. Now the restart carries the same
 * `stopRequestPath` the fresh group runs under:
 *
 *  - A CLEAN STOP at a polled boundary changes nothing inside the restart:
 *    the restarted workers run to the ends of their passes, the barrier, the
 *    audits, the composition, the ticks, the merge check and the
 *    `group_closed` all run (the group closes WHOLE), and the carried attempt
 *    is marked `stopAfterTheGroup: true` — the stop takes effect at the
 *    boundary after the group;
 *  - `STOP --NOW` at a polled boundary ends the restarted workers through
 *    the ladder and leaves the group to the states of F143-FR-025: no
 *    barrier, no integration, no `worker_ended`, no `group_closed` — the
 *    ledger stands as the cut left it, and the answer is the CUT ITSELF
 *    (`stoppedByStopNow`), which the wiring answers as the run's stop.
 *
 * THE ENGINE'S OWN RULES HOLD THROUGHOUT: the request is read at the
 * boundaries the wait already runs, never inside a pass (F122-FR-029); the
 * record kinds are never widened and the ledger's `seq` never gaps.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import {
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";
import { outboxOfAWorker, passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { initStore, treeStore } from "../../../tree-store/src/index.ts";
import { writeStopRequest } from "../../src/run-control/stop-request-writer.ts";
import {
  carryOutTheStartOrRestartOfTheOpenGroup,
  type TheRestartOfTheResumeDrive,
} from "../../src/engine/parallel-resume-restart.ts";
import { dataOfTheKind, openTheLedgerOfTheRun } from "../../src/engine/parallel-drive.ts";
import {
  placesOfTheParallelStore,
  prepareTheGroupTrees,
  theParallelHomeOfARun,
  type PreparedWorker,
  type StartedWorkerPass,
} from "../../src/engine/parallel-group.ts";
import {
  theOpenParallelGroupOf,
  type TheOpenParallelGroup,
} from "../../src/engine/parallel-resume.ts";
import type { TheTailOfTheResumeDrive } from "../../src/engine/parallel-resume-drive.ts";
import { theSecretsOfTheWorker, theTickOfTheTaskList } from "../../src/engine/parallel-wiring.ts";
import type { LeftoverWorkersReport } from "../../src/engine/group-run.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-resume-stop";
const GROUP_ID = "g-2-1";
const TASKS = ["T1", "T2"] as const;
const FILE_OF_TASK: Readonly<Record<string, string>> = { T1: "a.ts", T2: "b.ts" };
const THE_TASK_LIST_AT_LAUNCH =
  "## Phase 2: the group of the restart\n- [ ] T1 the first task\n- [ ] T2 the second task\n- [ ] T3 the third\n";
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
  /** The path of `inbox:stop`, resolved through the layout table. */
  readonly stopRequestPath: string;
  readonly registry: RegistryAccess;
  cleanup: () => void;
};

function git(cwd: string, ...argv: readonly string[]): void {
  const done = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(done.status, 0, `git ${argv.join(" ")} failed: ${done.stderr}`);
}

function fixtureOf(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "par-resume-stop-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(workspace, TASK_LIST), THE_TASK_LIST_AT_LAUNCH);
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the resume stop bench");
  const controlRoot = join(root, "control");
  const runId = "run-cut-mid-group";
  // THE HOME IS THIS FIXTURE'S OWN. `theParallelHomeOfARun` falls back to a
  // HOST-GLOBAL path under tmpdir() when `SPECSTRIDE_PARALLEL_HOME` is
  // unset, so two fixtures sharing a run id share one worker-roots
  // directory — and each cleanup deletes the other's trees while they are
  // in flight (observed: a concurrent file's barrier snapshotted a tree
  // this file's cleanup was deleting, and the snapshot died with
  // `fatal: not a git repository`). The env seam pins the home inside the
  // fixture root: the trees are this fixture's own, the cleanup is total,
  // and no assertion changes.
  const previousParallelHome = process.env.SPECSTRIDE_PARALLEL_HOME;
  process.env.SPECSTRIDE_PARALLEL_HOME = join(root, "parallel-home");
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
  return {
    root,
    workspace,
    controlRoot,
    home,
    runId,
    stopRequestPath: resolveLogicalName(
      "inbox:stop",
      {},
      rootPathsOf({
        home: root,
        workspaceRealPath: workspace,
        workspaceId: "",
        controlRoot,
        workerRoot: "",
      }),
    ),
    registry: {
      get: (logicalName) => readAll()[logicalName],
      put: (entry) => {
        const all = readAll();
        all[entry.logicalName] = entry;
        writeFileSync(registry, JSON.stringify(all, null, 2));
      },
      remove: (logicalName) => {
        const all = readAll();
        if (all[logicalName] === undefined) return;
        delete all[logicalName];
        writeFileSync(registry, JSON.stringify(all, null, 2));
      },
      adoptable: () => Object.values(readAll()),
    },
    cleanup: () => {
      if (previousParallelHome === undefined) delete process.env.SPECSTRIDE_PARALLEL_HOME;
      else process.env.SPECSTRIDE_PARALLEL_HOME = previousParallelHome;
      rmSync(root, { recursive: true, force: true });
      rmSync(join(home, ".specstride", "worker-roots", runId), { recursive: true, force: true });
    },
  };
}

/** The plan of phase 2: one group holding the tasks named, `T3` serial. */
function planOfGroup(runId: string): ParallelPlan {
  const scope = { prefixes: ["src"], source: "task-text" as const };
  return {
    schema: "specstride.parallel-plan/1",
    runId,
    hash: "plan-hash-resume-stop",
    workers: 2,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: [...TASKS] }],
        tasks: TASKS.map((id) => ({ id, scope, checks: [] })),
        serial: ["T3"],
        ceiling: 2,
      },
    ],
  };
}

/** The records of a run's ledger, as the file holds them. */
function ledgerOf(fixture: Fixture): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(fixture.controlRoot, "runs", fixture.runId, "parallel-ledger.jsonl");
  try {
    return readAppendedRecords(readFileSync(file, "utf8")).records;
  } catch {
    return [];
  }
}

/** The kinds of the records, in the order the file holds them. */
function kindsOf(fixture: Fixture): readonly string[] {
  return ledgerOf(fixture).map((record) => record.kind);
}

/* ------------------------------------------------------------------ *
 * A REAL GROUP CUT IN THE MIDDLE OF ITS WORKERS: real trees, real
 * checkpoints in the outboxes, `worker_started` records on the ledger of
 * the interrupted run, and the writer released — the state an engine leaves
 * when it dies mid-group (state 2 of F143-FR-025).
 * ------------------------------------------------------------------ */

async function openGroupCutAtTheStarts(fixture: Fixture): Promise<void> {
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
  let position = 0;
  for (const worker of prepared.workers) {
    position += 1;
    const treeId = await store.snapshot(worker.tree);
    await ledger.writer.record(
      "worker_started",
      dataOfTheKind("worker_started", {
        workerId: worker.workerId,
        task: worker.taskId,
        passId: `${GROUP_ID}:${worker.workerId}:pass1`,
        passOrdinal: [
          ...passOrdinalOf({ groupOrdinal: 1, taskPosition: position, restartIndex: 0 }),
        ],
        treeFingerprint: treeId,
        pid: 0,
        startTime: "",
      }),
    );
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
 * A stub start door whose passes do the task's work, re-write the checkpoint
 * into the worker's own outbox and end. `holdForMs` holds the FIRST pass in
 * flight (a promise that resolves only after the delay), so the wait loop's
 * poll boundary lands while a pass is genuinely running — the stop is seen
 * DURING the restart, never after its last pass ended.
 */
function doorOf(
  fixture: Fixture,
  now: boolean,
  holdForMs: number,
): (worker: PreparedWorker) => Promise<StartedWorkerPass> {
  let first = true;
  return async (worker) => {
    if (first) {
      first = false;
      // THE REQUEST THE `STOP` COMMAND WROTE, at a boundary the restart's
      // wait is about to poll: the pass of the first worker is in flight.
      writeStopRequest(fixture.stopRequestPath, { now });
    }
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
      runTokenHash: hash(THE_RUN_TOKEN),
      ended:
        holdForMs === 0
          ? Promise.resolve("ended" as const)
          : new Promise((done) => setTimeout(() => done("ended" as const), holdForMs)),
    };
  };
}

/** The restart drive over the fixture, with the events collected. */
function driveOf(
  fixture: Fixture,
  now: boolean,
  holdForMs: number,
  events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[],
): TheRestartOfTheResumeDrive {
  const tail: TheTailOfTheResumeDrive = {
    plan: planOfGroup(fixture.runId),
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
    search: aCleanSearch(),
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
    registry: fixture.registry,
    promptOf: (worker) => `the prompt of ${worker.taskId}`,
    outputRootOf: (worker) => join(fixture.controlRoot, "outputs", worker.workerId),
    startDoor: doorOf(fixture, now, holdForMs),
  };
}

/** The open group of the fixture, discovered as the wiring discovers it. */
function openOf(fixture: Fixture): TheOpenParallelGroup {
  const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
  assert.ok(open !== undefined, "the open group was not found");
  return open;
}

/** The carried restart of the fixture's open group, under a stop request. */
async function carryTheRestart(
  fixture: Fixture,
  now: boolean,
  holdForMs: number,
): Promise<
  Extract<Awaited<ReturnType<typeof carryOutTheStartOrRestartOfTheOpenGroup>>, { carried: true }>
> {
  const events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[] = [];
  const carried = await carryOutTheStartOrRestartOfTheOpenGroup({
    open: openOf(fixture),
    controlRoot: fixture.controlRoot,
    stopRequestPath: fixture.stopRequestPath,
    drive: driveOf(fixture, now, holdForMs, events),
  });
  assert.equal(carried.carried, true, `the restart was not carried: ${JSON.stringify(carried)}`);
  if (!carried.carried) throw new Error("unreachable");
  return carried;
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("a clean stop at a polled boundary of the carried restart: the group closes whole and the attempt is marked stopAfterTheGroup", async () => {
  const fixture = fixtureOf();
  try {
    await openGroupCutAtTheStarts(fixture);
    const before = ledgerOf(fixture);
    assert.equal(
      before.some((record) => record.kind === "group_closed"),
      false,
    );

    const carried = await carryTheRestart(fixture, false, 150);

    // THE ANSWER: the tail's attempt, marked for the boundary after the
    // group (the wiring reads it and decides the run's stop there).
    assert.equal(carried.attempt.ok, true);
    assert.equal(
      (carried.attempt as { readonly stopAfterTheGroup?: boolean }).stopAfterTheGroup,
      true,
      "the carried attempt does not mark the clean stop",
    );
    // THE GROUP CLOSED WHOLE: the barrier, the audits, the ticks and the
    // merge check all ran — a clean stop changes nothing inside the group.
    const kinds = kindsOf(fixture);
    assert.equal(
      kinds[kinds.length - 1],
      "group_closed",
      `the last record is ${String(kinds[kinds.length - 1])}`,
    );
    const closed = ledgerOf(fixture)[kinds.length - 1];
    assert.equal((closed?.data as Record<string, unknown>)["outcome"], "closed");
    // `seq` rises without a gap across the restart (F143-FR-024).
    const records = ledgerOf(fixture);
    for (let at = 1; at < records.length; at += 1) {
      const previous = records[at - 1]?.seq ?? 0;
      assert.equal(records[at]?.seq, previous + 1);
    }
    // The restarted passes ran and their work stands, ticked.
    for (const task of TASKS) {
      const file = join(fixture.workspace, "src", FILE_OF_TASK[task] ?? "");
      assert.ok(readFileSync(file, "utf8").includes(`${task} was here`), `${task} did not run`);
      assert.ok(readFileSync(join(fixture.workspace, TASK_LIST), "utf8").includes(`- [x] ${task}`));
    }
    assert.ok(
      kinds.filter((kind) => kind === "worker_ended").length >= 2,
      "the passes did not end",
    );
  } finally {
    fixture.cleanup();
  }
});

test("`stop --now` at a polled boundary of the carried restart: the workers end, the group is left to the resume states, the answer is the cut itself", async () => {
  const fixture = fixtureOf();
  try {
    await openGroupCutAtTheStarts(fixture);
    const beforeKinds = kindsOf(fixture);

    const carried = await carryTheRestart(fixture, true, 0);

    // THE ANSWER IS THE CUT ITSELF: nothing closed, nothing integrated.
    assert.equal(
      (carried.attempt as { readonly stoppedByStopNow?: boolean }).stoppedByStopNow,
      true,
      "the carried attempt is not the cut",
    );
    // THE GROUP IS LEFT TO THE STATES OF F143-FR-025: no barrier, no
    // integration, no close — the ledger ends where the cut left it. The
    // only `worker_ended` records are the LOST-PASS records the restart
    // wrote ahead of the restarts (endCause `killed`, no tree id): the
    // restarted passes themselves stand UNENDED.
    const kinds = kindsOf(fixture);
    const ended = ledgerOf(fixture).filter((record) => record.kind === "worker_ended");
    assert.equal(ended.length, 2, "an ended record stands beyond the lost-pass records");
    for (const record of ended) {
      const data = record.data as Record<string, unknown>;
      assert.equal(data["endCause"], "killed");
      assert.equal(data["treeId"], "");
    }
    assert.equal(kinds.includes("group_barrier"), false, "the barrier ran past the cut");
    assert.equal(kinds.includes("group_closed"), false, "the group was closed past the cut");
    assert.equal(
      kinds[kinds.length - 1],
      "worker_started",
      `the last record is ${String(kinds[kinds.length - 1])}`,
    );
    // The restarted passes were RECORDED as starts (the restart happened),
    // and the seq chain of the file stands without a gap (F143-FR-024).
    assert.equal(
      kinds.filter((kind) => kind === "worker_started").length,
      beforeKinds.filter((kind) => kind === "worker_started").length + 2,
    );
    const records = ledgerOf(fixture);
    for (let at = 1; at < records.length; at += 1) {
      const previous = records[at - 1]?.seq ?? 0;
      assert.equal(records[at]?.seq, previous + 1);
    }
    // The request stands for the next engine start (the command leaves it).
    assert.ok(readFileSync(fixture.stopRequestPath, "utf8").includes(`"now": true`));
  } finally {
    fixture.cleanup();
  }
});
