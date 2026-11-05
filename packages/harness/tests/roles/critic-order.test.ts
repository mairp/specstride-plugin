/**
 * T023 — CT-124-37 (F124-FR-037): the critic order.
 *
 * The four steps in order; a configured critic is never overridden; one
 * pick per launch; one model tier only gives the same model with the
 * warning; no critic at all refuses the launch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pickCritic } from "../../src/roles/critic-order.ts";
import { candidate, defaultHarness, orderInput } from "./critic-fixtures.ts";

test("CT-124-37 the four steps in order", () => {
  // Step 1 over everything.
  const step1 = pickCritic(
    orderInput({
      configured: {
        harness: "configured-critic",
        model: "configured-model",
        providerId: "provider-configured",
        state: "tested",
        form: "tool-less",
        windowTokens: 128000,
        windowSource: "declared",
      },
      gateway: candidate({ id: "gateway-a" }),
      discovered: [candidate({ id: "disc-a" })],
    }),
  );
  assert.equal(step1.outcome, "picked");
  if (step1.outcome !== "picked") return;
  assert.equal(step1.pick.step, "configured");

  // Step 2 over step 3.
  const step2 = pickCritic(
    orderInput({
      gateway: candidate({ id: "gateway-a" }),
      discovered: [candidate({ id: "disc-a" })],
    }),
  );
  assert.equal(step2.outcome === "picked" && step2.pick.step, "gateway");

  // Step 3 over step 4.
  const step3 = pickCritic(orderInput({ discovered: [candidate({ id: "disc-a" })] }));
  assert.equal(step3.outcome === "picked" && step3.pick.step, "discovered");

  // Step 4 when nothing else is there.
  const step4 = pickCritic(orderInput({}));
  assert.equal(step4.outcome === "picked" && step4.pick.step, "default-model-tier");
});

test("CT-124-37 a configured critic is never overridden by discovery or the automatic pick", () => {
  const result = pickCritic(
    orderInput({
      configured: {
        harness: "configured-critic",
        model: "configured-model",
        providerId: "provider-configured",
        state: "declared",
        form: "tool-less",
        windowTokens: 128000,
        windowSource: "declared",
      },
      discovered: [candidate({ id: "disc-a" })],
      autoPick: true,
    }),
  );
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.step, "configured");
  assert.equal(result.pick.automatic, false);
  assert.equal(result.pick.harness, "configured-critic");
  assert.equal(result.planEntries.length, 0, "no runner-up of an automatic pick");
});

test("CT-124-37 the automatic pick is made once per launch and holds for every phase", () => {
  const result = pickCritic(
    orderInput({
      discovered: [candidate({ id: "disc-a" }), candidate({ id: "disc-b", modelId: "model-b" })],
      phases: ["1", "2", "3"],
    }),
  );
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.step, "discovered");
  assert.equal(result.pick.automatic, true);
  // One pick, applied to every phase without resolving again.
  assert.equal(result.planEntries.filter((entry) => entry.kind === "runner-up").length, 1 * 3);
  for (const phase of ["1", "2", "3"]) {
    assert.ok(result.planEntries.some((entry) => entry.phase === phase));
  }
  // The runners-up are the ranked rest (decision D-7).
  assert.deepEqual(
    result.pick.runnersUp.map((runnerUp) => runnerUp.harness),
    ["disc-b"],
  );
  assert.equal(result.pick.runnersUp[0]!.rank, 1);
});

test("CT-124-37 one model tier only gives the same model with the warning", () => {
  const result = pickCritic(
    orderInput({
      defaultHarness: defaultHarness({
        modelTiers: [{ tier: "proposer", model: "default-model" }],
      }),
    }),
  );
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.step, "default-model-tier");
  assert.equal(result.pick.model, "default-model");
  assert.equal(result.pick.diversity, "same-model");
  assert.equal(result.pick.sameModelWarning, true);
});

test("CT-124-37 no critic at all refuses the launch, naming every candidate with its reason", () => {
  const refused = pickCritic(
    orderInput({
      discovered: [candidate({ id: "disc-a", state: "declared", kind: "cli" })],
      defaultHarness: defaultHarness({ supportsCritic: false }),
    }),
  );
  assert.equal(refused.outcome, "refused");
  if (refused.outcome !== "refused") return;
  assert.equal(refused.exitCode, 4, "launch refuses with 4");
  assert.match(refused.line, /SPECSTRIDE-ROLES/);
  assert.match(refused.line, /disc-a/);
  assert.ok(refused.reasons.length >= 1);
  const run = pickCritic(
    orderInput({ defaultHarness: defaultHarness({ supportsCritic: false }), surface: "run" }),
  );
  assert.equal(run.outcome === "refused" && run.exitCode, 3, "a foreground run refuses with 3");
});

test("CT-124-37 the plan entries of step 4 land in every phase with no critic configured", () => {
  const result = pickCritic(orderInput({ phases: ["1", "2"] }));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.deepEqual(
    result.planEntries.map((entry) => [entry.phase, entry.harness]),
    [
      ["1", "default-harness"],
      ["2", "default-harness"],
    ],
  );
});
