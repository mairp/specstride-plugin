/**
 * CT-127-11 (T023) — the characterization test of a LIMITED ESCALATION TARGET
 * being skipped while the base model runs (F127-FR-009, ruling 47).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSES_THAT_LIMIT_A_TARGET,
  SKIP_REASON_LIMITED,
  clearLimitWindow,
  decideEscalation,
  earliestReset,
  emptyWindowState,
  headroomOf,
  isLimited,
  limitedTargets,
  observeClassification,
  observeLimitWindow,
  readLimitWindow,
  targetKey,
  type Target,
} from "../src/quota/windows.ts";
import { classify } from "../src/quota/classify.ts";
import { fallbackSkipped } from "../src/quota/events.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const BASE: Target = Object.freeze({ harness: "stub-harness", modelTier: "base" });
const ESCALATION: Target = Object.freeze({ harness: "stub-harness", modelTier: "escalation" });

const NOW = DEFAULT_START_MS; // 2026-01-01T00:00:00.000Z
const IN_FIVE_HOURS = new Date(NOW + 5 * 60 * 60 * 1000).toISOString();

/** A state in which the escalation target alone is limited. */
function escalationLimited() {
  return observeLimitWindow(emptyWindowState(), {
    target: ESCALATION,
    quotaClass: "quota_window",
    resetsAt: IN_FIVE_HOURS,
    utilization: 1,
    rateLimitType: "tokens-per-window",
    observedAt: new Date(NOW).toISOString(),
  });
}

test("CT-127-11: the state is kept per harness and model tier", () => {
  assert.equal(targetKey(BASE), "stub-harness/base");
  assert.equal(targetKey(ESCALATION), "stub-harness/escalation");
  const state = escalationLimited();
  assert.deepEqual(Object.keys(state), ["stub-harness/escalation"]);
  const fact = state["stub-harness/escalation"];
  assert.equal(fact.quotaClass, "quota_window");
  assert.equal(fact.resetsAt, IN_FIVE_HOURS);
  assert.equal(fact.utilization, 1);
  assert.equal(fact.rateLimitType, "tokens-per-window");
  assert.equal(fact.observedAt, new Date(NOW).toISOString());
});

test("CT-127-11: the query answers whether a target is limited", () => {
  const state = escalationLimited();
  assert.equal(isLimited(state, ESCALATION, NOW), true);
  assert.equal(isLimited(state, BASE, NOW), false, "the base model was never limited");
  const reading = readLimitWindow(state, ESCALATION, NOW);
  assert.equal(reading.limited, true);
  assert.equal(reading.msUntilReset, 5 * 60 * 60 * 1000);
  assert.equal(reading.utilization, 1);
  assert.deepEqual([...CLASSES_THAT_LIMIT_A_TARGET], ["quota_window", "quota_credit"]);
});

test("CT-127-11: a limited escalation target is SKIPPED and the work runs on the base model", () => {
  const state = escalationLimited();
  const decision = decideEscalation(state, BASE, ESCALATION, NOW);
  assert.equal(decision.skipped, true, "the escalation target is skipped (ruling 47)");
  assert.deepEqual(decision.runsOn, BASE, "the work runs on the base model");
  assert.equal(decision.reason, SKIP_REASON_LIMITED);
  assert.equal(decision.reason, "limited", "a member of row 208 of annex X §X.6");
  assert.equal(
    decision.pausesTheRun,
    false,
    "the exhaustion does NOT pause the run while the base model is open (F127-FR-009)",
  );
  assert.equal(decision.baseIsLimited, false);
});

test("CT-127-11: the skip is recorded, as the event `fallback.skipped`", () => {
  const ports = testPorts();
  const decision = decideEscalation(escalationLimited(), BASE, ESCALATION, NOW);
  assert.ok(decision.record !== null, "the skip carries a record (F127-FR-009)");
  fallbackSkipped(ports.eventWriter, {
    entry: 1,
    entryHarness: String(decision.record.harness),
    entryProvider: "stub-provider",
    authTier: "1",
    audience: "personal",
    reason: String(decision.record.reason),
    role: "proposer",
  });
  assert.deepEqual(ports.eventWriter.types(), ["fallback.skipped"]);
  const payload = ports.eventWriter.of("fallback.skipped")[0].payload;
  assert.equal(payload.reason, "limited");
  assert.equal(payload.entryHarness, "stub-harness");
  assert.equal(decision.record.model, "escalation", "the record names the skipped model tier");
  assert.equal(decision.record.ranOn, "stub-harness/base", "and it records what ran instead");
});

test("CT-127-11: an escalation target that is not limited is used", () => {
  const decision = decideEscalation(emptyWindowState(), BASE, ESCALATION, NOW);
  assert.equal(decision.skipped, false);
  assert.deepEqual(decision.runsOn, ESCALATION);
  assert.equal(decision.reason, null);
  assert.equal(decision.record, null, "nothing to record");
});

test("CT-127-11: a limited base model is reported, and the pause comes from its own signal", () => {
  let state = escalationLimited();
  state = observeLimitWindow(state, {
    target: BASE,
    quotaClass: "quota_window",
    resetsAt: IN_FIVE_HOURS,
    utilization: 1,
    rateLimitType: null,
    observedAt: new Date(NOW).toISOString(),
  });
  const decision = decideEscalation(state, BASE, ESCALATION, NOW);
  assert.equal(decision.skipped, true);
  assert.equal(decision.baseIsLimited, true, "the decision says so");
  assert.equal(
    decision.pausesTheRun,
    false,
    "and still does not pause by itself: the base model's own signal does that",
  );
});

test("CT-127-11: a window that has reset no longer limits the target", () => {
  const state = escalationLimited();
  const afterTheReset = NOW + 5 * 60 * 60 * 1000 + 1;
  assert.equal(isLimited(state, ESCALATION, afterTheReset), false);
  const decision = decideEscalation(state, BASE, ESCALATION, afterTheReset);
  assert.equal(decision.skipped, false, "the escalation target is open again");
});

test("CT-127-11: a fact with no reset time holds until a success clears it", () => {
  let state = observeLimitWindow(emptyWindowState(), {
    target: ESCALATION,
    quotaClass: "quota_credit",
    resetsAt: null,
    utilization: null,
    rateLimitType: null,
    observedAt: new Date(NOW).toISOString(),
  });
  assert.equal(
    isLimited(state, ESCALATION, NOW + 10 * 24 * 60 * 60 * 1000),
    true,
    "no clock refills credit",
  );
  state = clearLimitWindow(state, ESCALATION);
  assert.equal(isLimited(state, ESCALATION, NOW), false, "a success cleared it");
  assert.deepEqual(Object.keys(state), []);
});

test("CT-127-11: a class that is not a limit does not limit the target", () => {
  for (const quotaClass of ["rate_limit_transient", "overload", "provider_other"] as const) {
    const state = observeClassification(
      emptyWindowState(),
      ESCALATION,
      classify({ structuredClass: quotaClass }),
      new Date(NOW).toISOString(),
    );
    assert.equal(isLimited(state, ESCALATION, NOW), false, `${quotaClass} is not a limited target`);
  }
});

test("CT-127-11: the query feature 142 calls gives the headroom of a target", () => {
  const state = escalationLimited();
  const closed = headroomOf(state, ESCALATION, NOW);
  assert.equal(closed.open, false);
  assert.equal(closed.reason, "limited");
  assert.equal(closed.msUntilReset, 5 * 60 * 60 * 1000);
  assert.equal(closed.utilizationUsed, 1);
  const open = headroomOf(state, BASE, NOW);
  assert.equal(open.open, true);
  assert.equal(open.reason, null);
});

test("CT-127-11: the limited targets and the earliest reset are reported for the whole run", () => {
  let state = escalationLimited();
  const sooner = new Date(NOW + 60 * 60 * 1000).toISOString();
  state = observeLimitWindow(state, {
    target: { harness: "other-harness", modelTier: "base" },
    quotaClass: "quota_window",
    resetsAt: sooner,
    utilization: null,
    rateLimitType: null,
    observedAt: new Date(NOW).toISOString(),
  });
  const limited = limitedTargets(state, NOW);
  assert.equal(limited.length, 2);
  assert.equal(earliestReset(state, NOW), sooner, "the earliest reset of the two (F127-FR-023)");
});

test("CT-127-11 (checkpoint): the state and the query read no clock", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const state = escalationLimited();
  decideEscalation(state, BASE, ESCALATION, ports.clock.nowMs());
  headroomOf(state, BASE, ports.clock.nowMs());
  assert.equal(ports.clock.nowMs(), before, "`now` is an argument");
  assert.deepEqual(ports.fileWriter.writes, []);
});
