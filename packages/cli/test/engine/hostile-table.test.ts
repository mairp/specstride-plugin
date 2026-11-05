/**
 * The supervision of a pass on a host whose process table CANNOT be read
 * (the macOS CI hang of 2026-11-02: the `cli` workspace sat half an hour in
 * these tests because a refused signal left a hung pass to the 45-minute
 * limit of the harness call).
 *
 * Three seams, one per test:
 *  - the stop-ladder sender REFUSES a live pass whose start time the table
 *    cannot observe: a process the sender cannot identify is never signalled
 *    (a reused pid would be), so the engine ends the pass through its own
 *    handle — the third test proves it does — and a dead pid keeps its
 *    precise refusal;
 *  - the survivor cleanup still recognises a leftover pass without the
 *    process file system, through the kernel's `ps` branch;
 *  - the engine itself: a hung pass over the ceiling is ended by the
 *    engine's own handle when the sender refuses, and the phase finishes —
 *    proved inside a mount namespace with `/proc` unmounted where the host
 *    allows one (root on Linux, as `tests/isolate.ts` does), and on the
 *    plain host otherwise, where the real sender does the killing.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { platformProcessTableIo, startTimeOf, type ProcessTableIo } from "@specstride/kernel";
import { endTheLeftoverPass, supervisionSignalSender } from "../../src/engine/run-feature.ts";

/** A table that answers nothing, as one without the process file system does. */
function tableThatAnswersNothing(): ProcessTableIo {
  return {
    ...platformProcessTableIo,
    platform: "darwin",
    readFile: () => null,
    readDirectory: () => null,
    ownerOf: () => null,
    runPs: () => null,
  };
}

/** A hung child, alive until a signal ends it. */
function hungChild(as: string): Promise<number> {
  return new Promise((done) => {
    const dir = mkdtempSync(join(tmpdir(), "hostile-table-"));
    const bin = join(dir, as);
    // The node BINARY through a symlink NAMED as the harness, so the process
    // is exec'd as `<dir>/dsh -e …` — argv[0] is the harness, as the real
    // executable is; a shebang script would put `node` in front of it.
    symlinkSync(process.execPath, bin);
    chmodSync(bin, 0o755);
    const child = spawn(bin, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    child.on("spawn", () => done(child.pid!));
  });
}

/** Waits until the process of a pid is gone. */
async function gone(pid: number, timeoutMs = 5_000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  return false;
}

/** The target of a signal: a pid, the start time recorded for it, the token of the run. */
function targetOf(pid: number, startedAtMs = Date.now() - 60_000) {
  return { pid, startedAtMs, runTokenHash: "0".repeat(64) };
}

test("the stop-ladder sender refuses a live pass it cannot identify, and still refuses a dead or reused pid", async () => {
  const pid = await hungChild("dsh");
  const sender = supervisionSignalSender(() => undefined, tableThatAnswersNothing());
  try {
    // This pin was changed with the fix it pins: the sender signalled the
    // live pid on a table that answers nothing, which identifies nothing —
    // a reused pid would have been signalled the same way. An unobservable
    // start time is a refusal now; the engine that spawned the pass ends it
    // by handle (the engine test below proves that rung).
    const refusal = sender.signal(targetOf(pid), "terminate");
    assert.equal(refusal, "start-time-unobservable", "an unidentifiable live pass is refused");
    assert.doesNotThrow(() => process.kill(pid, 0), "the sender did not signal the pass itself");
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It ended by the signal of the test.
    }
  }
  // A process that is gone is still refused — the liveness probe fails.
  assert.equal(
    sender.signal(targetOf(2 ** 22 - 1), "terminate"),
    "no-such-process",
    "a dead pid is refused",
  );
  // A process whose observed start time no longer matches the recorded one —
  // a reused pid — is still refused: a table that answers keeps both checks
  // of F100-FR-064. The pass here is LIVE (liveness is probed before the
  // start time), and the table answers a start time of another age.
  const reusedPid = await hungChild("dsh");
  const reused = supervisionSignalSender(() => undefined, {
    ...platformProcessTableIo,
    platform: "darwin",
    readFile: () => null,
    runPs: (args: readonly string[]) =>
      args.includes("lstart=") ? "Mon Nov 2 00:00:00 2020" : null,
  });
  try {
    assert.equal(
      reused.signal(targetOf(reusedPid, Date.now()), "terminate"),
      "start-time-mismatch",
      "a reused pid is refused by the start time",
    );
    assert.doesNotThrow(() => process.kill(reusedPid, 0), "the pass was not signalled");
  } finally {
    try {
      process.kill(reusedPid, "SIGKILL");
    } catch {
      // It ended by the signal of the test.
    }
  }
});

test("a pass whose live start time differs from the one recorded at spawn is refused; the recorded one is signalled", async () => {
  const pid = await hungChild("dsh");
  const sender = supervisionSignalSender(() => undefined);
  const recordedAtSpawn = startTimeOf(pid);
  assert.notEqual(recordedAtSpawn, null, "the real table answered the start time");
  try {
    // A pid that was REUSED since the spawn answers a start time that no
    // longer matches the record: the ladder must refuse it, on the real
    // table, exactly as the watchdog builds its target (the recorded value,
    // never a fresh read at kill time).
    assert.equal(
      sender.signal(targetOf(pid, (recordedAtSpawn as number) - 5_000), "terminate"),
      "start-time-mismatch",
      "a start time that differs from the spawn record is refused",
    );
    assert.doesNotThrow(() => process.kill(pid, 0), "the pass was not signalled");
    // The record of the spawn itself still authorises the signal.
    assert.equal(
      sender.signal(targetOf(pid, recordedAtSpawn as number), "terminate"),
      undefined,
      "the pass recorded at spawn is signalled",
    );
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It ended by the signal of the test.
    }
  }
  assert.ok(await gone(pid), "the signalled pass ended");
});

test("the survivor cleanup ends a leftover pass where `ps` answers its identity, and spares what it cannot identify", async () => {
  const pid = await hungChild("dsh");
  const startedAtMs = startTimeOf(pid);
  assert.notEqual(startedAtMs, null, "the real table answered the start time");
  // What macOS `ps` answers: the command line and the start time of the live
  // process, read here off the Linux table this host does have, in the shape
  // `ps -o lstart=` prints (`Mon Nov  2 09:00:00 2026`, local time).
  const lstartOf = (ms: number): string => {
    const date = new Date(ms);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const two = (n: number): string => String(n).padStart(2, "0");
    return (
      `${weekdays[date.getDay()] as string} ${months[date.getMonth()] as string} ` +
      `${String(date.getDate()).padStart(2, " ")} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${String(date.getFullYear())}`
    );
  };
  const psIo: ProcessTableIo = {
    ...platformProcessTableIo,
    platform: "darwin",
    readFile: () => null,
    readDirectory: () => null,
    runPs: (args: readonly string[]) => {
      if (args.includes("command=")) {
        // What `ps -o command=` prints: one line, spaces — the /proc file is
        // NUL-separated, so the fold happens here, where the stub fakes it.
        return platformProcessTableIo
          .readFile(`/proc/${String(pid)}/cmdline`)
          ?.split("\0")
          .join(" ")
          .trim();
      }
      if (args.includes("lstart=")) return lstartOf(startedAtMs as number);
      return null;
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "hostile-leftover."));
  const pidPath = join(dir, "pass.pid");
  writeFileSync(pidPath, JSON.stringify({ pid, startedAtMs }));
  const lines: string[] = [];
  try {
    endTheLeftoverPass(pidPath, (line) => lines.push(line), psIo);
    assert.ok(!existsSync(pidPath), "the pid file is gone");
    assert.ok(await gone(pid), "the leftover dsh pass was ended without /proc");
    assert.ok(
      lines.some((line) => line.includes(String(pid))),
      "the cleanup was reported",
    );
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It ended by the cleanup.
    }
  }
  // The same host where `ps` answers NOTHING about the start time: the pass
  // cannot be identified, so it is not signalled — the guard of the engine
  // (not this cleanup) owns the pass while the engine lives.
  const blind = await hungChild("dsh");
  try {
    const blindStart = startTimeOf(blind);
    assert.notEqual(blindStart, null, "the real table answered the start time");
    const blindPath = join(dir, "pass.pid");
    writeFileSync(blindPath, JSON.stringify({ pid: blind, startedAtMs: blindStart }));
    const blindLines: string[] = [];
    endTheLeftoverPass(blindPath, (line) => blindLines.push(line), { ...psIo, runPs: () => null });
    assert.equal(blindLines.length, 0, "no cleanup was reported");
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotThrow(() => process.kill(blind, 0), "the unidentifiable pass lives on");
  } finally {
    try {
      process.kill(blind, "SIGKILL");
    } catch {
      // It ended by the signal of the test.
    }
  }
});

/* ------------------------------------------------------------------ *
 * The engine under a hostile table: a hung pass is still killed.
 * ------------------------------------------------------------------ */

/** The stub of `claude`: pass 1 hangs, pass 2 writes the evidence; the critic approves. */
const STUB = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (critic) {
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": APPROVED" }));
} else {
  const passes = Number(fs.existsSync("pass-count.txt") ? fs.readFileSync("pass-count.txt", "utf8") : "0") + 1;
  fs.writeFileSync("pass-count.txt", String(passes));
  if (passes < 2) { setInterval(() => {}, 1000); }
  else {
    const evidence = /write (\\.specstride\\S+?):/.exec(prompt)[1];
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, "T001 done\\n");
    console.log(JSON.stringify({ type: "result", result: "ok" }));
  }
}
`;

test(
  "a hung pass over the ceiling is ended and the phase finishes, with no process table to read",
  { timeout: 180_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "hostile-engine-"));
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
      spawnSync("git", ["-C", work, ...argv]);
    }
    // The runner: one feature, and the exit code of the engine on the last line.
    writeFileSync(
      join(dir, "runner.mjs"),
      `const { runFeature } = await import(${JSON.stringify(
        join(import.meta.dirname, "..", "..", "src", "engine", "run-feature.ts"),
      )});\n` +
        `const code = await runFeature({ argv: [], workdir: process.env.TEST_WORKDIR });\n` +
        `console.log("ENGINE-EXIT " + String(code));\n`,
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: join(dir, "home"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SPECSTRIDE_PROPOSER_TIMEOUT_SEC: "1",
      SPECSTRIDE_WATCHDOG_TICK_MS: "200",
      SPECSTRIDE_KILL_GRACE_MS: "500",
      SPECSTRIDE_PROPOSER_PAUSE_SEC: "0",
      TEST_WORKDIR: work,
    };
    // Where the host allows a mount namespace (root on Linux, as tests/isolate.ts
    // requires), the engine runs with an EMPTY process file system mounted over
    // /proc — the regime that stalled the suite, where no table read answers and
    // only the engine's own handle can end the pass. Elsewhere the same run
    // proves the plain-host path, where the real sender does the killing.
    const canHide = spawnSync("unshare", ["--mount", "--pid", "--fork", "--mount-proc", "true"], {
      timeout: 10_000,
    }).status;
    const tini = ["/usr/bin/tini", "/usr/sbin/tini", "/sbin/tini"].find((path) => existsSync(path));
    const runner = `${process.execPath} ${join(dir, "runner.mjs")}`;
    const argv =
      canHide === 0
        ? [
            "unshare",
            "--mount",
            "--pid",
            "--fork",
            "--mount-proc",
            ...(tini === undefined ? [] : [tini, "-s", "--"]),
            "/bin/sh",
            "-c",
            `mount -t tmpfs none /proc && exec ${runner}`,
          ]
        : ["/bin/sh", "-c", runner];
    const run = spawnSync(argv[0]!, argv.slice(1), {
      cwd: work,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.notEqual(run.signal, "SIGTERM", "the engine run was not cut by the timeout");
    assert.equal(run.status, 0, `the engine run ended on its own (stderr: ${run.stderr ?? ""})`);
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    assert.match(out, /pass 1 was terminated by the watchdog/, "the hung pass was killed");
    assert.match(out, /pass 2\/30/, "the loop went on to a second pass");
    if (canHide === 0) {
      // The hostile regime held: no table read answered — the tree of the killed
      // pass is empty — and the pass was ended anyway: by the sender, which no
      // longer reads a dead table as a dead process, or by the engine's own
      // handle, its last rung when the sender does refuse.
      assert.match(out, /0 processes in the tree/, "the table answered nothing");
    }
    assert.match(out, /ENGINE-EXIT 0/, "the phase finished approved");
    assert.equal(readFileSync(join(work, "pass-count.txt"), "utf8"), "2", "two passes ran");
    rmSync(dir, { recursive: true, force: true });
  },
);
