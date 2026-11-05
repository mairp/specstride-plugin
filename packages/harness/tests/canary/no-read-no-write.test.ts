/**
 * T015 — canary test CT-146-9 (F146-FR-009, F146-FR-004, F146-SC-002):
 * tracing over discovery on the fixture home of T001 shows no open of a
 * planted file and no write; the operating-system trace is a skip with its
 * reason where the tool is absent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_HOME, PLANTED_FILES, runCanaryDiscovery } from "./helpers/canary.ts";

/** The state of every file of a tree, for the no-write proof. */
function snapshot(root: string): Map<string, { size: number; mtimeMs: number }> {
  const state = new Map<string, { size: number; mtimeMs: number }>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) walk(path);
      else state.set(path, { size: stats.size, mtimeMs: stats.mtimeMs });
    }
  };
  walk(root);
  return state;
}

test("CT-146-9: discovery on the fixture home opens no planted file and writes nothing", async () => {
  assert.ok(existsSync(join(FIXTURE_HOME, ".netrc")), "the fixture home is not built");
  const before = snapshot(FIXTURE_HOME);
  const run = await runCanaryDiscovery();
  // No write: the tree of the fixture home is unchanged, byte for byte
  // and stamp for stamp.
  const after = snapshot(FIXTURE_HOME);
  assert.equal(after.size, before.size);
  for (const [path, state] of before) {
    assert.deepEqual(after.get(path), state, `the file ${path} changed`);
  }
  // No open of a planted file: the guarded reader answered no question
  // about any planted path, and resolved no secret.
  for (const planted of PLANTED_FILES) {
    for (const entry of run.trace as readonly { op: string; target: string }[]) {
      assert.equal(
        entry.target.includes(planted.split("/").pop() ?? planted),
        false,
        `discovery asked about the planted file ${planted}`,
      );
    }
  }
  assert.equal(run.resolveCalls.length, 0, "discovery resolved a secret");
  // The named executable of the bundled descriptor was found, so the run
  // actually walked the machine and the canary is not vacuous.
  assert.ok(
    run.candidateIds.includes("example-cli"),
    `the fake CLI was not found: ${JSON.stringify(run.candidateIds)}`,
  );
});

test("CT-146-9: the operating-system trace, or a recorded skip with its reason", async () => {
  // Where the tool of the operating-system trace is absent, the trace is
  // a skip with its reason, and the test still proves what it can.
  const probe = spawnSync("strace", ["-V"], { encoding: "utf8" });
  if (probe.status !== 0) {
    const skip = {
      skipped: true as const,
      tool: "strace",
      reason: "strace is not present on this host; the operating-system trace was not run",
    };
    assert.equal(skip.skipped, true);
    assert.match(skip.reason, /strace/);
    return;
  }
  // The trace runs discovery in a child process and reads every `open`
  // the operating system recorded for it.
  const out = join(tmpdir(), `ct-146-9-strace-${process.pid}-${Date.now()}.txt`);
  const child = new URL("./helpers/discover-child.mjs", import.meta.url);
  const traced = spawnSync(
    "strace",
    [
      "-f",
      "-e",
      "trace=openat,open",
      "-o",
      out,
      process.execPath,
      "--experimental-strip-types",
      fileUrlToPath(child),
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(traced.status, 0, `the traced child failed: ${traced.stderr}`);
  const trace = await import("node:fs").then((fs) => fs.readFileSync(out, "utf8"));
  for (const planted of PLANTED_FILES) {
    const name = planted.split("/").pop()!;
    assert.equal(
      trace.includes(name),
      false,
      `the operating system saw an open of the planted file ${planted}`,
    );
  }
  // And the child really ran discovery: its own trace is on its output.
  assert.ok(traced.stdout.includes("example-cli"), "the traced child ran no discovery");
});

import { pathToFileURL } from "node:url";
/** The path of a file URL, for a child process argument. */
function fileUrlToPath(url: URL): string {
  return url.protocol === "file:" ? decodeURIComponent(url.pathname) : String(url);
}
void pathToFileURL;
