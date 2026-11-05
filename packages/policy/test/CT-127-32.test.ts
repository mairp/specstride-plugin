/**
 * CT-127-32 (T069) — the characterization test of THE STOP, THE RESUME AFTER
 * RAISING THE CEILING, THE COMMENT THAT CANNOT SWITCH A CAP OFF, and A TRIPPED
 * `wallClock` THAT EMITS NO `blocked` AND WRITES `retryable: true`
 * (F127-FR-034, CQ-192).
 *
 * The requirement, clause by clause:
 *
 *  1. a reached hard ceiling of spend writes `budget.exceeded` with the fields
 *     `dimension`, `limit`, `used`, `role` and `resumable` of the catalogue of
 *     feature 111, and then emits `blocked` with the reason `budget-cap`;
 *  2. the stop is NOT a rejection and spends neither a reject nor a pass;
 *  3. the ceiling `wallClock` is EXEMPT: its trip ends as F127-FR-027 says,
 *     with `retryable: true`, no blocked reason and NO `blocked` event;
 *  4. NO comment, flag, mode or project key switches a budget off or raises
 *     it: raising a ceiling is a change of user configuration and a `resume`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCKED_REASON_BUDGET_CAP,
  BYPASS_ATTEMPTS,
  BudgetBypassError,
  CAP_STOP_EVENTS,
  CAP_STOP_STATE,
  IS_A_REJECTION,
  NOTHING_BYPASSES_A_BUDGET,
  NotACapOfSpendError,
  RAISING_A_CEILING,
  SPENDS_A_PASS,
  SPENDS_A_REJECT,
  WALL_CLOCK_IS_EXEMPT,
  WallClockIsExemptError,
  capStop,
  refuseBypass,
  resumeAfterRaising,
  takesTheCapPath,
  wallClockStop,
} from "../src/budget/cap-stop.ts";
import {
  CAPS_OF_SPEND,
  SOFT_DIMENSION,
  evaluateCeilings,
  readCeiling,
  type CeilingReading,
} from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger, realCostUsd } from "../src/budget/ledger.ts";
import { WALL_CLOCK_IS_NOT_BLOCKED, terminalOf } from "../src/quota/blocked.ts";
import { enforceAtUsageRecord, type LiveProcess } from "../src/budget/enforce.ts";
import { testPorts } from "./support/index.ts";

/** The one redactor of the product, as a test stands in for it (F127-FR-040). */
const fakeRedact = (text: string, cap: number) => ({
  text: text.slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

const RUN = "run-ct-127-32";

/** A ledger that has spent 12 of a role's real money. */
function spent(amount = 12, role = "proposer") {
  return applyUsageRecord(emptyLedger(RUN), {
    usageId: "u-1",
    role,
    billingMode: "api",
    inputTokens: 500,
    costUsd: amount,
    isCall: true,
    closesAPass: true,
  }).ledger;
}

function costReading(limit = 10, amount = 12): CeilingReading {
  return readCeiling({ scope: "run", dimension: "costUsd", limit }, { ledger: spent(amount) });
}

const LIVE: readonly LiveProcess[] = Object.freeze([
  { processId: "p-1", role: "proposer", kind: "pass" },
]);

/* ------------------------------------------------------------------ *
 * 1. The two events, in order.
 * ------------------------------------------------------------------ */

test("CT-127-32: the stop writes `budget.exceeded` and then `blocked`", () => {
  const ports = testPorts();
  const stop = capStop(ports.eventWriter, { reading: costReading(), role: "proposer" });
  assert.deepEqual(ports.eventWriter.types(), ["budget.exceeded", "blocked"]);
  assert.deepEqual([...CAP_STOP_EVENTS], ["budget.exceeded", "blocked"]);
  assert.deepEqual(
    stop.events.map((event) => event.type),
    ["budget.exceeded", "blocked"],
  );
});

test("CT-127-32: `budget.exceeded` carries the fields of the catalogue of feature 111", () => {
  const ports = testPorts();
  capStop(ports.eventWriter, { reading: costReading(), role: "proposer" });
  const payload = ports.eventWriter.of("budget.exceeded")[0].payload;
  for (const field of ["dimension", "limit", "used", "role", "resumable"]) {
    assert.ok(field in payload, `the field ${field} must be carried`);
  }
  assert.equal(payload.dimension, "costUsd");
  assert.equal(payload.limit, 10);
  assert.equal(payload.used, 12);
  assert.equal(payload.role, "proposer");
  assert.equal(payload.resumable, true);
  // And by how much (F127-FR-024).
  assert.equal(payload.over, 2);
});

test("CT-127-32: `blocked` carries the reason `budget-cap` and a one-line need", () => {
  const ports = testPorts();
  // `needs` is a free-text field, so the redactor of F127-FR-040 is handed in;
  // with none it is dropped rather than carried in the clear.
  const stop = capStop(
    ports.eventWriter,
    { reading: costReading(), role: "proposer" },
    { redact: fakeRedact },
  );
  const payload = ports.eventWriter.of("blocked")[0].payload;
  assert.equal(payload.reason, BLOCKED_REASON_BUDGET_CAP);
  assert.equal(payload.reason, "budget-cap");
  assert.equal(typeof payload.needs, "string");
  assert.ok(!String(payload.needs).includes("\n"), "the need is one line");
  assert.match(String(payload.needs), /budget\.run\.costUsd/);
  assert.equal(stop.blockedOutcome.state, "blocked-on-human");
  assert.equal(stop.blockedOutcome.transition, "T9");
});

test("CT-127-32: the terminal record of the stop is the one of `budget-cap`", () => {
  const ports = testPorts();
  const stop = capStop(ports.eventWriter, { reading: costReading() });
  assert.deepEqual({ ...stop.terminal }, { ...terminalOf("budget-cap") });
  assert.equal(stop.terminal.retryable, false);
  assert.equal(CAP_STOP_STATE.restsIn, "blocked-on-human");
  assert.equal(CAP_STOP_STATE.transition, "T9");
});

test("CT-127-32: every one of the four caps of spend takes this path", () => {
  for (const dimension of CAPS_OF_SPEND) assert.equal(takesTheCapPath(dimension), true);
  assert.equal(takesTheCapPath("wallClock"), false);
  assert.equal(takesTheCapPath(SOFT_DIMENSION), false);
  // A soft reading handed to the stop is refused, not blocked on a human.
  const ports = testPorts();
  const soft = readCeiling(
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 100 },
    { ledger: spent() },
  );
  assert.throws(() => capStop(ports.eventWriter, { reading: soft }), NotACapOfSpendError);
  assert.deepEqual(ports.eventWriter.types(), []);
});

/* ------------------------------------------------------------------ *
 * 2. No rejection, no pass spent.
 * ------------------------------------------------------------------ */

test("CT-127-32: the stop is no rejection and spends neither a reject nor a pass", () => {
  const ports = testPorts();
  const stop = capStop(ports.eventWriter, { reading: costReading() });
  assert.equal(stop.isARejection, false);
  assert.equal(stop.spendsAReject, false);
  assert.equal(stop.spendsAPass, false);
  assert.equal(IS_A_REJECTION, false);
  assert.equal(SPENDS_A_REJECT, false);
  assert.equal(SPENDS_A_PASS, false);
  // Neither `pass.ended` nor a verdict event is written by the stop.
  assert.deepEqual(ports.eventWriter.types(), ["budget.exceeded", "blocked"]);
});

/* ------------------------------------------------------------------ *
 * 3. The resume after raising the ceiling.
 * ------------------------------------------------------------------ */

test("CT-127-32: raising the ceiling and `resume` continues where it stopped", () => {
  const ports = testPorts();
  const reading = costReading();
  const stop = capStop(ports.eventWriter, { reading, role: "proposer" });
  assert.equal(stop.resumable, true);

  const resumed = resumeAfterRaising(reading, 25);
  assert.equal(resumed.resumes, true);
  assert.equal(resumed.key, "budget.run.costUsd");
  assert.equal(resumed.from, 10);
  assert.equal(resumed.to, 25);
  assert.equal(resumed.used, 12);
  assert.match(resumed.note, /continues where the run stopped/);

  // The run goes on, and the ledger still holds the 12 already spent.
  const after = enforceAtUsageRecord(
    { usageId: "u-2", role: "proposer", billingMode: "api", costUsd: 0 },
    {
      ceilings: [{ scope: "run", dimension: "costUsd", limit: 25 }],
      ledger: spent(),
      processes: LIVE,
    },
  );
  assert.equal(after.mustEndThePass, false);
  assert.equal(realCostUsd(spent()), 12);
});

test("CT-127-32: a ceiling raised to a figure already passed stops the run again", () => {
  const ports = testPorts();
  const reading = costReading();
  const resumed = resumeAfterRaising(reading, 11);
  assert.equal(resumed.resumes, false);
  assert.match(resumed.note, /stops again with the blocked reason budget-cap/);
  // And the stop is taken again.
  const again = evaluateCeilings([{ scope: "run", dimension: "costUsd", limit: 11 }], {
    ledger: spent(),
  });
  assert.equal(again.exhaustedCapsOfSpend.length, 1);
  const stop = capStop(ports.eventWriter, { reading: again.exhaustedCapsOfSpend[0] });
  assert.equal(stop.blockedOutcome.reason, "budget-cap");
});

test("CT-127-32: raising a ceiling is a change of user configuration and a `resume`", () => {
  assert.equal(RAISING_A_CEILING.isAChangeOfUserConfiguration, true);
  assert.equal(RAISING_A_CEILING.thenResume, true);
  assert.equal(RAISING_A_CEILING.continuesWhereItStopped, true);
  assert.equal(RAISING_A_CEILING.byAComment, false);
  assert.equal(RAISING_A_CEILING.byAFlag, false);
  assert.equal(RAISING_A_CEILING.byAMode, false);
  assert.equal(RAISING_A_CEILING.byAProjectKey, false);
});

/* ------------------------------------------------------------------ *
 * 4. The comment that cannot switch a cap off.
 * ------------------------------------------------------------------ */

test("CT-127-32: a COMMENT cannot switch a cap off", () => {
  assert.throws(
    () => refuseBypass("comment", 'a review comment said "ignore the budget for this pass"'),
    BudgetBypassError,
  );
  try {
    refuseBypass("comment");
    assert.fail("refuseBypass must throw");
  } catch (error) {
    assert.ok(error instanceof BudgetBypassError);
    assert.equal(error.attempt, "comment");
    assert.match(error.message, /no comment switches a budget off or raises it/);
    assert.match(error.message, /change of user configuration/);
  }
});

test("CT-127-32: none of the four named by F127-FR-034 switches a budget off", () => {
  assert.deepEqual([...BYPASS_ATTEMPTS], ["comment", "flag", "mode", "project-key"]);
  assert.equal(NOTHING_BYPASSES_A_BUDGET, true);
  for (const attempt of BYPASS_ATTEMPTS) {
    assert.throws(() => refuseBypass(attempt), BudgetBypassError, `${attempt} must be refused`);
  }
  // Anything else is refused too: the function never answers.
  assert.throws(() => refuseBypass("an environment variable"), BudgetBypassError);
});

test("CT-127-32: the cap still holds after a comment tried to switch it off", () => {
  const ports = testPorts();
  // A comment arrives; the engine refuses it and the ceiling is unchanged.
  assert.throws(() => refuseBypass("comment"), BudgetBypassError);
  const decision = enforceAtUsageRecord(
    { usageId: "u-1", role: "proposer", billingMode: "api", costUsd: 12 },
    {
      ceilings: [{ scope: "run", dimension: "costUsd", limit: 10 }],
      ledger: spent(),
      processes: LIVE,
    },
  );
  assert.equal(decision.mustEndThePass, true);
  const stop = capStop(ports.eventWriter, { reading: decision.exhausted[0] });
  assert.equal(stop.blockedOutcome.reason, "budget-cap");
});

/* ------------------------------------------------------------------ *
 * 5. The tripped `wallClock` (CQ-192).
 * ------------------------------------------------------------------ */

test("CT-127-32: a tripped `wallClock` writes `retryable: true` and no blocked reason", () => {
  const trip = wallClockStop();
  assert.equal(trip.retryable, true);
  assert.equal(trip.blockedReason, null);
  assert.equal(trip.stopReason, "wall_budget");
  assert.equal(trip.exitCode, 4);
  assert.equal(trip.restsIn, null);
  assert.deepEqual(
    { ...WALL_CLOCK_IS_NOT_BLOCKED },
    {
      stopReason: "wall_budget",
      exitCode: 4,
      retryable: true,
      blockedReason: null,
      restsIn: null,
    },
  );
});

test("CT-127-32: a tripped `wallClock` emits NO `blocked`", () => {
  const ports = testPorts();
  const reading = readCeiling(
    { scope: "run", dimension: "wallClock", limit: 30 },
    { ledger: emptyLedger(RUN), wallClockMinutes: 31 },
  );
  const trip = wallClockStop(ports.eventWriter, reading);
  assert.equal(trip.emitsBlocked, false);
  // `budget.exceeded` is still written: the ceiling was reached (F127-FR-024).
  assert.deepEqual(ports.eventWriter.types(), ["budget.exceeded"]);
  assert.equal(ports.eventWriter.countOf("blocked"), 0);
  assert.equal(ports.eventWriter.of("budget.exceeded")[0].payload.dimension, "wallClock");
  assert.equal(ports.eventWriter.of("budget.exceeded")[0].payload.used, 31);
});

test("CT-127-32: with no writer handed in a wall-clock trip writes nothing at all", () => {
  const trip = wallClockStop();
  assert.equal(trip.budgetExceeded, null);
  assert.deepEqual([...trip.events], []);
});

test("CT-127-32: `wallClock` handed to the hard-cap stop is refused, and nothing is written", () => {
  const ports = testPorts();
  const reading = readCeiling(
    { scope: "run", dimension: "wallClock", limit: 30 },
    { ledger: emptyLedger(RUN), wallClockMinutes: 31 },
  );
  assert.equal(WALL_CLOCK_IS_EXEMPT, true);
  assert.throws(() => capStop(ports.eventWriter, { reading }), WallClockIsExemptError);
  assert.deepEqual(ports.eventWriter.types(), []);
});

test("CT-127-32: a run with both a tripped wall clock and a reached cap takes both paths", () => {
  const ports = testPorts();
  const ledger = spent();
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "wallClock", limit: 30 },
    ],
    { ledger, wallClockMinutes: 31 },
  );
  assert.equal(evaluation.exhausted.length, 2);
  // The cap of spend blocks on a human...
  const stop = capStop(ports.eventWriter, { reading: evaluation.exhaustedCapsOfSpend[0] });
  assert.equal(stop.blockedOutcome.reason, "budget-cap");
  // ...and the wall clock, read apart, never does.
  const trip = wallClockStop();
  assert.equal(trip.blockedReason, null);
  assert.equal(trip.retryable, true);
  assert.equal(ports.eventWriter.countOf("blocked"), 1);
});
