/**
 * T035 — contract tests CT-100-159 for workspace record
 * (annex B, §B.6): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/workspace-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isWorkspaceRecord,
  readWorkspaceRecord,
  tryReadWorkspaceRecord,
} from "../src/records/workspace-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  COMMANDS_NAMED_ON_TICKED_PHASE_WITHOUT_APPROVAL,
  lockProviderMatches,
  refusalForTickedPhasesWithoutApproval,
} from "../src/records/workspace-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-159: a valid sample of workspace-record passes (annex B, §B.6)", () => {
  assert.equal(SCHEMA_ID, "specstride.layout/1");
  assert.equal(LOGICAL_NAME, "workspace:record");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isWorkspaceRecord(sample));
  const record = readWorkspaceRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadWorkspaceRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-159: a different major of workspace-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readWorkspaceRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadWorkspaceRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-159: an unknown field follows the rule of the schema (annex B, §B.6)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isWorkspaceRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isWorkspaceRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readWorkspaceRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-159: every required field of workspace-record is required (annex B, §B.6)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isWorkspaceRecord(without), false, `${field} must be required`);
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

test("CT-100-159: the rules of the requirements of annex B, §B.6", () => {
  void readRecord;

  // F100-FR-059: a launch whose lock provider differs is refused, and a
  // ticked phase without an approval record names the three commands.
  assert.equal(
    lockProviderMatches({ ...sample, lockProvider: { id: "flock", version: "1" } } as never, {
      id: "flock",
      version: "1",
    }),
    true,
  );
  assert.equal(
    lockProviderMatches({ ...sample, lockProvider: { id: "flock", version: "1" } } as never, {
      id: "other",
      version: "1",
    }),
    false,
  );
  assert.equal(refusalForTickedPhasesWithoutApproval([1, 2], [1, 2]), undefined);
  const refusal = refusalForTickedPhasesWithoutApproval([1, 2, 3], [1]);
  assert.match(String(refusal), /state export/);
  assert.match(String(refusal), /state import/);
  assert.match(String(refusal), /state adopt/);
  assert.deepEqual(
    [...COMMANDS_NAMED_ON_TICKED_PHASE_WITHOUT_APPROVAL],
    ["state export", "state import", "state adopt"],
  );
});
