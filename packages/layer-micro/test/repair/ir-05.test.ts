/**
 * CT-115-105 (T063, IR-05, F115-FR-028) — characterization: an inner result
 * delays and never skips the phase gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closingCheck } from "../../src/closing/closing-check.ts";

test("CT-115-105 (IR-05): a failing closing check delays the gate — the proposer returns to work", () => {
  const outcome = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 0,
    cyclesLeft: 3,
  });
  assert.equal(outcome.action, "return-to-work");
});

test("CT-115-105 (IR-05): the returns are spent — the gate is reached, unchanged, and never skipped", () => {
  const outcome = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 2,
    cyclesLeft: 3,
  });
  assert.deepEqual(outcome, { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 });
});

test("CT-115-105 (IR-05): no path of the closing check names a state without the phase gate", () => {
  const inputs = [
    { declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 0, cyclesLeft: 0 },
    { declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 1, cyclesLeft: 5 },
    { declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 2, cyclesLeft: 5 },
    { declaredUnit: false, treeFingerprint: "f", returnsToWorkUsed: 0, cyclesLeft: 5 },
    {
      switchOn: false,
      declaredUnit: true,
      treeFingerprint: "f",
      returnsToWorkUsed: 0,
      cyclesLeft: 5,
    },
    {
      declaredUnit: true,
      lastPassedTreeFingerprint: "f",
      treeFingerprint: "f",
      returnsToWorkUsed: 0,
      cyclesLeft: 5,
    },
  ] as const;
  for (const input of inputs) {
    const outcome = closingCheck({ ...input });
    // IR-05 — the outcome never replaces the gate with a verdict of its own:
    // no action of the closing check approves the phase, keeps a result or
    // reads `pass` for the run. `return-to-work` delays; `phase-gate` and the
    // skips hand the evidence to the gate as it is.
    assert.ok(
      outcome.action === "return-to-work" ||
        outcome.action === "phase-gate" ||
        outcome.action === "skip",
    );
    assert.ok(!("verdict" in outcome));
    assert.ok(!("approved" in outcome));
  }
});
