/**
 * CT-115-114 (T065, IR-14, F115-FR-020) — characterization: flaky — both
 * results stated, excluded for the attempt, still at the gate; a flaky
 * command is never a failure of the unit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { flakyResults, rerunFailedCommand } from "../../src/unit/flaky.ts";
import { decideOutcome } from "../../src/unit/outcome.ts";

test("CT-115-114 (IR-14): both observed results are stated, each with the condition flaky", () => {
  const both = flakyResults(
    { id: "lint", exit: 1, conditions: [] },
    { id: "lint", exit: 0, conditions: [] },
  );
  assert.equal(both.length, 2);
  assert.deepEqual(
    both.map((result) => [result.exit, result.conditions]),
    [
      [1, ["flaky"]],
      [0, ["flaky"]],
    ],
  );
});

test("CT-115-114 (IR-14): the flaky command is excluded for the attempt and still at the gate", () => {
  const outcome = rerunFailedCommand(
    { id: "lint", exit: 1 },
    { treeFingerprint: "t1", rerunFingerprint: "t1", rerun: () => ({ id: "lint", exit: 0 }) },
  );
  if (!("kind" in outcome) || outcome.kind !== "flaky") assert.fail("expected flaky");
  assert.equal(outcome.excludedForAttempt, true);
  assert.equal(outcome.stillAtVerificationGate, true);
});

test("CT-115-114 (IR-14): a flaky command is never a failure of the unit", () => {
  // The command is excluded: the unit is decided on the rest, and a unit
  // whose commands all passed is kept.
  const decision = decideOutcome(
    [
      { id: "lint", exit: 1, excluded: true },
      { id: "unit", exit: 0 },
    ],
    { taskIds: ["T010"], budget: { repairsLeft: {}, defaultRepairsLeft: 2 } },
  );
  assert.deepEqual(decision, { outcome: "kept", directive: "keep" });
});
