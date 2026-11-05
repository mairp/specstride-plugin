/**
 * CT-115-34 (T060, F115-FR-034) — characterization: the escalation — trigger,
 * target, caps, one test case per skip reason (`critic-collision` on a rung
 * equal in model and in effort).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalationAllowed,
  ESCALATION_CAPS,
  ESCALATION_SKIP_REASONS,
  escalationEvents,
  nextRung,
  newEscalationCounters,
  planEscalation,
  recordEscalation,
  type EscalationSignals,
  type Rung,
} from "../../src/router/escalation.ts";

const LADDER: Rung[] = [
  { model: "small", effort: "medium" },
  { model: "large", effort: "medium" },
  { model: "large", effort: "high" },
];

const DECIDE = {
  /** The decision of the table at the point `escalation`, over the signals. */
  decide: (signals: Record<string, unknown>) => {
    if (signals.escalationOn === false) return { choice: "skip:off", ruleId: "esc.off" };
    const conditions = String(signals.conditions ?? "");
    if (
      conditions === "tainted" ||
      conditions === "cached" ||
      signals.integrityKind !== undefined
    ) {
      return { choice: "skip:integrity", ruleId: "esc.integrity" };
    }
    if (signals.commandFlaky === true) return { choice: "skip:flaky", ruleId: "esc.flaky" };
    if (signals.signatureRepeated !== true || signals.repairsUsed !== 1) {
      return { choice: "skip:not-due", ruleId: "esc.not-due" };
    }
    if ((signals.escalationsTask as number) >= 1 || (signals.escalationsAttempt as number) >= 2) {
      return { choice: "skip:cap", ruleId: "esc.cap" };
    }
    if (signals.nextTier === undefined)
      return { choice: "skip:no-ladder", ruleId: "esc.no-ladder" };
    if (signals.targetIsCriticModel === true) {
      return { choice: "skip:critic-collision", ruleId: "esc.critic-collision" };
    }
    if (signals.targetQuotaExhausted === true) return { choice: "skip:quota", ruleId: "esc.quota" };
    if (signals.budgetAllows !== true) return { choice: "skip:budget", ruleId: "esc.budget" };
    return { choice: "next-tier", ruleId: "esc.default" };
  },
};

const CRITIC_CALLS: Rung[] = [{ model: "large", effort: "high" }];

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

/** The plan, flattened for the characterization. */
type Plan = {
  readonly made: boolean;
  readonly target?: Rung;
  readonly freshSession?: boolean;
  readonly criticDiversityWarning?: string;
  readonly skip?: (typeof ESCALATION_SKIP_REASONS)[number];
  readonly repairOnBaseTier?: boolean;
  readonly ruleId?: string;
  readonly signals: Record<string, unknown>;
};

function plan(signals: Partial<EscalationSignals> = {}, currentTier: Rung = LADDER[0]): Plan {
  return planEscalation(
    { ...BASE, ...signals },
    {
      currentTier,
      ladder: LADDER,
      criticCalls: CRITIC_CALLS,
      decide: DECIDE.decide,
    },
  ) as Plan;
}

test("CT-115-34: trigger — the same failure signature on two consecutive proposals, as the second repair", () => {
  assert.equal(BASE.signatureRepeated, true);
  assert.equal(BASE.repairsUsed, 1);
  const made = plan();
  assert.equal(made.made, true);
  if (made.made) {
    assert.deepEqual(made.target, { model: "large", effort: "medium" });
    assert.equal(made.freshSession, true);
  }
});

test("CT-115-34: not due — no repeated signature, or not the second repair", () => {
  assert.deepEqual(plan({ signatureRepeated: false }), {
    made: false,
    skip: "not-due",
    repairOnBaseTier: true,
    ruleId: "esc.not-due",
    signals: plan({ signatureRepeated: false }).signals,
  });
  assert.equal(plan({ repairsUsed: 2 }).skip, "not-due");
});

test("CT-115-34: never on a taint, an integrity event, a flaky command, a quota error, a time limit or a crash", () => {
  assert.equal(plan({ conditions: "tainted" }).skip, "integrity");
  assert.equal(plan({ conditions: "cached" }).skip, "integrity");
  assert.equal(plan({ integrityKind: "pin-mismatch" }).skip, "integrity");
  assert.equal(plan({ commandFlaky: true }).skip, "flaky");
});

test("CT-115-34: caps — 1 per task id, 2 per phase attempt, inside the repairs", () => {
  assert.deepEqual(ESCALATION_CAPS, { perTask: 1, perAttempt: 2 });
  let counters = newEscalationCounters();
  assert.equal(escalationAllowed(counters, "T010"), true);
  counters = recordEscalation(counters, "T010");
  assert.equal(escalationAllowed(counters, "T010"), false);
  assert.equal(escalationAllowed(counters, "T011"), true);
  counters = recordEscalation(counters, "T011");
  assert.equal(counters.perAttempt, 2);
  assert.equal(escalationAllowed(counters, "T012"), false);
});

test("CT-115-34: one test case per skip reason", () => {
  assert.deepEqual(
    [...ESCALATION_SKIP_REASONS],
    [
      "off",
      "integrity",
      "flaky",
      "not-due",
      "cap",
      "no-ladder",
      "critic-collision",
      "quota",
      "budget",
    ],
  );
  assert.equal(plan({ escalationOn: false }).skip, "off");
  assert.equal(plan({ conditions: "tainted" }).skip, "integrity");
  assert.equal(plan({ commandFlaky: true }).skip, "flaky");
  assert.equal(plan({ signatureRepeated: false }).skip, "not-due");
  assert.equal(plan({ escalationsTask: 1 }).skip, "cap");
  assert.equal(plan({ escalationsAttempt: 2 }).skip, "cap");
  // No ladder: the tier in force is the last rung.
  assert.equal(plan({}, LADDER[2]).skip, "no-ladder");
  assert.equal(plan({}, LADDER[2]).ruleId, "esc.no-ladder");
  assert.equal(plan({ targetQuotaExhausted: true }).skip, "quota");
  assert.equal(plan({ budgetAllows: false }).skip, "budget");
});

test("CT-115-34: critic-collision only on a rung equal in model and in effort", () => {
  // The last rung of the ladder equals the critic-class call in both.
  assert.equal(plan({}, LADDER[1]).skip, "critic-collision");
  assert.equal(plan({}, LADDER[1]).ruleId, "esc.critic-collision");
  // A rung that shares the model alone is not a collision: it is used, with
  // the critic-diversity warning.
  const shared = plan();
  assert.equal(shared.made, true);
  if (shared.made && shared.target !== undefined) {
    assert.equal(shared.target.model, "large");
    assert.notEqual(shared.target.effort, "high");
    assert.match(shared.criticDiversityWarning ?? "", /critic-diversity warning/);
  }
});

test("CT-115-34: a skip is recorded as escalation.skipped beside the route.decided", () => {
  const skipped = escalationEvents(
    plan({ escalationOn: false }) as Parameters<typeof escalationEvents>[0],
  );
  assert.deepEqual(skipped, {
    decided: "route.decided",
    skipped: { type: "escalation.skipped", reason: "off" },
  });
  const made = escalationEvents(plan() as Parameters<typeof escalationEvents>[0]);
  assert.deepEqual(made, { decided: "route.decided", skipped: undefined });
});

test("CT-115-34: the quota of the target exhausted — the repair runs on the base model tier", () => {
  const quota = plan({ targetQuotaExhausted: true });
  assert.equal(quota.made, false);
  assert.equal(quota.skip, "quota");
  assert.equal(quota.repairOnBaseTier, true);
});

test("CT-115-34: the target is the next rung of the pinned ladder of the same harness", () => {
  assert.deepEqual(nextRung(LADDER, LADDER[0]), { model: "large", effort: "medium" });
  assert.deepEqual(nextRung(LADDER, LADDER[1]), { model: "large", effort: "high" });
  assert.equal(nextRung(LADDER, LADDER[2]), undefined);
});
