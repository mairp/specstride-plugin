/**
 * CT-115-18 (T050, F115-FR-018) — characterization: the failure block on the
 * current tree with the marker token; fresh session for repair 2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureBlock, markerToken, nextPassBlock } from "../../src/callpoints/next-pass-block.ts";

const TREE = "tree-2";
let deterministic = 0.5;
const random = () => {
  deterministic = (deterministic * 9301 + 49297) % 233280;
  return deterministic / 233280;
};

const OUTPUTS = [
  { id: "unit", exit: 0, output: "ok", treeFingerprint: TREE },
  { id: "lint", exit: 1, output: "1 problem", treeFingerprint: TREE },
  { id: "stale", exit: 1, output: "from an earlier tree", treeFingerprint: "tree-1" },
];

test("CT-115-18: the block carries the output on the current tree and never an earlier one", () => {
  const block = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: TREE,
    repairIndex: 1,
    random,
  });
  assert.ok(block.text.includes("1 problem"));
  assert.ok(!block.text.includes("from an earlier tree"));
  assert.equal(block.currentTree, true);
});

test("CT-115-18: every failure block carries a marker token that is random per run", () => {
  const a = markerToken("r1", () => 0.25);
  const b = markerToken("r1", () => 0.75);
  assert.notEqual(a, b);
  assert.match(a, /^loop-marker-r1-/);
  const block = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: TREE,
    repairIndex: 1,
    random,
  });
  assert.ok(block.text.includes(block.marker));
});

test("CT-115-18: for a taint the block names the protected path that changed", () => {
  const block = failureBlock({
    runId: "r1",
    outputs: [
      {
        id: "lint",
        exit: 0,
        output: "ok",
        treeFingerprint: TREE,
        changedProtectedPath: "src/locked.ts",
      },
    ],
    treeFingerprint: TREE,
    repairIndex: 1,
    random,
  });
  assert.ok(block.text.includes("protected path changed: src/locked.ts"));
});

test("CT-115-18: the second repair runs in a fresh session with a note built by the runtime", () => {
  const first = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: TREE,
    repairIndex: 1,
    random,
  });
  const second = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: TREE,
    repairIndex: 2,
    random,
  });
  assert.equal(first.freshSession, undefined);
  assert.equal(second.freshSession, true);
  assert.match(second.runtimeNote ?? "", /runtime/);
});

test("CT-115-18: the call point contributes only for a repair; otherwise none", () => {
  const repair = nextPassBlock({
    runId: "r1",
    lastOutcome: "repair",
    outputs: OUTPUTS,
    treeFingerprint: TREE,
    repairIndex: 1,
    random,
  });
  assert.equal(repair.directive, "contribute");
  assert.ok(repair.block !== undefined);
  for (const lastOutcome of ["kept", "unresolved", "unchecked", "none"] as const) {
    const none = nextPassBlock({
      runId: "r1",
      lastOutcome,
      outputs: OUTPUTS,
      treeFingerprint: TREE,
      repairIndex: 1,
      random,
    });
    assert.deepEqual(none, { directive: "none" });
  }
});
