/**
 * THE TAIL OF THE EIGHT STATES (step 4 of `prompts/specstride-parallel-units.md`;
 * F143-FR-025 joined to the engine's resume path — SECOND SLICE), over the
 * REAL seams: a real git workspace, a real tree store with real worker trees
 * holding real work, a real ledger file written through the ONE WRITER, real
 * audits re-run through the store, a real composition and application, a real
 * merge check over a real probe:
 *
 *  - STATE 3 — a group whose every worker ended: the tree ids verify, the
 *    barrier is closed again, the audits are re-run for real, the composition,
 *    the application, the ticks and the merge check run, and the group closes
 *    whole on the interrupted run's own ledger, `seq` rising without a gap
 *    (F143-FR-024) and the counters continuing from the file (F143-FR-028);
 *  - STATE 4 — the audits are repeated after the workspace is verified against
 *    the fingerprint at group start;
 *  - STATE 4 MOVED — a workspace that moved under the group refuses every
 *    worker with `workspace-changed`; nothing is applied and the group fails
 *    with its tasks back on the main line;
 *  - STATE 5 — the application is verified over the planned paths and repeated
 *    in full, and the ticks follow;
 *  - STATE 6 — a path of the delta that holds neither the base nor the
 *    composed content stops the writing: the event, the integrity kind, no
 *    ticks, no merge check, the group closed as a failure;
 *  - STATE 7 — only the ticks are written;
 *  - STATE 8 — the merge check runs over the ticks that stand;
 *  - A STATE THAT NEEDS A WORKER RESTART (state 2) is answered `carried:
 *    false` and NOTHING is written;
 *  - THE WIRING carries the tail as THIS start's group run: the start door is
 *    never called, the say names what stood open, and a stop puts the loop
 *    layer off for the run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import { outboxOfAWorker, passOrdinalOf } from "../../../core/src/parallel/group-executor.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { initStore, treeStore } from "../../../tree-store/src/index.ts";
import { applicationPlan } from "../../../tree-store/src/apply.ts";
import {
  carryOutTheResumeOfTheOpenGroup,
  theOpenParallelGroupOf,
  type TheOpenParallelGroup,
} from "../../src/engine/parallel-resume.ts";
import {
  dataOfTheKind,
  openTheLedgerOfTheRun,
  theRecordAheadOfTheWriter,
} from "../../src/engine/parallel-drive.ts";
import {
  placesOfTheParallelStore,
  prepareTheGroupTrees,
  theParallelHomeOfARun,
} from "../../src/engine/parallel-group.ts";
import {
  theSecretsOfTheWorker,
  theTickOfTheTaskList,
  parallelWiringOfTheAttempt,
} from "../../src/engine/parallel-wiring.ts";
import type { TheTailOfTheResumeDrive } from "../../src/engine/parallel-resume-drive.ts";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a real git workspace, a control plane, a home, a registry.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";
const SLUG = "par-resume-tail";
const GROUP_ID = "g-2-1";
/** The tasks of the group, and the file of the workspace each one edits. */
const TASKS = ["T1", "T2"] as const;
const FILE_OF_TASK: Readonly<Record<string, string>> = { T1: "a.ts", T2: "b.ts" };
const THE_TASK_LIST_AT_LAUNCH =
  "## Phase 2: the group of the tail\n- [ ] T1 the first task\n- [ ] T2 the second task\n- [ ] T3 the third\n";

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
  const root = mkdtempSync(join(tmpdir(), `par-tail-${name}-`));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(workspace, TASK_LIST), THE_TASK_LIST_AT_LAUNCH);
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the tail bench");
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
    hash: "plan-hash-tail",
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
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

/* ------------------------------------------------------------------ *
 * A REAL OPEN GROUP, CARRIED TO A STATE OF THE EIGHT, on the disk:
 * real trees with real work in them, the records a run leaves at that
 * state, and the writer released — the state an engine leaves when it
 * dies in the middle of its group.
 * ------------------------------------------------------------------ */

type StateOfTheTail = 2 | 3 | 4 | 5 | 6 | 7 | 8;

async function openGroupAtTheState(input: {
  readonly fixture: Fixture;
  readonly state: StateOfTheTail;
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
  const store = treeStore(places, {
    runId: fixture.runId,
    groupId: GROUP_ID,
    taskListPath: TASK_LIST,
    ...(input.state >= 5 ? { recordAhead: theRecordAheadOfTheWriter(ledger.writer) } : {}),
  });
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
  const treeIds = new Map<string, string>();
  let position = 0;
  for (const worker of prepared.workers) {
    position += 1;
    /* THE WORK, as the stub pass of the step-3 fixture makes it: the edit in
     * the tree, and the checkpoint the pass wrote into its own outbox. */
    const target = join(worker.tree, "src", FILE_OF_TASK[worker.taskId] ?? "");
    writeFileSync(target, readFileSync(target, "utf8") + `\n// ${worker.taskId} was here\n`);
    const outbox = join(worker.tree, outboxOfAWorker(SLUG));
    mkdirSync(outbox, { recursive: true });
    writeFileSync(
      join(outbox, `${worker.taskId}.checkpoint.json`),
      JSON.stringify({ task: worker.taskId }),
    );
    const treeId = await store.snapshot(worker.tree);
    treeIds.set(worker.workerId, treeId);
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
    if (input.state >= 3) {
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
  if (input.state >= 4) {
    await ledger.writer.ahead(
      "group_barrier",
      dataOfTheKind("group_barrier", {
        fingerprint: baseTreeId,
        perWorkerFingerprint: Object.fromEntries(
          prepared.workers.map((worker) => [worker.workerId, treeIds.get(worker.workerId) ?? ""]),
        ),
      }),
      () => Promise.resolve(),
    );
  }
  if (input.state >= 5) {
    await ledger.writer.record("audit_done", {
      audits: Object.fromEntries(prepared.workers.map((worker) => [worker.workerId, "accepted"])),
    });
    const composition = await store.compose(
      baseTreeId,
      prepared.workers.map((worker) => ({
        workerId: worker.workerId,
        treeId: treeIds.get(worker.workerId) ?? "",
        paths: [`src/${FILE_OF_TASK[worker.taskId] ?? ""}`],
      })),
    );
    assert.equal(composition.composed, true, "the composition of the fixture refused");
    if (!composition.composed) return;
    await ledger.writer.record(
      "merge_done",
      dataOfTheKind("merge_done", {
        treeId: composition.treeId,
        workers: prepared.workers.map((worker) => worker.workerId),
      }),
    );
    if (input.state >= 7) {
      // The application went all the way through: the write-ahead record and
      // the workspace write a run makes together.
      await store.apply(baseTreeId, composition.treeId, fixture.workspace);
    } else {
      // States 5 and 6: the crash came between the WRITE-AHEAD record and the
      // workspace write, so the record stands and the workspace is still at
      // the base — the state a resume then verifies and repeats.
      const plan = applicationPlan(places, baseTreeId, composition.treeId, fixture.workspace);
      ledger.writer.recordNow(
        "apply_started",
        dataOfTheKind("apply_started", { paths: plan.paths }),
      );
    }
  }
  if (input.state >= 7) {
    await ledger.writer.record("applied", { fingerprint: await store.snapshot(fixture.workspace) });
  }
  if (input.state >= 8) {
    await theTickOfTheTaskList(join(fixture.workspace, TASK_LIST))([...TASKS]);
    await ledger.writer.record(
      "ticks_applied",
      dataOfTheKind("ticks_applied", { taskIds: [...TASKS] }),
    );
    await ledger.writer.record("merge_check_started", { checkManifestHash: hash("manifest") });
  }
  if (input.state === 6) {
    // The workspace moved under the group: a path of the delta that holds
    // neither the base nor the composed content.
    writeFileSync(join(fixture.workspace, "src", "a.ts"), "a third content\n");
  }
  releaseTheWriter(`${fixture.runId}:ledger`);
}

/* ------------------------------------------------------------------ *
 * The drive facts, the probe and the runner, as the wiring holds them.
 * ------------------------------------------------------------------ */

function probeOf(fixture: Fixture): ManifestEntry {
  return {
    id: "the-probe",
    kind: "command",
    argv: [
      "node",
      "-e",
      `const fs=require("node:fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:1)`,
      join(fixture.workspace, "src", "a.ts"),
      "T1 was here",
    ],
    phase: 2,
    timeLimitMs: 30_000,
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

/** The drive facts over the fixture, with the events collected. */
function driveOf(
  fixture: Fixture,
  events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[],
): TheTailOfTheResumeDrive {
  return {
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
    innerCheckSet: [probeOf(fixture)],
    containment: "C2",
    hash,
    emit: (type, data) => events.push({ type, data }),
  };
}

/** The open group of the fixture, discovered as the wiring discovers it. */
function openOf(fixture: Fixture): TheOpenParallelGroup {
  const open = theOpenParallelGroupOf({ controlRoot: fixture.controlRoot });
  assert.ok(open !== undefined, "the open group was not found");
  return open;
}

/** The carried tail of the fixture's open group, with the drive facts. */
async function carryTheTail(
  fixture: Fixture,
): Promise<
  Extract<
    Awaited<ReturnType<typeof carryOutTheResumeOfTheOpenGroup>>,
    { readonly carried: true; readonly attempt: unknown }
  >
> {
  const events: { readonly type: string; readonly data: Readonly<Record<string, unknown>> }[] = [];
  const carried = await carryOutTheResumeOfTheOpenGroup({
    open: openOf(fixture),
    controlRoot: fixture.controlRoot,
    drive: driveOf(fixture, events),
  });
  assert.equal(carried.carried, true, `the tail was not carried: ${JSON.stringify(carried)}`);
  if (!carried.carried || !("attempt" in carried)) throw new Error("unreachable");
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

/**
 * What the integration left in the workspace: the work of each task standing
 * in its file, and the tasks ticked in the task list — each asserted as asked,
 * because a state that refused the integration leaves NEITHER behind.
 */
function assertTheIntegrationStands(fixture: Fixture, work: boolean, ticks: boolean): void {
  for (const task of TASKS) {
    const file = join(fixture.workspace, "src", FILE_OF_TASK[task] ?? "");
    assert.equal(
      readFileSync(file, "utf8").includes(`${task} was here`),
      work,
      `the work of ${task} standing in the workspace is ${String(work)}`,
    );
  }
  const list = readFileSync(join(fixture.workspace, TASK_LIST), "utf8");
  for (const task of TASKS) {
    assert.equal(
      list.includes(`- [x] ${task}`),
      ticks,
      `the tick of ${task} standing in the task list is ${String(ticks)}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("state 3 verifies the tree ids and carries the group whole", async () => {
  const fixture = fixtureOf("state-3", "run-tail-3");
  try {
    await openGroupAtTheState({ fixture, state: 3 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "verify-the-tree-id");
    assert.equal(carried.state, 3);
    assert.equal(carried.stopped, undefined);
    const attempt = carried.attempt;
    assert.equal(attempt.ok, true);
    assert.equal(attempt.outcome, "kept");
    assert.equal(attempt.directive, "keep");
    assert.deepEqual(attempt.keptUnits, [["T1", "T2"]]);
    assert.equal(attempt.counts.agentMs, 0);
    // The audits were RE-RUN for real, and both were accepted.
    const audit = ledgerOf(fixture.controlRoot, fixture.runId).find(
      (record) => record.kind === "audit_done",
    );
    assert.deepEqual(audit?.data?.["audits"], { "w-1": "accepted", "w-2": "accepted" });
    // The barrier was written by the resume (the fixture wrote none).
    assert.ok(
      ledgerOf(fixture.controlRoot, fixture.runId).some(
        (record) => record.kind === "group_barrier",
      ),
      "the resume wrote no barrier",
    );
    assertTheIntegrationStands(fixture, true, true);
    const after = assertTheLedgerCloses({ fixture, outcome: "closed" });
    assert.equal(
      after.filter((record) => record.kind === "group_closed").length,
      1,
      "the group closed twice",
    );
    // Nothing stands open afterwards.
    assert.equal(theOpenParallelGroupOf({ controlRoot: fixture.controlRoot }), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("state 4 repeats the audits over the trees that stand", async () => {
  const fixture = fixtureOf("state-4", "run-tail-4");
  try {
    await openGroupAtTheState({ fixture, state: 4 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "repeat-from-the-audits");
    assert.equal(carried.state, 4);
    assert.equal(carried.attempt.outcome, "kept");
    assert.equal(carried.attempt.directive, "keep");
    assertTheIntegrationStands(fixture, true, true);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("state 4 with a workspace that moved refuses every worker", async () => {
  const fixture = fixtureOf("state-4-moved", "run-tail-4m");
  try {
    await openGroupAtTheState({ fixture, state: 4 });
    // The workspace moves OUTSIDE the delta after the group stands open.
    writeFileSync(join(fixture.workspace, "src", "other.ts"), "moved under the group\n");
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "repeat-from-the-audits");
    const attempt = carried.attempt;
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.directive, "none");
    assert.deepEqual(attempt.keptUnits, []);
    assert.deepEqual(attempt.tasksOnTheMainLine, [...TASKS]);
    // Every worker was refused because the workspace changed.
    const audit = ledgerOf(fixture.controlRoot, fixture.runId).find(
      (record) => record.kind === "audit_done",
    );
    assert.deepEqual(audit?.data?.["audits"], {
      "w-1": "workspace-changed",
      "w-2": "workspace-changed",
    });
    // Nothing was applied: no ticks stand, no merge check ran.
    assertTheIntegrationStands(fixture, false, false);
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(
      records.some((record) => record.kind === "ticks_applied"),
      false,
    );
    assert.equal(
      records.some((record) => record.kind === "merge_check_started"),
      false,
    );
    assert.equal(carried.stopped, undefined, "state 6 was not the stop this is");
    assertTheLedgerCloses({ fixture, outcome: "failed" });
  } finally {
    fixture.cleanup();
  }
});

test("state 5 verifies the application and repeats it in full", async () => {
  const fixture = fixtureOf("state-5", "run-tail-5");
  try {
    await openGroupAtTheState({ fixture, state: 5 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "repeat-the-application");
    assert.equal(carried.state, 5);
    assert.equal(carried.stopped, undefined);
    assert.equal(carried.attempt.outcome, "kept");
    assert.equal(carried.attempt.directive, "keep");
    assert.deepEqual(carried.attempt.keptUnits, [["T1", "T2"]]);
    assertTheIntegrationStands(fixture, true, true);
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    // The audits are read from the ledger, never re-run: exactly one record.
    assert.equal(records.filter((record) => record.kind === "audit_done").length, 1);
    // The application was repeated IN FULL: the write-ahead record went on
    // again ahead of it.
    assert.equal(records.filter((record) => record.kind === "apply_started").length, 2);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("state 6 stops the writing when a path holds neither content", async () => {
  const fixture = fixtureOf("state-6", "run-tail-6");
  try {
    await openGroupAtTheState({ fixture, state: 6 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "repeat-the-application");
    assert.ok(carried.stopped !== undefined, "the stop did not come");
    if (carried.stopped === undefined) return;
    assert.equal(carried.stopped.event, "apply-incomplete");
    assert.equal(carried.stopped.integrityKind, "tree-changed-outside-pass");
    assert.deepEqual(carried.stopped.neither, ["src/a.ts"]);
    assert.deepEqual(carried.stopped.outside, []);
    const attempt = carried.attempt;
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.directive, "none");
    assert.deepEqual(attempt.tasksOnTheMainLine, [...TASKS]);
    assertTheIntegrationStands(fixture, false, false);
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    // NOTHING more of the integration was written: no ticks, no merge check.
    assert.equal(
      records.some((record) => record.kind === "ticks_applied"),
      false,
    );
    assert.equal(
      records.some((record) => record.kind === "merge_check_started"),
      false,
    );
    assert.equal(
      records.some((record) => record.kind === "merge_check_finished"),
      false,
    );
    // The close is the one thing written after the stop (F143-FR-025).
    assertTheLedgerCloses({ fixture, outcome: "failed" });
  } finally {
    fixture.cleanup();
  }
});

test("state 7 writes only the ticks", async () => {
  const fixture = fixtureOf("state-7", "run-tail-7");
  try {
    await openGroupAtTheState({ fixture, state: 7 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "write-the-ticks");
    assert.equal(carried.state, 7);
    assert.equal(carried.attempt.outcome, "kept");
    assert.equal(carried.attempt.directive, "keep");
    assert.deepEqual(carried.attempt.keptUnits, [["T1", "T2"]]);
    assertTheIntegrationStands(fixture, true, true);
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    // Exactly one application stands: the ticks were written over it, and no
    // composition or application was repeated.
    assert.equal(records.filter((record) => record.kind === "apply_started").length, 1);
    assert.equal(records.filter((record) => record.kind === "merge_done").length, 1);
    assert.equal(records.filter((record) => record.kind === "ticks_applied").length, 1);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("state 8 runs the merge check over the ticks that stand", async () => {
  const fixture = fixtureOf("state-8", "run-tail-8");
  try {
    await openGroupAtTheState({ fixture, state: 8 });
    const carried = await carryTheTail(fixture);
    assert.equal(carried.action, "run-the-merge-check");
    assert.equal(carried.state, 8);
    assert.equal(carried.attempt.outcome, "kept");
    assert.equal(carried.attempt.directive, "keep");
    assert.deepEqual(carried.attempt.keptUnits, [["T1", "T2"]]);
    assertTheIntegrationStands(fixture, true, true);
    const records = ledgerOf(fixture.controlRoot, fixture.runId);
    // No application and no audit were repeated; the merge check ran once,
    // write-ahead and all: the interrupted start's `merge_check_started`
    // stands, and the resumed check wrote its own ahead of running (the same
    // repetition the write-ahead of a repeated application makes).
    assert.equal(records.filter((record) => record.kind === "apply_started").length, 1);
    assert.equal(records.filter((record) => record.kind === "audit_done").length, 1);
    assert.equal(records.filter((record) => record.kind === "merge_check_started").length, 2);
    assert.equal(records.filter((record) => record.kind === "merge_check_finished").length, 1);
    assertTheLedgerCloses({ fixture, outcome: "closed" });
  } finally {
    fixture.cleanup();
  }
});

test("a state that needs a worker restart is not carried, and nothing is written", async () => {
  const fixture = fixtureOf("state-2", "run-tail-2");
  try {
    await openGroupAtTheState({ fixture, state: 2 });
    const before = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.equal(before.length, 3);
    const carried = await carryOutTheResumeOfTheOpenGroup({
      open: openOf(fixture),
      controlRoot: fixture.controlRoot,
      drive: driveOf(fixture, []),
    });
    assert.equal(carried.carried, false);
    if (carried.carried) return;
    assert.equal(carried.action, "end-the-recorded-processes");
    assert.equal(carried.state, 2);
    assert.ok(carried.says !== undefined, "the decision named no sentence");
    const after = ledgerOf(fixture.controlRoot, fixture.runId);
    assert.deepEqual(
      after.map((record) => record.seq),
      before.map((record) => record.seq),
      "something was written over a state no tail carries",
    );
  } finally {
    fixture.cleanup();
  }
});

test("the wiring carries the tail as this start's group run, and a stop goes off for the run", async () => {
  const fixture = fixtureOf("wiring-tail", "run-tail-wired");
  try {
    await openGroupAtTheState({ fixture, state: 6 });
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
      runToken: "run-token-of-the-running-engine",
      timeLimitMs: 120_000,
      enginePid: process.pid,
      engineStartedAtMs: Date.now(),
      registry: fixture.registry,
      guardScriptPath: join(fixture.root, "worker-guard.mjs"),
      hash,
      innerCheckSet: [probeOf(fixture)],
      startDoor: async (worker) => {
        doorCalls += 1;
        return {
          workerId: worker.workerId,
          pid: 0,
          runTokenHash: hash("run-token-of-the-running-engine"),
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
    assert.equal(ran, true, "the carried tail did not run the group");
    assert.equal(doorCalls, 0, "the start door was called over a carried group");
    // The say named what stood open and the stop that put the layer off.
    const said = lines.join("\n");
    assert.ok(said.includes(fixture.runId), `the line does not name the run: ${said}`);
    assert.ok(said.includes(GROUP_ID), `the line does not name the group: ${said}`);
    assert.ok(
      said.includes("repeat-the-application"),
      `the line does not name the action: ${said}`,
    );
    assert.ok(said.includes("apply-incomplete"), `the line does not name the stop: ${said}`);
    assert.equal(
      wiring.layerOffForTheRun(),
      true,
      "the loop layer did not go off for the run at the stop",
    );
    assertTheIntegrationStands(fixture, false, false);
    assertTheLedgerCloses({ fixture, outcome: "failed" });
  } finally {
    fixture.cleanup();
  }
});
