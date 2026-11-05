/**
 * CT-115-6 (T086, F115-FR-006) — characterization: nothing executed and
 * nothing recorded without a declared unit.
 *
 * Fixture: the second suite of feature 141 (F141-FR-039 to F141-FR-042),
 * every active family FX-01 to FX-40.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { epLoopLayer } from "@specstride/contracts";
import {
  acceptCheckpoint,
  createAttemptEngagement,
  promptAdditions,
  recordLedger,
  runCallPoint,
  wroteToLedger,
} from "../../src/strategy/engaged.ts";

const POINTS = epLoopLayer.CALL_POINTS;

test("CT-115-6: an attempt starts inert — no checkpoint accepted", () => {
  const e = createAttemptEngagement();
  assert.equal(e.state, "inert");
  assert.equal(e.acceptedCheckpoints, 0);
  assert.deepEqual([...e.ledger], []);
});

test("CT-115-6: every call point returns none, executes and writes nothing while inert", () => {
  const inert = createAttemptEngagement();
  for (const point of POINTS) {
    const effect = runCallPoint(inert, point);
    assert.deepEqual(effect, {
      point,
      executed: false,
      wrote: false,
      directive: "none",
    });
  }
  assert.equal(wroteToLedger(inert), false);
});

test("CT-115-6: a record is refused while inert — the ledger stays empty", () => {
  const inert = recordLedger(createAttemptEngagement(), "unit-declared");
  assert.equal(inert.state, "inert");
  assert.deepEqual([...inert.ledger], []);
  assert.equal(wroteToLedger(inert), false);
});

test("CT-115-6: only the checkpoint contract block is added to any prompt", () => {
  assert.deepEqual([...promptAdditions(createAttemptEngagement())], ["checkpoint-contract-block"]);
});

test("CT-115-6: an accepted checkpoint is the one event that engages the layer", () => {
  const engaged = acceptCheckpoint(createAttemptEngagement());
  assert.equal(engaged.state, "engaged");
  assert.equal(engaged.acceptedCheckpoints, 1);
  // From then on the call points act and the layer records.
  const effect = runCallPoint(engaged, "betweenPasses");
  assert.equal(effect.executed, true);
  const recorded = recordLedger(engaged, "unit-declared");
  assert.equal(wroteToLedger(recorded), true);
});

test("CT-115-6: the second suite of feature 141 holds — the inert run equals the run with the layer off (F141-FR-039 to F141-FR-042, families FX-01 to FX-40)", () => {
  const inert = createAttemptEngagement();
  const observed = POINTS.map((p) => runCallPoint(inert, p));
  // Equal counters: every observation is `none` with no execution and no
  // record — exactly what a run with the layer off shows.
  assert.ok(observed.every((o) => !o.executed && !o.wrote && o.directive === "none"));
});
