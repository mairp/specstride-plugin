/**
 * CT-127-6 (T016) — the characterization test of the ACTION of each class of
 * §Q.1 and of the BOUNDS of the pass-level retries (F127-FR-004).
 *
 * §Q.1 is transcribed here from the specification, column by column, and
 * compared with `../src/quota/actions.ts` row by row. The two bounds are then
 * tested at and either side of their edge: a wait that reaches
 * `quota.transientMaxWaitMs` is read as `quota_window` (the run pauses), and a
 * retry that reaches `quota.overloadRetries` is an ordinary provider error.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CLASSES } from "@specstride/contracts/ep/quota-classifier";
import {
  ACTION_BY_CLASS,
  CLASSES_OF_Q1,
  DEFAULT_RETRY_BOUNDS,
  actionFor,
  actionForClassification,
} from "../src/quota/actions.ts";
import { classify } from "../src/quota/classify.ts";
import { testPorts } from "./support/index.ts";

/** §Q.1, transcribed from the specification: the action and the two count columns. */
const SECTION_Q1 = Object.freeze({
  quota_window: { action: "pause-role", countsAs: "neither", spends: "no" },
  quota_credit: { action: "fallback-or-blocked", countsAs: "neither", spends: "no" },
  rate_limit_transient: { action: "wait-in-pass", countsAs: "neither", spends: "no" },
  overload: {
    action: "retry-with-backoff",
    countsAs: "error-after-the-cap",
    spends: "after-the-cap",
  },
  auth: { action: "blocked-on-human", countsAs: "neither", spends: "no" },
  context_window: { action: "error-path", countsAs: "error", spends: "yes" },
  agent_failure: { action: "error-path", countsAs: "error", spends: "yes" },
  provider_other: { action: "error-path", countsAs: "error", spends: "yes" },
  budget_cap: { action: "budget-path", countsAs: "budget-stop", spends: "cap-counter-only" },
});

test("CT-127-6: §Q.1 has one row per class, and the engine acts on the class only", () => {
  assert.equal(CLASSES_OF_Q1.length, 9);
  for (const quotaClass of CLASSES) {
    const row = ACTION_BY_CLASS[quotaClass];
    const expected = SECTION_Q1[quotaClass];
    assert.equal(row.action, expected.action, `the action of ${quotaClass} (§Q.1)`);
    assert.equal(row.countsAs, expected.countsAs, `what ${quotaClass} counts as (§Q.1)`);
    assert.equal(row.spends, expected.spends, `what ${quotaClass} spends (§Q.1)`);
  }
});

test("CT-127-6: the action of each class, through `actionFor`", () => {
  for (const quotaClass of CLASSES) {
    const decision = actionFor(quotaClass);
    assert.equal(decision.quotaClass, quotaClass, "no bound was reached, so the class stands");
    assert.equal(decision.action, SECTION_Q1[quotaClass].action);
    assert.equal(decision.boundReached, false);
  }
});

test("CT-127-6: `quota_window` pauses the role and spends nothing", () => {
  const decision = actionFor("quota_window");
  assert.equal(decision.action, "pause-role");
  assert.equal(decision.spendsNothing, true);
  assert.equal(decision.countsAsAConsecutiveError, false);
  assert.equal(decision.blockedReason, null);
});

test("CT-127-6: `quota_credit` and `auth` name their blocked reason", () => {
  assert.equal(actionFor("quota_credit").blockedReason, "quota-credit");
  assert.equal(actionFor("quota_credit").action, "fallback-or-blocked");
  assert.equal(actionFor("auth").blockedReason, "auth");
  assert.equal(actionFor("auth").action, "blocked-on-human", "no retry and no fallback (§Q.1)");
});

test("CT-127-6: the three classes of the error path spend what an error spends", () => {
  for (const quotaClass of ["context_window", "agent_failure", "provider_other"] as const) {
    const decision = actionFor(quotaClass);
    assert.equal(decision.action, "error-path");
    assert.equal(decision.spends, "yes");
    assert.equal(decision.spendsNothing, false);
  }
});

test("CT-127-6: `budget_cap` takes the budget path and never a relaunch", () => {
  const decision = actionFor("budget_cap");
  assert.equal(decision.action, "budget-path");
  assert.equal(decision.countsAs, "budget-stop");
  assert.equal(decision.spends, "cap-counter-only");
  assert.equal(decision.countsAsAConsecutiveError, false);
});

/* ---------------------------------------------------------------- *
 * The two bounds of F127-FR-004.
 * ---------------------------------------------------------------- */

test("CT-127-6: the defaults of the two bounds are the ones of row 111", () => {
  assert.equal(DEFAULT_RETRY_BOUNDS.transientMaxWaitMs, 60_000);
  assert.equal(DEFAULT_RETRY_BOUNDS.overloadRetries, 3);
});

test("CT-127-6: a wait inside the bound keeps `rate_limit_transient` in the pass", () => {
  const inside = actionFor("rate_limit_transient", { waitedMs: 59_999 });
  assert.equal(inside.quotaClass, "rate_limit_transient");
  assert.equal(inside.action, "wait-in-pass");
  assert.equal(inside.boundReached, false);
  assert.equal(inside.spendsNothing, true);
});

test("CT-127-6: a wait PAST `quota.transientMaxWaitMs` is read as `quota_window`", () => {
  for (const waitedMs of [60_000, 60_001, 3_600_000]) {
    const past = actionFor("rate_limit_transient", { waitedMs });
    assert.equal(past.quotaClass, "quota_window", `a wait of ${waitedMs} ms reached the bound`);
    assert.equal(past.classifiedAs, "rate_limit_transient", "the class it was classified as");
    assert.equal(past.action, "pause-role", "the run pauses (F127-FR-004)");
    assert.equal(past.boundReached, true);
    assert.equal(past.countsAsAConsecutiveError, false, "and it still spends nothing");
    assert.ok(past.note.includes("quota.transientMaxWaitMs"));
  }
});

test("CT-127-6: the bound of the wait can be set lower by the consumer", () => {
  const bounds = { transientMaxWaitMs: 5_000, overloadRetries: 3 };
  assert.equal(
    actionFor("rate_limit_transient", { waitedMs: 4_999 }, bounds).quotaClass,
    "rate_limit_transient",
  );
  assert.equal(
    actionFor("rate_limit_transient", { waitedMs: 5_000 }, bounds).quotaClass,
    "quota_window",
  );
});

test("CT-127-6: a retry inside the bound keeps `overload` retrying with backoff", () => {
  for (const retries of [0, 1, 2]) {
    const inside = actionFor("overload", { retries });
    assert.equal(inside.quotaClass, "overload");
    assert.equal(inside.action, "retry-with-backoff");
    assert.equal(inside.boundReached, false);
    assert.equal(
      inside.countsAsAConsecutiveError,
      false,
      "`overload` counts only AFTER its cap (§Q.1)",
    );
  }
});

test("CT-127-6: a retry PAST `quota.overloadRetries` is an ordinary provider error", () => {
  for (const retries of [3, 4, 99]) {
    const past = actionFor("overload", { retries });
    assert.equal(past.quotaClass, "provider_other", `${retries} retries reached the bound`);
    assert.equal(past.classifiedAs, "overload");
    assert.equal(past.action, "error-path", "an ordinary provider error (F127-FR-004)");
    assert.equal(past.boundReached, true);
    assert.equal(past.countsAsAConsecutiveError, true, "and it now counts (§Q.1)");
    assert.equal(past.spends, "yes");
    assert.ok(past.note.includes("quota.overloadRetries"));
  }
});

test("CT-127-6: the bound of the retries can be set lower by the consumer", () => {
  const bounds = { transientMaxWaitMs: 60_000, overloadRetries: 1 };
  assert.equal(actionFor("overload", { retries: 0 }, bounds).quotaClass, "overload");
  assert.equal(actionFor("overload", { retries: 1 }, bounds).quotaClass, "provider_other");
});

test("CT-127-6: a bound applies to its own class only", () => {
  // A long wait or many retries changes nothing for any other class.
  for (const quotaClass of CLASSES) {
    if (quotaClass === "rate_limit_transient" || quotaClass === "overload") continue;
    const decision = actionFor(quotaClass, { waitedMs: 10_000_000, retries: 99 });
    assert.equal(decision.quotaClass, quotaClass, `${quotaClass} has no bound in §Q.1`);
    assert.equal(decision.boundReached, false);
  }
});

test("CT-127-6: the same decision is reached from a classification", () => {
  const classification = classify({ status: { code: 429 } });
  assert.equal(classification.quotaClass, "rate_limit_transient");
  const inside = actionForClassification(classification, { waitedMs: 0 });
  assert.equal(inside.action, "wait-in-pass");
  const past = actionForClassification(classification, { waitedMs: 60_000 });
  assert.equal(past.quotaClass, "quota_window");
  assert.equal(past.action, "pause-role");
});

test("CT-127-6 (checkpoint): the action is decided with no clock", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  for (const quotaClass of CLASSES) actionFor(quotaClass, { waitedMs: 60_000, retries: 3 });
  assert.equal(ports.clock.nowMs(), before, "the bounds are compared, never waited through");
  assert.equal(ports.clock.sleeps.length, 0);
});
