/**
 * CT-127-18 (T035) — the characterization test of a STOP REQUEST READ DURING A
 * PAUSE (F127-FR-016).
 *
 * "A stop request MUST be honoured during a pause at least once a minute, and
 * the state MUST pass to `stopping` and then `stopped` as the run-state
 * machine says. A pause MUST never delay a stop."
 *
 * The whole test runs on the fake clock, so a five-hour pause with three
 * hundred ticks of the stop poll takes microseconds and the number of ticks is
 * an assertion and not a guess.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  STOP_EXIT_CODE,
  STOP_POLL_MS,
  STOP_REASON,
  STOP_STATES,
  STOP_TRANSITIONS,
  ticksFor,
  waitThroughThePause,
  type StopInbox,
} from "../src/quota/recover.ts";
import { enterPause, type EnterPauseInput } from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { classify } from "../src/quota/classify.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const RECORD_PATH = ".specstride/runs/run-1/pause.record";
const DAY = 24 * 60 * 60 * 1000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;

function input(overrides: Partial<EnterPauseInput> = {}): EnterPauseInput {
  return {
    runId: "run-1",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification: classify({
      structuredClass: "quota_window",
      resetsAt: { structured: new Date(DEFAULT_START_MS + FIVE_HOURS).toISOString() },
    }),
    since: new Date(DEFAULT_START_MS).toISOString(),
    resumeAt: new Date(DEFAULT_START_MS + FIVE_HOURS).toISOString(),
    ceilingAt: new Date(DEFAULT_START_MS + DAY).toISOString(),
    recordPath: RECORD_PATH,
    ...overrides,
  };
}

/** An inbox whose stop request arrives after a given number of reads. */
function inboxAfter(reads: number): StopInbox & { reads: number } {
  const inbox = {
    reads: 0,
    stopRequested(): boolean {
      const requested = inbox.reads >= reads;
      inbox.reads += 1;
      return requested;
    },
  };
  return inbox;
}

test("CT-127-18: the stop poll is at least once a minute", () => {
  assert.equal(STOP_POLL_MS, 60_000, "at least once a minute (F127-FR-016)");
  assert.deepEqual([...STOP_STATES], ["stopping", "stopped"]);
  assert.deepEqual([...STOP_TRANSITIONS], ["T13", "T14"]);
  assert.equal(STOP_EXIT_CODE, 6, "the engine exits 6 (transition T14)");
  assert.equal(STOP_REASON, "stop_flag");
});

test("CT-127-18: a pause of five hours reads the inbox once a minute, three hundred times", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  const inbox = inboxAfter(Number.POSITIVE_INFINITY); // no stop is ever requested
  const result = await waitThroughThePause(ports, entry.record, inbox);
  assert.equal(result.outcome, "resume", "the wait ended at the resume time");
  assert.equal(result.ticks, 300, "five hours is three hundred ticks of a minute");
  assert.equal(inbox.reads, 301, "the inbox was read before every tick, and once at the end");
  assert.equal(result.waitedMs, FIVE_HOURS);
  assert.equal(ticksFor(FIVE_HOURS), 300);
});

test("CT-127-18: a stop request read during the pause takes the run to `stopping` and `stopped`", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  // The consumer asks for a stop after an hour of the pause.
  const inbox = inboxAfter(60);
  const result = await waitThroughThePause(ports, entry.record, inbox);

  assert.equal(result.outcome, "stopped");
  assert.deepEqual([...result.states], ["stopping", "stopped"], "the states of the machine");
  assert.equal(result.exitCode, 6);
  assert.equal(result.stopReason, "stop_flag");
  assert.equal(result.stopReadAtTick, 60, "read at the tick after it arrived");
  assert.equal(result.waitedMs, 60 * 60_000, "and the pause ended an hour in, not five hours in");
  assert.ok(result.note.includes("never delays a stop"));
});

test("CT-127-18: a pause never delays a stop by more than one tick", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  for (const arrivesAfter of [0, 1, 7, 42, 299]) {
    const fresh = testPorts();
    const inbox = inboxAfter(arrivesAfter);
    const result = await waitThroughThePause(fresh, entry.record, inbox);
    assert.equal(result.outcome, "stopped");
    assert.ok(
      (result.stopDelayedByMs as number) <= STOP_POLL_MS,
      `a stop that arrived at tick ${arrivesAfter} waited at most one tick`,
    );
  }
});

test("CT-127-18: a stop request that is already in the inbox is honoured before any tick", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  const result = await waitThroughThePause(ports, entry.record, inboxAfter(0));
  assert.equal(result.outcome, "stopped");
  assert.equal(result.ticks, 0, "not one tick was spent");
  assert.equal(result.waitedMs, 0);
  assert.equal(ports.clock.sleeps.length, 0, "the pause did not sleep at all");
});

test("CT-127-18: the stop poll can be set shorter, and the ticks follow", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  const result = await waitThroughThePause(
    ports,
    entry.record,
    inboxAfter(Number.POSITIVE_INFINITY),
    {
      stopPollMs: 10 * 60_000,
    },
  );
  assert.equal(result.ticks, 30, "five hours in ten-minute ticks");
  assert.equal(result.waitedMs, FIVE_HOURS);
});

test("CT-127-18: the ceiling also ends the wait, and is not a stop", async () => {
  const ports = testPorts();
  const entry = enterPause(
    ports,
    input({
      resumeAt: new Date(DEFAULT_START_MS + 48 * 60 * 60 * 1000).toISOString(),
      ceilingAt: new Date(DEFAULT_START_MS + DAY).toISOString(),
    }),
    PAIR_CLOSED,
  );
  const result = await waitThroughThePause(
    ports,
    entry.record,
    inboxAfter(Number.POSITIVE_INFINITY),
  );
  assert.equal(result.outcome, "ceiling", "the ceiling came first");
  assert.equal(result.ticks, 24 * 60, "a day of ticks of a minute");
  assert.deepEqual([...result.states], [], "and no stop happened");
  assert.equal(result.exitCode, null);
});

test("CT-127-18: the last tick is cut to the remaining wait and never overshoots", async () => {
  const ports = testPorts();
  const entry = enterPause(
    ports,
    input({ resumeAt: new Date(DEFAULT_START_MS + 90_000).toISOString() }),
    PAIR_CLOSED,
  );
  const result = await waitThroughThePause(
    ports,
    entry.record,
    inboxAfter(Number.POSITIVE_INFINITY),
  );
  assert.equal(result.ticks, 2);
  assert.equal(result.waitedMs, 90_000, "a minute and then the remaining thirty seconds");
  assert.deepEqual(
    ports.clock.sleeps.map((call) => call.sleptMs),
    [60_000, 30_000],
  );
});

test("CT-127-18 (checkpoint): a day of ticks is a test of microseconds", async () => {
  const ports = testPorts();
  const entry = enterPause(
    ports,
    input({ resumeAt: new Date(DEFAULT_START_MS + DAY).toISOString() }),
    PAIR_CLOSED,
  );
  const realStart = process.hrtime.bigint();
  const result = await waitThroughThePause(
    ports,
    entry.record,
    inboxAfter(Number.POSITIVE_INFINITY),
  );
  const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;
  assert.equal(result.ticks, 1440);
  assert.ok(realMs < 2000, `1440 ticks in ${realMs.toFixed(1)} ms of real time`);
});
