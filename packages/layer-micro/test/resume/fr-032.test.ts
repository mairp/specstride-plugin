/**
 * CT-115-32 (T098, F115-FR-032) — characterization: the counters continue
 * after a resume and a relaunch; the reset flag of the run resets them; an
 * invalid ledger switches the layer off for the phase attempt, raises the
 * integrity event and the run does not stop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendRecord,
  newLedger,
  type LedgerRecord,
  type MicroLedger,
} from "../../src/ledger/records.ts";

/** The ledger as a tamperer sees it: the records are mutable to the tamperer only. */
type MutableLedger = { runId: string; phase: number; records: LedgerRecord[] };
import {
  LEDGER_COUNTERS,
  newCounters,
  readCountersFromLedger,
  applyResetFlag,
  countersAfterResume,
} from "../../src/ledger/counters.ts";

/** A ledger built by a first engine session: some work happened. */
function firstSession(): MicroLedger {
  let ledger = newLedger("run-c", 2);
  ledger = appendRecord(ledger, "unit-declared", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "check-started", { ordinal: 1, scope: "inner" });
  ledger = appendRecord(ledger, "unit-repair", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "escalation", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "unit-unresolved", { taskIds: ["T010"] });
  return ledger;
}

test("CT-115-32 (F115-FR-032): the counters are exactly the seven of the ledger contract", () => {
  assert.deepEqual(
    [...LEDGER_COUNTERS],
    [
      "cyclesUsed",
      "repairsByTask",
      "escalationsByTask",
      "escalationsOfAttempt",
      "unresolvedUnits",
      "uncheckedStreak",
      "closingReturns",
    ],
  );
});

test("CT-115-32 (F115-FR-032): the counts continue after a resume and a relaunch", () => {
  const ledger = firstSession();
  const atResume = readCountersFromLedger(ledger);
  assert.equal(atResume.repairsByTask["T010"], 1);
  assert.equal(atResume.escalationsOfAttempt, 1);
  assert.equal(atResume.unresolvedUnits, 1);

  // A relaunch is a fresh read of the same ledger — never a fresh zero.
  const afterRelaunch = readCountersFromLedger(ledger);
  assert.deepEqual(afterRelaunch, atResume);

  // Work after the resume continues on the counts that are already there.
  const continued = appendRecord(ledger, "unit-repair", { taskIds: ["T010"] });
  assert.equal(readCountersFromLedger(continued).repairsByTask["T010"], 2);
  assert.equal(
    readCountersFromLedger(continued).escalationsOfAttempt,
    atResume.escalationsOfAttempt,
  );
});

test("CT-115-32 (F115-FR-032): the reset flag of the run resets the counters", () => {
  const ledger = appendRecord(firstSession(), "check-started", {
    ordinal: 2,
    scope: "inner",
    cycles: 1,
  });
  const spent = readCountersFromLedger(ledger);
  assert.ok(spent.cyclesUsed >= 1);
  const reset = applyResetFlag(ledger, true);
  assert.deepEqual(reset, newCounters());
  // Without the flag the counts stay.
  assert.deepEqual(applyResetFlag(ledger, false), spent);
});

test("CT-115-32 (F115-FR-032): an invalid ledger switches the layer off, raises the integrity event, and the run does not stop", () => {
  // Edit a record behind the engine's back: the chain no longer validates.
  const tampered = JSON.parse(JSON.stringify(firstSession())) as MutableLedger;
  (tampered.records[2].data as Record<string, unknown>).taskIds = ["T999"];
  const resumed = countersAfterResume(tampered);
  assert.ok(!resumed.ok);
  if (resumed.ok) return;
  assert.equal(resumed.off.directive, "layerOffForAttempt");
  assert.equal(resumed.off.cause, "integrity-event");
  assert.equal(resumed.off.integrityKind, "ledger-invalid");
  // IR-07 holds here too: no exit code, no stop reason, no run state.
  assert.equal(resumed.off.exitCode, undefined);
  assert.equal(resumed.off.stopReason, undefined);
  assert.equal(resumed.off.runState, undefined);
  // The integrity event of the kind `ledger-invalid`, as `integrity.noted`.
  assert.equal(resumed.event.type, "integrity.noted");
  assert.equal(resumed.event.kind, "ledger-invalid");
});

test("CT-115-32 (F115-FR-032): a valid ledger resumes the counters and no event", () => {
  const resumed = countersAfterResume(firstSession());
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  assert.equal(resumed.counters.unresolvedUnits, 1);
  assert.equal(resumed.event, undefined);
});
