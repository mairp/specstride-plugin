/**
 * CT-127-26 (T061) — the characterization test of HARD AND SOFT CEILINGS, the
 * `api` RECORDS ONLY, and `unknown` BILLING (F127-FR-025, CQ-133, CQ-192).
 *
 * What the requirement asks, clause by clause:
 *
 *  1. `tokens` and `costUsd` are HARD and count ONLY usage records whose
 *     billing mode is `api`;
 *  2. `phaseAttempts` and `calls` are counts and are ALWAYS HARD;
 *  3. those four are the CAPS OF SPEND: their counts live in the ledger,
 *     survive a relaunch, and a reached one takes the path of F127-FR-034;
 *  4. `wallClock` is always enforced but is a ceiling of TIME: a trip takes
 *     the path of F127-FR-027 and NEVER that of F127-FR-034 (CQ-192);
 *  5. `softTokens` counts EVERY observed token of the role and only alerts;
 *  6. records of billing mode `unknown` count towards the observation and the
 *     soft budget and NOT towards a hard ceiling (CQ-133).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  API_ONLY_DIMENSIONS,
  CAPS_OF_SPEND,
  CEILING_KINDS,
  CEILING_OF_TIME,
  SOFT_DIMENSION,
  evaluateCeilings,
  kindOf,
  readCeiling,
  usedFor,
  type UsageSnapshot,
} from "../src/budget/ceilings.ts";
import {
  BILLING_MODES,
  applyUsageRecord,
  callCount,
  emptyLedger,
  hardTokens,
  notionalCostUsd,
  observedTokens,
  realCostUsd,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import {
  WallClockIsExemptError,
  capStop,
  takesTheCapPath,
  wallClockStop,
} from "../src/budget/cap-stop.ts";
import { testPorts } from "./support/index.ts";

function record(
  index: number,
  billingMode: string,
  figures: { readonly tokens?: number; readonly costUsd?: number } = {},
): UsageRecord {
  return {
    usageId: `u-${billingMode}-${index}`,
    role: "proposer",
    billingMode,
    inputTokens: figures.tokens ?? null,
    costUsd: figures.costUsd ?? null,
    isCall: true,
    closesAPass: true,
  };
}

/** One record of each billing mode, each 100 tokens and 5 units of cost. */
function allThreeModes(): SpendLedger {
  let ledger = emptyLedger("run-ct-127-26");
  for (const [index, mode] of BILLING_MODES.entries()) {
    ledger = applyUsageRecord(ledger, record(index, mode, { tokens: 100, costUsd: 5 })).ledger;
  }
  return ledger;
}

function snapshot(ledger: SpendLedger, wallClockMinutes?: number): UsageSnapshot {
  return { ledger, ...(wallClockMinutes === undefined ? {} : { wallClockMinutes }) };
}

/* ------------------------------------------------------------------ *
 * 1 and 2. Which ceilings are hard.
 * ------------------------------------------------------------------ */

test("CT-127-26: the three kinds of ceiling are hard, soft and time", () => {
  assert.deepEqual([...CEILING_KINDS], ["hard", "soft", "time"]);
  assert.equal(kindOf("tokens"), "hard");
  assert.equal(kindOf("costUsd"), "hard");
  assert.equal(kindOf("phaseAttempts"), "hard");
  assert.equal(kindOf("calls"), "hard");
  assert.equal(kindOf(CEILING_OF_TIME), "time");
  assert.equal(kindOf(SOFT_DIMENSION), "soft");
});

test("CT-127-26: `tokens` and `costUsd` are the two that read `api` records only", () => {
  assert.deepEqual([...API_ONLY_DIMENSIONS], ["tokens", "costUsd"]);
});

test("CT-127-26: `phaseAttempts` and `calls` are counts and always hard", () => {
  for (const dimension of ["phaseAttempts", "calls"] as const) {
    assert.equal(kindOf(dimension), "hard");
    assert.ok(CAPS_OF_SPEND.includes(dimension));
    assert.ok(!API_ONLY_DIMENSIONS.includes(dimension));
  }
});

/* ------------------------------------------------------------------ *
 * 1 (continued). `api` records only.
 * ------------------------------------------------------------------ */

test("CT-127-26: a hard `costUsd` ceiling reads the `api` record alone", () => {
  const ledger = allThreeModes();
  // Three records of 5 each; only the `api` one is real spend.
  assert.equal(realCostUsd(ledger), 5);
  assert.equal(notionalCostUsd(ledger), 10);
  assert.equal(usedFor("costUsd", "run", undefined, snapshot(ledger)), 5);

  const evaluation = evaluateCeilings(
    [{ scope: "run", dimension: "costUsd", limit: 10 }],
    snapshot(ledger),
  );
  // 15 units were reported in all; 5 count. The ceiling of 10 does NOT trip.
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.readings[0].used, 5);
});

test("CT-127-26: a hard `tokens` ceiling reads the `api` record alone", () => {
  const ledger = allThreeModes();
  assert.equal(hardTokens(ledger), 100);
  assert.equal(observedTokens(ledger), 300);
  const evaluation = evaluateCeilings(
    [{ scope: "run", dimension: "tokens", limit: 250 }],
    snapshot(ledger),
  );
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.readings[0].used, 100);
});

test("CT-127-26: a subscription record never reaches real spend, however large", () => {
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, record(9, "subscription", { costUsd: 10_000 })).ledger;
  assert.equal(realCostUsd(ledger), null);
  assert.equal(notionalCostUsd(ledger), 10_000);
  const evaluation = evaluateCeilings(
    [{ scope: "run", dimension: "costUsd", limit: 1 }],
    snapshot(ledger),
  );
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.readings[0].used, null);
});

/* ------------------------------------------------------------------ *
 * 6. `unknown` billing (CQ-133).
 * ------------------------------------------------------------------ */

test("CT-127-26: an `unknown` record does NOT count towards a hard ceiling", () => {
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, record(1, "unknown", { tokens: 500, costUsd: 50 })).ledger;
  assert.equal(realCostUsd(ledger), null);
  assert.equal(hardTokens(ledger), null);
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "tokens", limit: 10 },
    ],
    snapshot(ledger),
  );
  assert.equal(evaluation.exhausted.length, 0);
});

test("CT-127-26: an `unknown` record DOES count towards the observation and the soft budget", () => {
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, record(1, "unknown", { tokens: 500, costUsd: 50 })).ledger;
  assert.equal(observedTokens(ledger), 500);
  assert.equal(notionalCostUsd(ledger), 50);
  const soft = readCeiling(
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 400 },
    snapshot(ledger),
  );
  assert.equal(soft.kind, "soft");
  assert.equal(soft.used, 500);
  assert.equal(soft.exhausted, true);
  assert.equal(soft.isCapOfSpend, false);
});

test("CT-127-26: a billing mode outside the three is read as `unknown`", () => {
  let ledger = emptyLedger("run-ct-127-26");
  const result = applyUsageRecord(ledger, record(1, "pay-as-you-go", { costUsd: 7 }));
  assert.equal(result.billingMode, "unknown");
  ledger = result.ledger;
  assert.equal(realCostUsd(ledger), null);
  assert.equal(notionalCostUsd(ledger), 7);
});

/* ------------------------------------------------------------------ *
 * 5. The soft budget only alerts.
 * ------------------------------------------------------------------ */

test("CT-127-26: an exhausted soft budget is no cap of spend and takes no cap path", () => {
  let ledger = emptyLedger("run-ct-127-26");
  for (const [index, mode] of BILLING_MODES.entries()) {
    ledger = applyUsageRecord(ledger, record(index, mode, { tokens: 100 })).ledger;
  }
  const evaluation = evaluateCeilings(
    [
      { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 200 },
      { scope: "run", dimension: "tokens", limit: 200 },
    ],
    snapshot(ledger),
  );
  assert.equal(evaluation.exhaustedSoft.length, 1);
  assert.equal(evaluation.exhaustedSoft[0].dimension, SOFT_DIMENSION);
  // The soft one is exhausted at 300 observed tokens; the hard one is not, at 100.
  assert.equal(evaluation.exhaustedCapsOfSpend.length, 0);
  assert.equal(takesTheCapPath(SOFT_DIMENSION), false);
});

test("CT-127-26: the soft budget counts the role's tokens, not the run's", () => {
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, {
    usageId: "p-1",
    role: "proposer",
    billingMode: "subscription",
    inputTokens: 100,
  }).ledger;
  ledger = applyUsageRecord(ledger, {
    usageId: "c-1",
    role: "critic",
    billingMode: "subscription",
    inputTokens: 900,
  }).ledger;
  assert.equal(observedTokens(ledger, "proposer"), 100);
  assert.equal(observedTokens(ledger, "critic"), 900);
  const reading = readCeiling(
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 500 },
    snapshot(ledger),
  );
  assert.equal(reading.used, 100);
  assert.equal(reading.exhausted, false);
});

/* ------------------------------------------------------------------ *
 * 3. The four caps of spend survive a relaunch.
 * ------------------------------------------------------------------ */

test("CT-127-26: the counts of the four caps live in the ledger", () => {
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, record(1, "api", { tokens: 10, costUsd: 1 })).ledger;
  ledger.run.phaseAttempts = 2;
  // Each of the four reads a field of the ledger, so a relaunch that reads the
  // file back sees the same figures (F127-FR-031).
  assert.equal(usedFor("tokens", "run", undefined, snapshot(ledger)), 10);
  assert.equal(usedFor("costUsd", "run", undefined, snapshot(ledger)), 1);
  assert.equal(usedFor("calls", "run", undefined, snapshot(ledger)), 1);
  assert.equal(usedFor("phaseAttempts", "run", undefined, snapshot(ledger)), 2);
  assert.equal(callCount(ledger), 1);
});

test("CT-127-26: every exhausted cap of spend takes the path of F127-FR-034", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-ct-127-26");
  ledger = applyUsageRecord(ledger, record(1, "api", { tokens: 100, costUsd: 12 })).ledger;
  ledger.run.phaseAttempts = 5;
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "tokens", limit: 50 },
      { scope: "run", dimension: "calls", limit: 1 },
      { scope: "run", dimension: "phaseAttempts", limit: 5 },
    ],
    snapshot(ledger),
  );
  assert.equal(evaluation.exhaustedCapsOfSpend.length, 4);
  for (const reading of evaluation.exhaustedCapsOfSpend) {
    assert.equal(takesTheCapPath(reading.dimension), true);
    const stop = capStop(ports.eventWriter, { reading });
    assert.equal(stop.blockedOutcome.reason, "budget-cap");
  }
});

/* ------------------------------------------------------------------ *
 * 4. `wallClock` is always enforced, and is never a cap of spend (CQ-192).
 * ------------------------------------------------------------------ */

test("CT-127-26: `wallClock` is enforced and reported apart from the caps of spend", () => {
  const ledger = emptyLedger("run-ct-127-26");
  const evaluation = evaluateCeilings(
    [{ scope: "run", dimension: "wallClock", limit: 30 }],
    snapshot(ledger, 31),
  );
  assert.equal(evaluation.exhausted.length, 1);
  assert.equal(evaluation.exhaustedCapsOfSpend.length, 0);
  assert.equal(evaluation.wallClockTripped?.dimension, "wallClock");
  assert.equal(evaluation.wallClockTripped?.isCapOfSpend, false);
  assert.equal(takesTheCapPath("wallClock"), false);
});

test("CT-127-26: a `wallClock` reading handed to the hard-cap stop is REFUSED", () => {
  const ports = testPorts();
  const reading = readCeiling(
    { scope: "run", dimension: "wallClock", limit: 30 },
    snapshot(emptyLedger("run-ct-127-26"), 31),
  );
  assert.throws(() => capStop(ports.eventWriter, { reading }), WallClockIsExemptError);
  assert.deepEqual(ports.eventWriter.types(), []);
  // Its own path writes `retryable: true` and no blocked reason.
  const trip = wallClockStop();
  assert.equal(trip.stopReason, "wall_budget");
  assert.equal(trip.retryable, true);
  assert.equal(trip.blockedReason, null);
  assert.equal(trip.emitsBlocked, false);
});

test("CT-127-26: a `wallClock` ceiling of 0 is off, as every ceiling of 0 is", () => {
  const evaluation = evaluateCeilings(
    [{ scope: "run", dimension: "wallClock", limit: 0 }],
    snapshot(emptyLedger("run-ct-127-26"), 10_000),
  );
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.wallClockTripped, null);
});
