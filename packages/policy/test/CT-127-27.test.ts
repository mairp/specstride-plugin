/**
 * CT-127-27 (T062) — the characterization test of INCREMENTS, DEDUPLICATION,
 * CUMULATIVE CONVERSION, NULL AS UNKNOWN and A KILLED PASS (F127-FR-028).
 *
 * "Spend MUST be counted the same way for every provider." The five clauses:
 *
 *  1. the unit of the ledger is an INCREMENT;
 *  2. a CUMULATIVE report is converted to an increment PER SESSION (the new
 *     value minus the last seen), or dropped in favour of a terminal total,
 *     and a sum over cumulative records is NEVER taken;
 *  3. a record is DEDUPLICATED by its `usageId`;
 *  4. a value the harness did not report is `null` and sums as UNKNOWN, not
 *     as zero; the ledger carries the passes with a known cost and the total;
 *  5. a KILLED PASS loses nothing already reported.
 *
 * And the billing mode every usage record carries (`api`, `subscription`,
 * `unknown`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_MODES,
  SEEN_USAGE_IDS_CAP,
  addUnknownAware,
  applyUsageRecord,
  coverageOf,
  emptyLedger,
  hardTokens,
  incrementsOf,
  ledgerPaths,
  parseLedger,
  readBillingMode,
  realCostUsd,
  recordUsage,
  sumOf,
  type CumulativeSeen,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const PATHS = ledgerPaths("/run/control/spend.json");
const RUN = "run-ct-127-27";

/* ------------------------------------------------------------------ *
 * 1. The unit is an increment.
 * ------------------------------------------------------------------ */

test("CT-127-27: a record that is not cumulative is already an increment", () => {
  const lastSeen: Record<string, CumulativeSeen> = {};
  const increments = incrementsOf(
    { usageId: "u-1", role: "proposer", billingMode: "api", inputTokens: 120, costUsd: 3 },
    lastSeen,
  );
  assert.equal(increments.inputTokens, 120);
  assert.equal(increments.costUsd, 3);
  // Nothing was remembered: there is no session state for a plain increment.
  assert.deepEqual(lastSeen, {});
});

test("CT-127-27: increments add up over records", () => {
  let ledger = emptyLedger(RUN);
  for (let index = 1; index <= 3; index += 1) {
    ledger = applyUsageRecord(ledger, {
      usageId: `u-${index}`,
      role: "proposer",
      billingMode: "api",
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 2,
    }).ledger;
  }
  assert.equal(hardTokens(ledger), 330);
  assert.equal(realCostUsd(ledger), 6);
});

/* ------------------------------------------------------------------ *
 * 2. The cumulative conversion.
 * ------------------------------------------------------------------ */

test("CT-127-27: a cumulative report becomes the new value minus the last seen", () => {
  let ledger = emptyLedger(RUN);
  const cumulative = (index: number, total: number): UsageRecord => ({
    usageId: `c-${index}`,
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    inputTokens: total,
    costUsd: total / 100,
  });
  // The harness reports 100, then 250, then 400 — the same session's running total.
  for (const [index, total] of [100, 250, 400].entries()) {
    ledger = applyUsageRecord(ledger, cumulative(index, total)).ledger;
  }
  // A SUM over the cumulative records would be 750. The ledger holds 400.
  assert.equal(hardTokens(ledger), 400);
  assert.equal(realCostUsd(ledger), 4);
});

test("CT-127-27: the conversion is PER SESSION: two sessions never subtract from one another", () => {
  let ledger = emptyLedger(RUN);
  const of = (session: string, index: number, total: number): UsageRecord => ({
    usageId: `${session}-${index}`,
    role: "proposer",
    billingMode: "api",
    sessionId: session,
    cumulative: true,
    inputTokens: total,
  });
  ledger = applyUsageRecord(ledger, of("s-1", 1, 300)).ledger;
  ledger = applyUsageRecord(ledger, of("s-2", 1, 100)).ledger;
  ledger = applyUsageRecord(ledger, of("s-2", 2, 180)).ledger;
  ledger = applyUsageRecord(ledger, of("s-1", 2, 320)).ledger;
  // s-1 gave 300 then 20; s-2 gave 100 then 80.
  assert.equal(hardTokens(ledger), 500);
  assert.deepEqual(Object.keys(ledger.lastSeen).sort(), ["s-1", "s-2"]);
});

test("CT-127-27: a provider that restarts its counter never subtracts", () => {
  let ledger = emptyLedger(RUN);
  const of = (index: number, total: number): UsageRecord => ({
    usageId: `r-${index}`,
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    inputTokens: total,
  });
  ledger = applyUsageRecord(ledger, of(1, 500)).ledger;
  ledger = applyUsageRecord(ledger, of(2, 40)).ledger;
  // 40 - 500 is negative; the increment is 0 and the figure never falls.
  assert.equal(hardTokens(ledger), 500);
});

test("CT-127-27: a terminal total drops the running conversion in favour of itself", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "t-1",
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    inputTokens: 100,
  }).ledger;
  ledger = applyUsageRecord(ledger, {
    usageId: "t-2",
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    terminal: true,
    inputTokens: 260,
  }).ledger;
  assert.equal(hardTokens(ledger), 260);
  // The session's state is forgotten: the terminal total ended it.
  assert.equal(ledger.lastSeen["s-1"], undefined);
});

test("CT-127-27: a cumulative record with no session id is kept per role", () => {
  const lastSeen: Record<string, CumulativeSeen> = {};
  incrementsOf(
    { usageId: "n-1", role: "critic", billingMode: "api", cumulative: true, inputTokens: 90 },
    lastSeen,
  );
  assert.deepEqual(Object.keys(lastSeen), ["critic\u0000(no session)"]);
});

/* ------------------------------------------------------------------ *
 * 3. Deduplication by `usageId`.
 * ------------------------------------------------------------------ */

test("CT-127-27: a record whose `usageId` was already applied changes NOTHING", () => {
  let ledger = emptyLedger(RUN);
  const one: UsageRecord = {
    usageId: "u-1",
    role: "proposer",
    billingMode: "api",
    inputTokens: 100,
    costUsd: 3,
    isCall: true,
    closesAPass: true,
  };
  ledger = applyUsageRecord(ledger, one).ledger;
  const again = applyUsageRecord(ledger, one);
  assert.equal(again.applied, false);
  assert.match(again.reason ?? "", /already applied/);
  // Not a token, not a count, not a coverage counter.
  assert.equal(hardTokens(again.ledger), 100);
  assert.equal(realCostUsd(again.ledger), 3);
  assert.deepEqual(coverageOf(again.ledger), { passesWithKnownCost: 1, passesTotal: 1 });
  assert.equal(sumOf(again.ledger, "calls"), 1);
});

test("CT-127-27: a record with no `usageId` is refused, not counted", () => {
  const ledger = emptyLedger(RUN);
  const result = applyUsageRecord(ledger, {
    usageId: "",
    role: "proposer",
    billingMode: "api",
    costUsd: 5,
  });
  assert.equal(result.applied, false);
  assert.match(result.reason ?? "", /usageId/);
  assert.equal(realCostUsd(result.ledger), null);
});

test("CT-127-27: the list of seen ids is bounded and drops the oldest", () => {
  let ledger = emptyLedger(RUN);
  for (let index = 0; index < 5; index += 1) {
    ledger = applyUsageRecord(
      ledger,
      { usageId: `u-${index}`, role: "proposer", billingMode: "api", costUsd: 1 },
      { seenCap: 3 },
    ).ledger;
  }
  assert.deepEqual(ledger.seenUsageIds, ["u-2", "u-3", "u-4"]);
  assert.equal(realCostUsd(ledger), 5);
  assert.equal(SEEN_USAGE_IDS_CAP, 1000);
});

/* ------------------------------------------------------------------ *
 * 4. Null as unknown, and the coverage counters.
 * ------------------------------------------------------------------ */

test("CT-127-27: a value the harness did not report is null and sums as unknown", () => {
  assert.equal(addUnknownAware(null, null), null);
  assert.equal(addUnknownAware(null, 5), 5);
  assert.equal(addUnknownAware(5, null), 5);
  assert.equal(addUnknownAware(5, 3), 8);
  // Not zero: a ledger that was never told a cost answers `null`.
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "u-1",
    role: "proposer",
    billingMode: "api",
    inputTokens: 100,
  }).ledger;
  assert.equal(realCostUsd(ledger), null);
  assert.notEqual(realCostUsd(ledger), 0);
  assert.equal(hardTokens(ledger), 100);
});

test("CT-127-27: the ledger carries the passes with a known cost and the total", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "u-1",
    role: "proposer",
    billingMode: "api",
    costUsd: 2,
    closesAPass: true,
  }).ledger;
  ledger = applyUsageRecord(ledger, {
    usageId: "u-2",
    role: "proposer",
    billingMode: "api",
    costUsd: null,
    closesAPass: true,
  }).ledger;
  ledger = applyUsageRecord(ledger, {
    usageId: "u-3",
    role: "proposer",
    billingMode: "api",
    costUsd: 4,
    closesAPass: true,
  }).ledger;
  assert.deepEqual(coverageOf(ledger), { passesWithKnownCost: 2, passesTotal: 3 });
  // The figure is 6 over the two known passes, and the coverage says so.
  assert.equal(realCostUsd(ledger), 6);
});

test("CT-127-27: a probe is neither a pass nor a call (F127-FR-006)", () => {
  let ledger = emptyLedger(RUN);
  ledger = applyUsageRecord(ledger, {
    usageId: "probe-1",
    role: "proposer",
    billingMode: "api",
    costUsd: 0.5,
    isProbe: true,
    isCall: true,
    closesAPass: true,
  }).ledger;
  assert.deepEqual(coverageOf(ledger), { passesWithKnownCost: 0, passesTotal: 0 });
  assert.equal(sumOf(ledger, "calls"), 0);
  // Its spend is real, in the field the schema gives it.
  assert.equal(ledger.roles.proposer.probesUsd, 0.5);
  assert.equal(realCostUsd(ledger), 0.5);
});

/* ------------------------------------------------------------------ *
 * The billing mode every record carries.
 * ------------------------------------------------------------------ */

test("CT-127-27: a usage record carries one of the three billing modes", () => {
  assert.deepEqual([...BILLING_MODES], ["api", "subscription", "unknown"]);
  for (const mode of BILLING_MODES) assert.equal(readBillingMode(mode), mode);
  for (const other of ["metered", "", null, undefined, "API"]) {
    assert.equal(readBillingMode(other as string | null | undefined), "unknown");
  }
});

/* ------------------------------------------------------------------ *
 * 5. A killed pass loses nothing already reported.
 * ------------------------------------------------------------------ */

test("CT-127-27: a killed pass loses nothing already reported", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  // Three records of a pass reach the engine, each written at once.
  for (let index = 1; index <= 3; index += 1) {
    ledger = recordUsage(ports.fileWriter, PATHS, ledger, {
      usageId: `u-${index}`,
      role: "proposer",
      billingMode: "api",
      inputTokens: 100,
      costUsd: 2,
      isCall: true,
    }).ledger;
  }
  // The pass is killed before it could close. The file holds all three.
  const onDisk = parseLedger(ports.fileWriter.read(PATHS.ledger));
  assert.equal(realCostUsd(onDisk), 6);
  assert.equal(hardTokens(onDisk), 300);
  assert.equal(sumOf(onDisk, "calls"), 3);
  // No pass closed, so the coverage says 0 of 0 — the spend is still counted.
  assert.deepEqual(coverageOf(onDisk), { passesWithKnownCost: 0, passesTotal: 0 });
});

test("CT-127-27: a killed pass whose session restarts does not double-count", () => {
  const ports = testPorts();
  const ledger = emptyLedger(RUN);
  recordUsage(ports.fileWriter, PATHS, ledger, {
    usageId: "k-1",
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    inputTokens: 200,
  });
  // The engine is killed and restarts; the harness replays the same record.
  const reread = parseLedger(ports.fileWriter.read(PATHS.ledger));
  const again = applyUsageRecord(reread, {
    usageId: "k-1",
    role: "proposer",
    billingMode: "api",
    sessionId: "s-1",
    cumulative: true,
    inputTokens: 200,
  });
  assert.equal(again.applied, false);
  assert.equal(hardTokens(again.ledger), 200);
});
