/**
 * T063 — contract tests CT-100-298, CT-100-299 and CT-100-300 for the event
 * envelope and versioning (annex X, §X.1; F100-FR-198, F100-FR-199,
 * F100-FR-200): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/event-envelope.schema.json" with { type: "json" };
import {
  AN_EVENT_HOLDS_CONTENT,
  CHANGES_INSIDE_A_MAJOR_ARE_ADDITIVE,
  CONTENT_REFERENCE_FIELDS,
  LIVENESS_IS_AN_EVENT,
  LOGICAL_NAME,
  MAJOR,
  NULL_WHERE_UNKNOWN,
  SCHEMA,
  SCHEMA_ID,
  STRATEGIES,
  STRATEGY_WITH_PARALLEL_UNITS_ON,
  SUPPORTED_MAJORS,
  SYNTHESIZED_FIELD,
  THIRD_PARTY_PREFIX,
  WORKER_FIELDS,
  isEventEnvelope,
  isThirdPartyType,
  majorIsSupported,
  outsideRange,
  readEventLine,
  seqIsWellFormed,
  unclosed,
} from "../src/envelope/event.ts";
import { holdsLogicalName } from "../src/ids/logical-names.ts";
import { requiredOf, sampleOf } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-298: a valid event carries the envelope with typed values (F100-FR-198)", () => {
  assert.equal(SCHEMA, "specstride.event");
  assert.equal(SCHEMA_ID, "specstride.event/1");
  assert.equal(MAJOR, 1);
  assert.ok(holdsLogicalName(LOGICAL_NAME));
  assert.equal(sample.schema, SCHEMA);
  assert.equal(sample.v, 1);
  assert.ok(isEventEnvelope(sample));
  const read = readEventLine(JSON.stringify(sample));
  assert.equal(read.ok, true);
  // `seq` is given by the one writer at the append: rising, without gaps.
  assert.equal(seqIsWellFormed([{ seq: 1 }, { seq: 2 }, { seq: 3 }]), true);
  assert.equal(seqIsWellFormed([{ seq: 1 }, { seq: 3 }]), false);
  assert.equal(seqIsWellFormed([{ seq: 2 }, { seq: 1 }]), false);
  // `workerId` and `wseq` are absent on the main line.
  assert.deepEqual([...WORKER_FIELDS], ["workerId", "wseq"]);
  for (const field of WORKER_FIELDS) {
    assert.equal(field in sample, false, `${field} is absent on the main line`);
  }
  // A run with parallel units on still records `strategy` as `micro`.
  assert.deepEqual([...STRATEGIES], ["classic", "micro"]);
  assert.equal(STRATEGY_WITH_PARALLEL_UNITS_ON, "micro");
  // null for an unknown value; absence for a value that does not apply. The
  // annex states the three fields that carry null where the value is unknown
  // in their type in words ("Text, or null"), and marks them not required, so
  // that a value that does not apply is absent.
  //
  // Noted: the schema file that the generator of the specification writes
  // types these three `"type": "string"` and so would refuse a literal null.
  // The annex stands (contracts/README.md), and this test binds the annex:
  // the type in words and the required cell, which the schema carries as
  // `x-type-in-words` and `x-required`.
  const properties = (
    schema as {
      properties: Record<string, { "x-type-in-words"?: string; "x-required"?: string }>;
    }
  ).properties;
  for (const field of NULL_WHERE_UNKNOWN) {
    assert.match(String(properties[field]?.["x-type-in-words"]), /or null/, field);
    assert.equal(String(properties[field]?.["x-required"]), "No", `${field} may be absent`);
    assert.ok(isEventEnvelope(sample), `${field} may be absent`);
  }
});

test("CT-100-299: every required field is required and a different major is refused (F100-FR-199)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0);
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isEventEnvelope(without), false, `${field} must be required`);
  }
  // The reader declares the range of majors it accepts.
  assert.deepEqual({ ...SUPPORTED_MAJORS }, { from: 1, to: 1 });
  assert.equal(majorIsSupported(1), true);
  assert.equal(majorIsSupported(2), false);
  const outside = readEventLine(JSON.stringify({ ...sample, v: 2 }));
  assert.equal(outside.ok, false);
  if (!outside.ok && outside.reason === "outside-range") {
    // A doctor warning, never a failure of a run.
    assert.equal(outside.outcome.doctorWarning, true);
    assert.equal(outside.outcome.failsTheRun, false);
    assert.match(outside.outcome.message, /this reader declares the majors 1 to 1/);
  } else {
    assert.fail("an event outside the range is reported as such");
  }
  assert.equal(outsideRange(9).failsTheRun, false);
  // A change inside a major is additive; a reader ignores a field and an
  // event type it does not know.
  assert.equal(CHANGES_INSIDE_A_MAJOR_ARE_ADDITIVE, true);
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  assert.match(rule, /ignored/i);
  assert.ok(isEventEnvelope({ ...sample, aFieldOfALaterMinor: 1 }));
  assert.ok(isEventEnvelope({ ...sample, type: "an.unknown.type" }));
  // A torn last line is tolerated.
  const torn = readEventLine('{"schema":"specstride.event","v":1,"se', true);
  assert.equal(torn.ok, false);
  if (!torn.ok && torn.reason === "torn") assert.equal(torn.tolerated, true);
  else assert.fail("a torn last line is tolerated");
  // A torn line that is not the last is not tolerated.
  assert.equal(readEventLine("{oops", false).ok, false);
  // Event types that start with `x.` are free for third parties.
  assert.equal(THIRD_PARTY_PREFIX, "x.");
  assert.equal(isThirdPartyType("x.someone.did"), true);
  assert.equal(isThirdPartyType("pass.started"), false);
});

test("CT-100-300: an event holds no content, liveness is never an event, and every opening has a closing (F100-FR-200)", () => {
  assert.equal(AN_EVENT_HOLDS_CONTENT, false);
  assert.deepEqual([...CONTENT_REFERENCE_FIELDS], ["logicalName", "hash", "size"]);
  assert.equal(LIVENESS_IS_AN_EVENT, false);
  // The `data` field of the annex says it holds no prompt, no reply, no body
  // of a tool argument and no output of a command.
  const data = (schema as { properties: Record<string, { description?: string }> }).properties.data;
  assert.match(String(data?.description), /holds no prompt/);
  // Every event that opens something has a matching event that closes it.
  const pairs = { "pass.started": "pass.ended" };
  assert.deepEqual([...unclosed([{ type: "pass.started" }, { type: "pass.ended" }], pairs)], []);
  assert.deepEqual([...unclosed([{ type: "pass.started" }], pairs)], ["pass.started"]);
  // Where a process died before it could write the closing event, the next
  // writer writes it, marked as synthesized.
  assert.equal(SYNTHESIZED_FIELD, "synthesized");
});
