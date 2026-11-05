/**
 * CT-115-21 (T023, F115-FR-021) — unchecked is never a pass and never
 * fails a unit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome } from "../../src/unit/outcome.ts";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

test("CT-115-21: a unit with no command to run is unchecked", () => {
  const decision = decideOutcome([], {
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(decision, { outcome: "unchecked", directive: "none" });
  assert.notEqual(decision.directive, "keep");
  assert.notEqual(decision.directive, "unresolved");
});

test("CT-115-21: an empty inner set never fails a unit", async () => {
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async () => {
        throw new Error("no command should run");
      },
      innerSet: [],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(outcome.results, []);
  assert.equal(outcome.decision?.outcome, "unchecked");
  assert.notEqual(outcome.directive, "layerOffForAttempt");
  assert.notEqual(outcome.directive, "unresolved");
});
