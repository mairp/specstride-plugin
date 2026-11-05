/**
 * CT-115-20 (T052, F115-FR-020) — characterization: flaky — one re-run, both
 * results, excluded, still at the verification gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flakyResults,
  innerSetAfterExclusions,
  rerunFailedCommand,
  stillAtVerificationGate,
} from "../../src/unit/flaky.ts";

test("CT-115-20: a failed command runs once more on the same fingerprint", () => {
  const outcome = rerunFailedCommand(
    { id: "lint", exit: 1 },
    {
      treeFingerprint: "t1",
      rerunFingerprint: "t1",
      rerun: () => ({ id: "lint", exit: 1 }),
    },
  );
  assert.deepEqual(outcome, { kind: "confirmed", result: { id: "lint", exit: 1 } });
});

test("CT-115-20: the second result differs — flaky, with both observed results", () => {
  const outcome = rerunFailedCommand(
    { id: "lint", exit: 1 },
    {
      treeFingerprint: "t1",
      rerunFingerprint: "t1",
      rerun: () => ({ id: "lint", exit: 0 }),
    },
  );
  if ("kind" in outcome && outcome.kind === "flaky") {
    assert.equal(outcome.first.exit, 1);
    assert.equal(outcome.second.exit, 0);
    assert.equal(outcome.excludedForAttempt, true);
  } else {
    assert.fail("expected flaky");
  }
  const both = flakyResults({ id: "lint", exit: 1 }, { id: "lint", exit: 0 });
  assert.deepEqual(both, [
    { id: "lint", exit: 1, conditions: ["flaky"] },
    { id: "lint", exit: 0, conditions: ["flaky"] },
  ]);
});

test("CT-115-20: the flaky command is excluded from the inner set for the phase attempt", () => {
  const innerSet = [
    { id: "unit", argv: ["npm", "test"] },
    { id: "lint", argv: ["npm", "run", "lint"] },
  ];
  const rest = innerSetAfterExclusions(innerSet, ["lint"]);
  assert.deepEqual(rest, [{ id: "unit", argv: ["npm", "test"] }]);
});

test("CT-115-20: the flaky command still runs at the verification gate", () => {
  assert.equal(stillAtVerificationGate("lint", ["lint"]), true);
});

test("CT-115-20: no re-run for a passing command or a different fingerprint", () => {
  assert.deepEqual(
    rerunFailedCommand(
      { id: "lint", exit: 0 },
      { treeFingerprint: "t1", rerunFingerprint: "t1", rerun: () => ({ id: "lint", exit: 0 }) },
    ),
    { rerun: false, reason: "not-failed" },
  );
  assert.deepEqual(
    rerunFailedCommand(
      { id: "lint", exit: 1 },
      { treeFingerprint: "t1", rerunFingerprint: "t2", rerun: () => ({ id: "lint", exit: 0 }) },
    ),
    { rerun: false, reason: "different-fingerprint" },
  );
});
