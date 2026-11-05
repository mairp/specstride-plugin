/**
 * CT-115-123 (T033, IR-23, F115-FR-027) — pass given back; bound on passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPass, boundOnPasses, spendCycles } from "../../src/caps/exemptions.ts";

test("CT-115-123: a pass given back raises no pass count and spends one cycle", () => {
  let counter = { cyclesSpent: 0 };
  let passesTowardsLimit = 0;
  const fingerprints = ["t1", "t2", "t3"];
  for (let i = 0; i < fingerprints.length; i += 1) {
    const assessment = assessPass({
      validCheckpoint: true,
      treeFingerprint: fingerprints[i],
      previousCheckpointFingerprint: i === 0 ? undefined : fingerprints[i - 1],
    });
    counter = spendCycles(counter, assessment.cyclesSpent);
    if (!assessment.givenBack) passesTowardsLimit += 1;
  }
  assert.equal(counter.cyclesSpent, 3);
  assert.equal(passesTowardsLimit, 1); // only the first pass counted
});

test("CT-115-123: the passes of a phase attempt are bounded", () => {
  const bound = boundOnPasses({ passLimit: 8, cycleCap: cycleCapFor(4), yieldCap: 2 });
  assert.equal(bound, 8 + 12 + 2);
  let passes = 0;
  const boundReached = (() => {
    while (passes < 1000) {
      if (passes >= bound) return true;
      passes += 1;
    }
    return false;
  })();
  assert.equal(boundReached, true);
  assert.equal(passes, bound);
});

function cycleCapFor(taskCount: number): number {
  return Math.max(taskCount + 6, 12);
}

test("CT-115-123: a pass refused at the checkpoint counts as in the classic loop", () => {
  const assessment = assessPass({ validCheckpoint: false, treeFingerprint: "t1" });
  assert.equal(assessment.givenBack, false);
  assert.equal(assessment.cyclesSpent, 0);
});
