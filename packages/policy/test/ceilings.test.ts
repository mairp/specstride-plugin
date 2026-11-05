/**
 * T009 — the unit tests of the evaluation of ceilings (F127-FR-024,
 * F127-FR-025), on the fake clock of T003.
 *
 * One test per rule the task names: dimensions, scopes, hard and soft, 0 or
 * non-finite is off, all exhausted ceilings reported.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_THRESHOLDS,
  API_ONLY_DIMENSIONS,
  budgetExceededPayload,
  budgetLevelOf,
  BUDGET_DIMENSIONS,
  BudgetDimensionError,
  CAPS_OF_SPEND,
  CEILING_OF_TIME,
  DIMENSIONS_BY_SCOPE,
  evaluateCeilings,
  isActive,
  isOff,
  keyOf,
  kindOf,
  readCeiling,
  readDimension,
  scopeCarries,
  SOFT_DIMENSION,
  type Ceiling,
  type UsageSnapshot,
} from "../src/budget/ceilings.ts";
import {
  applyUsageRecord,
  emptyLedger,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const record = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  usageId: `u${Math.round(1)}`,
  role: "proposer",
  billingMode: "api",
  inputTokens: 100,
  outputTokens: 0,
  costUsd: 1,
  ...over,
});

function ledgerWith(records: readonly UsageRecord[]): SpendLedger {
  let ledger = emptyLedger("run-1");
  for (const one of records) ledger = applyUsageRecord(ledger, one).ledger;
  return ledger;
}

const usage = (ledger: SpendLedger, wallClockMinutes?: number): UsageSnapshot => ({
  ledger,
  wallClockMinutes,
});

test("T009 (dimensions): the five of row 206, and nothing else", () => {
  assert.deepEqual(
    [...BUDGET_DIMENSIONS],
    ["tokens", "costUsd", "wallClock", "phaseAttempts", "calls"],
  );
  for (const dimension of BUDGET_DIMENSIONS) assert.equal(readDimension(dimension), dimension);
  assert.throws(() => readDimension("dollars"), BudgetDimensionError);
  assert.throws(() => readDimension("dollars"), /configuration error/);
  assert.throws(() => readDimension("dollars"), /row 206/);
});

test("T009 (scopes): role carries three dimensions, run carries all five", () => {
  assert.deepEqual([...DIMENSIONS_BY_SCOPE.role], ["tokens", "costUsd", "calls"]);
  assert.deepEqual([...DIMENSIONS_BY_SCOPE.run], [...BUDGET_DIMENSIONS]);
  assert.equal(scopeCarries("role", "tokens"), true);
  assert.equal(scopeCarries("role", "wallClock"), false);
  assert.equal(scopeCarries("role", "phaseAttempts"), false);
  assert.equal(scopeCarries("run", "wallClock"), true);
  // A ceiling at a scope that cannot carry it is a configuration error.
  assert.throws(
    () =>
      evaluateCeilings(
        [{ scope: "role", role: "proposer", dimension: "wallClock", limit: 5 }],
        usage(emptyLedger("r")),
      ),
    BudgetDimensionError,
  );
});

test("T009 (hard and soft): the four caps of spend, the ceiling of time, the soft budget", () => {
  assert.deepEqual([...CAPS_OF_SPEND], ["tokens", "costUsd", "phaseAttempts", "calls"]);
  assert.equal(CEILING_OF_TIME, "wallClock");
  assert.deepEqual([...API_ONLY_DIMENSIONS], ["tokens", "costUsd"]);
  for (const dimension of CAPS_OF_SPEND) assert.equal(kindOf(dimension), "hard", dimension);
  assert.equal(kindOf("wallClock"), "time", "a ceiling of time, not a cap of spend (CQ-192)");
  assert.equal(kindOf(SOFT_DIMENSION), "soft");
});

test("T009 (hard): a hard ceiling of tokens counts records of billing mode api only", () => {
  const ledger = ledgerWith([
    record({ usageId: "a", billingMode: "api", inputTokens: 60 }),
    record({ usageId: "s", billingMode: "subscription", inputTokens: 500 }),
    record({ usageId: "x", billingMode: "unknown", inputTokens: 500 }),
  ]);
  const hard = readCeiling({ scope: "run", dimension: "tokens", limit: 100 }, usage(ledger));
  assert.equal(hard.used, 60, "api alone (F127-FR-025)");
  assert.equal(hard.exhausted, false);
  const soft = readCeiling(
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 100 },
    usage(ledger),
  );
  assert.equal(soft.used, 1060, "the soft budget counts every observed token");
  assert.equal(soft.exhausted, true);
  assert.equal(soft.kind, "soft", "and only raises alerts");
  assert.equal(soft.isCapOfSpend, false);
});

test("T009 (0 or non-finite is off): a ceiling that never trips", () => {
  for (const limit of [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -Number.NaN]) {
    assert.equal(isOff(limit as number), true, String(limit));
    assert.equal(isActive(limit as number), false, String(limit));
  }
  assert.equal(isOff(1), false);
  const ledger = ledgerWith([record({ usageId: "a", inputTokens: 1_000_000, costUsd: 9999 })]);
  for (const limit of [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const reading = readCeiling(
      { scope: "run", dimension: "costUsd", limit: limit as number },
      usage(ledger),
    );
    assert.equal(reading.active, false, String(limit));
    assert.equal(reading.exhausted, false, `an inactive ceiling never trips: ${String(limit)}`);
    assert.equal(reading.limit, null);
  }
});

test("T009 (all exhausted ceilings reported): every one, not the first", () => {
  const ledger = ledgerWith([
    record({ usageId: "a", inputTokens: 100, outputTokens: 50, costUsd: 12, isCall: true }),
    record({ usageId: "b", inputTokens: 100, outputTokens: 50, costUsd: 12, isCall: true }),
  ]);
  ledger.run.phaseAttempts = 4;
  const ceilings: readonly Ceiling[] = [
    { scope: "run", dimension: "tokens", limit: 100 },
    { scope: "run", dimension: "costUsd", limit: 10 },
    { scope: "run", dimension: "calls", limit: 2 },
    { scope: "run", dimension: "phaseAttempts", limit: 3 },
    { scope: "run", dimension: "wallClock", limit: 1 },
    { scope: "role", role: "proposer", dimension: "tokens", limit: 1_000_000 },
  ];
  const evaluation = evaluateCeilings(ceilings, usage(ledger, 61 / 60));
  assert.equal(evaluation.readings.length, 6);
  assert.equal(evaluation.exhausted.length, 5, "five of the six are exhausted");
  assert.deepEqual(
    evaluation.exhausted.map((reading) => reading.dimension),
    ["tokens", "costUsd", "calls", "phaseAttempts", "wallClock"],
  );
  assert.deepEqual(
    evaluation.exhaustedCapsOfSpend.map((reading) => reading.dimension),
    ["tokens", "costUsd", "calls", "phaseAttempts"],
    "the four caps of spend take the path of F127-FR-034",
  );
  assert.equal(
    evaluation.wallClockTripped?.dimension,
    "wallClock",
    "and the wall clock is reported apart (F127-FR-027, CQ-192)",
  );
  assert.equal(evaluation.wallClockTripped?.isCapOfSpend, false);
});

test("T009: a reached ceiling names which one tripped and by how much, and is resumable", () => {
  const ledger = ledgerWith([record({ usageId: "a", costUsd: 13 })]);
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, usage(ledger));
  assert.equal(reading.exhausted, true);
  assert.equal(reading.used, 13);
  assert.equal(reading.limit, 10);
  assert.equal(reading.over, 3, "by how much (F127-FR-024)");
  assert.equal(reading.resumable, true, "raising the ceiling and `resume` continues");
  const payload = budgetExceededPayload(reading);
  assert.deepEqual(payload, {
    dimension: "costUsd",
    limit: 10,
    used: 13,
    role: null,
    resumable: true,
    over: 3,
    key: "budget.run.costUsd",
    scope: "run",
  });
});

test("T009: the configuration keys of §Q.3", () => {
  assert.equal(keyOf({ scope: "run", dimension: "tokens", limit: 1 }), "budget.run.tokens");
  assert.equal(
    keyOf({ scope: "role", role: "critic", dimension: "costUsd", limit: 1 }),
    "budget.role.critic.costUsd",
  );
  assert.equal(
    keyOf({ scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1 }),
    "budget.role.proposer.softTokens",
  );
  assert.equal(keyOf({ scope: "run", dimension: "wallClock", limit: 1 }), "loop.maxWallMin");
});

test("T009: a ceiling whose usage is unknown does not trip", () => {
  const ledger = ledgerWith([
    record({ usageId: "a", costUsd: null, inputTokens: null, outputTokens: null }),
  ]);
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 1 }, usage(ledger));
  assert.equal(reading.used, null, "null is unknown, not zero (F127-FR-028)");
  assert.equal(reading.exhausted, false);
  // The wall clock with no elapsed figure handed in is unknown too.
  const wall = readCeiling({ scope: "run", dimension: "wallClock", limit: 1 }, usage(ledger));
  assert.equal(wall.used, null);
  assert.equal(wall.exhausted, false);
});

test("T009: the budget level of a reader is the highest threshold reached (§Q.4)", () => {
  assert.deepEqual([...ALERT_THRESHOLDS], [50, 75, 90]);
  const levels: [number, string][] = [
    [10, "none"],
    [50, "50"],
    [74, "50"],
    [75, "75"],
    [89, "75"],
    [90, "90"],
    [99, "90"],
    [100, "exceeded"],
    [120, "exceeded"],
  ];
  for (const [used, expected] of levels) {
    const ledger = ledgerWith([record({ usageId: `u${used}`, costUsd: used })]);
    const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 100 }, usage(ledger));
    assert.equal(budgetLevelOf(reading), expected, `used ${used}`);
  }
  // An inactive ceiling has no level.
  const off = readCeiling(
    { scope: "run", dimension: "costUsd", limit: 0 },
    usage(emptyLedger("r")),
  );
  assert.equal(budgetLevelOf(off), "none");
});

test("T009 (checkpoint): the evaluation reads no clock — the fake clock never moves", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const ledger = ledgerWith([record({ usageId: "a", costUsd: 5 })]);
  for (let i = 0; i < 500; i += 1) {
    evaluateCeilings(
      [
        { scope: "run", dimension: "costUsd", limit: 10 },
        { scope: "run", dimension: "wallClock", limit: 60 },
      ],
      // The elapsed minutes are handed in; the module reads no clock itself.
      usage(ledger, (ports.clock.nowMs() - before) / 60_000),
    );
  }
  assert.equal(ports.clock.nowMs(), before, "no clock reading moved (F127-FR-026)");
  assert.equal(ports.fileWriter.writes.length, 0);
  assert.equal(ports.eventWriter.events.length, 0);
});
