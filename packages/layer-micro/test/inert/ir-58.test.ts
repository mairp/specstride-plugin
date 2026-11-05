/**
 * CT-115-158 (T091, IR-58; F115-FR-007) — characterization of the integrity
 * rule IR-58: no difference until engaged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptCheckpoint,
  createAttemptEngagement,
  effectiveCommands,
  effectiveTimeLimit,
  promptAdditions,
  runCallPoint,
} from "../../src/strategy/engaged.ts";

const CLASSIC = ["npm test", "npm run typecheck"];

test("IR-58: until engaged, time limits equal the classic loop", () => {
  assert.equal(effectiveTimeLimit(createAttemptEngagement(), 300_000), 300_000);
});

test("IR-58: until engaged, runtime commands equal the classic loop exactly", () => {
  assert.deepEqual([...effectiveCommands(createAttemptEngagement(), CLASSIC)], CLASSIC);
});

test("IR-58: until engaged, no call point and no prompt differs from the layer off", () => {
  const inert = createAttemptEngagement();
  for (const point of [
    "contributePrompt",
    "afterPass",
    "betweenPasses",
    "nextPassBlock",
    "onEvidence",
    "contributeCriticInput",
    "resume",
    "report",
  ] as const) {
    assert.equal(runCallPoint(inert, point).directive, "none", point);
  }
  assert.deepEqual([...promptAdditions(inert)], ["checkpoint-contract-block"]);
});

test("IR-58: engagement is caused only by an accepted checkpoint", () => {
  const engaged = acceptCheckpoint(createAttemptEngagement());
  assert.equal(engaged.state, "engaged");
  assert.equal(engaged.acceptedCheckpoints, 1);
});
