/**
 * T008 (feature 112) — CT-112-107 (F112-FR-007): the bounds of the runner.
 * A subprocess runs with stdin closed, a 5 s limit, a 64 KiB output cap and an
 * ended process group; probes run in parallel; a probe over its limit gives a
 * warning `probe timed out`; `--quick` skips the subprocess and network checks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  runDoctorChecks,
  makeProbeBag,
  makeSubprocessRunner,
  PROBE_TIME_LIMIT_MS,
  SUBPROCESS_OUTPUT_CAP_BYTES,
} from "../src/runner/run.ts";
import type { Check, ProbeBag, Severity } from "../src/registry/types.ts";

const NODE = process.execPath;

test("CT-112-107: the subprocess runner closes stdin, cuts output at 64 KiB and ends the group", async () => {
  // A generous bound: the claim of this block is the output cap and the
  // closed stdin, not the clock; a loaded host starts `node -e` slowly, and
  // a too-tight limit here would kill the child before it writes (seen as a
  // false `truncated` under a loaded full-suite run).
  const runner = makeSubprocessRunner({ timeLimitMs: 20_000 });

  // stdin closed: `cat` with no arguments reads its standard input and ends at
  // end-of-file. With stdin closed it exits at once instead of hanging.
  const cat = await runner.run("cat", []);
  assert.equal(cat.timedOut, false);
  assert.equal(cat.code, 0);

  // Output cap: more than 64 KiB printed is cut at the cap and marked.
  const big = await runner.run(NODE, [
    "-e",
    `process.stdout.write("x".repeat(${String(SUBPROCESS_OUTPUT_CAP_BYTES * 2)}))`,
  ]);
  assert.equal(big.truncated, true);
  assert.ok(Buffer.byteLength(big.stdout, "utf8") <= SUBPROCESS_OUTPUT_CAP_BYTES);
  assert.equal(big.timedOut, false);

  // Ended process group: a child that spawns a grandchild of its own (same
  // process group, not detached) is gone with its group at the time limit;
  // nothing is left running afterwards.
  const slow = makeSubprocessRunner({ timeLimitMs: 150 });
  const hung = await slow.run(NODE, [
    "-e",
    "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)",
  ]);
  assert.equal(hung.timedOut, true);
  // Give the ended group a moment to be reaped, then look for survivors.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const leftovers = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" }).includes(
    "setInterval(()=>{},1000)",
  );
  // The grandchild was in the ended group; it did not survive the kill.
  assert.equal(leftovers, false);
});

test("CT-112-107: probes run in parallel, not one after another", async () => {
  let running = 0;
  let maxRunning = 0;
  const slowCheck = (id: string): Check => ({
    id,
    group: "env",
    lb: false,
    order: 1,
    messageTemplate: `${id} {state}`,
    fixHint: "fix",
    severityRule: () => "ok" as Severity,
    probe: async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 50));
      running -= 1;
      return { state: "done" };
    },
  });
  await runDoctorChecks({
    checks: [slowCheck("p.one"), slowCheck("p.two"), slowCheck("p.three")],
    bag: makeProbeBag(),
  });
  assert.ok(maxRunning >= 2, `probes overlapped (max concurrent ${String(maxRunning)})`);
});

test("CT-112-107: a probe over its time limit gives the warning `probe timed out`", async () => {
  const bag = makeProbeBag({ timeLimitMs: 100 });
  assert.equal(bag.timeLimitMs, 100);
  assert.equal(PROBE_TIME_LIMIT_MS, 5_000);
  const hanging: Check = {
    id: "hang.one",
    group: "env",
    lb: false,
    order: 1,
    messageTemplate: "never {state}",
    fixHint: "wait less",
    severityRule: () => "ok" as Severity,
    probe: () => new Promise(() => {}),
  };
  const result = await runDoctorChecks({ checks: [hanging], bag });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, "warn");
  assert.equal(result.findings[0].message, "probe timed out");
  assert.equal(result.exit, 0);
});

test("CT-112-107: `--quick` skips the subprocess and network checks", async () => {
  let subprocessCalls = 0;
  let networkCalls = 0;
  const bag = makeProbeBag({
    quick: true,
    subprocess: {
      run: () => {
        subprocessCalls += 1;
        return Promise.resolve({
          code: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
        });
      },
    },
    network: {
      get: () => {
        networkCalls += 1;
        return Promise.resolve({ status: 200, body: "" });
      },
    },
  });
  assert.equal(bag.quick, true);
  const subprocessCheck: Check = {
    id: "quick.sub",
    group: "cli",
    lb: false,
    order: 1,
    messageTemplate: "sub {code}",
    fixHint: "fix",
    severityRule: (observed: unknown) =>
      (observed as { code?: number | null })["code"] === null ? "ok" : ("warn" as Severity),
    probe: async (injected: Readonly<Record<string, unknown>>) => {
      const result = await (injected as unknown as ProbeBag).subprocess.run("true", []);
      return result.skipped === true ? undefined : { code: result.code };
    },
  };
  const networkCheck: Check = {
    id: "quick.net",
    group: "model",
    lb: false,
    order: 2,
    messageTemplate: "net {status}",
    fixHint: "fix",
    severityRule: () => "ok" as Severity,
    probe: async (injected: Readonly<Record<string, unknown>>) => {
      const seen = await (injected as unknown as ProbeBag).network.get("https://example.invalid/");
      return seen.status === 0 ? undefined : { status: seen.status };
    },
  };
  const result = await runDoctorChecks({ checks: [subprocessCheck, networkCheck], bag });
  assert.equal(subprocessCalls, 0, "no subprocess ran under --quick");
  assert.equal(networkCalls, 0, "no network call ran under --quick");
  assert.equal(result.findings.length, 0);
  assert.equal(result.exit, 0);
});
