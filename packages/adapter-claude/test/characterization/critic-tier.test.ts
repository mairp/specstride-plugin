// CT-125-20 (T041) — the critic's model tier (F125-FR-026; F100-FR-024):
// the critic runs on the model the ROLE PLAN names and the adapter never
// chooses one; the same model raises the critic-diversity warning; a higher
// effort on the same model does NOT count as a different model and raises
// the warning too; an unknown model is reported as null, the test gives
// `unverified`, and the warning is raised. The warning is NEVER
// launch-blocking. Surfaces: transcript (the --model argument), state.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ModelRefusedError,
  buildCriticArgv,
  modelTierArguments,
} from "../../src/invoke-proposer.ts";
import { callCriticCli, criticDiversity } from "../../src/critic-cli.ts";

const MINTED = "3c4d5e6f-7a8b-4918-8276-4561237890ab";
const GOOD_STREAM = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: MINTED,
    tools: [],
    mcp_servers: [],
    plugins: [],
  }),
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "VERDICT: APPROVED" }] },
  }),
].join("\n");

describe("CT-125-20 — the critic's model tier (F125-FR-026)", () => {
  it("the critic runs on the model the role plan names — and only on that", async () => {
    const planModel = "claude-opus-4-5";
    const planEffort = "medium";
    // transcript: the model and the effort of the plan reach the command.
    const argv = [
      ...buildCriticArgv({
        role: "critic",
        profile: "default",
        authTier: 1,
        model: planModel,
        effort: planEffort,
        sessionId: MINTED,
        sessionMode: "fresh",
      }),
    ];
    assert.equal(argv[argv.indexOf("--model") + 1], planModel);
    assert.equal(argv[argv.indexOf("--effort") + 1], planEffort);
    assert.equal(
      modelTierArguments({ model: planModel, effort: planEffort }).join(" "),
      `--model ${planModel} --effort ${planEffort}`,
    );

    // state: the call record carries the model the plan named, not one the
    // adapter chose.
    const record = await callCriticCli({
      prompt: "Judge the evidence.",
      model: planModel,
      effort: planEffort,
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set(),
      termsAllowed: true,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      spawnCritic: () => ({ pid: 4250, stream: Promise.resolve(GOOD_STREAM) }),
    });
    assert.equal(record.model, planModel);
    assert.equal(record.effort, planEffort);

    // the adapter never chooses: a model off the pinned ladder is refused,
    // and an effort the harness does not name is refused.
    assert.throws(
      () => modelTierArguments({ model: "claude-unknown-9" }),
      (error: unknown) => error instanceof ModelRefusedError && error.reason === "unknown-model",
    );
    assert.throws(
      () => modelTierArguments({ model: planModel, effort: "extreme" }),
      (error: unknown) => error instanceof ModelRefusedError && error.reason === "unknown-effort",
    );
  });

  it("the same model raises the critic-diversity warning (F100-FR-024), recorded and never blocking", () => {
    const pick = criticDiversity({
      proposerModel: "claude-opus-4-5",
      criticModel: "claude-opus-4-5",
      proposerEffort: "medium",
      criticEffort: "medium",
    });
    assert.equal(pick.diversity, "same-model");
    assert.equal(pick.warning, true);
    assert.equal(pick.launchBlocking, false);
  });

  it("a higher effort on the same model does not count as a different model: the warning is raised (ruling 49)", () => {
    const pick = criticDiversity({
      proposerModel: "claude-opus-4-5",
      criticModel: "claude-opus-4-5",
      proposerEffort: "medium",
      criticEffort: "high",
    });
    assert.equal(pick.diversity, "same-model");
    assert.equal(pick.warning, true);
    assert.equal(pick.launchBlocking, false);
  });

  it("an unknown model is reported as null, the test gives `unverified`, and the warning is raised", () => {
    for (const input of [
      { proposerModel: null, criticModel: "claude-opus-4-5" },
      { proposerModel: "claude-opus-4-5", criticModel: null },
      { proposerModel: null, criticModel: null },
    ]) {
      const pick = criticDiversity({ ...input, proposerEffort: "medium", criticEffort: "medium" });
      assert.equal(pick.diversity, "unverified", JSON.stringify(input));
      assert.equal(pick.warning, true, JSON.stringify(input));
      assert.equal(pick.launchBlocking, false);
    }
    const nulls = criticDiversity({ proposerModel: null, criticModel: "claude-opus-4-5" });
    assert.equal(nulls.proposerModel, null);
  });

  it("a different model raises no warning, and the warning is never a launch check", () => {
    const pick = criticDiversity({
      proposerModel: "claude-sonnet-4-5",
      criticModel: "claude-opus-4-5",
    });
    assert.equal(pick.diversity, "different-model");
    assert.equal(pick.warning, false);
    // in every branch the pick records launchBlocking: false
    for (const branch of [pick, criticDiversity({})]) {
      assert.equal(branch.launchBlocking, false);
    }
  });
});
