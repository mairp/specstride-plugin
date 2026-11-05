/**
 * The recovery wiring of the engine (step 2): a rejection whose unmet set
 * changed is diagnosed by the real diagnostician (one call per signature,
 * F101-FR-021), the hint it writes drives the attempt planner, the attempt
 * after the diagnosis runs ACCELERATED through the real accelerator with a
 * narrowed prompt (only the failed criterion, F101-FR-025/F101-FR-026), the
 * tree check turns an accelerated retry on a tree that changed since the
 * diagnosis into a plain attempt, and an approval counts only while the
 * commit it produced is still part of the history of the workspace.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { runFeature, workingTreeFingerprint } from "../../src/engine/run-feature.ts";

/**
 * The stub of `claude`. Three call kinds meet it: the proposer pass, the
 * critic call (a VERDICT with a nonce), and the call of the diagnostician (no
 * nonce, no verdict — the case and the hint). The critic rejects the first
 * `rejections` calls naming T001, and approves the rest. Its rejection carries
 * the unmet report the critic prompt asks for — one status line per task —
 * unless `form` is "prose", the critic that writes no such line.
 */
const STUB = (
  rejections: number,
  form: "status" | "prose" = "status",
): string => `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (prompt.startsWith("# Diagnostician")) {
  fs.appendFileSync("diag-calls.txt", "call\\n");
  fs.writeFileSync("seen-by-diagnostician.txt", prompt);
  console.log(JSON.stringify({ type: "result", result: "CASE: GROUNDING\\nWrite the missing test of T001 before the code." }));
} else if (critic) {
  fs.writeFileSync("seen-by-critic.txt", prompt);
  // The demand closes the prompt; the change above it can quote older nonce
  // demands through the untracked logs of the fixture, so the LAST match is
  // the one this call must answer.
  const nonce = [...prompt.matchAll(/VERDICT ([0-9a-f]+): APPROVED/g)].pop()?.[1];
  const seen = Number(fs.existsSync("../critic-count.txt") ? fs.readFileSync("../critic-count.txt", "utf8") : "0") + 1;
  fs.writeFileSync("../critic-count.txt", String(seen));
  const verdict = seen <= ${String(rejections)} ? "REJECTED" : "APPROVED";
  let report;
  if (verdict === "APPROVED") report = "T001: MET\\nT002: MET\\n";
  else if (${JSON.stringify(form === "status")}) report = "T001: UNMET the test was not run.\\nT002: MET\\n";
  else report = "T001 is not met: the test was not run.\\n";
  console.log(JSON.stringify({ type: "result", result: report + "VERDICT " + nonce + ": " + verdict }));
} else {
  fs.appendFileSync("prompt-log.txt", prompt + "\\n---PASS---\\n");
  const evidence = /write (\\.specstride\\S+?):/i.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  fs.writeFileSync("made.txt", "work\\n");
  const tasks = "specs/001-one/tasks.md";
  fs.writeFileSync(tasks, fs.readFileSync(tasks, "utf8").replace("[ ]", "[x]"));
  console.log(JSON.stringify({ type: "result", result: "ok" }));
}
`;

const TASKS = "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n- [ ] T002 Also do it\n";

function fixture(
  rejections: number,
  form: "status" | "prose" = "status",
): {
  readonly dir: string;
  readonly home: string;
  readonly restore: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "specstride-recovery-"));
  const bin = join(dir, "bin");
  const work = join(dir, "work");
  mkdirSync(bin);
  mkdirSync(join(work, "specs", "001-one"), { recursive: true });
  writeFileSync(join(bin, "claude"), STUB(rejections, form));
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(join(work, "specs", "001-one", "tasks.md"), TASKS);
  for (const argv of [
    ["init", "-q"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
    ["add", "-A"],
    ["commit", "-qm", "init"],
  ]) {
    spawnSync("git", ["-C", work, ...argv]);
  }
  const before = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = dir;
  process.env.PATH = `${bin}:${before.PATH ?? ""}`;
  return {
    dir: work,
    home: dir,
    restore: () => {
      process.env.HOME = before.HOME;
      process.env.PATH = before.PATH;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const controlRootOf = (home: string, workdir: string): string =>
  join(
    home,
    ".specstride",
    "workspaces",
    createHash("sha256").update(workdir).digest("hex").slice(0, 16),
  );

const commits = (dir: string): number =>
  Number(spawnSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).stdout);

const eventsOf = (home: string, workdir: string): { type: string; data: unknown }[] => {
  const runs = join(controlRootOf(home, workdir), "runs");
  const out: { type: string; data: unknown }[] = [];
  for (const run of existsSync(runs) ? readdirSync(runs) : []) {
    const path = join(runs, run, "events.jsonl");
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      out.push(JSON.parse(line) as { type: string; data: unknown });
    }
  }
  return out;
};

const withEnv = async (
  values: Record<string, string | undefined>,
  body: () => Promise<void>,
): Promise<void> => {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    await body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test("a phase that fails the same criterion twice is diagnosed once, the next attempt is accelerated and narrowed, and the third is plain with the hint", async () => {
  await withEnv({ SPECSTRIDE_PROPOSER_PAUSE_SEC: "0" }, async () => {
    const { dir, home, restore } = fixture(2);
    try {
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
      const prompts = log.split("---PASS---\n").filter((part) => part !== "");
      // Three attempts, one pass each: plain, accelerated, plain.
      assert.equal(prompts.length, 3);
      // One call of the diagnostician for the one signature (F101-FR-021).
      assert.equal(readFileSync(join(dir, "diag-calls.txt"), "utf8"), "call\n");
      // The accelerated attempt: the narrowed prompt of the accelerator — the
      // hint as its first instruction, only the unmet task's line, the
      // footprint rule — and neither of the other two prompts looks like it.
      const accelerated = prompts.filter((part) =>
        part.includes("Change as little as the unmet criteria need"),
      );
      assert.equal(accelerated.length, 1, "exactly one accelerated attempt");
      assert.match(accelerated[0] as string, /Write the missing test of T001/);
      assert.match(accelerated[0] as string, /- \[ \] T001 Do it/);
      // The met task may be named by the feedback the prompt quotes (the
      // critic's own `T002: MET` line); its TASK line is what must be absent.
      assert.doesNotMatch(accelerated[0] as string, /- \[ \] T002/);
      // The plain attempt after it carries the hint and the whole section.
      assert.match(prompts[2] as string, /# The hint of the diagnostician/);
      assert.match(prompts[2] as string, /- \[ \] T002 Also do it/);
      // The cycle's records were written and, at the approval, set aside
      // (F101-FR-033): markers, hint, diagnosis, note and snapshot.
      const aside = join(controlRootOf(home, dir), "features", "001-one", "set-aside", "phase1");
      const markers = JSON.parse(readFileSync(join(aside, "recovery", "markers.json"), "utf8")) as {
        diagnosed: string | null;
        accelerated: string | null;
      };
      assert.equal(markers.diagnosed, "T001");
      assert.equal(markers.accelerated, "T001");
      const hint = readFileSync(join(aside, "recovery", "hint.md"), "utf8");
      assert.match(hint, /# Phase 1 — diagnostician hint \(attempt 1\)/);
      assert.match(hint, /Write the missing test of T001/);
      const diagnosis = JSON.parse(
        readFileSync(join(aside, "recovery", "diagnosis.json"), "utf8"),
      ) as { signature: string; treeFingerprint: string };
      assert.equal(diagnosis.signature, "T001");
      assert.match(diagnosis.treeFingerprint, /^[0-9a-f]{40}$/);
      const note = readFileSync(join(aside, "recovery", "acceleration.md"), "utf8");
      assert.match(note, /# Phase 1 — accelerator pass \(attempt 2\)/);
      assert.match(note, /criteria: T001/);
      const snapshot = JSON.parse(
        readFileSync(join(aside, "recovery", "accelerator-snapshot.json"), "utf8"),
      ) as {
        readonly attemptId: string;
        readonly after: { readonly newFiles: readonly string[] };
      };
      assert.equal(snapshot.attemptId, "e1-a2");
      // The evidence the pass wrote lies under the engine's own excluded
      // directory, so the two fixed-argv calls of the version-control tool
      // cannot name it; the files git does see are recorded in the halves.
      assert.ok(
        (snapshot.after.newFiles ?? []).some((name) => name === "prompt-log.txt"),
        "the after half names the untracked files the pass left",
      );
      // The as-is events of the cycle are in the run's stream.
      const types = eventsOf(home, dir).map((event) => event.type);
      for (const name of [
        "diagnostician_trigger",
        "diagnostician_start",
        "diagnostician_done",
        "accelerator_start",
        "acceleration_note",
      ]) {
        assert.ok(types.includes(name), `the events hold ${name}`);
      }
      // The phase ended approved, ticked and committed at the third attempt.
      assert.match(readFileSync(join(dir, "specs", "001-one", "tasks.md"), "utf8"), /- \[x\] T001/);
      assert.equal(commits(dir), 2);
    } finally {
      restore();
    }
  });
});

test("a critic that writes no status line widens the retry to every task, and the engine says so in an event", async () => {
  await withEnv({ SPECSTRIDE_PROPOSER_PAUSE_SEC: "0" }, async () => {
    const { dir, home, restore } = fixture(2, "prose");
    try {
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
      const prompts = log.split("---PASS---\n").filter((part) => part !== "");
      // Three attempts, one pass each: plain, accelerated (widened), plain.
      assert.equal(prompts.length, 3);
      const accelerated = prompts.filter((part) =>
        part.includes("Change as little as the unmet criteria need"),
      );
      assert.equal(accelerated.length, 1, "exactly one accelerated attempt");
      // The form cannot be read, so the honest widening: the whole phase.
      assert.match(accelerated[0] as string, /- \[ \] T001 Do it/);
      assert.match(accelerated[0] as string, /- \[ \] T002 Also do it/);
      // And the run says so, once per rejection that could not be read.
      const fallbacks = eventsOf(home, dir).filter(
        (event) => event.type === "recovery.unmet-report-fallback",
      );
      assert.equal(fallbacks.length, 2, "one fallback event per unread rejection");
      assert.deepEqual(fallbacks[1]?.data, {
        phase: 1,
        attempt: 2,
        criteria: "T001,T002",
        fallback: "all-tasks",
      });
    } finally {
      restore();
    }
  });
});

test("the accelerator is off: the attempt after the diagnosis runs plain, with the hint in its prompt", async () => {
  await withEnv(
    { SPECSTRIDE_PROPOSER_PAUSE_SEC: "0", SPECSTRIDE_ACCELERATOR: "false" },
    async () => {
      const { dir, restore } = fixture(1);
      try {
        assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
        const prompts = readFileSync(join(dir, "prompt-log.txt"), "utf8")
          .split("---PASS---\n")
          .filter((part) => part !== "");
        assert.equal(prompts.length, 2);
        assert.doesNotMatch(prompts.join(""), /Change as little as the unmet criteria need/);
        assert.match(prompts[1] as string, /# The hint of the diagnostician/);
        assert.match(prompts[1] as string, /- \[ \] T002 Also do it/);
        assert.equal(readFileSync(join(dir, "diag-calls.txt"), "utf8"), "call\n");
      } finally {
        restore();
      }
    },
  );
});

test("an accelerated retry on a tree that changed since the diagnosis runs plain instead, and says so", async () => {
  await withEnv({ SPECSTRIDE_PROPOSER_PAUSE_SEC: "0" }, async () => {
    const { dir, home, restore } = fixture(0);
    try {
      // The state a previous engine start left: a diagnosis of T001 whose
      // tree fingerprint no longer fits the tree, with its hint and feedback.
      const feature = join(controlRootOf(home, dir), "features", "001-one");
      mkdirSync(join(feature, "recovery", "phase1"), { recursive: true });
      writeFileSync(
        join(feature, "recovery", "phase1", "markers.json"),
        JSON.stringify({
          schema: "specstride.recovery-markers/1",
          phase: 1,
          diagnosed: "T001",
          accelerated: null,
        }),
      );
      writeFileSync(
        join(feature, "recovery", "phase1", "hint.md"),
        "# Phase 1 — diagnostician hint (attempt 1)\n\n> This is not a critic verdict.\n\nCASE: GROUNDING\nWrite the missing test of T001.\n",
      );
      writeFileSync(
        join(feature, "recovery", "phase1", "diagnosis.json"),
        JSON.stringify({
          phase: 1,
          ordinal: 1,
          signature: "T001",
          treeFingerprint: "0123456789012345678901234567890123456789",
          at: "2026-11-02T00:00:00.000Z",
        }),
      );
      mkdirSync(join(feature, "feedback"), { recursive: true });
      writeFileSync(
        join(feature, "feedback", "phase1.1.md"),
        "T001 is not met: the test was not run.\n",
      );
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      const prompts = readFileSync(join(dir, "prompt-log.txt"), "utf8")
        .split("---PASS---\n")
        .filter((part) => part !== "");
      assert.equal(prompts.length, 1, "one attempt, one pass");
      assert.doesNotMatch(prompts[0] as string, /Change as little as the unmet criteria need/);
      assert.match(prompts[0] as string, /You are implementing phase 1/);
      const types = eventsOf(home, dir).map((event) => event.type);
      assert.ok(types.includes("recovery.stale-diagnosis"), "the stale diagnosis is an event");
    } finally {
      restore();
    }
  });
});

test("the fingerprint of the working tree: it sees unstaged change that git write-tree alone does not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "specstride-fingerprint-"));
  try {
    // An initial file, so the initial commit has something to hold.
    writeFileSync(join(dir, "tasks.md"), "one task\n");
    for (const argv of [
      ["init", "-q"],
      ["config", "user.email", "t@t"],
      ["config", "user.name", "t"],
      ["add", "-A"],
      ["commit", "-qm", "init"],
    ]) {
      spawnSync("git", ["-C", dir, ...argv]);
    }
    const before = workingTreeFingerprint(dir);
    assert.match(before, /^[0-9a-f]{40}$/);
    // An unstaged change moves it; git write-tree alone would not move.
    writeFileSync(join(dir, "made.txt"), "work\n");
    assert.notEqual(workingTreeFingerprint(dir), before);
    assert.equal(
      spawnSync("git", ["-C", dir, "write-tree"], { encoding: "utf8" }).stdout.trim(),
      before,
      "the index of the repository was never touched",
    );
    // No repository: no fingerprint, and no throw. A directory of its own —
    // a plain subdirectory would still resolve to the repository around it.
    const bare = mkdtempSync(join(tmpdir(), "specstride-fingerprint-none-"));
    try {
      assert.equal(workingTreeFingerprint(bare), "");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an approval no longer counts after git reset past its commit: the phase runs again", async () => {
  await withEnv({ SPECSTRIDE_PROPOSER_PAUSE_SEC: "0" }, async () => {
    const { dir, restore } = fixture(0);
    try {
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      assert.equal(commits(dir), 2);
      assert.equal(readFileSync(join(dirname(dir), "critic-count.txt"), "utf8").trim(), "1");
      // The consumer resets the workspace past the approval commit: the
      // approval binds a tree the workspace no longer holds, so the phase
      // runs again instead of the run doing nothing.
      spawnSync("git", ["-C", dir, "reset", "--hard", "HEAD~1"]);
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      assert.equal(commits(dir), 2, "the phase was approved and committed again");
      assert.equal(readFileSync(join(dirname(dir), "critic-count.txt"), "utf8").trim(), "2");
      // And with the history intact the approval still stands: a third run
      // does nothing.
      assert.equal(await runFeature({ argv: [], workdir: dir }), 0);
      assert.equal(readFileSync(join(dirname(dir), "critic-count.txt"), "utf8").trim(), "2");
    } finally {
      restore();
    }
  });
});
