// CT-125-24 (T057) — the model-tier ladder (F125-FR-033): the ladder is
// data pinned at launch; the model and the effort are stated on every
// rung; a fallback model is never passed; a rung the plan lacks is unknown.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRITIC_MODEL,
  LADDER_PIN,
  MODEL_LADDER,
  EFFORT_LEVELS,
  ladderAtLaunch,
  ladderRungFor,
  ladderRungIsKnown,
  modelTierArguments,
  models,
} from "../../src/index.ts";
import { ModelRefusedError, assertNoFallbackModel } from "../../src/invoke-proposer.ts";

describe("CT-125-24 — the ladder is data pinned at launch (F125-FR-033)", () => {
  it("the ladder is data, read at launch from data/models.json under the pin", () => {
    assert.equal(LADDER_PIN.pinnedAtLaunch, true);
    assert.equal(LADDER_PIN.source, "data/models.json");
    assert.equal(LADDER_PIN.cli, "2.1.284");
    assert.equal(LADDER_PIN.floor, "2.1.259");
    assert.equal(LADDER_PIN.verifiedOn, "2026-09-29");
    // The same data, in one place: the index's models and the proposal
    // seam's MODEL_LADDER agree, and both are non-empty and ordered.
    assert.equal(models.ladder.length, MODEL_LADDER.length);
    assert.ok(models.ladder.length >= 2);
  });

  it("every rung states its model and its effort, lowest first", () => {
    let previousOrder = -Infinity;
    for (const rung of ladderAtLaunch()) {
      assert.equal(typeof rung.model, "string");
      assert.ok(rung.model.startsWith("claude-"), rung.model);
      assert.ok(EFFORT_LEVELS.includes(rung.effort), rung.effort);
      assert.ok(rung.order > previousOrder);
      previousOrder = rung.order;
    }
  });

  it("the pinned rungs are exactly the data of data/models.json", () => {
    assert.deepEqual(
      ladderAtLaunch().map((rung) => [rung.model, rung.effort, rung.order]),
      models.ladder.map((rung) => [rung.model, rung.effort, rung.order]),
    );
  });

  it("no fallback model is ever passed", () => {
    assert.throws(
      () => assertNoFallbackModel(["-p", "--fallback-model", "claude-sonnet-4-5"]),
      ModelRefusedError,
    );
    // A clean argv passes.
    assert.doesNotThrow(() => assertNoFallbackModel(["-p", "--model", "claude-sonnet-4-5"]));
    // The builder itself refuses an off-ladder model rather than
    // substituting a rung.
    assert.throws(() => modelTierArguments({ model: "claude-haiku-4-5" }), ModelRefusedError);
  });

  it("a rung the plan lacks is unknown", () => {
    const [lowest, , highest] = ladderAtLaunch();
    // A rung the ladder holds, with its own effort, is known.
    assert.equal(ladderRungIsKnown(lowest.model, lowest.effort), true);
    assert.notEqual(ladderRungFor(lowest.model), null);
    // The same model with an effort the plan does not pair is unknown.
    assert.equal(ladderRungIsKnown(lowest.model, "xhigh"), false);
    // A model off the ladder is unknown; the adapter never substitutes.
    assert.equal(ladderRungIsKnown("claude-haiku-4-5", "low"), false);
    assert.equal(ladderRungFor("claude-haiku-4-5"), null);
    assert.equal(ladderRungFor(""), null);
    assert.ok(highest.order > lowest.order);
  });

  it("the model and effort arguments follow the rung the role plan names", () => {
    const rung = ladderAtLaunch()[0];
    assert.deepEqual(modelTierArguments({ model: rung.model, effort: rung.effort }), [
      "--model",
      rung.model,
      "--effort",
      rung.effort,
    ]);
    // No effort named: only the model argument.
    assert.deepEqual(modelTierArguments({ model: rung.model }), ["--model", rung.model]);
  });

  it("the critic's default model names a rung so the tiers differ", () => {
    assert.notEqual(ladderRungFor(DEFAULT_CRITIC_MODEL), null);
    const proposer = ladderAtLaunch()[0];
    assert.notEqual(DEFAULT_CRITIC_MODEL, proposer.model);
  });
});
