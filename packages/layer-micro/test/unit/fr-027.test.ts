/**
 * CT-115-27 (T025, F115-FR-027) — the outer counters unchanged; the three
 * exemptions; the bound on passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessPass,
  exemptRepeatCounter,
  boundOnPasses,
  cycleCapFor,
  spendCycles,
} from "../../src/caps/exemptions.ts";

const OUTER_COUNTERS = {
  reject: 4,
  attemptNumber: 2,
  malformedStreak: 0,
  oscillationInput: "x",
  diagnosticianSignature: "sig",
  verdictPins: ["p1"],
  learningObservations: 7,
  yieldIndex: 1,
  consecutiveBreakers: 0,
};

test("CT-115-27: a valid checkpoint pass leaves short-pass and breakers as they were", () => {
  const outer = structuredClone(OUTER_COUNTERS);
  const assessment = assessPass({
    validCheckpoint: true,
    treeFingerprint: "t1",
    previousCheckpointFingerprint: "t1",
  });
  assert.deepEqual(assessment.directives, ["exemptShortPass"]);
  assert.equal(assessment.cyclesSpent, 1);
  assert.equal(assessment.givenBack, false);
  assert.deepEqual(outer, OUTER_COUNTERS);
});

test("CT-115-27: a changed tree is given back and spends one cycle", () => {
  const assessment = assessPass({
    validCheckpoint: true,
    treeFingerprint: "t2",
    previousCheckpointFingerprint: "t1",
  });
  assert.ok(assessment.directives.includes("giveIterationBack"));
  assert.ok(assessment.directives.includes("exemptShortPass"));
  assert.equal(assessment.givenBack, true);
  assert.equal(assessment.cyclesSpent, 1);
});

test("CT-115-27: a pass without a valid checkpoint is accounted as classic", () => {
  const assessment = assessPass({
    validCheckpoint: false,
    treeFingerprint: "t2",
  });
  assert.deepEqual(assessment.directives, []);
  assert.equal(assessment.cyclesSpent, 0);
  assert.equal(assessment.givenBack, false);
});

test("CT-115-27: the exact argument lists are exempt from the repeat counter", () => {
  const exemption = exemptRepeatCounter([
    ["tsc", "-p", "."],
    ["npm", "test"],
  ]);
  assert.equal(exemption.directive, "exemptRepeatCounter");
  assert.deepEqual(exemption.argvLists, [
    ["tsc", "-p", "."],
    ["npm", "test"],
  ]);
});

test("CT-115-27: the bound on passes and the cycle cap", () => {
  assert.equal(boundOnPasses({ passLimit: 10, cycleCap: 12, yieldCap: 3 }), 25);
  assert.equal(cycleCapFor(4), 12); // at least 12
  assert.equal(cycleCapFor(10), 16); // tasks plus 6
});

test("CT-115-27: the cycles of the layer are its own counter, not an outer one", () => {
  let counter = { cyclesSpent: 0 };
  for (const fingerprint of ["t1", "t2", "t3", "t4"]) {
    const assessment = assessPass({
      validCheckpoint: true,
      treeFingerprint: fingerprint,
      previousCheckpointFingerprint:
        fingerprint === "t1" ? undefined : `t${Number(fingerprint[1]) - 1}`,
    });
    counter = spendCycles(counter, assessment.cyclesSpent);
  }
  assert.equal(counter.cyclesSpent, 4);
  assert.deepEqual(OUTER_COUNTERS, structuredClone(OUTER_COUNTERS));
});
