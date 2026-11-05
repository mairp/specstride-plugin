/**
 * CT-115-126 (T100, IR-26; F115-FR-032) — characterization: the counts of
 * the layer survive a resume.
 *
 * Whatever a first engine session counted is read back from the ledger by a
 * second session, field by field, without the first session in memory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendRecord, newLedger, type MicroLedger } from "../../src/ledger/records.ts";
import { readCountersFromLedger, countersAfterResume } from "../../src/ledger/counters.ts";

/** Session 1: units declared, checked, kept, repaired, one escalation. */
function sessionOne(): MicroLedger {
  let ledger = newLedger("run-ir26", 3);
  ledger = appendRecord(ledger, "unit-declared", { taskIds: ["T010", "T012"] });
  ledger = appendRecord(ledger, "check-started", { ordinal: 1, scope: "inner", cycles: 2 });
  ledger = appendRecord(ledger, "check-finished", {
    ordinal: 1,
    scope: "inner",
    outcome: "unchecked",
  });
  ledger = appendRecord(ledger, "unit-repair", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "escalation", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "check-started", { ordinal: 2, scope: "inner", cycles: 1 });
  ledger = appendRecord(ledger, "check-finished", {
    ordinal: 2,
    scope: "inner",
    outcome: "repair",
  });
  ledger = appendRecord(ledger, "closing-check", { delivered: true, cycles: 3 });
  ledger = appendRecord(ledger, "unit-kept", { taskIds: ["T010", "T012"] });
  return ledger;
}

test("CT-115-126 (IR-26): every counter of session 1 is read back by session 2", () => {
  const ledger = sessionOne();
  const inSessionTwo = readCountersFromLedger(ledger);
  assert.equal(inSessionTwo.cyclesUsed, 6); // 2 + 1 + 3, from the records
  assert.deepEqual(inSessionTwo.repairsByTask, { T010: 1 });
  assert.deepEqual(inSessionTwo.escalationsByTask, { T010: 1 });
  assert.equal(inSessionTwo.escalationsOfAttempt, 1);
  assert.equal(inSessionTwo.unresolvedUnits, 0);
  // The `unchecked` streak: one `unchecked` result, then a `repair` one.
  assert.equal(inSessionTwo.uncheckedStreak, 0);
  assert.equal(inSessionTwo.closingReturns, 1);
});

test("CT-115-126 (IR-26): the counts survive a relaunch — a fresh read equals the counts at the stop", () => {
  const ledger = sessionOne();
  const atStop = readCountersFromLedger(ledger);
  const afterRelaunch = readCountersFromLedger(JSON.parse(JSON.stringify(ledger)) as MicroLedger);
  assert.deepEqual(afterRelaunch, atStop);
  assert.ok(atStop.cyclesUsed > 0);
});

test("CT-115-126 (IR-26): the unchecked streak continues across the resume, not from zero", () => {
  let ledger = sessionOne();
  ledger = appendRecord(ledger, "check-started", { ordinal: 3, scope: "inner", cycles: 1 });
  ledger = appendRecord(ledger, "check-finished", {
    ordinal: 3,
    scope: "inner",
    outcome: "unchecked",
  });
  assert.equal(readCountersFromLedger(ledger).uncheckedStreak, 1);
  // Another `unchecked` result after the resume: the streak reaches two.
  ledger = appendRecord(ledger, "check-started", { ordinal: 4, scope: "inner", cycles: 1 });
  ledger = appendRecord(ledger, "check-finished", {
    ordinal: 4,
    scope: "inner",
    outcome: "unchecked",
  });
  const after = readCountersFromLedger(ledger);
  assert.equal(after.uncheckedStreak, 2);
  // A kept unit ends the streak again.
  ledger = appendRecord(ledger, "unit-kept", { taskIds: ["T010"] });
  assert.equal(readCountersFromLedger(ledger).uncheckedStreak, 0);
});

test("CT-115-126 (IR-26): an unresolved count written before the stop survives the resume", () => {
  let ledger = sessionOne();
  ledger = appendRecord(ledger, "unit-unresolved", { taskIds: ["T012"] });
  const resumed = countersAfterResume(ledger);
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  assert.equal(resumed.counters.unresolvedUnits, 1);
});
