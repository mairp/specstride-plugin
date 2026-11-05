/**
 * The learning wiring of the engine (F106-FR-036, F106-FR-039): the mode and
 * its alias, the compatibility feed the figures come from, the call after an
 * approved phase — which observes, records learning.observed, evaluates, and
 * never touches the run — and the lines at exit. The engine-level tests drive
 * one full `runFeature` over a stub of `claude`, the style of the other engine
 * tests; a real run on dsh is the next session's proof, not this one's.
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

import {
  afterApprovedPhase,
  compatibilityFeedOf,
  learningExitLines,
  learningModeOf,
} from "../../src/engine/learning-loop.ts";
import { runFeature } from "../../src/engine/run-feature.ts";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A clean environment: nothing but the path, so no alias is set by mistake. */
const CLEAN_ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "" };

/** The stub of `claude`: an honest proposer pass and an approving critic. */
const STUB = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const session = argv[argv.indexOf("--session-id") + 1];
const critic = argv.includes("--max-turns");
console.log(JSON.stringify({ type: "system", subtype: "init", tools: critic ? [] : ["Read"], session_id: session }));
if (prompt.includes("Diagnostician")) {
  console.log(JSON.stringify({ type: "result", result: "CASE: GROUNDING\\nName the missing test of T001." }));
} else if (critic) {
  const nonce = /VERDICT ([0-9a-f]+): APPROVED/.exec(prompt)[1];
  console.log(JSON.stringify({ type: "result", result: "T001 judged.\\nVERDICT " + nonce + ": APPROVED" }));
} else {
  const evidence = /write (\\.specstride\\S+?):/i.exec(prompt)[1];
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, "T001 done\\n");
  const tasks = "specs/001-one/tasks.md";
  fs.writeFileSync(tasks, fs.readFileSync(tasks, "utf8").replace("[ ]", "[x]"));
  console.log(JSON.stringify({ type: "result", result: "ok" }));
}
`;

/** A workspace for the module-level calls: a home, a workdir, a control root. */
function workspace(projectConfig?: string): {
  readonly root: string;
  readonly home: string;
  readonly work: string;
  readonly control: string;
} {
  const root = mkdtempSync(join(tmpdir(), "specstride-learn-"));
  const home = join(root, "home");
  const work = join(root, "work");
  mkdirSync(home);
  mkdirSync(work);
  if (projectConfig !== undefined) writeFileSync(join(work, "specstride.yaml"), projectConfig);
  return { root, home, work, control: join(root, "control") };
}

type EngineOptions = {
  /** The value of `SPECSTRIDE_LEARNING`; unset where omitted. */
  readonly learning?: string;
  /** The project configuration file of the workspace, when one is written. */
  readonly projectConfig?: string;
  /** A decision log planted before the run, at `learning/applied.json`. */
  readonly decisions?: string;
};

/** A whole engine fixture: a stub `claude`, a one-phase feature, a git tree. */
function engineFixture(options: EngineOptions): {
  readonly dir: string;
  readonly restore: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "specstride-learn-run-"));
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
  if (options.projectConfig !== undefined) {
    writeFileSync(join(work, "specstride.yaml"), options.projectConfig);
  }
  if (options.decisions !== undefined) {
    mkdirSync(join(work, ".specstride", "features", "001-one", "learning"), { recursive: true });
    writeFileSync(
      join(work, ".specstride", "features", "001-one", "learning", "applied.json"),
      options.decisions,
    );
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
  const before = { HOME: process.env.HOME, PATH: process.env.PATH, SPECSTRIDE_LEARNING: undefined };
  process.env.HOME = dir;
  process.env.PATH = `${bin}:${before.PATH ?? ""}`;
  if (options.learning === undefined) delete process.env.SPECSTRIDE_LEARNING;
  else process.env.SPECSTRIDE_LEARNING = options.learning;
  return {
    dir: work,
    restore: () => {
      process.env.HOME = before.HOME;
      process.env.PATH = before.PATH;
      if (before.SPECSTRIDE_LEARNING === undefined) delete process.env.SPECSTRIDE_LEARNING;
      else process.env.SPECSTRIDE_LEARNING = before.SPECSTRIDE_LEARNING;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The control root the engine of one workdir owns its records under. */
const controlOf = (workdir: string): string =>
  join(
    process.env.HOME as string,
    ".specstride",
    "workspaces",
    createHash("sha256").update(workdir).digest("hex").slice(0, 16),
  );

/** Every event of every run of one workdir, as `events.jsonl` holds it. */
const eventsOf = (workdir: string): { type: string; data: Record<string, unknown> }[] => {
  const runs = join(controlOf(workdir), "runs");
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
async function capture(workdir: string): Promise<{ lines: string[]; exit: number }> {
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
}

/** One as-is event line of the OLD vocabulary, as the projection writes it. */
const asis = (event: string, fields: Record<string, unknown>): string =>
  `${JSON.stringify({ event, ts: 1780000000 + fields["iter"], run_id: "run-1", ...fields })}\n`;

/** The events of one approved phase attempt, in the OLD vocabulary (F106-FR-004). */
function legacyEventsFile(dir: string): string {
  const file = join(dir, "events.legacy.jsonl");
  writeFileSync(
    file,
    [
      asis("run_start", { feature: "001-one", backend: "prop:claude/crit:claude", resume: null }),
      asis("phase_start", { phase: 1, title: "One", shape: null }),
      asis("proposer_start", { phase: 1, attempt: 1 }),
      asis("iter_start", { iter: 1 }),
      asis("agent_result", {
        iter: 1,
        is_error: false,
        cost_usd: 0.01,
        duration_ms: 1200,
      }),
      asis("verdict", { phase: 1, attempt: 1, verdict: "APPROVED", reason: "" }),
    ].join(""),
  );
  return file;
}

/* ------------------------------------------------------------------ *
 * 1 — the mode
 * ------------------------------------------------------------------ */

test("the mode is off by default, read from the alias, and unknown values read as off", () => {
  assert.equal(learningModeOf(CLEAN_ENV).mode, "off");
  assert.equal(learningModeOf(CLEAN_ENV).modeSource, "default");
  const suggest = learningModeOf({ ...CLEAN_ENV, SPECSTRIDE_LEARNING: "suggest" });
  assert.equal(suggest.mode, "suggest");
  assert.equal(suggest.modeSource, "environment");
  assert.equal(learningModeOf({ ...CLEAN_ENV, SPECSTRIDE_LEARNING: "nonsense" }).mode, "off");
});

test("the through alias binds a run id", () => {
  const bound = learningModeOf({ ...CLEAN_ENV, SPECSTRIDE_LEARNING_THROUGH: "run-abc123" });
  assert.equal(bound.through, "run-abc123");
  assert.equal(bound.throughSource, "environment");
  assert.equal(learningModeOf(CLEAN_ENV).through, null);
});

/* ------------------------------------------------------------------ *
 * 2 — the compatibility feed
 * ------------------------------------------------------------------ */

test("the feed is off with no profile and no switch, and its event file is under the control root", () => {
  const { root, home, work, control } = workspace();
  try {
    const feed = compatibilityFeedOf({
      home,
      workdir: work,
      environment: CLEAN_ENV,
      controlRoot: control,
      runId: "run-1",
      slug: "001-one",
      enginePid: 4242,
      startedAt: new Date("2026-10-07T02:11:09.123Z"),
    });
    assert.equal(feed.isOn, false);
    assert.equal(feed.projection.isOn, false);
    assert.equal(
      feed.eventsFile,
      join(control, "features", "001-one", "runs", "run-1", "compat", "events.legacy.e1.jsonl"),
    );
    // F144-FR-008 — with the projection off, the start creates nothing.
    feed.projection.startEngineStart();
    assert.equal(existsSync(feed.eventsFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project file with compat.legacyEvents: on switches the feed on", () => {
  const { root, home, work, control } = workspace("schema: 1\ncompat:\n  legacyEvents: true\n");
  try {
    const feed = compatibilityFeedOf({
      home,
      workdir: work,
      environment: CLEAN_ENV,
      controlRoot: control,
      runId: "run-1",
      slug: "001-one",
      enginePid: 4242,
      startedAt: new Date("2026-10-07T02:11:09.123Z"),
    });
    assert.equal(feed.isOn, true);
    assert.equal(feed.projection.isOn, true);
    // F144-FR-008 — at the start of an engine start the as-is event file and
    // its engine log are created empty.
    feed.projection.startEngineStart();
    assert.equal(existsSync(feed.eventsFile), true);
    assert.equal(feed.projection.engineLog.startsWith(control), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 3 — the call after an approved phase
 * ------------------------------------------------------------------ */

test("after an approved phase the observation is written, recorded and logged", async () => {
  const root = mkdtempSync(join(tmpdir(), "specstride-learn-phase-"));
  const featureDir = join(root, "001-one");
  try {
    const eventsFile = legacyEventsFile(root);
    const recorded: { phase: number; logicalName: string }[] = [];
    const lines: string[] = [];
    await afterApprovedPhase({
      mode: "suggest",
      featureDir,
      phase: 1,
      shape: null,
      summaryPaths: [eventsFile],
      runId: "run-1",
      now: new Date("2026-10-07T02:11:09.123Z"),
      logLine: (line) => lines.push(line),
      recordObserved: (data) => recorded.push(data),
    });
    const document = JSON.parse(
      readFileSync(join(featureDir, "learning", "phase-1.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(document.schema, "specstride.learn.observation/1");
    const observation = document.observation as Record<string, unknown> | null;
    assert.notEqual(observation, null, "the phase has telemetry");
    assert.ok((observation?.attempts_total as number) >= 1);
    assert.deepEqual(recorded, [
      { phase: 1, logicalName: "feature:<slug>:learning:observation:1" },
    ]);
    // The line goes to the log sink only (F106-FR-036), and with no decision
    // log there is nothing else to say.
    assert.equal(lines.length, 1);
    assert.match(lines[0] as string, /^learn: phase 1 observation — 1 attempt\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 4 — the failure rule
 * ------------------------------------------------------------------ */

test("a learning failure is a line and never touches the run", async () => {
  const root = mkdtempSync(join(tmpdir(), "specstride-learn-fail-"));
  const featureDir = join(root, "001-one");
  // The writer domain cannot exist: `learning` is a regular file.
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "learning"), "not a directory\n");
  try {
    const eventsFile = legacyEventsFile(root);
    const recorded: { phase: number; logicalName: string }[] = [];
    const lines: string[] = [];
    await afterApprovedPhase({
      mode: "suggest",
      featureDir,
      phase: 1,
      shape: null,
      summaryPaths: [eventsFile],
      runId: "run-1",
      now: new Date("2026-10-07T02:11:09.123Z"),
      logLine: (line) => lines.push(line),
      recordObserved: (data) => recorded.push(data),
    });
    assert.deepEqual(recorded, [], "a failed observation records no event");
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] as string,
      /^# {3}\(learning: .* failed \(.*\) — continuing; the run is unaffected\)$/,
    );
    assert.equal(existsSync(join(featureDir, "learning", "phase-1.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 5 — the lines at exit
 * ------------------------------------------------------------------ */

test("no decision log means no lines at exit", () => {
  const root = mkdtempSync(join(tmpdir(), "specstride-learn-exit-"));
  try {
    assert.deepEqual(learningExitLines({ mode: "suggest", featureDir: join(root, "001-one") }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one recorded evaluation is one line at exit", () => {
  const root = mkdtempSync(join(tmpdir(), "specstride-learn-exit-1-"));
  try {
    const featureDir = join(root, "001-one");
    mkdirSync(join(featureDir, "learning"), { recursive: true });
    // The byte form `appendEntry` writes: one JSON object per line, in the
    // member order of an `evaluate` entry (F106-FR-008).
    writeFileSync(
      join(featureDir, "learning", "applied.json"),
      `${JSON.stringify({
        schema: "specstride.learn.applied/2",
        action: "evaluate",
        knob: "proposer_timeout",
        phase: 1,
        shape: null,
        previous: 45,
        value: 30,
        label: "insufficient",
        reset: null,
        cost: { n_a: 0, n_b: 0 },
        wall: { n_a: 0, n_b: 0 },
        run_id: "learn-1",
        evaluates_run_id: "learn-1",
        evaluated_at: "2026-10-07T02:11:09Z",
      })}\n`,
    );
    assert.deepEqual(learningExitLines({ mode: "suggest", featureDir }), [
      "learn: phase 1 proposer_timeout 45→30 [learn-1]: insufficient — " +
        "cost n=0/0 (need 6/6); wall n=0/0 (need 6/6)",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 6 — the engine
 * ------------------------------------------------------------------ */

test("a run with the mode suggest observes the approved phase and records the event", async () => {
  const { dir, restore } = engineFixture({
    learning: "suggest",
    projectConfig: "schema: 1\ncompat:\n  legacyEvents: true\n",
  });
  try {
    const { exit } = await capture(dir);
    assert.equal(exit, 0);
    const featureDir = join(dir, ".specstride", "features", "001-one");
    assert.equal(
      existsSync(join(featureDir, "learning", "phase-1.json")),
      true,
      "the observation document of phase 1 exists",
    );
    const document = JSON.parse(
      readFileSync(join(featureDir, "learning", "phase-1.json"), "utf8"),
    ) as { observation: Record<string, unknown> | null };
    assert.notEqual(document.observation, null, "the phase has telemetry");
    assert.ok(
      typeof document.observation?.["attempts_total"] === "number" &&
        (document.observation["attempts_total"] as number) >= 1,
      "the observation counts the attempt of the phase",
    );
    const events = eventsOf(dir);
    assert.ok(
      events.some((event) => event.type === "learning.observed"),
      "the run's stream holds the event of the observation",
    );
    const runs = join(featureDir, "runs");
    const logs = existsSync(runs)
      ? readdirSync(runs).filter((name) => existsSync(join(runs, name, "engine.log")))
      : [];
    assert.equal(logs.length, 1, "one engine log, of this run");
    const log = readFileSync(join(runs, logs[0] as string, "engine.log"), "utf8");
    assert.match(log, /^learn: phase 1 /m);
    assert.match(log, /observation/m);
    // F106-FR-004 — the figures are read "through the compatibility projection
    // where the as-is name is used": the pass loop announces `iter_start` and
    // `evidence_written`, whose catalogue types the feed translates, so the
    // as-is file of the engine start holds the passes of the phase.
    const runId = logs[0] as string;
    const asisFile = join(
      controlOf(dir),
      "features",
      "001-one",
      "runs",
      runId,
      "compat",
      "events.legacy.e1.jsonl",
    );
    const asisText = readFileSync(asisFile, "utf8");
    assert.match(asisText, /"event":"iter_start"/, "the pass reaches the as-is stream");
    assert.match(asisText, /"event":"evidence_written"/, "the evidence reaches the as-is stream");
  } finally {
    restore();
  }
});

test("the same fixture with the mode off is the same run, minus the learning event (F106-FR-039)", async () => {
  const on = engineFixture({
    learning: "suggest",
    projectConfig: "schema: 1\ncompat:\n  legacyEvents: true\n",
  });
  const off = engineFixture({
    projectConfig: "schema: 1\ncompat:\n  legacyEvents: true\n",
  });
  try {
    const withLearning = await capture(on.dir);
    const without = await capture(off.dir);
    assert.equal(withLearning.exit, 0);
    assert.equal(without.exit, withLearning.exit);
    const typesOf = (workdir: string): string[] => eventsOf(workdir).map((event) => event.type);
    assert.deepEqual(
      typesOf(off.dir),
      typesOf(on.dir).filter((type) => type !== "learning.observed"),
      "the event stream is the same one, without the observation event",
    );
    assert.equal(
      existsSync(join(off.dir, ".specstride", "features", "001-one", "learning", "phase-1.json")),
      false,
      "with the mode off nothing is observed",
    );
  } finally {
    on.restore();
    off.restore();
  }
});

test("the lines at exit go to standard output AND to the engine log, before the digest", async () => {
  const { dir, restore } = engineFixture({
    learning: "suggest",
    projectConfig: "schema: 1\ncompat:\n  legacyEvents: true\n",
    decisions: `${JSON.stringify({
      schema: "specstride.learn.applied/2",
      action: "evaluate",
      knob: "proposer_timeout",
      phase: 1,
      shape: null,
      previous: 45,
      value: 30,
      label: "insufficient",
      reset: null,
      cost: { n_a: 0, n_b: 0 },
      wall: { n_a: 0, n_b: 0 },
      run_id: "learn-1",
      evaluates_run_id: "learn-1",
      evaluated_at: "2026-10-07T02:11:09Z",
    })}\n`,
  });
  try {
    const { lines, exit } = await capture(dir);
    assert.equal(exit, 0);
    const at = lines.findIndex((line) => line.startsWith("learn: phase 1 proposer_timeout"));
    assert.ok(at >= 0, `the line at exit was printed: ${lines.join(" / ")}`);
    assert.ok(lines.findIndex((line) => line.includes("[LOOP]")) < at, "after the [LOOP] line");
    assert.ok(lines.findIndex((line) => line.includes("DIGEST")) > at, "before the digest");
    const runs = join(dir, ".specstride", "features", "001-one", "runs");
    const log = readdirSync(runs)
      .map((name) => join(runs, name, "engine.log"))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"))[0];
    assert.match(log, /^learn: phase 1 proposer_timeout/m);
  } finally {
    restore();
  }
});
