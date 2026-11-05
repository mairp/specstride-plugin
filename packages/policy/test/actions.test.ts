/**
 * T011 — the unit tests of the action per class of §Q.1 and of the counting
 * rule of the error counter (F127-FR-004, F127-FR-005).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  A_QUOTA_CLASS_SPENDS,
  CLASSES,
  type QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";
import {
  ACTION_BY_CLASS,
  applyToConsecutiveErrors,
  actionFor,
  actionForClassification,
  AS_IS_ERROR_PATH,
  CLASSES_OF_Q1,
  CLASSES_THAT_SPEND_NOTHING,
  countsAsAConsecutiveError,
  DEFAULT_RETRY_BOUNDS,
  THE_SIX_COUNTS,
} from "../src/quota/actions.ts";
import { classify } from "../src/quota/classify.ts";
import { RETRYABLE_BY_CLASS } from "../src/quota/table.ts";

test("T011: §Q.1 holds a row for each of the nine classes, and no tenth", () => {
  assert.equal(CLASSES_OF_Q1.length, 9);
  assert.deepEqual([...CLASSES_OF_Q1], [...CLASSES]);
  for (const quotaClass of CLASSES) {
    const row = ACTION_BY_CLASS[quotaClass];
    assert.equal(row.quotaClass, quotaClass);
    assert.equal(row.retryable, RETRYABLE_BY_CLASS[quotaClass], quotaClass);
    assert.ok(row.meaning.length > 0, quotaClass);
  }
});

test("T011: the action of each class is the one of the row of §Q.1", () => {
  const expected: Readonly<Record<QuotaClass, string>> = {
    quota_window: "pause-role",
    quota_credit: "fallback-or-blocked",
    rate_limit_transient: "wait-in-pass",
    overload: "retry-with-backoff",
    auth: "blocked-on-human",
    context_window: "error-path",
    agent_failure: "error-path",
    provider_other: "error-path",
    budget_cap: "budget-path",
  };
  for (const quotaClass of CLASSES) {
    assert.equal(actionFor(quotaClass).action, expected[quotaClass], quotaClass);
  }
});

test("T011: the columns 'Counts as' and 'Spends' of §Q.1", () => {
  assert.equal(ACTION_BY_CLASS.quota_window.countsAs, "neither");
  assert.equal(ACTION_BY_CLASS.quota_window.spends, "no");
  assert.equal(ACTION_BY_CLASS.quota_credit.countsAs, "neither");
  assert.equal(ACTION_BY_CLASS.rate_limit_transient.spends, "no");
  assert.equal(ACTION_BY_CLASS.overload.countsAs, "error-after-the-cap");
  assert.equal(ACTION_BY_CLASS.overload.spends, "after-the-cap");
  assert.equal(ACTION_BY_CLASS.auth.spends, "no");
  assert.equal(ACTION_BY_CLASS.context_window.spends, "yes");
  assert.equal(ACTION_BY_CLASS.agent_failure.spends, "yes");
  assert.equal(ACTION_BY_CLASS.provider_other.spends, "yes");
  assert.equal(ACTION_BY_CLASS.budget_cap.countsAs, "budget-stop");
  assert.equal(ACTION_BY_CLASS.budget_cap.spends, "cap-counter-only");
  assert.deepEqual(
    [...CLASSES_THAT_SPEND_NOTHING],
    ["quota_window", "quota_credit", "rate_limit_transient", "auth"],
  );
});

test("T011: the blocked reason of the classes that rest on a human (F127-FR-017)", () => {
  assert.equal(ACTION_BY_CLASS.quota_credit.blockedReason, "quota-credit");
  assert.equal(ACTION_BY_CLASS.auth.blockedReason, "auth");
  assert.equal(ACTION_BY_CLASS.budget_cap.blockedReason, "budget-cap");
  assert.equal(ACTION_BY_CLASS.quota_window.blockedReason, null);
});

test("T011: a wait past quota.transientMaxWaitMs is read as quota_window (F127-FR-004)", () => {
  const under = actionFor("rate_limit_transient", { waitedMs: 59_999 });
  assert.equal(under.quotaClass, "rate_limit_transient");
  assert.equal(under.action, "wait-in-pass");
  assert.equal(under.boundReached, false);

  const at = actionFor("rate_limit_transient", { waitedMs: 60_000 });
  assert.equal(at.quotaClass, "quota_window", "read as quota_window at the bound");
  assert.equal(at.classifiedAs, "rate_limit_transient");
  assert.equal(at.action, "pause-role");
  assert.equal(at.boundReached, true);
  assert.equal(at.countsAsAConsecutiveError, false, "a pause counts no error");
  assert.match(at.note, /quota\.transientMaxWaitMs/);

  // A consumer that lowers the bound sees it sooner.
  const lowered = actionFor(
    "rate_limit_transient",
    { waitedMs: 1_000 },
    {
      ...DEFAULT_RETRY_BOUNDS,
      transientMaxWaitMs: 500,
    },
  );
  assert.equal(lowered.quotaClass, "quota_window");
});

test("T011: a retry past quota.overloadRetries is an ordinary provider error (F127-FR-004)", () => {
  const under = actionFor("overload", { retries: 2 });
  assert.equal(under.quotaClass, "overload");
  assert.equal(under.action, "retry-with-backoff");
  assert.equal(under.countsAsAConsecutiveError, false, "before the cap, it counts nothing");
  assert.equal(under.spends, "after-the-cap");

  const at = actionFor("overload", { retries: 3 });
  assert.equal(at.quotaClass, "provider_other", "an ordinary provider error");
  assert.equal(at.classifiedAs, "overload");
  assert.equal(at.action, "error-path");
  assert.equal(at.boundReached, true);
  assert.equal(at.countsAsAConsecutiveError, true, "and now it counts (F127-FR-005)");
  assert.equal(at.spends, "yes");
  assert.match(at.note, /quota\.overloadRetries/);
});

test("T011: the counter of consecutive errors counts only the three of F127-FR-005", () => {
  const counted: QuotaClass[] = [];
  for (const quotaClass of CLASSES) {
    if (countsAsAConsecutiveError(quotaClass)) counted.push(quotaClass);
  }
  assert.deepEqual(counted, ["agent_failure", "provider_other"]);
  assert.equal(countsAsAConsecutiveError("overload", false), false);
  assert.equal(countsAsAConsecutiveError("overload", true), true, "`overload` after its cap");
  // `context_window` is on the error path and is NOT a consecutive error.
  assert.equal(countsAsAConsecutiveError("context_window"), false);
  assert.equal(ACTION_BY_CLASS.context_window.action, "error-path");
});

test("T011: no quota class spends a reject, a pass, a MALFORMED count, an error, the budgets", () => {
  assert.equal(THE_SIX_COUNTS.length, 6);
  for (const count of THE_SIX_COUNTS) {
    assert.equal(A_QUOTA_CLASS_SPENDS[count], false, count);
  }
  for (const quotaClass of CLASSES_THAT_SPEND_NOTHING) {
    assert.equal(actionFor(quotaClass).spendsNothing, true, quotaClass);
  }
});

test("T011: the as-is path of a failure that is not a quota class (F127-FR-005)", () => {
  assert.deepEqual(
    { ...AS_IS_ERROR_PATH },
    {
      passLoopResult: 7,
      exitCode: 4,
      stopReason: "proposer_consecutive_errors",
    },
  );
});

test("T011: the counter moves only for a decision that counts", () => {
  const counts = actionFor("provider_other");
  assert.deepEqual(applyToConsecutiveErrors(2, counts), { counter: 3, counted: true });
  const pauses = actionFor("quota_window");
  assert.deepEqual(applyToConsecutiveErrors(2, pauses), { counter: 2, counted: false });
  const overloadUnderCap = actionFor("overload", { retries: 0 });
  assert.deepEqual(applyToConsecutiveErrors(2, overloadUnderCap), { counter: 2, counted: false });
  const overloadOverCap = actionFor("overload", { retries: 9 });
  assert.deepEqual(applyToConsecutiveErrors(2, overloadOverCap), { counter: 3, counted: true });
});

test("T011: the action can be taken straight from a classification", () => {
  const classification = classify({ status: { code: 429 } });
  assert.equal(classification.quotaClass, "rate_limit_transient");
  const decision = actionForClassification(classification, { waitedMs: 70_000 });
  assert.equal(decision.quotaClass, "quota_window");
  assert.equal(decision.action, "pause-role");
});

test("T011: a non-finite bound falls back to the default of profile row 111", () => {
  const decision = actionFor(
    "overload",
    { retries: 3 },
    {
      transientMaxWaitMs: Number.NaN,
      overloadRetries: Number.POSITIVE_INFINITY,
    },
  );
  assert.equal(decision.quotaClass, "provider_other", "the default of 3 was used");
  assert.equal(DEFAULT_RETRY_BOUNDS.transientMaxWaitMs, 60_000);
  assert.equal(DEFAULT_RETRY_BOUNDS.overloadRetries, 3);
});
