/**
 * CT-115-132 (T034, IR-32, F115-FR-015) — end the processes of the pass
 * before a check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

test("CT-115-132: no command of the check starts before the pass processes end", async () => {
  const order: string[] = [];
  await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => {
        order.push("end-pass-processes");
        return { guaranteed: true };
      },
      runCheckCommand: async (command) => {
        order.push(`run:${command.id}`);
        return { id: command.id, exit: 0 };
      },
      innerSet: [
        { id: "a", argv: ["a"] },
        { id: "b", argv: ["b"] },
      ],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {
        order.push("quota-pause");
      },
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(order[0], "end-pass-processes");
  assert.ok(order.indexOf("end-pass-processes") < order.indexOf("run:a"));
  assert.ok(order.indexOf("end-pass-processes") < order.indexOf("run:b"));
});

test("CT-115-132: a detached job of an accepted yield is not the layer's to end", async () => {
  // The engine reports what it ended; the layer records the guarantee and
  // reads protection `detect` when the guarantee is missing.
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: false }),
      runCheckCommand: async (command) => ({ id: command.id, exit: 0 }),
      innerSet: [{ id: "a", argv: ["a"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.protectionDetect, true);
});
