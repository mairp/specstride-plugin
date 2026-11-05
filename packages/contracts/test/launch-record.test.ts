/**
 * T037 — contract tests CT-100-160 for launch record
 * (annex B, §B.7): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/launch-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isLaunchRecord,
  readLaunchRecord,
  tryReadLaunchRecord,
} from "../src/records/launch-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  DERIVED_CONDITION_ABANDONED,
  MODES_THAT_WRITE_A_LAUNCH_RECORD,
  isAbandoned,
} from "../src/records/launch-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-160: a valid sample of launch-record passes (annex B, §B.7)", () => {
  assert.equal(SCHEMA_ID, "specstride.launch/1");
  assert.equal(LOGICAL_NAME, "launch:<launchId>:record");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isLaunchRecord(sample));
  const record = readLaunchRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadLaunchRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-160: a different major of launch-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readLaunchRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadLaunchRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-160: an unknown field follows the rule of the schema (annex B, §B.7)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isLaunchRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isLaunchRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readLaunchRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-160: every required field of launch-record is required (annex B, §B.7)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isLaunchRecord(without), false, `${field} must be required`);
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

test("CT-100-160: the rules of the requirements of annex B, §B.7", () => {
  void readRecord;

  // F100-FR-060: a launch record older than the handshake limit with no
  // outcome and no lease with its nonce is derived as `launch-abandoned`.
  assert.equal(DERIVED_CONDITION_ABANDONED, "launch-abandoned");
  const old = { ...sample, createdAt: "2026-01-01T00:00:00.000Z" };
  const now = new Date("2026-01-01T01:00:00.000Z");
  assert.equal(isAbandoned(old as never, now, 60, false), true);
  assert.equal(isAbandoned(old as never, now, 60, true), false, "a lease with its nonce exists");
  assert.equal(
    isAbandoned({ ...old, outcome: "started" } as never, now, 60, false),
    false,
    "the handshake ended",
  );
  // The mode `dry-run` writes no launch record.
  assert.deepEqual([...MODES_THAT_WRITE_A_LAUNCH_RECORD], ["run"]);
});
