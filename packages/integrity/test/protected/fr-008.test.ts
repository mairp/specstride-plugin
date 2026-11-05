// CT-116-8 (F116-FR-008): results bound to the tree; current and superseded;
// conditions in fields of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindResultToTree, freshnessOf, markFreshness } from "../../src/result/freshness.ts";

test("CT-116-8 every result is bound to the tree fingerprint it ran on", () => {
  const bound = bindResultToTree({ unitId: "u1", ordinal: 1 }, "tree-1", "tree-1");
  assert.equal(bound.treeBefore, "tree-1");
  assert.equal(bound.treeAfter, "tree-1");
});

test("CT-116-8 current only when the fingerprint equals the tree at the phase gate", () => {
  assert.equal(freshnessOf("gate-tree", "gate-tree"), "current");
  assert.equal(freshnessOf("older-tree", "gate-tree"), "superseded");
});

test("CT-116-8 a result on an older tree reads superseded", () => {
  const marked = markFreshness(
    [
      { unitId: "u1", ordinal: 1, treeAfter: "old-tree", exit: 0 },
      { unitId: "u1", ordinal: 2, treeAfter: "gate-tree", exit: 0 },
    ],
    "gate-tree",
  );
  assert.equal(marked[0].freshness, "superseded");
  assert.equal(marked[1].freshness, "current");
});

test("CT-116-8 a condition never replaces the exit result: separate fields", () => {
  const bound = bindResultToTree(
    { unitId: "u1", ordinal: 1, exit: 0, conditions: { tainted: { reason: "pin-mismatch" } } },
    "t",
    "t",
  );
  assert.equal(bound.exit, 0);
  assert.ok(bound.conditions && "tainted" in bound.conditions);
  assert.equal("freshness" in (bound as object), true);
});
