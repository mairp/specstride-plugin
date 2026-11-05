/**
 * CT-115-113 (T031, IR-13, F115-FR-015) — output of a test the proposer
 * ran is never a result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";

test("CT-115-113: the output the proposer left is not consulted for the decision", async () => {
  // The proposer ran the tests itself and left output that says everything
  // passes. The runtime observes exit 1 on the same tree.
  const proposerOutput = {
    file: "unit:u1:check:1", // a result file the proposer must never write
    text: "ok 1 - everything passes\n# exit 0",
    claimedExit: 0,
  };
  let readFrom: string | undefined;
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => {
        // The runtime observes the exit status itself; the layer never
        // reads the file the proposer left.
        return { id: command.id, exit: 1 };
      },
      innerSet: [{ id: "tests", argv: ["npm", "test"] }],
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(outcome.results, [{ id: "tests", exit: 1 }]);
  assert.equal(outcome.decision?.outcome, "repair");
  assert.equal(readFrom, undefined);
  assert.equal(proposerOutput.claimedExit, 0); // ignored
});
