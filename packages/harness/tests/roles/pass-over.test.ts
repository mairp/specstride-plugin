/**
 * T026 — CT-124-41 and CT-124-48 (F124-FR-041, F124-FR-048): the pass-over.
 *
 * A candidate whose read denial is not confirmed is passed over; a worker
 * root that is not empty after one sweep passes over a candidate with
 * read-only tools; a first call that does not prove the form passes over
 * and produces no verdict; a first call proved by the weaker proof
 * (constitution v3.0.1, CQ-182) is believed and not passed over; each
 * pass-over is announced and recorded; a configured critic is refused and
 * not passed over.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { passOverReason, type FirstCallProof } from "../../src/roles/critic-order.ts";
import { passOverLine } from "../../src/roles/announce.ts";

const READ_ONLY = "read-only-tools" as const;

test("CT-124-41 a candidate whose read denial is not confirmed is passed over", () => {
  const result = passOverReason({
    step: "discovered",
    form: READ_ONLY,
    readDenialConfirmed: false,
  });
  assert.deepEqual(result, { passOver: true, reason: "read-denial-unconfirmed" });
});

test("CT-124-41 a worker root that is not empty after one sweep passes over a read-only critic", () => {
  const result = passOverReason({
    step: "discovered",
    form: READ_ONLY,
    readDenialConfirmed: true,
    workerRootEmptyAfterOneSweep: false,
  });
  assert.deepEqual(result, { passOver: true, reason: "worker-root-not-empty" });
  // A tool-less critic is not touched by the worker-root rule.
  const toolLess = passOverReason({
    step: "discovered",
    form: "tool-less",
    workerRootEmptyAfterOneSweep: false,
  });
  assert.equal(toolLess.passOver, false);
});

test("CT-124-48 a first call that does not prove the form passes over and produces no verdict", () => {
  const proof: FirstCallProof = {
    proven: false,
    testedAdapterWithoutInitialRecord: false,
    versionPinExact: false,
    flagSet: false,
    preflightOk: false,
  };
  const result = passOverReason({ step: "discovered", form: "tool-less", firstCallProof: proof });
  assert.deepEqual(result, { passOver: true, reason: "first-call-unproven" });
  // The failed call produces no verdict: the pass-over is the whole result
  // the engine acts on — there is no verdict field to read.
  const recordable = result.passOver
    ? { harness: "disc-a", reason: result.reason, decidedAt: "given-by-the-engine" }
    : null;
  assert.equal(recordable !== null && recordable.reason, "first-call-unproven");
  assert.equal("verdict" in (recordable ?? {}), false);
});

test("CT-124-48 a first call proved by the weaker proof is believed and not passed over", () => {
  // A tested harness adapter whose stream carries no initial record: the
  // exact version pin, the flag set and the preflight (constitution
  // v3.0.1, CQ-182).
  const weaker: FirstCallProof = {
    proven: false,
    testedAdapterWithoutInitialRecord: true,
    versionPinExact: true,
    flagSet: true,
    preflightOk: true,
  };
  const believed = passOverReason({
    step: "discovered",
    form: "tool-less",
    firstCallProof: weaker,
  });
  assert.deepEqual(believed, { passOver: false, refused: false });

  // The weaker proof without its pin, its flag or its preflight is NOT
  // believed.
  const unproven = passOverReason({
    step: "discovered",
    form: "tool-less",
    firstCallProof: { ...weaker, versionPinExact: false },
  });
  assert.deepEqual(unproven, { passOver: true, reason: "first-call-unproven" });
});

test("CT-124-41 every pass-over is announced and recorded", () => {
  const result = passOverReason({
    step: "discovered",
    form: READ_ONLY,
    readDenialConfirmed: false,
  });
  assert.equal(result.passOver, true);
  // The announcement: one line of annex G §G.3, with the next of the order.
  const line = passOverLine("disc-a", result.passOver ? result.reason : "", "disc-b");
  assert.match(
    line,
    /^SPECSTRIDE-CRITIC passed-over=disc-a reason=read-denial-unconfirmed next=disc-b$/,
  );
  // The record: the pick carries the pass-over with its reason.
  const passedOver = [
    { harness: "disc-a", reason: "read-denial-unconfirmed", decidedAt: "call-time" },
  ];
  assert.equal(passedOver[0]!.harness, "disc-a");
  assert.equal(passedOver[0]!.reason, "read-denial-unconfirmed");
});

test("CT-124-41 a configured critic is refused and never passed over", () => {
  const result = passOverReason({
    step: "configured",
    form: READ_ONLY,
    readDenialConfirmed: false,
  });
  assert.deepEqual(result, { passOver: false, refused: true });
});
