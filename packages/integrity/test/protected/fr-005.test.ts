// CT-116-5 (F116-FR-005): fingerprints before and after a check;
// changed-during-check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, writeFile } from "./helpers.ts";
import { treeFingerprint } from "../../src/fingerprint/tree.ts";
import { compareAroundCheck } from "../../src/protected/compare.ts";

test("CT-116-5 an unchanged tree around a check gives no taint", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  const before = await treeFingerprint(root);
  const after = await treeFingerprint(root);
  const verdict = compareAroundCheck({
    treeBefore: before.fingerprint,
    treeAfter: after.fingerprint,
    changedPaths: [],
    declaredWrites: [],
    authorised: {},
  });
  assert.equal(verdict.conditions.tainted, false);
  assert.equal(verdict.isPass, true);
});

test("CT-116-5 a change during a check taints with reason changed-during-check", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  const before = await treeFingerprint(root);
  writeFile(root, "src/mutated.ts", "export const x = 1;");
  const after = await treeFingerprint(root);
  const verdict = compareAroundCheck({
    treeBefore: before.fingerprint,
    treeAfter: after.fingerprint,
    changedPaths: ["src/mutated.ts"],
    declaredWrites: [],
    authorised: {},
  });
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.notEqual(verdict.conditions.tainted, false);
  assert.equal((verdict.conditions.tainted as { reason: string }).reason, "changed-during-check");
  assert.equal(verdict.isPass, false);
});

test("CT-116-5 a file the check manifest declares as written does not taint", () => {
  const verdict = compareAroundCheck({
    treeBefore: "t1",
    treeAfter: "t2",
    changedPaths: ["coverage/lcov.info"],
    declaredWrites: ["coverage/lcov.info"],
    authorised: {},
  });
  assert.equal(verdict.conditions.tainted, false);
});

test("CT-116-5 the two readings are distinct values a caller can keep", async () => {
  const root = makeRepo({ "a.ts": "1" });
  const before = await treeFingerprint(root);
  writeFile(root, "a.ts", "2");
  const after = await treeFingerprint(root);
  assert.notEqual(before.fingerprint, after.fingerprint);
});
