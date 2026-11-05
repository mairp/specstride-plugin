/**
 * THE WIRING OF ONE GROUP INTO ONE PHASE ATTEMPT, TESTED (step 3 of
 * `prompts/specstride-parallel-units.md`). The wiring slice is the join the
 * composition root uses; the tests here pin, over one REAL group run through
 * the stub start door of the attempt bench:
 *
 *  - the boundary of F142-FR-018 — the conditions, in the layer's order, and
 *    the group that does not start at an unclean boundary;
 *  - the reserved-tasks block of F142-FR-069 — its text while the group
 *    waits, its absence once the group has run;
 *  - the carry-out of the directives: `keep` hands the critic the handoff,
 *    a start refusal switches the layer off for the attempt, and a second
 *    failed group is the layer's own `group-failures` decision;
 *  - the closed group of F142-FR-023, the run totals, and the `parallel=`
 *    fields of the `[LOOP]` line of F142-FR-022;
 *  - the REAL doors of the wiring: the check runner over a real process and
 *    the tick of the integrated tasks over the real task list, whose one
 *    changed byte is the character inside the box (F104-FR-017).
 *
 * With no group in the plan the wiring does nothing: `reservedBlock()` is
 * `""` and a start attempt runs no group (F142-SC-001's wiring half).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ManifestEntry } from "@specstride/contracts/ep/check-runner";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import {
  parallelLoopLineField,
  parallelWiringOfTheAttempt,
  tasksBeforeTheGroup,
  theBoundaryOfNow,
  theClosedGroupOf,
  theEmptyRunTotals,
  theGroupOfThePhase,
  thePromptOfTheWorker,
  theRealCheckRunner,
  theTickOfTheTaskList,
  totalsAfterTheGroup,
  type ParallelWiringInput,
} from "../../src/engine/parallel-wiring.ts";
import { writeWorkerGuardScript } from "../../src/engine/worker-supervisor.ts";
import type { TheGroupAttemptRefused } from "../../src/engine/parallel-attempt.ts";
import { WorkerStartRefused, type PreparedWorker } from "../../src/engine/parallel-group.ts";
import { forbiddenWordsIn, workerBlockText } from "../../../layer-parallel/src/index.ts";

/* ------------------------------------------------------------------ *
 * The fixture: the attempt bench, once more, over a real git workspace.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-wiring";
const RUN_ID = "run-wiring";
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

function fixtureOf(name: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `par-wiring-${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  // The bench commits with its own identity, as the other engine tests do: a runner with no git
  // identity (CI) must not fail the setup.
  git(workspace, "config", "user.email", "t@t");
  git(workspace, "config", "user.name", "t");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "002.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "003.ts"), "export const b = 2;\n");
  writeFileSync(join(workspace, "src", "001.ts"), "export const c = 3;\n");
  writeFileSync(
    join(workspace, TASK_LIST),
    "## Phase 2: the wiring work\n- [ ] T001 the first task\n- [ ] T002 the second task\n- [ ] T003 the third\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the wiring bench");
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

/**
 * The plan of phase 2 (annex D §D.3): the candidates of the whole phase, the
 * ONE group of this plan, the tasks before it on the main line, `T001` serial.
 */
function planOf(groupTasks: readonly string[]): ParallelPlan {
  const all = ["T001", "T002", "T003"];
  const scope = (prefixes: readonly string[]) => ({
    prefixes: [...prefixes],
    source: "task-text" as const,
  });
  return {
    schema: "specstride.parallel-plan/1",
    runId: RUN_ID,
    hash: "plan-hash-wiring",
    workers: groupTasks.length,
    fallback: undefined,
    phases: [
      {
        phase: 2,
        groups: [{ ordinal: 1, phase: 2, tasks: [...groupTasks] }],
        tasks: all.map((id) => ({ id, scope: scope(["src"]), checks: [] })),
        serial: all.filter((id) => !groupTasks.includes(id)),
        ceiling: groupTasks.length,
      },
    ],
  };
}

/** A REAL check runner is the wiring's own; the probe reads the workspace. */
function probeOf(fixture: Fixture, marker: string): ManifestEntry {
  return {
    id: "the-probe",
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", "002.ts"),
      marker,
    ],
    phase: 2,
    timeLimitMs: 30_000,
  };
}

/* ------------------------------------------------------------------ *
 * The stub door: real worker processes, as the attempt bench runs them.
 * ------------------------------------------------------------------ */

const STUB_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const [outbox, taskId, treePath, target, addition] = process.argv.slice(1);
fs.mkdirSync(outbox, { recursive: true });
const checkpoint = process.env.STUB_NO_CHECKPOINT !== "1";
if (checkpoint) {
  fs.writeFileSync(path.join(outbox, taskId + ".checkpoint.json"), JSON.stringify({ task: taskId }));
}
const at = path.join(treePath, target);
fs.writeFileSync(at, fs.readFileSync(at, "utf8") + addition);
`;

function stubStartDoor(refusalOf?: (workerId: string) => string | undefined) {
  return {
    start: async (worker: PreparedWorker) => {
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
          `src/${worker.taskId.slice(1)}.ts`,
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
        runTokenHash: hash("run-token-of-the-wiring"),
        ended,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The wiring's input over the fixture.
 * ------------------------------------------------------------------ */

function wiringOf(
  fixture: Fixture,
  overrides: {
    readonly plan?: ParallelPlan | null;
    readonly evidencePresent?: () => boolean;
    readonly keptUnitsOf?: () => readonly string[];
    readonly refusalOf?: (workerId: string) => string | undefined;
  } = {},
): { readonly input: ParallelWiringInput } {
  const plan = overrides.plan === undefined ? planOf(["T002", "T003"]) : overrides.plan;
  return {
    input: {
      plan,
      phase: 2,
      evidencePresent: overrides.evidencePresent ?? (() => false),
      keptUnitsOf: overrides.keptUnitsOf ?? (() => ["T001"]),
      failedGroupsBefore: 0,
      controlRoot: fixture.controlRoot,
      home: fixture.home,
      runId: RUN_ID,
      workspace: fixture.workspace,
      slug: SLUG,
      taskListPath: TASK_LIST,
      taskTextAtLaunch:
        "## Phase 2: the wiring work\n- [ ] T001 the first task\n- [ ] T002 the second task\n",
      taskTextOf: (taskId) =>
        ({
          T001: "the first task",
          T002: "the second task",
          T003: "the third",
        })[taskId] ?? taskId,
      model: "stub",
      modelTierOrEffort: "stub",
      containment: "C2",
      runToken: "run-token-of-the-wiring",
      timeLimitMs: 120_000,
      enginePid: process.pid,
      engineStartedAtMs: Date.now(),
      registry: fixture.registry,
      guardScriptPath: fixture.guardScriptPath,
      hash,
      innerCheckSet: [probeOf(fixture, "T002 was here")],
      // The stub door keeps real worker processes out of the real model door.
      startDoor: stubStartDoor(overrides.refusalOf).start as never,
      emit: () => {},
      say: () => {},
      onClosed: () => {},
      onHandoff: () => {},
    },
  };
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("the group of the phase is the plan's first group, with the tasks before it", () => {
  const plan = planOf(["T002", "T003"]);
  assert.deepEqual(theGroupOfThePhase(plan, 2)?.tasks, ["T002", "T003"]);
  assert.deepEqual(tasksBeforeTheGroup(plan, 2), ["T001"]);
  assert.deepEqual(tasksBeforeTheGroup(planOf(["T001", "T002"]), 2), []);
  const noGroup: ParallelPlan = {
    ...planOf(["T002", "T003"]),
    phases: [],
  };
  assert.equal(theGroupOfThePhase(noGroup, 2), undefined);
  assert.deepEqual(tasksBeforeTheGroup(noGroup, 2), []);
});

test("the boundary is clean exactly when the layer's four conditions hold", () => {
  const plan = planOf(["T002", "T003"]);
  const clean = theBoundaryOfNow({
    sessionOpen: false,
    yieldWaitOpen: false,
    evidencePresent: false,
    plan,
    phase: 2,
    keptUnits: ["T001"],
  });
  assert.deepEqual(clean, { clean: true });
  const evidence = theBoundaryOfNow({
    sessionOpen: false,
    yieldWaitOpen: false,
    evidencePresent: true,
    plan,
    phase: 2,
    keptUnits: ["T001"],
  });
  assert.equal(evidence.clean, false);
  if (!evidence.clean) assert.match(evidence.condition, /phase evidence/);
  const unkept = theBoundaryOfNow({
    sessionOpen: false,
    yieldWaitOpen: false,
    evidencePresent: false,
    plan,
    phase: 2,
    keptUnits: [],
  });
  assert.equal(unkept.clean, false);
  if (!unkept.clean) assert.match(unkept.detail, /no kept unit of work names T001/);
});

test("the reserved block names the tasks and says up to which task to work", () => {
  const wiring = parallelWiringOfTheAttempt(wiringOf(fixtureOf("reserved")).input);
  const block = wiring.reservedBlock();
  assert.equal(block, "Work up to T002 and end your pass there. Do not work T002, T003.");
});

test("the prompt of a worker carries the checkpoint duty of its own outbox", () => {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const common = {
    taskId: "T002",
    taskText: "append the line to src/beta.ts",
    prefixes: ["src/beta.ts", "src/beta-note.md"],
    hash,
  };
  // With the outbox: the duty names the worker's own checkpoint file and the
  // exact content, after the layer's own block (F143-FR-011).
  const withOutbox = thePromptOfTheWorker({ ...common, outboxPath: "/tmp/w-1/outbox" });
  assert.match(withOutbox, /^Work T002: append the line to src\/beta\.ts\n/);
  assert.match(
    withOutbox,
    /End the work by writing the file \/tmp\/w-1\/outbox\/T002\.checkpoint\.json with the exact content \{"task":"T002"\}/,
  );
  // The duty holds no word F142-FR-069 forbids: no sibling, no count, no
  // index, no group.
  assert.deepEqual(forbiddenWordsIn(withOutbox, [common.taskText]), []);
  // Without the outbox the prompt is the layer's block alone.
  assert.equal(thePromptOfTheWorker(common), workerBlockText({ ...common }));
});

test("with no group in the plan the wiring does nothing", async () => {
  const fixture = fixtureOf("no-group");
  try {
    const wiring = parallelWiringOfTheAttempt(wiringOf(fixture, { plan: null }).input);
    assert.equal(wiring.group, undefined);
    assert.equal(wiring.reservedBlock(), "");
    assert.equal(await wiring.startIfTheBoundaryIsClean(), false);
    assert.equal(wiring.handoffForTheCritic(), "");
    assert.equal(wiring.layerOffForTheAttempt(), false);
    assert.equal(wiring.layerOffForTheRun(), false);
    assert.equal(
      existsSync(join(fixture.controlRoot, "runs", RUN_ID, "parallel-ledger.jsonl")),
      false,
      "the inert wiring wrote the ledger",
    );
  } finally {
    fixture.cleanup();
  }
});

test("an unclean boundary starts no group and says why", async () => {
  const fixture = fixtureOf("unclean");
  const said: string[] = [];
  try {
    const wiring = parallelWiringOfTheAttempt({
      ...wiringOf(fixture, { keptUnitsOf: () => [] }).input,
      say: (line) => said.push(line),
    });
    assert.equal(await wiring.startIfTheBoundaryIsClean(), false);
    assert.equal(
      existsSync(join(fixture.controlRoot, "runs", RUN_ID, "parallel-ledger.jsonl")),
      false,
    );
    assert.ok(
      said.some((line) => line.includes("the group does not start yet")),
      `no boundary line among ${JSON.stringify(said)}`,
    );
  } finally {
    fixture.cleanup();
  }
});

test("a clean boundary runs the whole group and the keep hands the handoff over", async () => {
  const fixture = fixtureOf("kept");
  try {
    const closedSeen: { groupId: string; refused: number }[] = [];
    const wiring = parallelWiringOfTheAttempt({
      ...wiringOf(fixture).input,
      onClosed: (closed) =>
        closedSeen.push({ groupId: closed.groupId, refused: closed.refused.length }),
    });
    assert.notEqual(wiring.reservedBlock(), "");
    assert.equal(await wiring.startIfTheBoundaryIsClean(), true);
    assert.equal(wiring.reservedBlock(), "", "the reserved block stays after the group ran");
    assert.notEqual(wiring.handoffForTheCritic(), "");
    assert.match(wiring.handoffForTheCritic(), /T002/);
    assert.deepEqual(closedSeen, [{ groupId: "g-2-1", refused: 0 }]);
    // The tasks of the group are ticked in the REAL task list.
    const tasks = readFileSync(join(fixture.workspace, TASK_LIST), "utf8");
    assert.match(tasks, /- \[x\] T002 /);
    assert.match(tasks, /- \[x\] T003 /);
    assert.match(tasks, /- \[ \] T001 /);
    // The second start of one wiring runs no second group.
    assert.equal(await wiring.startIfTheBoundaryIsClean(), false);
  } finally {
    fixture.cleanup();
  }
});

test("a group whose workers all end with no checkpoint fails and hands its tasks back", async () => {
  // THE SHAPE OF THE FAILED DRIVE (par-3 session 6, bug 2): every worker ends
  // without writing its checkpoint, the barrier refuses all of them, nothing
  // is integrated, and the attempt comes back as ONE FAILED GROUP with the
  // directive `none` — the engine itself carries on (F142-FR-023), which is
  // the "completes as the run" half of F142-SC-010.
  const fixture = fixtureOf("no-checkpoint");
  const emitted: { type: string; data: Record<string, unknown> }[] = [];
  const said: string[] = [];
  const totals = theEmptyRunTotals("on", 2);
  const before = process.env.STUB_NO_CHECKPOINT;
  process.env.STUB_NO_CHECKPOINT = "1";
  try {
    const wiring = parallelWiringOfTheAttempt({
      ...wiringOf(fixture).input,
      emit: (type, data) => emitted.push({ type, data }),
      say: (line) => said.push(line),
      onClosed: (closed, counts) => totalsAfterTheGroup(totals, closed, counts),
    });
    // The engine carries on: the run of the group does not throw and is not a
    // refusal of the wiring (the attempt itself ended whole).
    assert.equal(await wiring.startIfTheBoundaryIsClean(), true);
    assert.equal(wiring.handoffForTheCritic(), "", "a failed group kept no handoff");
    assert.equal(
      wiring.layerOffForTheAttempt(),
      false,
      "one failed group does not switch the layer off (F142-FR-023)",
    );
    assert.equal(wiring.layerOffForTheRun(), false);
    assert.equal(totals.groups, 1);
    assert.equal(totals.groupFailures, 1);
    assert.ok(
      said.some((line) => line.includes("run on the main line (none)")),
      `no main-line line among ${JSON.stringify(said)}`,
    );
    // The ledger closes the group as failed, with no record of an
    // application or a merge check (nothing was integrated).
    const ledger = readFileSync(
      join(fixture.controlRoot, "runs", RUN_ID, "parallel-ledger.jsonl"),
      "utf8",
    );
    const records = readAppendedRecords(ledger).records;
    const kinds = records.map((record) => record.kind);
    const last = records[records.length - 1];
    assert.equal(last?.kind, "group_closed");
    assert.equal(last?.data.outcome, "failed");
    for (const kind of ["merge_done", "apply_started", "applied", "merge_check_started"]) {
      assert.ok(!kinds.includes(kind), `${kind} is in the ledger of an empty group`);
    }
    // No task of the group was ticked: the work comes back to the main line.
    const tasks = readFileSync(join(fixture.workspace, TASK_LIST), "utf8");
    assert.match(tasks, /- \[ \] T002 /);
    assert.match(tasks, /- \[ \] T003 /);
    assert.ok(
      emitted.every(
        (event) => !String(event.type).includes("worker.ended") || event.data.outcome === "refused",
      ),
      `an unexpected worker end in ${JSON.stringify(emitted)}`,
    );
  } finally {
    if (before === undefined) delete process.env.STUB_NO_CHECKPOINT;
    else process.env.STUB_NO_CHECKPOINT = before;
    fixture.cleanup();
  }
});

test("a start refusal switches the layer off for the attempt", async () => {
  const fixture = fixtureOf("refused");
  const emitted: { type: string; data: Record<string, unknown> }[] = [];
  const said: string[] = [];
  try {
    const wiring = parallelWiringOfTheAttempt({
      ...wiringOf(fixture, { refusalOf: () => "the harness refused the start" }).input,
      emit: (type, data) => emitted.push({ type, data }),
      say: (line) => said.push(line),
    });
    assert.equal(await wiring.startIfTheBoundaryIsClean(), false);
    assert.equal(wiring.layerOffForTheAttempt(), true);
    const off = emitted.find((event) => event.data.reason === "harness-error");
    assert.ok(off !== undefined, `no harness-error event in ${JSON.stringify(emitted)}`);
    assert.equal(off.type, "parallel.group.ended");
    assert.equal(off.data.scope, "attempt");
    assert.ok(said.some((line) => line.includes("harness-error")));
    // The search of F143-FR-018 closed the group as failed.
    const ledger = readFileSync(
      join(fixture.controlRoot, "runs", RUN_ID, "parallel-ledger.jsonl"),
      "utf8",
    );
    const records = readAppendedRecords(ledger).records;
    assert.ok(
      records.some((record) => record.kind === "group_closed"),
      "no group_closed record after a start refusal",
    );
  } finally {
    fixture.cleanup();
  }
});

test("the closed group, the run totals and the parallel fields of the LOOP line", async () => {
  const fixture = fixtureOf("totals");
  try {
    const totals = theEmptyRunTotals("on", 2);
    const wiring = parallelWiringOfTheAttempt({
      ...wiringOf(fixture).input,
      onClosed: (closed, counts) => totalsAfterTheGroup(totals, closed, counts),
    });
    assert.equal(await wiring.startIfTheBoundaryIsClean(), true);
    assert.equal(totals.groups, 1);
    assert.equal(totals.groupFailures, 0);
    assert.equal(totals.refused, 0);
    const field = parallelLoopLineField({ totals });
    assert.match(field, /^parallel=on /);
    assert.match(field, /workers=2 /);
    assert.match(field, /groups=1 /);
    assert.match(field, /group-failures=0 /);
    assert.match(field, /refused=0 /);
    assert.match(field, /worker-caches=shared /);
    assert.match(field, /wall-hours=[\d.]+/);
    assert.match(field, /agent-hours=[\d.]+$/);
    assert.equal(parallelLoopLineField({ totals: theEmptyRunTotals("off", 2) }), "");
  } finally {
    fixture.cleanup();
  }
});

test("the closed group of F142-FR-023 counts a refused audit as one failure", () => {
  const refused: TheGroupAttemptRefused = {
    ok: false,
    groupId: "g-2-1",
    workerId: "w-1",
    message: "the harness refused the start",
    endedByTheSearch: [],
    closed: null,
    events: [],
  };
  const closed = theClosedGroupOf(refused);
  assert.deepEqual(closed.refused, ["w-1"]);
  assert.deepEqual(closed.killed, []);
  assert.equal(closed.mergeCheckPassed, null);
  const totals = theEmptyRunTotals("on", 2);
  totalsAfterTheGroup(totals, closed, { wallMs: 0, agentMs: 0, refused: 1 });
  assert.equal(totals.groupFailures, 1);
  assert.equal(totals.refused, 1);
});

test("the real check runner runs a real process and reports its real exit", async () => {
  const runner = theRealCheckRunner();
  const pinned = await runner.pin({ id: "ok", kind: "command", argv: ["true"] });
  assert.equal(pinned.kind, "command");
  const probe = {
    identity: { kind: "command" as const, executable: "node", argv: ["-e", "process.exit(0)"] },
    workingDirectory: process.cwd(),
    environmentAllowList: [] as const,
    timeLimitMs: 10_000,
    containment: "C2" as const,
  };
  const handle = await runner.start(probe);
  assert.deepEqual(await runner.poll(handle), { state: "ended" });
  const result = await runner.result(handle);
  assert.equal(result.exitCode, 0);
  assert.ok(result.durationMs >= 0);
  const failing = await runner.start({
    ...probe,
    identity: { kind: "command" as const, executable: "node", argv: ["-e", "process.exit(3)"] },
  });
  assert.equal((await runner.result(failing)).exitCode, 3);
  await runner.cancel(handle);
});

test("the real tick changes the one byte inside the box, atomically", async () => {
  const fixture = fixtureOf("tick");
  try {
    const path = join(fixture.workspace, TASK_LIST);
    const before = readFileSync(path, "utf8");
    const tick = theTickOfTheTaskList(path);
    const outcome = await tick(["T002", "no-such-task"]);
    assert.deepEqual(
      outcome.ticked.map((row) => row.taskId),
      ["T002"],
    );
    assert.deepEqual(outcome.notFound, ["no-such-task"]);
    const after = readFileSync(path, "utf8");
    assert.equal(after, before.replace("- [ ] T002", "- [x] T002"));
  } finally {
    fixture.cleanup();
  }
});
