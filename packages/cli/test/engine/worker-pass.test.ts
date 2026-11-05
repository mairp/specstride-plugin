/**
 * The worker-pass door of the engine's dsh path: the `startPass` of
 * `specstride.harness/1` as the composition root hands it to the group
 * executor — one worker, its tree as the working directory and the write
 * root, a fresh session under the worker id, the three-variable worker
 * environment of F143-FR-009 (and no index and no count), the two outputs
 * under the run's control root. The single-pass door of the main line
 * (`services.runPass`) is untouched by this module (F142-SC-001).
 *
 * Pinned with the fake dsh binary of the conformance suite, as the adapter's
 * own pins are: the stub stands on its own search path, the record of the
 * call is read back, and the environment the process saw is asserted name by
 * name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startDshWorkerPass,
  workerEnvironmentOf,
  workerEnvironmentAllowList,
  RUN_TOKEN_VARIABLE,
  TEMPORARY_DIRECTORY_VARIABLE,
  WORKER_TOKEN_VARIABLE,
} from "../../src/engine/worker-pass.ts";

const FAKE_DSH = fileURLToPath(
  new URL("../../../testkit/conformance/EP-02/fake-dsh.mjs", import.meta.url),
);

/** Stages a stub named `dsh` on its own search path, with a worker tree. */
function stage() {
  const root = mkdtempSync(join(tmpdir(), "cli-worker-pass."));
  const binDir = join(root, "bin");
  const tree = join(root, "worker-trees", "worker-1");
  const workerRoot = join(root, "worker-trees");
  const outputRoot = join(root, "control", "parallel", "worker-1");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(binDir, "dsh"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DSH}" "$@"\n`);
  chmodSync(join(binDir, "dsh"), 0o755);
  return {
    root,
    binDir,
    tree,
    workerRoot,
    outputRoot,
    env: { PATH: binDir, HOME: root },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** One worker-pass input over the staged fixture. */
function inputOf(fixture: ReturnType<typeof stage>) {
  return {
    workerId: "w1",
    tree: fixture.tree,
    workerToken: "opaque-token-of-w1",
    runToken: "run-token-of-the-group",
    temporaryDirectory: join(fixture.workerRoot, "tmp-w1"),
    model: "zai/glm-5.3-flash",
    modelTierOrEffort: "base",
    containment: "C1" as const,
    promptReference: "the prompt block of worker w1",
    timeLimitMs: 0,
    outputRoot: fixture.outputRoot,
    env: fixture.env,
  };
}

test("the worker environment holds three variables, and no index and no count", () => {
  const environment = workerEnvironmentOf({
    workerToken: "t",
    runToken: "r",
    temporaryDirectory: "/tmp/never-indexed",
  });
  assert.deepEqual(Object.keys(environment).sort(), [
    RUN_TOKEN_VARIABLE,
    TEMPORARY_DIRECTORY_VARIABLE,
    WORKER_TOKEN_VARIABLE,
  ]);
  assert.equal(environment[WORKER_TOKEN_VARIABLE], "t");
  assert.equal(environment[RUN_TOKEN_VARIABLE], "r");
  assert.equal(environment[TEMPORARY_DIRECTORY_VARIABLE], "/tmp/never-indexed");
  assert.deepEqual(workerEnvironmentAllowList(), [
    WORKER_TOKEN_VARIABLE,
    RUN_TOKEN_VARIABLE,
    TEMPORARY_DIRECTORY_VARIABLE,
  ]);
});

test("a worker pass starts in its tree, under its worker id, with its environment", async () => {
  const fixture = stage();
  const recordDir = join(fixture.root, "record");
  mkdirSync(recordDir, { recursive: true });
  try {
    const started = await startDshWorkerPass({
      ...inputOf(fixture),
      env: { ...fixture.env, FAKE_DSH_RECORD_DIR: recordDir },
    });
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    const handle = started.handle;
    assert.equal(handle.sessionId, "w1");
    assert.equal(handle.writeRoot, fixture.tree);
    assert.equal(handle.processGroup, handle.pid);
    assert.equal(handle.model, "zai/glm-5.3-flash");
    const end = await handle.ended;
    assert.equal(end.exitCode, 0);
    const recorded = JSON.parse(
      readFileSync(join(recordDir, "record.jsonl"), "utf8").split("\n")[0] as string,
    ) as { argv: string[]; cwd: string; env: Record<string, string> };
    assert.equal(recorded.cwd, fixture.tree);
    // The fake records the argument list after its own entry point: the
    // profile flag, the profile, then the prompt as ONE positional argument.
    assert.deepEqual(recorded.argv.slice(0, 2), ["--profile", "headless"]);
    assert.equal(recorded.argv[2], "the prompt block of worker w1");
    assert.equal(recorded.env[WORKER_TOKEN_VARIABLE], "opaque-token-of-w1");
    assert.equal(recorded.env[RUN_TOKEN_VARIABLE], "run-token-of-the-group");
    assert.equal(recorded.env[TEMPORARY_DIRECTORY_VARIABLE], join(fixture.workerRoot, "tmp-w1"));
  } finally {
    fixture.dispose();
  }
});
