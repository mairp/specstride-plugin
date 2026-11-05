// CT-116-116 (IR-16; F116-FR-008): results bound to the fingerprint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindResultToTree, freshnessOf } from "../../src/result/freshness.ts";

test("IR-16 a result carries the fingerprints it ran between", () => {
  const bound = bindResultToTree({ unitId: "u1", ordinal: 1 }, "before-tree", "after-tree");
  assert.equal(bound.treeBefore, "before-tree");
  assert.equal(bound.treeAfter, "after-tree");
});

test("IR-16 freshness is derived only from the binding to the phase-gate tree", () => {
  assert.equal(freshnessOf("gate", "gate"), "current");
  assert.equal(freshnessOf("stale", "gate"), "superseded");
});
