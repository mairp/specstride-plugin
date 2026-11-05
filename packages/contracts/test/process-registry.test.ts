/**
 * T043 — contract tests CT-100-163 and CT-100-164 for process registry
 * (annex B, §B.10): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/process-registry.schema.json" with { type: "json" };
import {
  LOGICAL_NAME,
  SCHEMA_ID,
  isProcessRegistry,
  readProcessRegistry,
  tryReadProcessRegistry,
} from "../src/records/process-registry.ts";
import { readRecord, RecordRefusedError } from "../src/records/validate.ts";
import {
  ADOPTABLE_NEVER_REPORTS,
  PROCESS_CLASSES,
  PROCESS_KINDS,
  classIsAllowed,
  classOfKind,
  mayBeSignalled,
  survivesStop,
} from "../src/records/process-registry.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-163: a valid sample of process-registry passes (annex B, §B.10)", () => {
  assert.equal(SCHEMA_ID, "specstride.procs/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:procs");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isProcessRegistry(sample));
  const record = readProcessRegistry(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  const result = tryReadProcessRegistry(sample, LOGICAL_NAME);
  assert.equal(result.ok, true);
});

test("CT-100-163: a different major of process-registry is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readProcessRegistry({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadProcessRegistry({ ...sample, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-163: an unknown field follows the rule of the schema (annex B, §B.10)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isProcessRegistry(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isProcessRegistry(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readProcessRegistry(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-163: every required field of process-registry is required (annex B, §B.10)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0, "the schema names required fields");
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isProcessRegistry(without), false, `${field} must be required`);
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

test("CT-100-164: the rules of the requirements of annex B, §B.10", () => {
  void readRecord;

  // F100-FR-063: the classes and the seven kinds.
  assert.deepEqual([...PROCESS_CLASSES], ["owned", "adoptable"]);
  assert.equal(PROCESS_KINDS.length, 7);
  for (const kind of [
    "harness-pass",
    "critic-call",
    "check",
    "stage-child",
    "worker-pass",
  ] as const) {
    assert.equal(classOfKind(kind), "owned", kind);
  }
  assert.equal(classOfKind("detached-job"), "adoptable");
  // No process of a worker is ever adoptable.
  assert.equal(classIsAllowed("worker-pass", "adoptable"), false);
  assert.equal(classIsAllowed("worker-pass", "owned"), true);
  // F100-FR-064: a signal only after pid, start time and run token match.
  const entry = { ...sample, class: "owned", pid: 42, startTime: "t", runTokenHash: "h" };
  assert.equal(
    mayBeSignalled(entry as never, { pid: 42, startTime: "t", runTokenHash: "h" }),
    true,
  );
  assert.equal(
    mayBeSignalled(entry as never, { pid: 43, startTime: "t", runTokenHash: "h" }),
    false,
  );
  assert.equal(
    mayBeSignalled(entry as never, { pid: 42, startTime: "u", runTokenHash: "h" }),
    false,
  );
  assert.equal(
    mayBeSignalled(entry as never, { pid: 42, startTime: "t", runTokenHash: "g" }),
    false,
  );
  assert.equal(
    mayBeSignalled({ ...entry, class: "adoptable" } as never, {
      pid: 42,
      startTime: "t",
      runTokenHash: "h",
    }),
    false,
  );
  assert.equal(survivesStop({ ...entry, class: "adoptable" } as never), true);
  assert.equal(survivesStop(entry as never), false);
  assert.equal(ADOPTABLE_NEVER_REPORTS, "owner-dead-group-alive");
});
