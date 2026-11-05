/**
 * CT-115-13 (T018, F115-FR-013) — every command of the inner set runs in
 * every check, and a check does not stop at a failed command.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";
import type { InnerCommand } from "../../src/callpoints/between-passes.ts";

const INNER_SET: InnerCommand[] = [
  { id: "typecheck", argv: ["tsc", "-p", "."] },
  { id: "tests", argv: ["npm", "test"] },
  { id: "lint", argv: ["eslint", "."] },
];

function services(exits: Record<string, number>) {
  const ran: string[] = [];
  return {
    ran,
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command: InnerCommand) => {
        ran.push(command.id);
        return { id: command.id, exit: exits[command.id] ?? 0 };
      },
      innerSet: INNER_SET,
      stopRequested: () => false,
      budgetAvailable: () => true,
      enterQuotaPause: async () => {},
    },
  };
}

test("CT-115-13: every command runs, in manifest order", async () => {
  const { ran, services: s } = services({});
  const outcome = await betweenPasses({
    services: s,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(ran, ["typecheck", "tests", "lint"]);
  assert.equal(outcome.results.length, 3);
  assert.equal(outcome.decision?.outcome, "kept");
});

test("CT-115-13: a failed command does not stop the check", async () => {
  const { ran, services: s } = services({ tests: 1 });
  const outcome = await betweenPasses({
    services: s,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(ran, ["typecheck", "tests", "lint"]);
  assert.equal(outcome.decision?.outcome, "repair");
  assert.equal(outcome.directive, "repair");
  assert.deepEqual(
    outcome.results.map((r) => r.exit),
    [0, 1, 0],
  );
});

test("CT-115-13: the inner set is the manifest entries marked inner, less the exclusions", async () => {
  const { services: s } = services({});
  // The layer runs exactly the set it is given: it never adds a command of
  // its own and never runs a command twice in one check.
  const seen: string[] = [];
  const outcome = await betweenPasses({
    services: {
      ...s,
      runCheckCommand: async (command) => {
        seen.push(command.id);
        return { id: command.id, exit: 0 };
      },
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.deepEqual(
    seen,
    INNER_SET.map((c) => c.id),
  );
  assert.equal(outcome.results.length, INNER_SET.length);
});
