/**
 * CT-127-23 (T046) — the characterization test of the ORDER OF EVENTS and of
 * an ENTRY WITHOUT A CAP (F127-FR-021).
 *
 * This is the INDEPENDENT TEST of user story 2: "the alert of kind
 * `billing-mode-change` and level `loud` precedes the first usage record of
 * the second entry".
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_KIND_BILLING_MODE_CHANGE,
  BILLING_MODE_CHANGE_APPEARS_IN,
  BILLING_MODE_CHANGE_LEVEL,
  BillingModeOrderError,
  MissingCapError,
  SKIP_REASON_NO_CAP,
  THE_LOUDEST_ALERT_OF_THE_PRODUCT,
  alertBeforeTheFirstCall,
  billingModeDedupeKey,
  capCheck,
  declaredCapOf,
  firstCallOnTheKey,
  hasADeclaredCap,
  isBillingModeChange,
  needsACap,
  openKeyGuard,
  prepareTheKey,
} from "../src/budget/fallback-billing.ts";
import { SKIP_REASONS, entryOf, walkFallback, type RolePlan } from "../src/budget/fallback.ts";
import { performSwitch } from "../src/budget/fallback-switch.ts";
import { ALERT_KINDS, ALERT_LEVELS } from "../src/budget/alerts.ts";
import { applyUsageRecord, emptyLedger, realCostUsd } from "../src/budget/ledger.ts";
import { testPorts } from "./support/index.ts";

const SUBSCRIPTION = entryOf(0, {
  harness: "stub-harness",
  model: "stub-base",
  authTier: 1,
  billingMode: "subscription",
});
const WITH_A_CAP = entryOf(1, {
  harness: "stub-api",
  model: "stub-metered",
  authTier: 1,
  billingMode: "api",
  capUsd: 25,
});
const WITHOUT_A_CAP = entryOf(2, {
  harness: "stub-api-nocap",
  authTier: 1,
  billingMode: "api",
  capUsd: null,
});

function planOf(entries: readonly ReturnType<typeof entryOf>[]): RolePlan {
  return {
    role: "proposer",
    primary: SUBSCRIPTION,
    entries,
    resolvedHarnesses: ["stub-harness", "stub-api", "stub-api-nocap", "stub-two"],
  };
}

test("CT-127-23: the kind and the level are fixed, and it is the loudest alert", () => {
  assert.equal(ALERT_KIND_BILLING_MODE_CHANGE, "billing-mode-change");
  assert.equal(BILLING_MODE_CHANGE_LEVEL, "loud");
  assert.equal(THE_LOUDEST_ALERT_OF_THE_PRODUCT, "billing-mode-change");
  assert.ok((ALERT_KINDS as readonly string[]).includes(ALERT_KIND_BILLING_MODE_CHANGE));
  assert.ok((ALERT_LEVELS as readonly string[]).includes(BILLING_MODE_CHANGE_LEVEL));
  assert.deepEqual(
    [...BILLING_MODE_CHANGE_APPEARS_IN],
    ["attention-items", "digest", "announcement-of-the-next-launch-or-resume"],
  );
});

test("CT-127-23: a subscription-to-API switch needs a cap; other switches do not", () => {
  assert.equal(needsACap("subscription", "api"), true);
  assert.equal(needsACap("unknown", "api"), true);
  assert.equal(needsACap("api", "api"), false, "already metered");
  assert.equal(needsACap("api", "subscription"), false);
  assert.equal(needsACap("subscription", "subscription"), false);
  assert.equal(isBillingModeChange("subscription", "api"), true);
  assert.equal(isBillingModeChange("api", "api"), false);
});

test("CT-127-23: a declared cap is a positive finite figure; 0 is OFF and not a cap", () => {
  assert.equal(declaredCapOf(WITH_A_CAP), 25);
  assert.equal(hasADeclaredCap(WITH_A_CAP), true);
  assert.equal(declaredCapOf(WITHOUT_A_CAP), null);
  assert.equal(hasADeclaredCap(WITHOUT_A_CAP), false);
  for (const off of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    const entry = entryOf(9, { harness: "h", billingMode: "api", capUsd: off as number | null });
    assert.equal(declaredCapOf(entry), null, String(off));
  }
  // The configured key `budget.role.<role>.costUsd` also declares one.
  assert.equal(declaredCapOf(WITHOUT_A_CAP, 10), 10);
});

test("CT-127-23: an entry WITHOUT a cap is skipped with `no-cap` and never used", () => {
  assert.equal(SKIP_REASON_NO_CAP, "no-cap");
  assert.ok((SKIP_REASONS as readonly string[]).includes(SKIP_REASON_NO_CAP));
  const ports = testPorts();
  const walk = walkFallback(
    planOf([WITHOUT_A_CAP, WITH_A_CAP]),
    [capCheck({ from: "subscription" })],
    { writer: ports.eventWriter },
  );
  assert.equal(walk.chosen?.harness, "stub-api", "the capped entry is used");
  assert.equal(walk.skipped.length, 1);
  assert.equal(walk.skipped[0].entry.harness, "stub-api-nocap");
  assert.equal(walk.skipped[0].reason, "no-cap");
  const payload = ports.eventWriter.of("fallback.skipped")[0].payload;
  assert.equal(payload.reason, "no-cap");
  assert.equal(payload.entryHarness, "stub-api-nocap");
});

test("CT-127-23: an entry without a cap cannot even be opened for use", () => {
  assert.throws(() => openKeyGuard(WITHOUT_A_CAP), MissingCapError);
  assert.throws(() => openKeyGuard(WITHOUT_A_CAP), /no declared cap/);
  // The walk is the only way it is reached, and it skips it; but a caller that
  // tries to use it directly is refused, not merely warned.
  const guard = openKeyGuard(WITHOUT_A_CAP, 10);
  assert.equal(guard.capUsd, 10, "a configured cap is a declared cap");
});

test("CT-127-23: the `loud` alert PRECEDES the first call on the key", () => {
  const ports = testPorts();
  const guard = openKeyGuard(WITH_A_CAP);
  assert.equal(guard.alerted, false, "the guard starts closed");
  assert.throws(() => firstCallOnTheKey(guard), BillingModeOrderError);
  assert.throws(() => firstCallOnTheKey(guard), /the alert precedes the first call on the key/);
  assert.deepEqual([...ports.eventWriter.types()], [], "no call, and no alert yet");

  const opened = alertBeforeTheFirstCall(ports.eventWriter, guard, {
    role: "proposer",
    from: "subscription",
  });
  assert.equal(opened.guard.alerted, true);
  const after = firstCallOnTheKey(opened.guard);
  assert.equal(after.calls, 1);
  assert.deepEqual([...ports.eventWriter.types()], ["alert"]);
});

test("CT-127-23: the alert carries the kind, the level and the cap as its limit", () => {
  const ports = testPorts();
  const { event } = prepareTheKey(ports.eventWriter, WITH_A_CAP, {
    role: "proposer",
    from: "subscription",
  });
  assert.equal(event.payload.kind, "billing-mode-change");
  assert.equal(event.payload.level, "loud");
  assert.equal(event.payload.role, "proposer");
  assert.equal(event.payload.limit, 25, "the cap that now applies");
  assert.equal(event.payload.threshold, null);
  assert.equal(event.payload.dedupeKey, billingModeDedupeKey("proposer"));
  assert.equal(billingModeDedupeKey("proposer"), "billing-mode-change:proposer:-");
});

test("CT-127-23: the ORDER is alert, then `fallback.switched`, then the first usage record", () => {
  const ports = testPorts();
  // 1. the loud alert, and the guard it opens
  const { guard } = prepareTheKey(ports.eventWriter, WITH_A_CAP, {
    role: "proposer",
    from: "subscription",
  });
  // 2. the switch itself
  performSwitch(ports.eventWriter, {
    role: "proposer",
    from: SUBSCRIPTION,
    to: WITH_A_CAP,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-1",
    boundaryAvailable: true,
  });
  // 3. the first call on the key, and the usage record it produces
  const called = firstCallOnTheKey(guard);
  assert.equal(called.calls, 1);
  const applied = applyUsageRecord(emptyLedger("run-1"), {
    usageId: "u-1",
    role: "proposer",
    billingMode: "api",
    harness: "stub-api",
    costUsd: 3,
    isCall: true,
  });
  ports.eventWriter.emit({ type: "usage", payload: { usageId: "u-1", role: "proposer" } });

  const types = [...ports.eventWriter.types()];
  assert.deepEqual(types, ["alert", "fallback.switched", "usage"]);
  assert.ok(
    types.indexOf("alert") < types.indexOf("usage"),
    "the loud alert precedes the first usage record of the second entry (user story 2)",
  );
  assert.ok(types.indexOf("alert") < types.indexOf("fallback.switched"));
  assert.equal(realCostUsd(applied.ledger, "proposer"), 3, "the key is what was billed");
});

test("CT-127-23: a usage record on the key cannot be produced before the alert", () => {
  const ports = testPorts();
  const guard = openKeyGuard(WITH_A_CAP);
  // The only way to a call is through the guard, and it is closed.
  assert.throws(() => firstCallOnTheKey(guard), BillingModeOrderError);
  assert.equal(ports.eventWriter.countOf("usage"), 0);
  assert.equal(ports.eventWriter.countOf("alert"), 0);
});

test("CT-127-23: every later call on the key is allowed once the alert was written", () => {
  const ports = testPorts();
  const { guard } = prepareTheKey(ports.eventWriter, WITH_A_CAP, {
    role: "proposer",
    from: "subscription",
  });
  let current = guard;
  for (let index = 0; index < 3; index += 1) current = firstCallOnTheKey(current);
  assert.equal(current.calls, 3);
  assert.equal(ports.eventWriter.countOf("alert"), 1, "one alert, not one per call");
});

test("CT-127-23: a switch that does NOT change the billing mode needs no cap and no alert", () => {
  const ports = testPorts();
  const other = entryOf(1, { harness: "stub-two", billingMode: "subscription" });
  const walk = walkFallback(planOf([other]), [capCheck({ from: "subscription" })], {
    writer: ports.eventWriter,
  });
  assert.equal(walk.chosen?.harness, "stub-two");
  assert.deepEqual([...ports.eventWriter.types()], [], "nothing was skipped and nothing alerted");
});
