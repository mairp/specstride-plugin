/**
 * T076 — unit tests of the process primitive of the kernel (T075; F100-FR-234).
 *
 * Every claim is read back through a path independent of the call that made it:
 * the properties of a started process come out of a record the CHILD wrote
 * about itself and out of the process file system, never out of the return
 * value of `start`; the status record of `startDetached` is read off disk after
 * the process that started it has ended; the reach of `signalGroup` is read by
 * asking the platform about each member of the group.
 *
 * HOST SAFETY (owner ruling of 2026-10-02). This file signals a process group.
 * It is run through `tests/isolate.ts`, which puts it in a PID namespace of its
 * own, and the only group it ever names is the group of a stub it started
 * itself, whose id is that stub's own process id. The refusal of 0, 1, -1 and
 * of anything that is not an integer above one is pinned by a test that expects
 * the refusal; it is never shown by removing the guard.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GROUP_SIGNALS,
  SIGNAL_OF_A_GROUP_SIGNAL,
  assertSignallableGroup,
  assertSignallableProcess,
  signalGroup,
  signalNameOf,
} from "../src/proc/signals.ts";
import {
  WAIT_POLL_MS,
  createProcessPrimitive,
  processPrimitive,
  startProcess,
  startProcessDetached,
  waitForEnd,
  PROC_REQUIREMENT,
  THE_KERNEL_HOLDS_RUN_POLICY,
} from "../src/proc/primitive.ts";
import {
  DETACHED_STATUS_KIND,
  parseWaiterArgv,
  type WrittenDetachedStatus,
} from "../src/proc/waiter.ts";
import { fixedClock, systemClock } from "../src/proc/clock.ts";
import {
  MACOS_UNVERIFIED_REASON,
  bootIdentity,
  commandLineOf,
  environOf,
  findByRunToken,
  listProcessesOfTheUser,
  platformProcessTableIo,
  processGroupOf,
  sessionOf,
  startTicksOf,
  startTimeOf,
  stateOf,
} from "../src/proc/table.ts";
import * as kernel from "../src/index.ts";
import {
  PROC_STUB_ENTRY,
  STDERR_MARKER,
  STDOUT_MARKER,
  readStubReport,
} from "./helpers/proc-stub.ts";

const ON_LINUX = process.platform === "linux";
const NO_MACOS_RUNNER =
  "no macOS machine: the macOS branch of the process primitive is `unverified` " +
  "(research D-6, D-8; the owner's out-of-band ruling of 2026-09-30)";

const DETACHED_STARTER = join(import.meta.dirname, "helpers", "detached-starter.ts");

function scratch(label: string): string {
  return mkdtempSync(join(tmpdir(), `specstride-kernel-proc-${label}-`));
}

/**
 * Is the process there, in the sense F122-FR-042 gives the word?
 *
 * `kill(pid, 0)` alone is not enough: inside the PID namespace of
 * `tests/isolate.ts` the test runner is process 1, so a child whose parent this
 * test killed is reparented to the runner, which does not collect it. A process
 * that has exited and was not yet collected still answers `kill(pid, 0)`, and
 * is NOT alive. `EPERM` — it lives and this user may not signal it — is alive.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // `EPERM` means it lives and this user may not signal it (F122-FR-042).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  // It answered: now tell a live process from one that was not yet collected.
  return stateOf(pid) !== "Z";
}

async function waitFor(what: string, ready: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen inside ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** The process group of this test process, read from the platform. */
function ownProcessGroup(): number | null {
  return processGroupOf(process.pid);
}
/** The session of this test process, read from the platform. */
function ownSession(): number | null {
  return sessionOf(process.pid);
}

/** Start a stub through the primitive and read back the record it wrote. */
async function startStub(
  label: string,
  extra: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<{
  readonly dir: string;
  readonly started: Awaited<ReturnType<typeof startProcess>>;
  readonly report: ReturnType<typeof readStubReport>;
  readonly stdoutFile: string;
  readonly stderrFile: string;
}> {
  const dir = scratch(label);
  const reportPath = join(dir, "report.json");
  const stdoutFile = join(dir, "out.log");
  const stderrFile = join(dir, "err.log");
  const started = await startProcess({
    argv: [
      process.execPath,
      PROC_STUB_ENTRY,
      "--report",
      reportPath,
      "--ttl-ms",
      "20000",
      ...extra,
    ],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", ...env },
    stdoutFile,
    stderrFile,
  });
  await waitFor(`the stub of ${label} became ready`, () => existsSync(reportPath));
  return { dir, started, report: readStubReport(reportPath), stdoutFile, stderrFile };
}

/* ------------------------------------------------------------------ *
 * The six operations and the clock are exported from the index.
 * ------------------------------------------------------------------ */

test("T076 — the index of @specstride/kernel exports the primitive and the clock", () => {
  for (const name of [
    "startProcess",
    "startProcessDetached",
    "signalGroup",
    "startTimeOf",
    "findByRunToken",
    "waitForEnd",
    "processPrimitive",
    "systemClock",
  ]) {
    assert.ok(name in kernel, `the index of @specstride/kernel does not export ${name}`);
  }
  // The six operations of F100-FR-234 are all on the primitive object.
  for (const operation of [
    "start",
    "startDetached",
    "signalGroup",
    "startTimeOf",
    "findByRunToken",
    "waitForEnd",
  ] as const) {
    assert.equal(
      typeof processPrimitive[operation],
      "function",
      `the primitive has no operation ${operation}`,
    );
  }
  assert.equal(PROC_REQUIREMENT, "F100-FR-234");
  assert.equal(THE_KERNEL_HOLDS_RUN_POLICY, false);
  assert.equal(typeof systemClock.nowMs(), "number");
  assert.match(systemClock.nowIso(), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.equal(typeof systemClock.monotonicMs(), "number");
  const clock = fixedClock(1_000);
  clock.advance(500);
  assert.equal(clock.nowMs(), 1_500);
});

/* ------------------------------------------------------------------ *
 * `start`: a group and a session of its own, stdin closed, two files.
 * ------------------------------------------------------------------ */

test("T076 — `start` puts the process in a GROUP and a SESSION of its own", async () => {
  const { started, report } = await startStub("group-session");
  try {
    // Read back from the child's own record, not from the return value.
    assert.equal(report.pid, started.pid, "the stub is not the process `start` reported");
    if (ON_LINUX) {
      assert.equal(report.pgid, report.pid, "the group of the stub is not its own process id");
      assert.equal(report.sid, report.pid, "the stub does not lead a session of its own");
      assert.notEqual(report.pgid, ownProcessGroup(), "the group is the caller's group");
      assert.notEqual(report.sid, ownSession(), "the session is the caller's session");
    }
    assert.equal(started.pgid, report.pgid ?? started.pid, "`start` reported another group");
    assert.ok(started.startedAtMs > 0, "`start` reported no start time");
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — `start` closes standard input: nothing can be read from it", async () => {
  const { started, report } = await startStub("stdin");
  try {
    assert.equal(
      report.stdin,
      "eof",
      "the stub read bytes from standard input; it must give an end of file at once",
    );
    if (ON_LINUX) {
      assert.equal(
        report.fds["0"],
        "/dev/null",
        "standard input of the stub is not the null device; a pipe would lead back to the caller",
      );
    }
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — the two outputs land in the two files the caller named", async () => {
  const { started, report, stdoutFile, stderrFile } = await startStub("outputs");
  try {
    await waitFor("both output files held their marker", () => {
      if (!existsSync(stdoutFile) || !existsSync(stderrFile)) return false;
      return (
        readFileSync(stdoutFile, "utf8").includes(STDOUT_MARKER) &&
        readFileSync(stderrFile, "utf8").includes(STDERR_MARKER)
      );
    });
    const out = readFileSync(stdoutFile, "utf8");
    const err = readFileSync(stderrFile, "utf8");
    assert.ok(out.includes(STDOUT_MARKER), "standard output did not land in the named file");
    assert.ok(err.includes(STDERR_MARKER), "standard error did not land in the named file");
    assert.ok(!out.includes(STDERR_MARKER), "standard error leaked into the output file");
    assert.ok(!err.includes(STDOUT_MARKER), "standard output leaked into the error file");
    if (ON_LINUX) {
      // And the descriptors of the live process point at those very files.
      assert.equal(report.fds["1"], stdoutFile);
      assert.equal(report.fds["2"], stderrFile);
    }
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — no shell is interposed: the parent of the stub is this test process", async () => {
  const { started, report } = await startStub("no-shell");
  try {
    assert.equal(
      report.ppid,
      process.pid,
      "something stands between the caller and the stub; `start` uses no shell",
    );
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — `start` refuses an empty command", async () => {
  await assert.rejects(
    async () => startProcess({ argv: [], cwd: process.cwd(), env: {} }),
    /`start` was given no command/,
  );
});

/* ------------------------------------------------------------------ *
 * `signalGroup`: it reaches every member of the group, and refuses.
 * ------------------------------------------------------------------ */

test("T076 — `signalGroup` reaches every member of the group", async () => {
  const { started, report } = await startStub("group-reach", ["--children", "2"]);
  assert.equal(report.children.length, 2, "the stub did not start its two children");
  const members = [report.pid, ...report.children];
  for (const pid of members) {
    assert.ok(alive(pid), `the member ${pid} of the group was not alive before the signal`);
  }
  // The group id is the stub's own process id: an integer above one, and the
  // group of a process this test started itself.
  assert.equal(started.pgid, report.pid);
  signalGroup(started.pgid, "kill");
  for (const pid of members) {
    await waitFor(`the member ${pid} of the group was gone`, () => !alive(pid));
  }
});

test("T076 — `signalGroup` refuses a group id that is not an integer above one", () => {
  for (const pgid of [0, 1, -1, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => assertSignallableGroup(pgid),
      /refusing to signal the process group/,
      `the group ${String(pgid)} was not refused`,
    );
    assert.throws(
      () => signalGroup(pgid, "kill"),
      /refusing to signal the process group/,
      `signalGroup refused to refuse the group ${String(pgid)}`,
    );
  }
  for (const pid of [0, 1, -1, 1.5, Number.NaN]) {
    assert.throws(() => assertSignallableProcess(pid), /refusing to signal the process/);
  }
  // And an integer above one is accepted by the guard.
  assert.doesNotThrow(() => assertSignallableGroup(2));
  assert.doesNotThrow(() => assertSignallableProcess(2));
});

test("T076 — the three group signals are polite, terminate, kill", () => {
  assert.deepEqual([...GROUP_SIGNALS], ["polite", "terminate", "kill"]);
  assert.deepEqual(
    { ...SIGNAL_OF_A_GROUP_SIGNAL },
    { polite: "SIGINT", terminate: "SIGTERM", kill: "SIGKILL" },
  );
  for (const signal of GROUP_SIGNALS) assert.ok(signalNameOf(signal).startsWith("SIG"));
});

test("T076 — `signalGroup` with the polite signal ends a group that handles it", async () => {
  const { started, report } = await startStub("polite");
  signalGroup(started.pgid, "polite");
  await waitFor("the politely signalled stub was gone", () => !alive(report.pid));
});

test("T076 — a group that is already gone is not an error", async () => {
  const { started, report } = await startStub("already-gone");
  signalGroup(started.pgid, "kill");
  await waitFor("the stub was gone", () => !alive(report.pid));
  assert.doesNotThrow(() => signalGroup(started.pgid, "kill"));
});

/* ------------------------------------------------------------------ *
 * `startTimeOf` and `findByRunToken`.
 * ------------------------------------------------------------------ */

test("T076 — `startTimeOf` reads the start time of a process", async (t) => {
  if (!ON_LINUX) {
    t.skip(NO_MACOS_RUNNER);
    return;
  }
  const before = Date.now();
  const { started, report } = await startStub("start-time");
  try {
    const ms = startTimeOf(report.pid);
    assert.ok(ms !== null, "`startTimeOf` could not read the start time of a live process");
    // The start time lies between the moment before the start and now, with a
    // margin for the resolution of the clock ticks of the platform.
    assert.ok(
      ms >= before - 2_000 && ms <= Date.now() + 1_000,
      `the start time ${String(ms)} is not between ${String(before)} and now`,
    );
    const ticks = startTicksOf(report.pid);
    assert.ok(ticks !== null && ticks > 0, "`startTicksOf` gave no ticks since boot");
    // The same answer through the primitive the composition root hands on.
    assert.equal(processPrimitive.startTimeOf(report.pid), ms);
    // A process that is gone has no start time.
    assert.equal(startTimeOf(2 ** 22 - 1), null);
    assert.equal(startTimeOf(0), null);
    assert.equal(startTimeOf(-1), null);
    assert.equal(started.pid, report.pid);
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — `commandLineOf` reads the command line of a process on both platforms", async (t) => {
  if (!ON_LINUX) {
    t.skip(NO_MACOS_RUNNER);
    return;
  }
  const { started, report } = await startStub("command-line");
  try {
    // Linux: the process file system, NULs folded to spaces.
    const line = commandLineOf(report.pid);
    assert.match(line, /proc-stub/);
    assert.ok(!line.includes("\0"), "the NULs of the table row are folded to spaces");
    // A host without the process file system — macOS, every branch of it
    // `unverified` (D-6, D-8) — answers through `ps`, with no /proc to read.
    const psIo = {
      ...platformProcessTableIo,
      platform: "darwin",
      readFile: () => null,
      readDirectory: () => null,
      runPs: (args: readonly string[]) =>
        args.includes("command=") ? `node ${PROC_STUB_ENTRY} --report x` : "",
    };
    assert.match(commandLineOf(report.pid, psIo), /proc-stub/);
    // A process that is gone, and a number that is no process id, answer "".
    assert.equal(commandLineOf(2 ** 22 - 1), "");
    assert.equal(commandLineOf(0), "");
    assert.equal(started.pid, report.pid);
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — `findByRunToken` finds a child by its token", async () => {
  const token = `kernel-proc-test-${process.pid}-${String(startTicksOf(process.pid) ?? 0)}`;
  const { started, report } = await startStub("run-token", [], {
    SPECSTRIDE_RUN_TOKEN: token,
  });
  try {
    await waitFor("the token was visible in the process table", () =>
      findByRunToken(token).includes(report.pid),
    );
    const carriers = findByRunToken(token);
    assert.ok(carriers.includes(report.pid), `the token was not found on the stub ${report.pid}`);
    // Through the primitive too.
    assert.ok(processPrimitive.findByRunToken(token).includes(report.pid));
    // A token nothing holds finds nothing; an empty token finds nothing.
    assert.deepEqual([...findByRunToken(`${token}-nobody-holds-this`)], []);
    assert.deepEqual([...findByRunToken("")], []);
    // The environment read is never handed on: the answer is process ids only.
    for (const found of carriers) assert.equal(typeof found, "number");
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

test("T076 — the process table lists the processes of the user", async (t) => {
  if (!ON_LINUX) {
    t.skip(NO_MACOS_RUNNER);
    return;
  }
  const { started, report } = await startStub("list");
  try {
    const pids = listProcessesOfTheUser().map((found) => found.pid);
    assert.ok(pids.includes(process.pid), "the list does not hold the test process itself");
    assert.ok(pids.includes(report.pid), "the list does not hold the stub that was just started");
    const env = environOf(report.pid);
    assert.ok(env !== null, "the environment of a process of the same user could not be read");
    assert.equal(env.PATH, process.env.PATH ?? "");
    assert.ok(bootIdentity() !== null, "the boot identity could not be read on Linux");
    assert.equal(stateOf(report.pid)?.length, 1);
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the stub was gone", () => !alive(started.pid));
  }
});

/* ------------------------------------------------------------------ *
 * `waitForEnd`.
 * ------------------------------------------------------------------ */

test("T076 — `waitForEnd` reports the exit code of a process the kernel started", async () => {
  const dir = scratch("wait-exit");
  const started = await startProcess({
    argv: [process.execPath, "-e", "setTimeout(() => process.exit(7), 200);"],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    stdoutFile: join(dir, "out.log"),
    stderrFile: join(dir, "err.log"),
  });
  const end = await waitForEnd(started.pid);
  assert.equal(end.exitCode, 7, "`waitForEnd` did not report the exit code");
  assert.equal(end.signal, null);
  assert.ok(WAIT_POLL_MS > 0);
});

test("T076 — `waitForEnd` reports the signal that ended a process the kernel started", async () => {
  const dir = scratch("wait-signal");
  const started = await startProcess({
    argv: [process.execPath, "-e", "setTimeout(() => {}, 20000);"],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    stdoutFile: join(dir, "out.log"),
    stderrFile: join(dir, "err.log"),
  });
  signalGroup(started.pgid, "terminate");
  const end = await waitForEnd(started.pid);
  assert.equal(end.signal, "SIGTERM");
  assert.equal(end.exitCode, null);
});

test("T076 — `waitForEnd` refuses a process id that is not an integer above one", async () => {
  for (const pid of [0, 1, -1, 1.5]) {
    await assert.rejects(async () => waitForEnd(pid), /refusing to signal the process/);
  }
});

/* ------------------------------------------------------------------ *
 * `startDetached`: the status record exists after the starter has ended.
 * ------------------------------------------------------------------ */

/** Run the starter as a process of its own and wait until it is gone. */
async function runStarter(
  label: string,
  command: readonly string[],
): Promise<{
  readonly dir: string;
  readonly statusFile: string;
  readonly starter: { starterPid: number; pid: number; pgid: number; endingAtMs: number };
  readonly starterGoneAtMs: number;
  readonly stdoutFile: string;
  readonly stderrFile: string;
}> {
  const dir = scratch(label);
  const statusFile = join(dir, "status.json");
  const outPath = join(dir, "starter.json");
  const stdoutFile = join(dir, "out.log");
  const stderrFile = join(dir, "err.log");
  const child = spawn(
    process.execPath,
    [
      DETACHED_STARTER,
      "--status",
      statusFile,
      "--out",
      outPath,
      "--stdout",
      stdoutFile,
      "--stderr",
      stderrFile,
      "--",
      ...command,
    ],
    { cwd: dir, stdio: ["ignore", "inherit", "inherit"] },
  );
  const exit = await new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const starterGoneAtMs = Date.now();
  assert.equal(exit, 0, "the starter did not end cleanly");
  assert.ok(existsSync(outPath), "the starter wrote down no identity");
  const starter = JSON.parse(readFileSync(outPath, "utf8")) as {
    starterPid: number;
    pid: number;
    pgid: number;
    endingAtMs: number;
  };
  assert.ok(!alive(starter.starterPid), "the starter is still alive");
  return { dir, statusFile, starter, starterGoneAtMs, stdoutFile, stderrFile };
}

test("T076 — the status record of `startDetached` exists after the starter has ended", async () => {
  const { statusFile, starter, starterGoneAtMs, stdoutFile } = await runStarter("detached-exit", [
    process.execPath,
    "-e",
    "process.stdout.write('detached child ran\\n'); setTimeout(() => process.exit(7), 900);",
  ]);

  // The starter is gone and the record is not there yet: this is the whole
  // point of the waiter. Then the record appears, written by the waiter.
  await waitFor("the status record appeared", () => existsSync(statusFile));
  const record = JSON.parse(readFileSync(statusFile, "utf8")) as WrittenDetachedStatus;

  assert.equal(record.kind, DETACHED_STATUS_KIND);
  assert.equal(record.exitCode, 7, "the record does not carry the exit code of the command");
  assert.equal(record.signal, null, "the record carries a signal for a clean exit");
  assert.ok(record.durationMs >= 800, `the duration ${String(record.durationMs)} is too short`);
  assert.ok(record.startedAtMs > 0, "the record carries no start time");
  assert.ok(record.endedAtMs >= record.startedAtMs, "the record ends before it starts");
  assert.ok(
    record.endedAtMs >= starterGoneAtMs,
    `the command ended at ${String(record.endedAtMs)}, before the starter was gone at ` +
      `${String(starterGoneAtMs)}: the record would not prove the waiter outlived the starter`,
  );
  // Every field F100-FR-234 names is present.
  for (const field of ["exitCode", "signal", "durationMs", "startedAtMs", "endedAtMs"] as const) {
    assert.ok(field in record, `the status record has no field ${field}`);
  }
  // The waiter leads the session and the group that `startDetached` reported.
  assert.equal(record.waiterPid, starter.pid);
  assert.equal(starter.pgid, starter.pid);
  assert.ok(record.commandPid !== null && record.commandPid !== starter.pid);
  // The command's output went to the file the caller named.
  assert.ok(readFileSync(stdoutFile, "utf8").includes("detached child ran"));
});

test("T076 — the status record of `startDetached` carries the signal that ended the command", async () => {
  const { statusFile } = await runStarter("detached-signal", [
    process.execPath,
    "-e",
    "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 700);",
  ]);
  await waitFor("the status record appeared", () => existsSync(statusFile));
  const record = JSON.parse(readFileSync(statusFile, "utf8")) as WrittenDetachedStatus;
  assert.equal(record.signal, "SIGTERM", "the record does not carry the signal");
  assert.equal(record.exitCode, null, "the record carries an exit code for a signalled command");
  assert.ok(record.durationMs >= 600);
});

test("T076 — the waiter runs in the new session, with no shell", async (t) => {
  if (!ON_LINUX) {
    t.skip(NO_MACOS_RUNNER);
    return;
  }
  const dir = scratch("waiter-session");
  const statusFile = join(dir, "status.json");
  const reportPath = join(dir, "report.json");
  const started = await startProcessDetached({
    argv: [process.execPath, PROC_STUB_ENTRY, "--report", reportPath, "--ttl-ms", "4000"],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    statusFile,
    stdoutFile: join(dir, "out.log"),
    stderrFile: join(dir, "err.log"),
  });
  try {
    await waitFor("the detached stub became ready", () => existsSync(reportPath));
    const report = readStubReport(reportPath);
    // The waiter leads the session; the command is in that same session and group.
    assert.equal(sessionOf(started.pid), started.pid, "the waiter does not lead a new session");
    assert.notEqual(sessionOf(started.pid), ownSession());
    assert.equal(report.sid, started.pid, "the command is not in the waiter's session");
    assert.equal(report.pgid, started.pgid, "the command is not in the waiter's group");
    // The command's parent is the waiter itself: no shell stands between them.
    assert.equal(report.ppid, started.pid);
    assert.equal(readlinkSync(`/proc/${String(started.pid)}/fd/0`), "/dev/null");
    assert.equal(report.stdin, "eof");
  } finally {
    signalGroup(started.pgid, "kill");
    await waitFor("the detached group was gone", () => !alive(started.pid));
  }
});

test("T076 — `startDetached` refuses an empty command and a missing status file", async () => {
  await assert.rejects(
    async () => startProcessDetached({ argv: [], cwd: process.cwd(), env: {}, statusFile: "/x" }),
    /`startDetached` was given no command/,
  );
  await assert.rejects(
    async () =>
      startProcessDetached({ argv: ["/bin/true"], cwd: process.cwd(), env: {}, statusFile: "" }),
    /needs the file the waiter writes/,
  );
});

test("T076 — the waiter refuses a malformed argument list", () => {
  assert.throws(() => parseWaiterArgv(["--status", "/x"]), /before the command/);
  assert.throws(() => parseWaiterArgv(["--cwd", "/x", "--"]), /--status <file>/);
  assert.throws(() => parseWaiterArgv(["--status", "/x", "--"]), /--cwd <directory>/);
  assert.throws(() => parseWaiterArgv(["--status", "/x", "--cwd", "/y", "--"]), /no command/);
  assert.deepEqual(parseWaiterArgv(["--status", "/s", "--cwd", "/c", "--", "/bin/true", "-x"]), {
    statusFile: "/s",
    cwd: "/c",
    argv: ["/bin/true", "-x"],
  });
});

/* ------------------------------------------------------------------ *
 * macOS: a skip with its reason, because no machine exists.
 * ------------------------------------------------------------------ */

test(
  "T076 — macOS: the process table of the primitive",
  { skip: !ON_LINUX ? false : NO_MACOS_RUNNER },
  () => {
    // Runs only on a macOS machine; on Linux it is a skip with the reason above.
    const primitive = createProcessPrimitive();
    assert.equal(typeof primitive.startTimeOf(process.pid), "number");
    assert.ok(bootIdentity() !== null);
  },
);

test("T076 — the macOS branch is marked `unverified` with its reason", () => {
  assert.match(MACOS_UNVERIFIED_REASON, /unverified/);
  assert.match(MACOS_UNVERIFIED_REASON, /D-6, D-8/);
  // `ps` is on the search path, which is what the macOS branch needs (quickstart).
  assert.doesNotThrow(() =>
    execFileSync("ps", ["-o", "pid=", "-p", String(process.pid)], { encoding: "utf8" }),
  );
});
