/**
 * CT-127-29 (T064) — the characterization test of ESTIMATED COST FROM A
 * DECLARED RATE TABLE (F127-FR-030).
 *
 * The requirement, clause by clause:
 *
 *  1. a consumer MAY declare a rate table per harness and model
 *     (`budget.rates`);
 *  2. a figure computed from it is a SEPARATE FIELD of estimated cost;
 *  3. it is LABELLED as such;
 *  4. it is NEVER MERGED with reported cost;
 *  5. it is OFF UNLESS DECLARED.
 *
 * Row 110 of annex X §X.7: under the `parity` profile the rate table is
 * UNSET, so estimated cost is off there.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COST_FIELDS,
  applyUsageRecord,
  emptyLedger,
  estimateOf,
  estimatedCostUsd,
  incrementsOf,
  notionalCostUsd,
  rateKeyOf,
  realCostUsd,
  type RateTable,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { evaluateCeilings } from "../src/budget/ceilings.ts";

const RUN = "run-ct-127-29";

/** A declared rate table: US dollars per MILLION tokens, per harness/model. */
const RATES: RateTable = Object.freeze({
  "stub-api/stub-metered": Object.freeze({
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
    reasoningPerMillion: 15,
  }),
  "stub-api/stub-cheap": Object.freeze({ inputPerMillion: 1 }),
});

function call(index: number, over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    usageId: `u-${index}`,
    role: "proposer",
    billingMode: "api",
    harness: "stub-api",
    model: "stub-metered",
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * 1. The key of the table is the harness and the model.
 * ------------------------------------------------------------------ */

test("CT-127-29: the key of the rate table is `<harness>/<model>`", () => {
  assert.equal(rateKeyOf(call(1)), "stub-api/stub-metered");
  assert.equal(rateKeyOf(call(1, { model: "stub-cheap" })), "stub-api/stub-cheap");
  // A record that names neither still has a key, which no entry matches.
  assert.equal(rateKeyOf({ usageId: "x", role: "proposer", billingMode: "api" }), "/");
});

/* ------------------------------------------------------------------ *
 * 5. Off unless declared.
 * ------------------------------------------------------------------ */

test("CT-127-29: with no rate table declared, estimated cost is OFF", () => {
  const record = call(1);
  const increments = incrementsOf(record, {});
  assert.equal(estimateOf(record, increments, undefined), null);

  const ledger = applyUsageRecord(emptyLedger(RUN), record).ledger;
  assert.equal(estimatedCostUsd(ledger), null);
  // Row 110 of annex X §X.7: unset under the `parity` profile.
  const parity = applyUsageRecord(emptyLedger(RUN), record, {}).ledger;
  assert.equal(estimatedCostUsd(parity), null);
});

test("CT-127-29: a table that holds no entry for the harness and model gives null", () => {
  const record = call(1, { harness: "other-harness" });
  assert.equal(estimateOf(record, incrementsOf(record, {}), RATES), null);
  const ledger = applyUsageRecord(emptyLedger(RUN), record, { rates: RATES }).ledger;
  assert.equal(estimatedCostUsd(ledger), null);
});

test("CT-127-29: an entry with no rate for a reported field contributes nothing", () => {
  // `stub-cheap` declares an input rate only; the 100 000 output tokens are not priced.
  const record = call(1, { model: "stub-cheap" });
  const estimate = estimateOf(record, incrementsOf(record, {}), RATES);
  assert.equal(estimate, 1);
});

test("CT-127-29: a record with no known token count gives null, not zero", () => {
  const record = call(1, { inputTokens: null, outputTokens: null });
  assert.equal(estimateOf(record, incrementsOf(record, {}), RATES), null);
});

/* ------------------------------------------------------------------ *
 * 2. The separate field, and the arithmetic.
 * ------------------------------------------------------------------ */

test("CT-127-29: the estimate is the tokens times the rate, per million", () => {
  const record = call(1);
  // 1 000 000 input at 3 per million = 3; 100 000 output at 15 per million = 1.5.
  assert.equal(estimateOf(record, incrementsOf(record, {}), RATES), 4.5);
});

test("CT-127-29: every token field of the entry is priced", () => {
  const record = call(1, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    reasoningTokens: 1_000_000,
  });
  // 3 + 15 + 0.3 + 3.75 + 15
  assert.equal(estimateOf(record, incrementsOf(record, {}), RATES), 37.05);
});

test("CT-127-29: the estimate lands in `estimatedCostUsd` and in no other field", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), call(1), { rates: RATES }).ledger;
  assert.equal(estimatedCostUsd(ledger), 4.5);
  assert.equal(realCostUsd(ledger), null);
  assert.equal(notionalCostUsd(ledger), null);
  const bucket = ledger.roles.proposer.byBilling.api;
  assert.equal(bucket?.estimatedCostUsd, 4.5);
  assert.equal(bucket?.realCostUsd, null);
  assert.equal(bucket?.notionalCostUsd, null);
});

test("CT-127-29: the estimate accumulates over records, converted like any other", () => {
  let ledger = emptyLedger(RUN);
  for (let index = 1; index <= 3; index += 1) {
    ledger = applyUsageRecord(ledger, call(index), { rates: RATES }).ledger;
  }
  assert.equal(estimatedCostUsd(ledger), 13.5);
});

test("CT-127-29: a cumulative record is estimated on its INCREMENT, not its total", () => {
  let ledger = emptyLedger(RUN);
  const cumulative = (index: number, total: number): UsageRecord =>
    call(index, { sessionId: "s-1", cumulative: true, inputTokens: total, outputTokens: null });
  ledger = applyUsageRecord(ledger, cumulative(1, 1_000_000), { rates: RATES }).ledger;
  ledger = applyUsageRecord(ledger, cumulative(2, 2_000_000), { rates: RATES }).ledger;
  // The increments are 1 000 000 and 1 000 000: 3 + 3, not 3 + 6.
  assert.equal(estimatedCostUsd(ledger), 6);
});

/* ------------------------------------------------------------------ *
 * 3 and 4. Labelled, and never merged with reported cost.
 * ------------------------------------------------------------------ */

test("CT-127-29: the field is labelled apart from the two reported figures", () => {
  assert.deepEqual([...COST_FIELDS], ["realCostUsd", "notionalCostUsd", "estimatedCostUsd"]);
  assert.ok(COST_FIELDS.includes("estimatedCostUsd"));
});

test("CT-127-29: a record that reports a cost AND has a rate keeps the two apart", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), call(1, { costUsd: 9 }), {
    rates: RATES,
  }).ledger;
  assert.equal(realCostUsd(ledger), 9);
  assert.equal(estimatedCostUsd(ledger), 4.5);
  // 13.5 is a figure this feature never produces.
  assert.notEqual(realCostUsd(ledger), 13.5);
});

test("CT-127-29: a hard `costUsd` ceiling never reads the estimate", () => {
  const ledger = applyUsageRecord(emptyLedger(RUN), call(1), { rates: RATES }).ledger;
  assert.equal(estimatedCostUsd(ledger), 4.5);
  const evaluation = evaluateCeilings([{ scope: "run", dimension: "costUsd", limit: 1 }], {
    ledger,
  });
  // Nothing was REPORTED, so the hard ceiling has nothing to read and does not trip.
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.readings[0].used, null);
});

test("CT-127-29: an estimate on a subscription record is still its own field", () => {
  const ledger = applyUsageRecord(
    emptyLedger(RUN),
    call(1, { billingMode: "subscription", costUsd: 20 }),
    { rates: RATES },
  ).ledger;
  assert.equal(notionalCostUsd(ledger), 20);
  assert.equal(estimatedCostUsd(ledger), 4.5);
  assert.equal(realCostUsd(ledger), null);
});
