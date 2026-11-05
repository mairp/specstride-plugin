/**
 * CT-115-28 (T057, F115-FR-028) — characterization: the closing check — when
 * it runs, the two returns, the cycles spent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSING_CHECK_DEFAULT_ON,
  closingCheck,
  evidencePassCheckpoint,
  MAX_RETURNS_TO_WORK,
} from "../../src/closing/closing-check.ts";

test("CT-115-28: the closing check runs when phase evidence appears and a unit was declared", () => {
  assert.equal(CLOSING_CHECK_DEFAULT_ON, true);
  const outcome = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 0,
    cyclesLeft: 5,
  });
  assert.deepEqual(outcome, {
    action: "return-to-work",
    returnsToWork: 1,
    cyclesSpent: 1,
    cyclesLeft: 4,
  });
});

test("CT-115-28: the closing check does not run in an attempt without a declared unit", () => {
  assert.deepEqual(
    closingCheck({
      declaredUnit: false,
      treeFingerprint: "final",
      returnsToWorkUsed: 0,
      cyclesLeft: 5,
    }),
    { action: "skip", reason: "no-declared-unit" },
  );
});

test("CT-115-28: the closing check does not run when the last check passed on the same tree", () => {
  assert.deepEqual(
    closingCheck({
      declaredUnit: true,
      lastPassedTreeFingerprint: "final",
      treeFingerprint: "final",
      returnsToWorkUsed: 0,
      cyclesLeft: 5,
    }),
    { action: "skip", reason: "last-check-passed-same-tree" },
  );
});

test("CT-115-28: a failure returns the proposer to work at most twice", () => {
  assert.equal(MAX_RETURNS_TO_WORK, 2);
  const first = closingCheck({
    declaredUnit: true,
    treeFingerprint: "f",
    returnsToWorkUsed: 0,
    cyclesLeft: 5,
  });
  assert.deepEqual(first, {
    action: "return-to-work",
    returnsToWork: 1,
    cyclesSpent: 1,
    cyclesLeft: 4,
  });
  const second = closingCheck({
    declaredUnit: true,
    treeFingerprint: "f2",
    returnsToWorkUsed: 1,
    cyclesLeft: 4,
  });
  assert.deepEqual(second, {
    action: "return-to-work",
    returnsToWork: 2,
    cyclesSpent: 1,
    cyclesLeft: 3,
  });
  // The third failure cannot return: the evidence goes to the phase gate unchanged.
  const third = closingCheck({
    declaredUnit: true,
    treeFingerprint: "f3",
    returnsToWorkUsed: 2,
    cyclesLeft: 3,
  });
  assert.deepEqual(third, { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 });
});

test("CT-115-28: a return happens only while cycles remain", () => {
  assert.deepEqual(
    closingCheck({ declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 0, cyclesLeft: 0 }),
    { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 },
  );
});

test("CT-115-28: the switch of its own turns the closing check off", () => {
  assert.deepEqual(
    closingCheck({
      switchOn: false,
      declaredUnit: true,
      treeFingerprint: "f",
      returnsToWorkUsed: 0,
      cyclesLeft: 5,
    }),
    { action: "skip", reason: "switch-off" },
  );
});

test("CT-115-28: a valid checkpoint in the evidence pass is a declaration; the closing check is its check", () => {
  assert.deepEqual(evidencePassCheckpoint(true), {
    acceptedAsDeclaration: true,
    closingCheckServesAsItsCheck: true,
  });
  assert.deepEqual(evidencePassCheckpoint(false), {
    acceptedAsDeclaration: false,
    closingCheckServesAsItsCheck: false,
  });
});
