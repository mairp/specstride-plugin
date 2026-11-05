/**
 * T007 — characterization test CT-146-14 of the bounded probe runner
 * (F146-FR-014; F146-SC-003): standard input closed, a time limit, a cap on
 * output, no terminal, parallel runs. A failed probe yields null and a
 * finding and never makes discovery itself fail, so that only the reader of
 * a harness that plays a role of the run can fail the launch. With one
 * probe that never ends among twenty, the run ends within the limit plus
 * one second.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  defaultSpawn,
  loadProbeLimits,
  runProbes,
  type ProbeLimits,
  type ProbeProcess,
  type ProbeRequest,
} from "../../src/discovery/probes/runner.ts";

const NODE = process.execPath;

/** A probe that ends at once with the text on its standard output. */
function echo(text: string): ProbeRequest {
  return { id: "probe", file: NODE, args: ["-e", `process.stdout.write(${JSON.stringify(text)})`] };
}

/** A probe that never ends. */
function hangs(ms: number): ProbeRequest {
  return { id: "probe", file: NODE, args: ["-e", `setTimeout(() => {}, ${ms})`] };
}

test("CT-146-14: standard input is closed, and no probe holds a terminal", async () => {
  const limits = { ...loadProbeLimits(), processTimeLimitMs: 3000 };
  // stdin closed: the probe reads an end of file from standard input, and
  // holds a null device there — never a pipe back to whoever started it.
  const stdinProbe: ProbeRequest = {
    id: "stdin",
    file: NODE,
    args: [
      "-e",
      [
        "const fs = require('fs')",
        "const s = fs.fstatSync(0)",
        "const read = fs.readFileSync(0)",
        "console.log(JSON.stringify(" + "[s.isCharacterDevice(), s.isFIFO(), read.length]))",
      ].join(";"),
    ],
  };
  // No terminal: no standard stream of the probe is a TTY.
  const ttyProbe: ProbeRequest = {
    id: "tty",
    file: NODE,
    args: [
      "-e",
      "console.log(JSON.stringify(" +
        "[process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY]))",
    ],
  };
  const results = await runProbes([stdinProbe, ttyProbe], { limits });
  assert.equal(results.length, 2);
  assert.equal(results[0]?.finding, null);
  assert.deepEqual(JSON.parse(results[0]?.value ?? ""), [true, false, 0]);
  assert.deepEqual(JSON.parse(results[1]?.value ?? ""), [null, null, null]);
});

test("CT-146-14: the default port starts no shell, with closed input and no terminal", async () => {
  // The bounds are in the one place the port is written: pinned here so a
  // change of them is seen by this test and not only by a probe.
  const source = await readFile(
    fileURLToPath(new URL("../../src/discovery/probes/runner.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /stdio:\s*\["ignore",\s*"pipe",\s*"pipe"\]/);
  assert.match(source, /shell:\s*false/);
  // And the port really answers with the three questions of the runner.
  const probe = defaultSpawn({ id: "trace", file: NODE, args: ["-e", "process.exit(0)"] });
  let exited: number | null | undefined;
  probe.onExit((code) => {
    exited = code;
  });
  probe.onStartError(() => {});
  probe.endInput();
  // The child answers when it answers; under a loaded host starting node can
  // take longer than one fixed sleep, so wait for the exit itself, bounded.
  for (let waitedMs = 0; exited === undefined && waitedMs < 5000; waitedMs += 50) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(exited, 0);
  probe.kill();
  const result = await runProbes([echo("probe-146")], {
    limits: { ...loadProbeLimits(), processTimeLimitMs: 3000 },
  });
  assert.equal(result[0]?.value, "probe-146");
});

test("CT-146-14: a probe over its time limit yields null and a finding", async () => {
  const startedAt = Date.now();
  const results = await runProbes([hangs(30_000)], {
    limits: { ...loadProbeLimits(), processTimeLimitMs: 300 },
  });
  const waited = Date.now() - startedAt;
  assert.equal(results[0]?.value, null);
  assert.equal(results[0]?.finding?.code, "probe-time-limit");
  assert.equal(results[0]?.finding?.probe, "probe");
  // The limit ended it, and did not wait for the thirty seconds.
  assert.ok(waited < 30_000, `the run waited ${waited}ms for a hung probe`);
});

test("CT-146-14: output past the cap is cut, and the value is null", async () => {
  const bigProbe: ProbeRequest = {
    id: "big",
    file: NODE,
    args: ["-e", "process.stdout.write('x'.repeat(200_000))"],
  };
  const results = await runProbes([bigProbe], {
    limits: { ...loadProbeLimits(), outputCapBytes: 4096, processTimeLimitMs: 3000 },
  });
  assert.equal(results[0]?.value, null);
  assert.equal(results[0]?.finding?.code, "probe-output-cap");
});

test("CT-146-14: probes run in parallel, at most `parallel` at once", async () => {
  // A traced port: twenty probes of two hundred milliseconds each. At most
  // eight hold a process at the same time, and the run is far shorter than
  // twenty times two hundred milliseconds.
  const limits: ProbeLimits = {
    processTimeLimitMs: 3000,
    requestTimeLimitMs: 3000,
    outputCapBytes: 65_536,
    parallel: 8,
    stdin: "closed",
    terminal: "none",
  };
  let inFlight = 0;
  let maxInFlight = 0;
  const spawn = (_request: ProbeRequest): ProbeProcess => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const timer = setTimeout(() => {
      inFlight -= 1;
      stdout.end("ok");
      stderr.end();
      emitter.emit("exit", 0, null);
    }, 200);
    return {
      stdout,
      stderr,
      endInput: () => {},
      kill: () => {
        clearTimeout(timer);
        inFlight -= 1;
        stdout.end();
        stderr.end();
        emitter.emit("exit", null, "SIGKILL");
      },
      onExit: (callback) => {
        emitter.on("exit", (code, signal) => callback(code, signal));
      },
      onStartError: (callback) => {
        emitter.on("error", (error: Error) => callback(error));
      },
    };
  };
  const requests = Array.from({ length: 20 }, (_, i) => ({
    id: `probe-${i}`,
    file: "no-file-is-started",
    args: [],
  }));
  const startedAt = Date.now();
  const results = await runProbes(requests, { limits, spawn });
  const waited = Date.now() - startedAt;
  assert.equal(results.length, 20);
  assert.ok(results.every((r) => r.finding === null && r.value === "ok"));
  assert.ok(maxInFlight <= 8, `at most 8 probes at once, saw ${maxInFlight}`);
  assert.ok(maxInFlight > 1, "the probes ran in parallel");
  assert.ok(waited < 20 * 200, `the run was not parallel: ${waited}ms`);
});

test("CT-146-14: a failed probe yields null and a finding, and never fails the run", async () => {
  const limits = { ...loadProbeLimits(), processTimeLimitMs: 3000 };
  const results = await runProbes(
    [
      { id: "no-such-file", file: "no-such-executable-146", args: [] },
      { id: "exit-1", file: NODE, args: ["-e", "process.exit(1)"] },
      { id: "stderr", file: NODE, args: ["-e", "console.error('boom'); process.exit(2)"] },
      echo("still fine"),
    ],
    { limits },
  );
  assert.equal(results[0]?.value, null);
  assert.equal(results[0]?.finding?.code, "probe-failed");
  assert.equal(results[1]?.value, null);
  assert.equal(results[1]?.finding?.code, "probe-failed");
  assert.equal(results[2]?.finding?.code, "probe-failed");
  assert.equal(results[3]?.finding, null);
  assert.equal(results[3]?.value, "still fine");
});

test("CT-146-14: one probe that never ends among twenty, inside the limit plus a second", async () => {
  // A generous limit: the machine under the test is loaded (other lanes run
  // their suites on the same host), and the characterization is of the bound,
  // not of the speed of this host. The nineteen answering probes use
  // /bin/echo, which starts in milliseconds, so that a loaded host cannot
  // push an answering probe past the limit and turn the bound into a race.
  const limits = { ...loadProbeLimits(), processTimeLimitMs: 5000 };
  const ECHO = "/bin/echo";
  const requests = [
    hangs(30_000),
    ...Array.from({ length: 19 }, (_, i) => ({
      id: `probe-${i}`,
      file: ECHO,
      args: [`candidate-${i}`],
    })),
  ];
  const startedAt = Date.now();
  const results = await runProbes(requests, { limits });
  const waited = Date.now() - startedAt;
  assert.equal(results.length, 20);
  assert.ok(results.every((r) => r.finding !== null || r.value !== null));
  assert.equal(results[0]?.finding?.code, "probe-time-limit");
  assert.equal(results[0]?.value, null);
  const answered = results.slice(1);
  assert.ok(answered.every((r) => r.finding === null && r.value !== null));
  // F146-SC-003: the run ends no later than one second after the limit.
  assert.ok(
    waited <= limits.processTimeLimitMs + 1000,
    `the run took ${waited}ms for a ${limits.processTimeLimitMs}ms limit`,
  );
});
