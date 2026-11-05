/**
 * T163 — contract test CT-100-189 for the withheld paths (annex C, §C.4;
 * F100-FR-089): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/withheld-paths.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  CONFIRMATION_IS_MADE_BEFORE_THE_CALL,
  CONTENT_OWNER,
  DENIED_LOCATIONS,
  DENIED_LOCATION_COUNT,
  FAILURE_WITHOUT_THE_CONFIRMATION,
  LOGICAL_NAME,
  MOVED_FILES,
  SCHEMA_ID,
  STATUS,
  WITHOUT_CONFIRMATION,
  holdsTheFiveLocations,
  isWithheldPaths,
  missingLocations,
  outcomeWithoutConfirmation,
  readWithheldPaths,
  secondFormMayBeUsed,
  tryReadWithheldPaths,
  type WithheldPaths,
} from "../src/records/withheld-paths.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

/** A valid record: the five locations of §C.4, the three moved files, confirmed. */
function validRecord(): Record<string, unknown> {
  return {
    schema: SCHEMA_ID,
    deny: DENIED_LOCATIONS.map((root) => ({ root, realPath: `/a/real/path/of/${root}` })),
    moved: MOVED_FILES.map((file) => ({
      file,
      from: `/a/working/tree/${file}`,
      keptAt: `/a/place/outside/${file}`,
    })),
    confirmed: true,
  };
}

test("CT-100-189: a valid sample of the withheld paths passes (annex C, §C.4)", () => {
  assert.equal(SCHEMA_ID, "specstride.withheld-paths/1");
  assert.equal(LOGICAL_NAME, "attempt:<N>:<k>:<n>:withheld-paths");
  assert.equal(ANNEX_SECTION, "annex C, §C.4");
  assert.equal(CONTENT_OWNER, "117");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);

  const sample = validRecord();
  assert.ok(isWithheldPaths(sample));
  const record = readWithheldPaths(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  assert.equal(tryReadWithheldPaths(sample, LOGICAL_NAME).ok, true);

  // The sample built from the schema itself passes too.
  assert.ok(isWithheldPaths(sampleOf(SCHEMA_ID)));
});

test("CT-100-189: a different major of the withheld paths is refused (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.equal(next, "specstride.withheld-paths/2");
  assert.throws(
    () => readWithheldPaths({ ...validRecord(), schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is 2/);
      assert.match(err.message, /the major supported is 1/);
      return true;
    },
  );
  const refused = tryReadWithheldPaths({ ...validRecord(), schema: next }, LOGICAL_NAME);
  assert.equal(refused.ok, false);
});

test("CT-100-189: an unknown field follows the rule of the schema (annex C, §C.4)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...validRecord(), aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isWithheldPaths(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isWithheldPaths(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readWithheldPaths(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-189: every required field of the withheld paths is required (annex C, §C.4)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual([...required], ["schema", "deny", "moved", "confirmed"]);
  for (const field of required) {
    const without: Record<string, unknown> = validRecord();
    delete without[field];
    assert.equal(isWithheldPaths(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
});

test("CT-100-189: the rules of F100-FR-089 — five locations and the confirmation", () => {
  // The list holds the five locations of §C.4.
  assert.equal(DENIED_LOCATION_COUNT, 5);
  assert.deepEqual(
    [...DENIED_LOCATIONS],
    ["workspace-part", "control-plane", "event-stream", "worker-root", "tree-store"],
  );
  const record = readWithheldPaths(validRecord(), LOGICAL_NAME) as WithheldPaths;
  assert.ok(holdsTheFiveLocations(record));
  assert.deepEqual([...missingLocations(record)], []);

  const short = readWithheldPaths(
    { ...validRecord(), deny: [{ root: "control-plane", realPath: "/a/path" }] },
    LOGICAL_NAME,
  ) as WithheldPaths;
  assert.equal(holdsTheFiveLocations(short), false);
  assert.deepEqual(
    [...missingLocations(short)],
    ["workspace-part", "event-stream", "worker-root", "tree-store"],
  );
  assert.equal(secondFormMayBeUsed(short), false);

  // The harness adapter confirms the denial BEFORE the call.
  assert.equal(CONFIRMATION_IS_MADE_BEFORE_THE_CALL, true);
  assert.ok(secondFormMayBeUsed(record));
  const unconfirmed = readWithheldPaths(
    { ...validRecord(), confirmed: false },
    LOGICAL_NAME,
  ) as WithheldPaths;
  assert.equal(secondFormMayBeUsed(unconfirmed), false);

  // Without the confirmation: a configured critic is refused with
  // `critic_not_toolless`; an automatically picked one is passed over for the
  // next candidate of the critic order, announced and recorded.
  assert.equal(FAILURE_WITHOUT_THE_CONFIRMATION, "critic_not_toolless");
  assert.equal(outcomeWithoutConfirmation("configured").outcome, "refused");
  assert.equal(
    (outcomeWithoutConfirmation("configured") as { failure?: string }).failure,
    "critic_not_toolless",
  );
  assert.equal(outcomeWithoutConfirmation("automaticallyPicked").outcome, "passed-over");
  assert.equal(WITHOUT_CONFIRMATION.automaticallyPicked.announced, true);
  assert.equal(WITHOUT_CONFIRMATION.automaticallyPicked.recorded, true);
  assert.match(WITHOUT_CONFIRMATION.automaticallyPicked.takes, /critic order/);

  // The three files of the proposer that are moved for the call (F100-FR-088).
  assert.deepEqual([...MOVED_FILES], ["notebook", "handoff", "outbox"]);

  // §C.4 carries a `status` of unverified until a capture shows the denial.
  assert.equal(STATUS, "unverified");
});
