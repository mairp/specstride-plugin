/**
 * CT-115-149 (T068, IR-49, F115-FR-029) — characterization: no stop once
 * phase evidence exists. The proof is read back from the run record of the
 * attempt (the durable seam), not from a function's return value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closingCheck,
  limitAfterEvidence,
  recordClosingOutcome,
  recordLimitAfterEvidence,
  type RunLog,
} from "../../src/closing/closing-check.ts";

test("CT-115-149 (IR-49): every limit and breaker fired after the evidence ends the repair only", () => {
  for (const fired of [true, false]) {
    const outcome = limitAfterEvidence(fired);
    assert.equal(outcome.stop, false);
    assert.equal(outcome.goesTo, "phase-gate");
  }
});

test("CT-115-149 (IR-49): the caps of the repair after the closing check do not stop the run", () => {
  // The cycle cap and the repair cap are spent: the evidence still reaches
  // the phase gate, unchanged, and nothing stops the run.
  const outOfCycles = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 0,
    cyclesLeft: 0,
  });
  assert.deepEqual(outOfCycles, { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 });
  const outOfReturns = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 2,
    cyclesLeft: 9,
  });
  assert.deepEqual(outOfReturns, { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 });
});

test("CT-115-149 (IR-49): no outcome of the closing check names a stop or an exit", () => {
  const outcomes = [
    closingCheck({ declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 0, cyclesLeft: 2 }),
    closingCheck({ declaredUnit: true, treeFingerprint: "f", returnsToWorkUsed: 2, cyclesLeft: 2 }),
    closingCheck({
      declaredUnit: false,
      treeFingerprint: "f",
      returnsToWorkUsed: 0,
      cyclesLeft: 2,
    }),
  ] as const;
  for (const outcome of outcomes) {
    const record = outcome as unknown as Record<string, unknown>;
    assert.ok(!("stopReason" in record) || record.stopReason === undefined);
    assert.ok(!("exitCode" in record) || record.exitCode === undefined);
    assert.ok(!("stop" in record) || record.stop === false);
  }
});

test("CT-115-149 (IR-49): the run record read back shows the gate reached, no stop and no exit", () => {
  // The run record of the attempt is the durable state an independent reader
  // sees. After the closing check answers `phase-gate` and after every limit
  // and breaker of the repair, the read back of the record — not the return
  // value — shows the gate event recorded and no stop reason, no exit code,
  // and no stop event of any kind, ever.
  const log: RunLog = { events: [] };
  const outcome = closingCheck({
    declaredUnit: true,
    treeFingerprint: "final",
    returnsToWorkUsed: 2,
    cyclesLeft: 0,
  });
  recordClosingOutcome(log, outcome);
  for (const fired of [true, false]) {
    recordLimitAfterEvidence(log, limitAfterEvidence(fired));
  }
  assert.equal(log.events.length, 3);
  for (const event of log.events) {
    assert.equal(event, "phase.gate.reached");
  }
  assert.equal(log.stopReason, undefined);
  assert.equal(log.exitCode, undefined);
  assert.equal(
    log.events.some((event) => event.startsWith("stop") || event.startsWith("exit")),
    false,
  );
});
