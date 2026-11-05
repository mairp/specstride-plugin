/**
 * T053 — contract tests CT-100-171 for terminal record
 * (annex B, §B.15): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/terminal-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isTerminalRecord,
  readTerminalRecord,
  tryReadTerminalRecord,
} from "../src/records/terminal-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  CAUSED_BY,
  CAUSES,
  CAUSE_ON_UNKNOWN,
  FIXED_FIELDS,
  READERS_MATCH_STOP_REASON_BY_STRING_IN_THE_EVENT_FILE,
  synthesizedRecord,
} from "../src/records/terminal-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-171: a valid sample of terminal-record passes (annex B, §B.15)", () => {
  assert.equal(SCHEMA_ID, "specstride.terminal/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:terminal");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isTerminalRecord(sample));
  const record = readTerminalRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadTerminalRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-171: a different major of terminal-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readTerminalRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadTerminalRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-171: an unknown field follows the rule of the schema (annex B, §B.15)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isTerminalRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isTerminalRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readTerminalRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-171: every required field of terminal-record is required (annex B, §B.15)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isTerminalRecord(without), false, `${field} must be required`);
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

test("CT-100-171: the rules of the requirements of annex B, §B.15", () => {
  void readRecord;

  // F100-FR-071: the five fixed fields, and the synthesized record.
  assert.deepEqual([...FIXED_FIELDS], ["exitCode", "stopReason", "retryable", "cause", "causedBy"]);
  assert.deepEqual([...CAUSES], ["normal", "crash", "owner-lost"]);
  assert.deepEqual([...CAUSED_BY], ["self", "operator", "supervisor", "host", "crash"]);
  assert.equal(CAUSE_ON_UNKNOWN, "crash");
  assert.equal(READERS_MATCH_STOP_REASON_BY_STRING_IN_THE_EVENT_FILE, false);
  const synthesized = synthesizedRecord({
    exitCode: 70,
    runId: "r",
    launchId: "l",
    engineStartId: "e",
    at: "2026-09-30T00:00:00.000Z",
  });
  assert.equal((synthesized as unknown as { synthesized: boolean }).synthesized, true);
  assert.equal((synthesized as unknown as { cause: string }).cause, "crash");
  assert.equal((synthesized as unknown as { retryable: boolean }).retryable, false);
  // The synthesized record itself validates and carries its schema id.
  assert.doesNotThrow(() => readRecord(LOGICAL_NAME, synthesized));
});
