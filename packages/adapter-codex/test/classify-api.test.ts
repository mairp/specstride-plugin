/**
 * T052 / CT-131-33 — the quota classes with an API key (F131-FR-033).
 *
 * With an API key (auth tier 2): the status 429 without the body code of
 * exhausted credit classifies `rate_limit_transient` with the confidence
 * `status`; the body code `insufficient_quota` classifies `quota_credit`
 * (`blocked-on-human`); the status 401 classifies `auth` and names what to
 * fix; what matches no entry classifies `provider_other` with the confidence
 * `text`. Every classification carries a value of `retryable`, and the value
 * follows the class (feature 100, annex E §E.3): true for `quota_window`,
 * `rate_limit_transient`, `overload`, `agent_failure` and `provider_other`;
 * false for `quota_credit`, `auth`, `context_window` and `budget_cap`. No
 * entry of the data lacks the value or states another one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure, loadClassifier, QUOTA_CLASSES } from "../src/login-text.ts";

const CLASSIFIER = loadClassifier();

test("CT-131-33: status 429 without the credit code is rate_limit_transient / status / retryable", () => {
  const classification = classifyFailure({ status: 429, bodyCode: null }, CLASSIFIER);
  assert.equal(classification.class, "rate_limit_transient");
  assert.equal(classification.confidence, "status");
  assert.equal(classification.retryable, true);
});

test("CT-131-33: the exhausted-credit body code is quota_credit / status / not retryable / blocked-on-human", () => {
  const classification = classifyFailure(
    { status: 429, bodyCode: "insufficient_quota" },
    CLASSIFIER,
  );
  assert.equal(classification.class, "quota_credit");
  assert.equal(classification.confidence, "status");
  assert.equal(classification.retryable, false);
  assert.equal(classification.state, "blocked-on-human");
});

test("CT-131-33: status 401 is auth and names what to fix", () => {
  const classification = classifyFailure({ status: 401, bodyCode: null }, CLASSIFIER);
  assert.equal(classification.class, "auth");
  assert.equal(classification.confidence, "status");
  assert.equal(classification.retryable, false);
  assert.ok(classification.message !== null);
  assert.match(classification.message, /OPENAI_API_KEY/);
});

test("CT-131-33: what matches no entry is provider_other with the confidence text", () => {
  const classification = classifyFailure(
    { status: 503, bodyCode: "something_undocumented", errorText: "boom" },
    CLASSIFIER,
  );
  assert.equal(classification.class, "provider_other");
  assert.equal(classification.confidence, "text");
  assert.equal(classification.retryable, true);
  assert.equal(classification.resetsAt, null);
});

test("CT-131-33: retryable has a value for each of the nine classes, with the annex E §E.3 value", () => {
  assert.deepEqual([...QUOTA_CLASSES].sort(), [
    "agent_failure",
    "auth",
    "budget_cap",
    "context_window",
    "overload",
    "provider_other",
    "quota_credit",
    "quota_window",
    "rate_limit_transient",
  ]);
  const expected: Record<string, boolean> = {
    quota_window: true,
    rate_limit_transient: true,
    overload: true,
    agent_failure: true,
    provider_other: true,
    quota_credit: false,
    auth: false,
    context_window: false,
    budget_cap: false,
  };
  assert.deepEqual({ ...CLASSIFIER.retryableByClass }, expected);
  assert.equal(CLASSIFIER.retryableByClass.provider_other, true);
});

test("CT-131-33: no entry of the classifier lacks retryable or states another value", () => {
  assert.ok(CLASSIFIER.entries.length >= 5);
  for (const entry of CLASSIFIER.entries) {
    assert.equal(typeof entry.retryable, "boolean", `entry ${entry.id} carries no retryable value`);
    assert.equal(
      entry.retryable,
      CLASSIFIER.retryableByClass[entry.class],
      `entry ${entry.id} states a retryable the class does not carry`,
    );
  }
});
