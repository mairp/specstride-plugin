/**
 * THE RUN OF ONE GROUP OF ONE PHASE ATTEMPT, END TO END, over the REAL seams
 * (`parallel-attempt.ts`, step 3 of `prompts/specstride-parallel-units.md`).
 * The decisions are core's and the layer's; these tests pin THE JOIN — a real
 * tree store over a real git workspace and real worker trees, a real ledger
 * file on disk, real worker processes started through a stub door, a real
 * check runner spawning real commands:
 *
 *  - THE WHOLE GROUP runs through the whole state sequence, the ledger on
 *    disk holds every record of it in order, the `worker_started` records
 *    carry the facts of the start (F142-FR-028), the workspace holds the
 *    integrated work with the tasks ticked, and the group is kept as ONE
 *    unit whose before-critic input is the handoff text (F142-FR-069);
 *  - THE `worker_started` RECORDS name the pass ordinal — the triple
 *    `(groupOrdinal, taskPosition, restartIndex)` in the array form core's
 *    own `passOrdinalOf` writes — and a tree
 *    fingerprint taken after creation (F142-FR-028, F142-FR-063 (b));
 *  - EVERY RECORD OF THE LEDGER carries the counters of the layer as they
 *    stand after it, derived from the file, and they continue across a
 *    relaunch (F143-FR-028);
 *  - A REFUSED DELTA sends its task back to the main line while the rest of
 *    the group is kept (F142-FR-014);
 *  - AN OVERLAP fails the group with the directive `none`, writes no
 *    `merge_done` and runs no merge check (F143-FR-019);
 *  - A FAILED MERGE CHECK ends the group as `repair`, and the workspace
 *    still holds the integrated work (F142-FR-061);
 *  - A START REFUSAL ends what an aborted start left behind through the
 *    survivor search and closes the group as failed (F143-FR-018).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { writeWorkerGuardScript } from "../../src/engine/worker-supervisor.ts";
import { groupIdOfTheAttempt, runTheGroupOfTheAttempt } from "../../src/engine/parallel-attempt.ts";
import { WorkerStartRefused, type PreparedWorker } from "../../src/engine/parallel-group.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-attempt";
const RUN_ID = "run-attempt";

/** The hash of annex X §X.5, as the engine computes it. */
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

type Fixture = {
  readonly root: string;
  readonly workspace: string;
  readonly controlRoot: string;
  readonly home: string;
  readonly registry: RegistryAccess;
  readonly guardScriptPath: string;
  cleanup: () => void;
};

function git(cwd: string, ...argv: readonly string[]): void {
  const done = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(done.status, 0, `git ${argv.join(" ")} failed: ${done.stderr}`);
}

/** The fixture, with the workspace committed and the task list on disk. */
function fixtureOf(name: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `par-attempt-${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(workspace, "src", "c.ts"), "export const c = 3;\n");
  writeFileSync(
    join(workspace, TASK_LIST),
    "- [ ] 2-a the first task\n- [ ] 2-b the second task\n- [ ] 2-c the third\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the attempt bench");
  const controlRoot = join(root, "control");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(controlRoot, "runs", RUN_ID), { recursive: true });
  const registryPath = join(root, "procs.json");
  const guardScriptPath = join(root, "worker-guard.mjs");
  writeWorkerGuardScript(guardScriptPath);
  return {
    root,
    workspace,
    controlRoot,
    home,
    registry: registryAccessOf(registryPath),
    guardScriptPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
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
    adoptable: () =>
      Object.values(readAll()).filter((entry) => entry.registryClass === "adoptable"),
  };
}

/** The plan of phase 2: one group with the tasks named, `2-c` serial. */
function planOfGroup(
  groupTasks: readonly string[],
  scopeOf: (taskId: string) => readonly string[],
): ParallelPlan {
  const scope = (prefixes: readonly string[]) => ({
    prefixes: [...prefixes],
    source: "task-text" as const,
  });
  return {
    schema: "specstride.parallel-plan/1",
    runId: RUN_ID,
    hash: "plan-hash-attempt",
    workers: groupTasks.length,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: [...groupTasks] }],
        tasks: groupTasks.map((id) => ({ id, scope: scope(scopeOf(id)), checks: [] })),
        serial: ["2-c"],
        ceiling: groupTasks.length,
      },
    ],
  };
}

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

/** Tick the checkboxes of the task list, the way the spec-format adapter does. */
async function tickOfTheTaskList(
  workspace: string,
  taskIds: readonly string[],
): Promise<{ readonly ticked: readonly { readonly taskId: string; readonly line: number }[] }> {
  const path = join(workspace, TASK_LIST);
  if (!existsSync(path)) return { ticked: [] };
  const lines = readFileSync(path, "utf8").split("\n");
  const ticked: { taskId: string; line: number }[] = [];
  for (const taskId of taskIds) {
    const at = lines.findIndex((line) => line.startsWith(`- [ ] ${taskId} `));
    if (at === -1) continue;
    lines[at] = lines[at]!.replace("- [ ] ", "- [x] ");
    ticked.push({ taskId, line: at + 1 });
  }
  writeFileSync(path, lines.join("\n"));
  return { ticked };
}

/* ------------------------------------------------------------------ *
 * The stub door: real worker processes that edit their tree, write their
 * checkpoint, and end by themselves.
 * ------------------------------------------------------------------ */

const STUB_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const [outbox, taskId, treePath, target, addition] = process.argv.slice(1);
fs.mkdirSync(outbox, { recursive: true });
fs.writeFileSync(path.join(outbox, taskId + ".checkpoint.json"), JSON.stringify({ task: taskId }));
const at = path.join(treePath, target);
fs.writeFileSync(at, fs.readFileSync(at, "utf8") + addition);
`;

/** A start door whose workers edit `targetOf(taskId)` and end at once. */
function stubStartDoor(
  targetOf: (taskId: string) => string = (taskId) => `src/${taskId.slice(2)}.ts`,
  refusalOf?: (workerId: string) => string | undefined,
): { readonly start: (worker: PreparedWorker) => Promise<StartedWorkerPassStub> } {
  return {
    start: async (worker) => {
      const refused = refusalOf?.(worker.workerId);
      if (refused !== undefined) throw new WorkerStartRefused(worker.workerId, refused);
      const child = spawn(
        process.execPath,
        [
          "-e",
          STUB_SCRIPT,
          worker.outboxPath,
          worker.taskId,
          worker.tree,
          targetOf(worker.taskId),
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
        runTokenHash: hash("run-token-of-the-attempt"),
        ended,
      };
    },
  };
}
type StartedWorkerPassStub = {
  readonly workerId: string;
  readonly pid: number;
  readonly startTime?: string | undefined;
  readonly processGroup?: number | undefined;
  readonly runTokenHash: string;
  readonly ended: Promise<"ended" | "killed">;
};

/* ------------------------------------------------------------------ *
 * The input of one attempt, and the readers over the run's leftovers.
 * ------------------------------------------------------------------ */

/** The records of the ledger of the run, as the file holds them. */
function ledgerOf(controlRoot: string): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(controlRoot, "runs", RUN_ID, "parallel-ledger.jsonl");
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

/** The common input of one attempt over the fixture, with the doors given. */
function inputOf(
  fixture: Fixture,
  doors: {
    readonly start: (worker: PreparedWorker) => Promise<StartedWorkerPassStub>;
    readonly runner: CheckRunner;
    readonly innerCheckSet: readonly ManifestEntry[];
  },
): Parameters<typeof runTheGroupOfTheAttempt>[0] {
  return {
    controlRoot: fixture.controlRoot,
    runId: RUN_ID,
    home: fixture.home,
    plan: planOfGroup(["2-a", "2-b"], () => ["src"]),
    phase: 2,
    groupOrdinal: 1,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: "run-token-of-the-attempt",
    timeLimitSec: 120,
    promptOf: (worker) => `the prompt of ${worker.taskId}`,
    outputRootOf: (worker) => join(fixture.root, "outputs", worker.workerId),
    startDoor: doors.start,
    enginePid: process.pid,
    engineStartedAtMs: Date.now(),
    workersAtATime: 2,
    guardScriptPath: fixture.guardScriptPath,
    registry: fixture.registry,
    taskTextAtLaunch: "- [ ] 2-a the first task\n- [ ] 2-b the second task\n",
    secretsOf: (workerId, workerToken) => ({
      workerRoot: join(fixture.home, ".specstride", "worker-roots", RUN_ID),
      treeStore: join(fixture.controlRoot, "tree-store"),
      controlPlane: fixture.controlRoot,
      workerToken,
    }),
    singleWriter: {
      taskList: join(fixture.workspace, TASK_LIST),
      phaseEvidence: [],
      notebook: join(fixture.controlRoot, "notebook.md"),
      handoff: join(fixture.home, ".specstride", "worker-roots", RUN_ID, "handoff.json"),
      workspacePart: join(fixture.workspace, ".specstride"),
    },
    tick: (taskIds) => tickOfTheTaskList(fixture.workspace, taskIds),
    runner: doors.runner,
    innerCheckSet: doors.innerCheckSet,
    hash,
    emit: () => {},
    say: () => {},
  };
}

/** The probe of the inner check set: the workspace file holds the worker's mark. */
function probeOf(fixture: Fixture, marker: string): ManifestEntry {
  return {
    id: "the-probe",
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", "a.ts"),
      marker,
    ],
    phase: 2,
    timeLimitMs: 30_000,
  };
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("the whole group runs end to end and is kept as one unit", async () => {
  const fixture = fixtureOf("kept");
  try {
    const events: { readonly type: string; readonly workerId?: string }[] = [];
    const doors = {
      start: stubStartDoor().start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
    };
    const attempt = await runTheGroupOfTheAttempt({
      ...inputOf(fixture, doors),
      emit: (event) => events.push({ type: event.type, workerId: event.workerId }),
    });
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal(attempt.groupId, "g-2-1");
    assert.equal(groupIdOfTheAttempt(2, 1), "g-2-1");
    assert.equal(attempt.outcome, "kept");
    assert.equal(attempt.directive, "keep");
    assert.equal(attempt.layerOff, null);
    assert.deepEqual(attempt.keptUnits, [["2-a", "2-b"]]);
    assert.ok(attempt.handoff.includes("2-a"), "the handoff does not name the kept unit");
    assert.deepEqual(attempt.tasksOnTheMainLine, []);

    // The workspace holds the work of BOTH workers, and both tasks are ticked.
    const a = readFileSync(join(fixture.workspace, "src", "a.ts"), "utf8");
    const b = readFileSync(join(fixture.workspace, "src", "b.ts"), "utf8");
    assert.ok(a.includes("2-a was here"), "the first worker's edit is not in the workspace");
    assert.ok(b.includes("2-b was here"), "the second worker's edit is not in the workspace");
    const list = readFileSync(join(fixture.workspace, TASK_LIST), "utf8");
    assert.ok(list.includes("- [x] 2-a "), "the first task is not ticked");
    assert.ok(list.includes("- [x] 2-b "), "the second task is not ticked");

    // The ledger on disk holds the whole state sequence, in order.
    const kinds = ledgerOf(fixture.controlRoot).map((record) => record.kind);
    assert.deepEqual(kinds, [
      "group_started",
      "worker_started",
      "worker_started",
      "worker_ended",
      "worker_ended",
      "group_barrier",
      "audit_done",
      "merge_done",
      "apply_started",
      "applied",
      "ticks_applied",
      "merge_check_started",
      "merge_check_finished",
      "group_closed",
    ]);

    // The `worker_started` records carry the facts of the start.
    const records = ledgerOf(fixture.controlRoot);
    const starts = records.filter((record) => record.kind === "worker_started");
    assert.deepEqual(
      starts.map((record) => record.workerId),
      ["w-1", "w-2"],
    );
    for (const [at, record] of starts.entries()) {
      assert.equal(record.seq, at + 2, "the worker_started records are out of seq");
      assert.equal(record.data.task, at === 0 ? "2-a" : "2-b");
      assert.equal(record.data.passId, `g-2-1:w-${String(at + 1)}:pass1`);
      // The triple in the array form core's own `passOrdinalOf` writes and
      // the resume (F143-SC-002) and the counters (F143-FR-028) read.
      assert.deepEqual(record.data.passOrdinal, [1, at + 1, 0]);
      assert.notEqual(record.data.treeFingerprint, "", "no tree fingerprint was recorded");
      assert.equal(typeof record.data.pid, "number");
      assert.notEqual(record.data.startTime, "", "no start time was recorded");
    }

    // The live events, in the order the engine emitted them.
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "parallel.group.started",
        "parallel.worker.started",
        "parallel.worker.started",
        "parallel.worker.ended",
        "parallel.worker.ended",
        "parallel.integration",
        "parallel.integration",
        "parallel.integration",
        "parallel.integration",
        "parallel.integration",
        "parallel.group.ended",
      ],
    );
    assert.deepEqual(events.filter((event) => event.type === "parallel.integration").length, 5);

    // The worker trees of the group are gone from the worker root.
    const workerRoot = join(fixture.home, ".specstride", "worker-roots", RUN_ID);
    assert.equal(existsSync(join(workerRoot, "w-1")), false, "the first tree was not released");
    assert.equal(existsSync(join(workerRoot, "w-2")), false, "the second tree was not released");
    assert.equal(attempt.closed.treesRemoved.length, 2);
    assert.ok(attempt.counts.wallMs >= 0);
  } finally {
    releaseTheWriter(`${RUN_ID}:ledger`);
    fixture.cleanup();
  }
});

test("a refused delta sends its task back to the main line and the rest is kept", async () => {
  const fixture = fixtureOf("refused-delta");
  try {
    const doors = {
      // The second worker edits OUTSIDE its scope: the audit refuses it.
      start: stubStartDoor((taskId) =>
        taskId === "2-b" ? "src/c.ts" : `src/${taskId.slice(2)}.ts`,
      ).start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
    };
    const attempt = await runTheGroupOfTheAttempt({
      ...inputOf(fixture, doors),
      // The second worker's scope is `src/b`, but it edits `src/c.ts`: the
      // scope audit refuses it.
      plan: planOfGroup(["2-a", "2-b"], (taskId) => (taskId === "2-b" ? ["src/b"] : ["src"])),
    });
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal(attempt.outcome, "kept");
    assert.deepEqual(attempt.keptUnits, [["2-a"]]);
    assert.equal(attempt.audit.refused.length, 1);
    assert.equal(attempt.audit.refused[0]?.workerId, "w-2");
    assert.deepEqual(attempt.tasksOnTheMainLine, ["2-b"]);
    const kinds = ledgerOf(fixture.controlRoot).map((record) => record.kind);
    assert.ok(kinds.includes("merge_done"), "the accepted delta was not composed");
    assert.ok(listTicked(fixture, "2-a"), "the accepted task was not ticked");
    assert.ok(!listTicked(fixture, "2-b"), "the refused task was ticked");
  } finally {
    releaseTheWriter(`${RUN_ID}:ledger`);
    fixture.cleanup();
  }
});

test("an overlap fails the group with the directive `none` and no merge check", async () => {
  const fixture = fixtureOf("overlap");
  try {
    const doors = {
      // BOTH workers edit the same path: the composition refuses the later one.
      start: stubStartDoor(() => "src/a.ts").start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
    };
    const attempt = await runTheGroupOfTheAttempt({
      ...inputOf(fixture, doors),
    });
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.directive, "none");
    assert.equal(attempt.layerOff, null);
    assert.equal(attempt.integration.integrated, false);
    assert.deepEqual(attempt.tasksOnTheMainLine, ["2-a", "2-b"]);
    const kinds = ledgerOf(fixture.controlRoot).map((record) => record.kind);
    assert.ok(!kinds.includes("merge_done"), "an overlap must not compose");
    assert.ok(!kinds.includes("merge_check_started"), "an overlap must not run a merge check");
    assert.ok(!kinds.includes("applied"), "an overlap must not apply");
    assert.equal(kinds[kinds.length - 1], "group_closed");
    const closed = ledgerOf(fixture.controlRoot).find((record) => record.kind === "group_closed");
    assert.equal(closed?.data.outcome, "failed");
  } finally {
    releaseTheWriter(`${RUN_ID}:ledger`);
    fixture.cleanup();
  }
});

test("a failed merge check ends the group as repair, the work stays applied", async () => {
  const fixture = fixtureOf("repair");
  try {
    const doors = {
      start: stubStartDoor().start,
      runner: spawnRunner(),
      innerCheckSet: [
        {
          id: "the-probe",
          kind: "command",
          argv: ["node", "-e", "process.exit(1)"],
          phase: 2,
          timeLimitMs: 30_000,
        } as ManifestEntry,
      ],
    };
    const attempt = await runTheGroupOfTheAttempt({
      ...inputOf(fixture, doors),
    });
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal(attempt.outcome, "repair");
    assert.equal(attempt.directive, "repair");
    assert.deepEqual(attempt.keptUnits, []);
    assert.equal(attempt.handoff, "");
    assert.deepEqual(attempt.tasksOnTheMainLine, ["2-a", "2-b"]);
    // The workspace STILL holds the integrated work (F142-FR-061).
    assert.ok(
      readFileSync(join(fixture.workspace, "src", "a.ts"), "utf8").includes("2-a was here"),
    );
    const kinds = ledgerOf(fixture.controlRoot).map((record) => record.kind);
    assert.ok(kinds.includes("merge_check_finished"), "the merge check did not run");
    const closed = ledgerOf(fixture.controlRoot).find((record) => record.kind === "group_closed");
    assert.equal(closed?.data.outcome, "failed");
  } finally {
    releaseTheWriter(`${RUN_ID}:ledger`);
    fixture.cleanup();
  }
});

test("a start refusal ends what an aborted start left behind and closes as failed", async () => {
  const fixture = fixtureOf("refused-start");
  try {
    const doors = {
      start: stubStartDoor(
        (taskId) => `src/${taskId.slice(2)}.ts`,
        (workerId) => (workerId === "w-2" ? "the harness refused the second worker" : undefined),
      ).start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
    };
    const attempt = await runTheGroupOfTheAttempt({
      ...inputOf(fixture, doors),
    });
    assert.equal(attempt.ok, false);
    if (attempt.ok) return;
    assert.equal(attempt.groupId, "g-2-1");
    assert.equal(attempt.workerId, "w-2");
    assert.equal(attempt.endedByTheSearch.length, 1, "the survivor search ended nobody");
    assert.equal(attempt.endedByTheSearch[0]?.workerId, "w-1");
    const kinds = ledgerOf(fixture.controlRoot).map((record) => record.kind);
    assert.ok(kinds.includes("group_started"), "no group_started record");
    assert.ok(kinds.includes("group_closed"), "no group_closed record");
    const closed = ledgerOf(fixture.controlRoot).find((record) => record.kind === "group_closed");
    assert.equal(closed?.data.outcome, "failed");
    // The pid the search ended is really gone.
    const pid = attempt.endedByTheSearch[0]?.pid ?? 0;
    assert.equal(spawnSync("ps", ["-p", String(pid)]).status !== 0, true);
  } finally {
    releaseTheWriter(`${RUN_ID}:ledger`);
    fixture.cleanup();
  }
});

/** Whether one checkbox of the task list is ticked. */
function listTicked(fixture: Fixture, taskId: string): boolean {
  return readFileSync(join(fixture.workspace, TASK_LIST), "utf8").includes(`- [x] ${taskId} `);
}
