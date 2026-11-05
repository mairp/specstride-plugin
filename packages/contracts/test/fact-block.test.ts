/**
 * T177 — contract tests CT-100-235 and CT-100-236 for the fact block (annex D,
 * §D.7): a valid sample passes, a different major is refused, an unknown field
 * follows the rule of the schema, and every required field is required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/fact-block.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  AT_PHASE_ENTRY,
  CALL_POINT,
  CONTENT_OWNER,
  COUNTS_SHOWN,
  FILE_MODIFICATION_TIMES_STAY_IN,
  LOGICAL_NAME,
  NEVER_IN_THE_BLOCK,
  NOTICE,
  ON_AN_UNAUTHORISED_PROTECTED_CHANGE,
  PARITY_ROW,
  SCHEMA_ID,
  SLOT_AND_ESCAPING_OWNER,
  TEST_COUNTS_SHOWN_IN_WAVE_1,
  TREATMENT_OF_WORKSPACE_TEXT,
  UNIT_CONDITIONS,
  blockIsPresent,
  isFactBlock,
  mayBeInTheBlock,
  readFactBlock,
  tryReadFactBlock,
} from "../src/records/fact-block.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-235: a valid sample of the fact block passes (annex D, §D.7)", () => {
  assert.equal(SCHEMA_ID, "specstride.fact-block/1");
  assert.equal(LOGICAL_NAME, "attempt:<N>:<k>:<n>:fact-block");
  assert.equal(ANNEX_SECTION, "annex D, §D.7");
  assert.equal(CONTENT_OWNER, "116");
  assert.equal(SLOT_AND_ESCAPING_OWNER, "117");
  assert.equal(CALL_POINT, "contributeCriticInput");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isFactBlock(sample));
  assert.deepEqual(readFactBlock(sample, LOGICAL_NAME), sample);
  assert.equal(tryReadFactBlock(sample, LOGICAL_NAME).ok, true);
});

test("CT-100-235: a different major of the fact block is refused with both majors", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readFactBlock({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadFactBlock({ ...sample, schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-235: an unknown field follows the rule of the schema (annex D, §D.7)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldANewMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isFactBlock(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isFactBlock(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readFactBlock(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-235: every required field of the fact block is required (annex D, §D.7)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    [
      "schema",
      "manifestHash",
      "commands",
      "treeFingerprint",
      "units",
      "unnamedTasks",
      "notice",
      "protected",
      "integrity",
      "facts",
      "excluded",
    ],
    "the eleven required rows of the table of §D.7",
  );
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isFactBlock(without), false, `${field} must be required`);
  }
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

test("CT-100-235: the block is present only when §D.7 says it is", () => {
  assert.equal(blockIsPresent({ unitsDeclared: 0, layerIndependentIntegrityFact: false }), false);
  assert.equal(blockIsPresent({ unitsDeclared: 1, layerIndependentIntegrityFact: false }), true);
  assert.equal(blockIsPresent({ unitsDeclared: 0, layerIndependentIntegrityFact: true }), true);
});

test("CT-100-235: F100-FR-135 — nothing of the list of what is never in the block", () => {
  assert.equal(NEVER_IN_THE_BLOCK.length, 11, "the eleven items of the list of §D.7");
  for (const item of NEVER_IN_THE_BLOCK) {
    assert.equal(mayBeInTheBlock(item), false, item);
  }
  // The fields the table DOES hold may be in the block.
  for (const field of requiredOf(SCHEMA_ID)) {
    assert.equal(mayBeInTheBlock(field), true, field);
  }
  assert.equal(mayBeInTheBlock("workerId"), false);
  assert.equal(mayBeInTheBlock("groupId"), false);
  assert.equal(mayBeInTheBlock("suppressionMarkerCount"), true, "only this count is shown");

  // The conditions of a unit, each in a separate field (§D.7).
  assert.deepEqual([...UNIT_CONDITIONS], ["tainted", "flaky", "superseded", "current", "cached"]);
  // The one fixed sentence of the field `notice`.
  assert.equal(NOTICE, "a result is evidence about the tree and not about a task");
  // Every text from the workspace is escaped, cut, stripped and bounded.
  assert.deepEqual(
    [...TREATMENT_OF_WORKSPACE_TEXT],
    [
      "escaped",
      "cut",
      "stripped of control characters",
      "printed inside a data boundary with a token of the call",
    ],
  );
  assert.equal(TEST_COUNTS_SHOWN_IN_WAVE_1, false);
  assert.deepEqual([...COUNTS_SHOWN], ["suppression markers"]);
  assert.equal(FILE_MODIFICATION_TIMES_STAY_IN, "the grounding snapshot");
});

test("CT-100-236: F100-FR-136 — an unauthorised protected change is a fact, never a halt", () => {
  assert.equal(ON_AN_UNAUTHORISED_PROTECTED_CHANGE.verificationGateStillRuns, true);
  assert.equal(ON_AN_UNAUTHORISED_PROTECTED_CHANGE.resultCarriesTheCondition, true);
  assert.equal(ON_AN_UNAUTHORISED_PROTECTED_CHANGE.criticIsTold, true);
  assert.equal(ON_AN_UNAUTHORISED_PROTECTED_CHANGE.approvalStaysPossible, true);
  assert.equal(ON_AN_UNAUTHORISED_PROTECTED_CHANGE.theRunHalts, false);
  assert.equal(AT_PHASE_ENTRY.comparedWith, "the approved tree of the phase before");
  assert.equal(AT_PHASE_ENTRY.aDifferenceIsAFactForTheCritic, true);
  assert.equal(AT_PHASE_ENTRY.aDifferenceBlocks, false);
  assert.equal(PARITY_ROW, 32);
});
