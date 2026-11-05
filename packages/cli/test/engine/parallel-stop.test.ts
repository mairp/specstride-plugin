/**
 * THE STOP JOIN (step 4, F143-FR-026) — the stop request a group runs under,
 * over the REAL seams: a real request file in the inbox of the fixture, real
 * worker processes started through a stub door, a real tree store over a real
 * git workspace, a real ledger file on disk. Pinned here:
 *
 *  - THE READER: an absent request is no stop; a request that stands is read
 *    WHOLE — the empty request and an unreadable one are a clean stop with
 *    every default (F100-FR-065), and `now` is the field of the request;
 *  - A CLEAN STOP standing while the group runs changes NOTHING inside the
 *    group: the live workers run to the ends of their passes, the barrier,
 *    the integration and the merge check run through `group_closed`, and the
 *    attempt's result carries `stopAfterTheGroup` for the boundary that
 *    follows (F143-FR-026);
 *  - `stop --now` ends every live worker after the identity check and leaves
 *    the group TO THE STATES OF F143-FR-025: no barrier, no integration, no
 *    `group_closed` — the ledger stands as the kill left it, the workspace
 *    holds nothing of the workers, the trees stand, and NO SURVIVOR is left;
 *  - THE WIRING reports what the group saw (`theStopSeenOfTheGroup`), so the
 *    composition root can end the run with exit 6 / `stop_flag` at the
 *    boundary after the group — and reports nothing where no request stood.
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
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { writeWorkerGuardScript } from "../../src/engine/worker-supervisor.ts";
import { runTheGroupOfTheAttempt } from "../../src/engine/parallel-attempt.ts";
import { theStopRequestAsItStands } from "../../src/engine/parallel-stop.ts";
import {
  parallelWiringOfTheAttempt,
  type ParallelWiringInput,
} from "../../src/engine/parallel-wiring.ts";
import type { PreparedWorker } from "../../src/engine/parallel-group.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry,
 * and the inbox the `stop` command writes into.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-stop";
const RUN_TOKEN = "run-token-of-the-stop";

/** The hash of annex X §X.5, as the engine computes it. */
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

type Fixture = {
  readonly root: string;
  readonly workspace: string;
  readonly controlRoot: string;
  readonly home: string;
  readonly runId: string;
  readonly registry: RegistryAccess;
  readonly guardScriptPath: string;
  /** The path of `inbox:stop` of this workspace, as the layout table resolves it. */
  readonly stopRequestPath: string;
  cleanup: () => void;
};

function git(cwd: string, ...argv: readonly string[]): void {
  const done = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(done.status, 0, `git ${argv.join(" ")} failed: ${done.stderr}`);
}

/**
 * The fixture. `runId` differs per test: the one-writer registry of the
 * ledger is keyed by the run id IN THIS PROCESS, so a test whose attempt is
 * still settling must never collide with the next test's ledger.
 */
function fixtureOf(name: string, runId = `run-stop-${name}`): Fixture {
  const root = mkdtempSync(join(tmpdir(), `par-stop-${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(
    join(workspace, TASK_LIST),
    "- [ ] 2-a the first task\n- [ ] 2-b the second task\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the stop bench");
  const controlRoot = join(root, "control");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(controlRoot, "runs", runId), { recursive: true });
  // THE INBOX, as the layout table resolves `inbox:stop` against this
  // control root — present, so a written request lands where the poll reads.
  mkdirSync(join(controlRoot, "inbox"), { recursive: true });
  const registryPath = join(root, "procs.json");
  const guardScriptPath = join(root, "worker-guard.mjs");
  writeWorkerGuardScript(guardScriptPath);
  return {
    root,
    workspace,
    controlRoot,
    home,
    runId,
    registry: registryAccessOf(registryPath),
    guardScriptPath,
    // `<control>/inbox/stop.request` — the path of `inbox:stop` (annex B §B.5).
    stopRequestPath: join(controlRoot, "inbox", "stop.request"),
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

/** The plan of phase 2: one group with both tasks, no serial remainder. */
function planOfGroup(runId: string): ParallelPlan {
  const scope = (prefixes: readonly string[]) => ({
    prefixes: [...prefixes],
    source: "task-text" as const,
  });
  return {
    schema: "specstride.parallel-plan/1",
    runId,
    hash: "plan-hash-stop",
    workers: 2,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: ["2-a", "2-b"] }],
        tasks: [
          { id: "2-a", scope: scope(["src"]), checks: [] },
          { id: "2-b", scope: scope(["src"]), checks: [] },
        ],
        serial: [],
        ceiling: 2,
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
 * The stub door: real worker processes that WAIT, then do the work of the
 * task and end. A pass the kill reaches mid-wait leaves no edit behind.
 * ------------------------------------------------------------------ */

const STUB_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const [outbox, taskId, treePath, target, addition, delayMs] = process.argv.slice(1);
fs.mkdirSync(outbox, { recursive: true });
setTimeout(() => {
  fs.writeFileSync(path.join(outbox, taskId + ".checkpoint.json"), JSON.stringify({ task: taskId }));
  const at = path.join(treePath, target);
  fs.writeFileSync(at, fs.readFileSync(at, "utf8") + addition);
}, Number(delayMs));
`;

type StartedWorkerPassStub = {
  readonly workerId: string;
  readonly pid: number;
  readonly startTime?: string | undefined;
  readonly processGroup?: number | undefined;
  readonly runTokenHash: string;
  readonly ended: Promise<"ended" | "killed">;
};

/** A start door whose workers wait `delayMs`, then edit and end. */
function stubStartDoor(delayMs: number): {
  readonly start: (worker: PreparedWorker) => Promise<StartedWorkerPassStub>;
  readonly pids: number[];
  readonly ends: readonly Promise<"ended" | "killed">[];
} {
  const pids: number[] = [];
  const ends: Promise<"ended" | "killed">[] = [];
  return {
    pids,
    ends,
    start: async (worker) => {
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
          String(delayMs),
        ],
        { detached: true, stdio: "ignore" },
      ) as ChildProcess & { pid: number };
      const pid = child.pid as number;
      child.unref();
      pids.push(pid);
      const ended = new Promise<"ended" | "killed">((done) => {
        child.once("exit", (code) => done(code === 0 ? "ended" : "killed"));
      });
      ends.push(ended);
      return {
        workerId: worker.workerId,
        pid,
        startTime: new Date().toISOString(),
        processGroup: pid,
        runTokenHash: hash(RUN_TOKEN),
        ended,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The input of one attempt, and the readers over the run's leftovers.
 * ------------------------------------------------------------------ */

/** The records of the ledger of the run, as the file holds them. */
function ledgerOf(
  controlRoot: string,
  runId: string,
): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = join(controlRoot, "runs", runId, "parallel-ledger.jsonl");
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
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

/** The common input of one attempt over the fixture, with the doors given. */
function inputOf(
  fixture: Fixture,
  doors: {
    readonly start: (worker: PreparedWorker) => Promise<StartedWorkerPassStub>;
    readonly runner: CheckRunner;
    readonly innerCheckSet: readonly ManifestEntry[];
    readonly stopRequestPath?: string | undefined;
  },
): Parameters<typeof runTheGroupOfTheAttempt>[0] {
  return {
    controlRoot: fixture.controlRoot,
    runId: fixture.runId,
    home: fixture.home,
    plan: planOfGroup(fixture.runId),
    phase: 2,
    groupOrdinal: 1,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: RUN_TOKEN,
    timeLimitSec: 120,
    promptOf: (worker) => `the prompt of ${worker.taskId}`,
    outputRootOf: (worker) => join(fixture.root, "outputs", worker.workerId),
    startDoor: doors.start,
    enginePid: process.pid,
    engineStartedAtMs: startedAtMsOf(process.pid),
    workersAtATime: 2,
    guardScriptPath: fixture.guardScriptPath,
    registry: fixture.registry,
    taskTextAtLaunch: "- [ ] 2-a the first task\n- [ ] 2-b the second task\n",
    secretsOf: (workerId, workerToken) => ({
      workerRoot: join(fixture.home, ".specstride", "worker-roots", fixture.runId),
      treeStore: join(fixture.controlRoot, "tree-store"),
      controlPlane: fixture.controlRoot,
      workerToken,
    }),
    singleWriter: {
      taskList: join(fixture.workspace, TASK_LIST),
      phaseEvidence: [],
      notebook: join(fixture.controlRoot, "notebook.md"),
      handoff: join(fixture.home, ".specstride", "worker-roots", fixture.runId, "handoff.json"),
      workspacePart: join(fixture.workspace, ".specstride"),
    },
    tick: (taskIds) => tickOfTheTaskList(fixture.workspace, taskIds),
    runner: doors.runner,
    innerCheckSet: doors.innerCheckSet,
    hash,
    ...(doors.stopRequestPath === undefined ? {} : { stopRequestPath: doors.stopRequestPath }),
    emit: () => {},
    say: () => {},
  };
}

/**
 * Write a request into the inbox of the fixture, `afterMs` from now, and
 * give the timer back so the test can clear it in its `finally` — a timer
 * that outlives the test writes into a tree the cleanup has removed.
 */
function writeTheStopRequestLater(
  fixture: Fixture,
  request: { readonly now: boolean },
  afterMs: number,
): NodeJS.Timeout {
  return setTimeout(() => {
    writeFileSync(
      fixture.stopRequestPath,
      JSON.stringify({
        schema: "specstride.inbox/1",
        type: "stop",
        at: "2026-11-04T00:00:00.000Z",
        now: request.now,
        jobs: false,
      }),
    );
  }, afterMs);
}

/** True when the process of `pid` still answers (a SURVIVOR of the kill). */
function stillAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The start time of a pid in ms, read the way the kernel and the guards read
 * it (annex F): a worker that lives past a guard's first poll must see an
 * engine record that matches /proc, or its own guard ends it as a stranger.
 */
function startedAtMsOf(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).split(" ");
    const ticks = Number(fields[19]);
    const btime = Number(
      (
        readFileSync("/proc/stat", "utf8")
          .split("\n")
          .find((line) => line.startsWith("btime ")) ?? ""
      ).slice(6),
    );
    if (!Number.isFinite(ticks) || !Number.isFinite(btime) || btime <= 0) return Date.now();
    return Math.round(btime * 1000 + (ticks / 100) * 1000);
  } catch {
    return Date.now();
  }
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("the reader: an absent request is no stop, a standing one is read whole", () => {
  const fixture = fixtureOf("reader");
  try {
    // Absent — the poll must not mistake "no request" for a clean stop.
    assert.deepEqual(theStopRequestAsItStands(fixture.stopRequestPath), {
      asked: false,
      now: false,
      jobs: false,
    });

    // The EMPTY request (a zero-byte file, F100-FR-065): a clean stop with
    // every default — asked, `now` false.
    writeFileSync(fixture.stopRequestPath, "");
    assert.deepEqual(theStopRequestAsItStands(fixture.stopRequestPath), {
      asked: true,
      now: false,
      jobs: false,
    });

    // Bytes that are no request at all: a clean stop with every default.
    writeFileSync(fixture.stopRequestPath, "{not json");
    assert.deepEqual(theStopRequestAsItStands(fixture.stopRequestPath), {
      asked: true,
      now: false,
      jobs: false,
    });

    // The full request of `stop --now`.
    writeFileSync(
      fixture.stopRequestPath,
      JSON.stringify({
        schema: "specstride.inbox/1",
        type: "stop",
        at: "2026-11-04T00:00:00.000Z",
        now: true,
        jobs: false,
      }),
    );
    assert.deepEqual(theStopRequestAsItStands(fixture.stopRequestPath), {
      asked: true,
      now: true,
      jobs: false,
    });
  } finally {
    fixture.cleanup();
  }
});

test("a clean stop standing mid-group lets the workers and the close run whole, and says so", async () => {
  const fixture = fixtureOf("clean");
  // The request is written while the workers are in their passes (they wait
  // 900 ms before their edit): the poll reads it at a boundary.
  const timer = writeTheStopRequestLater(fixture, { now: false }, 350);
  try {
    const doors = {
      start: stubStartDoor(900).start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
      stopRequestPath: fixture.stopRequestPath,
    };

    const attempt = await runTheGroupOfTheAttempt(inputOf(fixture, doors));
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal("stoppedByStopNow" in attempt, false, "a clean stop must never cut the group");
    assert.equal(attempt.outcome, "kept", "the group must run whole under a clean stop");
    assert.equal(
      attempt.stopAfterTheGroup,
      true,
      "the attempt must say that a stop stood and takes effect after the group",
    );

    // The workers ran to the ends of their passes: the workspace holds both
    // edits, and the group closed whole.
    assert.ok(
      readFileSync(join(fixture.workspace, "src", "a.ts"), "utf8").includes("2-a was here"),
    );
    assert.ok(
      readFileSync(join(fixture.workspace, "src", "b.ts"), "utf8").includes("2-b was here"),
    );
    const kinds = ledgerOf(fixture.controlRoot, fixture.runId).map((record) => record.kind);
    assert.equal(
      kinds[kinds.length - 1],
      "group_closed",
      "the group must close under a clean stop",
    );
    assert.ok(
      kinds.includes("merge_check_finished"),
      "the merge check must run under a clean stop",
    );
  } finally {
    clearTimeout(timer);
    fixture.cleanup();
  }
});

test("stop --now ends the workers after the identity check and leaves the group to F143-FR-025", async () => {
  const fixture = fixtureOf("now");
  const timer = writeTheStopRequestLater(fixture, { now: true }, 350);
  try {
    const door = stubStartDoor(30_000);
    const doors = {
      start: door.start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
      stopRequestPath: fixture.stopRequestPath,
    };

    const attempt = await runTheGroupOfTheAttempt(inputOf(fixture, doors));
    assert.equal(attempt.ok, true, "a cut group is still an answer the caller can read");
    if (!("stoppedByStopNow" in attempt) || attempt.stoppedByStopNow !== true) {
      assert.fail("the attempt must answer the cut with `stoppedByStopNow`");
    }
    assert.equal(attempt.groupId, "g-2-1");

    // NO SURVIVOR: every worker process is gone when the attempt returns.
    for (const pid of door.pids) {
      assert.equal(stillAlive(pid), false, `worker pid ${String(pid)} survived the stop`);
    }
    const settles = await Promise.race([
      Promise.all(door.ends.map((one) => one.catch(() => "killed" as const))),
      new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 10_000)),
    ]);
    assert.notEqual(settles, "timeout", "the ended promises of the workers never settled");
    // THE GROUP IS LEFT TO THE STATES OF F143-FR-025: the ledger stands as
    // the kill left it — the starts and nothing more; no barrier, no
    // integration, no `group_closed`.
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.deepEqual(
      records.map((record) => record.kind),
      ["group_started", "worker_started", "worker_started"],
    );

    // Nothing of the workers is in the workspace, and the trees stand.
    assert.equal(
      readFileSync(join(fixture.workspace, "src", "a.ts"), "utf8").includes("2-a was here"),
      false,
      "the cut worker's edit must not reach the workspace",
    );
    assert.equal(
      readFileSync(join(fixture.workspace, "src", "b.ts"), "utf8").includes("2-b was here"),
      false,
      "the cut worker's edit must not reach the workspace",
    );
    const workerRoot = join(fixture.home, ".specstride", "worker-roots", fixture.runId);
    assert.equal(existsSync(workerRoot), true, "the trees of the cut group must stand");
  } finally {
    clearTimeout(timer);
    fixture.cleanup();
  }
});

test("with no request standing the group is exactly as it was, and the wiring says nothing", async () => {
  const fixture = fixtureOf("none");
  try {
    const doors = {
      start: stubStartDoor(0).start,
      runner: spawnRunner(),
      innerCheckSet: [probeOf(fixture, "2-a was here")],
    };
    const attempt = await runTheGroupOfTheAttempt(inputOf(fixture, doors));
    assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
    if (!attempt.ok) return;
    assert.equal(attempt.outcome, "kept");
    assert.equal(attempt.stopAfterTheGroup, undefined);
    assert.equal("stoppedByStopNow" in attempt, false);
    const kinds = ledgerOf(fixture.controlRoot, fixture.runId).map((record) => record.kind);
    assert.equal(kinds[kinds.length - 1], "group_closed");
  } finally {
    fixture.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * The wiring: what the composition root reads at the boundary after the
 * group (`theStopSeenOfTheGroup`).
 * ------------------------------------------------------------------ */

function wiringInputOf(
  fixture: Fixture,
  overrides: {
    readonly start?: (worker: PreparedWorker) => Promise<StartedWorkerPassStub>;
    readonly stopRequestPath?: string | undefined;
  } = {},
): ParallelWiringInput {
  const plan: ParallelPlan = {
    schema: "specstride.parallel-plan/1",
    runId: fixture.runId,
    hash: "plan-hash-stop-wiring",
    workers: 2,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: ["T002", "T003"] }],
        tasks: [
          { id: "T002", scope: { prefixes: ["src"], source: "task-text" }, checks: [] },
          { id: "T003", scope: { prefixes: ["src"], source: "task-text" }, checks: [] },
        ],
        serial: ["T001"],
        ceiling: 2,
      },
    ],
  };
  return {
    plan,
    phase: 2,
    evidencePresent: () => false,
    keptUnitsOf: () => ["T001"],
    failedGroupsBefore: 0,
    controlRoot: fixture.controlRoot,
    home: fixture.home,
    runId: fixture.runId,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    taskTextAtLaunch:
      "## Phase 2: the stop work\n- [ ] T001 the first task\n- [ ] T002 the second task\n- [ ] T003 the third\n",
    taskTextOf: (taskId) =>
      ({
        T001: "the first task",
        T002: "the second task",
        T003: "the third",
      })[taskId] ?? taskId,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: RUN_TOKEN,
    timeLimitMs: 120_000,
    enginePid: process.pid,
    engineStartedAtMs: startedAtMsOf(process.pid),
    registry: fixture.registry,
    guardScriptPath: fixture.guardScriptPath,
    hash,
    innerCheckSet: [
      {
        id: "the-probe",
        kind: "command",
        argv: [
          "node",
          "-e",
          `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
          join(fixture.workspace, "src", "002.ts"),
          "T002 was here",
        ],
        phase: 2,
        timeLimitMs: 30_000,
      },
    ],
    startDoor: (overrides.start ?? stubStartDoor(0).start) as never,
    ...(overrides.stopRequestPath === undefined
      ? {}
      : { stopRequestPath: overrides.stopRequestPath }),
    emit: () => {},
    say: () => {},
    onClosed: () => {},
    onHandoff: () => {},
  };
}

test("the wiring reports the stop the group saw, and nothing where none stood", async () => {
  const fixture = fixtureOf("wiring-clean");
  try {
    writeFileSync(
      fixture.stopRequestPath,
      JSON.stringify({
        schema: "specstride.inbox/1",
        type: "stop",
        at: "2026-11-04T00:00:00.000Z",
        now: false,
        jobs: false,
      }),
    );
    const wiring = parallelWiringOfTheAttempt(
      wiringInputOf(fixture, { stopRequestPath: fixture.stopRequestPath }),
    );
    const ran = await wiring.startIfTheBoundaryIsClean();
    assert.equal(ran, true, "the group must run under a clean stop");
    assert.deepEqual(
      wiring.theStopSeenOfTheGroup(),
      { now: false },
      "the wiring must report the clean stop the group saw",
    );
  } finally {
    fixture.cleanup();
  }
});

test("the wiring reports the cut of a stop --now, and no run of the group follows it", async () => {
  const fixture = fixtureOf("wiring-now");
  const timer = writeTheStopRequestLater(fixture, { now: true }, 350);
  try {
    const door = stubStartDoor(30_000);
    const wiring = parallelWiringOfTheAttempt(
      wiringInputOf(fixture, {
        start: door.start,
        stopRequestPath: fixture.stopRequestPath,
      }),
    );
    const ran = await wiring.startIfTheBoundaryIsClean();
    assert.equal(ran, true, "the cut group is still a group that ran");
    assert.deepEqual(
      wiring.theStopSeenOfTheGroup(),
      { now: true },
      "the wiring must report the cut the stop --now made",
    );
    // NO SURVIVOR, and the ledger of the run stands as the kill left it.
    for (const pid of door.pids) {
      assert.equal(stillAlive(pid), false, `worker pid ${String(pid)} survived the stop`);
    }
    const kinds = ledgerOf(fixture.controlRoot, fixture.runId).map((record) => record.kind);
    assert.equal(kinds.includes("group_closed"), false, "no close may follow a cut");
    assert.equal(kinds[0], "group_started");
  } finally {
    clearTimeout(timer);
    fixture.cleanup();
  }
});
