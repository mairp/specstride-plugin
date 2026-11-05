/**
 * T036 — CT-124-45, CT-124-46, CT-124-47 (F124-FR-045, F124-FR-046,
 * F124-FR-047, F124-SC-004): the critic-diversity rule.
 *
 * The warning is raised for the results `same-model` and `unverified` and
 * for NO other result; it is recorded, never blocks a launch, never a launch
 * check. A shared provider alone and a shared model tier alone do not warn;
 * a higher effort on the same model warns. The rule is also applied before a
 * critic-class call against the models of the passes of the phase attempt.
 * The provider identity comes from the host of the endpoint; an unknown real
 * model is `unverified` and eligible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CRITIC_DIVERSITY_WARNING,
  CRITIC_DIVERSITY_NEVER_BLOCKS,
  checkCriticDiversity,
  diversityBeforeCriticCall,
  diversityBetween,
  diversityDisqualifies,
  providerFromEndpointHost,
  resultOfDiversity,
  sameModelWarningOf,
} from "../../src/roles/diversity.ts";
import { pickCritic } from "../../src/roles/critic-order.ts";
import { candidate, defaultHarness, orderInput } from "./critic-fixtures.ts";

test("CT-124-45 the warning for same-model and unverified and for no other result", () => {
  // The trigger, exactly (W-125-01): same-model and unverified warn.
  assert.deepEqual(sameModelWarningOf("same-model"), true);
  assert.deepEqual(sameModelWarningOf("unverified"), true);
  // ...and for no other result of the closed set 183.
  assert.deepEqual(sameModelWarningOf("diverse"), false);
  assert.deepEqual(sameModelWarningOf("same-provider"), false);
  // An unknown value takes the `unverified` branch of row 183 and warns.
  assert.deepEqual(resultOfDiversity("some-future-result"), "unverified");
  assert.deepEqual(sameModelWarningOf("some-future-result"), true);

  // The decision: recorded, never blocking, never a launch check.
  const same = checkCriticDiversity(
    { model: "model-a", provider: "provider-a" },
    { model: "model-a", provider: "provider-a" },
  );
  assert.deepEqual(same.diversity, "same-model");
  assert.deepEqual(same.sameModelWarning, true);
  assert.deepEqual(same.proceed, CRITIC_DIVERSITY_NEVER_BLOCKS);
  assert.deepEqual(same.warning, CRITIC_DIVERSITY_WARNING);
  assert.deepEqual(
    checkCriticDiversity(
      { model: "model-a", provider: "provider-a" },
      { model: null, provider: "provider-b" },
    ).sameModelWarning,
    true,
  );

  const sharedProvider = checkCriticDiversity(
    { model: "critic-model", provider: "provider-a" },
    { model: "proposer-model", provider: "provider-a" },
  );
  assert.deepEqual(sharedProvider.diversity, "same-provider");
  assert.deepEqual(sharedProvider.sameModelWarning, false);

  const diverse = checkCriticDiversity(
    { model: "critic-model", provider: "provider-a" },
    { model: "proposer-model", provider: "provider-b" },
  );
  assert.deepEqual(diverse.diversity, "diverse");
  assert.deepEqual(diverse.sameModelWarning, false);
});

test("CT-124-45 a shared model tier alone does not warn", () => {
  // Different models, different providers, one shared model tier: the tier
  // never enters the decision (F124-FR-045).
  const tiered = diversityBetween(
    { model: "critic-model", provider: "provider-b" },
    { model: "proposer-model", provider: "provider-a" },
  );
  assert.deepEqual(tiered, "diverse");
  assert.deepEqual(sameModelWarningOf(tiered), false);
  // The default harness on the proposer tier is the critic with the warning;
  // on a different tier there is none (step 4, F124-FR-037).
  const sameTier = pickCritic(
    orderInput({
      defaultHarness: defaultHarness({
        modelTiers: [{ tier: "proposer", model: "default-model" }],
        proposerTier: "proposer",
      }),
    }),
  );
  assert.deepEqual(sameTier.outcome, "picked");
  if (sameTier.outcome !== "picked") return;
  assert.deepEqual(sameTier.pick.diversity, "same-model");
  assert.deepEqual(sameTier.pick.sameModelWarning, true);
  // The launch proceeds: the warning is not a launch check.
  assert.ok(sameTier.pick.harness.length > 0);
});

test("CT-124-45 a higher effort on the same model warns (W-115-02)", () => {
  const effort = checkCriticDiversity(
    { model: "model-a", provider: "provider-a", effort: "high" },
    { model: "model-a", provider: "provider-a", effort: "medium" },
  );
  assert.deepEqual(effort.diversity, "same-model");
  assert.deepEqual(effort.sameModelWarning, true);
  assert.deepEqual(effort.proceed, true);
});

test("CT-124-46 the rule before a critic-class call against the models of the passes", () => {
  // A pass of the phase attempt ran on the model of the critic: warning,
  // recorded, and the call proceeds (F124-FR-046, IR-47).
  const match = diversityBeforeCriticCall({
    resolvedModel: "model-a",
    resolvedProvider: "provider-a",
    passModels: ["other-model", "model-a"],
    passProviders: ["provider-b", "provider-a"],
  });
  assert.deepEqual(match.diversity, "same-model");
  assert.deepEqual(match.sameModelWarning, true);
  assert.deepEqual(match.proceed, true);
  assert.deepEqual(match.warning, CRITIC_DIVERSITY_WARNING);

  // No model of the passes is the model of the call: no warning.
  const noMatch = diversityBeforeCriticCall({
    resolvedModel: "model-a",
    resolvedProvider: "provider-a",
    passModels: ["other-model"],
    passProviders: ["provider-b"],
  });
  assert.deepEqual(noMatch.diversity, "diverse");
  assert.deepEqual(noMatch.sameModelWarning, false);
  assert.deepEqual(noMatch.proceed, true);

  // An unknown real model of the call: `unverified`, warning, call proceeds.
  const unknown = diversityBeforeCriticCall({
    resolvedModel: null,
    passModels: ["model-a"],
  });
  assert.deepEqual(unknown.diversity, "unverified");
  assert.deepEqual(unknown.sameModelWarning, true);
  assert.deepEqual(unknown.proceed, true);

  // The same-model result at launch still comes out of the pick, recorded in
  // the field `criticPick` (F124-FR-045).
  const pick = pickCritic(
    orderInput({
      defaultHarness: defaultHarness({
        modelTiers: [{ tier: "proposer", model: "default-model" }],
        proposerTier: "proposer",
      }),
    }),
  );
  assert.deepEqual(pick.outcome, "picked");
  if (pick.outcome !== "picked") return;
  assert.deepEqual(pick.pick.sameModelWarning, true);
  assert.deepEqual(pick.event.sameModelWarning, true);
});

test("CT-124-47 the provider identity comes from the host of the endpoint", () => {
  // The host decides, never a label of the descriptor (F124-FR-047): the
  // descriptor claims provider `other`, the host says `api.a.example`.
  const host = providerFromEndpointHost("https://api.a.example:8443/v1");
  assert.deepEqual(host, "api.a.example");
  // Case and port are not identity.
  assert.deepEqual(providerFromEndpointHost("https://API.A.Example:8443/v1"), "api.a.example");
  assert.deepEqual(providerFromEndpointHost("api.a.example/v1"), "api.a.example");
  assert.deepEqual(providerFromEndpointHost(""), null);
  assert.deepEqual(providerFromEndpointHost(null), null);

  // Two candidates whose descriptors claim DIFFERENT providers but whose
  // endpoints share a host are the same provider (`same-provider`, no
  // warning); the wire format does not enter the decision.
  const byHost = checkCriticDiversity(
    { model: "critic-model", provider: providerFromEndpointHost("https://shared.example/v1") },
    { model: "proposer-model", provider: providerFromEndpointHost("http://shared.example/other") },
  );
  assert.deepEqual(byHost.diversity, "same-provider");
  assert.deepEqual(byHost.sameModelWarning, false);
});

test("CT-124-47 an unknown real model is unverified and eligible", () => {
  const result = checkCriticDiversity(
    { model: null, provider: "provider-a" },
    { model: "proposer-model", provider: "provider-b" },
  );
  assert.deepEqual(result.diversity, "unverified");
  assert.deepEqual(result.sameModelWarning, true);
  // Eligible: diversity never disqualifies (F124-FR-047).
  assert.deepEqual(diversityDisqualifies(result.diversity), false);
  assert.deepEqual(diversityDisqualifies("same-model"), false);
  // And the pick with an unknown model is still made, with the warning.
  const picked = pickCritic(
    orderInput({
      defaultHarness: defaultHarness({
        modelId: null,
        modelTiers: [
          { tier: "proposer", model: "default-model" },
          { tier: "critic", model: null as unknown as string },
        ],
        proposerTier: "proposer",
      }),
      proposer: {
        harness: "default-harness",
        model: "default-model",
        providerId: "provider-default",
      },
    }),
  );
  assert.deepEqual(picked.outcome, "picked");
  if (picked.outcome !== "picked") return;
  assert.deepEqual(picked.pick.diversity, "unverified");
  assert.deepEqual(picked.pick.sameModelWarning, true);
});

test("CT-124-45 a discovered candidate on a shared provider is recorded without a warning", () => {
  // Different models, one provider: the candidate qualifies (Q5), the record
  // carries `same-provider` and no warning, and no diversity line prints.
  const picked = pickCritic(
    orderInput({
      discovered: [
        candidate({
          id: "same-provider-critic",
          modelId: "other-model",
          providerId: "provider-default",
        }),
      ],
    }),
  );
  assert.deepEqual(picked.outcome, "picked");
  if (picked.outcome !== "picked") return;
  assert.deepEqual(picked.pick.diversity, "same-provider");
  assert.deepEqual(picked.pick.sameModelWarning, false);
  assert.ok(!picked.lines.some((line) => line.includes("SPECSTRIDE-DIVERSITY")));
});
