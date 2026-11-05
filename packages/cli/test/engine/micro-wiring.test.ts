/**
 * The engine-level wiring of the loop layer `micro` (feature 115): with no
 * flags the run works in units — the prompt carries the checkpoint contract
 * block and the unit line, `events.jsonl` holds `strategy.selected`,
 * `attempt.started`, `checkpoint.accepted`, `check.started`/`check.ended`
 * and `microloop.unit`, the kept checkpoints move into the control plane,
 * the critic prompt carries the fact block, and the `[LOOP]` line is printed
 * before the digest. A project file with `loop.strategy: classic` runs the
 * earlier behaviour exactly; a cap trips `off:micro` and the classic loop
 * carries on; a workspace with no declared check runs classic from launch
 * with `gate-not-executing` (F115-FR-004).
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
import { join } from "node:path";
import test from "node:test";

import { runFeature } from "../../src/engine/run-feature.ts";

/**
 * The stub of `claude`. A proposer pass can write a checkpoint: the script
 * the test hands decides what each pass does (`passes` counts from 1).
 */
const STUB = (passScript: string): string => `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (critic) {
  fs.writeFileSync("seen-by-critic.txt", prompt);
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": APPROVED" }));
} else {
  fs.appendFileSync("prompt-log.txt", prompt + "\\n---PASS---\\n");
  const passes = Number(fs.existsSync("pass-count.txt") ? fs.readFileSync("pass-count.txt", "utf8") : "0") + 1;
  fs.writeFileSync("pass-count.txt", String(passes));
  ${passScript}
}
`;

/** The checkpoint a pass writes, as the outbox contract of feature 115 reads it. */
const CHECKPOINT = (unitId: string, taskId: string): string =>
  `const outbox = ".specstride/features/001-one/outbox";` +
  `  fs.mkdirSync(outbox, { recursive: true });` +
  `  fs.writeFileSync(path.join(outbox, "${unitId}.checkpoint.json"),` +
  `    JSON.stringify({ schema: "specstride.checkpoint/1", tasks: ["${taskId}"] }));`;

const WRITE_EVIDENCE = `const evidence = /write (\\.specstride\\S+?):/.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  const tasks = "specs/001-one/tasks.md";
  fs.writeFileSync(tasks, fs.readFileSync(tasks, "utf8").replace("[ ]", "[x]"));
  console.log(JSON.stringify({ type: "result", result: "ok" }));`;

type FixtureOptions = {
  readonly passScript: string;
  /** The project configuration file of the workspace, when one is written. */
  readonly projectConfig?: string;
  /** The `test.js` the inner check runs, when the workspace declares a test. */
  readonly testJs?: string;
  /** Whether the workspace holds a package.json at all. */
  readonly packageJson?: boolean;
};

function fixture(options: FixtureOptions): { readonly dir: string; readonly restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "specstride-micro-"));
  const bin = join(dir, "bin");
  const work = join(dir, "work");
  mkdirSync(bin);
  mkdirSync(join(work, "specs", "001-one"), { recursive: true });
  writeFileSync(join(bin, "claude"), STUB(options.passScript));
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(
    join(work, "specs", "001-one", "tasks.md"),
    "# Tasks\n\n## Phase 1: One\n\n- [ ] T001 Do it\n- [ ] T002 Do more\n",
  );
  if (options.packageJson !== false) {
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({ scripts: { test: "node test.js" } }),
    );
    writeFileSync(join(work, "test.js"), options.testJs ?? "process.exit(0);\n");
  }
  if (options.projectConfig !== undefined) {
    writeFileSync(join(work, "specstride.yaml"), options.projectConfig);
  }
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
    restore: () => {
      process.env.HOME = before.HOME;
      process.env.PATH = before.PATH;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Every event of the run, as `events.jsonl` holds it. */
const eventsOf = (workdir: string): { type: string; data: Record<string, unknown> }[] => {
  const control = join(
    process.env.HOME as string,
    ".specstride",
    "workspaces",
    createHash("sha256").update(workdir).digest("hex").slice(0, 16),
  );
  const runs = join(control, "runs");
  const all: { type: string; data: Record<string, unknown> }[] = [];
  for (const name of existsSync(runs) ? readdirSync(runs).sort() : []) {
    for (const line of readFileSync(join(runs, name, "events.jsonl"), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      all.push(JSON.parse(line) as { type: string; data: Record<string, unknown> });
    }
  }
  return all;
};

/** The lines the run printed, captured from the standard output. */
const capture = async (workdir: string): Promise<{ lines: string[]; exit: number }> => {
  // A pass-through spy: the run's lines are recorded AND written, so the
  // test runner's own output stream keeps working while the run prints.
  const lines: string[] = [];
  const held = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    lines.push(chunk);
    return held(chunk);
  };
  let exit: number;
  try {
    exit = await runFeature({ argv: [], workdir });
  } finally {
    (process.stdout as unknown as { write: (chunk: string) => boolean }).write = held;
  }
  return { lines: lines.join("").split("\n"), exit };
};

test("micro by default: units, checkpoints, inner checks, the fact block and the [LOOP] line", async () => {
  const { dir, restore } = fixture({
    passScript: `if (passes === 1) {
    ${CHECKPOINT("u1", "T001")}
    fs.writeFileSync("made-1.txt", "one\\n");
    console.log(JSON.stringify({ type: "result", result: "unit one" }));
  } else if (passes === 2) {
    ${CHECKPOINT("u2", "T002")}
    fs.writeFileSync("made-2.txt", "two\\n");
    console.log(JSON.stringify({ type: "result", result: "unit two" }));
  } else {
    ${WRITE_EVIDENCE}
  }`,
  });
  try {
    const { lines, exit } = await capture(dir);
    assert.equal(exit, 0);
    const events = eventsOf(dir);
    const types = events.map((event) => event.type);
    // The events of the layer, under the types of the catalogue.
    assert.ok(types.includes("strategy.selected"));
    assert.equal(
      (events.find((event) => event.type === "strategy.selected")?.data.strategy as string) ??
        undefined,
      "micro",
    );
    assert.ok(types.includes("attempt.started"));
    const accepted = events.find((event) => event.type === "checkpoint.accepted");
    assert.deepEqual(accepted?.data.taskIds, ["T001"]);
    const checkStarted = events.find((event) => event.type === "check.started");
    assert.equal(checkStarted?.data.runner, "runtime");
    const checkEnded = events.filter((event) => event.type === "check.ended");
    assert.ok(checkEnded.length >= 2, "the inner check of both units ran");
    const unit = events.find((event) => event.type === "microloop.unit");
    assert.equal(unit?.data.result, "kept");
    // No event of the type `layer.off` exists.
    assert.ok(!types.includes("layer.off"));
    // The proposer's prompt carries the contract block and the unit line.
    const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
    assert.match(log, /## Checkpoint contract/);
    assert.match(log, /u1\.checkpoint\.json/);
    assert.match(log, /u2\.checkpoint\.json/);
    // The kept checkpoints moved into the control plane, under the outbox name.
    const feature = join(
      process.env.HOME as string,
      ".specstride",
      "workspaces",
      createHash("sha256").update(dir).digest("hex").slice(0, 16),
      "features",
      "001-one",
    );
    assert.ok(existsSync(join(feature, "unit:u1:checkpoint")));
    assert.ok(existsSync(join(feature, "unit:u2:checkpoint")));
    assert.ok(
      !existsSync(join(dir, ".specstride", "features", "001-one", "outbox", "u1.checkpoint.json")),
    );
    // The critic prompt carries the fact block section.
    assert.match(
      readFileSync(join(dir, "seen-by-critic.txt"), "utf8"),
      /# The units of work the runtime checked \(facts, not claims\)/,
    );
    // The [LOOP] line is printed before the digest.
    const loopAt = lines.findIndex((line) => line.includes("[LOOP] strategy=micro"));
    const digestAt = lines.findIndex((line) => line.includes("DIGEST"));
    assert.ok(
      loopAt >= 0,
      `the [LOOP] line was printed: ${lines.filter((l) => l.includes("[LOOP]")).join(" / ")}`,
    );
    assert.ok(digestAt > loopAt);
  } finally {
    restore();
  }
});

test("classic by the project file: the earlier behaviour exactly, and the classic [LOOP] line", async () => {
  const { dir, restore } = fixture({
    projectConfig: "schema: 1\nloop:\n  strategy: classic\n",
    passScript: `if (passes < 2) {
    ${CHECKPOINT("u1", "T001")}
    console.log(JSON.stringify({ type: "result", result: "thinking" }));
  } else {
    ${WRITE_EVIDENCE}
  }`,
  });
  try {
    const { lines, exit } = await capture(dir);
    assert.equal(exit, 0);
    const types = eventsOf(dir).map((event) => event.type);
    for (const forbidden of [
      "checkpoint.accepted",
      "checkpoint.refused",
      "checkpoint.removed",
      "check.started",
      "check.ended",
      "microloop.unit",
    ]) {
      assert.ok(!types.includes(forbidden), `no ${forbidden} under classic`);
    }
    const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
    assert.doesNotMatch(log, /## Checkpoint contract/);
    assert.doesNotMatch(log, /u1\.checkpoint\.json/);
    assert.ok(lines.some((line) => line.includes("strategy=classic reason=config")));
  } finally {
    restore();
  }
});

test("a cap trips off:micro: the announcement is said, the route.decided event names the rule, the run ends", async () => {
  const { dir, restore } = fixture({
    projectConfig:
      "schema: 1\nloop:\n  micro:\n    caps:\n      repairs: 0\n      unresolvedUnits: 1\n",
    testJs: "process.exit(1);\n",
    passScript: `if (passes === 1) {
    ${CHECKPOINT("u1", "T001")}
    fs.writeFileSync("made-1.txt", "one\\n");
    console.log(JSON.stringify({ type: "result", result: "unit one" }));
  } else {
    ${WRITE_EVIDENCE}
  }`,
  });
  try {
    const { lines, exit } = await capture(dir);
    assert.ok(exit === 0 || exit === 2, `the run ended properly (exit ${String(exit)})`);
    const events = eventsOf(dir);
    const route = events.find(
      (event) =>
        event.type === "route.decided" &&
        (event.data.ruleId as string) === "loop.caps" &&
        (event.data.choice as string) === "off:micro",
    );
    assert.ok(route !== undefined, "the route.decided event of loop.caps is in events.jsonl");
    assert.ok(
      lines.some((line) => line.includes("layer micro off for the phase-attempt: caps")),
      "the announcement line was said",
    );
    // After the layer went off, the classic loop carries on: the pass that
    // follows carries no checkpoint contract block and no unit line
    // (F115-FR-025 — nothing of the layer reaches the prompt any more).
    const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
    const passesAfterOff = log.split("---PASS---").filter((part) => part.length > 0);
    const withUnitLine = passesAfterOff.filter((part) => /u\d\.checkpoint\.json/.test(part));
    const withContract = passesAfterOff.filter((part) => /## Checkpoint contract/.test(part));
    assert.ok(withUnitLine.length > 0, "the passes before the off carried the unit line");
    assert.ok(
      withContract.length < passesAfterOff.length,
      "the pass after the off carries no contract block",
    );
    assert.ok(
      withUnitLine.length < passesAfterOff.length,
      "the pass after the off carries no unit line",
    );
  } finally {
    restore();
  }
});

test("no declared check: classic from launch with gate-not-executing (F115-FR-004)", async () => {
  // This test pinned the WRONG behaviour before: it expected the layer to
  // engage in a workspace with no package.json and go off by `no-check`. But
  // a workspace without a declared check runs NO verification gate, and
  // F115-FR-004 makes that a run-level fallback to the classic loop with the
  // reason `gate-not-executing`, decided at launch — the layer never engages.
  // `no-check` itself stays pinned at the machine level (micro-layer.test.ts).
  const { dir, restore } = fixture({
    packageJson: false,
    passScript: `if (passes === 1) {
    ${CHECKPOINT("u1", "T001")}
    console.log(JSON.stringify({ type: "result", result: "unit one" }));
  } else if (passes === 2) {
    ${CHECKPOINT("u2", "T001")}
    console.log(JSON.stringify({ type: "result", result: "unit two" }));
  } else {
    ${WRITE_EVIDENCE}
  }`,
  });
  try {
    const { lines, exit } = await capture(dir);
    assert.equal(exit, 0);
    const events = eventsOf(dir);
    const selected = events.find((event) => event.type === "strategy.selected");
    assert.equal(selected?.data.strategy, "classic");
    assert.equal(selected?.data.fallbackReason, "gate-not-executing");
    // The layer never engages: no checkpoint is read, no check runs, no unit
    // is decided — even though the stub wrote checkpoint files.
    const types = events.map((event) => event.type);
    for (const forbidden of [
      "checkpoint.accepted",
      "checkpoint.refused",
      "check.started",
      "check.ended",
      "microloop.unit",
      "route.decided",
    ]) {
      assert.ok(!types.includes(forbidden), `no ${forbidden} without a declared check`);
    }
    const log = readFileSync(join(dir, "prompt-log.txt"), "utf8");
    assert.doesNotMatch(log, /## Checkpoint contract/, "no contract block without a gate");
    assert.ok(
      lines.some((line) => line.includes("strategy=classic reason=gate-not-executing")),
      "the classic [LOOP] line carries the reason",
    );
  } finally {
    restore();
  }
});
