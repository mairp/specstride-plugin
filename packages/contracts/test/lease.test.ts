/**
 * T039 — contract tests CT-100-161 for lease
 * (annex B, §B.8): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/lease.schema.json" with { type: "json" };
import { LOGICAL_NAME, SCHEMA_ID, isLease, readLease, tryReadLease } from "../src/records/lease.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  DERIVED_CONDITIONS,
  LIVENESS_IS_AN_EVENT,
  derivedCondition,
  statusLineIsStale,
} from "../src/records/lease.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-161: a valid sample of lease passes (annex B, §B.8)", () => {
  assert.equal(SCHEMA_ID, "specstride.lease/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:lease");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isLease(sample));
  const record = readLease(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadLease(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-161: a different major of lease is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readLease({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadLease({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-161: an unknown field follows the rule of the schema (annex B, §B.8)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isLease(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isLease(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readLease(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-161: every required field of lease is required (annex B, §B.8)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isLease(without), false, `${field} must be required`);
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

test("CT-100-161: the rules of the requirements of annex B, §B.8", () => {
  void readRecord;

  // F100-FR-061: liveness is read from the lease and is never an event.
  assert.equal(LIVENESS_IS_AN_EVENT, false);
  assert.deepEqual([...DERIVED_CONDITIONS], ["dead", "stale", "launch-abandoned"]);
  assert.equal(
    derivedCondition({
      runStateIsLive: true,
      ownerIsLive: false,
      heartbeatIsOld: false,
      newestEventIsOld: false,
    }),
    "dead",
  );
  assert.equal(
    derivedCondition({
      runStateIsLive: true,
      ownerIsLive: true,
      heartbeatIsOld: true,
      newestEventIsOld: true,
    }),
    "stale",
  );
  assert.equal(
    derivedCondition({
      runStateIsLive: true,
      ownerIsLive: true,
      heartbeatIsOld: true,
      newestEventIsOld: false,
    }),
    undefined,
  );
  // After `validUntil` a precomputed status line is stale.
  const lease = { ...sample, validUntil: "2026-01-01T00:00:00.000Z" };
  assert.equal(statusLineIsStale(lease as never, new Date("2026-01-01T00:00:01.000Z")), true);
  assert.equal(statusLineIsStale(lease as never, new Date("2025-12-31T23:59:59.000Z")), false);
});
