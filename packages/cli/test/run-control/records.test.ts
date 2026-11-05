/**
 * T002 — the schema-validated readers of run control (feature 102).
 *
 * A valid sample of each of the three records passes; a different major is
 * refused with the message of the annex; the stop request must be of type
 * `stop`; and an absent, unreadable or empty stop request file is a clean
 * stop with the defaults (F102-FR-001; contracts/stop-request.md).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAUNCH_SCHEMA_ID,
  SNAPSHOT_SCHEMA_ID,
  STOP_LOGICAL_NAME,
  STOP_REQUEST_TYPE,
  readLaunchRecord,
  readRunSnapshot,
  readStopRequest,
  readStopRequestFromFile,
} from "../../../cli/src/run-control/records.ts";
import { RecordRefusedError } from "@specstride/contracts/records/validate";
import { sampleOf } from "../../../contracts/test/samples.ts";

const STOP = {
  schema: "specstride.inbox/1",
  type: "stop",
  at: "2026-09-30T00:00:00.000Z",
  now: true,
  jobs: false,
} as const;

const SNAPSHOT = {
  schema: "specstride.snapshot/1",
  runId: "run-102-1",
  createdAt: "2026-09-30T00:00:00.000Z",
  profile: null,
  keys: {},
  sourceHashes: {},
} as const;

// A valid sample built from the schema itself, so it cannot drift (§B.6).
const LAUNCH = { ...sampleOf("specstride.launch/1"), reason: "resume" };

test("T002: a valid stop request of type stop passes (specstride.inbox/1)", () => {
  assert.equal(STOP_REQUEST_TYPE, "stop");
  const read = readStopRequest(STOP);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.record.type, "stop");
});

test("T002: an inbox request of another type is refused under the logical name inbox:stop", () => {
  const read = readStopRequest({ ...STOP, type: "hold-relaunch" });
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.ok(read.error instanceof RecordRefusedError);
    assert.equal(read.error.logicalName, STOP_LOGICAL_NAME);
    assert.match(read.error.message, /the type found is hold-relaunch/);
  }
});

test("T002: a different major is refused with the majors named (F100-FR-049)", () => {
  const read = readStopRequest({ ...STOP, schema: "specstride.inbox/2" });
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.match(read.error.message, /the major found is 2/);
    assert.match(read.error.message, /the major supported is 1/);
  }
});

test("T002: a valid run snapshot passes (specstride.snapshot/1)", () => {
  assert.equal(SNAPSHOT_SCHEMA_ID, "specstride.snapshot/1");
  assert.equal(readRunSnapshot(SNAPSHOT).ok, true);
  assert.equal(readRunSnapshot({ ...SNAPSHOT, schema: "specstride.snapshot/2" }).ok, false);
});

test("T002: a valid launch record passes (specstride.launch/1)", () => {
  assert.equal(LAUNCH_SCHEMA_ID, "specstride.launch/1");
  assert.equal(readLaunchRecord(LAUNCH).ok, true);
  assert.equal(readLaunchRecord({ ...LAUNCH, schema: "specstride.launch/9" }).ok, false);
});

test("T002: an absent, unreadable or empty stop request file is a clean stop (F102-FR-001)", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-control-102-"));
  // Absent.
  assert.deepEqual(readStopRequestFromFile(join(dir, "missing.json")), {
    clean: true,
    now: false,
    jobs: false,
  });
  // Empty: the empty request carries no field at all (F100-FR-065).
  const empty = join(dir, "empty.json");
  writeFileSync(empty, "");
  assert.deepEqual(readStopRequestFromFile(empty), { clean: true, now: false, jobs: false });
  // Unreadable.
  const unreadable = join(dir, "unreadable.json");
  writeFileSync(unreadable, "not json at all {{{");
  assert.deepEqual(readStopRequestFromFile(unreadable), { clean: true, now: false, jobs: false });
  // A valid request is read as a record, with `now` and `jobs` carried.
  const file = join(dir, "stop.json");
  writeFileSync(file, JSON.stringify(STOP));
  const read = readStopRequestFromFile(file);
  assert.equal(read.clean, false);
  if (!read.clean) assert.equal(read.request.now, true);
  // A malformed record is not smuggled past the reader as a request.
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ schema: "specstride.inbox/2", type: "stop" }));
  assert.deepEqual(readStopRequestFromFile(bad), { clean: true, now: false, jobs: false });
});
