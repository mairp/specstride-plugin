/**
 * The pass guard (step 1's still-open clause: "SIGKILL of the engine leaves
 * no survivor", reviewer's note 1 of results/step-1.done). A pass must end by
 * itself soon after its engine dies — no resume, no leftover cleanup, nothing
 * but the guard the engine planted at the spawn.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTimeOf } from "@specstride/kernel";
import { startPassGuard, writePassGuardScript } from "../../src/engine/pass-guard.ts";

/** A hung process exec'd as the harness named, alive until a signal ends it. */
function hungPass(as: string): Promise<number> {
  return new Promise((done) => {
    const bin = join(mkdtempSync(join(tmpdir(), "guard-pass-")), as);
    symlinkSync(process.execPath, bin);
    chmodSync(bin, 0o755);
    const child = spawn(bin, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    child.on("spawn", () => done(child.pid!));
  });
}

/** A stand-in engine: lives until the test kills it. */
function stubEngine(): Promise<number> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    child.on("spawn", () => done(child.pid!));
  });
}

/** Whether a pid answers at all — a corpse the reaper has not collected does not count. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close >= 0 && stat.slice(close + 2).split(" ")[0] === "Z") return false;
  } catch {
    // No /proc: the kill probe above is the whole answer.
  }
  return true;
}

/** Waits until the pid is gone; a half-second over the deadline fails. */
async function gone(pid: number, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    if (!alive(pid)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return !alive(pid);
}

/** The start time of a live pid, as the engine records it at the spawn. */
function recordedStart(pid: number): number {
  const startedAtMs = startTimeOf(pid);
  assert.notEqual(startedAtMs, null, "the host answered the start time");
  return startedAtMs as number;
}

/** Writes the guard script where a test run of it can spawn it. */
function guardScriptOf(dir: string): string {
  const path = join(dir, "pass-guard.mjs");
  writePassGuardScript(path);
  return path;
}

test("the guard ends a hung pass soon after its engine dies, and only that pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  const script = guardScriptOf(dir);
  const passPid = await hungPass("dsh");
  const enginePid = await stubEngine();
  const guard = startPassGuard({
    scriptPath: script,
    enginePid,
    engineStartedAtMs: recordedStart(enginePid),
    passPid,
    passStartedAtMs: recordedStart(passPid),
    pollMs: 100,
    graceMs: 500,
  });
  assert.notEqual(guard?.pid, undefined, "the guard is running");
  try {
    await new Promise((done) => setTimeout(done, 300));
    assert.ok(alive(passPid), "the pass lives while the engine lives");
    // SIGKILL of the engine only; no resume is ever started.
    process.kill(enginePid, "SIGKILL");
    assert.ok(await gone(passPid, 5_000), "the pass ended by itself, no resume started");
    assert.ok(await gone(guard!.pid!, 3_000), "the guard retired with the pass");
  } finally {
    try {
      process.kill(passPid, "SIGKILL");
    } catch {
      // It ended by the guard.
    }
    try {
      process.kill(enginePid, "SIGKILL");
    } catch {
      // It ended by the test.
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test("the guard never touches a pass while its engine lives, and retires when the pass ends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-live-"));
  const script = guardScriptOf(dir);
  const passPid = await hungPass("claude");
  const enginePid = await stubEngine();
  const guard = startPassGuard({
    scriptPath: script,
    enginePid,
    engineStartedAtMs: recordedStart(enginePid),
    passPid,
    passStartedAtMs: recordedStart(passPid),
    pollMs: 100,
    graceMs: 500,
  });
  try {
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(alive(passPid), "the pass lives: the engine lives");
    // The pass ends by itself (as every ended pass does); the guard retires.
    process.kill(passPid, "SIGTERM");
    assert.ok(await gone(passPid, 3_000), "the pass ended");
    assert.ok(await gone(guard!.pid!, 3_000), "the guard retired on its own");
    assert.ok(alive(enginePid), "the engine was never touched");
  } finally {
    try {
      process.kill(passPid, "SIGKILL");
    } catch {
      // Already gone.
    }
    process.kill(enginePid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a reused engine pid does not fool the guard: the identity is the start time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-reuse-"));
  const script = guardScriptOf(dir);
  const passPid = await hungPass("dsh");
  const enginePid = await stubEngine();
  const guard = startPassGuard({
    scriptPath: script,
    enginePid,
    // The start time of a DIFFERENT age: the pid alone must not pass for the
    // engine, or a reused pid would end passes of a living engine.
    engineStartedAtMs: recordedStart(enginePid) - 60_000,
    passPid,
    passStartedAtMs: recordedStart(passPid),
    pollMs: 100,
    graceMs: 500,
  });
  try {
    assert.ok(
      await gone(passPid, 5_000),
      "the guard ended the pass: its engine is gone by identity",
    );
    assert.ok(await gone(guard!.pid!, 3_000), "the guard retired with the pass");
    assert.ok(alive(enginePid), "the stand-in engine was never signalled");
  } finally {
    try {
      process.kill(passPid, "SIGKILL");
    } catch {
      // Already gone.
    }
    process.kill(enginePid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * The engine itself: SIGKILL mid-pass, NO resume, no survivor.
 * ------------------------------------------------------------------ */

/** The stub of `claude`: the proposer pass hangs forever; the critic is never reached. */
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const critic = argv.includes("--max-turns");
if (critic) {
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": APPROVED" }));
} else {
  // A pass that never ends: the engine dies before it does.
  setInterval(() => {}, 1000);
}
`;

test(
  "a SIGKILL of the engine mid-pass leaves no live pass, with no resume started",
  { timeout: 120_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-engine-"));
    const bin = join(dir, "bin");
    const work = join(dir, "work");
    mkdirSync(bin);
    mkdirSync(join(work, "specs", "001-one"), { recursive: true });
    writeFileSync(join(bin, "claude"), STUB);
    chmodSync(join(bin, "claude"), 0o755);
    writeFileSync(
      join(work, "specs", "001-one", "tasks.md"),
      "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n",
    );
    for (const argv of [
      ["init", "-q"],
      ["config", "user.email", "t@t"],
      ["config", "user.name", "t"],
    ]) {
      await new Promise((done) =>
        spawn("git", ["-C", work, ...argv], { stdio: "ignore" }).on("close", () => done(undefined)),
      );
    }
    writeFileSync(
      join(dir, "runner.mjs"),
      `const { runFeature } = await import(${JSON.stringify(
        join(import.meta.dirname, "..", "..", "src", "engine", "run-feature.ts"),
      )});\n` +
        `const code = await runFeature({ argv: [], workdir: process.env.TEST_WORKDIR });\n` +
        `console.log("ENGINE-EXIT " + String(code));\n`,
    );
    const home = join(dir, "home");
    const workspace = createHash("sha256").update(work).digest("hex").slice(0, 16);
    const passPidPath = join(
      home,
      ".specstride",
      "workspaces",
      workspace,
      "features",
      "001-one",
      "pass.pid",
    );
    // The ceiling is far away: the ENGINE's death is what ends this pass, and
    // the guard must do it — nothing else is watching.
    const engine = spawn(process.execPath, [join(dir, "runner.mjs")], {
      cwd: work,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SPECSTRIDE_PROPOSER_TIMEOUT_SEC: "600",
        SPECSTRIDE_WATCHDOG_TICK_MS: "500",
        SPECSTRIDE_PROPOSER_PAUSE_SEC: "0",
        SPECSTRIDE_PASS_GUARD_POLL_MS: "100",
        SPECSTRIDE_KILL_GRACE_MS: "1000",
        TEST_WORKDIR: work,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    engine.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    engine.stderr.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    let passPid = 0;
    for (let waited = 0; waited < 60_000; waited += 100) {
      if (existsSync(passPidPath)) {
        try {
          passPid = (JSON.parse(readFileSync(passPidPath, "utf8")) as { pid: number }).pid;
        } catch {
          passPid = 0;
        }
        if (passPid > 0 && alive(passPid)) break;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(passPid > 0, `the pass was in flight (engine output so far: ${out})`);
    assert.ok(
      existsSync(join(home, ".specstride", "workspaces", workspace, "pass-guard.mjs")),
      "the engine planted the guard",
    );
    // SIGKILL of the engine only. NO resume is started, ever, in this test.
    process.kill(engine.pid, "SIGKILL");
    const engineEnded = await new Promise<{ signal?: string }>((done) =>
      engine.on("close", () => done({ signal: "SIGKILL" })),
    );
    assert.ok(engineEnded.signal !== undefined, "the engine died by the SIGKILL");
    assert.ok(
      await gone(passPid, 15_000),
      `no survivor: the pass (pid ${String(passPid)}) ended by itself after the engine died`,
    );
    rmSync(dir, { recursive: true, force: true });
  },
);
