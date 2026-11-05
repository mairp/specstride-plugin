/**
 * THE PREPARATION, THE RUN AND THE BARRIER OF ONE GROUP at the composition
 * root (step 3 of `prompts/specstride-parallel-units.md`). The decisions are
 * core's; these tests pin THE EDGE — real directories, real files, real
 * processes:
 *
 *  - THE PLACES of the store name the worker root OUTSIDE the workspace and
 *    the control plane, by the run alone;
 *  - THE PREPARATION takes ONE base snapshot for the group, materializes one
 *    tree per member, gives each an EMPTY outbox and its handoff, and a
 *    temporary directory BESIDE the tree — never inside it; the main line's
 *    outbox is not in the worker tree;
 *  - THE CHECKPOINT is read only from a regular file that names the task;
 *    a link, a broken file, a file that names nothing — no checkpoint;
 *  - THE RUN starts the workers of the group supervised (real `sleep`
 *    processes, real guards, real registry entries), observes every pass end
 *    through the door, carries it into the runner, remembers the checkpoint
 *    a KILLED pass left by the hash of its bytes, and answers a start
 *    refusal of the door with a typed refusal of the group start;
 *  - THE GROUP PROBE asks the process group itself: a dead leader that still
 *    holds a process is not claimed empty;
 *  - THE BARRIER takes the final snapshots, fingerprints the trees again,
 *    writes the one `group_barrier` record, refuses a yield artifact, a bad
 *    checkpoint, a checkpoint of a killed pass (and not one a restarted pass
 *    overwrote), and a tree that moved after its final snapshot.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TreeStoreService } from "@specstride/contracts/ep/tree-store";
import { startTimeOf } from "@specstride/kernel";
import type { RegistryAccess, RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";
import type { ParallelPlan } from "../../../layer-parallel/src/index.ts";
import { processIsGone, writeWorkerGuardScript } from "../../src/engine/worker-supervisor.ts";
import { workerRecordPathOf, workersDirectoryOf } from "../../src/engine/group-run.ts";
import {
  closeTheGroup,
  hashOfTheWorkerCheckpoint,
  membersOfTheGroup,
  placesOfTheParallelStore,
  prepareTheGroupTrees,
  readTheWorkerCheckpoint,
  removeTheTemporaryDirectories,
  runTheGroupWorkers,
  theGroupIsAlive,
  WorkerStartRefused,
  workerCheckpointName,
  yieldArtifactIn,
  type PreparedGroup,
  type StartedWorkerPass,
} from "../../src/engine/parallel-group.ts";

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

const SLUG = "par-group-edge";

/** A workspace seed with a project file and a MAIN LINE outbox that holds a stale checkpoint. */
function seedWorkspaceOf(root: string): string {
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, ".specstride", "features", SLUG, "outbox"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(workspace, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(
    join(workspace, ".specstride", "features", SLUG, "outbox", "stale.checkpoint.json"),
    JSON.stringify({ task: "1-a" }),
  );
  return workspace;
}

/** The content hash of a directory tree, stable across unchanged contents. */
function contentHash(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const next = rel === "." ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) {
        lines.push(
          `${next}:${createHash("sha256")
            .update(readFileSync(join(dir, next)))
            .digest("hex")}`,
        );
      }
    }
  };
  walk(".");
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

/**
 * A REAL-ENOUGH tree store: the snapshot ids are content hashes of the
 * directories (so a tree that moved between the final snapshot and the
 * fingerprint really moves), `materialize` copies the seed WITHOUT the main
 * line's `.specstride` (an ignored path is never in a snapshot), and the
 * seven operations and no others are offered. `beforeFingerprint` runs
 * before the SECOND snapshot of a worker tree — the hook that simulates a
 * tree that moved.
 */
function fakeStoreOf(
  seed: string,
  treesRoot: string,
  beforeFingerprint?: (treePath: string) => void,
): TreeStoreService {
  const counts = new Map<string, number>();
  const snapshot = async (directory: string): Promise<string> => {
    const count = (counts.get(directory) ?? 0) + 1;
    counts.set(directory, count);
    if (count > 1 && directory.startsWith(treesRoot) && beforeFingerprint !== undefined) {
      beforeFingerprint(directory);
    }
    return `t-${contentHash(directory)}`;
  };
  const notUsed = (name: string) => async () => {
    throw new Error(`the tree store operation \`${name}\` is not of this test`);
  };
  const store: TreeStoreService = {
    snapshot,
    materialize: async (treeId, workerId) => {
      const path = join(treesRoot, workerId);
      cpSync(seed, path, {
        recursive: true,
        filter: (source) => !source.includes(`${join(".specstride")}`),
      });
      return { workerId, path, treeId: `${treeId}+${workerId}` };
    },
    changed: notUsed("changed"),
    compose: notUsed("compose"),
    apply: notUsed("apply"),
    release: notUsed("release"),
    sweep: notUsed("sweep"),
  };
  return store;
}

/** A plan of one phase with one group of three tasks and two serial tasks. */
function planOfThree(): ParallelPlan {
  const scope = (prefixes: string[]) => ({ prefixes, source: "task-text" as const });
  return {
    schema: "specstride.parallel-plan/1",
    runId: "run-x",
    hash: "plan-hash-x",
    workers: 3,
    fallback: undefined,
    phases: [
      {
        phase: 1,
        groups: [{ ordinal: 1, phase: 1, tasks: ["1-a", "1-b", "1-c"] }],
        tasks: [
          { id: "1-a", scope: scope(["src/a"]), checks: [] },
          { id: "1-b", scope: scope(["src/b"]), checks: [] },
          { id: "1-c", scope: scope(["src/c"]), checks: [] },
        ],
        serial: [],
        ceiling: 3,
      },
    ],
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

/** A stub worker (`sleep 600`) of its own process group, detached. */
function stubWorker(): { readonly pid: number; readonly group: number } {
  const child = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }) as ChildProcess & {
    pid: number;
  };
  const pid = child.pid as number;
  child.unref();
  return { pid, group: pid };
}

/** Waits until the host can observe the start time of a fresh process. */
async function untilObservable(pid: number): Promise<number> {
  const deadline = Date.now() + 2_000;
  let startedAtMs: number | null = null;
  while (startedAtMs === null && Date.now() < deadline) {
    startedAtMs = startTimeOf(pid);
    if (startedAtMs === null) await new Promise((done) => setTimeout(done, 20));
  }
  assert.notEqual(startedAtMs, null, `the start time of pid ${String(pid)} stayed unobservable`);
  return startedAtMs as number;
}

/** A pid that is already reaped: nothing answers it, and no group holds it. */
async function aGonePid(): Promise<number> {
  const child = spawn("true", [], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise<void>((done) => child.on("exit", () => done()));
  return pid;
}

/** Waits for a condition with a deadline, ticking every 25 ms. */
async function until(what: () => boolean, withinMs: number, why: string): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!what()) {
    if (Date.now() > deadline) assert.fail(`timed out: ${why}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Ends the process groups of stub workers, and settles. */
async function endGroups(groups: readonly number[]): Promise<void> {
  for (const group of groups) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  await new Promise((done) => setTimeout(done, 120));
}

type RunFixture = {
  readonly root: string;
  readonly workspace: string;
  readonly store: TreeStoreService;
  readonly treesRoot: string;
  readonly workersDir: string;
  readonly guardScriptPath: string;
  readonly registry: RegistryAccess;
  cleanup: () => void;
};

/** One fixture: a workspace seed, a store, a workers directory, a registry. */
function fixtureOf(name: string, beforeFingerprint?: (treePath: string) => void): RunFixture {
  const root = mkdtempSync(join(tmpdir(), `par-group-${name}-`));
  const workspace = seedWorkspaceOf(root);
  const treesRoot = join(root, "trees");
  mkdirSync(treesRoot, { recursive: true });
  const workersDir = workersDirectoryOf(root, SLUG);
  const guardScriptPath = join(root, "worker-guard.mjs");
  writeWorkerGuardScript(guardScriptPath);
  const registryPath = join(root, "procs.json");
  return {
    root,
    workspace,
    store: fakeStoreOf(workspace, treesRoot, beforeFingerprint),
    treesRoot,
    workersDir,
    guardScriptPath,
    registry: registryAccessOf(registryPath),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Prepares a group of the plan of the fixture, and returns it. */
async function prepareOf(fixture: RunFixture): Promise<PreparedGroup> {
  return prepareTheGroupTrees({
    store: fixture.store,
    workspace: fixture.workspace,
    members: membersOfTheGroup(planOfThree(), 1),
    slug: SLUG,
    baseFingerprint: "fp-base",
  });
}

/* ------------------------------------------------------------------ *
 * The places, and the members of a group.
 * ------------------------------------------------------------------ */

test("the places of the store keep the worker root outside the workspace and the control plane, named by the run alone", () => {
  const places = placesOfTheParallelStore({
    controlRoot: "/home/u/.specstride/workspaces/w1",
    runId: "run-9",
    home: "/home/u",
  });
  assert.equal(places.store, "/home/u/.specstride/workspaces/w1/tree-store");
  assert.equal(places.control, "/home/u/.specstride/workspaces/w1");
  assert.equal(places.workerRoot, "/home/u/.specstride/worker-roots/run-9");
  // F143-FR-005 — the worker root is outside the workspace and outside the
  // control plane, and names NO group and NO worker.
  assert.ok(!places.workerRoot.startsWith(places.control));
  assert.ok(!/group|w-\d/.test(places.workerRoot));
});

test("the members of a group come from the plan in the order of the tasks at launch", () => {
  const members = membersOfTheGroup(planOfThree(), 1);
  assert.deepEqual(
    members.map((member) => member.taskId),
    ["1-a", "1-b", "1-c"],
  );
  assert.deepEqual(members[0]?.scopePrefixes, ["src/a"]);
  assert.deepEqual(members[2]?.scopePrefixes, ["src/c"]);
});

test("an unknown phase, or a phase whose tasks are all serial, has no members", () => {
  const plan = planOfThree();
  assert.deepEqual(membersOfTheGroup(plan, 7), []);
  const serialOnly: ParallelPlan = {
    ...plan,
    phases: [{ ...(plan.phases[0] as (typeof plan.phases)[0]), groups: [] }],
  };
  assert.deepEqual(membersOfTheGroup(serialOnly, 1), []);
});

/* ------------------------------------------------------------------ *
 * The preparation of the trees.
 * ------------------------------------------------------------------ */

test("the preparation takes ONE base snapshot, gives every worker its tree, an empty outbox and its handoff, and a temporary directory beside the tree", async () => {
  const fixture = fixtureOf("prepare");
  try {
    const prepared = await prepareOf(fixture);
    // One base snapshot for the group, not one per worker.
    assert.match(prepared.baseTreeId, /^t-/);
    assert.equal(prepared.workerTrees.length, 3);
    assert.equal(prepared.workers.length, 3);
    assert.deepEqual(
      prepared.workers.map((worker) => worker.workerId),
      ["w-1", "w-2", "w-3"],
    );
    // The tree ids of the materializations name the base and the worker.
    assert.equal(prepared.workerTrees[0]?.treeId, `${prepared.baseTreeId}+w-1`);
    for (const worker of prepared.workers) {
      // The tree holds the project files, but NOT the main line's outbox.
      assert.ok(existsSync(join(worker.tree, "src", "a.ts")));
      assert.ok(
        !existsSync(
          join(worker.tree, ".specstride", "features", SLUG, "outbox", "stale.checkpoint.json"),
        ),
      );
      // The workspace part of the worker: an EMPTY outbox and the handoff.
      assert.ok(existsSync(worker.outboxPath));
      assert.deepEqual(readdirSync(worker.outboxPath), []);
      const handoff = JSON.parse(readFileSync(worker.handoffPath, "utf8")) as {
        schema: string;
        task: string;
        scope: readonly string[];
        baseFingerprint: string;
      };
      assert.equal(handoff.schema, "specstride.worker-handoff/1");
      assert.equal(handoff.task, worker.taskId);
      assert.deepEqual(handoff.scope, [`src/${worker.taskId.slice(2)}`]);
      assert.equal(handoff.baseFingerprint, "fp-base");
      // The temporary directory is BESIDE the tree, never inside it.
      assert.ok(existsSync(worker.temporaryDirectory));
      assert.ok(worker.temporaryDirectory.startsWith(`${worker.tree}.tmp`));
      assert.ok(!worker.temporaryDirectory.startsWith(worker.tree + "/"));
    }
    // The tokens are per worker, opaque, and derived from nothing.
    const tokens = prepared.workers.map((worker) => worker.workerToken);
    assert.equal(new Set(tokens).size, 3);
    for (const token of tokens) assert.match(token, /^[0-9a-f]{48}$/);
  } finally {
    fixture.cleanup();
  }
});

test("the temporary directories of a group are removed at its close", async () => {
  const fixture = fixtureOf("tmpdirs");
  try {
    const prepared = await prepareOf(fixture);
    for (const worker of prepared.workers) assert.ok(existsSync(`${worker.tree}.tmp`));
    removeTheTemporaryDirectories(prepared);
    for (const worker of prepared.workers) assert.ok(!existsSync(`${worker.tree}.tmp`));
    // The trees themselves are untouched.
    for (const worker of prepared.workers) assert.ok(existsSync(join(worker.tree, "src", "a.ts")));
  } finally {
    fixture.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * The checkpoint and the yield artifact.
 * ------------------------------------------------------------------ */

test("the checkpoint of a worker is read only from a regular file that names a task", async () => {
  const fixture = fixtureOf("checkpoint");
  try {
    const prepared = await prepareOf(fixture);
    const worker = prepared.workers[0] as { readonly outboxPath: string; readonly taskId: string };
    assert.equal(readTheWorkerCheckpoint(worker.outboxPath, worker.taskId), undefined);
    assert.equal(hashOfTheWorkerCheckpoint(worker.outboxPath, worker.taskId), undefined);
    assert.equal(workerCheckpointName(worker.taskId), `${worker.taskId}.checkpoint.json`);

    writeFileSync(
      join(worker.outboxPath, workerCheckpointName(worker.taskId)),
      JSON.stringify({ task: worker.taskId }),
    );
    assert.deepEqual(readTheWorkerCheckpoint(worker.outboxPath, worker.taskId), {
      task: worker.taskId,
    });
    assert.match(
      hashOfTheWorkerCheckpoint(worker.outboxPath, worker.taskId) ?? "",
      /^[0-9a-f]{64}$/,
    );

    // A checkpoint that names NO task is no checkpoint.
    writeFileSync(
      join(worker.outboxPath, workerCheckpointName(worker.taskId)),
      JSON.stringify({ other: 1 }),
    );
    assert.equal(readTheWorkerCheckpoint(worker.outboxPath, worker.taskId), undefined);
    // A broken file is no checkpoint.
    writeFileSync(join(worker.outboxPath, workerCheckpointName(worker.taskId)), "{ not json");
    assert.equal(readTheWorkerCheckpoint(worker.outboxPath, worker.taskId), undefined);
    // A LINK is no checkpoint.
    rmSync(join(worker.outboxPath, workerCheckpointName(worker.taskId)));
    symlinkSync("/etc/hostname", join(worker.outboxPath, workerCheckpointName(worker.taskId)));
    assert.equal(readTheWorkerCheckpoint(worker.outboxPath, worker.taskId), undefined);
  } finally {
    fixture.cleanup();
  }
});

test("the yield artifact of a worker is the file that carries the yield contract", async () => {
  const fixture = fixtureOf("yield");
  try {
    const prepared = await prepareOf(fixture);
    const worker = prepared.workers[0] as { readonly outboxPath: string };
    assert.equal(yieldArtifactIn(worker.outboxPath), undefined);
    // A JSON file WITHOUT the contract is no yield artifact.
    writeFileSync(join(worker.outboxPath, "notes.json"), JSON.stringify({ task: "1-a" }));
    assert.equal(yieldArtifactIn(worker.outboxPath), undefined);
    // The contract makes it one, whatever the name.
    writeFileSync(
      join(worker.outboxPath, "yield-1.json"),
      JSON.stringify({ contract: "specstride-pass-yield/v1" }),
    );
    assert.equal(yieldArtifactIn(worker.outboxPath), join(worker.outboxPath, "yield-1.json"));
  } finally {
    fixture.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * The run of the workers.
 * ------------------------------------------------------------------ */

test("the group probe asks the process group itself, not the leader alone", async () => {
  // A shell of its own group that holds a stray `sleep` of the SAME group.
  const leader = spawn("sh", ["-c", "sleep 0.6 & wait $!"], {
    detached: true,
    stdio: "ignore",
  });
  const group = leader.pid as number;
  await untilObservable(group);
  assert.equal(theGroupIsAlive(group), true);
  try {
    process.kill(group, "SIGKILL");
  } catch {
    // Already gone.
  }
  await until(() => processIsGone(group), 2_000, "the leader dies");
  // The LEADER is gone — and the group is NOT empty: the stray answers.
  assert.equal(theGroupIsAlive(group), true, "a dead leader must not empty the group");
  // When the stray is gone too, the group answers nothing.
  await until(() => !theGroupIsAlive(group), 3_000, "the stray of the group ends");
  assert.equal(theGroupIsAlive(group), false);
});

test("the run starts every worker supervised, carries the ends into the runner, and remembers no killed checkpoint where none died", async () => {
  const fixture = fixtureOf("run");
  const prepared = await prepareOf(fixture);
  const groups: number[] = [];
  const startedAt = new Map<string, number>();
  const pidByWorker = new Map<string, number>();
  const startedWorkerIds: string[] = [];
  // What supervision held for a worker WHILE it ran, seen at its end.
  const supervisedWhileRunning = new Map<
    string,
    { readonly pid: number; readonly startTime: number }
  >();
  try {
    const run = await runTheGroupWorkers({
      prepared,
      supervision: {
        enginePid: process.pid,
        engineStartedAtMs: Date.now(),
        runTokenHash: createHash("sha256").update("run-x").digest("hex"),
        workersDir: fixture.workersDir,
        guardScriptPath: fixture.guardScriptPath,
        ceilingSec: 3_600,
        registry: fixture.registry,
      },
      workersAtATime: 3,
      start: async (worker) => {
        const stub = stubWorker();
        groups.push(stub.group);
        startedWorkerIds.push(worker.workerId);
        const startTime = await untilObservable(stub.pid);
        startedAt.set(worker.workerId, startTime);
        pidByWorker.set(worker.workerId, stub.pid);
        const pass: StartedWorkerPass = {
          workerId: worker.workerId,
          pid: stub.pid,
          startTime,
          processGroup: stub.group,
          runTokenHash: createHash("sha256").update("run-x").digest("hex"),
          ended: new Promise<string>((done) => {
            setTimeout(() => {
              // While the pass ran, the runner held the worker supervised:
              // its identity record on disk and its entry in the registry
              // (F143-FR-010), under the pid and start time of this start.
              const entry = fixture.registry.get(`worker:${worker.workerId}`);
              assert.ok(
                entry !== undefined,
                `no registry entry for ${worker.workerId} while it ran`,
              );
              assert.equal(entry.identity.pid, stub.pid);
              assert.equal(entry.identity.startedAtMs, startTime);
              assert.equal(entry.registryClass, "pass");
              assert.equal(entry.survivesStop, false);
              assert.ok(existsSync(workerRecordPathOf(fixture.workersDir, worker.workerId)));
              supervisedWhileRunning.set(worker.workerId, { pid: stub.pid, startTime });
              void endGroups([stub.group]);
              done("ended");
            }, 300);
          }),
        };
        return pass;
      },
      record: async (kind, workerId) => {
        if (kind === "worker_started") startedWorkerIds.push(`recorded:${workerId}`);
      },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.deepEqual([...run.ends.keys()].sort(), ["w-1", "w-2", "w-3"]);
    for (const worker of prepared.workers) assert.equal(run.ends.get(worker.workerId), "ended");
    // The group closed CLEANLY: with every row closed, the runner has
    // retired the identity record and the registry entry of each worker,
    // and nothing of the group is left to find.
    assert.equal(run.group.rows().length, 0);
    for (const worker of prepared.workers) {
      assert.equal(fixture.registry.get(`worker:${worker.workerId}`), undefined);
      assert.ok(!existsSync(workerRecordPathOf(fixture.workersDir, worker.workerId)));
    }
    assert.equal(supervisedWhileRunning.size, 3);
    // Every worker_started record went through the ledger door.
    assert.deepEqual(
      startedWorkerIds.filter((name) => name.startsWith("recorded:")),
      ["recorded:w-1", "recorded:w-2", "recorded:w-3"],
    );
    assert.deepEqual(run.checkpointLeftByAKilledPass, []);
    run.group.retire();
  } finally {
    await endGroups(groups);
    fixture.cleanup();
  }
});

test("the checkpoint a killed pass left is remembered by the hash of its bytes", async () => {
  const fixture = fixtureOf("killed");
  const prepared = await prepareOf(fixture);
  const groups: number[] = [];
  try {
    const run = await runTheGroupWorkers({
      prepared,
      supervision: {
        enginePid: process.pid,
        engineStartedAtMs: Date.now(),
        runTokenHash: createHash("sha256").update("run-x").digest("hex"),
        workersDir: fixture.workersDir,
        guardScriptPath: fixture.guardScriptPath,
        ceilingSec: 3_600,
        registry: fixture.registry,
      },
      workersAtATime: 3,
      start: async (worker) => {
        const stub = stubWorker();
        groups.push(stub.group);
        const startTime = await untilObservable(stub.pid);
        const pass: StartedWorkerPass = {
          workerId: worker.workerId,
          pid: stub.pid,
          startTime,
          processGroup: stub.group,
          runTokenHash: createHash("sha256").update("run-x").digest("hex"),
          ended: new Promise<string>((done) => {
            setTimeout(() => {
              // The pass wrote its checkpoint just before the kill.
              if (worker.workerId === "w-1") {
                writeFileSync(
                  join(worker.outboxPath, workerCheckpointName(worker.taskId)),
                  JSON.stringify({ task: worker.taskId }),
                );
              }
              void endGroups([stub.group]);
              done(worker.workerId === "w-1" ? "killed" : "ended");
            }, 250);
          }),
        };
        return pass;
      },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.checkpointLeftByAKilledPass.length, 1);
    assert.equal(run.checkpointLeftByAKilledPass[0]?.workerId, "w-1");
    const worker = prepared.workers[0] as { readonly outboxPath: string; readonly taskId: string };
    assert.equal(
      run.checkpointLeftByAKilledPass[0]?.hash,
      hashOfTheWorkerCheckpoint(worker.outboxPath, worker.taskId),
    );
    run.group.retire();
  } finally {
    await endGroups(groups);
    fixture.cleanup();
  }
});

test("a refusal of the start door aborts the start of the group as a typed refusal", async () => {
  const fixture = fixtureOf("refused");
  const prepared = await prepareOf(fixture);
  try {
    const run = await runTheGroupWorkers({
      prepared,
      supervision: {
        enginePid: process.pid,
        engineStartedAtMs: Date.now(),
        runTokenHash: createHash("sha256").update("run-x").digest("hex"),
        workersDir: fixture.workersDir,
        guardScriptPath: fixture.guardScriptPath,
        ceilingSec: 3_600,
        registry: fixture.registry,
      },
      workersAtATime: 3,
      start: async (worker) => {
        if (worker.workerId === "w-1") {
          throw new WorkerStartRefused("w-1", "the harness refused the session");
        }
        return {
          workerId: worker.workerId,
          pid: 1,
          runTokenHash: "x",
          ended: new Promise<string>(() => {}),
        };
      },
    });
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.workerId, "w-1");
    assert.match(run.message, /w-1/);
    assert.match(run.message, /the harness refused the session/);
    assert.ok(run.message.startsWith("the worker `w-1` could not start"));
  } finally {
    fixture.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * The barrier.
 * ------------------------------------------------------------------ */

/** The ledger door of the tests: the records in the order they arrive. */
function ledgerOf(): {
  readonly kinds: () => readonly string[];
  readonly dataOf: (kind: string) => readonly Readonly<Record<string, unknown>>[];
  readonly record: (kind: string, data: Readonly<Record<string, unknown>>) => Promise<void>;
} {
  const records: { kind: string; data: Readonly<Record<string, unknown>> }[] = [];
  return {
    kinds: () => records.map((row) => row.kind),
    dataOf: (kind) => records.filter((row) => row.kind === kind).map((row) => row.data),
    record: async (kind, data) => {
      records.push({ kind, data });
    },
  };
}

test("the barrier takes the snapshots, writes the one group_barrier record, and integrates the workers that pass", async () => {
  const fixture = fixtureOf("barrier");
  const prepared = await prepareOf(fixture);
  const ledger = ledgerOf();
  const events: string[] = [];
  const gone = await aGonePid();
  try {
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    const result = await closeTheGroup({
      store: fixture.store,
      workspace: fixture.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => gone,
      record: ledger.record,
      emitEvent: async (event) => {
        events.push(event.kind);
      },
    });
    assert.equal(result.integrationMayStart, true);
    // Every worker of the group is gone and no group answers: `enforce`.
    assert.equal(result.protection, "enforce");
    assert.deepEqual(result.candidates, ["w-1", "w-2", "w-3"]);
    for (const row of result.perWorker) {
      assert.equal(row.outcome.outcome, "integrated");
      assert.equal(row.treeChangedAfterTheFinalSnapshot, false);
    }
    // The records of the barrier, in the order the state sequence asks.
    assert.deepEqual(ledger.kinds(), [
      "worker_ended",
      "worker_ended",
      "worker_ended",
      "group_barrier",
    ]);
    const barrierRecord = ledger.dataOf("group_barrier")[0] as {
      fingerprint: string;
      perWorkerFingerprint: Readonly<Record<string, string>>;
      protection: string;
    };
    assert.ok(typeof barrierRecord.fingerprint === "string");
    assert.equal(barrierRecord.protection, "enforce");
    assert.deepEqual(Object.keys(barrierRecord.perWorkerFingerprint).sort(), ["w-1", "w-2", "w-3"]);
    const endedRecord = ledger.dataOf("worker_ended")[0] as {
      workerId: string;
      endCause: string;
      treeId: string;
    };
    assert.equal(endedRecord.workerId, "w-1");
    assert.equal(endedRecord.endCause, "ended");
    assert.match(endedRecord.treeId, /^t-/);
    assert.deepEqual(events, []);
  } finally {
    fixture.cleanup();
  }
});

test("a yield artifact refuses the worker, and the refusal event is shown to the critic", async () => {
  const fixture = fixtureOf("barrier-yield");
  const prepared = await prepareOf(fixture);
  const ledger = ledgerOf();
  const events: { kind: string; workerId: string; shownToTheCritic: boolean }[] = [];
  try {
    writeFileSync(
      join((prepared.workers[0] as { outboxPath: string }).outboxPath, "yield.json"),
      JSON.stringify({ contract: "specstride-pass-yield/v1" }),
    );
    for (const worker of prepared.workers.slice(1)) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    const result = await closeTheGroup({
      store: fixture.store,
      workspace: fixture.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledger.record,
      emitEvent: async (event) => {
        events.push(event);
      },
    });
    const first = result.perWorker[0] as { outcome: { outcome: string; reason?: string } };
    assert.equal(first.outcome.outcome, "refused");
    assert.equal(first.outcome.reason, "a yield artifact in the outbox of a worker");
    assert.equal(first.outcome.chargesItsTask, false);
    assert.equal(first.outcome.taskReturnsToTheMainLine, true);
    assert.deepEqual(result.candidates, ["w-2", "w-3"]);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["worker-yield-refused"],
    );
    assert.equal(events[0]?.workerId, "w-1");
    assert.equal(events[0]?.shownToTheCritic, true);
  } finally {
    fixture.cleanup();
  }
});

test("the three shapes of a bad checkpoint each refuse the worker", async () => {
  // 1 The checkpoint is absent.
  const absent = fixtureOf("bad-absent");
  try {
    const prepared = await prepareOf(absent);
    const result = await closeTheGroup({
      store: absent.store,
      workspace: absent.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledgerOf().record,
      emitEvent: async () => {},
    });
    assert.equal(result.perWorker[0]?.outcome.outcome, "refused");
    assert.equal(result.perWorker[0]?.outcome.reason, "the checkpoint is absent");
    assert.equal(result.perWorker[1]?.outcome.outcome, "refused");
  } finally {
    absent.cleanup();
  }

  // 2 The checkpoint names another task.
  const other = fixtureOf("bad-other");
  try {
    const prepared = await prepareOf(other);
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.workerId === "w-2" ? "1-zzz" : worker.taskId }),
      );
    }
    const result = await closeTheGroup({
      store: other.store,
      workspace: other.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledgerOf().record,
      emitEvent: async () => {},
    });
    assert.equal(result.perWorker[1]?.outcome.outcome, "refused");
    assert.equal(result.perWorker[1]?.outcome.reason, "the checkpoint names another task");
    assert.equal(result.perWorker[0]?.outcome.outcome, "integrated");
  } finally {
    other.cleanup();
  }

  // 3 The checkpoint was written by a killed pass — the hash matches.
  const killed = fixtureOf("bad-killed");
  try {
    const prepared = await prepareOf(killed);
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    const w1 = prepared.workers[0] as { outboxPath: string; taskId: string };
    const result = await closeTheGroup({
      store: killed.store,
      workspace: killed.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledgerOf().record,
      emitEvent: async () => {},
      checkpointLeftByAKilledPass: [
        { workerId: "w-1", hash: hashOfTheWorkerCheckpoint(w1.outboxPath, w1.taskId) ?? "" },
      ],
    });
    assert.equal(result.perWorker[0]?.outcome.outcome, "refused");
    assert.equal(
      result.perWorker[0]?.outcome.reason,
      "the checkpoint was written by a killed pass",
    );
    assert.equal(result.perWorker[1]?.outcome.outcome, "integrated");
  } finally {
    killed.cleanup();
  }
});

test("a checkpoint of a killed pass that a restart OVERWROTE is no longer refused", async () => {
  const fixture = fixtureOf("overwrote");
  const prepared = await prepareOf(fixture);
  const ledger = ledgerOf();
  try {
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    // The killed pass had written DIFFERENT bytes; the restart overwrote them.
    const result = await closeTheGroup({
      store: fixture.store,
      workspace: fixture.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledger.record,
      emitEvent: async () => {},
      checkpointLeftByAKilledPass: [
        { workerId: "w-1", hash: createHash("sha256").update("older-bytes").digest("hex") },
      ],
    });
    assert.equal(result.perWorker[0]?.outcome.outcome, "integrated");
    assert.equal(result.perWorker[1]?.outcome.outcome, "integrated");
    assert.equal(ledger.dataOf("worker_ended").length, 3);
    assert.equal(ledger.dataOf("group_barrier").length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("a worker whose tree moved after its final snapshot is refused", async () => {
  const fixture = fixtureOf(
    "moved",
    // The hook of the store: before the SECOND snapshot of a worker tree,
    // the tree moves on disk.
    (treePath) => writeFileSync(join(treePath, "stray.txt"), "written behind the snapshot\n"),
  );
  const prepared = await prepareOf(fixture);
  const ledger = ledgerOf();
  try {
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    const result = await closeTheGroup({
      store: fixture.store,
      workspace: fixture.workspace,
      prepared,
      ends: new Map(prepared.workers.map((worker) => [worker.workerId, "ended" as const])),
      pidOf: () => undefined,
      record: ledger.record,
      emitEvent: async (event) => {
        if (event.kind === "tree-changed-outside-pass") void event;
      },
    });
    for (const row of result.perWorker) {
      assert.equal(row.treeChangedAfterTheFinalSnapshot, true);
      assert.equal(row.outcome.outcome, "refused");
      assert.equal(row.outcome.reason, "the tree changed after its final snapshot");
    }
    assert.deepEqual(result.candidates, []);
    // The barrier says the tree moved.
    assert.ok(ledger.dataOf("group_barrier").length === 1);
  } finally {
    fixture.cleanup();
  }
});

test("a live process group is never claimed empty, a dead one is", async () => {
  const fixture = fixtureOf("alive");
  const prepared = await prepareOf(fixture);
  const ledger = ledgerOf();
  const groups: number[] = [];
  try {
    for (const worker of prepared.workers) {
      writeFileSync(
        join(worker.outboxPath, workerCheckpointName(worker.taskId)),
        JSON.stringify({ task: worker.taskId }),
      );
    }
    // w-1 still holds a LIVE process group (a real `sleep` of its own
    // group), at the barrier, where every row of the group is closed.
    const stub = stubWorker();
    groups.push(stub.group);
    const ends = new Map<string, "ended">(
      prepared.workers.map((worker) => [worker.workerId, "ended" as const]),
    );
    const result = await closeTheGroup({
      store: fixture.store,
      workspace: fixture.workspace,
      prepared,
      ends,
      pidOf: (workerId) => (workerId === "w-1" ? stub.pid : undefined),
      record: ledger.record,
      emitEvent: async () => {},
    });
    const first = result.perWorker[0] as {
      outcome: { outcome: string };
      processesEnded: readonly number[];
    };
    // The stub of w-1 still answered: the barrier is the last resort and
    // it ENDED it, while its group was still emptying.
    assert.deepEqual(first.processesEnded, [stub.pid]);
    // One worker not guaranteed empty is enough for `detect` (F143-FR-017):
    // w-2 and w-3 hold no pid the runtime can identify, so nothing is
    // guaranteed for them.
    assert.equal(result.protection, "detect");
    await endGroups(groups);
  } finally {
    await endGroups(groups);
    fixture.cleanup();
  }
});
