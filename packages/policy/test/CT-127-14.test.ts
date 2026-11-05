/**
 * CT-127-14 (T028) — the characterization test of the EXCLUDED TIME and of a
 * QUOTA SIGNAL INSIDE A UNIT OF WORK (F127-FR-012).
 *
 * The excluded time is proven on the fake clock of T003: a pause of five hours
 * is slept through the fake sleep, so the test takes microseconds, and the
 * three clocks must read as though those five hours had not happened.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOCKS_THAT_EXCLUDE_A_PAUSE,
  LEDGER_FIELD,
  addPausedMs,
  closePause,
  excludePaused,
  nextAttempt,
  noPausedTime,
  openPause,
  passTimedOut,
  passTimeoutRemainingMs,
  pauseInsideAUnitOfWork,
  pausedMsOf,
  stallWatchdogRemainingMs,
  wallClockElapsedMs,
  wallClockMinutes,
  watchdogFired,
} from "../src/quota/clocks.ts";
import { emptyLedger } from "../src/budget/ledger.ts";
import { readCeiling } from "../src/budget/ceilings.ts";
import { testPorts } from "./support/index.ts";

const FIVE_HOURS = 5 * 60 * 60 * 1000;

test("CT-127-14: the three clocks of F127-FR-012 exclude the time in a pause", () => {
  assert.deepEqual(
    [...CLOCKS_THAT_EXCLUDE_A_PAUSE],
    ["wall-clock-budget", "pass-timeout", "stall-watchdog"],
  );
});

test("CT-127-14: a five-hour pause is excluded from the wall-clock budget", async () => {
  const ports = testPorts();
  const startedAtMonotonicMs = ports.clock.monotonicMs();

  // Ten minutes of work.
  ports.clock.advance(10 * 60 * 1000);
  let paused = noPausedTime();
  assert.equal(
    wallClockMinutes({
      startedAtMonotonicMs,
      nowMonotonicMs: ports.clock.monotonicMs(),
      pausedMs: paused.runPausedMs,
    }),
    10,
  );

  // A pause of five hours, waited through the fake sleep.
  const open = openPause(ports.clock);
  await ports.sleep.sleep(FIVE_HOURS);
  const closed = closePause(ports.clock, open, paused);
  paused = closed.after;
  assert.equal(closed.pausedMs, FIVE_HOURS, "the pause lasted five hours on the clock");

  // Ten more minutes of work.
  ports.clock.advance(10 * 60 * 1000);
  const elapsed = wallClockElapsedMs({
    startedAtMonotonicMs,
    nowMonotonicMs: ports.clock.monotonicMs(),
    pausedMs: paused.runPausedMs,
  });
  assert.equal(elapsed, 20 * 60 * 1000, "twenty minutes of work, not five hours and twenty");
  assert.equal(
    wallClockMinutes({
      startedAtMonotonicMs,
      nowMonotonicMs: ports.clock.monotonicMs(),
      pausedMs: paused.runPausedMs,
    }),
    20,
  );
});

test("CT-127-14: a wall-clock ceiling of 60 minutes is not tripped by a five-hour pause", () => {
  const ledger = emptyLedger("run-1");
  const reading = readCeiling(
    { dimension: "wallClock", scope: "run", limit: 60 },
    {
      ledger,
      wallClockMinutes: wallClockMinutes({
        startedAtMonotonicMs: 0,
        nowMonotonicMs: FIVE_HOURS + 20 * 60 * 1000,
        pausedMs: FIVE_HOURS,
      }),
    },
  );
  assert.equal(reading.used, 20, "the pause is excluded (F127-FR-012)");
  assert.equal(reading.exhausted, false, "and the ceiling of 60 minutes holds");
});

test("CT-127-14: a pause is excluded from the timeout of a pass", () => {
  const limitMs = 30 * 60 * 1000; // half an hour per pass
  // Ten minutes of work, then five hours of pause, then ten more minutes.
  const elapsedMs = 10 * 60 * 1000 + FIVE_HOURS + 10 * 60 * 1000;
  assert.equal(
    passTimeoutRemainingMs({ limitMs, elapsedMs, pausedMs: FIVE_HOURS }),
    10 * 60 * 1000,
    "ten minutes of the pass are left",
  );
  assert.equal(passTimedOut({ limitMs, elapsedMs, pausedMs: FIVE_HOURS }), false);
  assert.equal(
    passTimedOut({ limitMs, elapsedMs, pausedMs: 0 }),
    true,
    "and without the exclusion the pass would have timed out",
  );
  assert.equal(
    passTimeoutRemainingMs({ limitMs: 0, elapsedMs, pausedMs: 0 }),
    null,
    "0 is no timeout",
  );
});

test("CT-127-14: a pause is excluded from the stall watchdog", () => {
  const limitMs = 15 * 60 * 1000;
  const sinceLastOutputMs = FIVE_HOURS + 60_000;
  assert.equal(
    stallWatchdogRemainingMs({ limitMs, sinceLastOutputMs, pausedMs: FIVE_HOURS }),
    14 * 60 * 1000,
    "the watchdog has fourteen minutes left",
  );
  assert.equal(watchdogFired({ limitMs, sinceLastOutputMs, pausedMs: FIVE_HOURS }), false);
  assert.equal(
    watchdogFired({ limitMs, sinceLastOutputMs, pausedMs: 0 }),
    true,
    "and without the exclusion the watchdog would have killed the paused run",
  );
});

test("CT-127-14: the exclusion never goes below zero", () => {
  assert.equal(excludePaused(100, 1000), 0);
  assert.equal(excludePaused(-5, 0), 0);
  assert.equal(excludePaused(Number.NaN, 10), 0);
  assert.equal(excludePaused(1000, Number.NaN), 1000);
});

test("CT-127-14: a clock change during a pause cannot distort `pausedMs`", async () => {
  const ports = testPorts();
  const open = openPause(ports.clock);
  await ports.sleep.sleep(60 * 60 * 1000);
  // The machine's wall clock is corrected backwards by a day during the pause.
  ports.clock.jumpBy(-24 * 60 * 60 * 1000);
  const closed = closePause(ports.clock, open, noPausedTime());
  assert.equal(closed.pausedMs, 60 * 60 * 1000, "the monotonic reading is not moved by a jump");
  assert.ok(closed.pausedMs >= 0);
});

test("CT-127-14: `pausedMs` is recorded on the phase attempt AND on the run", () => {
  let time = noPausedTime();
  time = addPausedMs(time, FIVE_HOURS);
  assert.equal(time.attemptPausedMs, FIVE_HOURS);
  assert.equal(time.runPausedMs, FIVE_HOURS);

  const recorded = pausedMsOf(time);
  assert.equal(recorded.attempt.pausedMs, FIVE_HOURS, "on the phase attempt (F127-FR-012)");
  assert.equal(recorded.run.pausedMs, FIVE_HOURS, "and on the run");
  assert.equal(LEDGER_FIELD, "run.pausedMs", "the field of the ledger (annex B §B.20)");
  assert.equal(emptyLedger("run-1").run.pausedMs, 0, "which the ledger holds");

  // A new phase attempt starts at zero; the run's figure carries.
  const next = nextAttempt(time);
  assert.equal(next.attemptPausedMs, 0);
  assert.equal(next.runPausedMs, FIVE_HOURS);
});

test("CT-127-14: two pauses add up on both figures", async () => {
  const ports = testPorts();
  let time = noPausedTime();
  for (const ms of [FIVE_HOURS, 60 * 60 * 1000]) {
    const open = openPause(ports.clock);
    await ports.sleep.sleep(ms);
    time = closePause(ports.clock, open, time).after;
  }
  assert.equal(time.runPausedMs, FIVE_HOURS + 60 * 60 * 1000);
  assert.equal(time.attemptPausedMs, time.runPausedMs);
});

test("CT-127-14: a quota signal inside a unit of work pauses like any pass and uses no inner cap", () => {
  const inside = pauseInsideAUnitOfWork("unit-3");
  assert.equal(inside.pausesLikeAPass, true, "it pauses like any pass (F127-FR-012)");
  assert.equal(inside.usesAnInnerCap, false, "and uses NO inner cap");
  assert.equal(inside.unitGivenBackAtTheResume, true);
  assert.equal(inside.endCause, "quota_pause", "the same end cause as the pass that holds it");
  assert.ok(inside.note.includes("unit-3"));
});

test("CT-127-14 (checkpoint): a five-hour pause is a test of microseconds", async () => {
  const ports = testPorts();
  const realStart = process.hrtime.bigint();
  const open = openPause(ports.clock);
  await ports.sleep.sleep(FIVE_HOURS);
  const closed = closePause(ports.clock, open, noPausedTime());
  const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;
  assert.equal(closed.pausedMs, FIVE_HOURS, "five hours on the fake clock");
  assert.ok(realMs < 1000, `and under a second of real time (${realMs.toFixed(3)} ms)`);
});
