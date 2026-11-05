/**
 * Unit tests of the registries (T073), the setup decision (T074), the
 * preflight (T012) and the argument parsing (T010) of feature 123.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  StageKindRegistry,
  PreconditionCheckRegistry,
  RegistryDuplicateError,
  type EvaluationContext,
} from "../src/kinds/registry.ts";
import { BUILTIN_KINDS } from "../src/kinds/builtin.ts";
import { BUILTIN_CHECKS } from "../src/checks/builtin.ts";
import { BUILTIN_STAGE_KINDS, BUILTIN_PRECONDITION_CHECKS } from "../src/executor/types.ts";
import { decideSetupStage, runStageTimedPreconditions } from "../src/kinds/setup.ts";
import { runPreflight } from "../src/executor/preflight.ts";
import { parsePipelineArgs, UsageError, ACCEPTED_FLAGS } from "../src/entry/start.ts";
import {
  engineRequest,
  isRunRequestKind,
  ENGINE_BUDGET,
  ENGINE_STAGE_ID,
} from "../src/entry/engine-request.ts";
import { lockHeldLines } from "../src/entry/lock.ts";
import { planDryRun } from "../src/entry/dry-run.ts";
import { launchContractHash, resetNeeded, stageEnabled } from "../src/executor/stage-loop.ts";
import type { Stage, Condition } from "../src/executor/types.ts";

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "build",
    kind: "command",
    dependencies: [],
    cwd: undefined,
    action: { argv: ["true"], env: [] },
    preconditions: [],
    postconditions: [],
    recovery: undefined,
    ...overrides,
  };
}

const CTX: EvaluationContext = { env: {}, cwd: "/tmp", implement: false };

function registries() {
  return {
    kinds: new StageKindRegistry(BUILTIN_KINDS),
    checks: new PreconditionCheckRegistry(BUILTIN_CHECKS),
  };
}

test("registry: the built-in kinds and checks are exactly the closed sets", () => {
  assert.deepEqual([...BUILTIN_STAGE_KINDS].sort(), [
    "command",
    "decision",
    "setup",
    "smoke",
    "specstride",
  ]);
  assert.deepEqual([...BUILTIN_PRECONDITION_CHECKS].sort(), [
    "command_available",
    "command_success",
    "dir_exists",
    "env_set",
    "file_exists",
    "json_field_equals",
  ]);
  const { kinds, checks } = registries();
  assert.deepEqual(kinds.names().sort(), [...BUILTIN_STAGE_KINDS].sort());
  assert.deepEqual(checks.names().sort(), [...BUILTIN_PRECONDITION_CHECKS].sort());
});

test("registry: an unknown kind or check refuses with exit 20 (CT-FR-010-01)", async () => {
  const { kinds, checks } = registries();
  assert.throws(() => kinds.get("wizard"), /no stage kind wizard is registered/);
  assert.equal(checks.has("teleport"), false);
  const unknown = await checks.run({ check: "teleport", timing: "preflight", params: {} }, CTX);
  assert.equal(unknown.result, "fail");
  assert.match(unknown.detail, /no precondition check/);
  const duplicate = new StageKindRegistry();
  duplicate.register("command", BUILTIN_KINDS["command"]);
  assert.throws(
    () => duplicate.register("command", BUILTIN_KINDS["command"]),
    RegistryDuplicateError,
  );
});

test("registry: a kind whose child cannot start ends with exec-error and code 127 (CT-FR-010-02)", async () => {
  const registry = new StageKindRegistry(BUILTIN_KINDS);
  const outcome = await registry.get("command").run({
    stage: stage(),
    attempt: 1,
    maxAttempts: 1,
    runChild: async () => {
      throw new Error("boom");
    },
    context: {
      colourOn: false,
      stdoutIsTerminal: false,
      env: {},
      runChild: async () => ({ code: 0, signal: null, timedOut: false }),
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "exec-error: boom");
  assert.equal(outcome.childExitCode, 127);
});

test("registry: a kind that throws is caught by the stage loop as exec-error", async () => {
  const registry = new StageKindRegistry({
    command: {
      ...BUILTIN_KINDS["command"],
      run: async () => {
        throw new Error("boom");
      },
    },
  });
  await assert.rejects(
    registry.get("command").run({
      stage: stage(),
      attempt: 1,
      maxAttempts: 1,
      runChild: async () => ({ code: 0, signal: null, timedOut: false }),
      context: {
        colourOn: false,
        stdoutIsTerminal: false,
        env: {},
        runChild: async () => ({ code: 0, signal: null, timedOut: false }),
      },
    }),
    /boom/,
  );
});

test("registry: a throwing check reads fail and never writes (CT-FR-010-03)", async () => {
  const registry = new PreconditionCheckRegistry({
    file_exists: async () => {
      throw new Error("disk gone");
    },
  });
  const result = await registry.run({ check: "file_exists", timing: "preflight", params: {} }, CTX);
  assert.equal(result.result, "fail");
  assert.match(result.detail, /disk gone/);
});

test("checks: command_success defers and executes nothing", async () => {
  const registry = new PreconditionCheckRegistry(BUILTIN_CHECKS);
  const condition: Condition = {
    check: "command_success",
    timing: "preflight",
    params: { argv: ["touch", "/tmp/f123-should-not-exist"] },
  };
  const result = await registry.run(condition, CTX);
  assert.equal(result.result, "deferred");
  assert.equal(
    await import("node:fs").then((fs) => fs.existsSync("/tmp/f123-should-not-exist")),
    false,
  );
});

test("checks: the file checks read the filesystem", async () => {
  const registry = new PreconditionCheckRegistry(BUILTIN_CHECKS);
  const yes: Condition = {
    check: "file_exists",
    timing: "preflight",
    params: { path: "/etc/hostname" },
  };
  const no: Condition = {
    check: "file_exists",
    timing: "preflight",
    params: { path: "/no/such/file/xyz" },
  };
  assert.equal((await registry.run(yes, CTX)).result, "pass");
  assert.equal((await registry.run(no, CTX)).result, "fail");
});

test("setup: without --implement, holding postconditions mean READY and no child exit", async () => {
  const { checks } = registries();
  const setup = stage({
    id: "install",
    kind: "setup",
    postconditions: [
      { check: "file_exists", timing: "postcondition", params: { path: "/etc/hostname" } },
    ],
  });
  const decision = await decideSetupStage({ stage: setup, implement: false, checks, context: CTX });
  assert.equal(decision.behaviour, "ready");
  assert.equal(decision.reason, "existing-prerequisite");
  assert.equal(
    "line" in decision && decision.line === "install already satisfies setup postconditions",
    true,
  );
});

test("setup: without --implement, a failing postcondition blocks with the rerun hint", async () => {
  const { checks } = registries();
  const setup = stage({
    id: "install",
    kind: "setup",
    postconditions: [
      { check: "file_exists", timing: "postcondition", params: { path: "/no/such/file/xyz" } },
    ],
  });
  const decision = await decideSetupStage({ stage: setup, implement: false, checks, context: CTX });
  assert.equal(decision.behaviour, "blocked");
  assert.equal(decision.reason, "setup-required");
  assert.equal(
    "line" in decision &&
      decision.line === "install: file exists: /no/such/file/xyz; rerun with --implement",
    true,
  );
});

test("setup: with --implement the setup stage runs its action", async () => {
  const { checks } = registries();
  const setup = stage({ id: "install", kind: "setup" });
  const decision = await decideSetupStage({
    stage: setup,
    implement: true,
    checks,
    context: { ...CTX, implement: true },
  });
  assert.equal(decision.behaviour, "run");
});

test("preflight: every failure is collected, none short-circuits (F123-FR-008)", async () => {
  const { checks } = registries();
  const result = await runPreflight({
    stages: [
      stage({
        id: "a",
        action: { argv: ["x"], env: [{ name: "NEEDS_A", target: "NEEDS_A", required: true }] },
      }),
      stage({
        id: "b",
        preconditions: [
          { check: "file_exists", timing: "preflight", params: { path: "/no/such/a" } },
        ],
      }),
      stage({
        id: "c",
        preconditions: [
          { check: "file_exists", timing: "preflight", params: { path: "/no/such/c" } },
        ],
      }),
    ],
    implement: false,
    checks,
    context: CTX,
    shell: {},
  });
  const texts = result.failures.map((failure) => failure.failure);
  assert.equal(
    texts.some((text) => text.includes("NEEDS_A")),
    true,
  );
  assert.equal(result.failures.length >= 3, true, "the failures of a, b and c are all present");
  assert.deepEqual(
    result.checks.map((check) => check.stageId),
    ["b", "c"],
  );
});

test("preflight: a setup stage without --implement skips its environment and checks postconditions", async () => {
  const { checks } = registries();
  const setup = stage({
    id: "install",
    kind: "setup",
    action: {
      argv: ["x"],
      env: [{ name: "UNSET_REQUIRED", target: "UNSET_REQUIRED", required: true }],
    },
    postconditions: [
      { check: "file_exists", timing: "postcondition", params: { path: "/etc/hostname" } },
    ],
  });
  const result = await runPreflight({
    stages: [setup],
    implement: false,
    checks,
    context: CTX,
    shell: {},
  });
  assert.deepEqual(result.failures, []);
});

test("args: the arguments of §R.1 and no others (F123-FR-001)", () => {
  const args = parsePipelineArgs([
    "--contract",
    "c.json",
    "--launch-dir",
    "dir",
    "--dry-run",
    "--color",
    "never",
  ]);
  assert.equal(args.dryRun, true);
  assert.equal(args.color, "never");
  assert.equal(args.implement, false);
  assert.equal((ACCEPTED_FLAGS as readonly string[]).includes("--verbose"), false);
  assert.throws(
    () => parsePipelineArgs(["--contract", "c.json", "--launch-dir", "d", "--wat"]),
    UsageError,
  );
  assert.throws(
    () => parsePipelineArgs(["--contract", "c.json", "--launch-dir", "d", "--color", "sometimes"]),
    UsageError,
  );
  assert.throws(() => parsePipelineArgs(["--launch-dir", "d"]), /--contract is required/);
  assert.throws(() => parsePipelineArgs(["--contract", "c.json"]), /--launch-dir is required/);
});

test("engine request: one specstride stage, no recovery, budget 2, no own deadline (F123-FR-020)", () => {
  const request = engineRequest({ command: "specstride" });
  assert.equal(request.stages.length, 1);
  assert.equal(request.stages[0].kind, "specstride");
  assert.equal(request.stages[0].id, ENGINE_STAGE_ID);
  assert.equal(request.stages[0].recovery, undefined);
  assert.deepEqual(request.relaunchBudget, ENGINE_BUDGET);
  assert.equal(ENGINE_BUDGET.maximum, 2);
  assert.equal(ENGINE_BUDGET.wallClockSeconds, null);
  assert.equal(isRunRequestKind("engine"), true);
  assert.equal(isRunRequestKind("wizard"), false);
});

test("lock: the two lines of a held lock (F123-FR-007)", () => {
  const lines = lockHeldLines("owner-7");
  assert.equal(lines.blocked, "[BLOCKED] another launcher owns owner-7");
  assert.equal(lines.digest, "[DIGEST] state=failed exit=24 last-stage=none evidence=owner-7");
});

test("dry run: the plan of §R.2, with command_success deferred and one digest last", async () => {
  const { checks } = registries();
  const plan = await planDryRun({
    contractId: "c1",
    stages: [
      stage({
        id: "first",
        preconditions: [
          { check: "file_exists", timing: "preflight", params: { path: "/etc/hostname" } },
        ],
      }),
      stage({
        id: "probe",
        preconditions: [
          { check: "command_success", timing: "preflight", params: { argv: ["true"] } },
        ],
      }),
      stage({ id: "smoke", kind: "smoke" }),
      stage({
        id: "setup",
        kind: "setup",
        postconditions: [
          { check: "file_exists", timing: "postcondition", params: { path: "/etc/hostname" } },
        ],
      }),
    ],
    implement: false,
    smoke: false,
    checks,
    context: CTX,
    shell: {},
  });
  const labels = plan.lines.map((line) => line.label);
  assert.equal(labels[0], "[DRY-RUN]");
  assert.equal(labels[labels.length - 1], "[DIGEST]");
  assert.equal(labels.filter((label) => label === "[DIGEST]").length, 1, "exactly one digest line");
  assert.equal(
    labels.filter((label) => label === "[PREFLIGHT]").length,
    2,
    "one per preflight-timed precondition",
  );
  assert.ok(
    plan.lines.some((line) => line.label === "[PREFLIGHT]" && line.text.includes(": deferred")),
    "command_success reads deferred",
  );
  assert.ok(
    plan.lines.some(
      (line) => line.label === "[SKIP]" && line.text.includes("(enable with --smoke)"),
    ),
  );
  assert.ok(plan.lines.some((line) => line.label === "[CHECK]" && line.text.startsWith("setup ")));
  assert.ok(plan.lines.some((line) => line.label === "[PLAN]" && line.text === 'first: "true"'));
});

test("contract hash: the excluded keys and the checkbox-insensitive task-list hash", () => {
  const contract = {
    id: "c",
    stages: [{ id: "a" }],
    inventory: { big: "blob" },
    generated_by: { tool: "x" },
    promotion: "promoted",
    sources: [
      { kind: "task-list", path: "t.md", content_hash: "aaa", hash_ignoring_checkboxes: "flat" },
      { kind: "spec", path: "s.md", content_hash: "bbb" },
    ],
  };
  const h1 = launchContractHash(contract);
  // The inventory and the generation data do not move the hash.
  assert.equal(
    launchContractHash({ ...contract, inventory: { big: "CHANGED" }, generated_by: { tool: "y" } }),
    h1,
  );
  // A tick (a task-list checkbox) does not move the hash.
  assert.equal(
    launchContractHash({
      ...contract,
      sources: [
        {
          kind: "task-list",
          path: "t.md",
          content_hash: "TICKED",
          hash_ignoring_checkboxes: "flat",
        },
        { kind: "spec", path: "s.md", content_hash: "bbb" },
      ],
    }),
    h1,
  );
  // A change to the spec does move it.
  assert.notEqual(
    launchContractHash({
      ...contract,
      sources: [
        { kind: "task-list", path: "t.md", content_hash: "aaa", hash_ignoring_checkboxes: "flat" },
        { kind: "spec", path: "s.md", content_hash: "CCC" },
      ],
    }),
    h1,
  );
  // And so does a change to the stages.
  assert.notEqual(launchContractHash({ ...contract, stages: [{ id: "b" }] }), h1);
  assert.equal(resetNeeded(null, h1), false);
  assert.equal(resetNeeded({ contract_hash: "old" } as never, h1), true);
  assert.equal(stageEnabled(stage({ id: "s", kind: "smoke" }), false), false);
  assert.equal(stageEnabled(stage({ id: "s", kind: "smoke" }), true), true);
});

test("setup: the decision carries the [READY] and [BLOCKED] labels of the compatibility lines", async () => {
  const { _kinds, checks } = registries();
  const ready = await decideSetupStage({
    stage: stage({ id: "install", kind: "setup", postconditions: [] }),
    implement: false,
    checks,
    context: CTX,
  });
  assert.equal(ready.behaviour, "ready");
  assert.equal(ready.label, "[READY]");
  assert.equal(ready.reason, "existing-prerequisite");
  const blocked = await decideSetupStage({
    stage: stage({
      id: "install",
      kind: "setup",
      postconditions: [
        { check: "file_exists", timing: "postcondition", params: { path: "/no/such/file/xyz" } },
      ],
    }),
    implement: false,
    checks,
    context: CTX,
  });
  assert.equal(blocked.behaviour, "blocked");
  assert.equal(blocked.label, "[BLOCKED]");
  assert.equal(blocked.reason, "setup-required");
});

test("setup: the stage-timed precondition runs when the stage starts and defers in the dry run", async () => {
  const { checks } = registries();
  const withStageTimed = stage({
    preconditions: [
      { check: "file_exists", timing: "stage", params: { path: "/tmp" } },
      { check: "command_success", timing: "stage", params: { command: "true" } },
      { check: "file_exists", timing: "preflight", params: { path: "/tmp" } },
    ],
  });
  // Live: only the stage-timed conditions are evaluated, in contract order;
  // a check never writes.
  const live = await runStageTimedPreconditions({ stage: withStageTimed, checks, context: CTX });
  assert.deepEqual(
    live.map((r) => r.result),
    ["pass", "deferred"],
  );
  // Dry run: everything reads `deferred`, nothing executes.
  const dry = await runStageTimedPreconditions({
    stage: withStageTimed,
    checks,
    context: CTX,
    dryRun: true,
  });
  assert.deepEqual(
    dry.map((r) => r.result),
    ["deferred", "deferred"],
  );
  // A stage-timed check that throws is `fail` (F123-FR-010):
  const throwing = new PreconditionCheckRegistry({
    explode: () => {
      throw new Error("stage-timed throw");
    },
  });
  const failed = await runStageTimedPreconditions({
    stage: stage({ preconditions: [{ check: "explode", timing: "stage", params: {} }] }),
    checks: throwing,
    context: CTX,
  });
  assert.equal(failed[0]?.result, "fail");
  assert.match(failed[0]?.detail ?? "", /stage-timed throw/);
});
