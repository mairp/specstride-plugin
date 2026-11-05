/**
 * CT-127-24 (T048) — the characterization test of a SWITCH AT A BOUNDARY and
 * INSIDE A PHASE ATTEMPT, and of an ESCALATION THAT IS NOT A FALLBACK
 * (F127-FR-022).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  A_FALLBACK_NEVER_PUTS_A_CRITIC_IN_THE_PROPOSERS_SESSION,
  CHANGE_KINDS,
  CONTEXT_CARRIED_THROUGH,
  CRITIC_DIVERSITY_WARNING,
  CRITIC_DIVERSITY_WARNING_BLOCKS,
  CriticSessionError,
  ESCALATION_IS_NOT_A_FALLBACK,
  EscalationError,
  SESSION_AFTER_A_SWITCH,
  SWITCH_AT_A_BOUNDARY_WHERE_POSSIBLE,
  SWITCH_POINTS,
  assertNoCriticInTheProposersSession,
  classifyChange,
  criticDiversity,
  isEscalation,
  performSwitch,
  placeSwitch,
} from "../src/budget/fallback-switch.ts";
import { entryOf } from "../src/budget/fallback.ts";
import { testPorts } from "./support/index.ts";

const PRIMARY = entryOf(0, {
  harness: "stub-harness",
  model: "stub-base",
  billingMode: "subscription",
  modelTier: "base",
});
const FALLBACK = entryOf(1, {
  harness: "stub-api",
  model: "stub-metered",
  billingMode: "api",
  capUsd: 25,
  modelTier: "base",
});
const ESCALATED = entryOf(0, {
  harness: "stub-harness",
  model: "stub-big",
  billingMode: "subscription",
  modelTier: "escalation",
});

test("CT-127-24: a switch happens at a phase-attempt boundary where possible", () => {
  assert.equal(SWITCH_AT_A_BOUNDARY_WHERE_POSSIBLE, true);
  assert.deepEqual([...SWITCH_POINTS], ["phase-attempt-boundary", "inside-phase-attempt"]);
  const atBoundary = placeSwitch({ boundaryAvailable: true });
  assert.equal(atBoundary.at, "phase-attempt-boundary");
  assert.equal(atBoundary.deferredToTheBoundary, true);
});

test("CT-127-24: a switch INSIDE a phase attempt starts a FRESH session, context through files", () => {
  const inside = placeSwitch({ boundaryAvailable: false });
  assert.equal(inside.at, "inside-phase-attempt");
  assert.equal(inside.session, "fresh");
  assert.equal(inside.contextThrough, "files");
  assert.equal(inside.deferredToTheBoundary, false);
  assert.equal(SESSION_AFTER_A_SWITCH, "fresh");
  assert.equal(CONTEXT_CARRIED_THROUGH, "files");
  // A boundary switch also runs in a fresh session: the boundary starts one.
  assert.equal(placeSwitch({ boundaryAvailable: true }).session, "fresh");
});

test("CT-127-24: `fallback.switched` carries the entries, the reason, the phase attempt and the change of billing mode", () => {
  const ports = testPorts();
  const result = performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: FALLBACK,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-2",
    boundaryAvailable: true,
  });
  assert.deepEqual([...ports.eventWriter.types()], ["fallback.switched"]);
  const payload = result.event.payload;
  assert.equal(payload.from, "stub-harness/stub-base");
  assert.equal(payload.to, "stub-api/stub-metered");
  assert.equal(payload.reason, "quota_window");
  assert.equal(payload.role, "proposer");
  assert.equal(payload.phaseAttempt, "phase-3/attempt-2");
  assert.equal(payload.billingModeFrom, "subscription");
  assert.equal(payload.billingModeTo, "api");
  assert.equal(payload.billingModeChanged, true);
  assert.equal(payload.at, "phase-attempt-boundary");
  assert.equal(payload.session, "fresh");
  assert.equal(result.change.kind, "fallback");
});

test("CT-127-24: a switch inside a phase attempt records that it was inside", () => {
  const ports = testPorts();
  const result = performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: FALLBACK,
    reason: "quota_credit",
    phaseAttempt: "phase-4/attempt-1",
    boundaryAvailable: false,
  });
  assert.equal(result.placement.at, "inside-phase-attempt");
  assert.equal(result.event.payload.at, "inside-phase-attempt");
  assert.equal(result.event.payload.session, "fresh");
});

test("CT-127-24: an ESCALATION is not a fallback and does not change the billing mode", () => {
  assert.equal(ESCALATION_IS_NOT_A_FALLBACK, true);
  assert.deepEqual([...CHANGE_KINDS], ["fallback", "escalation"]);
  assert.equal(isEscalation(PRIMARY, ESCALATED), true, "same harness, higher tier");
  assert.equal(isEscalation(PRIMARY, FALLBACK), false, "another harness");
  const change = classifyChange(PRIMARY, ESCALATED);
  assert.equal(change.kind, "escalation");
  assert.equal(change.billingModeChanged, false);
  assert.equal(change.billingModeFrom, "subscription");
  assert.equal(change.billingModeTo, "subscription");
});

test("CT-127-24: an escalation that WOULD change the billing mode is refused", () => {
  const meteredEscalation = entryOf(0, {
    harness: "stub-harness",
    model: "stub-big",
    billingMode: "api",
    capUsd: 25,
    modelTier: "escalation",
  });
  assert.throws(() => classifyChange(PRIMARY, meteredEscalation), EscalationError);
  assert.throws(
    () => classifyChange(PRIMARY, meteredEscalation),
    /does not count as a fallback and does not change the billing mode/,
  );
});

test("CT-127-24: a change of model on the same harness and tier is a fallback, not an escalation", () => {
  const sibling = entryOf(1, {
    harness: "stub-harness",
    model: "stub-other",
    billingMode: "subscription",
    modelTier: "base",
  });
  assert.equal(isEscalation(PRIMARY, sibling), false);
  assert.equal(classifyChange(PRIMARY, sibling).kind, "fallback");
});

test("CT-127-24: the critic-diversity warning is raised and does NOT block", () => {
  assert.equal(CRITIC_DIVERSITY_WARNING_BLOCKS, false);
  const critic = entryOf(0, { harness: "stub-api", model: "stub-metered", billingMode: "api" });
  const diversity = criticDiversity({ proposerAfterTheSwitch: FALLBACK, critic });
  assert.equal(diversity.sameModel, true);
  assert.equal(diversity.warning, CRITIC_DIVERSITY_WARNING);
  assert.match(CRITIC_DIVERSITY_WARNING, /same model/);
  assert.equal(diversity.blocks, false);

  // And the switch goes through all the same.
  const ports = testPorts();
  const result = performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: FALLBACK,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-1",
    boundaryAvailable: true,
    critic,
  });
  assert.equal(result.diversity?.sameModel, true);
  assert.equal(result.event.payload.criticDiversityWarning, true);
  assert.deepEqual([...ports.eventWriter.types()], ["fallback.switched"], "the switch happened");
});

test("CT-127-24: a different critic model raises no warning", () => {
  const critic = entryOf(0, { harness: "another-harness", model: "c", billingMode: "api" });
  const diversity = criticDiversity({ proposerAfterTheSwitch: FALLBACK, critic });
  assert.equal(diversity.sameModel, false);
  assert.equal(diversity.warning, null);
  const ports = testPorts();
  const result = performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: FALLBACK,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-1",
    boundaryAvailable: true,
    critic,
  });
  assert.equal(result.event.payload.criticDiversityWarning, false);
});

test("CT-127-24: two entries of one harness with no model named are the same model", () => {
  const a = entryOf(1, { harness: "h", billingMode: "api" });
  const b = entryOf(0, { harness: "h", billingMode: "api" });
  assert.equal(criticDiversity({ proposerAfterTheSwitch: a, critic: b }).sameModel, true);
});

test("CT-127-24: a fallback NEVER puts a critic into the session of the proposer", () => {
  assert.equal(A_FALLBACK_NEVER_PUTS_A_CRITIC_IN_THE_PROPOSERS_SESSION, true);
  assert.throws(
    () =>
      assertNoCriticInTheProposersSession({
        proposerSessionId: "s-1",
        criticSessionId: "s-1",
      }),
    CriticSessionError,
  );
  assert.doesNotThrow(() =>
    assertNoCriticInTheProposersSession({ proposerSessionId: "s-1", criticSessionId: "s-2" }),
  );
});

test("CT-127-24: the switch is refused BEFORE any event where the session would be shared", () => {
  const ports = testPorts();
  assert.throws(
    () =>
      performSwitch(ports.eventWriter, {
        role: "proposer",
        from: PRIMARY,
        to: FALLBACK,
        reason: "quota_window",
        phaseAttempt: "phase-3/attempt-1",
        boundaryAvailable: true,
        sessions: { proposerSessionId: "s-1", criticSessionId: "s-1" },
      }),
    CriticSessionError,
  );
  assert.deepEqual([...ports.eventWriter.types()], [], "nothing was written");
});

test("CT-127-24: a switch with two sessions of their own is written", () => {
  const ports = testPorts();
  performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: FALLBACK,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-1",
    boundaryAvailable: true,
    sessions: { proposerSessionId: "s-1", criticSessionId: "s-2" },
  });
  assert.equal(ports.eventWriter.countOf("fallback.switched"), 1);
});
