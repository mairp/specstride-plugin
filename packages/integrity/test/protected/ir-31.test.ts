// CT-116-131 (IR-31; F116-FR-005): fingerprint before and after, for the
// checks of a loop layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, writeFile } from "./helpers.ts";
import { treeFingerprint } from "../../src/fingerprint/tree.ts";
import { compareAroundCheck } from "../../src/protected/compare.ts";

test("IR-31 both readings bracket the check, the closing check included", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  for (const label of ["unit check", "closing check"]) {
    const before = await treeFingerprint(root);
    if (label === "closing check") writeFile(root, "late.ts", "x");
    const after = await treeFingerprint(root);
    const verdict = compareAroundCheck({
      treeBefore: before.fingerprint,
      treeAfter: after.fingerprint,
      changedPaths: label === "closing check" ? ["late.ts"] : [],
      declaredWrites: [],
      authorised: {},
    });
    assert.equal(verdict.conditions.tainted === false, label !== "closing check", label);
  }
});

test("IR-31 equality of both readings apart from declared writes means no taint", () => {
  const verdict = compareAroundCheck({
    treeBefore: "t",
    treeAfter: "t",
    changedPaths: [],
    declaredWrites: [],
    authorised: {},
  });
  assert.equal(verdict.conditions.tainted, false);
  assert.equal(verdict.isPass, true);
});
