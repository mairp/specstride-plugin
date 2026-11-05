/**
 * CT-130-47 — `startPass` of the dsh adapter: one worker pass of a group
 * (`specstride.harness/1`, annex C §C.1; F142-FR-020, F143-FR-010).
 *
 * Pinned with the fake binary of the conformance suite, as every other pin
 * of this adapter: the pass is prepared exactly as the pass loop prepares
 * its own (argv, environment, permission mode, overlay), started through the
 * process primitive of the kernel in a process group of its own, with its
 * tree as the write root, a fresh session under the minted worker id, the
 * worker environment allow-listed on the process, the two outputs on files
 * the caller reads, and the time limit enforced on the GROUP. A session
 * directive that continues a session is refused (dsh declares no
 * continuation) and a write root that is not the working directory is
 * refused (the sandbox of this harness roots at the process's tree).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dshStartPass,
  sessionDirectiveRefusal,
  writeRootRefusal,
  promptOfAReference,
  type DshStartPassInput,
} from "../src/start-pass/index.ts";

const FAKE_DSH = fileURLToPath(
  new URL("../../testkit/conformance/EP-02/fake-dsh.mjs", import.meta.url),
);

/** Stages a stub named `dsh` on its own search path, with a worker tree. */
function stage() {
  const root = mkdtempSync(join(tmpdir(), "dsh-start-pass."));
  const binDir = join(root, "bin");
  const tree = join(root, "tree-1");
  const out = join(root, "out");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(tree);
  mkdirSync(out);
  writeFileSync(join(binDir, "dsh"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DSH}" "$@"\n`);
  chmodSync(join(binDir, "dsh"), 0o755);
  const env = { PATH: binDir, HOME: root };
  return {
    root,
    binDir,
    tree,
    out,
    env,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** One startPass input over the staged fixture. */
function inputOf(fixture: ReturnType<typeof stage>, over: Partial<DshStartPassInput> = {}) {
  const tree = over.workingDirectory ?? fixture.tree;
  return {
    promptReference: "do the task of worker 1",
    workingDirectory: tree,
    session: { kind: "fresh" as const, sessionId: "worker-1" },
    model: "",
    modelTierOrEffort: "base",
    containment: "C1" as const,
    writeRoot: tree,
    environmentAllowList: ["SPECSTRIDE_WORKER_TOKEN"],
    environment: {
      SPECSTRIDE_WORKER_TOKEN: "opaque-token-of-worker-1",
      SPECSTRIDE_A_NAME_THE_CALLER_DID_NOT_ALLOW: "must not travel",
    },
    timeLimitMs: 0,
    transport: "subprocess" as const,
    path: fixture.binDir,
    env: fixture.env,
    outputDirectory: fixture.out,
    ...over,
  };
}

test("CT-130-47: startPass prepares the pass as the pass loop does", async () => {
  const fixture = stage();
  try {
    const started = await dshStartPass(
      inputOf(fixture, { script: JSON.stringify([{ text: "the reply of the worker\n" }]) }),
    );
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    const handle = started.handle;
    // argv: {bin} --profile headless {prompt} — the argument table of the proposer.
    assert.deepEqual(handle.argv.slice(1, 3), ["--profile", "headless"]);
    assert.equal(handle.argv[3], "do the task of worker 1");
    // The permission mode of a proposer pass, stated in the record.
    assert.equal(handle.permissionMode, "workspace-write");
    // No model reference was named: no overlay, the profile's own settings select.
    assert.equal(handle.overlay, null);
    assert.equal(handle.model, null);
    const end = await handle.ended;
    assert.deepEqual({ exitCode: end.exitCode, signal: end.signal }, { exitCode: 0, signal: null });
    assert.equal(await handle.reply(), "the reply of the worker\n");
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: the worker id is the session id, the write root is the tree", async () => {
  const fixture = stage();
  try {
    const started = await dshStartPass(
      inputOf(fixture, { script: JSON.stringify([{ text: "ok" }]) }),
    );
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    const handle = started.handle;
    assert.equal(handle.sessionId, "worker-1");
    assert.equal(handle.writeRoot, fixture.tree);
    assert.ok(handle.startTime.endsWith("Z"), `an ISO start time, got ${handle.startTime}`);
    // The outputs live where the caller named them, one file each.
    assert.equal(handle.stdoutFile, join(fixture.out, "stdout.log"));
    assert.equal(handle.stderrFile, join(fixture.out, "stderr.log"));
    await handle.ended;
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: the process runs in a group of its own", async () => {
  const fixture = stage();
  try {
    const started = await dshStartPass(
      inputOf(fixture, { script: JSON.stringify([{ hang: 4000 }]) }),
    );
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    const handle = started.handle;
    try {
      // The group of a detached process is its own pid, and never the group
      // of the process that started it (F100-FR-234).
      assert.equal(handle.processGroup, handle.pid);
      assert.notEqual(handle.processGroup, process.pid);
      // The process is alive under its own group: signal 0 by pid answers.
      process.kill(handle.pid, 0);
    } finally {
      handle.signalGroup("kill");
    }
    const end = await handle.ended;
    assert.equal(end.signal, "SIGKILL");
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: the allow-listed worker environment travels, and no other name", async () => {
  const fixture = stage();
  const recordDir = join(fixture.root, "record");
  mkdirSync(recordDir, { recursive: true });
  try {
    const started = await dshStartPass(
      inputOf(fixture, {
        env: { ...fixture.env, FAKE_DSH_RECORD_DIR: recordDir },
        script: JSON.stringify([{ text: "ok" }]),
      }),
    );
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    await started.handle.ended;
    const recorded = JSON.parse(
      readFileSync(join(recordDir, "record.jsonl"), "utf8").split("\n")[0] as string,
    ) as { env: Record<string, string>; cwd: string };
    assert.equal(recorded.env.SPECSTRIDE_WORKER_TOKEN, "opaque-token-of-worker-1");
    assert.equal(
      "SPECSTRIDE_A_NAME_THE_CALLER_DID_NOT_ALLOW" in recorded.env,
      false,
      "a name the caller did not allow-list never travels",
    );
    assert.equal(recorded.env.DSH_PERMISSION_MODE, "workspace-write");
    assert.equal(recorded.cwd, fixture.tree);
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: a session that continues is refused; so is a foreign write root", async () => {
  const fixture = stage();
  try {
    const continued = await dshStartPass(
      inputOf(fixture, { session: { kind: "continue", sessionId: "worker-1" } }),
    );
    assert.ok(!continued.ok, "a continuing session is refused");
    assert.ok(
      continued.ok === false &&
        continued.message === sessionDirectiveRefusal({ kind: "continue", sessionId: "worker-1" }),
    );

    const foreignRoot = join(fixture.root, "another-tree");
    const foreign = await dshStartPass(inputOf(fixture, { writeRoot: foreignRoot }));
    assert.ok(!foreign.ok, "a write root away from the tree is refused");
    assert.ok(
      foreign.ok === false && foreign.message === writeRootRefusal(foreignRoot, fixture.tree),
    );
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: the time limit ends a hung pass on its group", async () => {
  const fixture = stage();
  try {
    const started = await dshStartPass(
      inputOf(fixture, {
        timeLimitMs: 300,
        killGraceMs: 300,
        script: JSON.stringify([{ hang: 0 }]),
      }),
    );
    assert.ok(started.ok, JSON.stringify(started));
    if (!started.ok) return;
    const end = await started.handle.ended;
    assert.equal(end.signal, "SIGTERM");
  } finally {
    fixture.dispose();
  }
});

test("CT-130-47: a prompt reference that names a file is that file's content", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-start-pass-prompt."));
  try {
    const file = join(root, "prompt.md");
    writeFileSync(file, "the prompt of the file\n", "utf8");
    assert.equal(promptOfAReference(file), "the prompt of the file\n");
    assert.equal(promptOfAReference("plain text reference"), "plain text reference");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
