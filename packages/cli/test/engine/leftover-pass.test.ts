/**
 * The survivor cleanup of the engine (step 1, part A): the pass an earlier
 * killed run left over is ended — but only where the record and the host
 * agree on its IDENTITY: the same pid, the same start time, and the harness
 * as the EXECUTABLE. A process that merely holds the letters `claude` in its
 * arguments, or the pid with another start time (a reused pid), or a host
 * that cannot observe the start time at all, is left alive.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { platformProcessTableIo, startTimeOf } from "@specstride/kernel";
import { endTheLeftoverPass } from "../../src/engine/run-feature.ts";

/**
 * A hung stub whose /proc cmdline names the harness given as argv[0]. The
 * node BINARY is reached through a symlink named `dsh` (or `claude`), so the
 * process is EXEC'D as the harness itself — `<dir>/dsh -e …` — exactly as
 * the real executable `/usr/bin/dsh --profile …` is seen there (a shebang
 * script would put `node` in front, and the executable is what the cleanup
 * checks).
 */
function spawnHung(as: string): Promise<number> {
  return new Promise((done) => {
    const dir = mkdtempSync(join(tmpdir(), "leftover-"));
    const bin = join(dir, as);
    symlinkSync(process.execPath, bin);
    chmodSync(bin, 0o755);
    const child = spawn(bin, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    child.on("spawn", () => done(child.pid!));
  });
}

/** The identity record the engine writes for a pass in flight. */
function writePassRecord(dir: string, pid: number, startedAtMs: number): string {
  const pidPath = join(dir, "pass.pid");
  writeFileSync(pidPath, JSON.stringify({ pid, startedAtMs }));
  return pidPath;
}

/** The start time of a live process, as the engine records it at the spawn. */
function recordedStart(pid: number): number {
  const startedAtMs = startTimeOf(pid);
  assert.notEqual(startedAtMs, null, "the host answered the start time");
  return startedAtMs as number;
}

/** Waits until the process of a pid is gone (SIGTERM is the polite signal). */
async function gone(pid: number): Promise<boolean> {
  for (let waited = 0; waited < 3_000; waited += 50) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

test("a killed engine run leaves no live dsh pass: the leftover is ended", async () => {
  const pid = await spawnHung("dsh");
  const dir = mkdtempSync(join(tmpdir(), "leftover-state."));
  const pidPath = writePassRecord(dir, pid, recordedStart(pid));
  const lines: string[] = [];
  endTheLeftoverPass(pidPath, (line) => lines.push(line));
  assert.ok(!existsSync(pidPath), "the pid file is gone");
  assert.ok(await gone(pid), `the leftover dsh pass (pid ${String(pid)}) was ended`);
  assert.ok(
    lines.some((line) => line.includes(String(pid))),
    "the cleanup was reported",
  );
});

test("the claude leftover is still ended the same way", async () => {
  const pid = await spawnHung("claude");
  const dir = mkdtempSync(join(tmpdir(), "leftover-claude."));
  const pidPath = writePassRecord(dir, pid, recordedStart(pid));
  endTheLeftoverPass(pidPath, () => undefined);
  assert.ok(await gone(pid), `the leftover claude pass (pid ${String(pid)}) was ended`);
});

test("a harness pass whose start time differs from the record is spared: the pid was reused", async () => {
  const pid = await spawnHung("claude");
  try {
    const dir = mkdtempSync(join(tmpdir(), "leftover-reused."));
    const pidPath = writePassRecord(dir, pid, recordedStart(pid) - 5_000);
    const lines: string[] = [];
    endTheLeftoverPass(pidPath, (line) => lines.push(line));
    assert.equal(lines.length, 0, "no cleanup was reported");
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotThrow(() => process.kill(pid, 0), "the reused pid lives on");
  } finally {
    process.kill(pid, "SIGKILL");
  }
});

test("a process of no harness is spared, though its start time matches", async () => {
  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const dir = mkdtempSync(join(tmpdir(), "leftover-spared."));
    const pidPath = writePassRecord(dir, sleeper.pid!, recordedStart(sleeper.pid!));
    const lines: string[] = [];
    endTheLeftoverPass(pidPath, (line) => lines.push(line));
    assert.equal(lines.length, 0, "no cleanup was reported");
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotThrow(() => process.kill(sleeper.pid!, 0), "the unrelated process lives on");
  } finally {
    sleeper.kill("SIGKILL");
  }
});

test("a live process holding `claude` in its ARGUMENTS is spared: the executable is not a harness", async () => {
  // The shape the old letters-check ended by mistake: a command line that
  // merely CONTAINS `claude`, argv[0] being something else entirely.
  const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "claude", "dsh"], {
    stdio: "ignore",
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "leftover-letters."));
    const pidPath = writePassRecord(dir, stranger.pid!, recordedStart(stranger.pid!));
    const lines: string[] = [];
    endTheLeftoverPass(pidPath, (line) => lines.push(line));
    assert.equal(lines.length, 0, "no cleanup was reported");
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotThrow(
      () => process.kill(stranger.pid!, 0),
      "the process holding the letters lives on",
    );
  } finally {
    stranger.kill("SIGKILL");
  }
});

test("a record whose start time the host cannot observe is not signalled", async () => {
  const pid = await spawnHung("dsh");
  try {
    const dir = mkdtempSync(join(tmpdir(), "leftover-blind."));
    const pidPath = writePassRecord(dir, pid, recordedStart(pid));
    const lines: string[] = [];
    // A table that answers nothing — the regime of a host without the
    // process file system: the identity cannot be checked, so nothing ends.
    endTheLeftoverPass(pidPath, (line) => lines.push(line), {
      ...platformProcessTableIo,
      platform: "darwin" as const,
      readFile: () => null,
      readDirectory: () => null,
      runPs: () => null,
    });
    assert.equal(lines.length, 0, "no cleanup was reported");
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotThrow(() => process.kill(pid, 0), "the unidentifiable pass lives on");
  } finally {
    process.kill(pid, "SIGKILL");
  }
});
