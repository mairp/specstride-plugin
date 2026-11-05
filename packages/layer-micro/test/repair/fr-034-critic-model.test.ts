/**
 * CT-115-161 (T139, F115-FR-034; IR-47) — characterization: a rung that
 * shares the model of a critic-class call and differs in effort is used,
 * `targetSharesCriticModel` is recorded in `route.decided` and the
 * critic-diversity warning is raised and recorded; a rung equal in model
 * and in effort is skipped with `critic-collision`. Stub agents only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planEscalation,
  escalationEvents,
  type EscalationSignals,
  type Rung,
} from "../../src/router/escalation.ts";
import { layerEvent } from "../../src/report/events.ts";

const LADDER: Rung[] = [
  { model: "small", effort: "medium" },
  { model: "critic", effort: "medium" }, // shares the critic model, other effort
  { model: "critic", effort: "high" }, // equals the critic call in both
];

/** The critic-class call of the run: model `critic`, effort `high`. */
const CRITIC_CALLS: Rung[] = [{ model: "critic", effort: "high" }];

const DECIDE = (signals: Record<string, unknown>) => {
  if (signals.nextTier === undefined) return { choice: "skip:no-ladder", ruleId: "esc.no-ladder" };
  if (signals.targetIsCriticModel === true) {
    return { choice: "skip:critic-collision", ruleId: "esc.critic-collision" };
  }
  return { choice: "next-tier", ruleId: "esc.default" };
};

const BASE: EscalationSignals = {
  escalationOn: true,
  conditions: "",
  commandFlaky: false,
  signatureRepeated: true,
  repairsUsed: 1,
  escalationsTask: 0,
  escalationsAttempt: 0,
  targetQuotaExhausted: false,
  budgetAllows: true,
};

function plan(currentTier: Rung) {
  return planEscalation(BASE, {
    currentTier,
    ladder: LADDER,
    criticCalls: CRITIC_CALLS,
    decide: DECIDE,
  });
}

test("CT-115-161: a rung that shares the model alone is used, with the warning and the signal", () => {
  const made = plan(LADDER[0]);
  assert.ok(made.made);
  if (!made.made) return;
  assert.deepEqual(made.target, { model: "critic", effort: "medium" });
  assert.equal(made.freshSession, true);
  // The signal, recorded beside the route.decided of the decision.
  assert.equal(made.signals.targetSharesCriticModel, true);
  assert.equal(made.signals.targetIsCriticModel, false);
  // The critic-diversity warning is raised and recorded with the escalation.
  assert.match(made.criticDiversityWarning ?? "", /shares the model/);
  assert.match(made.criticDiversityWarning ?? "", /differs from it in effort/);
  // The events of the decision: one route.decided, no skip.
  assert.deepEqual(escalationEvents(made), {
    decided: "route.decided",
    skipped: undefined,
  });
  // The signal travels on the recorded event of the decision point.
  const decided = layerEvent("route.decided", {
    ruleId: made.ruleId,
    targetSharesCriticModel: made.signals.targetSharesCriticModel,
  });
  assert.equal(decided.fields.targetSharesCriticModel, true);
});

test("CT-115-161: a rung equal in model and in effort is skipped with critic-collision", () => {
  const skipped = plan(LADDER[1]);
  assert.deepEqual(skipped, {
    made: false,
    skip: "critic-collision",
    repairOnBaseTier: true,
    signals: skipped.made ? {} : skipped.signals,
    ruleId: "esc.critic-collision",
  });
  assert.equal(skipped.made ? undefined : skipped.signals.targetIsCriticModel, true);
  assert.equal(skipped.made ? undefined : skipped.signals.targetSharesCriticModel, false);
  // The skip is recorded as escalation.skipped beside the route.decided.
  assert.deepEqual(escalationEvents(skipped), {
    decided: "route.decided",
    skipped: { type: "escalation.skipped", reason: "critic-collision" },
  });
});

test("CT-115-161: IR-47 — no target equals a critic-class call in model and in effort", () => {
  // The pairing of the target against the critic-class calls, for every
  // rung of the ladder: equality in both is exactly the collision.
  const pairing = (target: Rung) => ({
    targetIsCriticModel:
      target.model === CRITIC_CALLS[0].model && target.effort === CRITIC_CALLS[0].effort,
    targetSharesCriticModel:
      target.model === CRITIC_CALLS[0].model && target.effort !== CRITIC_CALLS[0].effort,
  });
  assert.deepEqual(pairing(LADDER[0]), {
    targetIsCriticModel: false,
    targetSharesCriticModel: false,
  });
  assert.deepEqual(pairing(LADDER[1]), {
    targetIsCriticModel: false,
    targetSharesCriticModel: true,
  });
  assert.deepEqual(pairing(LADDER[2]), {
    targetIsCriticModel: true,
    targetSharesCriticModel: false,
  });
});
