/**
 * T007 — the unit tests of the spend ledger (F127-FR-028, F127-FR-029,
 * F127-FR-030, F127-FR-031), on the fake file writer and the fake clock of
 * T003.
 *
 * One test per rule the task names: atomic write, previous generation,
 * deduplication by `usageId`, cumulative to increment, null as unknown,
 * coverage counters, three billing modes apart, estimated cost from a declared
 * rate table in its own field and off unless declared.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addUnknownAware,
  applyUsageRecord,
  BILLING_MODES,
  bucketOf,
  callCount,
  coverageOf,
  emptyLedger,
  estimatedCostUsd,
  hardTokens,
  incrementsOf,
  LEDGER_SCHEMA_ID,
  ledgerPaths,
  notionalCostUsd,
  observedTokens,
  parseLedger,
  readBillingMode,
  realCostUsd,
  recordUsage,
  serializeLedger,
  writeLedger,
  type RateTable,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const base = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  usageId: "u1",
  role: "proposer",
  billingMode: "api",
  inputTokens: 100,
  outputTokens: 20,
  costUsd: 0.5,
  ...over,
});

test("T007: a fresh ledger carries the schema id and nothing else", () => {
  const ledger = emptyLedger("run-1");
  assert.equal(ledger.schema, LEDGER_SCHEMA_ID);
  assert.equal(ledger.runId, "run-1");
  assert.equal(ledger.generation, 0);
  assert.deepEqual(ledger.roles, {});
  assert.deepEqual(ledger.run, { phaseAttempts: 0, pausedMs: 0 });
  assert.equal(ledger.windows.episodeStart, null);
  assert.deepEqual(ledger.alertsFired, []);
});

test("T007 (atomic write): every write goes through the AtomicWrite port", () => {
  const ports = testPorts();
  const paths = ledgerPaths("/run/spend.json");
  const written = writeLedger(ports.fileWriter, paths, emptyLedger("run-1"));
  assert.equal(written.generation, 1, "the generation rises on every write");
  assert.deepEqual(
    ports.fileWriter.writes.map((write) => write.path),
    [paths.ledger],
    "one write, through the port",
  );
  assert.equal(parseLedger(ports.fileWriter.read(paths.ledger)).generation, 1);
});

test("T007 (previous generation): the last good copy is written BEFORE the ledger", () => {
  const ports = testPorts();
  const paths = ledgerPaths("/run/spend.json");
  const first = writeLedger(ports.fileWriter, paths, emptyLedger("run-1"));
  const second = writeLedger(ports.fileWriter, paths, first);
  assert.deepEqual(
    ports.fileWriter.writes.map((write) => write.path),
    [paths.ledger, paths.previous, paths.ledger],
    "the previous generation precedes the ledger on the second write",
  );
  assert.equal(second.generation, 2);
  assert.equal(
    parseLedger(ports.fileWriter.read(paths.previous)).generation,
    1,
    "the previous generation holds generation 1",
  );
});

test("T007 (previous generation): an unreadable ledger never overwrites a good copy", () => {
  const ports = testPorts();
  const paths = ledgerPaths("/run/spend.json");
  const first = writeLedger(ports.fileWriter, paths, emptyLedger("run-1"));
  writeLedger(ports.fileWriter, paths, first); // previous := generation 1
  ports.fileWriter.makeUnreadable(paths.ledger);
  writeLedger(ports.fileWriter, paths, emptyLedger("run-1"));
  assert.equal(
    parseLedger(ports.fileWriter.read(paths.previous)).generation,
    1,
    "the good previous generation is still there",
  );
});

test("T007 (deduplication): the same usageId changes nothing the second time", () => {
  let ledger = emptyLedger("run-1");
  const first = applyUsageRecord(ledger, base());
  assert.equal(first.applied, true);
  ledger = first.ledger;
  assert.equal(hardTokens(ledger), 120);

  const again = applyUsageRecord(ledger, base({ inputTokens: 999, costUsd: 99 }));
  assert.equal(again.applied, false);
  assert.match(again.reason ?? "", /already applied/);
  assert.equal(again.ledger, ledger, "the ledger value is unchanged");
  assert.equal(hardTokens(again.ledger), 120, "not a token moved");
  assert.equal(realCostUsd(again.ledger), 0.5);

  // A record with no usageId is refused for the same reason.
  assert.equal(applyUsageRecord(ledger, base({ usageId: "" })).applied, false);
});

test("T007 (deduplication): the list of seen ids is bounded and drops the oldest", () => {
  let ledger = emptyLedger("run-1");
  for (let i = 0; i < 5; i += 1) {
    ledger = applyUsageRecord(ledger, base({ usageId: `u${i}` }), { seenCap: 3 }).ledger;
  }
  assert.deepEqual(ledger.seenUsageIds, ["u2", "u3", "u4"]);
});

test("T007 (cumulative to increment): the new value minus the last seen, per session", () => {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(
    ledger,
    base({
      usageId: "c1",
      sessionId: "s1",
      cumulative: true,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 1,
    }),
  ).ledger;
  assert.equal(hardTokens(ledger), 110);
  // A second cumulative report of the SAME session: only the increment is added.
  ledger = applyUsageRecord(
    ledger,
    base({
      usageId: "c2",
      sessionId: "s1",
      cumulative: true,
      inputTokens: 250,
      outputTokens: 30,
      costUsd: 3,
    }),
  ).ledger;
  assert.equal(hardTokens(ledger), 280, "250 + 30, not 100+10+250+30");
  assert.equal(realCostUsd(ledger), 3);
  // Another session subtracts from its own last-seen only.
  ledger = applyUsageRecord(
    ledger,
    base({
      usageId: "c3",
      sessionId: "s2",
      cumulative: true,
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 1,
    }),
  ).ledger;
  assert.equal(hardTokens(ledger), 290);
  assert.equal(realCostUsd(ledger), 4);
});

test("T007 (cumulative to increment): a restarted counter never subtracts", () => {
  const lastSeen = { s1: { inputTokens: 500 } };
  const increments = incrementsOf(
    base({ sessionId: "s1", cumulative: true, inputTokens: 10, outputTokens: null, costUsd: null }),
    lastSeen,
  );
  assert.equal(increments.inputTokens, 0, "never below zero");
});

test("T007 (cumulative to increment): a terminal total drops the running conversion", () => {
  const lastSeen: Record<string, Record<string, number>> = {};
  incrementsOf(base({ sessionId: "s1", cumulative: true, inputTokens: 100 }), lastSeen);
  assert.equal(lastSeen.s1.inputTokens, 100);
  const terminal = incrementsOf(
    base({ sessionId: "s1", cumulative: true, terminal: true, inputTokens: 400 }),
    lastSeen,
  );
  assert.equal(terminal.inputTokens, 300, "the terminal total minus what was already counted");
  assert.equal("s1" in lastSeen, false, "the session's running state is forgotten");
});

test("T007 (null as unknown): a value not reported sums as unknown and not as zero", () => {
  assert.equal(addUnknownAware(null, null), null, "unknown plus unknown is unknown");
  assert.equal(addUnknownAware(null, 5), 5, "the first known value");
  assert.equal(addUnknownAware(5, null), 5, "an unknown increment adds nothing");
  assert.equal(addUnknownAware(5, 0), 5, "a reported zero is not unknown");

  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "n1", inputTokens: null, outputTokens: null, costUsd: null }),
  ).ledger;
  const bucket = bucketOf(ledger, "proposer", "api");
  assert.equal(bucket.inputTokens, null, "still unknown, not 0");
  assert.equal(bucket.realCostUsd, null);
  assert.equal(hardTokens(ledger), null, "the sum is unknown");
  // A later known value makes the figure known, and the unknown one added nothing.
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "n2", inputTokens: 7, outputTokens: 3, costUsd: 2 }),
  ).ledger;
  assert.equal(hardTokens(ledger), 10);
  assert.equal(realCostUsd(ledger), 2);
});

test("T007 (coverage counters): passesWithKnownCost and passesTotal", () => {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, base({ usageId: "p1", closesAPass: true, costUsd: 1 })).ledger;
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "p2", closesAPass: true, costUsd: null }),
  ).ledger;
  ledger = applyUsageRecord(ledger, base({ usageId: "p3", closesAPass: true, costUsd: 2 })).ledger;
  assert.deepEqual(coverageOf(ledger), { passesWithKnownCost: 2, passesTotal: 3 });
  assert.deepEqual(coverageOf(ledger, "proposer"), { passesWithKnownCost: 2, passesTotal: 3 });
  // A record that closes no pass moves neither counter.
  ledger = applyUsageRecord(ledger, base({ usageId: "p4" })).ledger;
  assert.deepEqual(coverageOf(ledger), { passesWithKnownCost: 2, passesTotal: 3 });
});

test("T007 (three billing modes apart): real, notional and estimated are never summed", () => {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, base({ usageId: "a", billingMode: "api", costUsd: 3 })).ledger;
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "s", billingMode: "subscription", costUsd: 10 }),
  ).ledger;
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "x", billingMode: "unknown", costUsd: 7 }),
  ).ledger;

  assert.equal(realCostUsd(ledger), 3, "only the api record is real spend (F127-FR-025)");
  assert.equal(notionalCostUsd(ledger), 17, "subscription and unknown are notional");
  assert.equal(estimatedCostUsd(ledger), null, "no rate table was declared");

  const spend = ledger.roles.proposer;
  assert.equal(spend.byBilling.api?.realCostUsd, 3);
  assert.equal(spend.byBilling.api?.notionalCostUsd, null, "a mode's fields stay apart");
  assert.equal(spend.byBilling.subscription?.realCostUsd, null, "never real spend (F127-FR-029)");
  assert.equal(spend.byBilling.subscription?.notionalCostUsd, 10);
  assert.equal(spend.byBilling.unknown?.realCostUsd, null);
  assert.deepEqual([...BILLING_MODES], ["api", "subscription", "unknown"]);
});

test("T007 (three billing modes apart): a hard ceiling reads api tokens only", () => {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "a", billingMode: "api", inputTokens: 10, outputTokens: 1 }),
  ).ledger;
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "s", billingMode: "subscription", inputTokens: 100, outputTokens: 10 }),
  ).ledger;
  ledger = applyUsageRecord(
    ledger,
    base({ usageId: "x", billingMode: "unknown", inputTokens: 1000, outputTokens: 100 }),
  ).ledger;
  assert.equal(hardTokens(ledger), 11, "api alone (F127-FR-025)");
  assert.equal(observedTokens(ledger), 1221, "the soft budget counts every observed token");
});

test("T007 (three billing modes apart): a mode outside the three is read as unknown", () => {
  assert.equal(readBillingMode("metered"), "unknown");
  assert.equal(readBillingMode(undefined), "unknown");
  assert.equal(readBillingMode("api"), "api");
  const result = applyUsageRecord(emptyLedger("r"), base({ billingMode: "metered" }));
  assert.equal(result.billingMode, "unknown");
  assert.equal(realCostUsd(result.ledger), null, "and so it is not real spend");
});

test("T007 (cache and reasoning tokens): shown apart and never folded into the ceiling", () => {
  const result = applyUsageRecord(
    emptyLedger("r"),
    base({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 500,
      cacheWriteTokens: 600,
      reasoningTokens: 700,
    }),
  );
  const bucket = bucketOf(result.ledger, "proposer", "api");
  assert.equal(bucket.cacheReadTokens, 500);
  assert.equal(bucket.cacheWriteTokens, 600);
  assert.equal(bucket.reasoningTokens, 700);
  assert.equal(hardTokens(result.ledger), 2, "input plus output only (§Q.3)");
});

test("T007 (estimated cost): off unless a rate table is declared", () => {
  const record = base({
    harness: "claude",
    model: "opus",
    inputTokens: 1_000_000,
    outputTokens: 0,
    costUsd: null,
  });
  assert.equal(estimatedCostUsd(applyUsageRecord(emptyLedger("r"), record).ledger), null);
  assert.equal(
    estimatedCostUsd(applyUsageRecord(emptyLedger("r"), record, { rates: {} }).ledger),
    null,
    "a rate table with no entry for the harness and model",
  );
});

test("T007 (estimated cost): from a declared rate table, in its own field, never merged", () => {
  const rates: RateTable = { "claude/opus": { inputPerMillion: 15, outputPerMillion: 75 } };
  const result = applyUsageRecord(
    emptyLedger("r"),
    base({
      harness: "claude",
      model: "opus",
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      costUsd: 4,
    }),
    { rates },
  );
  assert.equal(estimatedCostUsd(result.ledger), 15 + 15, "1M at 15 plus 200k at 75");
  assert.equal(realCostUsd(result.ledger), 4, "the reported cost is untouched");
  const bucket = bucketOf(result.ledger, "proposer", "api");
  assert.equal(bucket.estimatedCostUsd, 30);
  assert.equal(bucket.realCostUsd, 4);
  assert.notEqual(bucket.realCostUsd, bucket.estimatedCostUsd, "never merged (F127-FR-030)");
});

test("T007 (a probe): real spend, and never a pass or a call (F127-FR-006)", () => {
  const result = applyUsageRecord(
    emptyLedger("r"),
    base({ usageId: "probe-1", isProbe: true, closesAPass: true, isCall: true, costUsd: 0.01 }),
  );
  assert.equal(result.ledger.roles.proposer.probesUsd, 0.01);
  assert.equal(realCostUsd(result.ledger), 0.01, "a probe is real spend");
  assert.equal(callCount(result.ledger), 0, "and never a call of the `calls` ceiling");
  assert.deepEqual(coverageOf(result.ledger), { passesWithKnownCost: 0, passesTotal: 0 });
});

test("T007 (calls): the `calls` ceiling counts a record marked as a call", () => {
  let ledger = emptyLedger("r");
  ledger = applyUsageRecord(ledger, base({ usageId: "k1", isCall: true })).ledger;
  ledger = applyUsageRecord(ledger, base({ usageId: "k2", isCall: true })).ledger;
  ledger = applyUsageRecord(ledger, base({ usageId: "k3" })).ledger;
  assert.equal(callCount(ledger), 2);
  assert.equal(callCount(ledger, "proposer"), 2);
  assert.equal(callCount(ledger, "critic"), 0);
});

test("T007: applying a record never mutates the ledger handed in", () => {
  const before = emptyLedger("r");
  const snapshot = serializeLedger(before);
  applyUsageRecord(before, base());
  assert.equal(serializeLedger(before), snapshot);
});

test("T007: a usage record is written atomically at once, so a killed pass loses nothing", () => {
  const ports = testPorts();
  const paths = ledgerPaths("/run/spend.json");
  const result = recordUsage(ports.fileWriter, paths, emptyLedger("run-1"), base());
  assert.equal(result.applied, true);
  assert.equal(result.ledger.generation, 1);
  // The figures are on disk, and survive a reader that knows only the file.
  const fromDisk = parseLedger(ports.fileWriter.read(paths.ledger));
  assert.equal(hardTokens(fromDisk), 120);
  assert.equal(realCostUsd(fromDisk), 0.5);
  // A duplicate writes nothing at all.
  const writes = ports.fileWriter.writes.length;
  assert.equal(recordUsage(ports.fileWriter, paths, result.ledger, base()).applied, false);
  assert.equal(ports.fileWriter.writes.length, writes, "no write for a duplicate");
});

test("T007: parseLedger refuses a value that is not of the form specstride.spend/1", () => {
  assert.throws(() => parseLedger("{not json"), /not JSON/);
  assert.throws(() => parseLedger("[]"), /not a record/);
  assert.throws(() => parseLedger('{"schema":"other/1"}'), /schema id/);
  assert.throws(() => parseLedger('{"schema":"specstride.spend/1"}'), /has no `runId`/);
  assert.throws(
    () =>
      parseLedger(
        '{"schema":"specstride.spend/1","runId":"r","generation":-1,"roles":{},"run":{},"windows":{}}',
      ),
    /generation/,
  );
});

test("T007 (checkpoint): the ledger reads no clock — the fake clock never moves", () => {
  const ports = testPorts();
  const paths = ledgerPaths("/run/spend.json");
  const before = ports.clock.nowMs();
  let ledger = emptyLedger("run-1");
  for (let i = 0; i < 200; i += 1) {
    ledger = recordUsage(ports.fileWriter, paths, ledger, base({ usageId: `u${i}` })).ledger;
  }
  assert.equal(ports.clock.nowMs(), before, "no clock reading moved");
  assert.equal(ports.clock.sleeps.length, 0);
  assert.equal(ledger.generation, 200);
  assert.equal(hardTokens(ledger), 120 * 200);
});
