/**
 * CT-115-15 (T020, F115-FR-015) — the processes of the pass are ended
 * before a check; a result is the exit status the runtime observed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

test("CT-115-15: the processes of the pass end before the first command", async () => {
  const order: string[] = [];
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => {
        order.push("end");
        return { guaranteed: true };
      },
      runCheckCommand: async (command) => {
        order.push(`run:${command.id}`);
        return { id: command.id, exit: 0 };
      },
      innerSet: [{ id: "a", argv: ["a"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {
        order.push("pause");
      },
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.ok(order.indexOf("end") < order.indexOf("run:a"));
  assert.equal(outcome.protectionDetect, undefined);
});

test("CT-115-15: a process table the engine cannot clear reads protection detect", async () => {
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

test("CT-115-15: the result is the observed exit status, never a file", async () => {
  // The proposer wrote a result file that claims success; the layer never
  // reads it, and the observed status of the runner stands.
  const proposerResultFile = { exit: 0, output: "all green" };
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => ({ id: command.id, exit: 3 }),
      innerSet: [{ id: "a", argv: ["a"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(outcome.results, [{ id: "a", exit: 3 }]);
  assert.equal(outcome.decision?.outcome, "repair");
  assert.equal(proposerResultFile.exit, 0); // untouched, and never consulted
});
