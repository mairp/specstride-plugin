/**
 * T026 / CT-131-9 — the default invocation of the proposer (F131-FR-009).
 *
 * Outside the `parity` profile the pass starts as `exec` with the JSONL
 * stream option, the sandbox mode `workspace-write`, approvals set to
 * never, the working directory stated, and the prompt on standard input —
 * the prompt is NEVER in an argument list. The mode is stated on every call
 * and recorded. A pass never blocks on a permission prompt.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_ALLOW_ALL_FLAG,
  CODEX_APPROVALS_OVERRIDE,
  CODEX_DEFAULT_SANDBOX_MODE,
  buildProposerPlan,
  codexArgumentTable,
} from "../src/arguments.ts";

test("CT-131-9: the default argument list is exec with the JSONL option, the sandbox mode and the working directory", () => {
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "implement the thing",
    workdir: "/tmp/work",
  });
  assert.deepEqual(plan.args, [
    "exec",
    "--json",
    "-s",
    "workspace-write",
    "-C",
    "/tmp/work",
    "--ignore-user-config",
    "--ignore-rules",
    "-",
  ]);
  assert.equal(plan.args[0], "exec");
  assert.ok(plan.args.includes("--json"), "the JSONL stream option is on");
  assert.equal(plan.args[plan.args.indexOf("-s") + 1], CODEX_DEFAULT_SANDBOX_MODE);
  assert.equal(plan.args[plan.args.indexOf("-C") + 1], "/tmp/work");
});

test("CT-131-9: the prompt is on standard input and never an argument", () => {
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "secret prompt text that must not travel as an argument",
    workdir: "/tmp/work",
  });
  assert.equal(plan.promptOnStdin, true);
  assert.equal(plan.args[plan.args.length - 1], "-", "the list ends with the stdin marker");
  for (const argument of plan.args) {
    assert.ok(
      !argument.includes("secret prompt text"),
      `the prompt leaked into the argument list: ${argument}`,
    );
  }
});

test("CT-131-9: approvals are never, by the recorded configuration override — no permission prompt blocks a pass", () => {
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/tmp/work",
  });
  assert.deepEqual(plan.configOverrides, CODEX_APPROVALS_OVERRIDE);
  assert.equal(plan.configOverrides.approval_policy, "never");
  assert.equal(plan.record.approvals, "never");
});

test("CT-131-9: the mode is stated and recorded on EVERY call", () => {
  for (let call = 0; call < 3; call += 1) {
    const plan = buildProposerPlan({
      profile: "default",
      prompt: "p",
      workdir: "/tmp/work",
      model: call % 2 === 0 ? "gpt-5" : null,
    });
    assert.equal(plan.record.modeStated, true, `call ${call}: the mode is stated`);
    assert.equal(plan.record.sandboxMode, CODEX_DEFAULT_SANDBOX_MODE, `call ${call}`);
    assert.equal(plan.record.role, "proposer");
    assert.equal(plan.record.profile, "default");
  }
});

test("CT-131-9: no allow-all flag and no flag of the Claude arm of the baseline", () => {
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/tmp/work",
  });
  assert.equal(plan.args.includes(CODEX_ALLOW_ALL_FLAG), false);
  assert.equal(plan.record.allowAll, false);
});

test("CT-131-9: the model is passed only where a model was named", () => {
  const named = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/tmp/work",
    model: "gpt-5",
  });
  assert.deepEqual(named.args.slice(named.args.indexOf("-m"), named.args.indexOf("-m") + 2), [
    "-m",
    "gpt-5",
  ]);
  const unnamed = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/tmp/work",
    model: null,
  });
  assert.equal(unnamed.args.includes("-m"), false);
});

test("CT-131-9: the shape the builder produces is the shape the argument table states", () => {
  const table = codexArgumentTable();
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "{workdir}",
    ephemeral: false,
  });
  const shape = table.shapes["proposer-default"].filter((token) => !token.startsWith("["));
  assert.deepEqual(plan.args, shape);
  assert.equal(table.pin, "codex-cli 0.153.4");
});
