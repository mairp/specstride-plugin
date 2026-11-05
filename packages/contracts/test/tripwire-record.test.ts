/**
 * T059 — contract tests CT-100-174 for tripwire record
 * (annex B, §B.18): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/tripwire-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isTripwireRecord,
  readTripwireRecord,
  tryReadTripwireRecord,
} from "../src/records/tripwire-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  CLEARED_BY,
  CLEARING_EVENT,
  EFFECT_WHILE_IT_EXISTS,
  THE_ONLY_RUNTIME_WRITE_TO_USER_STATE,
  loopLayersAreOff,
} from "../src/records/tripwire-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-174: a valid sample of tripwire-record passes (annex B, §B.18)", () => {
  assert.equal(SCHEMA_ID, "specstride.tripwire/1");
  assert.equal(LOGICAL_NAME, "user:tripwire");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isTripwireRecord(sample));
  const record = readTripwireRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadTripwireRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-174: a different major of tripwire-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readTripwireRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadTripwireRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-174: an unknown field follows the rule of the schema (annex B, §B.18)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isTripwireRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isTripwireRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readTripwireRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-174: every required field of tripwire-record is required (annex B, §B.18)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isTripwireRecord(without), false, `${field} must be required`);
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

test("CT-100-174: the rules of the requirements of annex B, §B.18", () => {
  void readRecord;

  // F100-FR-074: while the record exists every run on the machine runs with
  // every loop layer off, until the operator clears it by a command.
  assert.equal(EFFECT_WHILE_IT_EXISTS, "every-loop-layer-off-announced");
  assert.equal(loopLayersAreOff(true), true);
  assert.equal(loopLayersAreOff(false), false);
  assert.match(CLEARED_BY, /command/);
  assert.equal(CLEARING_EVENT, "integrity.tripwire-cleared");
  // It is the only write the runtime makes to user-level state.
  assert.equal(THE_ONLY_RUNTIME_WRITE_TO_USER_STATE, "user:tripwire");
  assert.equal(LOGICAL_NAME, THE_ONLY_RUNTIME_WRITE_TO_USER_STATE);
});
