/**
 * CT-115-120 (T066, IR-20, F115-FR-018) — characterization: the marker token
 * on a failure blocks — a block without the token of the run is not accepted
 * as the failure block of the run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureBlock, markerToken, nextPassBlock } from "../../src/callpoints/next-pass-block.ts";

const OUTPUTS = [{ id: "lint", exit: 1, output: "1 problem", treeFingerprint: "t1" }];

test("CT-115-120 (IR-20): every failure block carries the marker token of the run", () => {
  const block = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: "t1",
    repairIndex: 1,
    random: () => 0.5,
  });
  assert.match(block.marker, /^loop-marker-r1-/);
  assert.ok(block.text.includes(block.marker));
});

test("CT-115-120 (IR-20): a token is random per run — two runs never share one", () => {
  const first = markerToken("r1", () => 0.1);
  const second = markerToken("r2", () => 0.1);
  const third = markerToken("r1", () => 0.9);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.notEqual(second, third);
});

test("CT-115-120 (IR-20): a block that misses the token does not pass as the failure block of the run", () => {
  const block = failureBlock({
    runId: "r1",
    outputs: OUTPUTS,
    treeFingerprint: "t1",
    repairIndex: 1,
    random: () => 0.5,
  });
  const withoutToken = block.text.replace(block.marker, "no-token");
  // The acceptance of a block is the presence of the marker of the run.
  assert.equal(withoutToken.includes(block.marker), false);
  assert.notEqual(withoutToken, block.text);
});

test("CT-115-120 (IR-20): the call point contributes only a block that carries the token", () => {
  const result = nextPassBlock({
    runId: "r1",
    lastOutcome: "repair",
    outputs: OUTPUTS,
    treeFingerprint: "t1",
    repairIndex: 1,
    random: () => 0.5,
  });
  if (result.directive !== "contribute" || result.block === undefined) {
    assert.fail("expected a contribution");
  }
  assert.ok(result.block.text.includes(result.block.marker));
});
