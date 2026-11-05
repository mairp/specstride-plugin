/**
 * T171 — contract test CT-100-213 for the overlay schema (annex C, §C.16;
 * F100-FR-113): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/overlay.schema.json" with { type: "json" };
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ANNEX_SECTION,
  CONTENT_OWNER,
  DERIVED_FIELDS,
  ENVIRONMENT_RECORD_KINDS,
  HOME_BY_AUTH_TIER,
  LOGICAL_NAME,
  MARKER_ONLY_FIELDS,
  MARKER_SCOPES,
  MARKER_SCOPE_WHEN_UNKNOWN,
  OverlayRefusedError,
  SCHEMA_FIELD,
  SCHEMA_ID,
  SCOPES,
  SCOPE_UNDER_PARITY,
  SCOPE_WHEN_UNKNOWN,
  SESSION_STATE_IS_REMOVED_WHEN_THE_ATTEMPT_ENDS,
  SESSION_STATE_SCOPE,
  SWITCHED_OFF_AT_TIER_1,
  isOverlay,
  readOverlay,
  tryReadOverlay,
  usesAnOverlay,
} from "../src/records/overlay.ts";
import { requiredOf, sampleOf } from "./samples.ts";

/** A valid overlay record: every field §C.16 requires. */
function validRecord(): Record<string, unknown> {
  return {
    contract: SCHEMA_ID,
    key: "a-harness-1",
    vars: ["A_HARNESS_CONFIG_HOME", "A_HARNESS_SESSION_DIR"],
    scope: "attempt",
  };
}

/** The marker of an overlay tree: the four fields of the marker as well. */
function validMarker(): Record<string, unknown> {
  return {
    ...validRecord(),
    ownerPid: 4242,
    ownerStart: "a-start-time",
    createdAt: "2026-10-01T00:00:00.000Z",
    markerScope: "critic",
  };
}

test("CT-100-213: a valid sample of the overlay passes (annex C, §C.16)", () => {
  // The as-is name of the schema id is kept.
  assert.equal(SCHEMA_ID, "specstride-overlay/v1");
  assert.equal(SCHEMA_FIELD, "contract");
  assert.equal(LOGICAL_NAME, "overlay:<id>:tree");
  assert.equal(ANNEX_SECTION, "annex C, §C.16");
  assert.equal(CONTENT_OWNER, "109");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);

  const sample = validRecord();
  assert.ok(isOverlay(sample));
  const record = readOverlay(sample);
  assert.deepEqual(record, sample);
  assert.equal(tryReadOverlay(sample).ok, true);
  assert.ok(isOverlay(sampleOf(SCHEMA_ID)));

  // The marker of an overlay tree carries four further fields (§C.16).
  assert.ok(isOverlay(validMarker()));
  const marker = readOverlay(validMarker());
  assert.equal((marker as { markerScope?: string }).markerScope, "critic");
  for (const field of MARKER_ONLY_FIELDS) {
    assert.notEqual(
      (schema as { properties: Record<string, unknown> }).properties[field],
      undefined,
      field,
    );
    assert.equal(requiredOf(SCHEMA_ID).includes(field), false, `${field} is of the marker only`);
  }
  // `unset` is derived by the harness layer, so it is not required.
  for (const field of DERIVED_FIELDS) {
    assert.equal(requiredOf(SCHEMA_ID).includes(field), false, `${field} is derived`);
  }
  assert.ok(isOverlay({ ...validRecord(), unset: ["A_HARNESS_CACHE_DIR"] }));
  assert.ok(
    isOverlay({
      ...validRecord(),
      seeds: [{ var: "A_HARNESS_CONFIG_HOME", path: "settings.json", content: "{}" }],
    }),
  );
});

test("CT-100-213: a different major of the overlay is refused (F100-FR-049)", () => {
  assert.throws(
    () => readOverlay({ ...validRecord(), contract: "specstride-overlay/v2" }),
    (err: unknown) => {
      assert.ok(err instanceof OverlayRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.majorFound, "v2");
      assert.equal(err.majorSupported, "v1");
      assert.match(err.message, /the major found is v2/);
      assert.match(err.message, /the major supported is v1/);
      assert.match(err.message, /overlay:<id>:tree/);
      return true;
    },
  );
  const refused = tryReadOverlay({ ...validRecord(), contract: "specstride-overlay/v2" });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.reason, "different-major");

  // The record names its schema in `contract`; without it there is no identity.
  assert.throws(
    () => readOverlay({ key: "a-harness-1", vars: [], scope: "none" }),
    (err: unknown) => {
      assert.ok(err instanceof OverlayRefusedError);
      assert.equal(err.reason, "missing-contract");
      assert.match(err.message, /`contract`/);
      return true;
    },
  );
  assert.throws(
    () => readOverlay("not a record"),
    (err: unknown) => err instanceof OverlayRefusedError && err.reason === "not-a-record",
  );
});

test("CT-100-213: an unknown field follows the rule of the schema (annex C, §C.16)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...validRecord(), aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isOverlay(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isOverlay(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readOverlay(withExtra));
  }
});

test("CT-100-213: every required field of the overlay is required (annex C, §C.16)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual([...required], ["contract", "key", "vars", "scope"]);
  for (const field of required) {
    const without: Record<string, unknown> = validRecord();
    delete without[field];
    assert.equal(isOverlay(without), false, `${field} must be required`);
    assert.throws(() => readOverlay(without), OverlayRefusedError);
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

test("CT-100-213: the closed columns of §C.16 and the rules of F100-FR-113", () => {
  // The scope of an overlay is row 88 of annex X §X.6; the scope word of a
  // marker is row 129; the kinds of the environment record are row 130.
  const rows = (
    closedSetsData as { closedSets: { number: number; literals: string[]; unknownValue: string }[] }
  ).closedSets;
  const row88 = rows.find((r) => r.number === 88);
  assert.deepEqual([...SCOPES], ["none", "pass", "attempt"]);
  assert.deepEqual([...(row88?.literals ?? [])], [...SCOPES]);
  assert.match(String(row88?.unknownValue), /Configuration error/);
  assert.equal(SCOPE_WHEN_UNKNOWN.outcome, "configuration-error");
  assert.equal(SCOPE_WHEN_UNKNOWN.exitCode, 3);
  assert.equal(isOverlay({ ...validRecord(), scope: "run" }), false);

  const row129 = rows.find((r) => r.number === 129);
  assert.deepEqual([...MARKER_SCOPES], ["pass", "attempt", "critic"]);
  assert.deepEqual([...(row129?.literals ?? [])], [...MARKER_SCOPES]);
  assert.match(String(row129?.unknownValue), /left alone/);
  assert.equal(MARKER_SCOPE_WHEN_UNKNOWN.treeIsNotOursAndIsLeftAlone, true);
  assert.equal(isOverlay({ ...validMarker(), markerScope: "phase" }), false);

  const row130 = rows.find((r) => r.number === 130);
  assert.deepEqual([...ENVIRONMENT_RECORD_KINDS], ["unset", "set"]);
  assert.deepEqual([...(row130?.literals ?? [])], [...ENVIRONMENT_RECORD_KINDS]);

  // F100-FR-113 — auth tier 1 uses the consumer's real configuration home,
  // never written by the run, with plugins, host hooks, skills and tool
  // servers off; auth tier 2 uses a throwaway home built from an overlay.
  assert.deepEqual(
    [...SWITCHED_OFF_AT_TIER_1],
    ["plugins", "host-hooks", "skills", "tool-servers"],
  );
  assert.match(HOME_BY_AUTH_TIER[1].home, /real configuration home/);
  assert.equal(HOME_BY_AUTH_TIER[1].writtenByTheRun, false);
  assert.equal(HOME_BY_AUTH_TIER[1].overlay, false);
  assert.match(HOME_BY_AUTH_TIER[2].home, /throwaway home built from an overlay/);
  assert.equal(HOME_BY_AUTH_TIER[2].overlay, true);
  assert.deepEqual([...HOME_BY_AUTH_TIER[2].switchedOff], [...SWITCHED_OFF_AT_TIER_1]);
  assert.equal(usesAnOverlay(1), false);
  assert.equal(usesAnOverlay(2), true);

  // Session state lives per phase attempt and is removed when it ends.
  assert.equal(SESSION_STATE_SCOPE, "attempt");
  assert.ok(MARKER_SCOPES.includes(SESSION_STATE_SCOPE));
  assert.equal(SESSION_STATE_IS_REMOVED_WHEN_THE_ATTEMPT_ENDS, true);

  // Under the `parity` profile the scope is `none` (row 30 of annex X §X.7).
  assert.equal(SCOPE_UNDER_PARITY, "none");
  assert.ok(SCOPES.includes(SCOPE_UNDER_PARITY));
});
