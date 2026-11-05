/**
 * CT-127-17 (T034) — the characterization test of a CLOCK JUMP, a KILLED
 * ENGINE and `resume` (F127-FR-015).
 *
 * Two edge cases of user story 1:
 *
 *  - the machine sleeps during a pause: on wake the remaining wait is computed
 *    from `resumeAt` and `ceilingAt`, never from a timer;
 *  - the engine is killed during a pause and `resume` is run: the pause record
 *    is read and the pause is entered again.
 *
 * The killed engine is modelled the way a file-coordinated product makes
 * possible and a test can observe: the record on the store outlives the
 * process that wrote it, and a FRESH set of ports — a new clock, a new event
 * writer, nothing of the first engine's memory — reads it back. That is the
 * independent read path: the only thing that crosses the kill is the file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AFTER_A_CRASH_OR_A_REBOOT,
  INSTANTS_OF_THE_RECORD,
  REMAINING_WAIT_COMES_FROM_A_TIMER,
  onWake,
  remainingWait,
  remainingWaitMs,
  resumeAfterACrash,
} from "../src/quota/recover.ts";
import { enterPause, readPauseRecord, type EnterPauseInput } from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { resume } from "../src/quota/resume.ts";
import { closePause, noPausedTime, openPause } from "../src/quota/clocks.ts";
import { classify } from "../src/quota/classify.ts";
import { DEFAULT_START_MS, fakeFileWriter, testPorts } from "./support/index.ts";

const RECORD_PATH = ".specstride/runs/run-1/pause.record";
const DAY = 24 * 60 * 60 * 1000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;
const RESUME_AT = new Date(DEFAULT_START_MS + FIVE_HOURS + 60_000).toISOString();
const CEILING_AT = new Date(DEFAULT_START_MS + DAY).toISOString();

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
    resumeAt: RESUME_AT,
    ceilingAt: CEILING_AT,
    recordPath: RECORD_PATH,
    ...overrides,
  };
}

test("CT-127-17: the remaining wait comes from the record's two instants, never from a timer", () => {
  assert.equal(REMAINING_WAIT_COMES_FROM_A_TIMER, false);
  assert.deepEqual([...INSTANTS_OF_THE_RECORD], ["resumeAt", "ceilingAt"]);
});

/* ---------------------------------------------------------------- *
 * A clock jump: the machine slept.
 * ---------------------------------------------------------------- */

test("CT-127-17: a clock jump past the resume time makes the resume due at once", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);

  // One minute of waiting, then the machine suspends for six hours. The wall
  // clock jumps; the monotonic reading does not.
  await ports.sleep.sleep(60_000);
  const beforeMonotonic = ports.clock.monotonicMs();
  ports.clock.jumpBy(6 * 60 * 60 * 1000);
  assert.equal(ports.clock.monotonicMs(), beforeMonotonic, "a jump moves no monotonic reading");

  const wake = onWake(entry.record, ports.clock);
  assert.equal(wake.path, "wake");
  assert.equal(wake.wait?.resumeDue, true, "the resume time passed while the machine slept");
  assert.equal(wake.wait?.untilResumeMs, 0);
  assert.equal(wake.state, "running");
  assert.equal(wake.pauseEnteredAgain, false, "there is nothing left to wait for");
  assert.ok(wake.note.includes("not from a timer"));
});

test("CT-127-17: a clock jump that is still short of the resume time leaves the pause open", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  ports.clock.jumpBy(60 * 60 * 1000); // one hour of suspend
  const wake = onWake(entry.record, ports.clock);
  assert.equal(wake.state, "paused-quota", "still paused");
  assert.equal(wake.pauseEnteredAgain, true);
  assert.equal(
    wake.wait?.untilResumeMs,
    FIVE_HOURS + 60_000 - 60 * 60 * 1000,
    "and the remaining wait is simply shorter",
  );
});

test("CT-127-17: a clock jump past the CEILING reports the ceiling and not the resume", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  ports.clock.jumpBy(DAY + 1); // the machine slept for more than a day
  const wake = onWake(entry.record, ports.clock);
  assert.equal(wake.wait?.ceilingReached, true);
  assert.equal(wake.wait?.action, "ceiling");
  assert.equal(wake.state, "blocked-on-human", "the ceiling wins over a due resume");
});

test("CT-127-17: a clock jump BACKWARDS lengthens the wait and never makes it negative", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  ports.clock.jumpBy(-2 * 60 * 60 * 1000); // the clock was corrected backwards
  const wait = remainingWait(entry.record, ports.clock.nowMs());
  assert.equal(wait.untilResumeMs, FIVE_HOURS + 60_000 + 2 * 60 * 60 * 1000);
  assert.ok(wait.waitMs > 0);
  assert.equal(wait.action, "wait");
  assert.ok(remainingWaitMs(entry.record, ports.clock.nowMs()) > 0);
});

/* ---------------------------------------------------------------- *
 * A killed engine, and `resume`.
 * ---------------------------------------------------------------- */

test("CT-127-17: after a killed engine, `resume` finds the record and enters the pause again", () => {
  // Engine 1 pauses, and is killed. The only thing that survives is the file.
  const store = fakeFileWriter();
  const engine1 = { ...testPorts(), fileWriter: store };
  const entry = enterPause(engine1, input(), PAIR_CLOSED);
  assert.equal(store.exists(RECORD_PATH), true);

  // Engine 2 — a fresh process: a new clock, a new event writer, no memory of
  // engine 1. It reads the record through the store, which is the independent
  // read path.
  const engine2 = {
    ...testPorts({ startMs: DEFAULT_START_MS + 60 * 60 * 1000 }),
    fileWriter: store,
  };
  const recovered = resumeAfterACrash(store, RECORD_PATH, engine2.clock);
  assert.equal(recovered.path, "crash");
  assert.ok(recovered.record !== null, "`resume` found the pause record (F127-FR-015)");
  assert.deepEqual(recovered.record, entry.record, "byte for byte the record engine 1 wrote");
  assert.equal(recovered.pauseEnteredAgain, true, "and entered the pause again");
  assert.equal(recovered.state, "paused-quota");
  assert.equal(
    recovered.wait?.untilResumeMs,
    FIVE_HOURS + 60_000 - 60 * 60 * 1000,
    "with the remaining wait computed the same way, from the record",
  );
  assert.deepEqual(engine2.eventWriter.types(), [], "and no event: the pause never ended");
});

test("CT-127-17: a reboot is the same path, and nothing relaunches by itself", () => {
  const store = fakeFileWriter();
  const engine1 = { ...testPorts(), fileWriter: store };
  enterPause(engine1, input(), PAIR_CLOSED);

  const afterTheReboot = {
    ...testPorts({ startMs: DEFAULT_START_MS + 2 * 60 * 60 * 1000 }),
    fileWriter: store,
  };
  const recovered = resumeAfterACrash(store, RECORD_PATH, afterTheReboot.clock, "reboot");
  assert.equal(recovered.path, "reboot");
  assert.equal(recovered.pauseEnteredAgain, true);

  assert.equal(AFTER_A_CRASH_OR_A_REBOOT.relaunchesByItself, false);
  assert.equal(AFTER_A_CRASH_OR_A_REBOOT.broughtBackBy, "resume");
  assert.equal(
    AFTER_A_CRASH_OR_A_REBOOT.givesTheClassifierTablesSomethingToClassify,
    false,
    "a pause gives neither relaunch classifier table anything to classify (F127-FR-015)",
  );
  assert.deepEqual(
    [...AFTER_A_CRASH_OR_A_REBOOT.relaunchClassifierTables],
    ["relaunch-observe", "relaunch-root"],
  );
});

test("CT-127-17: `resume` with no pause record finds no pause to enter", () => {
  const ports = testPorts();
  const recovered = resumeAfterACrash(ports.fileWriter, RECORD_PATH, ports.clock);
  assert.equal(recovered.record, null);
  assert.equal(recovered.pauseEnteredAgain, false);
  assert.equal(recovered.state, null);
});

test("CT-127-17: a record the store cannot read is no record at all", () => {
  const store = fakeFileWriter();
  const engine1 = { ...testPorts(), fileWriter: store };
  enterPause(engine1, input(), PAIR_CLOSED);
  store.makeUnreadable(RECORD_PATH);
  assert.equal(readPauseRecord(store, RECORD_PATH), null);
  const ports = testPorts();
  assert.equal(resumeAfterACrash(store, RECORD_PATH, ports.clock).record, null);

  // And a record that is not a `specstride.pause/1` is refused, not read.
  store.makeReadable(RECORD_PATH);
  store.seed(RECORD_PATH, JSON.stringify({ schema: "specstride.pause/1", runId: "run-1" }));
  assert.equal(readPauseRecord(store, RECORD_PATH), null, "a record missing fields of §B.17");
  store.seed(RECORD_PATH, "not json at all");
  assert.equal(readPauseRecord(store, RECORD_PATH), null);
});

test("CT-127-17: `resume` after the record came due resumes the run, and the record is gone", async () => {
  const store = fakeFileWriter();
  const engine1 = { ...testPorts(), fileWriter: store };
  const entry = enterPause(engine1, input(), PAIR_CLOSED);

  // Engine 2 starts a day later, with the resume time long past.
  const engine2 = {
    ...testPorts({ startMs: DEFAULT_START_MS + FIVE_HOURS + 2 * 60 * 1000 }),
    fileWriter: store,
  };
  const recovered = resumeAfterACrash(store, RECORD_PATH, engine2.clock);
  assert.equal(recovered.wait?.resumeDue, true);
  assert.equal(recovered.state, "running");

  const result = resume(
    engine2,
    {
      record: recovered.record as NonNullable<typeof recovered.record>,
      recordPath: RECORD_PATH,
      resumedBy: "resume-time",
      pausedMs: FIVE_HOURS + 2 * 60 * 1000,
      pausedTime: noPausedTime(),
    },
    { open: true },
  );
  assert.equal(result.recordRemoved, true);
  assert.equal(store.exists(RECORD_PATH), false, "read back through the store itself");
  assert.deepEqual(engine2.eventWriter.types(), ["run.resumed"]);
  assert.equal(
    result.attemptId,
    entry.record.attemptId,
    "the same phase attempt as before the kill",
  );
});

test("CT-127-17 (checkpoint): the recovery is computed on a fake clock, with no real wait", async () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  const realStart = process.hrtime.bigint();
  const open = openPause(ports.clock);
  await ports.sleep.sleep(FIVE_HOURS);
  const closed = closePause(ports.clock, open, noPausedTime());
  const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;
  assert.equal(closed.pausedMs, FIVE_HOURS);
  assert.ok(realMs < 1000);
  assert.equal(onWake(entry.record, ports.clock).wait?.untilResumeMs, 60_000);
});
