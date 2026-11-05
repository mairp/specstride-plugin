/**
 * CT-127-8 (T019) — the characterization test of the CONFIRMING PROBE: a probe
 * that confirms, a probe that refutes, and a probe at a reached cap
 * (F127-FR-006).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CONFIDENCES_THAT_NEED_A_PROBE } from "@specstride/contracts/ep/quota-classifier";
import {
  A_PROBE_IS_NOT,
  BLOCKED_REASON_AT_A_REACHED_CAP,
  CLASSES_THAT_CONFIRM,
  CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE,
  CONFIDENCES_THAT_PAUSE_AT_ONCE,
  confirmingProbe,
  needsAConfirmingProbe,
  pausesAtOnce,
  probeUsageRecord,
  reachedHardCeiling,
  type ProbeCallResult,
  type ProbePort,
  type ProbeRequest,
} from "../src/quota/probe.ts";
import { classify } from "../src/quota/classify.ts";
import { readCeiling } from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger, realCostUsd } from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const REQUEST: ProbeRequest = Object.freeze({
  role: "proposer",
  harness: "stub-harness",
  model: "stub-model",
  reason: "confirming-probe",
  usageId: "probe-1",
});

/** A probe port that counts its calls, so "one call" can be asserted. */
function port(result: ProbeCallResult): ProbePort & { calls: number } {
  const spy = {
    calls: 0,
    probe(request: ProbeRequest): ProbeCallResult {
      spy.calls += 1;
      assert.equal(request.role, REQUEST.role, "the same role as the failed call (§Q.2)");
      assert.equal(request.harness, REQUEST.harness, "the same harness adapter");
      assert.equal(request.model, REQUEST.model, "the same model");
      return result;
    },
  };
  return spy;
}

test("CT-127-8: the three confidences of §Q.2 pause only after a probe; the two others at once", () => {
  assert.deepEqual([...CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE], ["text", "stall", "host"]);
  assert.deepEqual([...CONFIDENCES_THAT_NEED_A_PROBE], [...CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE]);
  assert.deepEqual([...CONFIDENCES_THAT_PAUSE_AT_ONCE], ["structured", "status"]);
  for (const confidence of ["text", "stall", "host"] as const) {
    assert.equal(needsAConfirmingProbe(confidence), true);
    assert.equal(pausesAtOnce(confidence), false);
  }
  for (const confidence of ["structured", "status"] as const) {
    assert.equal(needsAConfirmingProbe(confidence), false);
    assert.equal(pausesAtOnce(confidence), true);
  }
});

/* ---------------------------------------------------------------- *
 * A probe that CONFIRMS.
 * ---------------------------------------------------------------- */

test("CT-127-8: a probe that fails with `quota_window` CONFIRMS, and the pause begins", async () => {
  const spy = port({
    ok: false,
    classification: classify({ structuredClass: "quota_window" }),
    costUsd: 0.0004,
    billingMode: "api",
  });
  const decision = await confirmingProbe(spy, REQUEST);
  assert.equal(spy.calls, 1, "ONE minimal real call (§Q.2)");
  assert.equal(decision.made, true);
  assert.equal(decision.calls, 1);
  assert.equal(decision.outcome, "confirmed");
  assert.equal(decision.pauses, true, "the pause begins (F127-FR-006)");
  assert.equal(decision.confirmedClass, "quota_window");
  assert.equal(decision.refutedAs, null);
  assert.equal(decision.blockedReason, null);
});

test("CT-127-8: a probe that fails with `quota_credit` also confirms, but credit does not pause", () => {
  assert.deepEqual([...CLASSES_THAT_CONFIRM], ["quota_window", "quota_credit"]);
});

test("CT-127-8: a confirmed `quota_credit` takes the credit path and not a pause", async () => {
  const spy = port({ ok: false, classification: classify({ status: { code: 402 } }) });
  const decision = await confirmingProbe(spy, REQUEST);
  assert.equal(decision.outcome, "confirmed");
  assert.equal(decision.confirmedClass, "quota_credit");
  assert.equal(
    decision.pauses,
    false,
    "no clock refills credit, so the confirmation is not a pause (§Q.1)",
  );
});

/* ---------------------------------------------------------------- *
 * A probe that REFUTES.
 * ---------------------------------------------------------------- */

test("CT-127-8: a probe that SUCCEEDS refutes, and the failure takes `provider_other`", async () => {
  const spy = port({ ok: true, costUsd: 0.0002, billingMode: "api" });
  const decision = await confirmingProbe(spy, REQUEST);
  assert.equal(spy.calls, 1);
  assert.equal(decision.outcome, "refuted");
  assert.equal(decision.pauses, false, "no pause begins (F127-FR-006)");
  assert.equal(decision.confirmedClass, null);
  assert.equal(decision.refutedAs, "provider_other", "the class of a probe that named none (§Q.2)");
});

test("CT-127-8: a probe that fails with another class refutes, and the failure takes THAT class", async () => {
  for (const quotaClass of ["auth", "overload", "context_window", "agent_failure"] as const) {
    const spy = port({ ok: false, classification: classify({ structuredClass: quotaClass }) });
    const decision = await confirmingProbe(spy, REQUEST);
    assert.equal(decision.outcome, "refuted", `${quotaClass} is not a limit class`);
    assert.equal(decision.pauses, false);
    assert.equal(
      decision.refutedAs,
      quotaClass,
      "the original failure takes the path of the refuted class (F127-FR-006)",
    );
  }
});

test("CT-127-8: a probe that fails with no classification at all refutes to `provider_other`", async () => {
  const spy = port({ ok: false });
  const decision = await confirmingProbe(spy, REQUEST);
  assert.equal(decision.outcome, "refuted");
  assert.equal(decision.refutedAs, "provider_other");
});

/* ---------------------------------------------------------------- *
 * The probe is real spend, and it is not a pass, an attempt or a call.
 * ---------------------------------------------------------------- */

test("CT-127-8: a probe is real spend in the ledger, and never a pass, an attempt or a call", async () => {
  const spy = port({
    ok: false,
    classification: classify({ structuredClass: "quota_window" }),
    costUsd: 0.01,
    billingMode: "api",
  });
  const decision = await confirmingProbe(spy, REQUEST);
  const record = decision.usageRecord;
  assert.ok(record !== null, "the probe produced a usage record");
  assert.equal(record.isProbe, true);
  assert.equal(record.closesAPass, false, "not a pass (F127-FR-006)");
  assert.equal(record.isCall, false, "not a call of the `calls` ceiling (§Q.3)");
  assert.deepEqual(decision.isNot, A_PROBE_IS_NOT);
  assert.equal(A_PROBE_IS_NOT.aPass, false);
  assert.equal(A_PROBE_IS_NOT.aPhaseAttempt, false);
  assert.equal(A_PROBE_IS_NOT.aCallOfTheCallsCeiling, false);
  assert.equal(A_PROBE_IS_NOT.spendOfThePassLimit, false);

  // And the ledger agrees: the cost is real spend, the counts do not move.
  const before = emptyLedger("run-1");
  const applied = applyUsageRecord(before, record);
  assert.equal(realCostUsd(applied.ledger, "proposer"), 0.01, "real spend (F127-FR-006)");
  assert.equal(applied.ledger.roles.proposer.probesUsd, 0.01, "in the probe field of the ledger");
  const bucket = applied.ledger.roles.proposer.byBilling.api;
  assert.equal(bucket?.calls, 0, "no call of the `calls` ceiling");
  assert.equal(bucket?.passesTotal, 0, "no pass");
  assert.equal(applied.ledger.run.phaseAttempts, 0, "no phase attempt");
});

/* ---------------------------------------------------------------- *
 * A probe at a reached cap.
 * ---------------------------------------------------------------- */

/** A reached hard cap of spend: a cost ceiling of 10 with 12 spent. */
function reachedCostCeiling() {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, {
    usageId: "u1",
    role: "proposer",
    billingMode: "api",
    costUsd: 12,
    isCall: true,
  }).ledger;
  return readCeiling(
    { dimension: "costUsd", scope: "role", role: "proposer", limit: 10 },
    { ledger },
  );
}

test("CT-127-8: a probe is NOT MADE when a hard ceiling of spend is already reached", async () => {
  const reading = reachedCostCeiling();
  assert.equal(reading.exhausted, true, "the cap of spend is reached");
  const spy = port({ ok: true });
  const decision = await confirmingProbe(spy, REQUEST, { ceilings: [reading] });
  assert.equal(spy.calls, 0, "the port was NEVER called (F127-FR-006)");
  assert.equal(decision.made, false);
  assert.equal(decision.calls, 0);
  assert.equal(decision.outcome, "not-made");
  assert.equal(decision.pauses, false, "no pause on weak evidence begins");
  assert.equal(decision.usageRecord, null, "and nothing was spent");
  assert.equal(decision.blockedReason, BLOCKED_REASON_AT_A_REACHED_CAP);
  assert.equal(decision.blockedReason, "budget-cap", "the run takes the budget path (F127-FR-034)");
  assert.equal(decision.ceilingReached?.key, reading.key);
});

test("CT-127-8: a ceiling that is not reached does not stop the probe", async () => {
  let ledger = emptyLedger("run-1");
  ledger = applyUsageRecord(ledger, {
    usageId: "u1",
    role: "proposer",
    billingMode: "api",
    costUsd: 1,
    isCall: true,
  }).ledger;
  const reading = readCeiling(
    { dimension: "costUsd", scope: "role", role: "proposer", limit: 10 },
    { ledger },
  );
  assert.equal(reading.exhausted, false);
  assert.equal(reachedHardCeiling([reading]), null);
  const spy = port({ ok: true });
  const decision = await confirmingProbe(spy, REQUEST, { ceilings: [reading] });
  assert.equal(spy.calls, 1);
  assert.equal(decision.made, true);
});

test("CT-127-8: a tripped wall-clock ceiling is not a cap of spend and does not stop the probe", async () => {
  const reading = readCeiling(
    { dimension: "wallClock", scope: "run", limit: 10 },
    { ledger: emptyLedger("run-1"), wallClockMinutes: 20 },
  );
  assert.equal(reading.exhausted, true);
  assert.equal(reading.isCapOfSpend, false, "a ceiling of time, not a cap of spend (§Q.3)");
  assert.equal(reachedHardCeiling([reading]), null);
  const spy = port({ ok: true });
  await confirmingProbe(spy, REQUEST, { ceilings: [reading] });
  assert.equal(spy.calls, 1);
});

test("CT-127-8: the usage record of a probe carries the harness, the model and the billing mode", () => {
  const record = probeUsageRecord(
    REQUEST,
    { ok: false, costUsd: 0.5, billingMode: "api" },
    { billingMode: "subscription" },
  );
  assert.equal(record.usageId, "probe-1");
  assert.equal(record.harness, "stub-harness");
  assert.equal(record.model, "stub-model");
  assert.equal(record.billingMode, "api", "the mode the call reported wins");
  const noMode = probeUsageRecord(REQUEST, { ok: true }, { billingMode: "subscription" });
  assert.equal(noMode.billingMode, "subscription", "else the role's mode");
  const neither = probeUsageRecord(REQUEST, { ok: true });
  assert.equal(neither.billingMode, "unknown");
});

test("CT-127-8 (checkpoint): the probe waits for nothing and writes no file itself", async () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const spy = port({ ok: true });
  await confirmingProbe(spy, REQUEST);
  assert.equal(ports.clock.nowMs(), before);
  assert.equal(ports.clock.sleeps.length, 0);
  assert.deepEqual(ports.fileWriter.writes, [], "the ledger write belongs to the caller");
});
