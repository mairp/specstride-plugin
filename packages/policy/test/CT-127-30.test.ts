/**
 * CT-127-30 (T065) — the characterization test of AN UNREADABLE LEDGER: the
 * PREVIOUS GENERATION, the REPLAY, the UNKNOWN state, and NO HARD CEILING SET
 * (F127-FR-032, DV-063, CQ-135).
 *
 * "An unreadable ledger MUST never reset spend." The four steps, in order:
 *
 *  1. the engine first reads the PREVIOUS GENERATION of the ledger, which it
 *     keeps;
 *  2. it REPLAYS the usage records of the event stream that follow it;
 *  3. where neither gives a value the ledger is UNKNOWN: every hard ceiling of
 *     spend reads as REACHED, the run stops at the next safe boundary with the
 *     reason `budget-cap` and the note `ledger-unreadable`, and an alert of
 *     kind `ledger-unreadable` is written;
 *  4. where NO HARD CEILING of spend is set, the alert is still written and
 *     the run GOES ON with the ledger rebuilt from zero and marked PARTIAL.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LEDGER_UNREADABLE_ALERT,
  REBUILD_SOURCES,
  REBUILD_STATES,
  UNKNOWN_BLOCKED_REASON,
  UNKNOWN_NOTE,
  anyHardCeilingOfSpendIsSet,
  ceilingsReadAsReached,
  ledgerUnreadableAlert,
  rebuildLedger,
  replayUsage,
  usageEventsAfter,
  type LedgerEvent,
} from "../src/budget/rebuild.ts";
import {
  applyUsageRecord,
  callCount,
  emptyLedger,
  hardTokens,
  ledgerPaths,
  realCostUsd,
  recordUsage,
  writeLedger,
  type UsageRecord,
} from "../src/budget/ledger.ts";
import { SOFT_DIMENSION, readCeiling, type Ceiling } from "../src/budget/ceilings.ts";
import { capStop } from "../src/budget/cap-stop.ts";
import { testPorts } from "./support/index.ts";

/** The one redactor of the product, as a test stands in for it (F127-FR-040). */
const fakeRedact = (text: string, cap: number) => ({
  text: text.slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

const PATHS = ledgerPaths("/run/control/spend.json");
const RUN = "run-ct-127-30";

const HARD: readonly Ceiling[] = Object.freeze([
  { scope: "run", dimension: "costUsd", limit: 10 },
  { scope: "role", role: "proposer", dimension: "tokens", limit: 5_000 },
]);

/** No hard ceiling of spend: a soft budget and a wall clock only. */
const NO_HARD: readonly Ceiling[] = Object.freeze([
  { scope: "role", role: "proposer", dimension: SOFT_DIMENSION, limit: 1_000 },
  { scope: "run", dimension: "wallClock", limit: 60 },
]);

function usage(index: number, costUsd = 3): UsageRecord {
  return {
    usageId: `u-${index}`,
    role: "proposer",
    billingMode: "api",
    inputTokens: 100,
    costUsd,
    isCall: true,
    closesAPass: true,
  };
}

function event(index: number, generation?: number): LedgerEvent {
  return {
    type: "usage",
    usage: usage(index),
    ...(generation === undefined ? {} : { generation }),
  };
}

/* ------------------------------------------------------------------ *
 * The three states and the four sources.
 * ------------------------------------------------------------------ */

test("CT-127-30: the states are read, rebuilt and unknown; the sources are four", () => {
  assert.deepEqual([...REBUILD_STATES], ["read", "rebuilt", "unknown"]);
  assert.deepEqual([...REBUILD_SOURCES], ["ledger", "previous-generation", "events", "zero"]);
});

test("CT-127-30: a readable ledger is simply read, with no alert and no rebuild", () => {
  const ports = testPorts();
  const ledger = emptyLedger(RUN);
  recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {});
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.state, "read");
  assert.equal(result.source, "ledger");
  assert.equal(result.alert, null);
  assert.equal(result.replayed, 0);
  assert.equal(realCostUsd(result.ledger), 3);
});

/* ------------------------------------------------------------------ *
 * 1. The previous generation.
 * ------------------------------------------------------------------ */

test("CT-127-30: step 1 — the previous generation is read before anything else", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.source, "previous-generation");
  assert.equal(realCostUsd(result.ledger), 3);
  assert.equal(result.hardCeilingsReadAsReached, false);
  assert.equal(result.blockedReason, null);
  assert.match(result.reasons[0] ?? "", /did not read/);
});

test("CT-127-30: a ledger that is garbage, not unreadable, is also rebuilt", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {});
  ports.fileWriter.seed(PATHS.ledger, "{ this is not a ledger");
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.source, "previous-generation");
  assert.equal(realCostUsd(result.ledger), 3);
});

test("CT-127-30: a ledger of the wrong schema id is refused and rebuilt", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {});
  ports.fileWriter.seed(PATHS.ledger, JSON.stringify({ schema: "something.else/9", runId: RUN }));
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.source, "previous-generation");
});

/* ------------------------------------------------------------------ *
 * 2. The replay of the events that follow it.
 * ------------------------------------------------------------------ */

test("CT-127-30: step 2 — the events AFTER the generation are replayed", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(3), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
    events: [event(1, 1), event(2, 2), event(3, 3)],
  });
  // The previous generation is generation 2 and holds u-1 and u-2; u-3 is replayed.
  assert.equal(result.source, "previous-generation");
  assert.equal(result.replayed, 1);
  assert.equal(realCostUsd(result.ledger), 9);
  assert.equal(callCount(result.ledger), 3);
});

test("CT-127-30: the selection of events by generation keeps an unstamped event", () => {
  const events = [
    event(1, 1),
    event(2, 5),
    { type: "usage" as const, usage: usage(3) },
    { type: "alert" as const },
  ];
  assert.equal(usageEventsAfter(events, 2).length, 2);
  assert.equal(usageEventsAfter(events, null).length, 3);
  // A non-usage event is never replayed.
  assert.equal(
    usageEventsAfter(events, null).every((e) => e.type === "usage"),
    true,
  );
});

test("CT-127-30: replaying too much is safe: deduplication makes it a no-op", () => {
  const base = applyUsageRecord(emptyLedger(RUN), usage(1)).ledger;
  const replayed = replayUsage(base, [event(1), event(1), event(2)]);
  assert.equal(replayed.replayed, 1);
  assert.equal(realCostUsd(replayed.ledger), 6);
});

test("CT-127-30: step 2 falls through to the event stream alone where no file survives", () => {
  const ports = testPorts();
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
    events: [event(1), event(2)],
  });
  assert.equal(result.state, "rebuilt");
  assert.equal(result.source, "events");
  assert.equal(result.replayed, 2);
  assert.equal(realCostUsd(result.ledger), 6);
  assert.equal(hardTokens(result.ledger), 200);
  assert.equal(result.hardCeilingsReadAsReached, false);
});

/* ------------------------------------------------------------------ *
 * 3. The unknown state, with a hard ceiling set.
 * ------------------------------------------------------------------ */

test("CT-127-30: step 3 — with a hard ceiling set the ledger is UNKNOWN and caps read reached", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {});
  ports.fileWriter.makeUnreadable(PATHS.ledger);
  ports.fileWriter.makeUnreadable(PATHS.previous);

  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.state, "unknown");
  assert.equal(result.source, "zero");
  assert.equal(result.hardCeilingsReadAsReached, true);
  assert.equal(result.blockedReason, UNKNOWN_BLOCKED_REASON);
  assert.equal(result.blockedReason, "budget-cap");
  assert.equal(result.note, UNKNOWN_NOTE);
  assert.equal(result.note, "ledger-unreadable");
  assert.equal(result.goesOnPartial, false);
  assert.equal(result.alert?.kind, LEDGER_UNREADABLE_ALERT);
  assert.equal(result.alert?.level, "loud");
  assert.equal(result.reasons.length >= 2, true);
});

test("CT-127-30: EVERY hard ceiling of spend reads as reached, the soft ones do not", () => {
  const ports = testPorts();
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: [...HARD, ...NO_HARD],
  });
  assert.equal(result.state, "unknown");
  assert.deepEqual(
    ceilingsReadAsReached(result, [...HARD, ...NO_HARD]).map((ceiling) => ceiling.dimension),
    ["costUsd", "tokens"],
  );
});

test("CT-127-30: the stop of the unknown state is a `budget-cap` stop with the note", () => {
  const ports = testPorts();
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  const reached = ceilingsReadAsReached(result, HARD);
  assert.ok(reached.length > 0);
  // The ceiling reads as reached whatever the figures say, so the stop names
  // the note `ledger-unreadable` rather than a `used` figure.
  const reading = readCeiling(reached[0], { ledger: result.ledger });
  const asReached = Object.freeze({ ...reading, exhausted: true, used: reading.limit });
  const stop = capStop(
    ports.eventWriter,
    { reading: asReached, note: result.note },
    { redact: fakeRedact },
  );
  assert.deepEqual(ports.eventWriter.types(), ["budget.exceeded", "blocked"]);
  assert.equal(stop.blockedOutcome.reason, "budget-cap");
  assert.equal(ports.eventWriter.of("budget.exceeded")[0].payload.note, "ledger-unreadable");
});

test("CT-127-30: `anyHardCeilingOfSpendIsSet` is what decides the branch", () => {
  assert.equal(anyHardCeilingOfSpendIsSet(HARD), true);
  assert.equal(anyHardCeilingOfSpendIsSet(NO_HARD), false);
  assert.equal(anyHardCeilingOfSpendIsSet([]), false);
  // A hard ceiling of 0 is off, so it does not set the branch either.
  assert.equal(
    anyHardCeilingOfSpendIsSet([{ scope: "run", dimension: "costUsd", limit: 0 }]),
    false,
  );
  assert.equal(
    anyHardCeilingOfSpendIsSet([{ scope: "run", dimension: "costUsd", limit: Number.NaN }]),
    false,
  );
});

/* ------------------------------------------------------------------ *
 * 4. No hard ceiling set: the alert, and the run goes on, marked partial.
 * ------------------------------------------------------------------ */

test("CT-127-30: step 4 — with no hard ceiling set the run GOES ON, marked partial", () => {
  const ports = testPorts();
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: NO_HARD,
  });
  assert.equal(result.state, "unknown");
  assert.equal(result.hardCeilingsReadAsReached, false);
  assert.equal(result.blockedReason, null);
  assert.equal(result.note, null);
  assert.equal(result.goesOnPartial, true);
  assert.equal(result.ledger.partial, true);
  assert.equal(realCostUsd(result.ledger), null);
  assert.deepEqual(ceilingsReadAsReached(result, NO_HARD), []);
});

test("CT-127-30: the alert is written in BOTH branches, at different levels", () => {
  const ports = testPorts();
  const withHard = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  const without = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: NO_HARD,
  });
  assert.equal(withHard.alert?.kind, "ledger-unreadable");
  assert.equal(without.alert?.kind, "ledger-unreadable");
  assert.equal(withHard.alert?.level, "loud");
  assert.equal(without.alert?.level, "warn");
  // Both carry the same deduplication key: the alert fires once.
  assert.equal(withHard.alert?.dedupeKey, without.alert?.dedupeKey);
  assert.match(withHard.alert?.message ?? "", /every hard ceiling of spend is read as reached/);
  assert.match(without.alert?.message ?? "", /rebuilt from zero and marked partial/);
});

test("CT-127-30: the alert of the two branches is the one `ledgerUnreadableAlert` builds", () => {
  assert.equal(ledgerUnreadableAlert(true).level, "loud");
  assert.equal(ledgerUnreadableAlert(false).level, "warn");
  assert.equal(ledgerUnreadableAlert(true).role, null);
  assert.equal(ledgerUnreadableAlert(true).threshold, null);
});

test("CT-127-30: a failed copy of the previous generation never destroys a good one", () => {
  const ports = testPorts();
  let ledger = emptyLedger(RUN);
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(1), {}).ledger;
  ledger = recordUsage(ports.fileWriter, PATHS, ledger, usage(2), {}).ledger;
  const goodPrevious = realCostUsd(
    rebuildLedger({ writer: ports.fileWriter, paths: PATHS, runId: RUN }).ledger,
  );
  assert.equal(goodPrevious, 6);

  // The copy to the previous generation fails. `writeLedger` swallows it —
  // overwriting a good previous generation with nothing is the one thing
  // F127-FR-032 cannot afford — and still writes the ledger.
  const third = applyUsageRecord(ledger, usage(3)).ledger;
  ports.fileWriter.failNextWrite("the disk is full");
  const written = writeLedger(ports.fileWriter, PATHS, third);
  assert.equal(realCostUsd(written), 9);

  // The ledger reads, so nothing was lost; the previous generation still
  // holds the copy from before the failed write.
  const result = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(result.state, "read");
  assert.equal(realCostUsd(result.ledger), 9);
  // And with the ledger unreadable, the previous generation is still good.
  ports.fileWriter.makeUnreadable(PATHS.ledger);
  const fallback = rebuildLedger({
    writer: ports.fileWriter,
    paths: PATHS,
    runId: RUN,
    ceilings: HARD,
  });
  assert.equal(fallback.source, "previous-generation");
  assert.ok((realCostUsd(fallback.ledger) ?? 0) > 0);
});
