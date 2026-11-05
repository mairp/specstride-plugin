/**
 * The characterization of the two modules of phase 6 against the injected
 * ports: the fake clock drives the whole-minute test, and what the halt
 * produced is read back through an INDEPENDENT read path — the recorded event
 * stream and the file store — and never from the value the call returned.
 *
 *  - `../src/budget/wall-clock.ts` (T074, F127-FR-026);
 *  - `../src/budget/wall-boundary.ts` (T075, F127-FR-027).
 *
 * The parity tests of `tests/parity/127/` hold the baseline's own facts
 * (B-0049, B-0068, B-0127, B-0143, B-0210, B-0270). This file holds the
 * port-level behaviour the fakes can show: a clock that moves, a budget that
 * trips exactly once it should, a durable record that did not exist before the
 * halt, and the absence of every effect F127-FR-027 forbids.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { contentHash } from "@specstride/kernel";

import {
  CHECK_ORDER,
  PHASE_BOUNDARY_STEPS,
  RUN_STOP_LOGICAL_NAME,
  checkAtBoundary,
  checkEveryStep,
  haltOnWallBudget,
  runStopRecord,
  wallBudgetLine,
  wallBudgetTerminal,
} from "../src/budget/wall-boundary.ts";
import {
  WALL_CLOCK_ALIAS,
  WALL_CLOCK_KEY,
  agreesWithCeilings,
  defaultWallClockLimit,
  evaluateWallClock,
  passLoopHandoff,
  readWallClockMinutes,
  resolveWallClockLimit,
  wallClockCeiling,
  wallClockTickInAYield,
} from "../src/budget/wall-clock.ts";
import { evaluateCeilings, readCeiling } from "../src/budget/ceilings.ts";
import { emptyLedger } from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const reading = (ports: ReturnType<typeof testPorts>, startedAtMonotonicMs: number) => ({
  startedAtMonotonicMs,
  nowMonotonicMs: ports.clock.monotonicMs(),
  pausedMs: 0,
});

test("CT-127 wall clock: the fake clock drives the whole-minute test and nothing else does", () => {
  const ports = testPorts();
  const start = ports.clock.monotonicMs();
  const limit = resolveWallClockLimit({ key: 2 });

  assert.equal(evaluateWallClock({ limit, reading: reading(ports, start) }).minutes, 0);
  ports.clock.advance(119_999);
  const almost = evaluateWallClock({ limit, reading: reading(ports, start) });
  assert.equal(almost.minutes, 1);
  assert.equal(almost.trips, false);
  ports.clock.advance(1);
  const tripped = evaluateWallClock({ limit, reading: reading(ports, start) });
  assert.equal(tripped.minutes, 2);
  assert.equal(tripped.trips, true);
  assert.equal(tripped.elapsedMs, 120_000);

  // A change of the wall clock does not move the budget: it is monotonic.
  ports.clock.jumpBy(-60 * 60 * 1000);
  assert.equal(evaluateWallClock({ limit, reading: reading(ports, start) }).trips, true);
});

test("CT-127 wall clock: the default limit agrees with `ceilings.ts`, which reads 0 as off", () => {
  const standing = defaultWallClockLimit();
  assert.equal(agreesWithCeilings(standing), true);
  assert.equal(agreesWithCeilings(resolveWallClockLimit({ key: 5 })), true);

  // The budget as a ceiling of the table of §Q.3: run scope, `wallClock`.
  const ceiling = wallClockCeiling(standing.minutes);
  assert.equal(ceiling.scope, "run");
  assert.equal(ceiling.dimension, "wallClock");
  const off = evaluateCeilings([ceiling], { ledger: emptyLedger("run-1"), wallClockMinutes: 99 });
  assert.equal(off.readings[0]?.active, false, "a ceiling of 0 is off");
  assert.equal(off.readings[0]?.exhausted, false);
  assert.equal(off.exhausted.length, 0);
  assert.equal(off.wallClockTripped, null);

  const active = evaluateCeilings([wallClockCeiling(2)], {
    ledger: emptyLedger("run-1"),
    wallClockMinutes: 3,
  });
  assert.equal(active.readings.length, 1);
  assert.equal(active.readings[0]?.dimension, "wallClock");
  assert.equal(active.readings[0]?.exhausted, true);
  assert.equal(active.wallClockTripped?.key, WALL_CLOCK_KEY);
  // The wall clock is NOT a cap of spend: its trip never takes F127-FR-034.
  assert.equal(active.readings[0]?.isCapOfSpend, false);
  assert.equal(active.exhaustedCapsOfSpend.length, 0);
});

test("CT-127 wall clock: the halt writes a durable record that did not exist before it", () => {
  const ports = testPorts();
  const start = ports.clock.monotonicMs();
  const limit = resolveWallClockLimit({ alias: "1" });
  ports.clock.advance(61_000);

  // Nothing is in the store before the halt.
  const path = `/runs/run-1/${RUN_STOP_LOGICAL_NAME.replace(/[:<>]/g, "_")}.jsonl`;
  assert.equal(ports.fileWriter.exists(path), false);
  assert.deepEqual([...ports.fileWriter.paths()], []);

  const outcome = checkAtBoundary(
    {
      step: "before-a-phase-attempt",
      phase: "3",
      limit,
      reading: reading(ports, start),
    },
    ports.eventWriter,
  );
  assert.ok(outcome.halt !== null);

  // The engine's own write of the projection line, through the port.
  ports.fileWriter.write(path, `${JSON.stringify(outcome.halt.runStop)}\n`);

  // The INDEPENDENT read path: read the file back and parse it, rather than
  // trusting the value the call returned.
  const found = JSON.parse(ports.fileWriter.read(path).trim()) as Record<string, unknown>;
  assert.deepEqual(found, { event: "run_stop", reason: "wall_budget", phase: "3" });
  assert.equal(ports.fileWriter.exists(path), true);
  assert.equal(ports.fileWriter.writes[0]?.replaced, false);

  // A durable content hash of the record, which could not exist before.
  const hash = contentHash(JSON.stringify(runStopRecord("3")));
  assert.equal(contentHash(JSON.stringify(found)), hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("CT-127 wall clock: the halt emits no `blocked` and the recorded stream shows it (F127-FR-027, CQ-192)", () => {
  const ports = testPorts();
  const start = ports.clock.monotonicMs();
  ports.clock.advance(5 * 60_000);

  const outcome = checkAtBoundary(
    {
      step: "before-a-phase-attempt",
      phase: "7",
      limit: resolveWallClockLimit({ key: 1 }),
      reading: reading(ports, start),
    },
    ports.eventWriter,
  );
  assert.ok(outcome.halt !== null);

  // The independent read path: the recorded stream of the fake writer.
  assert.equal(ports.eventWriter.countOf("blocked"), 0);
  assert.equal(ports.eventWriter.types().includes("blocked"), false);
  assert.equal(outcome.halt.terminal.blockedReason, null);
  assert.equal(outcome.halt.terminal.retryable, true);
  assert.equal(outcome.halt.terminal.restsIn, null);
  assert.equal(outcome.halt.line, wallBudgetLine(1));
});

test("CT-127 wall clock: `budget.exceeded` is written where a reading is handed in, and only then", () => {
  const ports = testPorts();
  const halt = haltOnWallBudget(
    {
      step: "before-a-phase-attempt",
      phase: "3",
      evaluation: evaluateWallClock({
        limit: resolveWallClockLimit({ key: 1 }),
        reading: { startedAtMonotonicMs: 0, nowMonotonicMs: 120_000, pausedMs: 0 },
      }),
      reading: readCeiling(wallClockCeiling(1), {
        ledger: emptyLedger("run-1"),
        wallClockMinutes: 2,
      }),
    },
    ports.eventWriter,
  );
  assert.equal(ports.eventWriter.countOf("budget.exceeded"), 1);
  const event = ports.eventWriter.of("budget.exceeded")[0];
  assert.equal(event?.payload.dimension, "wallClock");
  assert.equal(halt.stop.emitsBlocked, false);
  assert.equal(ports.eventWriter.countOf("blocked"), 0);

  // With no reading, no event at all: the halt is still the same.
  const quiet = testPorts();
  const second = haltOnWallBudget(
    {
      step: "before-a-phase-attempt",
      phase: "3",
      evaluation: evaluateWallClock({
        limit: resolveWallClockLimit({ key: 1 }),
        reading: { startedAtMonotonicMs: 0, nowMonotonicMs: 120_000, pausedMs: 0 },
      }),
    },
    quiet.eventWriter,
  );
  assert.deepEqual([...quiet.eventWriter.types()], []);
  assert.equal(second.exitCode, 4);
});

test("CT-127 wall clock: every one of the six phase-boundary steps tests the budget after the stop request", () => {
  const ports = testPorts();
  const start = ports.clock.monotonicMs();
  ports.clock.advance(60_000);
  const walked = checkEveryStep({
    phase: "3",
    limit: resolveWallClockLimit({ key: 1 }),
    reading: reading(ports, start),
  });
  assert.deepEqual(
    walked.map((outcome) => outcome.step),
    [...PHASE_BOUNDARY_STEPS],
  );
  for (const outcome of walked) {
    assert.deepEqual([...outcome.order], [...CHECK_ORDER]);
    assert.equal(outcome.stopRequestTestedFirst, true);
    assert.equal(outcome.halt?.exitCode, 4);
  }
  assert.equal(wallBudgetTerminal().stopReason, "wall_budget");
});

test("CT-127 wall clock: the pass loop gets the start and the limit, and its tick moves with the fake clock (B-0068)", () => {
  const ports = testPorts({ startMs: "2026-10-03T12:00:00.000Z" });
  const handoff = passLoopHandoff({
    limit: resolveWallClockLimit({ alias: "3" }),
    startedAtEpochMs: ports.clock.nowMs(),
    startedAtMonotonicMs: ports.clock.monotonicMs(),
  });
  assert.equal(handoff.variables[WALL_CLOCK_ALIAS], "3");
  assert.equal(
    handoff.variables.SPECSTRIDE_RUN_START_EPOCH,
    String(Math.floor(Date.parse("2026-10-03T12:00:00.000Z") / 1000)),
  );

  ports.clock.advance(179_999);
  assert.equal(
    wallClockTickInAYield({ handoff, nowMonotonicMs: ports.clock.monotonicMs() }).trips,
    false,
  );
  ports.clock.advance(1);
  const tick = wallClockTickInAYield({ handoff, nowMonotonicMs: ports.clock.monotonicMs() });
  assert.equal(tick.trips, true);
  assert.equal(tick.ending, "wall_budget");
  assert.equal(tick.decidedBy, "pass-loop");

  // A pause inside the wait pushes the trip out by exactly the paused time.
  const paused = wallClockTickInAYield({
    handoff,
    nowMonotonicMs: ports.clock.monotonicMs(),
    pausedMs: 1,
  });
  assert.equal(paused.trips, false);
});

test("CT-127 wall clock: a value that is not a whole number or not a number is ignored with its reason", () => {
  for (const [value, reason] of [
    ["abc", "non-numeric"],
    ["1.5", "not-a-whole-number"],
    [0, "zero-is-unlimited"],
    [-2, "not-positive"],
    [undefined, "unset"],
  ] as const) {
    const limit = readWallClockMinutes(value);
    assert.equal(limit.ignored, reason, String(value));
    assert.equal(limit.active, false, String(value));
    assert.equal(limit.raw, value, String(value));
  }
});
