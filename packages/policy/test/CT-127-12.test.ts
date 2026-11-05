/**
 * CT-127-12 (T025) — the characterization test of the PAUSE RECORD and of the
 * EVENTS on a `structured` classification (F127-FR-010).
 *
 * Acceptance scenario 1 of user story 1: given a `quota_window` classification
 * with confidence `structured`, when the engine reads it, then the state is
 * `paused-quota`, the pause record holds the role, class, confidence, `since`,
 * `resetsAt`, `resumeAt`, `probeIndex` and `ceilingAt`, and the events
 * `quota.signal` and `run.paused` are written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "@specstride/contracts/records/compile";
import { endCausesOfAPassPassEndedFieldEndcause } from "@specstride/contracts/enums/all-sets";
import {
  PAUSE_LOGICAL_NAME,
  PAUSE_RECORDS_PER_RUN,
  PAUSE_RECORD_FIELDS,
  PAUSE_SCHEMA_ID,
  PAUSE_STATE,
  PAUSE_TRANSITION,
  PASS_END_CAUSE,
  PauseRecordError,
  buildPauseRecord,
  enterPause,
  pausesWithoutAProbe,
  readPauseRecord,
  type EnterPauseInput,
} from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { classify } from "../src/quota/classify.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const RECORD_PATH = ".specstride/runs/run-1/pause.record";
const SINCE = new Date(DEFAULT_START_MS).toISOString();
const RESETS_AT = new Date(DEFAULT_START_MS + 5 * 60 * 60 * 1000).toISOString();
const RESUME_AT = new Date(DEFAULT_START_MS + 5 * 60 * 60 * 1000 + 60_000).toISOString();
const CEILING_AT = new Date(DEFAULT_START_MS + 24 * 60 * 60 * 1000).toISOString();

/** The `structured` classification of acceptance scenario 1. */
const STRUCTURED = classify({
  structuredClass: "quota_window",
  resetsAt: { structured: RESETS_AT },
  rateLimitType: "tokens-per-window",
  utilization: 1,
});

function input(overrides: Partial<EnterPauseInput> = {}): EnterPauseInput {
  return {
    runId: "run-1",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification: STRUCTURED,
    since: SINCE,
    resumeAt: RESUME_AT,
    ceilingAt: CEILING_AT,
    probeIndex: 0,
    recordPath: RECORD_PATH,
    ...overrides,
  };
}

test("CT-127-12: the classification of scenario 1 pauses at once, with no probe", () => {
  assert.equal(STRUCTURED.quotaClass, "quota_window");
  assert.equal(STRUCTURED.confidence, "structured");
  assert.equal(pausesWithoutAProbe("quota_window", "structured"), true);
  assert.equal(pausesWithoutAProbe("quota_window", "status"), true);
  assert.equal(pausesWithoutAProbe("quota_window", "text"), false, "text needs the probe (§Q.2)");
  assert.equal(pausesWithoutAProbe("quota_credit", "structured"), false, "credit is not a pause");
});

test("CT-127-12: the state is `paused-quota`, by transition T6", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(entry.state, "paused-quota");
  assert.equal(entry.state, PAUSE_STATE);
  assert.equal(entry.transition, "T6");
  assert.equal(entry.transition, PAUSE_TRANSITION);
  assert.equal(entry.alreadyPaused, false);
});

test("CT-127-12: the pause record holds every field of annex B §B.17", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  const record = entry.record;

  assert.equal(record.schema, PAUSE_SCHEMA_ID);
  assert.equal(record.schema, "specstride.pause/1");
  assert.equal(PAUSE_LOGICAL_NAME, "run:<runId>:pause");
  assert.equal(record.runId, "run-1");
  assert.equal(record.attemptId, "p1-a1");
  // The eight the acceptance scenario names, one by one.
  assert.equal(record.role, "proposer", "the role");
  assert.equal(record.class, "quota_window", "the class");
  assert.equal(record.confidence, "structured", "the confidence");
  assert.equal(record.since, SINCE, "`since`");
  assert.equal(record.resetsAt, RESETS_AT, "`resetsAt`");
  assert.equal(record.resumeAt, RESUME_AT, "`resumeAt`");
  assert.equal(record.probeIndex, 0, "`probeIndex`");
  assert.equal(record.ceilingAt, CEILING_AT, "`ceilingAt`");
  // And the harness of the role, which §B.17 also lists.
  assert.equal(record.harness, "stub-harness");

  assert.deepEqual(Object.keys(record).sort(), [...PAUSE_RECORD_FIELDS].sort());
  assert.equal(PAUSE_RECORD_FIELDS.length, 12, "the twelve fields of §B.17");
});

test("CT-127-12: the record that was written validates against `specstride.pause/1`", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(ports.fileWriter.writes.length, 1, "one write");
  assert.equal(ports.fileWriter.writes[0].path, RECORD_PATH);

  // Read it back through an independent path: the file, parsed and validated.
  const onDisk = JSON.parse(ports.fileWriter.read(RECORD_PATH));
  const read = validate(PAUSE_SCHEMA_ID, onDisk);
  assert.equal(read.ok, true, "feature 100's own schema accepts the record");
  assert.deepEqual(onDisk, entry.record, "and the file holds what the entry reported");

  const reread = readPauseRecord(ports.fileWriter, RECORD_PATH);
  assert.deepEqual(reread, entry.record);
});

test("CT-127-12: a record the schema refuses is never written", () => {
  const ports = testPorts();
  assert.throws(
    () => buildPauseRecord(input({ probeIndex: 1.5 })),
    PauseRecordError,
    "`probeIndex` is a whole number in §B.17",
  );
  assert.deepEqual(ports.fileWriter.writes, []);
});

test("CT-127-12: the events `quota.signal` and `run.paused` are written, in that order", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.deepEqual(ports.eventWriter.types(), ["quota.signal", "run.paused"]);
  assert.equal(entry.events.length, 2);

  const signal = ports.eventWriter.of("quota.signal")[0].payload;
  assert.equal(signal.class, "quota_window");
  assert.equal(signal.confidence, "structured");
  assert.equal(signal.resetsAt, RESETS_AT);
  assert.equal(signal.resetsAtSource, "structured");
  assert.equal(signal.utilization, 1);
  assert.equal(signal.ruleId, "Q-01-quota_window");
  assert.equal(signal.role, "proposer");
  assert.equal(signal.harness, "stub-harness");

  const paused = ports.eventWriter.of("run.paused")[0].payload;
  assert.equal(paused.class, "quota_window");
  assert.equal(paused.confidence, "structured");
  assert.equal(paused.resumeAt, RESUME_AT, "`run.paused` carries the resume time (F127-FR-010)");
  assert.equal(paused.resetsAt, RESETS_AT);
  assert.equal(paused.role, "proposer");

  assert.equal(entry.pair.open, true, "the pair of F127-FR-040 is open until the resume");
});

test("CT-127-12: the pass in flight ends with `quota_pause`, the tree is kept, the attempt stays open", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(entry.passEnded.endCause, "quota_pause");
  assert.equal(entry.passEnded.endCause, PASS_END_CAUSE);
  assert.ok(
    endCausesOfAPassPassEndedFieldEndcause.members.includes("quota_pause" as never),
    "`quota_pause` is a member of row 271 of annex X §X.6",
  );
  assert.equal(entry.passEnded.treeKept, true, "the working tree is kept (F127-FR-010)");
  assert.equal(entry.passEnded.attemptStaysOpen, true, "the phase attempt stays open");
  assert.equal(entry.passEnded.countedAsARejection, false, "and is not counted as a rejection");
});

test("CT-127-12: ONE record and ONE event cover the run, whatever the number of live processes", () => {
  const ports = testPorts();
  assert.equal(PAUSE_RECORDS_PER_RUN, 1);
  const first = enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(first.alreadyPaused, false);

  // A second live harness process sees the same limit a moment later.
  const second = enterPause(ports, input({ role: "critic" }), first.pair);
  assert.equal(second.alreadyPaused, true, "the run is already paused");
  assert.deepEqual(second.events, [], "no second event (F127-FR-010)");
  assert.deepEqual(second.record, first.record, "and the one record stands");

  // A third one, and a fourth.
  enterPause(ports, input(), second.pair);
  enterPause(ports, input(), second.pair);
  assert.equal(ports.fileWriter.writes.length, 1, "one write in all");
  assert.equal(ports.eventWriter.countOf("run.paused"), 1, "one `run.paused` in all");
  assert.equal(ports.eventWriter.countOf("quota.signal"), 1);
  assert.equal(
    ports.fileWriter.paths().filter((path) => path.endsWith("pause.record")).length,
    1,
    "one pause record on disk",
  );
});

test("CT-127-12: a pause with no reset time writes `resetsAt` null and a probe index", () => {
  const ports = testPorts();
  const noReset = classify({ errorText: "usage limit reached", stalled: false });
  const entry = enterPause(
    ports,
    input({ classification: noReset, resumeAt: null, probeIndex: 2 }),
    PAIR_CLOSED,
  );
  assert.equal(entry.record.resetsAt, null);
  assert.equal(entry.record.resumeAt, null);
  assert.equal(entry.record.probeIndex, 2);
  const read = validate(PAUSE_SCHEMA_ID, JSON.parse(ports.fileWriter.read(RECORD_PATH)));
  assert.equal(read.ok, true, "null is a value §B.17 allows for both");
});

test("CT-127-12 (checkpoint): the pause is entered with no clock read of its own", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(ports.clock.nowMs(), before, "`since` and the two instants are arguments");
  assert.equal(ports.clock.sleeps.length, 0, "entering a pause waits for nothing");
});
