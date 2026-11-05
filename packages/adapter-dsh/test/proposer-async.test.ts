/**
 * The ASYNC proposer pass (step 1, part A): the pass runs without blocking
 * the caller, hands its PID over as soon as the child exists, is SIGTERMed at
 * the time limit and SIGKILLed after the grace period — with the kill it made
 * reported — and the cost is read from a `total_cost_usd` figure of the JSON
 * stream when `dsh` emits one. The synchronous twin keeps its behaviour: the
 * argv, the environment and the overlay are the same on both paths.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDshProposerAsync, runDshProposer } from "../src/proposer/index.ts";

const FAKE_DSH = fileURLToPath(
  new URL("../../testkit/conformance/EP-02/fake-dsh.mjs", import.meta.url),
);

/** Stages a stub named `dsh` on its own search path, with a workdir. */
function stage(stubBody?: string) {
  const root = mkdtempSync(join(tmpdir(), "dsh-proposer-async."));
  const binDir = join(root, "bin");
  const workdir = join(root, "work");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(workdir);
  const body = stubBody ?? `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DSH}" "$@"\n`;
  writeFileSync(join(binDir, "dsh"), body);
  chmodSync(join(binDir, "dsh"), 0o755);
  const env = { PATH: binDir, HOME: root };
  return {
    root,
    binDir,
    workdir,
    env,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Whether the process of a pid still answers signal 0. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("the async proposer resolves with the PID of the child", async () => {
  const fixture = stage();
  try {
    const pids: number[] = [];
    const run = await runDshProposerAsync({
      prompt: "async pid",
      cwd: fixture.workdir,
      path: fixture.binDir,
      env: { ...fixture.env },
      script: JSON.stringify([{ text: "the reply\n" }]),
      onStart: (pid) => pids.push(pid),
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(run.ok && run.pid > 0, "the run carries the pid of the child");
    assert.ok(run.ok && pids.length === 1 && pids[0] === run.pid, "onStart saw the same pid");
    assert.ok(run.ok && run.stdout.includes("the reply"), "the reply came back");
    assert.ok(run.ok && !run.timedOut && run.killedWith === null, "no kill was made");
    assert.ok(run.ok && run.permissionMode !== "", "the permission mode is stated as before");
  } finally {
    fixture.dispose();
  }
});

test("a hung pass is SIGTERMed at the time limit and ends", async () => {
  const fixture = stage();
  try {
    const run = await runDshProposerAsync({
      prompt: "hangs",
      cwd: fixture.workdir,
      path: fixture.binDir,
      env: { ...fixture.env },
      script: JSON.stringify([{ hang: 0 }]),
      timeoutMs: 250,
      killGraceMs: 10_000,
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(run.ok && run.timedOut, "the limit ended the child");
    assert.ok(run.ok && run.killedWith === "SIGTERM", "the first signal was SIGTERM");
    await new Promise((done) => setTimeout(done, 100));
    assert.ok(run.ok && !alive(run.pid), "nothing of the pass is left running");
  } finally {
    fixture.dispose();
  }
});

test("a pass that ignores SIGTERM is SIGKILLed after the grace period", async () => {
  // The stub catches SIGTERM with a handler, so only SIGKILL can end it.
  const fixture = stage(
    `#!/bin/sh\nexec "${process.execPath}" -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 500)"\n`,
  );
  try {
    const run = await runDshProposerAsync({
      prompt: "ignores the polite signal",
      cwd: fixture.workdir,
      path: fixture.binDir,
      env: { ...fixture.env },
      timeoutMs: 200,
      killGraceMs: 200,
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(run.ok && run.timedOut, "the limit ended the child");
    assert.ok(run.ok && run.killedWith === "SIGKILL", "the grace period ended in SIGKILL");
  } finally {
    fixture.dispose();
  }
});

test("the cost is read from a total_cost_usd figure of the JSON stream", async () => {
  const fixture = stage();
  try {
    const run = await runDshProposerAsync({
      prompt: "reports a cost",
      cwd: fixture.workdir,
      path: fixture.binDir,
      env: { ...fixture.env },
      script: JSON.stringify([{ stdout: `{"type":"result","total_cost_usd":0.42}\n` }]),
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(
      run.ok && run.costUsd === 0.42,
      `the cost was captured, got ${String(run.ok ? run.costUsd : run)}`,
    );
  } finally {
    fixture.dispose();
  }
});

test("the synchronous twin keeps running beside the async one", () => {
  const fixture = stage();
  try {
    // The synchronous twin keeps its behaviour beside the async one.
    const run = runDshProposer({
      prompt: "sync still works",
      cwd: fixture.workdir,
      path: fixture.binDir,
      env: { ...fixture.env },
      script: JSON.stringify([{ text: "sync reply\n" }]),
    });
    assert.ok(run.ok && run.stdout.includes("sync reply"), JSON.stringify(run));
  } finally {
    fixture.dispose();
  }
});
