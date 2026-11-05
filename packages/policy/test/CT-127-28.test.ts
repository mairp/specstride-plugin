/**
 * CT-127-28 (T063) — the characterization test of NOTIONAL COST KEPT APART,
 * NEVER IN REAL SPEND, and the "observed by Specstride only" MARK
 * (F127-FR-029, ruling 66).
 *
 * The requirement, clause by clause:
 *
 *  1. a cost a harness reports under billing mode `subscription` is LABELLED
 *     NOTIONAL and kept in ITS OWN FIELD of the ledger, apart from real spend;
 *  2. it FEEDS THE ALERTS of §Q.4 and the digest AS VALUE USED;
 *  3. it is NEVER ADDED to real spend;
 *  4. it is NEVER CHECKED against a hard ceiling;
 *  5. in the digest, spend under a subscription that is shared with
 *     interactive use is MARKED "observed by Specstride only".
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COST_FIELDS,
  OBSERVED_BY_SPECSTRIDE_ONLY,
  applyUsageRecord,
  digestValueUsed,
  emptyLedger,
  estimatedCostUsd,
  notionalCostUsd,
  realCostUsd,
  sumOf,
  type SpendLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { SOFT_DIMENSION, evaluateCeilings, readCeiling } from "../src/budget/ceilings.ts";
import { billingModeLine } from "../src/budget/announce.ts";
import { decideThresholdAlerts, emptyAlertState } from "../src/budget/alerts.ts";
import {
  decideSoftAlerts,
  emptyObservedState,
  observe,
  softReading,
} from "../src/budget/observed.ts";

const RUN = "run-ct-127-28";

function subscriptionSpend(amount: number, tokens = 1_000): SpendLedger {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "s-1",
    role: "proposer",
    billingMode: "subscription",
    inputTokens: tokens,
    costUsd: amount,
    isCall: true,
    closesAPass: true,
  } satisfies UsageRecord).ledger;
  return ledger;
}

/* ------------------------------------------------------------------ *
 * 1. Its own field, apart from real spend.
 * ------------------------------------------------------------------ */

test("CT-127-28: the ledger has three cost fields and they are distinct", () => {
  assert.deepEqual([...COST_FIELDS], ["realCostUsd", "notionalCostUsd", "estimatedCostUsd"]);
});

test("CT-127-28: a `subscription` cost lands in `notionalCostUsd` and nowhere else", () => {
  const ledger = subscriptionSpend(12);
  assert.equal(notionalCostUsd(ledger), 12);
  assert.equal(realCostUsd(ledger), null);
  assert.equal(estimatedCostUsd(ledger), null);
  const bucket = ledger.roles.proposer.byBilling.subscription;
  assert.equal(bucket?.notionalCostUsd, 12);
  assert.equal(bucket?.realCostUsd, null);
});

test("CT-127-28: real and notional spend of the same role are never summed together", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "a-1",
    role: "proposer",
    billingMode: "api",
    costUsd: 3,
  }).ledger;
  ledger = applyUsageRecord(ledger, {
    usageId: "s-1",
    role: "proposer",
    billingMode: "subscription",
    costUsd: 20,
  }).ledger;
  assert.equal(realCostUsd(ledger), 3);
  assert.equal(notionalCostUsd(ledger), 20);
  // 23 is a figure this feature never produces.
  assert.notEqual(realCostUsd(ledger), 23);
  assert.equal(sumOf(ledger, "realCostUsd", { modes: ["api"] }), 3);
  assert.equal(sumOf(ledger, "notionalCostUsd"), 20);
});

test("CT-127-28: an `unknown` record is notional too; `api` alone is real spend", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "u-1",
    role: "proposer",
    billingMode: "unknown",
    costUsd: 9,
  }).ledger;
  assert.equal(notionalCostUsd(ledger), 9);
  assert.equal(realCostUsd(ledger), null);
});

/* ------------------------------------------------------------------ *
 * 4. Never checked against a hard ceiling.
 * ------------------------------------------------------------------ */

test("CT-127-28: notional cost is never checked against a hard ceiling", () => {
  const ledger = subscriptionSpend(10_000);
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 1 },
      { scope: "role", role: "proposer", dimension: "costUsd", limit: 1 },
    ],
    { ledger },
  );
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(
    evaluation.readings.every((reading) => reading.used === null),
    true,
  );
});

/* ------------------------------------------------------------------ *
 * 2. It feeds the alerts and the digest.
 * ------------------------------------------------------------------ */

test("CT-127-28: notional tokens feed the soft budget and raise alerts", () => {
  const ledger = subscriptionSpend(10, 900);
  const reading = readCeiling(
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1_000 },
    { ledger },
  );
  assert.equal(reading.used, 900);
  const decided = decideThresholdAlerts({
    reading,
    state: emptyAlertState(),
    context: { billingMode: "subscription", scope: "role", dimension: SOFT_DIMENSION },
  });
  // 90 per cent of the soft budget: 50, 75 and 90 are all crossed.
  assert.deepEqual(
    decided.map((alert) => alert.threshold),
    [50, 75, 90],
  );
  assert.equal(
    decided.every((alert) => alert.kind === "budget-threshold"),
    true,
  );
});

test("CT-127-28: the observation-based alert of a subscription names the notional figure", () => {
  const ledger = subscriptionSpend(10, 900);
  const observed = observe(emptyObservedState(), {
    role: "proposer",
    tokens: 900,
    notionalCostUsd: 10,
  });
  const reading = softReading("proposer", 1_000, observed);
  assert.equal(reading.used, 900);
  const decided = decideSoftAlerts({ reading, state: emptyAlertState() });
  assert.deepEqual(
    decided.map((alert) => alert.threshold),
    [50, 75, 90],
  );
  // Never `loud`: no metered money is at risk under a subscription.
  assert.equal(
    decided.some((alert) => alert.level === "loud"),
    false,
  );
  assert.equal(notionalCostUsd(ledger), 10);
});

test("CT-127-28: the digest shows the notional figure as VALUE USED", () => {
  const ledger = subscriptionSpend(12);
  const digest = digestValueUsed(ledger, { role: "proposer" });
  assert.equal(digest.notional, true);
  assert.equal(digest.notionalCostUsd, 12);
  // Real spend is in the same answer, kept apart and not summed.
  assert.equal(digest.realCostUsd, null);
});

/* ------------------------------------------------------------------ *
 * 5. The mark.
 * ------------------------------------------------------------------ */

test("CT-127-28: the mark is `observed by Specstride only`", () => {
  assert.equal(OBSERVED_BY_SPECSTRIDE_ONLY, "observed by Specstride only");
});

test("CT-127-28: a shared subscription is marked in the digest", () => {
  const digest = digestValueUsed(subscriptionSpend(12), {
    role: "proposer",
    sharedWithInteractiveUse: true,
  });
  assert.equal(digest.mark, OBSERVED_BY_SPECSTRIDE_ONLY);
  assert.match(digest.line, /observed by Specstride only/);
  assert.match(digest.line, /value used 12/);
  assert.match(digest.line, /notional/);
});

test("CT-127-28: real spend carries no such mark", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "a-1",
    role: "proposer",
    billingMode: "api",
    costUsd: 3,
  }).ledger;
  const digest = digestValueUsed(ledger, { role: "proposer" });
  assert.equal(digest.notional, false);
  assert.equal(digest.mark, null);
  assert.equal(digest.realCostUsd, 3);
  assert.doesNotMatch(digest.line, /observed by Specstride only/);
});

test("CT-127-28: the announcement of a subscription role carries the same words", () => {
  assert.match(billingModeLine("subscription"), /observed by Specstride only/);
  assert.match(billingModeLine("subscription"), /notional/);
  assert.doesNotMatch(billingModeLine("api"), /observed by Specstride only/);
});
