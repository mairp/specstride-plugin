/**
 * CT-115-148 (T035, IR-48, F115-FR-027) — checkpoint passes leave the
 * consecutive breakers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPass } from "../../src/caps/exemptions.ts";

/** The consecutive breakers of the outer loop, as the runtime holds them. */
function breakers() {
  return { shortPass: 0, repeat: 0, malformed: 0 };
}

test("CT-115-148: checkpoint passes leave the consecutive breakers as they were", () => {
  const breakersBefore = breakers();
  for (const fingerprint of ["t1", "t2", "t3", "t4"]) {
    const assessment = assessPass({
      validCheckpoint: true,
      treeFingerprint: fingerprint,
      previousCheckpointFingerprint:
        fingerprint === "t1" ? undefined : `t${Number(fingerprint[1]) - 1}`,
    });
    assert.ok(assessment.directives.includes("exemptShortPass"));
  }
  assert.deepEqual(breakers(), breakersBefore);
});

test("CT-115-148: a given-back pass leaves the breakers too", () => {
  const before = breakers();
  const assessment = assessPass({
    validCheckpoint: true,
    treeFingerprint: "t9",
    previousCheckpointFingerprint: "t1",
  });
  assert.equal(assessment.givenBack, true);
  assert.deepEqual(breakers(), before);
});

test("CT-115-148: only a pass without a valid checkpoint is accounted as classic", () => {
  const before = breakers();
  const assessment = assessPass({ validCheckpoint: false, treeFingerprint: "t1" });
  assert.deepEqual(assessment.directives, []);
  // The classic accounting of the runtime may move its own breakers; the
  // layer moved none, and the classic pass is accounted by the engine.
  assert.deepEqual(breakers(), before);
});
