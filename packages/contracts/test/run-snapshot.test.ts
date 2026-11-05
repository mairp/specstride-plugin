/**
 * T047 — contract tests CT-100-166 and CT-100-167 for run snapshot
 * (annex B, §B.12): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/run-snapshot.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isRunSnapshot,
  readRunSnapshot,
  tryReadRunSnapshot,
} from "../src/records/run-snapshot.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  CHECK_POINTS,
  CHECK_POINTS_UNDER_PARITY,
  FAILED_SNAPSHOT_WRITE_IS_A_LAUNCH_ERROR,
  KEY_CLASSES,
  KEY_CLASS_DEFAULT,
  PINNED_SOURCES,
  hashComparedFor,
  snapshotRankOnResume,
} from "../src/records/run-snapshot.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-166: a valid sample of run-snapshot passes (annex B, §B.12)", () => {
  assert.equal(SCHEMA_ID, "specstride.snapshot/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:snapshot");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isRunSnapshot(sample));
  const record = readRunSnapshot(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadRunSnapshot(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-166: a different major of run-snapshot is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readRunSnapshot({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadRunSnapshot({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-166: an unknown field follows the rule of the schema (annex B, §B.12)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isRunSnapshot(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isRunSnapshot(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readRunSnapshot(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-166: every required field of run-snapshot is required (annex B, §B.12)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isRunSnapshot(without), false, `${field} must be required`);
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

test("CT-100-167: the rules of the requirements of annex B, §B.12", () => {
  void readRecord;

  // F100-FR-066: the key classes, and the place of each on `resume`.
  assert.deepEqual([...KEY_CLASSES], ["pinned", "tunable"]);
  assert.equal(KEY_CLASS_DEFAULT, "pinned");
  // A pinned key ranks below flags (2) and above the environment (4).
  assert.ok(snapshotRankOnResume("pinned") > 2);
  assert.ok(snapshotRankOnResume("pinned") < 4);
  // A tunable key ranks below the environment (4).
  assert.ok(snapshotRankOnResume("tunable") > 4);
  assert.equal(FAILED_SNAPSHOT_WRITE_IS_A_LAUNCH_ERROR, true);
  // F100-FR-067: the three check points, the task-list hash, the profile.
  assert.deepEqual([...PINNED_SOURCES], ["spec", "plan", "tasks"]);
  assert.deepEqual([...CHECK_POINTS], ["launch", "resume", "pass-start"]);
  assert.deepEqual([...CHECK_POINTS_UNDER_PARITY], ["critic-start"]);
  assert.equal(hashComparedFor("tasks"), "hashIgnoringCheckboxes");
  assert.equal(hashComparedFor("spec"), "contentHash");
  assert.equal(hashComparedFor("plan"), "contentHash");
});
