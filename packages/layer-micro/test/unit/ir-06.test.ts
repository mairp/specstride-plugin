/**
 * CT-115-106 (T027, IR-06, F115-FR-027) — inner events change no counter
 * of the outer loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";
import { assessPass } from "../../src/caps/exemptions.ts";

const OUTER = Object.freeze({
  reject: 3,
  attemptNumber: 1,
  malformedStreak: 0,
  oscillationInput: "in",
  diagnosticianSignature: "sig",
  verdictPins: Object.freeze(["p"]),
  learningObservations: 2,
  yieldIndex: 0,
  consecutiveBreakers: 0,
});

test("CT-115-106: a whole inner check leaves every outer counter as it was", async () => {
  const before = JSON.stringify(OUTER);
  const outcomes = await Promise.all([
    betweenPasses({
      services: {
        verifyManifest: () => ({ ok: true }) as const,
        endPassProcesses: async () => ({ guaranteed: true }),
        runCheckCommand: async (command) => ({ id: command.id, exit: 1 }),
        innerSet: [{ id: "a", argv: ["a"] }],
        stopRequested: () => false,
        budgetAvailable: () => true,
        enterQuotaPause: async () => {},
      },
      taskIds: ["T010"],
      budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
    }),
    betweenPasses({
      services: {
        verifyManifest: () => ({ ok: false, kind: "manifest-mismatch" }) as const,
        endPassProcesses: async () => ({ guaranteed: false }),
        runCheckCommand: async (command) => ({ id: command.id, exit: 0 }),
        innerSet: [],
        stopRequested: () => false,
        budgetAvailable: () => true,
        enterQuotaPause: async () => {},
      },
      taskIds: ["T010"],
      budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
    }),
  ]);
  assert.equal(outcomes[0].decision?.outcome, "repair");
  assert.equal(outcomes[1].directive, "layerOffForAttempt");
  assert.equal(JSON.stringify(OUTER), before);
});

test("CT-115-106: the pass assessment changes no outer counter", () => {
  const before = JSON.stringify(OUTER);
  assessPass({ validCheckpoint: true, treeFingerprint: "t2", previousCheckpointFingerprint: "t1" });
  assessPass({ validCheckpoint: false, treeFingerprint: "t2" });
  assert.equal(JSON.stringify(OUTER), before);
});
