/**
 * T062 — CT-109-37, the two forms of the `completion` level and their
 * admission (F109-FR-037).
 *
 * The level has exactly two forms; the form is fixed before the call and
 * cannot change; the second form and the proof by pinned configuration are
 * refused for a harness that is not tested; no flag that allows all tools is
 * ever admitted on a critic path; and there is no default context window for
 * an unknown model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_TOOLS_FLAGS,
  COMPLETION_FORMS,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  FIRST_FORM,
  SECOND_FORM,
  admitForm,
  fixFormBeforeCall,
  formIsUnchanged,
  formNeedsTestedAdapter,
  isAllToolsFlag,
  isCompletionForm,
  knownContextWindow,
} from "../../src/proof/forms.ts";

const WINDOW = { tokens: 200000, source: "declared by the consumer" };

test("CT-109-37: the completion level has exactly two forms (row 28)", () => {
  assert.deepEqual([...COMPLETION_FORMS], ["tool-less", "read-only-tools"]);
  assert.equal(FIRST_FORM, "tool-less");
  assert.equal(SECOND_FORM, "read-only-tools");
  assert.equal(isCompletionForm("tool-less"), true);
  assert.equal(isCompletionForm("read-only-tools"), true);
  assert.equal(isCompletionForm("all-tools"), false);
  assert.equal(isCompletionForm(undefined), false);
});

test("CT-109-37: the form is fixed before the call and cannot change", () => {
  const fixed = fixFormBeforeCall("tool-less");
  assert.equal("accepted" in fixed, false);
  assert.deepEqual(fixed, { form: "tool-less", fixedBeforeCall: true });
  assert.equal(formIsUnchanged(fixed, "tool-less"), true);
  assert.equal(formIsUnchanged(fixed, "read-only-tools"), false);
  // A missing or unknown form is refused before any call can be made.
  for (const declared of [undefined, "all-tools", null]) {
    const refusal = fixFormBeforeCall(declared);
    assert.ok("accepted" in refusal);
    if ("accepted" in refusal) {
      assert.equal(refusal.failure, CRITIC_NOT_TOOLLESS);
      assert.equal(refusal.stopReason, CRITIC_CONFIG_STOP_REASON);
      assert.equal(refusal.engineExitCode, ENGINE_EXIT_CODE_OF_CRITIC_CONFIG);
    }
  }
});

test("CT-109-37: the second form is refused for a harness that is not tested", () => {
  const fixed = fixFormBeforeCall("read-only-tools");
  assert.equal("accepted" in fixed, false);
  const refusal = admitForm({
    fixed: fixed as never,
    proofKind: "read-only-sandbox",
    tested: false,
    contextWindow: WINDOW,
  });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.failure, CRITIC_NOT_TOOLLESS);
  assert.match(refusal.reason, /tested harness adapter only/);
  assert.equal(formNeedsTestedAdapter("read-only-tools"), true);
  assert.equal(formNeedsTestedAdapter("tool-less"), false);
});

test("CT-109-37: the proof by pinned configuration is refused for a harness that is not tested", () => {
  const fixed = fixFormBeforeCall("tool-less");
  assert.equal("accepted" in fixed, false);
  const refusal = admitForm({
    fixed: fixed as never,
    proofKind: "pinned-configuration",
    tested: false,
    contextWindow: WINDOW,
  });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.failure, CRITIC_NOT_TOOLLESS);
  assert.match(refusal.reason, /pinned configuration/);
  // The same proof is admitted for a tested harness adapter.
  const admitted = admitForm({
    fixed: fixed as never,
    proofKind: "pinned-configuration",
    tested: true,
    contextWindow: WINDOW,
  });
  assert.deepEqual(admitted, { accepted: true, form: "tool-less" });
});

test("CT-109-37: no flag that allows all tools is admitted on a critic path", () => {
  for (const flag of ALL_TOOLS_FLAGS) {
    assert.equal(isAllToolsFlag(flag), true, flag);
    const fixed = fixFormBeforeCall("tool-less");
    assert.equal("accepted" in fixed, false);
    const refusal = admitForm({
      fixed: fixed as never,
      proofKind: "initial-record",
      tested: true,
      flags: ["--quiet", flag],
      contextWindow: WINDOW,
    });
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.failure, CRITIC_NOT_TOOLLESS);
    assert.match(refusal.reason, /allows all tools/);
  }
  assert.equal(isAllToolsFlag("--tools"), false);
  assert.equal(isAllToolsFlag("--allow-all-tools=true"), true);
  // Without such a flag the call is admitted.
  const fixed = fixFormBeforeCall("tool-less");
  assert.equal("accepted" in fixed, false);
  const admitted = admitForm({
    fixed: fixed as never,
    proofKind: "initial-record",
    tested: true,
    flags: ["--quiet"],
    contextWindow: WINDOW,
  });
  assert.equal(admitted.accepted, true);
});

test("CT-109-37: no default context window for an unknown model", () => {
  const known = knownContextWindow({
    model: "known-model",
    knownModels: { "known-model": 128000 },
  });
  assert.deepEqual(known, { tokens: 128000, source: "model-list" });
  const declared = knownContextWindow({
    model: "any-model",
    declared: { tokens: 97000, source: "roles.critic.contextTokens" },
    knownModels: {},
  });
  assert.deepEqual(declared, { tokens: 97000, source: "roles.critic.contextTokens" });
  const refusal = knownContextWindow({ model: "unknown-model", knownModels: {} });
  assert.ok("accepted" in refusal);
  if ("accepted" in refusal) {
    assert.equal(refusal.failure, CRITIC_NOT_TOOLLESS);
    assert.match(refusal.reason, /no default window/);
  }
});
