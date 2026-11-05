/**
 * T055 — contract tests CT-100-172 for supervision record
 * (annex B, §B.16): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/supervision-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isSupervisionRecord,
  readSupervisionRecord,
  tryReadSupervisionRecord,
} from "../src/records/supervision-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  FIELDS_REQUIRED_WITH_SUPERVISE_OWNER,
  WRITER,
  holdsRelaunchFields,
  requiresRelaunchFields,
} from "../src/records/supervision-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-172: a valid sample of supervision-record passes (annex B, §B.16)", () => {
  assert.equal(SCHEMA_ID, "specstride.supervision/1");
  assert.equal(LOGICAL_NAME, "launch:<launchId>:supervision");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isSupervisionRecord(sample));
  const record = readSupervisionRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadSupervisionRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-172: a different major of supervision-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readSupervisionRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadSupervisionRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-172: an unknown field follows the rule of the schema (annex B, §B.16)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isSupervisionRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(
      isSupervisionRecord(withExtra),
      `the reader ignores a field it does not know: ${rule}`,
    );
    assert.doesNotThrow(() => readSupervisionRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-172: every required field of supervision-record is required (annex B, §B.16)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isSupervisionRecord(without), false, `${field} must be required`);
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

test("CT-100-172: the rules of the requirements of annex B, §B.16", () => {
  void readRecord;

  // F100-FR-072: the CLI writes it, and with `relaunch.owner: supervise` it
  // holds the relaunch budget and the list of relaunches.
  assert.equal(WRITER, "CLI");
  assert.equal(requiresRelaunchFields("supervise"), true);
  assert.equal(requiresRelaunchFields("root"), false);
  assert.equal(holdsRelaunchFields(sample as never), false);
  assert.equal(
    holdsRelaunchFields({ ...sample, relaunchBudget: {}, relaunches: [] } as never),
    true,
  );
  assert.deepEqual([...FIELDS_REQUIRED_WITH_SUPERVISE_OWNER], ["relaunchBudget", "relaunches"]);
});
