/**
 * CT-115-115 (T032, IR-15, F115-FR-021) — unchecked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome } from "../../src/unit/outcome.ts";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

test("CT-115-115: unchecked is its own status, neither pass nor failure", () => {
  const decision = decideOutcome([], {
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(decision.outcome, "unchecked");
  assert.equal(decision.directive, "none");
  for (const notIt of ["keep", "repair", "unresolved", "layerOffForAttempt"]) {
    assert.notEqual(decision.directive, notIt);
    assert.notEqual(decision.outcome, notIt);
  }
});

test("CT-115-115: a task no checkpoint named is unchecked, and counts no failure", () => {
  // An unnamed task has no check results at all: the decision for it is
  // made from an empty result list.
  const decision = decideOutcome([], {
    taskIds: [],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(decision.outcome, "unchecked");
});

test("CT-115-115: the empty inner set does not switch the layer off", async () => {
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => ({ id: command.id, exit: 0 }),
      innerSet: [],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.decision?.outcome, "unchecked");
  assert.equal(outcome.directive, "none");
  assert.equal(outcome.integrityEvent, undefined);
});
