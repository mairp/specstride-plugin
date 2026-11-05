/**
 * T057 — contract tests CT-100-173 for pause record
 * (annex B, §B.17): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/pause-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isPauseRecord,
  readPauseRecord,
  tryReadPauseRecord,
} from "../src/records/pause-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  PAUSE_RECORDS_PER_RUN,
  REMAINING_WAIT_COMES_FROM_A_TIMER,
  STATE_WITH_A_PAUSE_RECORD,
  remainingWaitSeconds,
  shouldExist,
} from "../src/records/pause-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-173: a valid sample of pause-record passes (annex B, §B.17)", () => {
  assert.equal(SCHEMA_ID, "specstride.pause/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:pause");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isPauseRecord(sample));
  const record = readPauseRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadPauseRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-173: a different major of pause-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readPauseRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadPauseRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-173: an unknown field follows the rule of the schema (annex B, §B.17)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isPauseRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isPauseRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readPauseRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-173: every required field of pause-record is required (annex B, §B.17)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isPauseRecord(without), false, `${field} must be required`);
  }
  // Each required field has a row of the annex: a meaning and a type in words.
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field], undefined, field);
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
});

test("CT-100-173: the rules of the requirements of annex B, §B.17", () => {
  void readRecord;

  // F100-FR-073: one per run, exactly while the run is `paused-quota`, and
  // the remaining wait comes from the record and never from a timer.
  assert.equal(STATE_WITH_A_PAUSE_RECORD, "paused-quota");
  assert.equal(PAUSE_RECORDS_PER_RUN, 1);
  assert.equal(shouldExist("paused-quota"), true);
  assert.equal(shouldExist("running"), false);
  assert.equal(REMAINING_WAIT_COMES_FROM_A_TIMER, false);
  const now = new Date("2026-01-01T00:00:00.000Z");
  const record = {
    ...sample,
    resumeAt: "2026-01-01T00:01:00.000Z",
    ceilingAt: "2026-01-01T00:05:00.000Z",
  };
  assert.equal(remainingWaitSeconds(record as never, now), 60);
  // The ceiling wins when it is nearer.
  assert.equal(
    remainingWaitSeconds({ ...record, ceilingAt: "2026-01-01T00:00:30.000Z" } as never, now),
    30,
  );
  // A null `resumeAt` falls back to the ceiling.
  assert.equal(remainingWaitSeconds({ ...record, resumeAt: null } as never, now), 300);
});
