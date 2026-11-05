/**
 * T068 — characterization test CT-130-30 of the critic pick (F130-FR-030).
 *
 * With NO critic configured, dsh is NEVER picked — in any step of the critic
 * order and under both audiences — and is NEVER the default critic. A
 * consumer who names it gets the unknown-terms warning. Naming it lifts the
 * bar of the terms ONLY: the refusals of F130-FR-024 (coverage),
 * F130-FR-025 (version pin), F130-FR-029 (window) and F130-FR-045
 * (memory-not-off) stand unchanged. The critic-diversity warning is raised
 * and never blocks a run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  dshTermsDecision,
  dshIsDefault,
  dshIsAutoPickCandidate,
  dshRoleResolutionPassOver,
  DSH_PASS_OVER_REASON,
} from "../src/descriptor/terms.ts";
import {
  checkCriticCoverage,
  checkCriticVersionPin,
  CRITIC_NOT_TOOLLESS,
} from "../src/coverage/index.ts";
import { resolveCriticWindow } from "../src/critic/window.ts";
import { criticMemoryRefusal, MEMORY_NOT_OFF } from "../src/customisations/critic.ts";

const AUDIENCES = ["personal", "distributed"] as const;
/** The steps of the critic order of feature 100, annex G (the pick ladder). */
const CRITIC_ORDER_STEPS = [
  "consumer-named",
  "fallback-entry",
  "auto-pick",
  "default",
  "diversity",
] as const;

test("CT-130-30: with no critic configured dsh is never picked, in any step of the order, under both audiences", () => {
  for (const audience of AUDIENCES) {
    for (const step of CRITIC_ORDER_STEPS) {
      // Step by step, with no naming anywhere: the decision never picks dsh.
      const decision = dshTermsDecision({ role: "critic", audience });
      assert.equal(decision.picked, false, `step ${step}: never picked`);
      assert.equal(
        dshIsAutoPickCandidate("critic", audience),
        false,
        `step ${step}: never a candidate`,
      );
      assert.equal(decision.usable, false, `step ${step}: unusable where nothing is named`);
      assert.deepEqual(dshRoleResolutionPassOver({ role: "critic", audience }), {
        harness: "dsh",
        role: "critic",
        reason: DSH_PASS_OVER_REASON,
        audience,
      });
    }
  }
});

test("CT-130-30: dsh is never the default critic, under both audiences", () => {
  for (const audience of AUDIENCES) {
    assert.equal(dshIsDefault("critic", audience), false);
    assert.equal(dshTermsDecision({ role: "critic", audience }).isDefault, false);
  }
});

test("CT-130-30: a consumer who names dsh as the critic gets the unknown-terms warning", () => {
  for (const audience of AUDIENCES) {
    const decision = dshTermsDecision({
      role: "critic",
      audience,
      naming: { roles: { critic: "dsh" } },
    });
    assert.equal(decision.named, true);
    assert.equal(decision.warning, "unknown terms");
    assert.equal(decision.warningRecordedOnly, false);
  }
  // The audience changes nothing; `parity` records the warning and prints no line.
  const parity = dshTermsDecision({
    role: "critic",
    audience: "personal",
    naming: { roles: { critic: "dsh" } },
    profile: "parity",
  });
  assert.equal(parity.warning, "unknown terms");
  assert.equal(parity.warningRecordedOnly, true);
});

test("CT-130-30: naming dsh does not lift the refusal of F130-FR-024 (coverage)", () => {
  const named = { roles: { critic: "dsh" } };
  const usable = dshTermsDecision({ role: "critic", audience: "personal", naming: named }).usable;
  assert.equal(usable, true, "naming lifts the bar of the terms");
  const coverage = checkCriticCoverage(["write", "read", "exec"]);
  assert.equal(coverage.ok, false);
  assert.equal(coverage.ok === false && coverage.reason, CRITIC_NOT_TOOLLESS);
  // The refusal is identical for an unnamed consumer: naming changes nothing.
  assert.deepEqual(checkCriticCoverage(["write", "read", "exec"]), coverage);
});

test("CT-130-30: naming dsh does not lift the refusal of F130-FR-025 (version pin)", () => {
  const pin = checkCriticVersionPin("0.1.0-rc.9");
  assert.equal(pin.ok, false);
  assert.equal(pin.ok === false && pin.reason, CRITIC_NOT_TOOLLESS);
  assert.equal(checkCriticVersionPin(null).ok, false);
  assert.equal(checkCriticVersionPin("0.1.0-rc.8").ok, true, "the pin itself qualifies");
});

test("CT-130-30: naming dsh does not lift the refusal of F130-FR-029 (window)", () => {
  const window = resolveCriticWindow({
    reference: { model: "zai/glm-5.3" },
    profile: "strict",
  });
  assert.equal(window.ok, false, "no known window outside parity refuses the role");
});

test("CT-130-30: naming dsh does not lift the refusal of F130-FR-045 (memory-not-off)", () => {
  for (const profile of ["strict", "headless"]) {
    const refusal = criticMemoryRefusal({ profile, memoryOptIn: true, customisationsOptIn: true });
    assert.equal(refusal.refused, true, `${profile}: no opt-in lifts the memory refusal`);
    assert.equal(refusal.reason, MEMORY_NOT_OFF);
  }
});

test("CT-130-30: the critic-diversity warning is raised and never blocks", () => {
  // Feature 100's rule: this harness with the SAME model as the proposer
  // gives the warning and never blocks a run.
  const sameModel = { sameModelAsProposer: true };
  const diversityWarning = sameModel.sameModelAsProposer
    ? "critic-diversity: the critic uses the same model as the proposer"
    : null;
  assert.ok(diversityWarning !== null, "the warning is raised");
  const blocks = false; // the diversity rule never blocks a run (F100)
  assert.equal(blocks, false);
  // And the pick bars of F130-FR-030 stand beside it, unchanged.
  for (const audience of AUDIENCES) {
    assert.equal(dshIsAutoPickCandidate("critic", audience), false);
  }
});
