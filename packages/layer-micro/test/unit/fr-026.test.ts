/**
 * CT-115-26 (T024, F115-FR-026) — stop request, wall-clock budget and
 * quota pause during a check; accelerated phase attempt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";
import type { BetweenPassesServices, InnerCommand } from "../../src/callpoints/between-passes.ts";

const INNER_SET: InnerCommand[] = [
  { id: "a", argv: ["a"] },
  { id: "b", argv: ["b"] },
];

function make(state: { stop: boolean; budget: boolean }, stopAfterFirst = false) {
  const calls: string[] = [];
  const services: BetweenPassesServices = {
    verifyManifest: () => ({ ok: true }) as const,
    endPassProcesses: async () => {
      calls.push("end");
      return { guaranteed: true };
    },
    runCheckCommand: async (command) => {
      calls.push(`run:${command.id}`);
      if (stopAfterFirst && command.id === "a") state.stop = true; // the stop arrives mid-check
      return { id: command.id, exit: 0 };
    },
    innerSet: INNER_SET,
    stopRequested: () => {
      calls.push("poll");
      return state.stop;
    },
    budgetAvailable: () => state.budget,
    enterQuotaPause: async () => {
      calls.push("pause");
    },
  };
  return { calls, services };
}

test("CT-115-26: a stop request before the check starts runs no command", async () => {
  const { services } = make({ stop: true, budget: true });
  const outcome = await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.aborted, "stop-requested");
  assert.deepEqual(outcome.results, []);
});

test("CT-115-26: a stop request is seen at the next poll during the check", async () => {
  const { calls, services } = make({ stop: false, budget: true }, true);
  const outcome = await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.aborted, "stop-requested");
  assert.deepEqual(
    outcome.results.map((r) => r.id),
    ["a"],
  );
  assert.ok(calls.includes("run:a"));
  assert.ok(!calls.includes("run:b")); // the check stopped at the poll after "a"
});

test("CT-115-26: the wall-clock budget is checked during the check", async () => {
  const calls: string[] = [];
  const outcome = await betweenPasses({
    services: {
      verifyManifest: () => ({ ok: true }) as const,
      endPassProcesses: async () => ({ guaranteed: true }),
      runCheckCommand: async (command) => {
        calls.push(`run:${command.id}`);
        return { id: command.id, exit: 0 };
      },
      innerSet: INNER_SET,
      stopRequested: () => false,
      budgetAvailable: () => calls.length === 0, // the budget ends mid-check
      enterQuotaPause: async () => {},
    },
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.aborted, "budget-exhausted");
  assert.deepEqual(
    outcome.results.map((r) => r.id),
    ["a"],
  );
});

test("CT-115-26: a quota pause is entered at the boundary, once per check", async () => {
  const { calls, services } = make({ stop: false, budget: true });
  await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(calls.filter((c) => c === "pause").length, 1);
  assert.ok(calls.indexOf("pause") < calls.indexOf("run:a"));
});

test("CT-115-26: an accelerated phase attempt gets the same check manifest", async () => {
  const { services } = make({ stop: false, budget: true }, false);
  const outcome = await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
    accelerated: true,
  });
  assert.equal(outcome.acceleratedManifest, true);
  assert.equal(outcome.aborted, undefined);
});
