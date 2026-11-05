/**
 * THE LAUNCH OF THE LOOP LAYER `PARALLEL` at the engine level (step 3 of
 * `prompts/specstride-parallel-units.md`, first slice: the plan and its
 * persistence; F142-FR-017, T051). Nothing calls a model and nothing calls
 * git; the store and the emit of the engine are closures this test observes,
 * which is exactly the split the spec draws: the layer decides and never
 * executes (F142-FR-006), the engine writes and emits.
 *
 *  - WITH THE OPTION OFF nothing is written, nothing is emitted and nothing is
 *    said: inertness (F142-SC-001), with the one run-record field that says
 *    `loop.parallel.units=off` (F142-FR-001);
 *  - WITH THE OPTION ON the plan at launch is computed from the task list the
 *    grammar read, stored under the run's directory of the control plane and
 *    announced by the `parallel.plan` event that carries its hash — and the
 *    bytes on disk re-hash to the hash the event carries (`planIntegrity`);
 *  - THE PRECONDITIONS are read from the facts the engine hands over: a
 *    containment below C2 refuses the group with the reason `containment`
 *    unless `loop.parallel.allow_detect` is in force from user configuration
 *    (F142-FR-003), a task list without `[P]` falls back with `no-group`, and
 *    a fallback is never an error (F142-FR-004);
 *  - THE RANKS of the real merge decide: the parity profile forces the option
 *    off (F142-FR-002), the environment beats the project configuration
 *    (F142-FR-016), and a worker count over its ceiling is a configuration
 *    error that refuses the launch, never clamped (F142-FR-019).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GRAMMARS } from "../../../spec-formats/src/adapters/index.ts";
import {
  groupsInThePlan,
  planIntegrity,
  UNITS_KEY,
  type ParallelPlan,
} from "../../../layer-parallel/src/index.ts";
import {
  THE_PLAN_HASHER,
  isParallelConfigurationError,
  launchTheParallelLayer,
  taskListAsReadAtLaunch,
  type ParallelLaunchInput,
} from "../../src/engine/parallel-launch.ts";
import { loopConfigurationOf } from "../../src/engine/loop-config.ts";

/* ------------------------------------------------------------------ *
 * Fixtures — real task lists, read through the real grammar.
 * ------------------------------------------------------------------ */

/**
 * Two phases: the first carries the heading fact (a sub-heading between two
 * of its tasks), the second carries three disjoint `[P]` tasks that one group
 * plans. A run of a single candidate goes serial
 * (`alone-in-its-run-of-admitted-tasks`), so the group of three stands in its
 * own phase, where the run holds all three.
 */
const TASKS_THREE_PARALLEL = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] the reader in src/a/",
  "- [ ] T002 document the reading",
  "",
  "### A sub-heading",
  "",
  "- [x] T003 [P] the note in docs/note.md",
  "",
  "## Phase 2: Build",
  "",
  "- [ ] T010 [P] the writer in src/b/",
  "- [ ] T011 [P] the checker in tests/checker.spec.ts",
  "- [ ] T012 [P] the packer in scripts/pack.ts",
  "",
].join("\n");

/** A task list with no `[P]` mark anywhere: no group can be planned. */
const TASKS_SERIAL_ONLY = [
  "# Tasks",
  "",
  "## Phase 1: Build",
  "",
  "- [ ] T001 the reader in src/a/",
  "- [ ] T002 the writer in src/b/",
  "",
].join("\n");

/**
 * The overlap fixture (F142-SC-010's shape): every task carries `[P]`, and
 * T003's scope sits inside T002's, so the admission refuses T003 the group
 * with the check `scope` — while T001 and T002, disjoint, still form one.
 */
const TASKS_OVERLAP_REFUSED = [
  "# Tasks",
  "",
  "## Phase 1: Build",
  "",
  "- [ ] T001 [P] the reader in src/a/",
  "- [ ] T002 [P] the writer in src/b/",
  "- [ ] T003 [P] the second writer in src/b/over.ts",
  "- [ ] T004 [P] the packer in src/c/",
  "",
].join("\n");

/** The phases of a task list, as the engine reads them at launch. */
function phasesOf(text: string) {
  return GRAMMARS["speckit-tasks"].phasesOf(text, "specs/x/tasks.md");
}

/** What the test observed of the engine's store and emit. */
type Observed = {
  readonly stored: { path: string; text: string }[];
  readonly emitted: { type: string; data: Readonly<Record<string, unknown>> }[];
};

/** A launch input over a fixture, with the engine's writes observed. */
function launchOf(
  overrides: {
    readonly units?: ParallelLaunchInput["units"];
    readonly workers?: ParallelLaunchInput["workers"];
    readonly allowDetect?: ParallelLaunchInput["allowDetect"];
    readonly preconditions?: ParallelLaunchInput["preconditions"];
    readonly innerCheckSet?: readonly string[];
    readonly text?: string;
    readonly quotaHeadroomPerCent?: number;
  } = {},
): { outcome: ReturnType<typeof launchTheParallelLayer>; observed: Observed } {
  const observed: {
    stored: { path: string; text: string }[];
    emitted: { type: string; data: Readonly<Record<string, unknown>> }[];
  } = {
    stored: [],
    emitted: [],
  };
  const text = overrides.text ?? TASKS_THREE_PARALLEL;
  const outcome = launchTheParallelLayer({
    runId: "r-test-1",
    units: overrides.units ?? { userConfiguration: "on" },
    // The default worker count is 2; the fixture plans three units, so the
    // launch here says 3, as a user configuration that widens the cap would.
    workers: overrides.workers ?? { userConfiguration: { workers: 3 } },
    ...(overrides.allowDetect !== undefined ? { allowDetect: overrides.allowDetect } : {}),
    ...(overrides.quotaHeadroomPerCent !== undefined
      ? { quotaHeadroomPerCent: overrides.quotaHeadroomPerCent }
      : {}),
    // The engine derives the set from the verification declaration; the
    // default here is the one command a run with an executing gate carries.
    innerCheckSet: overrides.innerCheckSet ?? ["check"],
    preconditions: {
      loopStrategy: "micro",
      gateExecutes: true,
      insideAGitWorkTree: true,
      submodules: false,
      gitVersion: { major: 2, minor: 45 },
      // The entry the dsh adapter gives the engine: its own statement of
      // capabilities carries the concurrency as `verified` (CT-130-46) and a
      // containment ceiling of C2 — the adapter that may run a group.
      harness: {
        state: "tested",
        concurrentSessions: { value: 3, provenance: "adapter" },
        containmentCeiling: "C2",
      },
      containment: "C2",
      allowDetect: overrides.allowDetect,
      ...(overrides.preconditions ?? {}),
    },
    lines: text,
    phases: phasesOf(text),
    planPath: "runs/r-test-1/parallel-plan.json",
    store: (path, stored) => {
      observed.stored.push({ path, text: stored });
    },
    emit: (type, data) => {
      observed.emitted.push({ type, data });
    },
  });
  return { outcome, observed };
}

/* ------------------------------------------------------------------ *
 * 1. With the option off: inertness (F142-SC-001, F142-FR-001).
 * ------------------------------------------------------------------ */

test("with the option off nothing is stored, emitted or said, and the run record says off", () => {
  const { outcome, observed } = launchOf({ units: {} });
  assert.equal(outcome.units, "off");
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, null, "an inert launch names no fallback");
  assert.equal(outcome.plan, null);
  assert.equal(outcome.planWritten, false);
  assert.equal(outcome.eventEmitted, false);
  assert.deepEqual(observed.stored, [], "F142-SC-001: no file of the layer");
  assert.deepEqual(observed.emitted, [], "F142-SC-001: no event of the layer");
  assert.deepEqual(outcome.launchLines, [], "F142-SC-001: no prompt block of the layer");
  assert.equal(outcome.loopLineField, null, "the [LOOP] line of a serial run is unchanged");
  assert.deepEqual(outcome.fields, { [UNITS_KEY]: "off" }, "F142-FR-001: the one field says off");
  assert.equal(isParallelConfigurationError(outcome), false);
});

/* ------------------------------------------------------------------ *
 * 2. With the option on: the plan, its hash, its persistence (T051).
 * ------------------------------------------------------------------ */

test("with the option on the plan is stored under the run and the event carries its hash", () => {
  const { outcome, observed } = launchOf();
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.units, "on");
  assert.equal(outcome.on, true, "every precondition of the dsh-shaped entry holds");
  assert.equal(outcome.fallback, null);
  assert.equal(outcome.loopLineField, null);
  assert.equal(outcome.planWritten, true);
  assert.equal(outcome.eventEmitted, true);

  // The engine stored ONE file at the path the module named.
  assert.equal(observed.stored.length, 1);
  assert.equal(observed.stored[0].path, "runs/r-test-1/parallel-plan.json");
  const storedPlan = JSON.parse(observed.stored[0].text) as ParallelPlan;
  assert.equal(storedPlan.runId, "r-test-1", "the plan carries the run (annex D §D.3)");
  assert.equal(storedPlan.fallback, null);
  assert.equal(groupsInThePlan(storedPlan), 1, "three disjoint [P] tasks make one group");
  assert.deepEqual(
    storedPlan.phases[1].groups[0].tasks,
    ["T010", "T011", "T012"],
    "the group plans its three units of phase 2",
  );

  // The bytes on disk re-hash to the hash the layer computed: the integrity
  // check of the plan (F142-FR-017), read back from the store.
  const integrity = planIntegrity(storedPlan, outcome.plan.hash, THE_PLAN_HASHER);
  assert.equal(integrity.matches, true);

  // The engine emitted ONE event, with the hash and the shape of the plan.
  assert.equal(observed.emitted.length, 1);
  assert.equal(observed.emitted[0].type, "parallel.plan");
  const data = observed.emitted[0].data;
  assert.equal(data.hash, outcome.plan.hash);
  assert.equal(data.workers, 3);
  assert.equal(data.groups, 1);
  assert.equal(data.phases, 2, "the event counts the phases of the plan");

  // The launch said one line, the field of the [LOOP] line is absent.
  assert.equal(outcome.launchLines.length, 1);
  assert.match(outcome.launchLines[0], /every precondition/);

  // The run-record fields of the layer (row DV-088), only with the option on.
  assert.equal(outcome.fields[UNITS_KEY], "on");
  assert.equal(outcome.fields["loop.parallel.workers"], "3");
  assert.equal(outcome.fields["loop.parallel.workersMax"], "4", "the default ceiling");
  assert.equal(outcome.fields["loop.parallel.plan_hash"], outcome.plan.hash);
  assert.equal(outcome.fields["loop.parallel.protection"], "sandbox");
  assert.equal(outcome.fields["loop.parallel.allow_detect"], undefined);
  assert.equal(outcome.fields["loop.parallel.quota_headroom"], undefined);
});

/* ------------------------------------------------------------------ *
 * 3. The preconditions, from the facts the engine read (F142-FR-002).
 * ------------------------------------------------------------------ */

test("a containment below C2 refuses the group with the reason containment", () => {
  const { outcome, observed } = launchOf({
    // The harness entry still declares its concurrency, so the FIRST failure
    // is the containment, in the order the preconditions are read.
    preconditions: {
      containment: "C1",
      harness: {
        state: "tested",
        concurrentSessions: { value: 3, provenance: "adapter" },
        containmentCeiling: "C1",
      },
    },
  });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, "containment");
  assert.equal(outcome.loopLineField, "parallel=off reason=containment");
  assert.match(outcome.launchLines[0], /containment/);
  // The plan is still hashed and stored, WITH the reason as its fallback:
  // the plan says why the layer is off for the run, and carries what would
  // have run, which nothing downstream may start from a fallback plan.
  assert.equal(observed.stored.length, 1);
  const storedPlan = JSON.parse(observed.stored[0].text) as ParallelPlan;
  assert.equal(storedPlan.fallback, "containment");
  assert.equal(groupsInThePlan(storedPlan), 1, "the group is planned but never started");
  assert.equal(outcome.fields["loop.parallel.protection"], "sandbox");
  assert.equal(outcome.fields["loop.parallel.plan_hash"], outcome.plan?.hash);
});

test("allow_detect from user configuration lets a group run below C2, as protection=detect", () => {
  const { outcome, observed } = launchOf({
    allowDetect: { userConfiguration: true },
    preconditions: {
      containment: "C1",
      harness: {
        state: "tested",
        concurrentSessions: { value: 3, provenance: "adapter" },
        containmentCeiling: "C1",
      },
    },
  });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, true, "the F142-FR-003 route: the run carries a group");
  assert.equal(outcome.fallback, null);
  assert.equal(groupsInThePlan(outcome.plan), 1);
  assert.equal(outcome.fields["loop.parallel.protection"], "detect", "F142-FR-003");
  assert.equal(outcome.fields["loop.parallel.allow_detect"], "on");
  assert.equal(observed.emitted[0].data.groups, 1);
});

test("allow_detect from the environment is ignored, with a launch message", () => {
  const { outcome } = launchOf({ allowDetect: { environment: true } });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, true, "the ignored value cannot stop the launch either");
  assert.equal(outcome.fields["loop.parallel.protection"], "sandbox");
  assert.equal(outcome.fields["loop.parallel.allow_detect"], undefined);
  assert.equal(outcome.launchLines.length, 2, "the ignored source is announced (CQ-183)");
  assert.match(outcome.launchLines[1], /is ignored/);
});

test("a task list without a [P] mark falls back with no-group", () => {
  const { outcome, observed } = launchOf({ text: TASKS_SERIAL_ONLY });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, "no-group");
  assert.equal(outcome.loopLineField, "parallel=off reason=no-group");
  assert.equal(groupsInThePlan(JSON.parse(observed.stored[0].text) as ParallelPlan), 0);
  assert.equal(outcome.fields["loop.parallel.plan_hash"], outcome.plan?.hash);
});

/* ------------------------------------------------------------------ *
 * 3b. The refusal lines (the owed item of par-3; F142-SC-010): a
 *     candidate a check refused is named on the console, next to the
 *     launch message, with the check and its own detail — not only in
 *     parallel-plan.json. An unmarked task is NOT a refusal (it was never
 *     a candidate, F142-FR-007), and neither is a task alone in its run
 *     (no check refused it), and neither prints a line.
 * ------------------------------------------------------------------ */

test("a candidate a check refused is named on a launch line with the check and its detail", () => {
  const { outcome } = launchOf({ text: TASKS_OVERLAP_REFUSED });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, true, "the disjoint tasks T001 and T002 still form one group");
  assert.equal(outcome.fallback, null);
  assert.equal(groupsInThePlan(outcome.plan), 1, "the refusal did not stop the group");

  // The refusal is the line NEXT TO the launch message, naming the task, the
  // check of row 61 that refused it, and the check's own detail.
  assert.equal(outcome.launchLines.length, 2);
  assert.match(outcome.launchLines[0], /every precondition/);
  assert.match(
    outcome.launchLines[1],
    /^parallel: T003 was refused a place in a group \(scope: the scope overlaps the scope of T002\)$/,
  );

  // The same refusal is still in the plan, as it always was: the line is the
  // plan's own reason, read out, not a second source of truth.
  const serial = outcome.plan.phases.flatMap((phase) => phase.serial);
  const refused = serial.find((one) => one.id === "T003");
  assert.equal(refused?.reason, "scope");
  assert.match(refused?.detail ?? "", /the scope overlaps the scope of T002/);
});

test("an unmarked task and a task alone in its run are not refusals: they name no line", () => {
  // No `[P]` anywhere: every task is serial by `marker`, which is not a
  // refusal — the run's console stays at the one launch message.
  const serialOnly = launchOf({ text: TASKS_SERIAL_ONLY });
  const noGroup = serialOnly.outcome;
  assert.equal(isParallelConfigurationError(noGroup), false);
  if (!isParallelConfigurationError(noGroup)) {
    assert.equal(noGroup.fallback, "no-group");
    assert.equal(noGroup.launchLines.length, 1, "no refusal line for an unmarked task");
    assert.match(noGroup.launchLines[0], /no-group/);
    assert.equal(
      noGroup.launchLines.some((line) => line.includes("T001")),
      false,
      "the unmarked T001 is named by no line",
    );
  }
  // The default fixture holds T001 and T003 alone in their runs: admitted by
  // every check, refused by none, and named by no line (the group test above
  // already pins `launchLines.length === 1` for the same fixture).
  const alone = launchOf().outcome;
  assert.equal(isParallelConfigurationError(alone), false);
  if (!isParallelConfigurationError(alone)) {
    const serial = alone.plan.phases.flatMap((phase) => phase.serial);
    assert.ok(
      serial.some((one) => one.reason === "alone-in-its-run-of-admitted-tasks"),
      "the fixture really holds a task alone in its run",
    );
    assert.equal(
      alone.launchLines.some((line) => line.includes("was refused")),
      false,
      "a task alone in its run names no refusal line",
    );
  }
});

test("an empty inner check set admits no group (F142-FR-012)", () => {
  const { outcome } = launchOf({ innerCheckSet: [] });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, "no-group", "a phase whose checks are excluded has no group");
  assert.equal(outcome.loopLineField, "parallel=off reason=no-group");
});

test("the classic strategy refuses the layer with the reason classic", () => {
  const { outcome } = launchOf({ preconditions: { loopStrategy: "classic" } });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, "classic");
  assert.equal(outcome.loopLineField, "parallel=off reason=classic");
});

test("a harness that declares no concurrency refuses the group with the reason harness", () => {
  const { outcome } = launchOf({
    // The `claude` path: the adapter declares no concurrency capability, so
    // F142-FR-020 refuses a group to it.
    preconditions: { harness: { state: "declared" } },
  });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.on, false);
  assert.equal(outcome.fallback, "harness");
  assert.equal(outcome.loopLineField, "parallel=off reason=harness");
});

/* ------------------------------------------------------------------ *
 * 4. The ranks of the real merge (F142-FR-002, F142-FR-016, F142-FR-019).
 * ------------------------------------------------------------------ */

test("the parity profile forces the option off, with nothing of the layer", () => {
  const { outcome, observed } = launchOf({ units: { userConfiguration: "on", profile: "parity" } });
  assert.equal(outcome.units, "off", "F142-FR-002: the parity profile forces off");
  assert.deepEqual(observed.stored, []);
  assert.deepEqual(observed.emitted, []);
  assert.deepEqual(outcome.fields, { [UNITS_KEY]: "off" });
});

test("the winning rank of the units switch decides: the environment over the project file", () => {
  const on = launchOf({ units: { projectConfiguration: "off", environment: "on" } });
  assert.equal(isParallelConfigurationError(on.outcome), false);
  if (!isParallelConfigurationError(on.outcome)) {
    assert.equal(on.outcome.on, true, "F142-FR-016: the environment rank wins");
    assert.equal(on.observed.stored.length, 1);
  }
  const off = launchOf({ units: { environment: "off", projectConfiguration: "on" } });
  assert.equal(off.outcome.units, "off", "the same rank wins the other way");
  assert.deepEqual(off.observed.stored, []);
});

test("a worker count over its ceiling refuses the launch and is never clamped", () => {
  const { outcome, observed } = launchOf({ workers: { userConfiguration: { workers: 5 } } });
  assert.equal(isParallelConfigurationError(outcome), true, "F142-FR-019");
  if (!isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.key, "loop.parallel.workers");
  assert.match(outcome.message, /above the ceiling/);
  assert.deepEqual(observed.stored, [], "a refused launch stores nothing");
  assert.deepEqual(observed.emitted, [], "a refused launch emits nothing");
});

test("a project-configuration worker count is carried, for the layer to report as ignored", () => {
  // A widening key from project configuration never raises the count: it is
  // carried so `workersInForce` can report the doctor line (F100-FR-202).
  const { outcome } = launchOf({
    workers: {
      projectConfiguration: { workers: 6, workersMax: 6 },
      userConfiguration: { workers: 2 },
    },
  });
  assert.equal(isParallelConfigurationError(outcome), false);
  if (isParallelConfigurationError(outcome)) return;
  assert.equal(outcome.fields["loop.parallel.workers"], "2", "the project value is ignored");
  assert.equal(outcome.fields["loop.parallel.workersMax"], "4", "the default ceiling stands");
});

/* ------------------------------------------------------------------ *
 * 5. The task list at launch (F142-FR-007, F142-FR-017).
 * ------------------------------------------------------------------ */

test("the task list at launch carries the grammar's reading and the heading fact", () => {
  const tasks = taskListAsReadAtLaunch(TASKS_THREE_PARALLEL, phasesOf(TASKS_THREE_PARALLEL));
  assert.deepEqual(
    tasks.map((task) => task.id),
    ["T001", "T002", "T003", "T010", "T011", "T012"],
  );
  assert.equal(tasks[0].marked, true, "T001 carries [P]");
  assert.equal(tasks[1].marked, false);
  assert.equal(tasks[0].phase, 1);
  assert.equal(tasks[3].phase, 2);
  assert.equal(tasks[0].ticked, undefined, "T001 is unticked");
  assert.equal(tasks[2].ticked, true, "T003 is ticked");
  assert.equal(tasks[0].headingBefore, undefined, "the first task of a phase has no heading");
  assert.equal(tasks[1].headingBefore, undefined, "no heading stands before T002");
  assert.equal(tasks[2].headingBefore, true, "a heading stands between T002 and T003");
  assert.equal(tasks[3].headingBefore, undefined, "a phase change is not a headingBefore");
});

/* ------------------------------------------------------------------ *
 * 6. The parallel keys of the loop configuration, through the real merge.
 * ------------------------------------------------------------------ */

function configFixture(project?: string, user?: string): { home: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "specstride-parcfg-"));
  const home = join(root, "home");
  const dir = join(root, "work");
  mkdirSync(home);
  mkdirSync(dir);
  if (project !== undefined) writeFileSync(join(dir, "specstride.yaml"), project);
  if (user !== undefined) {
    mkdirSync(join(home, ".config", "specstride"), { recursive: true });
    writeFileSync(join(home, ".config", "specstride", "config.yaml"), user);
  }
  return { home, dir };
}

const CONFIG_ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "" };

test("the parallel keys of the loop configuration come from the real merge", () => {
  // The catalogue types `loop.parallel.units` a boolean: the file spells it
  // `true`, and the mapping carries it as `on`, the value of the switch. The
  // switch and the worker count ride the user file, because the project file
  // may only narrow (F110-FR-018) and `on` over the default `off` widens.
  const { home, dir } = configFixture(
    "schema: 1\nloop:\n  parallel:\n    quota_headroom: 40\n",
    "schema: 1\nloop:\n  parallel:\n    units: true\n    workers: 3\n",
  );
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: CONFIG_ENV });
    assert.deepEqual(loop.parallel.units, { userConfiguration: "on" });
    assert.deepEqual(loop.parallel.workers, { userConfiguration: { workers: 3 } });
    assert.equal(loop.parallel.quotaHeadroomPerCent, 40);
    assert.deepEqual(loop.parallel.allowDetect, {});
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("a project file cannot switch the option on (F110-FR-018)", () => {
  // The project file may only narrow: `units: true` over the default `off`
  // widens, so the trust filter ignores it and the merge keeps the default.
  const { home, dir } = configFixture("schema: 1\nloop:\n  parallel:\n    units: true\n");
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: CONFIG_ENV });
    assert.deepEqual(loop.parallel.units, {}, "the widening offer of the project file is gone");
    assert.deepEqual(loop.parallel.workers, {});
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("the project file outranks the user file for the units switch", () => {
  // The eight ranks of annex X §X.2 order highest first: the project file
  // (rank 5) stands above the user file (rank 6), so with both files carrying
  // the switch the project's value wins and the user's is shadowed.
  // `loop.parallel.allow_detect` is a key of user configuration only (its row
  // names the layer U alone), so the project file cannot carry it at all. The
  // project file holds the strict value `false`, which the filter accepts.
  const { home, dir } = configFixture(
    "schema: 1\nloop:\n  parallel:\n    units: false\n",
    "schema: 1\nloop:\n  parallel:\n    units: false\n    allow_detect: true\n",
  );
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: CONFIG_ENV });
    assert.deepEqual(
      loop.parallel.units,
      { projectConfiguration: "off" },
      "the project file wins; the user file's value is shadowed",
    );
    assert.deepEqual(loop.parallel.allowDetect, { userConfiguration: true });
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("the units switch reads the environment rank, and the profile rides along", () => {
  const { home, dir } = configFixture();
  try {
    const loop = loopConfigurationOf({
      home,
      workdir: dir,
      environment: { ...CONFIG_ENV, SPECSTRIDE_LOOP_PARALLEL_UNITS: "on" },
    });
    assert.deepEqual(loop.parallel.units, { environment: "on" });
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("a worker count in the launch contract wins over user configuration", () => {
  // The pin files of a run promote the keys they name to the launch contract
  // rank; `loopConfigurationOf` reads no pin, so this test reads the merge of
  // the two configuration files and the launch-contract rank stays empty —
  // which is itself the mapping's contract: the rank is filled only from a
  // pin, and the user value keeps standing where no pin named it.
  const { home, dir } = configFixture(undefined, "schema: 1\nloop:\n  parallel:\n    workers: 2\n");
  try {
    const loop = loopConfigurationOf({ home, workdir: dir, environment: CONFIG_ENV });
    assert.deepEqual(loop.parallel.workers, { userConfiguration: { workers: 2 } });
    assert.equal(loop.parallel.workers.launchContract, undefined);
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});
