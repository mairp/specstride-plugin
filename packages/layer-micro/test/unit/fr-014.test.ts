/**
 * CT-115-14 (T019, F115-FR-014) — manifest hash and pins verified before a
 * check; on a mismatch the check does not run and the layer goes off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenPasses } from "../../src/callpoints/between-passes.ts";
import type { BetweenPassesServices } from "../../src/callpoints/between-passes.ts";

function servicesWith(kind: "ok" | "manifest-mismatch" | "pin-mismatch") {
  const calls: string[] = [];
  const services: BetweenPassesServices = {
    verifyManifest: () => {
      calls.push("verify");
      return kind === "ok" ? ({ ok: true } as const) : ({ ok: false, kind } as const);
    },
    endPassProcesses: async () => {
      calls.push("end");
      return { guaranteed: true };
    },
    runCheckCommand: async (command) => {
      calls.push(`run:${command.id}`);
      return { id: command.id, exit: 0 };
    },
    innerSet: [
      { id: "a", argv: ["a"] },
      { id: "b", argv: ["b"] },
    ],
    stopRequested: () => {
      calls.push("stop");
      return false;
    },
    budgetAvailable: () => true,
    enterQuotaPause: async () => {
      calls.push("pause");
    },
  };
  return { calls, services };
}

test("CT-115-14: the verification comes before every command of a check", async () => {
  const { calls, services } = servicesWith("ok");
  await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(calls[0], "stop");
  assert.equal(calls[1], "verify");
  assert.ok(calls.indexOf("run:a") > calls.indexOf("verify"));
  assert.ok(calls.indexOf("run:b") > calls.indexOf("verify"));
});

test("CT-115-14: a manifest mismatch runs no command and switches the layer off", async () => {
  const { calls, services } = servicesWith("manifest-mismatch");
  const outcome = await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.directive, "layerOffForAttempt");
  assert.deepEqual(outcome.integrityEvent, { kind: "manifest-mismatch" });
  assert.deepEqual(outcome.results, []);
  assert.ok(!calls.some((c) => c.startsWith("run:")));
});

test("CT-115-14: a pin mismatch runs no command either", async () => {
  const { calls, services } = servicesWith("pin-mismatch");
  const outcome = await betweenPasses({
    services,
    taskIds: ["T010"],
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(outcome.directive, "layerOffForAttempt");
  assert.deepEqual(outcome.integrityEvent, { kind: "pin-mismatch" });
  assert.ok(!calls.some((c) => c.startsWith("run:")));
});
