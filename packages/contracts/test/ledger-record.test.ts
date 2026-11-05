/**
 * T049 — contract tests CT-100-168 and CT-100-169 for ledger record
 * (annex B, §B.13): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/ledger-record.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isLedgerRecord,
  readLedgerRecord,
  tryReadLedgerRecord,
} from "../src/records/ledger-record.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  A_BROKEN_LEDGER_STOPS_THE_RUN,
  CORE_COUNTERS,
  CORE_NAMESPACE,
  EFFECT_OF_A_BROKEN_LEDGER,
  LEDGER_KEY_IS_THE_APPROVAL_KEY,
  OSCILLATION_WINDOW_KEY,
  isChained,
  resetCounts,
} from "../src/records/ledger-record.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-168: a valid sample of ledger-record passes (annex B, §B.13)", () => {
  assert.equal(SCHEMA_ID, "specstride.ledger/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:ledger");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isLedgerRecord(sample));
  const record = readLedgerRecord(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadLedgerRecord(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-168: a different major of ledger-record is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readLedgerRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadLedgerRecord({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-168: an unknown field follows the rule of the schema (annex B, §B.13)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isLedgerRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isLedgerRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readLedgerRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-168: every required field of ledger-record is required (annex B, §B.13)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isLedgerRecord(without), false, `${field} must be required`);
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

test("CT-100-169: the rules of the requirements of annex B, §B.13", () => {
  void readRecord;

  // F100-FR-068: append-only, chained, signed with a key that is not the
  // approval key; a broken ledger never stops a run.
  assert.equal(LEDGER_KEY_IS_THE_APPROVAL_KEY, false);
  assert.equal(A_BROKEN_LEDGER_STOPS_THE_RUN, false);
  assert.equal(EFFECT_OF_A_BROKEN_LEDGER, "loop-layers-off-for-the-phase-attempt");
  assert.equal(CORE_NAMESPACE, "core");
  const hashOf = (r: { seq: number }) => `h${r.seq}`;
  const chain = [
    { ...sample, seq: 1, prev: "" },
    { ...sample, seq: 2, prev: "h1" },
    { ...sample, seq: 3, prev: "h2" },
  ] as never[];
  assert.equal(isChained(chain, hashOf as never), true);
  // Truncated, reordered and edited are all detected.
  assert.equal(isChained([chain[0], chain[2]] as never[], hashOf as never), false);
  assert.equal(isChained([chain[1], chain[0]] as never[], hashOf as never), false);
  assert.equal(
    isChained(
      [chain[0], { ...(chain[1] as object), prev: "tampered" }] as never[],
      hashOf as never,
    ),
    false,
  );
  // F100-FR-069: the counts that limit a run, and --reset-counts.
  assert.equal(CORE_COUNTERS.length, 6);
  assert.equal(OSCILLATION_WINDOW_KEY, "sequence-of-phase-attempts");
  const reset = resetCounts();
  for (const counter of CORE_COUNTERS) assert.equal(reset[counter], 0, counter);
});
