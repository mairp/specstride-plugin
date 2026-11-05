/**
 * T024 — CT-124-38, CT-124-39 and CT-124-42 (F124-FR-038, F124-FR-039,
 * F124-FR-042).
 *
 * CT-124-38: a candidate qualifies only when all conditions Q1 to Q10 of
 * `packages/harness/data/qualification.json` hold; the first condition that
 * fails is recorded, one case per condition and per reason.
 *
 * CT-124-39: an unverified harness of kind `cli` never qualifies; an
 * unverified endpoint may; the form `read-only-tools` qualifies only
 * through a tested harness adapter.
 *
 * CT-124-42: a metered candidate without a spending cap does not qualify,
 * with the reason `no-spend-cap`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  QUALIFICATION_RULE_IDS,
  QUALIFICATION_TABLE_ID,
  QUALIFICATION_TABLE_VERSION,
  MIN_CRITIC_WINDOW_TOKENS,
  qualifies,
  diversityOf,
  type QualificationSignal,
} from "../../src/roles/qualify.ts";
import { reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver } from "@specstride/contracts/enums/all-sets";
import { candidate } from "./critic-fixtures.ts";

/** A qualification signal for a candidate that passes everything. */
function signal(overrides: Partial<QualificationSignal> = {}): QualificationSignal {
  return {
    candidate: candidate(),
    supportsCriticRole: true,
    testedAdapter: true,
    modelId: "model-a",
    providerId: "provider-a",
    proposerModel: "default-model",
    proposerProvider: "provider-default",
    credentialPresent: true,
    preflightAuthOk: true,
    quotaExhausted: false,
    budgetInForce: true,
    capUsd: 5,
    readDenialConfirmed: true,
    ...overrides,
  };
}

test("CT-124-38 the data holds Q1 to Q10 in order, with reasons of the closed set 182", () => {
  assert.deepEqual(QUALIFICATION_RULE_IDS, [
    "Q1",
    "Q2",
    "Q3",
    "Q4",
    "Q5",
    "Q6",
    "Q7",
    "Q8",
    "Q9",
    "Q10",
  ]);
  assert.equal(QUALIFICATION_TABLE_ID, "critic-qualification");
  assert.equal(QUALIFICATION_TABLE_VERSION, "1");
  assert.ok(reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver.has("no-spend-cap"));
});

test("CT-124-38 a fully qualified candidate qualifies, and every reason has its case", () => {
  assert.equal(qualifies(signal()).qualifies, true);

  // One case per condition, and per reason the data gives.
  const fails = (overrides: Partial<QualificationSignal>, reason: string, ruleId: string) => {
    const outcome = qualifies(signal(overrides));
    assert.equal(outcome.qualifies, false, `${ruleId}: expected a refusal`);
    assert.equal(outcome.ruleId, ruleId, `${ruleId}: the rule id`);
    assert.equal(outcome.reason, reason, `${ruleId}: the reason`);
  };

  fails({ supportsCriticRole: false }, "role-unsupported", "Q1");
  fails(
    {
      testedAdapter: false,
      candidate: candidate({
        completionForm: { value: "read-only-tools", provenance: "declared" },
      }),
    },
    "form-unproven",
    "Q2",
  );
  fails({ candidate: candidate({ state: "declared", kind: "cli" }) }, "unverified-cli", "Q2");
  fails(
    { candidate: candidate({ memory: { value: { native: true }, provenance: "probed" } }) },
    "memory-not-off",
    "Q3",
  );
  fails({ candidate: candidate({ contextWindow: null }) }, "window-unknown", "Q4");
  fails(
    {
      candidate: candidate({
        contextWindow: { tokens: MIN_CRITIC_WINDOW_TOKENS - 1, source: "declared" },
      }),
    },
    "window-too-small",
    "Q4",
  );
  fails({ modelId: "default-model", providerId: "provider-default" }, "not-diverse", "Q5");
  fails({ credentialPresent: false }, "credential-absent", "Q6");
  fails({ preflightAuthOk: false }, "preflight-failed", "Q6");
  fails(
    { candidate: candidate({ terms: { decision: "refused", row: "r", provenance: "gate" } }) },
    "terms-refused",
    "Q7",
  );
  fails(
    { candidate: candidate({ terms: { decision: "unknown", row: "none", provenance: "gate" } }) },
    "terms-unknown",
    "Q7",
  );
  fails({ quotaExhausted: true }, "quota-exhausted", "Q8");
  fails({ budgetInForce: false }, "no-budget", "Q9");
  fails(
    {
      candidate: candidate({ costClass: { value: "metered", provenance: "declared" } }),
      capUsd: null,
    },
    "no-spend-cap",
    "Q9",
  );
  fails(
    {
      readDenialConfirmed: false,
      candidate: candidate({
        completionForm: { value: "read-only-tools", provenance: "declared" },
      }),
    },
    "read-denial-unconfirmed",
    "Q10",
  );
});

test("CT-124-39 an unverified ENDPOINT may qualify, and read-only tools need a tested adapter", () => {
  // An unverified endpoint (state `declared`, kind `openai-chat`) qualifies.
  const endpoint = qualifies(signal({ candidate: candidate({ state: "declared" }) }));
  assert.equal(endpoint.qualifies, true);

  // The form read-only-tools only through a tested harness adapter, also on
  // a subscription (F124-FR-039).
  const readOnly = (overrides: Partial<QualificationSignal>) =>
    qualifies(
      signal({
        candidate: candidate({
          completionForm: { value: "read-only-tools", provenance: "declared" },
          ...overrides.candidate,
        }),
        ...overrides,
      }),
    );
  assert.equal(readOnly({ testedAdapter: true }).qualifies, true);
  assert.equal(readOnly({ testedAdapter: false }).reason, "form-unproven");
  const onSubscription = readOnly({
    testedAdapter: true,
    candidate: candidate({ costClass: { value: "subscription", provenance: "declared" } }),
  });
  assert.equal(onSubscription.qualifies, true);
});

test("CT-124-42 a metered candidate without a cap does not qualify; with the cap it does", () => {
  const metered = candidate({ costClass: { value: "metered", provenance: "declared" } });
  const withoutCap = qualifies(signal({ candidate: metered, capUsd: null }));
  assert.equal(withoutCap.qualifies, false);
  assert.equal(withoutCap.reason, "no-spend-cap");
  const withCap = qualifies(signal({ candidate: metered, capUsd: 2.5 }));
  assert.equal(withCap.qualifies, true);
});

test("CT-124-39 the diversity result decides on the model id and the provider, never the wire format", () => {
  assert.equal(
    diversityOf({ modelId: "m", providerId: "p", proposerModel: "m", proposerProvider: "p" }),
    "same-model",
  );
  assert.equal(
    diversityOf({ modelId: "m2", providerId: "p", proposerModel: "m", proposerProvider: "p" }),
    "same-provider",
  );
  assert.equal(
    diversityOf({ modelId: "m2", providerId: "p2", proposerModel: "m", proposerProvider: "p" }),
    "diverse",
  );
  assert.equal(
    diversityOf({ modelId: null, providerId: "p2", proposerModel: "m", proposerProvider: "p" }),
    "unverified",
  );
});
