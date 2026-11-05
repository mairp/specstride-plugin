/**
 * T179 — contract tests CT-100-237 for the check manifest (annex D, §D.8): a
 * valid sample passes, a different major is refused, an unknown field follows
 * the rule of the schema, and every required field is required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/check-manifest.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  AN_ENTRY_MAY_BE_ADDED_AFTER_LAUNCH,
  CONTENT_OWNER,
  DERIVED_AT,
  DERIVED_FROM,
  DETERMINISTIC_COMMANDS_ONLY,
  HASH_VERIFIED_BEFORE_EVERY_CHECK,
  INNER_IS_TRUE_FOR_EVERY_ENTRY,
  KIND_THAT_REQUIRES_ARGV,
  LOGICAL_NAME,
  ONE_PER_PHASE,
  ONLY_THE_RUNTIME_EXCLUDES,
  PARITY_ROWS,
  READERS,
  ROUTER_MAY,
  SCHEMA_ID,
  STORED_IN,
  STORED_WITH_ITS_HASH,
  UNDECLARED_MEANS_SERIAL,
  WRITTEN_WHEN_A_SWITCH_OF_THESE_ROWS_IS_ON,
  argvIsRequired,
  isCheckManifest,
  manifestIsWritten,
  readCheckManifest,
  tryReadCheckManifest,
} from "../src/records/check-manifest.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-237: a valid sample of the check manifest passes (annex D, §D.8)", () => {
  assert.equal(SCHEMA_ID, "specstride.manifest/1");
  assert.equal(LOGICAL_NAME, "phase:<N>:manifest");
  assert.equal(ANNEX_SECTION, "annex D, §D.8");
  assert.equal(CONTENT_OWNER, "105");
  assert.deepEqual(
    [...READERS],
    ["Engine", "check runner", "router (decision point `tools`)", "fact block", "doctor"],
  );
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isCheckManifest(sample));
  assert.deepEqual(readCheckManifest(sample, LOGICAL_NAME), sample);
  assert.equal(tryReadCheckManifest(sample, LOGICAL_NAME).ok, true);
});

test("CT-100-237: a different major of the check manifest is refused with both majors", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readCheckManifest({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadCheckManifest({ ...sample, schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-237: an unknown field follows the rule of the schema (annex D, §D.8)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldANewMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isCheckManifest(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isCheckManifest(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readCheckManifest(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-237: every required field of the check manifest is required (annex D, §D.8)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual([...required], ["schema", "phase", "hash", "searchPath", "entries"]);
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isCheckManifest(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<
        string,
        {
          description?: string;
          "x-type-in-words"?: string;
          items?: { required?: string[]; properties?: Record<string, unknown> };
        }
      >;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field], undefined, field);
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
  // Every required cell of `entries[]` of §D.8.
  const entry = properties["entries"]?.items;
  assert.deepEqual([...(entry?.required ?? [])].sort(), [
    "id",
    "inner",
    "kind",
    "pin",
    "provenance",
    "timeLimit",
  ]);
  // `argv` is required for the kind `command` and optional otherwise.
  assert.equal(KIND_THAT_REQUIRES_ARGV, "command");
  assert.equal(argvIsRequired("command"), true);
  assert.equal(argvIsRequired("step-runner"), false);
  assert.equal(UNDECLARED_MEANS_SERIAL, true);
});

test("CT-100-237: F100-FR-137 — when the manifest is written, and its rules", () => {
  assert.equal(ONE_PER_PHASE, true);
  assert.equal(DERIVED_AT, "launch");
  assert.equal(DERIVED_FROM, "the sources the verification gate uses, and nothing else");
  assert.equal(STORED_IN, "the control plane");
  assert.equal(STORED_WITH_ITS_HASH, true);
  assert.equal(HASH_VERIFIED_BEFORE_EVERY_CHECK, true);
  assert.equal(DETERMINISTIC_COMMANDS_ONLY, true);
  assert.deepEqual([...ROUTER_MAY], ["order", "exclude"]);
  assert.equal(AN_ENTRY_MAY_BE_ADDED_AFTER_LAUNCH, false);
  assert.equal(INNER_IS_TRUE_FOR_EVERY_ENTRY, true);
  assert.equal(ONLY_THE_RUNTIME_EXCLUDES, true);
  assert.deepEqual([...WRITTEN_WHEN_A_SWITCH_OF_THESE_ROWS_IS_ON], [6, 7, 31, 33]);
  assert.deepEqual([...PARITY_ROWS], [1, 6, 7, 31, 33]);

  // A strategy other than `classic` writes a manifest.
  assert.equal(manifestIsWritten({ strategy: "micro" }), true);
  // `classic` writes one only when a switch of rows 6, 7, 31 or 33 is on.
  assert.equal(manifestIsWritten({ strategy: "classic" }), false);
  assert.equal(manifestIsWritten({ strategy: "classic", switchesOn: [7] }), true);
  assert.equal(manifestIsWritten({ strategy: "classic", switchesOn: [2] }), false);
  // Never under the `parity` profile.
  assert.equal(manifestIsWritten({ strategy: "micro", profile: "parity" }), false);
  assert.equal(
    manifestIsWritten({ strategy: "classic", switchesOn: [6], profile: "parity" }),
    false,
  );
});
