/**
 * THE COUNTERS OF THE LAYER ON THE LEDGER, at the composition root
 * (F143-FR-028; `parallel-drive.ts` `theCountersOfTheLedger`, supplied by
 * `parallel-attempt.ts`). The decision is core's (`countersFromTheLedger`,
 * `flatten`, `countersAgree`, `countersContinue`); these tests pin THE JOIN:
 *
 *  - EVERY RECORD of a real group drive — real tree store over a real git
 *    workspace, real ledger file, real worker processes through a stub door,
 *    real check runner — carries the counters of the layer AS THEY STAND
 *    AFTER IT, and each record's carried value is the one the history up to
 *    and including it derives, so `countersAgree` holds over the file;
 *  - A SECOND OPENING of the same run's ledger — what a relaunched engine
 *    does — derives from the file and never from memory: its first record
 *    already carries the counts of everything before it, and the counters
 *    only ever rise (`countersContinue`);
 *  - `--reset-counts` (F100-FR-045) zeroes the counters on every record the
 *    start that asks for it writes, and nothing else;
 *  - THE DOOR ITSELF counts a restart where the `passOrdinal` triple says
 *    one, and a second record of one step of one group spends a cycle
 *    (IR-50 (a)).
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
import {
  countersAgree,
  countersContinue,
  countersFromTheLedger,
  countersOnTheLastRecord,
  flatten,
  unflatten,
} from "../../../core/src/parallel/counters.ts";
import type { CountedRecord } from "../../../core/src/parallel/counters.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { writeWorkerGuardScript } from "../../src/engine/worker-supervisor.ts";
import {
  openTheLedgerOfTheRun,
  parallelLedgerPathOf,
  theCountersOfTheLedger,
} from "../../src/engine/parallel-drive.ts";
import { runTheGroupOfTheAttempt } from "../../src/engine/parallel-attempt.ts";
import type { PreparedWorker } from "../../src/engine/parallel-group.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-counters";
const RUN_ID = "run-counters";
const LEDGER_NAME = `${RUN_ID}:ledger`;

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

/** The fixture: four files, four tasks, two groups of two in one phase. */
function fixtureOf(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "par-counters-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  for (const name of ["a", "b", "c", "d"]) {
    writeFileSync(join(workspace, "src", `${name}.ts`), `export const ${name} = 1;\n`);
  }
  writeFileSync(
    join(workspace, TASK_LIST),
    "- [ ] 2-a the first task\n- [ ] 2-b the second task\n- [ ] 2-c the third\n- [ ] 2-d the fourth\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the counters bench");
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

/** The process registry over one real file (F118-FR-031). */
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

/** The plan of phase 2 with the groups named, every task scoped to `src`. */
function planOfGroups(
  groups: readonly { readonly ordinal: number; readonly tasks: readonly string[] }[],
): ParallelPlan {
  const scope = { prefixes: ["src"], source: "task-text" as const };
  const tasks = [...new Set(groups.flatMap((group) => group.tasks))].map((id) => ({
    id,
    scope,
    checks: [],
  }));
  return {
    schema: "specstride.parallel-plan/1",
    runId: RUN_ID,
    hash: "plan-hash-counters",
    workers: 2,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: groups.map((group) => ({
          ordinal: group.ordinal,
          phase: 2,
          tasks: [...group.tasks],
        })),
        tasks,
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
 * The stub door: real worker processes that edit their tree and end.
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

/** A start door whose workers edit `src/<letter>.ts` and end at once. */
function stubStartDoor(): {
  readonly start: (worker: PreparedWorker) => Promise<{
    readonly workerId: string;
    readonly pid: number;
    readonly startTime?: string | undefined;
    readonly processGroup?: number | undefined;
    readonly runTokenHash: string;
    readonly ended: Promise<"ended" | "killed">;
  }>;
} {
  return {
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
        runTokenHash: hash("run-token-of-the-counters"),
        ended,
      };
    },
  };
}

/** The probe of the inner check set: the workspace file holds the worker's mark. */
function probeOf(fixture: Fixture, file: string, marker: string): ManifestEntry {
  return {
    id: "the-probe",
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", file),
      marker,
    ],
    phase: 2,
    timeLimitMs: 30_000,
  };
}

/** One drive of one group of the fixture, with the counters in the input. */
async function driveOneGroup(
  fixture: Fixture,
  groupOrdinal: number,
  doors: { readonly runner: CheckRunner; readonly probe: ManifestEntry },
  options: { readonly resetCounts?: boolean | undefined } = {},
): Promise<Extract<Awaited<ReturnType<typeof runTheGroupOfTheAttempt>>, { ok: true }>> {
  const plan = planOfGroups([
    { ordinal: 1, tasks: ["2-a", "2-b"] },
    { ordinal: 2, tasks: ["2-c", "2-d"] },
  ]);
  const group = plan.phases[0]?.groups.find((entry) => entry.ordinal === groupOrdinal);
  assert.ok(group !== undefined, `no group ${String(groupOrdinal)} in the plan`);
  const attempt = await runTheGroupOfTheAttempt({
    controlRoot: fixture.controlRoot,
    runId: RUN_ID,
    home: fixture.home,
    plan,
    phase: 2,
    groupOrdinal,
    workspace: fixture.workspace,
    slug: SLUG,
    taskListPath: TASK_LIST,
    model: "stub",
    modelTierOrEffort: "stub",
    containment: "C2",
    runToken: "run-token-of-the-counters",
    timeLimitSec: 120,
    promptOf: (worker) => `the prompt of ${worker.taskId}`,
    outputRootOf: (worker) => join(fixture.root, "outputs", worker.workerId),
    startDoor: stubStartDoor().start,
    enginePid: process.pid,
    engineStartedAtMs: Date.now(),
    workersAtATime: 2,
    guardScriptPath: fixture.guardScriptPath,
    registry: fixture.registry,
    taskTextAtLaunch: readFileSync(join(fixture.workspace, TASK_LIST), "utf8"),
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
    innerCheckSet: [doors.probe],
    hash,
    emit: () => {},
    say: () => {},
    ...(options.resetCounts === true ? { resetCounts: true } : {}),
  });
  assert.equal(attempt.ok, true, attempt.ok ? "" : attempt.message);
  if (!attempt.ok) throw new Error("the attempt failed");
  return attempt;
}

/** The records of the ledger of the run, as the file holds them. */
function ledgerOf(fixture: Fixture): readonly CountedRecord[] {
  const file = parallelLedgerPathOf(fixture.controlRoot, RUN_ID);
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("every record of a real drive carries the counters as they stand after it", async () => {
  const fixture = fixtureOf();
  try {
    const attempt = await driveOneGroup(fixture, 1, {
      runner: spawnRunner(),
      probe: probeOf(fixture, "a.ts", "2-a was here"),
    });
    assert.equal(attempt.directive, "keep");
    const records = ledgerOf(fixture);
    assert.ok(records.length >= 14, `the group wrote ${String(records.length)} records`);
    assert.equal(
      records.every((record) => record.counters !== undefined),
      true,
      "a record of the namespace left the disk without its counters",
    );

    // Each record carries what the history up to it derives — the carried
    // half and the derived half of F143-FR-028 are the same numbers.
    for (const [at, record] of records.entries()) {
      assert.deepEqual(
        record.counters,
        flatten(countersFromTheLedger(records.slice(0, at + 1))),
        `the counters of record ${String(record.seq)} are not the history's`,
      );
    }
    assert.equal(countersAgree(records), true, "the carried counters disagree with the derived");

    // The last record: one group started and closed, two passes started, no
    // restart used, no cycle spent.
    assert.deepEqual(flatten(countersOnTheLastRecord(records) ?? {}), {
      groupsStarted: 1,
      groupsFailed: 0,
      cyclesSpent: 0,
      "passesStarted:w-1": 1,
      "passesStarted:w-2": 1,
      "restartsUsed:w-1": 0,
      "restartsUsed:w-2": 0,
    });
    // The `worker_started` records carry the triple core reads, so a restart
    // is at all countable from the engine's ledger.
    const starts = records.filter((record) => record.kind === "worker_started");
    assert.deepEqual(
      starts.map((record) => record.data?.["passOrdinal"]),
      [
        [1, 1, 0],
        [1, 2, 0],
      ],
    );
  } finally {
    releaseTheWriter(LEDGER_NAME);
    fixture.cleanup();
  }
});

test("a second opening of the ledger of the run continues the counters and never lowers them", async () => {
  const fixture = fixtureOf();
  try {
    await driveOneGroup(fixture, 1, {
      runner: spawnRunner(),
      probe: probeOf(fixture, "a.ts", "2-a was here"),
    });
    const afterTheFirst = countersFromTheLedger(ledgerOf(fixture));
    assert.equal(afterTheFirst.groupsStarted, 1);

    // The second engine start: it opens the SAME ledger file, derives from it
    // and writes the second group. Nothing of the first group is in its
    // memory — the file is the only thing it reads.
    await driveOneGroup(fixture, 2, {
      runner: spawnRunner(),
      probe: probeOf(fixture, "c.ts", "2-c was here"),
    });
    const records = ledgerOf(fixture);
    const afterTheSecond = countersFromTheLedger(records);
    assert.equal(afterTheSecond.groupsStarted, 2, "the second group was not counted");
    assert.equal(countersContinue(afterTheFirst, afterTheSecond), true, "a count went down");
    assert.equal(countersAgree(records), true);

    // The FIRST record of the second opening already carries both groups: the
    // derivation is from the file, not from the new start's memory.
    const firstOfTheSecond = records.find(
      (record) => record.kind === "group_started" && record.groupId === "g-2-2",
    );
    assert.ok(firstOfTheSecond !== undefined, "the second group never started");
    assert.equal(
      (firstOfTheSecond.counters as Record<string, number>)["groupsStarted"],
      2,
      "the second opening began from zero instead of the file",
    );
    assert.deepEqual(flatten(countersOnTheLastRecord(records) ?? {}), {
      groupsStarted: 2,
      groupsFailed: 0,
      cyclesSpent: 0,
      // The worker ids are minted from 1 per group, so each of the two
      // workers of the second opening ran a second pass under the same id.
      "passesStarted:w-1": 2,
      "passesStarted:w-2": 2,
      "restartsUsed:w-1": 0,
      "restartsUsed:w-2": 0,
    });
  } finally {
    releaseTheWriter(LEDGER_NAME);
    fixture.cleanup();
  }
});

test("a start that asks for --reset-counts writes zeroed counters and nothing else changes", async () => {
  const fixture = fixtureOf();
  try {
    await driveOneGroup(fixture, 1, {
      runner: spawnRunner(),
      probe: probeOf(fixture, "a.ts", "2-a was here"),
    });
    const before = flatten(countersFromTheLedger(ledgerOf(fixture)));
    assert.equal(before["groupsStarted"], 1);

    await driveOneGroup(
      fixture,
      2,
      { runner: spawnRunner(), probe: probeOf(fixture, "c.ts", "2-c was here") },
      { resetCounts: true },
    );
    const records = ledgerOf(fixture);
    // Every record the resetting start wrote carries zeroes, and the records
    // of the start before it are untouched on the disk.
    const firstOfTheReset = records.findIndex(
      (record) => record.kind === "group_started" && record.groupId === "g-2-2",
    );
    assert.ok(firstOfTheReset > 0, "the resetting start wrote nothing");
    for (const record of records.slice(firstOfTheReset)) {
      assert.deepEqual(
        record.counters,
        { groupsStarted: 0, groupsFailed: 0, cyclesSpent: 0 },
        "the resetting start carried a count",
      );
    }
    assert.equal(
      (records[firstOfTheReset - 1]?.counters as Record<string, number> | undefined)?.[
        "groupsStarted"
      ],
      1,
      "the reset rewrote the history before it",
    );
  } finally {
    releaseTheWriter(LEDGER_NAME);
    fixture.cleanup();
  }
});

test("the door counts a restart from the triple and a repeated step spends a cycle", async () => {
  const root = mkdtempSync(join(tmpdir(), "par-counters-door-"));
  try {
    const ledgerFile = parallelLedgerPathOf(root, RUN_ID);
    const opened = openTheLedgerOfTheRun({
      controlRoot: root,
      runId: RUN_ID,
      groupId: "g-2-1",
      countersOf: theCountersOfTheLedger({ ledgerFile }),
    });
    await opened.writer.record("group_started", {
      baseTree: "t1",
      workspaceFingerprint: "f1",
    });
    // A restart: the third member of the triple is one.
    await opened.writer.record("worker_started", {
      workerId: "w-1",
      task: "2-a",
      passId: "g-2-1:w-1:pass2",
      passOrdinal: [2, 1, 1],
      treeFingerprint: "tf",
      pid: 4242,
      startTime: "2026-11-04T00:00:00.000Z",
    });

    const records = readAppendedRecords(readFileSync(ledgerFile, "utf8")).records;
    assert.equal(records.length, 2, `the door wrote ${String(records.length)} records`);
    assert.deepEqual((records[0]?.counters as Record<string, number>)["groupsStarted"], 1);
    const workerRecord = records[1]?.counters as Record<string, number>;
    assert.equal(workerRecord["passesStarted:w-1"], 1);
    assert.equal(workerRecord["restartsUsed:w-1"], 1, "the restart was not counted");
    assert.deepEqual(unflatten(workerRecord).perWorker["w-1"], {
      passesStarted: 1,
      restartsUsed: 1,
    });

    // A repeated record of the same step of the same group is one
    // interruption; a cycle is spent from the second (IR-50 (a)).
    const countersAfterARepeat = flatten(
      countersFromTheLedger([...records, records[1] as CountedRecord]),
    );
    assert.equal(countersAfterARepeat["cyclesSpent"], 1);
  } finally {
    releaseTheWriter(LEDGER_NAME);
    rmSync(root, { recursive: true, force: true });
  }
});
