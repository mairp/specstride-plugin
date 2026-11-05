/**
 * CT-127-15 (T030) — the characterization test of the RESUME TIME on a fake
 * clock, for a KNOWN and an UNKNOWN reset time (F127-FR-013).
 *
 * Acceptance scenario 3 of user story 1: given the reset time has passed plus
 * the margin and jitter, when the engine wakes, then it emits `run.resumed`,
 * removes the pause record and gives the pass back, and the next pass runs in
 * the same phase attempt.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAUSE_TIMING,
  RESUME_TRANSITION,
  STATE_AFTER_A_RESUME,
  isResumeDue,
  probeAtMs,
  probeDelayMs,
  probeSchedule,
  resume,
  resumeTimeFor,
} from "../src/quota/resume.ts";
import { enterPause, type EnterPauseInput } from "../src/quota/pause.ts";
import { closePause, noPausedTime, openPause } from "../src/quota/clocks.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { classify } from "../src/quota/classify.ts";
import { DEFAULT_START_MS, fixedRandom, testPorts } from "./support/index.ts";

const RECORD_PATH = ".specstride/runs/run-1/pause.record";
const FIVE_HOURS = 5 * 60 * 60 * 1000;
const RESETS_AT_MS = DEFAULT_START_MS + FIVE_HOURS;
const RESETS_AT = new Date(RESETS_AT_MS).toISOString();

test("CT-127-15: the defaults of the timing are the ones of F127-FR-013 and row 111", () => {
  assert.equal(DEFAULT_PAUSE_TIMING.marginMs, 60_000, "`pause.marginMs`, 60 seconds");
  assert.equal(DEFAULT_PAUSE_TIMING.jitterMs, 30_000, "`pause.jitterMs`, 30 seconds");
  assert.deepEqual(
    [...DEFAULT_PAUSE_TIMING.probeScheduleMs],
    [300_000, 900_000, 1_800_000, 3_600_000],
    "`pause.probeScheduleMs`: 5, 15, 30 and 60 minutes",
  );
});

/* ---------------------------------------------------------------- *
 * A KNOWN reset time.
 * ---------------------------------------------------------------- */

test("CT-127-15: with a known reset time, `resumeAt` is the reset plus the margin plus the jitter", () => {
  // The jitter is fixed at 0: `resumeAt` is the reset plus the margin exactly.
  const noJitter = resumeTimeFor(
    { resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS },
    fixedRandom(0),
  );
  assert.equal(noJitter.source, "reset-plus-margin");
  assert.equal(noJitter.marginMs, 60_000);
  assert.equal(noJitter.jitterMs, 0);
  assert.equal(noJitter.resumeAtMs, RESETS_AT_MS + 60_000);
  assert.equal(noJitter.resumeAt, new Date(RESETS_AT_MS + 60_000).toISOString());

  // The jitter at half of the range: 15 seconds.
  const half = resumeTimeFor({ resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS }, fixedRandom(0.5));
  assert.equal(half.jitterMs, 15_000);
  assert.equal(half.resumeAtMs, RESETS_AT_MS + 60_000 + 15_000);

  // And the jitter is bounded by `pause.jitterMs`.
  const nearlyOne = resumeTimeFor(
    { resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS },
    fixedRandom(0.999),
  );
  assert.ok(nearlyOne.jitterMs < DEFAULT_PAUSE_TIMING.jitterMs, "0 to `pause.jitterMs`");
  assert.ok(nearlyOne.jitterMs >= 0);
});

test("CT-127-15: the margin and the jitter can be set by the consumer", () => {
  const timing = { marginMs: 5_000, jitterMs: 1_000 };
  const built = resumeTimeFor(
    { resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS },
    fixedRandom(0.5),
    timing,
  );
  assert.equal(built.marginMs, 5_000);
  assert.equal(built.jitterMs, 500);
  assert.equal(built.resumeAtMs, RESETS_AT_MS + 5_500);
});

test("CT-127-15: the fixed random source makes `resumeAt` exact to the millisecond", () => {
  const first = resumeTimeFor(
    { resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS },
    fixedRandom(0.25),
  );
  const again = resumeTimeFor(
    { resetsAt: RESETS_AT, sinceMs: DEFAULT_START_MS },
    fixedRandom(0.25),
  );
  assert.equal(first.resumeAtMs, again.resumeAtMs, "the same draw gives the same instant");
  assert.equal(first.jitterFraction, 0.25, "and the draw is reported");
});

/* ---------------------------------------------------------------- *
 * An UNKNOWN reset time: the probe schedule of §Q.2.
 * ---------------------------------------------------------------- */

test("CT-127-15: with an unknown reset time, the pause probes after 5, 15, 30 and 60 minutes", () => {
  assert.equal(probeDelayMs(0), 5 * 60 * 1000);
  assert.equal(probeDelayMs(1), 15 * 60 * 1000);
  assert.equal(probeDelayMs(2), 30 * 60 * 1000);
  assert.equal(probeDelayMs(3), 60 * 60 * 1000);
});

test("CT-127-15: and then every 60 minutes, the last entry of the schedule repeated", () => {
  assert.equal(probeDelayMs(4), 120 * 60 * 1000, "60 minutes after the fourth probe");
  assert.equal(probeDelayMs(5), 180 * 60 * 1000);
  assert.equal(probeDelayMs(6), 240 * 60 * 1000);
  for (let index = 4; index < 12; index += 1) {
    assert.equal(
      probeDelayMs(index + 1) - probeDelayMs(index),
      60 * 60 * 1000,
      `probe ${index + 1} is an hour after probe ${index}`,
    );
  }
});

test("CT-127-15: with `resetsAt` null, `resumeAt` is the time of the next probe", () => {
  const first = resumeTimeFor({ resetsAt: null, sinceMs: DEFAULT_START_MS }, fixedRandom(0.5));
  assert.equal(first.source, "next-probe");
  assert.equal(first.marginMs, 0, "there is nothing to add a margin to");
  assert.equal(first.jitterMs, 0);
  assert.equal(first.resumeAtMs, DEFAULT_START_MS + 5 * 60 * 1000);
  assert.equal(first.probeIndex, 0);

  const third = resumeTimeFor(
    { resetsAt: null, sinceMs: DEFAULT_START_MS, probeIndex: 2 },
    fixedRandom(0.5),
  );
  assert.equal(third.resumeAtMs, DEFAULT_START_MS + 30 * 60 * 1000);
  assert.equal(third.probeIndex, 2);
});

test("CT-127-15: a reset time that cannot be read is treated as unknown", () => {
  const built = resumeTimeFor(
    { resetsAt: "not a timestamp", sinceMs: DEFAULT_START_MS },
    fixedRandom(0),
  );
  assert.equal(built.source, "next-probe");
  assert.equal(built.resumeAtMs, DEFAULT_START_MS + 5 * 60 * 1000);
});

test("CT-127-15: the probe schedule is reported as instants", () => {
  const schedule = probeSchedule(DEFAULT_START_MS, 6);
  assert.deepEqual(
    schedule.map((at) => (at - DEFAULT_START_MS) / 60_000),
    [5, 15, 30, 60, 120, 180],
  );
  assert.equal(probeAtMs(DEFAULT_START_MS, 0), DEFAULT_START_MS + 5 * 60 * 1000);
});

/* ---------------------------------------------------------------- *
 * The resume itself, on the fake clock.
 * ---------------------------------------------------------------- */

function pauseInput(resetsAt: string | null, resumeAt: string | null): EnterPauseInput {
  return {
    runId: "run-1",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification: classify({
      structuredClass: "quota_window",
      ...(resetsAt === null ? {} : { resetsAt: { structured: resetsAt } }),
    }),
    since: new Date(DEFAULT_START_MS).toISOString(),
    resumeAt,
    ceilingAt: new Date(DEFAULT_START_MS + 24 * 60 * 60 * 1000).toISOString(),
    recordPath: RECORD_PATH,
  };
}

test("CT-127-15: at the resume time the run resumes, the record is removed, the pass comes back", async () => {
  const ports = testPorts();
  const built = resumeTimeFor({ resetsAt: RESETS_AT, sinceMs: ports.clock.nowMs() }, ports.random);
  const entry = enterPause(ports, pauseInput(RESETS_AT, built.resumeAt), PAIR_CLOSED);
  assert.equal(ports.fileWriter.exists(RECORD_PATH), true, "the record is in place");

  // The fake clock moves to the reset plus the margin and the jitter.
  const open = openPause(ports.clock);
  assert.equal(isResumeDue(entry.record, ports.clock.nowMs()), false, "not yet");
  await ports.sleep.sleep(built.resumeAtMs - ports.clock.nowMs());
  assert.equal(isResumeDue(entry.record, ports.clock.nowMs()), true, "now it is due");
  const closed = closePause(ports.clock, open, noPausedTime());

  const result = resume(
    ports,
    {
      record: entry.record,
      recordPath: RECORD_PATH,
      resumedBy: "resume-time",
      pausedMs: closed.pausedMs,
      pausedTime: closed.after,
    },
    entry.pair,
  );

  assert.equal(result.state, "running");
  assert.equal(result.state, STATE_AFTER_A_RESUME);
  assert.equal(result.transition, "T7");
  assert.equal(result.transition, RESUME_TRANSITION);
  assert.equal(ports.eventWriter.countOf("run.resumed"), 1, "`run.resumed` was emitted");
  assert.deepEqual(ports.eventWriter.types(), ["quota.signal", "run.paused", "run.resumed"]);
  const payload = ports.eventWriter.of("run.resumed")[0].payload;
  assert.equal(payload.pausedMs, closed.pausedMs, "with `pausedMs`");
  assert.equal(payload.resumedBy, "resume-time");
  assert.equal(result.pair.open, false, "the pair of F127-FR-040 is closed");

  // The record is GONE, read through an independent path: the store itself.
  assert.equal(result.recordRemoved, true);
  assert.equal(ports.fileWriter.exists(RECORD_PATH), false, "the pause record was removed");
  assert.deepEqual([...ports.fileWriter.removals], [RECORD_PATH]);

  assert.equal(result.passGivenBack, true, "the pass is given back (F127-FR-013)");
  assert.equal(result.attemptId, "p1-a1", "the next pass runs in the SAME phase attempt");
  assert.equal(result.session, "fresh", "in a fresh session by default");
  assert.equal(result.pausedMs, 5 * 60 * 60 * 1000 + 60_000, "five hours and the margin");
});

test("CT-127-15: a probe that succeeds resumes the run before its resume time", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, pauseInput(null, null), PAIR_CLOSED);
  const open = openPause(ports.clock);
  await ports.sleep.sleep(5 * 60 * 1000); // the first probe of the schedule
  const closed = closePause(ports.clock, open, noPausedTime());
  const result = resume(
    ports,
    {
      record: entry.record,
      recordPath: RECORD_PATH,
      resumedBy: "probe-succeeded",
      pausedMs: closed.pausedMs,
      pausedTime: closed.after,
      session: "continued",
    },
    entry.pair,
  );
  assert.equal(result.resumedBy, "probe-succeeded");
  assert.equal(result.session, "continued", "or a continued one where the harness supports it");
  assert.equal(ports.fileWriter.exists(RECORD_PATH), false);
  assert.equal(result.pausedMs, 5 * 60 * 1000);
});

test("CT-127-15: `isResumeDue` is false for a record with no resume time", () => {
  const ports = testPorts();
  const entry = enterPause(ports, pauseInput(null, null), PAIR_CLOSED);
  assert.equal(isResumeDue(entry.record, ports.clock.nowMs() + 10 * 24 * 60 * 60 * 1000), false);
});

test("CT-127-15 (checkpoint): a five-hour wait to the resume is a test of microseconds", async () => {
  const ports = testPorts();
  const realStart = process.hrtime.bigint();
  await ports.sleep.sleep(FIVE_HOURS + 90_000);
  const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;
  assert.equal(ports.clock.nowMs(), DEFAULT_START_MS + FIVE_HOURS + 90_000);
  assert.ok(realMs < 1000, `the fake sleep never waits (${realMs.toFixed(3)} ms)`);
});
