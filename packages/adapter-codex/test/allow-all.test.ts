/**
 * T027 / CT-131-10 — the policy of the allow-all flag (F131-FR-010).
 *
 * The flag is passed only under the `parity` profile, or where the consumer
 * opted in to containment C0 in USER configuration (`sandbox.level` = C0).
 * The same value `C0` that comes from the environment, from a flag or from
 * project configuration gives NO opt-in: the pass runs contained. No critic
 * path ever receives the flag. The adapter asserts no sandbox by itself and
 * sets no variable that says the run is sandboxed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_ALLOW_ALL_FLAG,
  CODEX_DEFAULT_SANDBOX_MODE,
  allowAllPermitted,
  buildCriticReadonlyPlan,
  buildProposerPlan,
  type C0OptInValue,
} from "../src/arguments.ts";

test("CT-131-10: the flag is passed under the parity profile", () => {
  const plan = buildProposerPlan({ profile: "parity", prompt: "p", workdir: "/w" });
  assert.equal(plan.args.includes(CODEX_ALLOW_ALL_FLAG), true);
  assert.equal(plan.record.allowAll, true);
  assert.equal(allowAllPermitted({ profile: "parity" }), true);
});

test("CT-131-10: a C0 opt-in in the USER configuration passes the flag", () => {
  const values: C0OptInValue[] = [{ value: "C0", source: "user-config" }];
  const plan = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/w",
    c0OptInValues: values,
  });
  assert.equal(plan.args.includes(CODEX_ALLOW_ALL_FLAG), true);
  assert.match(plan.record.allowAllReason, /C0 opted in/);
  assert.equal(allowAllPermitted({ profile: "default", c0OptInValues: values }), true);
});

test("CT-131-10: C0 from the environment, a flag or project configuration gives NO opt-in", () => {
  for (const source of ["environment", "flag", "project-config"] as const) {
    const values: C0OptInValue[] = [{ value: "C0", source }];
    assert.equal(
      allowAllPermitted({ profile: "default", c0OptInValues: values }),
      false,
      `source ${source} must not opt in`,
    );
    const plan = buildProposerPlan({
      profile: "default",
      prompt: "p",
      workdir: "/w",
      c0OptInValues: values,
    });
    assert.equal(
      plan.args.includes(CODEX_ALLOW_ALL_FLAG),
      false,
      `source ${source} must not put the flag on the list`,
    );
    assert.equal(plan.record.allowAll, false);
    assert.equal(plan.record.sandboxMode, CODEX_DEFAULT_SANDBOX_MODE);
    // A value that is not C0, even from the user configuration, opts in to nothing.
    assert.equal(
      allowAllPermitted({
        profile: "default",
        c0OptInValues: [{ value: "C1", source: "user-config" }],
      }),
      false,
    );
  }
});

test("CT-131-10: without any opt-in the pass runs contained", () => {
  const plan = buildProposerPlan({ profile: "default", prompt: "p", workdir: "/w" });
  assert.equal(plan.record.sandboxMode, CODEX_DEFAULT_SANDBOX_MODE);
  assert.equal(plan.record.allowAll, false);
  assert.match(plan.record.allowAllReason, /contained/);
});

test("CT-131-10: no critic path ever receives the allow-all flag — even at parity", () => {
  const critic = buildCriticReadonlyPlan({ workdir: "/w", model: "gpt-5" });
  assert.equal(critic.args.includes(CODEX_ALLOW_ALL_FLAG), false);
  assert.equal(critic.record.allowAll, false);
  assert.equal(critic.record.role, "critic");
  // The critic builder accepts no opt-in at all: the type has no field for
  // one, and a mixed value list can never reach the critic list.
  const proposerC0 = buildProposerPlan({
    profile: "default",
    prompt: "p",
    workdir: "/w",
    c0OptInValues: [{ value: "C0", source: "user-config" }],
  });
  assert.equal(proposerC0.record.role, "proposer");
  assert.equal(critic.args.includes(CODEX_ALLOW_ALL_FLAG), false);
});

test("CT-131-10: the adapter asserts no sandbox by itself and sets no sandbox variable", () => {
  // The plan carries no IS_SANDBOX-like variable and no assertion field.
  const plan = buildProposerPlan({ profile: "default", prompt: "p", workdir: "/w" });
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("IS_SANDBOX"), false);
  assert.equal(serialized.includes("sandboxAsserted"), false);
  assert.equal(Object.hasOwn(plan.record, "sandboxAssertion"), false);
});
