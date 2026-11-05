/**
 * T041 — contract tests CT-100-162 for the owner record (annex B, §B.9): a
 * valid sample passes, a different major is refused, an unknown field follows
 * the rule of the schema, and every required field is required.
 *
 * The owner record is no file of its own: it is part of the lease
 * (`specstride.lease/1`), of the lock and of the advisory marker, so its
 * schema id is `specstride.lease/1:owner` and it carries no field `schema`
 * itself. It is read through the record that holds it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/owner-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isOwnerRecord,
  OWNER_RECORD_IS_PART_OF,
  lockHasOwner,
} from "../src/records/owner-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import { validate } from "../src/records/compile.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);
const LEASE_ID = "specstride.lease/1";

test("CT-100-162: a valid sample of the owner record passes (annex B, §B.9)", () => {
  assert.equal(SCHEMA_ID, "specstride.lease/1:owner");
  assert.equal(LOGICAL_NAME, "(part of the lease, the lock and the advisory marker)");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isOwnerRecord(sample));
  // It is read through the record that holds it: the lease of §B.8.
  const lease = { ...sampleOf(LEASE_ID), owner: sample };
  assert.doesNotThrow(() => readRecord("run:<runId>:lease", lease));
});

test("CT-100-162: a different major is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(LEASE_ID);
  assert.throws(
    () => readRecord("run:<runId>:lease", { ...sampleOf(LEASE_ID), owner: sample, schema: next }),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  // The part itself has no validator of another major either.
  assert.equal(validate(`${SCHEMA_ID}x`, sample).ok, false);
});

test("CT-100-162: an unknown field follows the rule of the schema (annex B, §B.9)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  assert.match(rule, /ignored by a reader/);
  assert.ok(isOwnerRecord({ ...sample, aFieldAWriterOfALaterMinorAdded: 1 }));
});

test("CT-100-162: every required field of the owner record is required (annex B, §B.9)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    [
      "pid",
      "processGroup",
      "startTime",
      "bootId",
      "hostName",
      "pidNamespace",
      "launchId",
      "runTokenHash",
    ],
  );
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isOwnerRecord(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
});

test("CT-100-162: the rules of the requirements of annex B, §B.9 (F100-FR-062)", () => {
  assert.deepEqual([...OWNER_RECORD_IS_PART_OF], ["lease", "lock", "advisory marker"]);
  // A lock never exists without an owner record.
  assert.equal(lockHasOwner({ owner: sample }), true);
  assert.equal(lockHasOwner({}), false);
});
