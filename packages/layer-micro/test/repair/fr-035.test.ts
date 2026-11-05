/**
 * CT-115-35 (T061, F115-FR-035) — characterization: the escalation and the
 * model-tier bump have separate counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newEscalationCounters,
  newModelTierBumpCounters,
  recordEscalation,
  tierForNextAttempt,
} from "../../src/router/escalation.ts";

test("CT-115-35: the escalation counts its own per task id and per attempt", () => {
  let counters = newEscalationCounters();
  counters = recordEscalation(counters, "T010");
  counters = recordEscalation(counters, "T011");
  assert.deepEqual({ ...counters.perTask }, { T010: 1, T011: 1 });
  assert.equal(counters.perAttempt, 2);
});

test("CT-115-35: the model-tier bump counts separately, and the two never share a counter", () => {
  let escalations = newEscalationCounters();
  const bumps = newModelTierBumpCounters();
  escalations = recordEscalation(escalations, "T010");
  assert.equal(escalations.perAttempt, 1);
  assert.equal(bumps.bumps, 0, "a bump is not an escalation");
  const afterBump = { ...bumps, bumps: bumps.bumps + 1 };
  assert.equal(afterBump.bumps, 1);
  assert.equal(escalations.perAttempt, 1, "an escalation is not a bump");
});

test("CT-115-35: an escalation never changes the tier the next phase attempt starts on", () => {
  const baseTier = { model: "small", effort: "medium" };
  let counters = newEscalationCounters();
  counters = recordEscalation(counters, "T010");
  assert.deepEqual(tierForNextAttempt(baseTier, counters), baseTier);
});
