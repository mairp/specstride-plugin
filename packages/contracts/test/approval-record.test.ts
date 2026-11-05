/**
 * T051 — contract tests CT-100-170 for approval record
 * (annex B, §B.14): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/approval-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isApprovalRecord,
  readApprovalRecord,
  tryReadApprovalRecord,
} from "../src/records/approval-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  APPROVALS_SURVIVE_RUNS,
  BINDINGS,
  INTEGRITY_EVENT,
  bindingsMatch,
  isApproved,
} from "../src/records/approval-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-170: a valid sample of approval-record passes (annex B, §B.14)", () => {
  assert.equal(SCHEMA_ID, "specstride.approval/1");
  assert.equal(LOGICAL_NAME, "gate:<N>:approved");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isApprovalRecord(sample));
  const record = readApprovalRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadApprovalRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-170: a different major of approval-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readApprovalRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadApprovalRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-170: an unknown field follows the rule of the schema (annex B, §B.14)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isApprovalRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isApprovalRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readApprovalRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-170: every required field of approval-record is required (annex B, §B.14)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isApprovalRecord(without), false, `${field} must be required`);
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

test("CT-100-170: the rules of the requirements of annex B, §B.14", () => {
  void readRecord;

  // F100-FR-070: the approval is bound to the verdict, the hash of the phase
  // evidence, the result of the verification gate and the tree fingerprint.
  assert.deepEqual([...BINDINGS], ["verdictId", "evidenceHash", "verification", "treeFingerprint"]);
  const bound = {
    ...sample,
    verdictId: "v-1",
    evidenceHash: "e-1",
    verification: { hash: "g-1" },
    treeFingerprint: "t-1",
  };
  const expected = {
    verdictId: "v-1",
    evidenceHash: "e-1",
    verificationHash: "g-1",
    treeFingerprint: "t-1",
  };
  assert.equal(bindingsMatch(bound as never, expected), true);
  for (const field of ["verdictId", "evidenceHash", "treeFingerprint"] as const) {
    assert.equal(bindingsMatch({ ...bound, [field]: "other" } as never, expected), false, field);
  }
  assert.equal(
    bindingsMatch({ ...bound, verification: { hash: "other" } } as never, expected),
    false,
  );
  // A record that fails, and a bare marker without a record, are not approved.
  assert.equal(isApproved(bound as never, true), true);
  assert.equal(isApproved(bound as never, false), false);
  assert.equal(isApproved(undefined, true), false, "a bare marker is not approved");
  assert.equal(INTEGRITY_EVENT, "integrity.approval-invalid");
  assert.equal(APPROVALS_SURVIVE_RUNS, true);
});
