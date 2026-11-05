/**
 * T008 — the unit tests of the rebuild of an unreadable ledger and of the
 * UNKNOWN state (F127-FR-032), on the fake file writer of T003.
 *
 * The one thing F127-FR-032 forbids is a silent zero. Every test here is a way
 * of trying to get one, and failing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  anyHardCeilingOfSpendIsSet,
  ceilingsReadAsReached,
  LEDGER_UNREADABLE_ALERT,
  ledgerUnreadableAlert,
  rebuildLedger,
  replayUsage,
  usageEventsAfter,
  UNKNOWN_BLOCKED_REASON,
  UNKNOWN_NOTE,
  type LedgerEvent,
} from "../src/budget/rebuild.ts";
import {
  applyUsageRecord,
  emptyLedger,
  hardTokens,
  ledgerPaths,
  realCostUsd,
  serializeLedger,
  writeLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { SOFT_DIMENSION, type Ceiling } from "../src/budget/ceilings.ts";
import { testPorts } from "./support/index.ts";

const paths = ledgerPaths("/run/spend.json");

const use = (usageId: string, over: Partial<UsageRecord> = {}): UsageRecord => ({
  usageId,
  role: "proposer",
  billingMode: "api",
  inputTokens: 10,
  outputTokens: 0,
  costUsd: 1,
  ...over,
});

const usageEvent = (usageId: string, generation?: number): LedgerEvent => ({
  type: "usage",
  generation,
  usage: use(usageId),
});

test("T008: a ledger that reads is simply read", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, use("a")).ledger;
  writeLedger(ports.fileWriter, paths, ledger);

  const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1" });
  assert.equal(result.state, "read");
  assert.equal(result.source, "ledger");
  assert.equal(result.alert, null);
  assert.equal(result.hardCeilingsReadAsReached, false);
  assert.equal(hardTokens(result.ledger), 10);
});

test("T008: an unreadable ledger is rebuilt from the previous generation", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, use("a")).ledger;
  ledger = writeLedger(ports.fileWriter, paths, ledger); // generation 1
  ledger = applyUsageRecord(ledger, use("b")).ledger;
  writeLedger(ports.fileWriter, paths, ledger); // generation 2; previous := 1
  ports.fileWriter.makeUnreadable(paths.ledger);

  const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1" });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.source, "previous-generation");
  assert.equal(hardTokens(result.ledger), 10, "the previous generation's figures");
  assert.equal(result.hardCeilingsReadAsReached, false);
  assert.ok(result.reasons.some((reason) => reason.includes("did not read")));
});

test("T008: the events that FOLLOW the previous generation are replayed onto it", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, use("a")).ledger;
  ledger = writeLedger(ports.fileWriter, paths, ledger); // generation 1
  writeLedger(ports.fileWriter, paths, ledger); // previous := generation 1
  ports.fileWriter.makeUnreadable(paths.ledger);

  const events: LedgerEvent[] = [
    usageEvent("a", 1), // already in the previous generation: not replayed
    usageEvent("b", 2),
    usageEvent("c", 3),
    { type: "run.paused", generation: 3 }, // not a usage record
  ];
  const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1", events });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.replayed, 2, "only the two that follow generation 1");
  assert.equal(hardTokens(result.ledger), 30, "10 from the generation plus 10 + 10 replayed");
});

test("T008: a replayed record the generation already holds is a no-op (deduplication)", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, use("a")).ledger;
  ledger = writeLedger(ports.fileWriter, paths, ledger);
  writeLedger(ports.fileWriter, paths, ledger);
  ports.fileWriter.makeUnreadable(paths.ledger);
  // The event carries no generation, so it is replayed to be safe.
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths,
    runId: "run-1",
    events: [usageEvent("a")],
  });
  assert.equal(result.replayed, 0, "deduplication by usageId made it a no-op");
  assert.equal(hardTokens(result.ledger), 10, "spend did not double");
});

test("T008: with no previous generation, the event stream alone rebuilds the ledger", () => {
  const ports = testPorts();
  ports.fileWriter.seed(paths.ledger, "{ not a ledger");
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths,
    runId: "run-1",
    events: [usageEvent("a"), usageEvent("b")],
  });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.source, "events");
  assert.equal(result.replayed, 2);
  assert.equal(hardTokens(result.ledger), 20);
  assert.equal(realCostUsd(result.ledger), 2);
  assert.equal(result.hardCeilingsReadAsReached, false);
});

test("T008 (the unknown state): with a hard ceiling set, every hard ceiling reads as reached", () => {
  const ports = testPorts();
  const ceilings: readonly Ceiling[] = [
    { scope: "run", dimension: "costUsd", limit: 10 },
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1000 },
    { scope: "run", dimension: "wallClock", limit: 60 },
  ];
  const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1", ceilings });
  assert.equal(result.state, "unknown");
  assert.equal(result.source, "zero");
  assert.equal(result.hardCeilingsReadAsReached, true, "F127-FR-032");
  assert.equal(result.blockedReason, UNKNOWN_BLOCKED_REASON);
  assert.equal(result.blockedReason, "budget-cap");
  assert.equal(result.note, UNKNOWN_NOTE);
  assert.equal(result.note, "ledger-unreadable");
  assert.equal(result.goesOnPartial, false, "the run does not go on");
  assert.equal(result.alert?.kind, LEDGER_UNREADABLE_ALERT);
  assert.equal(result.alert?.level, "loud", "§Q.4: loud where any hard ceiling is set");

  // Only the hard ceilings of spend read as reached; the soft one and the wall
  // clock do not.
  const reached = ceilingsReadAsReached(result, ceilings);
  assert.deepEqual(
    reached.map((ceiling) => ceiling.dimension),
    ["costUsd"],
  );
});

test("T008 (the unknown state): with no hard ceiling set, the run goes on, marked partial", () => {
  const ports = testPorts();
  const ceilings: readonly Ceiling[] = [
    { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1000 },
    { scope: "run", dimension: "wallClock", limit: 60 },
    { scope: "run", dimension: "tokens", limit: 0 }, // off, so not set
  ];
  const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1", ceilings });
  assert.equal(result.state, "unknown");
  assert.equal(result.hardCeilingsReadAsReached, false);
  assert.equal(result.blockedReason, null);
  assert.equal(result.goesOnPartial, true, "F127-FR-032");
  assert.equal(result.ledger.partial, true, "and the ledger says so");
  assert.equal(result.alert?.level, "warn", "§Q.4: warn where no hard ceiling is set");
  assert.deepEqual(ceilingsReadAsReached(result, ceilings), []);
});

test("T008: which ceilings count as a hard ceiling of spend being set", () => {
  assert.equal(anyHardCeilingOfSpendIsSet([]), false);
  assert.equal(anyHardCeilingOfSpendIsSet(undefined), false);
  for (const dimension of ["tokens", "costUsd", "phaseAttempts", "calls"] as const) {
    assert.equal(
      anyHardCeilingOfSpendIsSet([{ scope: "run", dimension, limit: 1 }]),
      true,
      dimension,
    );
    assert.equal(
      anyHardCeilingOfSpendIsSet([{ scope: "run", dimension, limit: 0 }]),
      false,
      `${dimension} of 0 is off`,
    );
  }
  assert.equal(
    anyHardCeilingOfSpendIsSet([{ scope: "run", dimension: "wallClock", limit: 60 }]),
    false,
    "the wall clock is a ceiling of time, not a cap of spend (CQ-192)",
  );
  assert.equal(
    anyHardCeilingOfSpendIsSet([
      { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1 },
    ]),
    false,
    "a soft budget is not a hard ceiling",
  );
});

test("T008: an unreadable ledger is NEVER read as zero when a source exists", () => {
  const ports = testPorts();
  let ledger = emptyLedger("run-1");
  for (const id of ["a", "b", "c"]) ledger = applyUsageRecord(ledger, use(id)).ledger;
  ledger = writeLedger(ports.fileWriter, paths, ledger);
  writeLedger(ports.fileWriter, paths, ledger);
  // Every way of breaking the ledger file.
  for (const breakIt of [
    () => ports.fileWriter.makeUnreadable(paths.ledger),
    () => ports.fileWriter.seed(paths.ledger, "{ torn"),
    () => ports.fileWriter.seed(paths.ledger, "[]"),
    () => ports.fileWriter.seed(paths.ledger, '{"schema":"other/1"}'),
  ]) {
    breakIt();
    const result = rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1" });
    assert.equal(result.state, "rebuilt");
    assert.equal(hardTokens(result.ledger), 30, "spend is not lower than before");
    ports.fileWriter.makeReadable(paths.ledger);
  }
});

test("T008: the alert of §Q.4 carries a deduplication key and one line of why", () => {
  const loud = ledgerUnreadableAlert(true);
  assert.equal(loud.kind, "ledger-unreadable");
  assert.equal(loud.level, "loud");
  assert.match(loud.message, /every hard ceiling of spend is read as reached/);
  assert.match(loud.message, /F127-FR-032/);
  const warn = ledgerUnreadableAlert(false);
  assert.equal(warn.level, "warn");
  assert.match(warn.message, /marked partial/);
  assert.equal(loud.dedupeKey, warn.dedupeKey, "the key of §Q.4 is kind, role, threshold");
});

test("T008: `usageEventsAfter` keeps only usage records, and only the later ones", () => {
  const events: LedgerEvent[] = [
    usageEvent("a", 1),
    usageEvent("b", 2),
    { type: "alert", generation: 2 },
    usageEvent("c"), // no generation: kept, to be safe
  ];
  assert.deepEqual(
    usageEventsAfter(events, 1).map((event) => event.usage?.usageId),
    ["b", "c"],
  );
  assert.deepEqual(
    usageEventsAfter(events, null).map((event) => event.usage?.usageId),
    ["a", "b", "c"],
  );
});

test("T008: `replayUsage` leaves the ledger handed in untouched", () => {
  const before = emptyLedger("run-1");
  const snapshot = serializeLedger(before);
  const after = replayUsage(before, [usageEvent("a")]);
  assert.equal(serializeLedger(before), snapshot);
  assert.equal(hardTokens(after.ledger), 10);
  assert.equal(after.replayed, 1);
});

test("T008 (checkpoint): the rebuild reads no clock — the fake clock never moves", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1", events: [usageEvent("a")] });
  rebuildLedger({ writer: ports.fileWriter, paths, runId: "run-1" });
  assert.equal(ports.clock.nowMs(), before);
  assert.equal(ports.clock.sleeps.length, 0);
});
