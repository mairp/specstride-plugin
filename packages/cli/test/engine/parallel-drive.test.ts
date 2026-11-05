/**
 * THE DRIVE OF ONE GROUP, FROM THE BARRIER TO THE CLOSE, over REAL ports
 * (`parallel-drive.ts`, step 3 of `prompts/specstride-parallel-units.md`).
 * The decisions are core's; these tests pin THE EDGE — a real tree store over
 * a real git workspaces and worker trees, a real ledger file, real check
 * processes:
 *
 *  - THE LEDGER of a run is one JSON-lines file in the control plane of the
 *    run, beside the plan; the one queue numbers it `1, 2, …` with no gap, a
 *    relaunch opens it where the file left off and chains `prev`; a second
 *    writer over the same ledger is refused, and so is a kind outside the
 *    closed set;
 *  - THE DATA of a record on disk carries the closed set's OWN field names,
 *    whatever name the core module handed in;
 *  - THE DELTAS are read through the store's `changed`, the text of an added
 *    or changed object arriving with the path, a deleted object and an object
 *    over the text cap without it;
 *  - THE AUDITS accept what lies inside the scope, refuse what leaves it,
 *    refuse every worker where the workspace moved, and write `audit_done`
 *    AHEAD of the composition;
 *  - INTEGRATION composes disjoint deltas, applies them to the workspace,
 *    ticks the integrated tasks, and refuses an overlap without a record
 *    behind `merge_done`;
 *  - THE MERGE CHECK is written ahead of its first command — the command
 *    itself sees the record on disk — runs in the workspace and in no worker
 *    tree, keeps the unit on a pass, charges one repair per task on a failure,
 *    and turns the layer off on an empty inner set;
 *  - THE CLOSE releases every worker tree on success and on failure alike,
 *    removes the temporary directories, writes `group_closed` ahead of the
 *    sweep, and the sweep takes the snapshots.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import type { BarrierResult } from "../../../core/src/parallel/barrier.ts";
import { releaseTheWriter } from "../../../core/src/parallel/integrate.ts";
import { readAppendedRecords } from "../../../core/src/parallel/queue.ts";
import type { StorePlaces, TreeStoreService } from "../../../tree-store/src/index.ts";
import { initStore, treeStore } from "../../../tree-store/src/index.ts";
import {
  auditTheGroupThroughTheStore,
  closeTheGroupRun,
  dataOfTheKind,
  integrateThroughTheStore,
  openTheLedgerOfTheRun,
  parallelLedgerPathOf,
  readTheDeltasOfTheGroup,
  theMergeCheckOfTheGroup,
  theRecordAheadOfTheWriter,
  theWorkersForIntegration,
  THE_TEXT_CAP_OF_A_DELTA_OBJECT,
} from "../../src/engine/parallel-drive.ts";

/* ------------------------------------------------------------------ *
 * The bench: a real git workspace, a real tree store, a real ledger.
 * ------------------------------------------------------------------ */

const TASK_LIST = "tasks.md";

/** The hash of annex X §X.5, as the engine computes it. */
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

type Bench = {
  readonly root: string;
  readonly workspace: string;
  readonly places: StorePlaces;
  readonly store: TreeStoreService;
  readonly controlRoot: string;
  readonly runId: string;
};

function git(cwd: string, ...argv: readonly string[]): void {
  const done = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(done.status, 0, `git ${argv.join(" ")} failed: ${done.stderr}`);
}

/** The bench, with the base snapshot of the group already taken. */
function benchOf(): Bench {
  const root = mkdtempSync(join(tmpdir(), "specstride-drive-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "docs"), { recursive: true });
  git(workspace, "init", "--quiet", ".");
  writeFileSync(join(workspace, ".gitignore"), ".specstride/\n");
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(join(workspace, "docs", "readme.md"), "# readme\n");
  writeFileSync(
    join(workspace, TASK_LIST),
    "- [ ] 2-a the first task\n- [ ] 2-b the second task\n- [ ] 2-c the third\n",
  );
  git(workspace, "add", "--", ".");
  git(workspace, "commit", "-q", "-m", "the drive bench");
  const places: StorePlaces = {
    store: join(root, "control", "tree-store"),
    workerRoot: join(root, "worker-root"),
    control: join(root, "control"),
  };
  initStore(places);
  const store = treeStore(places, { runId: "run-drive", groupId: "g-2-1" });
  return {
    root,
    workspace,
    places,
    store,
    controlRoot: join(root, "control"),
    runId: "run-drive",
  };
}

/** A worker pass that ended: materialize its tree, edit it, snapshot it. */
async function workerDid(
  bench: Bench,
  base: string,
  workerId: string,
  edits: (treePath: string) => void,
): Promise<{ readonly treePath: string; readonly finalTreeId: string }> {
  const tree = await bench.store.materialize(base, workerId);
  edits(tree.path);
  return { treePath: tree.path, finalTreeId: await bench.store.snapshot(tree.path) };
}

/** The records of the ledger of the bench, as the file holds them. */
function ledgerOf(bench: Bench): readonly ReturnType<typeof readAppendedRecords>["records"] {
  const file = parallelLedgerPathOf(bench.controlRoot, bench.runId);
  // A ledger that never wrote a record has no file at all.
  if (!existsSync(file)) return [];
  return readAppendedRecords(readFileSync(file, "utf8")).records;
}

/** A worker whose delta every audit accepted. */
function acceptedVerdict(workerId: string): WorkerAuditVerdictShape {
  return {
    workerId,
    verdict: "accepted",
    detail: "every path lies inside the scope; no unauthorised protected change; no leak",
    dropped: [],
    paths: [],
    authorisedProtectedChanges: [],
  };
}
type WorkerAuditVerdictShape = {
  readonly workerId: string;
  readonly verdict: "accepted";
  readonly detail: string;
  readonly dropped: readonly string[];
  readonly paths: readonly string[];
  readonly authorisedProtectedChanges: readonly string[];
};

/** A barrier result of two workers, one integrated and one integrated. */
function barrierOf(
  rows: readonly {
    workerId: string;
    finalTreeId: string;
    outcome: "integrated" | "killed" | "refused" | "paused";
  }[],
): BarrierResult {
  return {
    perWorker: rows.map((row) => ({
      workerId: row.workerId,
      finalTreeId: row.finalTreeId,
      fingerprintAtTheBarrier: row.finalTreeId,
      treeChangedAfterTheFinalSnapshot: false,
      processesEnded: [],
      outcome:
        row.outcome === "integrated"
          ? {
              workerId: row.workerId,
              outcome: "integrated" as const,
              chargesItsTask: true,
              taskReturnsToTheMainLine: false,
            }
          : {
              workerId: row.workerId,
              outcome: row.outcome,
              ...(row.outcome === "refused" ? { reason: "the checkpoint is absent" as const } : {}),
              chargesItsTask: false,
              taskReturnsToTheMainLine: true,
            },
    })),
    protection: "enforce",
    integrationMayStart: true,
    candidates: rows.filter((row) => row.outcome === "integrated").map((row) => row.workerId),
  };
}

/**
 * A REAL check runner: the command runs as a process, in the working
 * directory `start` was given, with its real exit code.
 */
function spawnRunner(): CheckRunner {
  const results = new Map<string, { exitCode: number; durationMs: number }>();
  let next = 0;
  return {
    pin: async (entry) => ({
      kind: "command",
      executable: entry.argv[0] ?? "node",
      argv: entry.argv.slice(1),
    }),
    start: async (input) => {
      const id = `h${String(++next)}`;
      const began = Date.now();
      const done = spawnSync(input.identity.executable ?? "node", input.identity.argv ?? [], {
        cwd: input.workingDirectory,
        encoding: "utf8",
        timeout: input.timeLimitMs,
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
 * The tests.
 * ------------------------------------------------------------------ */

test("the ledger of a run is one file in the control plane, beside the plan", () => {
  assert.equal(
    parallelLedgerPathOf("/control", "run-1"),
    join("/control", "runs", "run-1", "parallel-ledger.jsonl"),
  );
});

test("a fresh ledger numbers its records from one, and the envelope is the closed set's", async () => {
  const bench = benchOf();
  try {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    await ledger.writer.record("group_planned", {
      groupId: "g-2-1",
      tasks: ["2-a", "2-b"],
      planHash: hash("plan"),
    });
    ledger.queue.drainNow();
    const records = ledgerOf(bench);
    assert.equal(records.length, 1);
    const one = records[0]!;
    assert.equal(one.seq, 1);
    assert.equal(one.schema, "specstride.ledger/1");
    assert.equal(one.ns, "parallel");
    assert.equal(one.kind, "group_planned");
    assert.equal(one.groupId, "g-2-1");
    assert.deepEqual(one.data, { groupId: "g-2-1", tasks: ["2-a", "2-b"], planHash: hash("plan") });
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("a ledger opened again goes on where the file left off, without a gap, and chains prev", async () => {
  const bench = benchOf();
  try {
    const first = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    await first.writer.record("group_planned", {
      groupId: "g-2-1",
      tasks: ["2-a"],
      planHash: "p1",
    });
    await first.writer.record("group_started", {
      baseTree: await bench.store.snapshot(bench.workspace),
      workspaceFingerprint: "f1",
    });
    first.queue.drainNow();
    assert.deepEqual(
      ledgerOf(bench).map((record) => record.seq),
      [1, 2],
    );

    // A relaunch is a new process; within this one, the writer of the run is
    // given back so the reopened ledger may take it again.
    releaseTheWriter(`${bench.runId}:ledger`);
    const second = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    assert.equal(second.held.length, 2);
    await second.writer.record("audit_done", { audits: { "w-1": "accepted" } });
    second.queue.drainNow();
    const records = ledgerOf(bench);
    assert.deepEqual(
      records.map((record) => record.seq),
      [1, 2, 3],
    );
    assert.equal(records[2]!.prev, hash(JSON.stringify(records[1]) + "\n"));
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("a second writer of one ledger in one process is refused", () => {
  const bench = benchOf();
  try {
    openTheLedgerOfTheRun({ controlRoot: bench.controlRoot, runId: bench.runId, groupId: "g-2-1" });
    assert.throws(
      () =>
        openTheLedgerOfTheRun({
          controlRoot: bench.controlRoot,
          runId: bench.runId,
          groupId: "g-2-1",
        }),
      /a-second-writer-of-the-ledger/,
    );
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("a kind outside the closed set is refused at the write", async () => {
  const bench = benchOf();
  try {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    await assert.rejects(
      // @ts-expect-error — a kind outside the closed set, on purpose.
      ledger.writer.record("not-a-kind", {}),
      /kind-is-not-of-the-closed-set/,
    );
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("the data of a record on disk carries the closed set's own field names", () => {
  assert.deepEqual(
    dataOfTheKind("group_barrier", { fingerprint: "f", perWorkerFingerprint: { w: "g" } }),
    {
      workspaceFingerprint: "f",
      workerFingerprints: { w: "g" },
    },
  );
  assert.deepEqual(dataOfTheKind("merge_done", { treeId: "t", workers: ["w-1"] }), {
    composedTreeId: "t",
    acceptedWorkers: ["w-1"],
  });
  assert.deepEqual(dataOfTheKind("worker_ended", { fingerprint: "g" }), { treeFingerprint: "g" });
  assert.deepEqual(dataOfTheKind("applied", { fingerprint: "f" }), { workspaceFingerprint: "f" });
  // A name the registry already speaks is kept, and an unnamed field is kept.
  assert.deepEqual(dataOfTheKind("group_started", { baseTree: "t", fingerprint: "f" }), {
    baseTree: "t",
    workspaceFingerprint: "f",
  });
  assert.deepEqual(dataOfTheKind("ticks_applied", { taskIds: ["2-a"] }), { taskIds: ["2-a"] });
});

test("the deltas are read through the store, with the text of what a worker wrote", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
      writeFileSync(join(tree, "src", "new.ts"), "export const fresh = true;\n");
      rmSync(join(tree, "src", "b.ts"));
    });
    const w2 = await workerDid(bench, base, "w-2", (tree) => {
      writeFileSync(join(tree, "docs", "big.md"), "x".repeat(THE_TEXT_CAP_OF_A_DELTA_OBJECT + 1));
    });
    const deltas = await readTheDeltasOfTheGroup({
      store: bench.store,
      baseTreeId: base,
      workers: [
        { workerId: "w-1", treeId: w1.finalTreeId, treePath: w1.treePath },
        { workerId: "w-2", treeId: w2.finalTreeId, treePath: w2.treePath },
      ],
    });
    assert.equal(deltas.length, 2);
    assert.equal(deltas[0]!.source, "store");
    const ofW1 = Object.fromEntries(deltas[0]!.paths.map((path) => [path.path, path]));
    assert.equal(ofW1["src/a.ts"]?.kind, "changed");
    assert.match(ofW1["src/a.ts"]?.text ?? "", /export const a = 2/);
    assert.equal(ofW1["src/new.ts"]?.kind, "added");
    assert.match(ofW1["src/new.ts"]?.text ?? "", /fresh = true/);
    assert.equal(ofW1["src/b.ts"]?.kind, "deleted");
    assert.equal(ofW1["src/b.ts"]?.text, undefined);
    const ofW2 = Object.fromEntries(deltas[1]!.paths.map((path) => [path.path, path]));
    // An object over the text cap arrives without its text.
    assert.equal(ofW2["docs/big.md"]?.text, undefined);
  } finally {
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("the audits accept what lies inside the scope and write audit_done ahead of the composition", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
    });
    const w2 = await workerDid(bench, base, "w-2", (tree) => {
      writeFileSync(join(tree, "docs", "stray.md"), "# outside the scope\n");
    });
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const deltas = await readTheDeltasOfTheGroup({
      store: bench.store,
      baseTreeId: base,
      workers: [
        { workerId: "w-1", treeId: w1.finalTreeId, treePath: w1.treePath },
        { workerId: "w-2", treeId: w2.finalTreeId, treePath: w2.treePath },
      ],
    });
    const audit = await auditTheGroupThroughTheStore({
      writer: ledger.writer,
      deltas,
      prefixesOf: (workerId) => (workerId === "w-1" ? ["src"] : ["src"]),
      protectedSet: { paths: [], patterns: [] },
      taskTextAtLaunch: "- [ ] 2-a the first task\n- [ ] 2-b the second task\n",
      secretsOf: () => ({
        workerRoot: bench.places.workerRoot,
        treeStore: bench.places.store,
        controlPlane: bench.controlRoot,
        workerToken: "token-of-the-worker",
      }),
      singleWriter: {
        taskList: join(bench.workspace, TASK_LIST),
        phaseEvidence: [],
        notebook: join(bench.controlRoot, "notebook.md"),
        handoff: join(bench.places.workerRoot, "handoff.json"),
        workspacePart: join(bench.workspace, ".specstride"),
      },
    });
    assert.deepEqual(audit.accepted, ["w-1"]);
    assert.deepEqual(
      audit.refused.map((row) => [row.workerId, row.reason]),
      [["w-2", "scope"]],
    );
    // The record is on disk, ahead of anything that follows it.
    ledger.queue.drainNow();
    const records = ledgerOf(bench);
    const at = records.findIndex((record) => record.kind === "audit_done");
    assert.ok(at !== -1, "no audit_done record");
    assert.deepEqual(records[at]!.data, { audits: { "w-1": "accepted", "w-2": "scope" } });
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("a workspace that moved refuses every worker", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
    });
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const deltas = await readTheDeltasOfTheGroup({
      store: bench.store,
      baseTreeId: base,
      workers: [{ workerId: "w-1", treeId: w1.finalTreeId, treePath: w1.treePath }],
    });
    const audit = await auditTheGroupThroughTheStore({
      writer: ledger.writer,
      deltas,
      prefixesOf: () => ["src"],
      protectedSet: { paths: [], patterns: [] },
      taskTextAtLaunch: "- [ ] 2-a the first task\n",
      secretsOf: () => ({
        workerRoot: bench.places.workerRoot,
        treeStore: bench.places.store,
        controlPlane: bench.controlRoot,
        workerToken: "token-of-the-worker",
      }),
      singleWriter: {
        taskList: join(bench.workspace, TASK_LIST),
        phaseEvidence: [],
        notebook: join(bench.controlRoot, "notebook.md"),
        handoff: join(bench.places.workerRoot, "handoff.json"),
        workspacePart: join(bench.workspace, ".specstride"),
      },
      workspaceChanged: true,
    });
    assert.deepEqual(audit.accepted, []);
    assert.deepEqual(
      audit.refused.map((row) => [row.workerId, row.reason]),
      [["w-1", "workspace-changed"]],
    );
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("the workers for integration keep the barrier's outcome and yield to an audit refusal", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
    });
    const w2 = await workerDid(bench, base, "w-2", (tree) => {
      writeFileSync(join(tree, "src", "b.ts"), "export const b = 3;\n");
    });
    const w3 = await workerDid(bench, base, "w-3", (tree) => {
      writeFileSync(join(tree, "docs", "c.md"), "# c\n");
    });
    const barrier = barrierOf([
      { workerId: "w-1", finalTreeId: w1.finalTreeId, outcome: "integrated" },
      { workerId: "w-2", finalTreeId: w2.finalTreeId, outcome: "integrated" },
      { workerId: "w-3", finalTreeId: w3.finalTreeId, outcome: "killed" },
    ]);
    // The audits refused w-1 and accepted w-2; w-3 was killed, and stays
    // killed whatever the audits say.
    const workers = await theWorkersForIntegration({
      store: bench.store,
      baseTreeId: base,
      barrier,
      taskOf: (workerId) => (workerId === "w-1" ? "2-a" : workerId === "w-2" ? "2-b" : "2-c"),
      ends: new Map([
        ["w-1", "ended"],
        ["w-2", "ended"],
        ["w-3", "killed"],
      ]),
      verdicts: new Map([
        ["w-1", { ...acceptedVerdict("w-1"), verdict: { refused: "scope" as const } }],
        ["w-2", acceptedVerdict("w-2")],
      ]),
    });
    assert.equal(workers.length, 3);
    assert.deepEqual(
      workers.map((worker) => [worker.workerId, worker.outcome.outcome]),
      [
        ["w-1", "refused"],
        ["w-2", "integrated"],
        ["w-3", "killed"],
      ],
    );
    const ofW1 = workers[0]!;
    assert.equal(ofW1.outcome.chargesItsTask, false);
    assert.equal(ofW1.outcome.taskReturnsToTheMainLine, true);
    assert.deepEqual(ofW1.paths, ["src/a.ts"]);
    assert.deepEqual(workers[2]!.paths, ["docs/c.md"]);
  } finally {
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("integration composes disjoint deltas, applies them, and ticks the integrated tasks", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
    });
    const w2 = await workerDid(bench, base, "w-2", (tree) => {
      writeFileSync(join(tree, "docs", "d.md"), "# d\n");
    });
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    // The store that applies is built with the write-ahead recorder of the
    // engine, so `apply_started` is on disk before one byte is written.
    const applying = treeStore(bench.places, {
      runId: bench.runId,
      groupId: "g-2-1",
      recordAhead: theRecordAheadOfTheWriter(ledger.writer),
    });
    const workers = [
      {
        workerId: "w-1",
        task: "2-a",
        finalTreeId: w1.finalTreeId,
        paths: ["src/a.ts"],
        outcome: {
          workerId: "w-1",
          outcome: "integrated" as const,
          chargesItsTask: true,
          taskReturnsToTheMainLine: false,
        },
      },
      {
        workerId: "w-2",
        task: "2-b",
        finalTreeId: w2.finalTreeId,
        paths: ["docs/d.md"],
        outcome: {
          workerId: "w-2",
          outcome: "integrated" as const,
          chargesItsTask: true,
          taskReturnsToTheMainLine: false,
        },
      },
    ];
    const result = await integrateThroughTheStore({
      store: applying,
      writer: ledger.writer,
      tick: (taskIds) => tickOfTheTaskList(bench.workspace, taskIds),
      baseTreeId: base,
      workspace: bench.workspace,
      workers,
    });
    assert.equal(result.integrated, true);
    if (result.integrated) {
      assert.deepEqual(result.ticked, ["2-a", "2-b"]);
      assert.ok(result.paths.includes("src/a.ts"));
      assert.ok(result.paths.includes("docs/d.md"));
      assert.deepEqual(result.leftOut, []);
      assert.deepEqual(result.tasksReturned, []);
    }
    // The workspace holds the work of both workers now.
    assert.match(readFileSync(join(bench.workspace, "src", "a.ts"), "utf8"), /a = 2/);
    assert.match(readFileSync(join(bench.workspace, "docs", "d.md"), "utf8"), /# d/);
    assert.match(readFileSync(join(bench.workspace, TASK_LIST), "utf8"), /- \[x\] 2-a/);
    assert.match(readFileSync(join(bench.workspace, TASK_LIST), "utf8"), /- \[x\] 2-b/);
    // The ledger holds the state sequence, with the closed set's field names.
    ledger.queue.drainNow();
    const kinds = ledgerOf(bench).map((record) => record.kind);
    assert.deepEqual(kinds, ["merge_done", "apply_started", "applied", "ticks_applied"]);
    const records = ledgerOf(bench);
    assert.deepEqual(records[0]!.data, {
      composedTreeId: result.integrated ? result.composedTreeId : "",
      acceptedWorkers: ["w-1", "w-2"],
    });
    assert.ok((records[2]!.data as { workspaceFingerprint: string }).workspaceFingerprint !== "");
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("an overlap is refused before any record behind merge_done", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const w1 = await workerDid(bench, base, "w-1", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 2;\n");
    });
    const w2 = await workerDid(bench, base, "w-2", (tree) => {
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 3;\n");
    });
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const applying = treeStore(bench.places, {
      runId: bench.runId,
      groupId: "g-2-1",
      recordAhead: theRecordAheadOfTheWriter(ledger.writer),
    });
    const result = await integrateThroughTheStore({
      store: applying,
      writer: ledger.writer,
      tick: (taskIds) => tickOfTheTaskList(bench.workspace, taskIds),
      baseTreeId: base,
      workspace: bench.workspace,
      workers: [
        {
          workerId: "w-1",
          task: "2-a",
          finalTreeId: w1.finalTreeId,
          paths: ["src/a.ts"],
          outcome: {
            workerId: "w-1",
            outcome: "integrated" as const,
            chargesItsTask: true,
            taskReturnsToTheMainLine: false,
          },
        },
        {
          workerId: "w-2",
          task: "2-b",
          finalTreeId: w2.finalTreeId,
          paths: ["src/a.ts"],
          outcome: {
            workerId: "w-2",
            outcome: "integrated" as const,
            chargesItsTask: true,
            taskReturnsToTheMainLine: false,
          },
        },
      ],
    });
    assert.equal(result.integrated, false);
    if (!result.integrated) {
      assert.equal(result.reason, "overlap");
      assert.equal(result.workerId, "w-2");
    }
    // The workspace is untouched, and the ledger holds nothing after the refusal.
    assert.equal(
      readFileSync(join(bench.workspace, "src", "a.ts"), "utf8"),
      "export const a = 1;\n",
    );
    ledger.queue.drainNow();
    assert.deepEqual(
      ledgerOf(bench).map((record) => record.kind),
      [],
    );
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("the merge check is written ahead of its first command, and a pass keeps the unit", async () => {
  const bench = benchOf();
  try {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    // The command itself reads the ledger: the record `merge_check_started`
    // must already be on disk when it runs.
    const probe = join(bench.root, "probe.txt");
    const entry: ManifestEntry = {
      id: "the-probe",
      kind: "command",
      argv: [
        "node",
        "-e",
        `const fs = require("node:fs");
         const text = fs.readFileSync(process.argv[1], "utf8");
         fs.writeFileSync(process.argv[2], String(text.includes("merge_check_started")));`,
        parallelLedgerPathOf(bench.controlRoot, bench.runId),
        probe,
      ],
      phase: 2,
      timeLimitMs: 30_000,
    };
    const check = await theMergeCheckOfTheGroup({
      store: bench.store,
      writer: ledger.writer,
      runner: spawnRunner(),
      innerCheckSet: [entry],
      workspace: bench.workspace,
      workerTrees: [join(bench.places.workerRoot, "w-1")],
      tasks: ["2-a", "2-b"],
      hash,
    });
    assert.equal(check.run.passed, true);
    assert.equal(check.run.unchecked, false);
    assert.equal(check.run.ranOn, bench.workspace);
    assert.deepEqual(
      check.run.commands.map((command) => [command.id, command.workingDirectory]),
      [["the-probe", bench.workspace]],
    );
    assert.equal(check.outcome.directive, "keep");
    if (check.outcome.directive === "keep") {
      assert.deepEqual(check.outcome.unit.tasks, ["2-a", "2-b"]);
      assert.equal(check.outcome.unit.unitId, hash("2-a\n2-b"));
      assert.deepEqual(check.outcome.repairsCharged, []);
    }
    assert.equal(readFileSync(probe, "utf8"), "true");
    ledger.queue.drainNow();
    const kinds = ledgerOf(bench).map((record) => record.kind);
    assert.deepEqual(kinds, ["merge_check_started", "merge_check_finished"]);
    const finished = ledgerOf(bench)[1]!;
    assert.deepEqual(finished.data, {
      fingerprint: check.run.fingerprintAfter,
      results: { "the-probe": "pass" },
      conditions: [],
    });
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("a failure of the merge check charges one repair per task and keeps the work", async () => {
  const bench = benchOf();
  try {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const check = await theMergeCheckOfTheGroup({
      store: bench.store,
      writer: ledger.writer,
      runner: spawnRunner(),
      innerCheckSet: [
        {
          id: "the-gate",
          kind: "command",
          argv: ["node", "-e", "process.exit(1)"],
          phase: 2,
          timeLimitMs: 30_000,
        },
      ],
      workspace: bench.workspace,
      tasks: ["2-a", "2-b"],
      hash,
    });
    assert.equal(check.outcome.directive, "repair");
    if (check.outcome.directive === "repair") {
      assert.deepEqual(check.outcome.repairsCharged, [
        { taskId: "2-a", repairs: 1 },
        { taskId: "2-b", repairs: 1 },
      ]);
      assert.match(check.outcome.because, /exited 1/);
      assert.equal(check.outcome.reverted, false);
    }
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("an empty inner check set turns the layer off for the attempt", async () => {
  const bench = benchOf();
  try {
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const check = await theMergeCheckOfTheGroup({
      store: bench.store,
      writer: ledger.writer,
      runner: spawnRunner(),
      innerCheckSet: [],
      workspace: bench.workspace,
      tasks: ["2-a"],
      hash,
    });
    assert.equal(check.run.unchecked, true);
    assert.equal(check.outcome.directive, "layerOffForAttempt");
    if (check.outcome.directive === "layerOffForAttempt")
      assert.equal(check.outcome.reason, "unchecked");
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});

test("the close releases every tree, removes the temporary directories, and sweeps", async () => {
  const bench = benchOf();
  try {
    const base = await bench.store.snapshot(bench.workspace);
    const tree = await bench.store.materialize(base, "w-1");
    const ledger = openTheLedgerOfTheRun({
      controlRoot: bench.controlRoot,
      runId: bench.runId,
      groupId: "g-2-1",
    });
    const closed = await closeTheGroupRun({
      places: bench.places,
      store: bench.store,
      writer: ledger.writer,
      runId: bench.runId,
      groupId: "g-2-1",
      outcome: "closed",
      prepared: {
        baseTreeId: base,
        workerTrees: [tree],
        workers: [
          {
            workerId: tree.workerId,
            taskId: "2-a",
            tree: tree.path,
            outboxPath: join(tree.temporaryDirectory, "outbox.jsonl"),
            handoffPath: join(tree.temporaryDirectory, "handoff.json"),
            temporaryDirectory: tree.temporaryDirectory,
            workerToken: "token-of-w-1",
          },
        ],
      },
      workerOutcomes: { "w-1": "integrated" },
    });
    assert.equal(closed.treesRemoved.length, 1);
    assert.deepEqual(closed.workerOutcomes, { "w-1": "integrated" });
    assert.equal(existsSync(tree.path), false, "the worker tree is gone");
    assert.equal(existsSync(tree.temporaryDirectory), false, "the temporary directory is gone");
    ledger.queue.drainNow();
    const record = ledgerOf(bench).find((one) => one.kind === "group_closed");
    assert.ok(record !== undefined, "no group_closed record");
    assert.deepEqual(record!.data, {
      outcome: "closed",
      workerOutcomes: { "w-1": "integrated" },
      treesRemoved: closed.treesRemoved,
    });
    // On a failure the trees go all the same. The sweep that carries the
    // snapshots away is the one at the END OF THE ATTEMPT (CQ-237), which the
    // wiring configures on the service it builds for it; the close's own call
    // takes the orphans.
    const second = await bench.store.materialize(base, "w-2");
    const attemptEnd = treeStore(bench.places, {
      runId: bench.runId,
      groupId: "g-2-1",
      sweep: { snapshots: [base] },
    });
    const failed = await closeTheGroupRun({
      places: bench.places,
      store: attemptEnd,
      writer: ledger.writer,
      runId: bench.runId,
      groupId: "g-2-1",
      outcome: "failed",
      workerOutcomes: { "w-2": "refused" },
    });
    assert.equal(existsSync(second.path), false);
    assert.deepEqual(failed.swept, [base]);
  } finally {
    releaseTheWriter(`${bench.runId}:ledger`);
    rmSync(bench.root, { recursive: true, force: true });
  }
});
