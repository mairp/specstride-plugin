/**
 * CT-127-21 (T042) — the characterization test of the TRIGGER, the DELAY and
 * the WAIT WHEN THE RESET COMES FIRST (F127-FR-019).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_NEVER_TRIGGERS_A_FALLBACK,
  DEFAULT_FALLBACK_AFTER_MS,
  TRIGGER_ACTS,
  TRIGGER_CLASSES,
  isTriggerClass,
  triggerDecision,
} from "../src/budget/fallback.ts";
import { QUOTA_CLASSES } from "../src/quota/classify.ts";
import { AUTH_TAKES_NO_FALLBACK } from "../src/quota/blocked.ts";
import { DEFAULT_START_MS } from "./support/index.ts";

const NOW = DEFAULT_START_MS; // 2026-01-01T00:00:00.000Z
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

test("CT-127-21: the trigger is `quota_window` or `quota_credit`, and nothing else", () => {
  assert.deepEqual([...TRIGGER_CLASSES], ["quota_window", "quota_credit"]);
  for (const quotaClass of QUOTA_CLASSES) {
    const expected = quotaClass === "quota_window" || quotaClass === "quota_credit";
    assert.equal(isTriggerClass(quotaClass), expected, quotaClass);
  }
  assert.deepEqual([...TRIGGER_ACTS], ["switch", "wait", "none"]);
});

test("CT-127-21: `auth` never triggers a fallback", () => {
  assert.equal(AUTH_NEVER_TRIGGERS_A_FALLBACK, true);
  assert.equal(AUTH_TAKES_NO_FALLBACK, true, "the blocked path of US1 says the same");
  const decision = triggerDecision({
    quotaClass: "auth",
    sinceMs: NOW,
    nowMs: NOW + HOUR,
    entryCount: 2,
  });
  assert.equal(decision.act, "none");
  assert.equal(decision.reason, "auth-never-triggers");
});

test("CT-127-21: a class of no quota kind is no trigger", () => {
  for (const quotaClass of [
    "overload",
    "rate_limit_transient",
    "context_window",
    "agent_failure",
  ]) {
    const decision = triggerDecision({ quotaClass, sinceMs: NOW, nowMs: NOW, entryCount: 2 });
    assert.equal(decision.act, "none", quotaClass);
    assert.equal(decision.reason, "no-trigger-class", quotaClass);
  }
});

test("CT-127-21: an empty list is no trigger — a fallback is off by default", () => {
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    entryCount: 0,
  });
  assert.equal(decision.act, "none");
  assert.equal(decision.reason, "no-list");
});

test("CT-127-21: the default delay of 0 switches AT ONCE", () => {
  assert.equal(DEFAULT_FALLBACK_AFTER_MS, 0);
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    entryCount: 2,
  });
  assert.equal(decision.act, "switch");
  assert.equal(decision.reason, "delay-passed");
  assert.equal(decision.waitMs, 0);
  assert.equal(decision.dueAtMs, NOW);
});

test("CT-127-21: the delay must have PASSED before the switch", () => {
  const afterMs = 30 * MINUTE;
  const early = triggerDecision({
    quotaClass: "quota_credit",
    sinceMs: NOW,
    nowMs: NOW + 10 * MINUTE,
    afterMs,
    entryCount: 1,
  });
  assert.equal(early.act, "wait");
  assert.equal(early.reason, "delay-not-passed");
  assert.equal(early.waitMs, 20 * MINUTE, "exactly the time still to wait");
  assert.equal(early.dueAtMs, NOW + afterMs);

  const onTheDot = triggerDecision({
    quotaClass: "quota_credit",
    sinceMs: NOW,
    nowMs: NOW + afterMs,
    afterMs,
    entryCount: 1,
  });
  assert.equal(onTheDot.act, "switch", "the boundary itself is `passed`");

  const late = triggerDecision({
    quotaClass: "quota_credit",
    sinceMs: NOW,
    nowMs: NOW + afterMs + 1,
    afterMs,
    entryCount: 1,
  });
  assert.equal(late.act, "switch");
});

test("CT-127-21: the role WAITS where the reset comes before the delay is over", () => {
  const afterMs = HOUR;
  // The window resets in ten minutes; the delay would switch in an hour.
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    afterMs,
    resetsAt: iso(NOW + 10 * MINUTE),
    entryCount: 3,
  });
  assert.equal(decision.act, "wait", "it does not switch at all");
  assert.equal(decision.reason, "reset-before-delay");
  assert.equal(decision.waitMs, 10 * MINUTE, "it waits for the reset, not for the delay");
  assert.equal(decision.resetsAtMs, NOW + 10 * MINUTE);
  assert.equal(decision.dueAtMs, NOW + afterMs);
});

test("CT-127-21: a reset exactly at the end of the delay is still a wait", () => {
  const afterMs = HOUR;
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    afterMs,
    resetsAt: iso(NOW + afterMs),
    entryCount: 1,
  });
  assert.equal(decision.act, "wait");
  assert.equal(decision.reason, "reset-before-delay");
});

test("CT-127-21: a reset AFTER the delay does not stop the switch", () => {
  const afterMs = 10 * MINUTE;
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW + afterMs,
    afterMs,
    resetsAt: iso(NOW + 5 * HOUR),
    entryCount: 1,
  });
  assert.equal(decision.act, "switch");
  assert.equal(decision.reason, "delay-passed");
  assert.equal(decision.resetsAtMs, NOW + 5 * HOUR);
});

test("CT-127-21: `quota_credit` with no reset time switches once the delay has passed", () => {
  // Credit that no clock refills: there is no reset to wait for.
  const decision = triggerDecision({
    quotaClass: "quota_credit",
    sinceMs: NOW,
    nowMs: NOW + MINUTE,
    afterMs: MINUTE,
    resetsAt: null,
    entryCount: 2,
  });
  assert.equal(decision.act, "switch");
  assert.equal(decision.resetsAtMs, null);
});

test("CT-127-21: an unreadable or absent delay falls back to the default", () => {
  for (const afterMs of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const decision = triggerDecision({
      quotaClass: "quota_window",
      sinceMs: NOW,
      nowMs: NOW,
      afterMs: afterMs as number | undefined,
      entryCount: 1,
    });
    assert.equal(decision.act, "switch", String(afterMs));
    assert.equal(decision.dueAtMs, NOW, String(afterMs));
  }
  // A negative delay is read as 0 and never as a switch in the past.
  const negative = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    afterMs: -5_000,
    entryCount: 1,
  });
  assert.equal(negative.dueAtMs, NOW);
});

test("CT-127-21: an unreadable reset time is treated as no reset time", () => {
  const decision = triggerDecision({
    quotaClass: "quota_window",
    sinceMs: NOW,
    nowMs: NOW,
    resetsAt: "not-a-time",
    entryCount: 1,
  });
  assert.equal(decision.resetsAtMs, null);
  assert.equal(decision.act, "switch");
});
