/**
 * CT-115-19 (T051, F115-FR-019) — characterization: the failure signature;
 * a continued session dropped on a repeated signature and tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  failureSignature,
  shouldDropContinuedSession,
  signatureKey,
  signatureRepeated,
} from "../../src/unit/signature.ts";

const RESULTS = [
  { id: "unit", exit: 0 },
  { id: "lint", exit: 1 },
  { id: "typecheck", exit: 2 },
];

test("CT-115-19: the signature is the ordered list of failed ids with exit codes, in manifest order", () => {
  assert.deepEqual(failureSignature(RESULTS), [
    { id: "lint", exit: 1 },
    { id: "typecheck", exit: 2 },
  ]);
  assert.deepEqual(failureSignature([{ id: "unit", exit: 0 }]), []);
});

test("CT-115-19: no output of a check is parsed for the decision", () => {
  // The signature reads exit statuses only; its type carries no output field.
  const entries = failureSignature(RESULTS);
  for (const entry of entries) {
    assert.ok(!("output" in entry));
    assert.ok(!("stdout" in entry));
  }
});

test("CT-115-19: the same signature and tree on two proposals drops the continued session", () => {
  const previous = { signature: "lint:1", treeFingerprint: "t1" };
  assert.equal(
    shouldDropContinuedSession({ signature: "lint:1", treeFingerprint: "t1" }, previous),
    true,
  );
  // A different signature keeps the session.
  assert.equal(
    shouldDropContinuedSession({ signature: "lint:2", treeFingerprint: "t1" }, previous),
    false,
  );
  // A different tree keeps the session.
  assert.equal(
    shouldDropContinuedSession({ signature: "lint:1", treeFingerprint: "t2" }, previous),
    false,
  );
  // No proposal before: nothing to drop.
  assert.equal(shouldDropContinuedSession({ signature: "lint:1", treeFingerprint: "t1" }), false);
});

test("CT-115-19: the signature is repeated when it equals the one of the proposal before", () => {
  const previous = { signature: "lint:1", treeFingerprint: "t9" };
  assert.equal(signatureRepeated({ signature: "lint:1", treeFingerprint: "t2" }, previous), true);
  assert.equal(signatureRepeated({ signature: "lint:2", treeFingerprint: "t2" }, previous), false);
  assert.equal(signatureKey(failureSignature(RESULTS)), "lint:1;typecheck:2");
});
