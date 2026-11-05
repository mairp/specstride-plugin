/**
 * `RUN --RESET-COUNTS`, MOUNTED (step 5, part B item 5 — owed item 5 of
 * par-4; F119-FR-001's `run` row, F100-FR-045).
 *
 * THE GAP THE ITEM NAMES. The verb table documents the flag on `run`, the
 * usage line prints it, and the router's argument handling accepts it
 * (`ENGINE_FLAGS_WITHOUT_VALUE`) — and then NOTHING read it: `runFeature`
 * ignored the launch argv, so `run --reset-counts` was a half-mounted flag
 * that behaved exactly like `run`. Now the launch is read (`resetCountsOf
 * TheLaunch`), the flag reaches the parallel wiring, and the wiring hands it
 * to BOTH ends the counters join has — the fresh group attempt and the
 * carried resume — which `parallel-ledger-counters.test.ts` already pins at
 * the join itself:
 *
 *  - THE LAUNCH READ: the flag is a membership read of the launch argv, no
 *    value, exactly the flag the usage line prints;
 *  - THE CARRIED RESUME UNDER THE FLAG: a `run --reset-counts` that finds an
 *    open group of an earlier start carries the resume with the counters
 *    THIS start writes — ZEROES on the records it writes, whatever the
 *    interrupted run's ledger holds — while the same resume WITHOUT the flag
 *    carries the counts the ledger accumulates (F143-FR-028).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import { countersOnTheLastRecord, flatten } from "../../../core/src/parallel/counters.ts";
import { outboxOfAWorker, passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { initStore, treeStore } from "../../../tree-store/src/index.ts";
import { dataOfTheKind, openTheLedgerOfTheRun } from "../../src/engine/parallel-drive.ts";
import {
  placesOfTheParallelStore,
  prepareTheGroupTrees,
  theParallelHomeOfARun,
} from "../../src/engine/parallel-group.ts";
import { theOpenParallelGroupOf } from "../../src/engine/parallel-resume.ts";
import { parallelWiringOfTheAttempt } from "../../src/engine/parallel-wiring.ts";
import { resetCountsOfTheLaunch } from "../../src/engine/run-feature.ts";

/* ------------------------------------------------------------------ *
 * The launch read.
 * ------------------------------------------------------------------ */

test("the launch reads `--reset-counts` as the usage line prints it: a valueless flag, present or not", () => {
  assert.equal(resetCountsOfTheLaunch(["run", "--reset-counts"]), true);
  assert.equal(resetCountsOfTheLaunch(["--reset-counts"]), true);
  assert.equal(resetCountsOfTheLaunch(["run", "-w", "/ws", "--reset-counts"]), true);
  assert.equal(resetCountsOfTheLaunch(["run"]), false);
  assert.equal(resetCountsOfTheLaunch([]), false);
  // The flag takes no value, so a VALUE spelled with it is not the flag the
  // router accepted — the router refuses that shape before the launch.
  assert.equal(resetCountsOfTheLaunch(["run", "--reset-counts=true"]), false);
});

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry —
 * and a group of an EARLIER start standing open over it (state 2 of
 * F143-FR-025), with the counters of that start already on the ledger.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-reset-counts";
const GROUP_ID = "g-2-1";
const TASKS = ["T1", "T2"] as const;
const FILE_OF_TASK: Readonly<Record<string, string>> = { T1: "a.ts", T2: "b.ts" };
const THE_TASK_LIST_AT_LAUNCH =
  "## Phase 2: the group of the restart\n- [ ] T1 the first task\n- [ ] T2 the second task\n- [ ] T3 the third\n";
const THE_RUN_TOKEN = "run-token-of-the-resuming-engine";

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

function fixtureOf(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "par-reset-counts-"));
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
  git(workspace, "commit", "-q", "-m", "the reset counts bench");
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
    hash: "plan-hash-reset-counts",
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

function ledgerOf(fixture: Fixture): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(fixture.controlRoot, "runs", fixture.runId, "parallel-ledger.jsonl");
  try {
    return readAppendedRecords(readFileSync(file, "utf8")).records;
  } catch {
    return [];
  }
}

/** The interrupted start's cut: real trees, real starts, writer released. */
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
 * The facts of the resuming start, as `runFeature` builds them.
 * ------------------------------------------------------------------ */

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

/**
 * The wiring of a resuming `run`, with or without the flag on the launch
 * argv — the one difference, exactly as `runFeature` passes it.
 */
function wiringOf(fixture: Fixture, resetCounts: boolean) {
  return parallelWiringOfTheAttempt({
    plan: planOfGroup(fixture.runId),
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
    runner: spawnRunner(),
    // THE STUB DOOR of the restarted passes, as the restart test holds it:
    // the duties of a pass (the checkpoint in the worker's own outbox), a
    // pid every probe treats as gone, and an end that resolves at once.
    startDoor: async (worker) => {
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
    ...(resetCounts ? { resetCounts: true } : {}),
    emit: () => {},
    say: () => {},
    onClosed: () => {},
    onHandoff: () => {},
  });
}

test("a carried resume under `run --reset-counts` writes zeroes; without the flag it carries the ledger's counts", async () => {
  // THE CONTROL: without the flag, the resumed start carries the counts the
  // interrupted run's ledger accumulates (F143-FR-028).
  const control = fixtureOf();
  try {
    await openGroupCutAtTheStarts(control);
    const before = ledgerOf(control);
    assert.ok(before.some((record) => record.kind === "worker_started"));
    assert.equal(await wiringOf(control, false).startIfTheBoundaryIsClean(), true);
    const counters = flatten(countersOnTheLastRecord(ledgerOf(control)) ?? {});
    assert.ok(
      (counters["groupsStarted"] ?? 0) >= 1,
      `the control carries no group count: ${JSON.stringify(counters)}`,
    );
  } finally {
    control.cleanup();
  }

  // THE FLAG: the same open group, resumed under `run --reset-counts`.
  const flagged = fixtureOf();
  try {
    await openGroupCutAtTheStarts(flagged);
    assert.equal(await wiringOf(flagged, true).startIfTheBoundaryIsClean(), true);
    // THE RECORDS THE RESUMING START WROTE CARRY ZEROES (F100-FR-045): the
    // counters of the layer as the flag resets them, whatever the
    // interrupted run's ledger holds.
    const records = ledgerOf(flagged);
    assert.ok(records.length > 0);
    const counters = flatten(countersOnTheLastRecord(records) ?? {});
    assert.equal(counters["groupsStarted"], 0, JSON.stringify(counters));
    assert.equal(counters["groupsFailed"], 0);
    assert.equal(counters["cyclesSpent"], 0);
    assert.equal(
      Object.keys(counters).some(
        (name) => name.startsWith("passesStarted:") && counters[name] !== 0,
      ),
      false,
      `a pass count survived the reset: ${JSON.stringify(counters)}`,
    );
    // The group closed whole: the resumed run did its work.
    const kinds = records.map((record) => record.kind);
    assert.equal(kinds[kinds.length - 1], "group_closed");
    assert.equal(theOpenParallelGroupOf({ controlRoot: flagged.controlRoot }), undefined);
  } finally {
    flagged.cleanup();
  }
});
