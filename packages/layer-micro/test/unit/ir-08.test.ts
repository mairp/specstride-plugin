/**
 * CT-115-108 (T028, IR-08, F115-FR-014) — the manifest hash is verified
 * before every check; exclusions are by the runtime only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

function harness() {
  const order: string[] = [];
  let verifyCount = 0;
  return {
    order,
    verify: () => {
      verifyCount += 1;
      order.push(`verify#${verifyCount}`);
      return { ok: true } as const;
    },
  };
}

test("CT-115-108: the verification happens once before every check", async () => {
  const h = harness();
  await betweenPasses({
    services: {
      verifyManifest: h.verify,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => ({ id: command.id, exit: 0 }),
      innerSet: [{ id: "a", argv: ["a"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(h.order.length, 1);
  assert.match(h.order[0], /^verify#1$/);
});

test("CT-115-108: the layer runs the set it is given and excludes nothing", async () => {
  // One command of the set fails: the layer still runs the rest, and it
  // records no exclusion of its own — only the runtime excludes.
  const h = harness();
  const outcome = await betweenPasses({
    services: {
      verifyManifest: h.verify,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) =>
        command.id === "a" ? { id: command.id, exit: 1 } : { id: command.id, exit: 0 },
      innerSet: [
        { id: "a", argv: ["a"] },
        { id: "b", argv: ["b"] },
      ],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(
    outcome.results.map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.directive, "repair");
});
