/**
 * T045 — contract tests CT-100-165 for inbox requests (annex B, §B.11): a
 * valid sample passes, a different major is refused, an unknown field follows
 * the rule of the schema, and every field the table marks required is
 * required — with the one stated exception of the empty stop request, which
 * carries no field at all (F100-FR-065).
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/inbox-request.schema.json" with { type: "json" };
import {
  EMPTY_STOP_REQUEST_CARRIES_NO_FIELD,
  HOST_EVENT_INFORMS_ONLY,
  INBOX_NAMES,
  INBOX_REQUEST_TYPES,
  LOGICAL_NAME,
  SCHEMA_ID,
  STOP_DEFAULTS,
  isInboxRequest,
  readInboxRequest,
  readStopRequest,
  tryReadInboxRequest,
} from "../src/records/inbox-request.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { holdsLogicalName } from "../src/ids/logical-names.ts";
import { closedSet } from "../src/enums/all-sets.ts";

/** The row of annex X §X.6 that closes the inbox request types. */
const INBOX_REQUEST_TYPES_ROW = 21;
import { withNextMajor } from "./samples.ts";

/** The fields the table marks required for a request that is not the empty stop. */
const REQUIRED_OF_EVERY_REQUEST = ["schema", "type", "at"] as const;

const stop = {
  schema: SCHEMA_ID,
  type: "stop",
  at: "2026-09-30T00:00:00.000Z",
} as const;

test("CT-100-165: a valid sample of an inbox request passes (annex B, §B.11)", () => {
  assert.equal(SCHEMA_ID, "specstride.inbox/1");
  assert.equal(LOGICAL_NAME, "inbox:stop");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isInboxRequest(stop));
  assert.deepEqual(readInboxRequest(stop, LOGICAL_NAME), stop);
  // The three request types, and one logical name for each (F100-FR-065).
  assert.deepEqual([...INBOX_REQUEST_TYPES], ["stop", "hold-relaunch", "host-event"]);
  assert.deepEqual(
    [...INBOX_NAMES],
    ["inbox:stop", "inbox:hold-relaunch", "inbox:host-events:<launchId>"],
  );
  for (const name of INBOX_NAMES) assert.ok(holdsLogicalName(name), `${name} must be in §B.5`);
  for (const type of INBOX_REQUEST_TYPES) {
    assert.ok(isInboxRequest({ ...stop, type, hold: true, kind: "limit" }), type);
  }
  // The schema does not close `type` (the annex writes `schema`, `type` and
  // `at` in one row): the closure is the closed set of annex X §X.6 row 21,
  // and a type outside it is not a member (F100-FR-065, F100-FR-208).
  const set = closedSet(INBOX_REQUEST_TYPES_ROW);
  assert.notEqual(set, undefined);
  assert.deepEqual([...(set?.members ?? [])], [...INBOX_REQUEST_TYPES]);
  for (const type of INBOX_REQUEST_TYPES) assert.ok(set?.has(type), type);
  assert.equal(set?.has("restart"), false);
  // The request is ignored and reported (the unknown-value rule of row 21).
  assert.equal(set?.onUnknown("restart").kind, "ignore");
});

test("CT-100-165: a different major is refused with both majors (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readInboxRequest({ ...stop, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  const result = tryReadInboxRequest({ ...stop, schema: next }, LOGICAL_NAME);
  assert.equal(result.ok, false);
});

test("CT-100-165: an unknown field follows the rule of the schema (annex B, §B.11)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  assert.match(rule, /ignored by a reader/);
  assert.ok(isInboxRequest({ ...stop, aFieldAWriterOfALaterMinorAdded: 1 }));
  assert.doesNotThrow(() =>
    readInboxRequest({ ...stop, aFieldAWriterOfALaterMinorAdded: 1 }, LOGICAL_NAME),
  );
});

test("CT-100-165: every field the table marks required is required, the empty stop request apart", () => {
  const properties = (
    schema as {
      properties: Record<
        string,
        { "x-required"?: string; description?: string; "x-type-in-words"?: string }
      >;
    }
  ).properties;
  for (const field of REQUIRED_OF_EVERY_REQUEST) {
    assert.match(
      String(properties[field]?.["x-required"]),
      /^Yes, except in the empty stop request$/,
      `${field} is required except in the empty stop request`,
    );
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
    const without: Record<string, unknown> = { ...stop };
    delete without[field];
    // A request that is not the empty one and lacks a required field is
    // refused by the reader of the common rules (F100-FR-048).
    const result = tryReadInboxRequest(without, LOGICAL_NAME);
    if (field === "schema") assert.equal(result.ok, false, "a request without `schema` is refused");
  }
  // `hold` is required of a hold-relaunch request; `kind` of a host event.
  assert.equal(String(properties.hold?.["x-required"]), "Yes");
  assert.equal(String(properties.kind?.["x-required"]), "Yes");
});

test("CT-100-165: an empty stop request means a clean stop with every default (F100-FR-065)", () => {
  assert.equal(EMPTY_STOP_REQUEST_CARRIES_NO_FIELD, true);
  // The schema names no required field, because the empty stop request
  // carries none: it is the one stated exception to F100-FR-048.
  assert.equal((schema as { required?: string[] }).required, undefined);
  assert.deepEqual(readStopRequest({}), STOP_DEFAULTS);
  assert.deepEqual(STOP_DEFAULTS, { now: false, jobs: false, causedBy: "operator" });
  assert.deepEqual(readStopRequest({ now: true }), {
    now: true,
    jobs: false,
    causedBy: "operator",
  });
  assert.deepEqual(readStopRequest({ jobs: true }), {
    now: false,
    jobs: true,
    causedBy: "operator",
  });
  // A host event informs only: it never pauses, stops or relaunches a run.
  assert.equal(HOST_EVENT_INFORMS_ONLY, true);
});
