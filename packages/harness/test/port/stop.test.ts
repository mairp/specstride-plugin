/**
 * T022 — CT-109-12: `stop` and `betweenPasses` on the process primitive of
 * the kernel (F109-FR-012).
 *
 * Every process of a harness starts in a process group of its own (observed
 * from INSIDE the child, through `/proc/self/stat`, and from outside through
 * the identity the primitive returns); `stop` takes its three modes and
 * reports whether the process ended; `betweenPasses` returns its three
 * outcomes and reads a failure as `continue`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processPrimitive } from "@specstride/kernel";
import {
  BETWEEN_PASSES_OUTCOMES,
  STOP_MODES,
  betweenPasses,
  resultCodeOf,
  startInOwnGroup,
  stopProcess,
} from "../../src/port/stop.ts";

/** The child script: it reports its own pid and process group, then sleeps. */
const CHILD_REPORT = `
const fs = require("node:fs");
const stat = fs.readFileSync("/proc/self/stat", "utf8");
const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(" ")[3]);
console.log(JSON.stringify({ pid: process.pid, pgrp }));
setInterval(() => {}, 1000);
`;

/** The child ignores SIGTERM and SIGINT, so only the final mode can end it. */
const CHILD_STUBBORN = `
process.on("SIGTERM", () => { console.log("ignored SIGTERM"); });
process.on("SIGINT", () => { console.log("ignored SIGINT"); });
console.log("started");
setInterval(() => {}, 1000);
`;

const CHILD_POLITE = `
console.log("started");
process.on("SIGINT", () => { process.exit(0); });
setInterval(() => {}, 1000);
`;

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-109-12-"));
}

async function start(
  script: string,
  dir: string,
): Promise<{
  pid: number;
  pgid: number;
  stdoutFile: string;
}> {
  const stdoutFile = join(dir, `out-${Math.random().toString(36).slice(2)}.txt`);
  const started = await startInOwnGroup(processPrimitive, {
    argv: [process.execPath, "-e", script],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "/usr/bin" },
    stdoutFile,
  });
  return { pid: started.pid, pgid: started.pgid, stdoutFile };
}

async function readReport(file: string): Promise<{ pid: number; pgrp: number }> {
  const line = await waitForLine(file, "{");
  return JSON.parse(line);
}

/** Wait until the child has written `marker`, so its signal handlers are up. */
async function waitForLine(file: string, marker: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const text = readFileSync(file, "utf8").trim();
      const line = text.split("\n").find((entry) => entry.includes(marker));
      if (line !== undefined) {
        return line;
      }
    } catch {
      // the child has not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the child never wrote a line with "${marker}"`);
}

test("CT-109-12: every process of a harness starts in a process group of its own", async () => {
  const dir = workdir();
  try {
    const started = await start(CHILD_REPORT, dir);
    // The primitive reports a group of its own: the group id IS the process id.
    assert.equal(started.pgid, started.pid);
    // An independent read path: the CHILD reads its own group from
    // /proc/self/stat, and it agrees.
    const report = await readReport(started.stdoutFile);
    assert.equal(report.pid, started.pid);
    assert.equal(report.pgrp, started.pid, "the child sits in the group of its own pid");
    // The harness stops the process it started: the group is signalled again.
    const stopped = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "terminate",
      timeoutMs: 5_000,
    });
    assert.equal(stopped.ended, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-109-12: `stop` takes exactly the three modes of the closed set", () => {
  assert.deepEqual([...STOP_MODES], ["polite", "terminate", "kill"]);
});

test("CT-109-12: `stop` with `terminate` ends a process that does not hold the signal, and reports it ended", async () => {
  const dir = workdir();
  try {
    const started = await start(CHILD_REPORT, dir);
    const result = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "terminate",
      timeoutMs: 5_000,
    });
    assert.equal(result.mode, "terminate");
    assert.equal(result.ended, true, "the process ended");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-109-12: `stop` with `polite` ends a process that takes the interrupt", async () => {
  const dir = workdir();
  try {
    const started = await start(CHILD_POLITE, dir);
    await waitForLine(started.stdoutFile, "started");
    const result = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "polite",
      timeoutMs: 5_000,
    });
    assert.equal(result.mode, "polite");
    assert.equal(result.ended, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-109-12: `stop` with `kill` ends a process that holds terminate, and reports it ended", async () => {
  const dir = workdir();
  try {
    const started = await start(CHILD_STUBBORN, dir);
    await waitForLine(started.stdoutFile, "started");
    // First the weaker mode: the stubborn child holds it.
    const weaker = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "terminate",
      timeoutMs: 500,
    });
    assert.equal(weaker.ended, false, "the stubborn process did NOT end on terminate");
    // Then the final mode ends it.
    const final = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "kill",
      timeoutMs: 5_000,
    });
    assert.equal(final.mode, "kill");
    assert.equal(final.ended, true, "the process ended under the final mode");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-109-12: a mode outside the closed set is read as `terminate`", async () => {
  const dir = workdir();
  try {
    const started = await start(CHILD_REPORT, dir);
    await readReport(started.stdoutFile);
    const result = await stopProcess({
      primitive: processPrimitive,
      pid: started.pid,
      pgid: started.pgid,
      mode: "gently-please" as string,
      timeoutMs: 5_000,
    });
    assert.equal(result.mode, "terminate", "the unknown mode read as terminate");
    assert.equal(result.ended, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-109-12: `betweenPasses` returns its three outcomes and their result codes", async () => {
  assert.deepEqual([...BETWEEN_PASSES_OUTCOMES], ["continue", "stop:4", "stop:7"]);
  assert.equal(resultCodeOf("continue"), null);
  assert.equal(resultCodeOf("stop:4"), 4);
  assert.equal(resultCodeOf("stop:7"), 7);

  const input = { pid: 1, sessionId: "s", result: "ok", workdir: "/tmp" };
  assert.equal(await betweenPasses(() => "continue", input), "continue");
  assert.equal(await betweenPasses(() => "stop:4", input), "stop:4");
  assert.equal(await betweenPasses(() => "stop:7", input), "stop:7");
  assert.equal(
    await betweenPasses(() => ({ stop: 4 }), input),
    "stop:4",
    "a result record reads too",
  );
  assert.equal(await betweenPasses(() => 7, input), "stop:7");
});

test("CT-109-12: a failure of `betweenPasses` — a throw or an unknown value — is read as `continue`", async () => {
  const input = { pid: 1, sessionId: "s", result: "failed", workdir: "/tmp" };
  assert.equal(
    await betweenPasses(() => {
      throw new Error("the between-passes handler failed");
    }, input),
    "continue",
  );
  assert.equal(await betweenPasses(() => "who-knows", input), "continue");
  assert.equal(await betweenPasses(() => 5, input), "continue");
  assert.equal(await betweenPasses(() => null, input), "continue");
  assert.equal(await betweenPasses(() => Promise.reject(new Error("rejected")), input), "continue");
});
