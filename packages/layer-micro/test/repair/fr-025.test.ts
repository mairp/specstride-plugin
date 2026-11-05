/**
 * CT-115-25 (T056, F115-FR-025) — characterization: one test case per cause
 * that switches the layer off for the phase attempt; a taint does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disengageForIntegrityKind,
  DISENGAGE_CAUSES,
  INTEGRITY_EVENT_KINDS,
  isTaint,
  layerOffForAttempt,
  layerOffForIntegrity,
  TAINT_KIND,
} from "../../src/caps/disengage.ts";

/** Every cause of F115-FR-025 gives the directive, and no exit code, no stop reason, no run state. */
function assertOff(cause: (typeof DISENGAGE_CAUSES)[number]): void {
  const off = layerOffForAttempt(cause);
  assert.equal(off.directive, "layerOffForAttempt", cause);
  assert.equal(off.cause, cause);
  assert.equal(off.exitCode, undefined, `no exit code for ${cause}`);
  assert.equal(off.stopReason, undefined, `no stop reason for ${cause}`);
  assert.equal(off.runState, undefined, `no run state for ${cause}`);
  assert.ok(!("exit" in off));
  assert.ok(!("reason" in off) || off.reason === undefined);
}

test("CT-115-25: a cap of cycles spent switches the layer off", () => {
  assertOff("cycles-spent");
});

test("CT-115-25: two units unresolved switch the layer off", () => {
  assertOff("unresolved-units");
});

test("CT-115-25: two consecutive unchecked units with an empty inner set switch the layer off", () => {
  assertOff("unchecked-empty-streak");
});

test("CT-115-25: a check that cannot start switches the layer off", () => {
  assertOff("check-cannot-start");
});

test("CT-115-25: a failure of the own code of the layer switches the layer off", () => {
  assertOff("layer-error");
});

test("CT-115-25: an integrity event other than a taint switches the layer off", () => {
  assert.deepEqual(
    [...INTEGRITY_EVENT_KINDS],
    ["ledger-invalid", "manifest-mismatch", "pin-mismatch"],
  );
  for (const kind of INTEGRITY_EVENT_KINDS) {
    const off = layerOffForIntegrity(kind);
    assert.equal(off.directive, "layerOffForAttempt");
    assert.equal(off.cause, "integrity-event");
    assert.equal(off.integrityKind, kind);
    assert.equal(off.exitCode, undefined);
    assert.equal(off.stopReason, undefined);
    assert.equal(off.runState, undefined);
    assert.equal(disengageForIntegrityKind(kind)?.directive, "layerOffForAttempt");
  }
});

test("CT-115-25: a taint does not switch the layer off", () => {
  assert.equal(TAINT_KIND, "changed-during-check");
  assert.equal(isTaint("changed-during-check"), true);
  assert.equal(disengageForIntegrityKind("changed-during-check"), undefined);
  assert.equal(disengageForIntegrityKind("something-else"), undefined);
});

test("CT-115-25: the cause set is closed", () => {
  assert.deepEqual(
    [...DISENGAGE_CAUSES],
    [
      "cycles-spent",
      "unresolved-units",
      "unchecked-empty-streak",
      "check-cannot-start",
      "layer-error",
      "integrity-event",
    ],
  );
});
