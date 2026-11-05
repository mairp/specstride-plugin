/**
 * CT-127-20 (T041) — the characterization test of the WIDENING key, OFF BY
 * DEFAULT, and REFUSED IN PROJECT CONFIGURATION (F127-FR-018).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FALLBACK_AFTER_MS,
  FALLBACK_AFTER_MS_KEY_TEMPLATE,
  FALLBACK_KEY_TEMPLATE,
  FALLBACK_OFF_BY_DEFAULT,
  FALLBACK_RETURN_KEY_TEMPLATE,
  FALLBACK_SCOPE,
  FALLBACK_TRUST_CLASS,
  NOTHING_IS_RESOLVED_AFTER_LAUNCH,
  entriesFromRolePlan,
  entryOf,
  fallbackAfterMsKeyOf,
  fallbackKeyOf,
  fallbackReturnKeyOf,
  isFallbackKey,
  notInPlan,
  readAuthTier,
  refuseProjectFallbackKey,
  trustClassOfFallbackKey,
  walkFallback,
  type RolePlan,
} from "../src/budget/fallback.ts";
import { TRUST_CLASSES } from "@specstride/contracts/envelope/trust-classes";
import { testPorts } from "./support/index.ts";

const PRIMARY = entryOf(0, {
  harness: "stub-harness",
  model: "stub-base",
  authTier: 1,
  billingMode: "subscription",
});

function planWith(entries: readonly ReturnType<typeof entryOf>[]): RolePlan {
  return {
    role: "proposer",
    primary: PRIMARY,
    entries,
    resolvedHarnesses: ["stub-harness", "stub-api"],
  };
}

test("CT-127-20: the key is `roles.<role>.fallback`, with its two companions", () => {
  assert.equal(FALLBACK_KEY_TEMPLATE, "roles.<role>.fallback");
  assert.equal(FALLBACK_AFTER_MS_KEY_TEMPLATE, "roles.<role>.fallbackAfterMs");
  assert.equal(FALLBACK_RETURN_KEY_TEMPLATE, "roles.<role>.fallbackReturn");
  assert.equal(fallbackKeyOf("proposer"), "roles.proposer.fallback");
  assert.equal(fallbackAfterMsKeyOf("critic"), "roles.critic.fallbackAfterMs");
  assert.equal(fallbackReturnKeyOf("proposer"), "roles.proposer.fallbackReturn");
});

test("CT-127-20: the trust class of every fallback key is `widening`", () => {
  assert.equal(FALLBACK_TRUST_CLASS, "widening");
  assert.ok(
    (TRUST_CLASSES as readonly string[]).includes(FALLBACK_TRUST_CLASS),
    "the class is one of the four of annex X §X.2",
  );
  for (const key of [
    "roles.proposer.fallback",
    "roles.proposer.fallbackAfterMs",
    "roles.critic.fallbackReturn",
  ]) {
    assert.equal(isFallbackKey(key), true, key);
    assert.equal(trustClassOfFallbackKey(key), "widening", key);
  }
  // A key of another feature is not claimed by this one.
  for (const other of [
    "budget.run.tokens",
    "pause.maxTotalMs",
    "roles.proposer",
    "loop.maxWallMin",
  ]) {
    assert.equal(isFallbackKey(other), false, other);
    assert.equal(trustClassOfFallbackKey(other), undefined, other);
  }
});

test("CT-127-20: a fallback may only be set in user scope", () => {
  assert.equal(FALLBACK_SCOPE, "user");
});

test("CT-127-20: a fallback is OFF BY DEFAULT — the empty list", () => {
  assert.deepEqual([...FALLBACK_OFF_BY_DEFAULT], []);
  assert.equal(FALLBACK_OFF_BY_DEFAULT.length, 0);
  assert.equal(Object.isFrozen(FALLBACK_OFF_BY_DEFAULT), true);
  assert.equal(DEFAULT_FALLBACK_AFTER_MS, 0, "the delay default is 0: switch at once");
  // A plan with no entries walks to nothing, and emits nothing.
  const ports = testPorts();
  const walk = walkFallback(planWith([]), [], { writer: ports.eventWriter });
  assert.equal(walk.chosen, null);
  assert.equal(walk.exhausted, true);
  assert.deepEqual([...walk.skipped], []);
  assert.deepEqual([...ports.eventWriter.types()], []);
});

test("CT-127-20: project configuration cannot set it — the key is dropped", () => {
  const outcome = refuseProjectFallbackKey("roles.proposer.fallback", [
    { harness: "stub-api", billingMode: "api", capUsd: 25 },
  ]);
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.key, "roles.proposer.fallback");
  if (outcome.accepted === false) {
    assert.equal(outcome.reason, "widening");
    assert.match(outcome.launchMessage, /cannot widen a run/);
    assert.match(outcome.launchMessage, /roles\.proposer\.fallback/);
    assert.match(outcome.doctorWarning, /widening key/);
    assert.match(outcome.doctorWarning, /is ignored/);
  }
});

test("CT-127-20: the companions are refused in project configuration too", () => {
  for (const key of ["roles.proposer.fallbackAfterMs", "roles.proposer.fallbackReturn"]) {
    const outcome = refuseProjectFallbackKey(key, 0, 60_000);
    assert.equal(outcome.accepted, false, key);
    if (outcome.accepted === false) assert.equal(outcome.reason, "widening", key);
  }
});

test("CT-127-20: a smaller value in project configuration is still refused", () => {
  // A widening key is dropped whatever its value: `fallbackAfterMs` of 0 is
  // "switch at once", which is wider, and a large value is not narrower either
  // — the class, not the comparison, decides (F100-FR-202).
  const zero = refuseProjectFallbackKey("roles.proposer.fallbackAfterMs", 0, 3_600_000);
  const large = refuseProjectFallbackKey("roles.proposer.fallbackAfterMs", 3_600_000, 0);
  assert.equal(zero.accepted, false);
  assert.equal(large.accepted, false);
});

test("CT-127-20: the entries come from the role plan, and nothing is resolved after launch", () => {
  assert.equal(NOTHING_IS_RESOLVED_AFTER_LAUNCH, true);
  const inPlan = entryOf(0, { harness: "stub-api", billingMode: "api", capUsd: 10 });
  const outside = entryOf(1, {
    harness: "a-harness-nobody-resolved",
    billingMode: "api",
    capUsd: 10,
  });
  const plan = planWith([inPlan, outside]);
  assert.deepEqual(
    entriesFromRolePlan(plan).map((entry) => entry.harness),
    ["stub-api", "a-harness-nobody-resolved"],
  );
  assert.equal(notInPlan(plan, inPlan), false);
  assert.equal(notInPlan(plan, outside), true);

  const ports = testPorts();
  const walk = walkFallback(planWith([outside, inPlan]), [], { writer: ports.eventWriter });
  assert.equal(walk.chosen?.harness, "stub-api", "the resolved entry is taken");
  assert.equal(walk.skipped.length, 1);
  assert.equal(walk.skipped[0].reason, "not-in-plan");
  assert.deepEqual([...ports.eventWriter.types()], ["fallback.skipped"]);
  const payload = ports.eventWriter.of("fallback.skipped")[0].payload;
  assert.equal(payload.reason, "not-in-plan");
  assert.equal(payload.entryHarness, "a-harness-nobody-resolved");
  assert.equal(payload.role, "proposer");
});

test("CT-127-20: an entry names a harness and MAY name a model and an auth tier", () => {
  const bare = entryOf(3, { harness: "stub-api" });
  assert.equal(bare.harness, "stub-api");
  assert.equal(bare.model, null, "a model is optional");
  assert.equal(bare.authTier, 3, "an unnamed auth tier reads as the strictest, 3");
  assert.equal(bare.provider, "stub-api", "the provider defaults to the harness");
  assert.equal(bare.billingMode, "unknown", "an unnamed billing mode is `unknown`");
  assert.equal(bare.capUsd, null);
  const full = entryOf(4, { harness: "stub-api", model: "m", authTier: 2, billingMode: "api" });
  assert.equal(full.model, "m");
  assert.equal(full.authTier, 2);
  assert.equal(full.billingMode, "api");
});

test("CT-127-20: an auth tier outside 1, 2 and 3 reads as 3", () => {
  assert.equal(readAuthTier(1), 1);
  assert.equal(readAuthTier(2), 2);
  assert.equal(readAuthTier(3), 3);
  assert.equal(readAuthTier(0), 3);
  assert.equal(readAuthTier(4), 3);
  assert.equal(readAuthTier(null), 3);
  assert.equal(readAuthTier(undefined), 3);
});
