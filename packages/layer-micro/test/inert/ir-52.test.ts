/**
 * CT-115-152 (T090, IR-52; F115-FR-006) — characterization of the integrity
 * rule IR-52: inertness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { epLoopLayer } from "@specstride/contracts";
import {
  createAttemptEngagement,
  promptAdditions,
  recordLedger,
  runCallPoint,
  wroteToLedger,
} from "../../src/strategy/engaged.ts";

test("IR-52: inert, no call point of the eight executes anything", () => {
  const inert = createAttemptEngagement();
  for (const point of epLoopLayer.CALL_POINTS) {
    const effect = runCallPoint(inert, point);
    assert.equal(effect.executed, false, point);
  }
});

test("IR-52: inert, no inner check, no closing check, no fingerprint, no fact block, no router decision", () => {
  const inert = createAttemptEngagement();
  const nonExecuting = new Set(
    epLoopLayer.CALL_POINTS.filter((p) => runCallPoint(inert, p).executed === false),
  );
  // betweenPasses carries the inner check; onEvidence the closing check;
  // contributeCriticInput the fact block rows; no point runs at all.
  for (const p of [
    "betweenPasses",
    "onEvidence",
    "contributeCriticInput",
    "contributePrompt",
    "afterPass",
    "nextPassBlock",
    "resume",
    "report",
  ] as const) {
    assert.ok(nonExecuting.has(p), p);
  }
});

test("IR-52: inert, no record in the ledger namespace of the layer", () => {
  const afterTry = recordLedger(createAttemptEngagement(), "check-started");
  assert.deepEqual([...afterTry.ledger], []);
  assert.equal(wroteToLedger(afterTry), false);
});

test("IR-52: inert, nothing is added to any prompt but the checkpoint contract block", () => {
  assert.deepEqual([...promptAdditions(createAttemptEngagement())], ["checkpoint-contract-block"]);
});
