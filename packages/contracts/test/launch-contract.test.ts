/**
 * T195 — contract tests CT-100-290 and CT-100-291 for the launch-contract
 * schema (annex G, §G.8): a valid sample passes, a different major is refused,
 * an unknown top-level key is refused and a key under `x-` is ignored, and every
 * required field is required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/launch-contract.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  AN_UNKNOWN_ERROR_CLASS_FAILS_THE_BUILD,
  AN_UNKNOWN_TOP_LEVEL_KEY_IS_REFUSED,
  CONTENT_OWNER,
  DEFAULT_MODE,
  DRY_RUN,
  ERROR_CLASS_SET_ROW,
  FIELDS_OUTSIDE_THE_PROMOTION_HASH,
  HOST_SKILL,
  KEYS_UNDER_THIS_PREFIX_ARE_IGNORED,
  LOGICAL_NAME,
  MODES,
  MODE_MAP,
  OWNER_MAY_ADD_FIELDS_TO,
  PARITY_ROW,
  PROMOTED_ONLY_BY,
  REFUSALS,
  SCHEMA_ID,
  STATUSES,
  THE_SCHEMA_IS_THE_VALIDATOR,
  canonicalForPromotion,
  exitCodeOfRefusal,
  isLaunchContract,
  keyIsIgnored,
  modeOf,
  promote,
  promotionIsProven,
  promotionIsRequired,
  readLaunchContract,
  tryReadLaunchContract,
} from "../src/records/launch-contract.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { modeMap } from "../src/profile/normalization.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-290: a valid sample of the launch contract passes (annex G, §G.8)", () => {
  assert.equal(SCHEMA_ID, "specstride.launch-contract/1");
  assert.equal(LOGICAL_NAME, "pipeline:<pipelineId>:contract");
  assert.equal(ANNEX_SECTION, "annex G, §G.8");
  assert.equal(CONTENT_OWNER, "107");
  assert.deepEqual([...OWNER_MAY_ADD_FIELDS_TO], ["inventory", "configuration"]);
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isLaunchContract(sample));
  assert.deepEqual(readLaunchContract(sample, LOGICAL_NAME), sample);
  assert.equal(tryReadLaunchContract(sample, LOGICAL_NAME).ok, true);
  assert.equal(THE_SCHEMA_IS_THE_VALIDATOR, true);
  assert.deepEqual([...STATUSES], ["draft", "validated"]);
});

test("CT-100-290: a different major of the launch contract is refused with both majors", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readLaunchContract({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadLaunchContract({ ...sample, schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-290: an unknown top-level key is refused, a key under `x-` is ignored", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  assert.match(rule, /refused, except keys under x-/);
  assert.equal((schema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(
    Object.keys(
      (schema as { patternProperties?: Record<string, unknown> }).patternProperties ?? {},
    ),
    ["^x-"],
  );
  assert.equal(AN_UNKNOWN_TOP_LEVEL_KEY_IS_REFUSED, true);
  assert.equal(KEYS_UNDER_THIS_PREFIX_ARE_IGNORED, "x-");

  // An unknown top-level key refuses the launch contract.
  assert.equal(isLaunchContract({ ...sample, aKeyTheSchemaDoesNotHold: 1 }), false);
  assert.equal(
    tryReadLaunchContract({ ...sample, aKeyTheSchemaDoesNotHold: 1 }, LOGICAL_NAME).ok,
    false,
  );
  // A key under `x-` is ignored.
  assert.ok(isLaunchContract({ ...sample, "x-of-the-owner": { anything: true } }));
  assert.doesNotThrow(() => readLaunchContract({ ...sample, "x-of-the-owner": 1 }, LOGICAL_NAME));
  assert.equal(keyIsIgnored("x-of-the-owner"), true);
  assert.equal(keyIsIgnored("aKeyTheSchemaDoesNotHold"), false);
});

test("CT-100-290: every required field of the launch contract is required (annex G, §G.8)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    [
      "schema",
      "id",
      "status",
      "repository",
      "authorized_roots",
      "sources",
      "coverage",
      "findings",
      "stages",
    ],
    "the nine rows of §G.8 whose Required cell is Yes",
  );
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isLaunchContract(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<
        string,
        { description?: string; "x-type-in-words"?: string; required?: string[] }
      >;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field], undefined, field);
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
  // `configuration.verification` is required inside `configuration` (§G.8).
  assert.deepEqual([...(properties["configuration"]?.required ?? [])], ["verification"]);
});

test("CT-100-291: only validation promotes `draft` to `validated`, with its proof", () => {
  assert.equal(PROMOTED_ONLY_BY, "validation");
  assert.deepEqual([...FIELDS_OUTSIDE_THE_PROMOTION_HASH], ["status", "promotion"]);
  assert.equal(promotionIsRequired("validated"), true);
  assert.equal(promotionIsRequired("draft"), false);

  // The canonical record of the proof leaves out `status` and `promotion`.
  const record = {
    schema: SCHEMA_ID,
    id: "p-1",
    status: "draft",
    promotion: { by: "x", hash: "h" },
    coverage: [],
  };
  const canonical = canonicalForPromotion(record);
  assert.equal("status" in canonical, false);
  assert.equal("promotion" in canonical, false);
  assert.deepEqual(Object.keys(canonical), ["coverage", "id", "schema"]);

  // Validation with a matching proof promotes.
  const proof = { by: "contract-validate", hash: "the-hash" };
  const promoted = promote({
    record,
    validates: true,
    proof,
    hashOfTheCanonicalRecord: "the-hash",
  });
  assert.equal(promoted.status, "validated");
  if (promoted.status === "validated") assert.deepEqual(promoted.promotion, proof);

  // A proof whose hash does not match is refused with the pipeline code 20.
  const mismatch = promote({
    record,
    validates: true,
    proof: { by: "contract-validate", hash: "other" },
    hashOfTheCanonicalRecord: "the-hash",
  });
  assert.equal(mismatch.status, "draft");
  if (mismatch.status === "draft") {
    assert.equal(mismatch.refusal, "no-matching-proof-of-promotion");
    assert.equal(exitCodeOfRefusal(mismatch.refusal), 20);
  }
  // No proof at all: the same refusal.
  const noProof = promote({ record, validates: true, hashOfTheCanonicalRecord: "the-hash" });
  assert.equal(noProof.status, "draft");
  // Sources that changed: the pipeline code 23.
  const stale = promote({
    record,
    validates: true,
    proof,
    hashOfTheCanonicalRecord: "the-hash",
    sourcesChanged: true,
  });
  assert.equal(stale.status, "draft");
  if (stale.status === "draft") {
    assert.equal(stale.refusal, "sources-changed");
    assert.equal(exitCodeOfRefusal(stale.refusal), 23);
  }
  // A launch contract that does not validate stays a draft: nothing but
  // validation promotes.
  const invalid = promote({
    record,
    validates: false,
    proof,
    hashOfTheCanonicalRecord: "the-hash",
  });
  assert.equal(invalid.status, "draft");
  assert.deepEqual(Object.keys(REFUSALS).sort(), [
    "invalid",
    "no-matching-proof-of-promotion",
    "sources-changed",
  ]);

  // A validated launch contract is accepted only with a matching proof.
  assert.equal(
    promotionIsProven({
      status: "validated",
      promotion: proof,
      hashOfTheCanonicalRecord: "the-hash",
    }),
    true,
  );
  assert.equal(
    promotionIsProven({ status: "validated", hashOfTheCanonicalRecord: "the-hash" }),
    false,
  );
  assert.equal(promotionIsProven({ status: "draft", hashOfTheCanonicalRecord: "h" }), true);
  assert.equal(ERROR_CLASS_SET_ROW, 274);
  assert.equal(AN_UNKNOWN_ERROR_CLASS_FAILS_THE_BUILD, true);
});

test("CT-100-291: the host skill launches by default and its modes map (F100-FR-191)", () => {
  assert.equal(HOST_SKILL, "specstride-run");
  assert.deepEqual([...MODES], ["run", "dry-run"]);
  assert.equal(DEFAULT_MODE, "run", "the host skill launches by default");
  assert.equal(DRY_RUN.withholdsTheLaunch, true);
  assert.equal(DRY_RUN.printsThePlan, true);
  // The as-is mode names map: `generate` to `dry-run`; `run` and `auto` to `run`.
  assert.equal(modeOf("generate"), "dry-run");
  assert.equal(modeOf("run"), "run");
  assert.equal(modeOf("auto"), "run");
  assert.equal(modeOf("nonsense"), undefined);
  // The map is the mode map of the normalization contract (annex X, §X.8).
  assert.deepEqual({ ...MODE_MAP }, { ...modeMap });
  assert.equal(PARITY_ROW, 37);
});
