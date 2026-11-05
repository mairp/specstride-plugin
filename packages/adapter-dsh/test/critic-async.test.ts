/**
 * The ASYNC critic call (step 1, part A): the call runs in its own process
 * group without blocking the caller, hands its PID over as soon as the child
 * exists, is SIGTERMed at the time limit and SIGKILLed — as a GROUP — after
 * the grace period, with the kill it made reported, and the cost is read from
 * a `total_cost_usd` figure of the JSON stream when `dsh` emits one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDshCriticAsync, type CriticAsyncInput } from "../src/critic/index.ts";

const FAKE_DSH = fileURLToPath(
  new URL("../../testkit/conformance/EP-02/fake-dsh.mjs", import.meta.url),
);

/** Stages a stub named `dsh` on its own search path, under the `parity` profile. */
function stage(stubBody?: string) {
  const root = mkdtempSync(join(tmpdir(), "dsh-critic-async."));
  const binDir = join(root, "bin");
  const workdir = join(root, "work");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(workdir);
  const body = stubBody ?? `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DSH}" "$@"\n`;
  writeFileSync(join(binDir, "dsh"), body);
  chmodSync(join(binDir, "dsh"), 0o755);
  // `parity`: the proof switch is `none`, the working directory is the one
  // handed over, and the call is not refused for memory or capability facts.
  const env = { PATH: binDir, HOME: root, DSH_PROFILE: "parity" };
  return {
    root,
    binDir,
    workdir,
    env,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function call(fixture: ReturnType<typeof stage>, extra: Partial<CriticAsyncInput> = {}) {
  return runDshCriticAsync({
    prompt: "judge this",
    cwd: fixture.workdir,
    path: fixture.binDir,
    env: { ...fixture.env },
    ...extra,
  });
}

test("the async critic resolves with the PID of the child and its reply", async () => {
  const fixture = stage();
  try {
    const pids: number[] = [];
    const run = await call(fixture, {
      script: JSON.stringify([{ text: "verdict: pass\n" }]),
      onStart: (pid) => pids.push(pid),
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(run.ok && run.pid > 0, "the run carries the pid of the child");
    assert.ok(run.ok && pids.length === 1 && pids[0] === run.pid, "onStart saw the same pid");
    assert.ok(run.ok && run.reply.includes("verdict: pass"), "the reply came back");
    assert.ok(run.ok && !run.timedOut && run.killedWith === null, "no kill was made");
    assert.ok(run.ok && run.permissionMode === "read-only", "the mode is read-only as before");
  } finally {
    fixture.dispose();
  }
});

test("a hung critic call is SIGTERMed at the time limit", async () => {
  const fixture = stage();
  try {
    const run = await call(fixture, {
      script: JSON.stringify([{ hang: 0 }]),
      timeoutMs: 250,
      killGraceMs: 10_000,
    });
    assert.ok(!run.ok, JSON.stringify(run));
    assert.ok(!run.ok && run.timedOut, "the limit ended the call");
    assert.ok(!run.ok && run.killedWith === "SIGTERM", "the first signal was SIGTERM");
  } finally {
    fixture.dispose();
  }
});

test("a call that ignores SIGTERM is SIGKILLed, as a group, after the grace period", async () => {
  // The stub catches SIGTERM with a handler, so only SIGKILL can end it; it
  // never answers `--version`, so the probe of the seam is overridden.
  const fixture = stage(
    `#!/bin/sh\nexec "${process.execPath}" -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 500)"\n`,
  );
  try {
    const run = await call(fixture, {
      timeoutMs: 200,
      killGraceMs: 200,
      probeVersion: () => "0.1.0-rc.8",
    });
    assert.ok(!run.ok, JSON.stringify(run));
    assert.ok(
      !run.ok && run.timedOut && run.killedWith === "SIGKILL",
      "the grace ended in SIGKILL",
    );
  } finally {
    fixture.dispose();
  }
});

test("the cost is read from a total_cost_usd figure of the JSON stream", async () => {
  const fixture = stage();
  try {
    const run = await call(fixture, {
      script: JSON.stringify([{ stdout: `{"type":"result","total_cost_usd":0.07}\n` }]),
    });
    assert.ok(run.ok, JSON.stringify(run));
    assert.ok(
      run.ok && run.costUsd === 0.07,
      `the cost was captured, got ${String(run.ok ? run.costUsd : run)}`,
    );
  } finally {
    fixture.dispose();
  }
});
