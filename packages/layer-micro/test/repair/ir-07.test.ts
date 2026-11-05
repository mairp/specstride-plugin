/**
 * CT-115-107 (T064, IR-07, F115-FR-025) — characterization: no exit code and
 * no stop reason result when the layer goes off for the phase attempt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disengageForIntegrityKind,
  layerOffForAttempt,
  layerOffForIntegrity,
  recordLayerOff,
  DISENGAGE_CAUSES,
  INTEGRITY_EVENT_KINDS,
  type DirectiveLog,
} from "../../src/caps/disengage.ts";

test("CT-115-107 (IR-07): layerOffForAttempt carries no exit code, no stop reason, no run state", () => {
  for (const cause of DISENGAGE_CAUSES) {
    const off = layerOffForAttempt(cause);
    assert.equal("exitCode" in off, true);
    assert.equal(off.exitCode, undefined);
    assert.equal("stopReason" in off, true);
    assert.equal(off.stopReason, undefined);
    assert.equal("runState" in off, true);
    assert.equal(off.runState, undefined);
    const record = off as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (record[key] !== undefined) {
        // Every defined field of the record is a directive field: none of the
        // three forbidden ones is present with a value.
        assert.ok(
          !["exitCode", "stopReason", "runState"].includes(key) || record[key] === undefined,
        );
      }
    }
  }
});

test("CT-115-107 (IR-07): the same for an integrity event and for the taint refusal", () => {
  for (const kind of INTEGRITY_EVENT_KINDS) {
    const off = layerOffForIntegrity(kind);
    assert.equal(off.exitCode, undefined);
    assert.equal(off.stopReason, undefined);
    assert.equal(off.runState, undefined);
  }
  assert.equal(disengageForIntegrityKind("changed-during-check"), undefined);
});

test("CT-115-107 (IR-07): the classic loop carries on from the tree as it is", () => {
  // The directive switches the layer off for the phase attempt only; it
  // carries no instruction about the tree, no revert and no exit.
  const off = layerOffForAttempt("unresolved-units") as unknown as Record<string, unknown>;
  assert.ok(!("revert" in off));
  assert.ok(!("exit" in off));
  assert.ok(!("stop" in off));
});

test("CT-115-107 (IR-07): the run record read back holds no exit code and no stop reason", () => {
  // The directive is written onto the run record of the attempt (the durable
  // seam the runtime hands in), and the independent read back of that record
  // — not the directive value — is what proves IR-07: after every cause, the
  // record still carries no stop reason and no exit code, and the run goes on.
  for (const cause of DISENGAGE_CAUSES) {
    const log: DirectiveLog = { events: [] };
    recordLayerOff(log, layerOffForAttempt(cause));
    assert.deepEqual(log.events, [`layerOffForAttempt:${cause}`]);
    assert.equal(log.stopReason, undefined);
    assert.equal(log.exitCode, undefined);
  }
  for (const kind of INTEGRITY_EVENT_KINDS) {
    const log: DirectiveLog = { events: [] };
    recordLayerOff(log, layerOffForIntegrity(kind));
    assert.deepEqual(log.events, ["layerOffForAttempt:integrity-event"]);
    assert.equal(log.stopReason, undefined);
    assert.equal(log.exitCode, undefined);
  }
});
