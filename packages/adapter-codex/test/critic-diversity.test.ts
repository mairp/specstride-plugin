/**
 * T062 / CT-131-40 — the critic-diversity identity and warning
 * (F131-FR-040).
 *
 * The identity of provider and model for both forms, null where unknown, the
 * provider of form (b) from the host of the endpoint; the critic-diversity
 * warning for the same model, for the same model with a higher effort and for
 * an unknown model; no warning for a shared provider or a shared model tier
 * alone; the identity handed to the engine's comparison (feature 100,
 * F100-FR-024) with the models of the passes of the phase attempt before a
 * call; the call proceeds; the record and the event stay when the line is
 * silenced; nothing printed under `parity`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITIC_CALL_EVENT,
  CRITIC_DIVERSITY_WARNING_EVENT,
  createCriticCall,
  diversityResultOf,
  theCriticDiversityWarningIsDue,
} from "@specstride/core/ep18/critic-strategy";
import {
  CRITIC_DIVERSITY_WARNING,
  callRecordIdentityFields,
  criticIdentityOfFormA,
  criticIdentityOfFormB,
  diversityOfIdentity,
  diversityWarningLine,
  hostOf,
  modelWithoutEffort,
} from "../src/identity.ts";

test("CT-131-40: the identity of form (a) — provider and the model sent, or null", () => {
  const withModel = criticIdentityOfFormA({ model: "gpt-5-codex" });
  assert.equal(withModel.form, "readonly-sandbox");
  assert.equal(withModel.provider, "openai");
  assert.equal(withModel.modelSent, "gpt-5-codex");
  assert.equal(withModel.model, "gpt-5-codex");
  // Where the invocation sends no model id, the harness picks its own and the
  // adapter knows none: the identity is null where unknown.
  const withoutModel = criticIdentityOfFormA({ model: null });
  assert.equal(withoutModel.modelSent, null);
  assert.equal(withoutModel.model, null);
  assert.equal(criticIdentityOfFormA({ model: "  " }).model, null);
});

test("CT-131-40: the identity of form (b) — the provider comes from the host of the endpoint", () => {
  const own = criticIdentityOfFormB({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
  });
  assert.equal(own.form, "direct-call");
  assert.equal(own.provider, "openai");
  assert.equal(own.modelSent, "gpt-5");
  assert.equal(own.model, "gpt-5");
  // Never a label of the descriptor: a foreign host names its own host as the
  // provider, and there the real model is not known, so the model is null.
  const foreign = criticIdentityOfFormB({
    baseUrl: "https://llm.example.internal/v1",
    model: "gpt-5",
  });
  assert.equal(foreign.provider, "llm.example.internal");
  assert.equal(foreign.model, null);
  assert.equal(foreign.modelSent, "gpt-5");
  // ... unless the caller knows the endpoint serves that model.
  const verified = criticIdentityOfFormB({
    baseUrl: "https://llm.example.internal/v1",
    model: "gpt-5",
    modelVerified: true,
  });
  assert.equal(verified.model, "gpt-5");
});

test("CT-131-40: the identity is null where unknown (host unusable, model empty)", () => {
  assert.equal(hostOf(null), null);
  assert.equal(hostOf(""), null);
  assert.equal(hostOf("not a url"), null);
  assert.equal(hostOf("ftp://api.openai.com/v1"), null);
  const noHost = criticIdentityOfFormB({ baseUrl: "not a url", model: "gpt-5" });
  assert.equal(noHost.provider, null);
  assert.equal(noHost.model, null);
  const noModel = criticIdentityOfFormB({ baseUrl: "https://api.openai.com/v1", model: " " });
  assert.equal(noModel.modelSent, null);
  assert.equal(noModel.model, null);
});

test("CT-131-40: a higher effort on the same model is not a different model", () => {
  assert.equal(modelWithoutEffort("gpt-5"), "gpt-5");
  assert.equal(modelWithoutEffort("gpt-5-high"), "gpt-5");
  assert.equal(modelWithoutEffort("gpt-5-xhigh"), "gpt-5");
  assert.equal(modelWithoutEffort(null), null);
  const identity = criticIdentityOfFormB({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-high",
  });
  assert.equal(identity.modelSent, "gpt-5-high");
  assert.equal(identity.model, "gpt-5");
});

test("CT-131-40: the warning for the same model, the same model at a higher effort, and an unknown model (F100-FR-024)", () => {
  const passes = ["gpt-5"];
  // Asserted through the diversity test of feature 100 (F100-FR-024), fed
  // with the identity of the adapter.
  const idOfSame = criticIdentityOfFormA({ model: "gpt-5" });
  const sameModel = diversityOfIdentity(idOfSame, passes);
  assert.equal(sameModel.diversity, "same-model");
  assert.equal(sameModel.sameModelWarning, true);
  const engineSame = diversityResultOf(idOfSame.model, passes, {
    criticProvider: idOfSame.provider,
  });
  assert.equal(engineSame, "same-model");
  assert.equal(theCriticDiversityWarningIsDue(engineSame), true);
  assert.equal(CRITIC_DIVERSITY_WARNING, "critic-diversity warning");

  const idOfHigher = criticIdentityOfFormB({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-high",
  });
  const higherEffort = diversityOfIdentity(idOfHigher, passes);
  assert.equal(higherEffort.diversity, "same-model");
  assert.equal(higherEffort.sameModelWarning, true);
  const engineHigher = diversityResultOf(idOfHigher.model, passes, {
    criticProvider: idOfHigher.provider,
  });
  assert.equal(engineHigher, "same-model");
  assert.equal(theCriticDiversityWarningIsDue(engineHigher), true);

  const idOfUnknown = criticIdentityOfFormA({ model: null });
  const unknown = diversityOfIdentity(idOfUnknown, passes);
  assert.equal(unknown.diversity, "unverified");
  assert.equal(unknown.sameModelWarning, true);
  const engineUnknown = diversityResultOf(idOfUnknown.model, passes, {
    criticProvider: idOfUnknown.provider,
  });
  assert.equal(engineUnknown, "unverified");
  assert.equal(theCriticDiversityWarningIsDue(engineUnknown), true);
});

test("CT-131-40: no warning for a shared provider or a shared model tier alone", () => {
  const passes = ["gpt-5"];
  // This harness as proposer and as critic on two models of one provider.
  const idOfSharedProvider = criticIdentityOfFormA({ model: "gpt-5-codex" });
  const sharedProvider = diversityOfIdentity(idOfSharedProvider, passes, {
    providersThatProducedPasses: ["openai"],
  });
  assert.equal(sharedProvider.diversity, "same-provider");
  assert.equal(sharedProvider.sameModelWarning, false);
  const engineSharedProvider = diversityResultOf(idOfSharedProvider.model, passes, {
    criticProvider: idOfSharedProvider.provider,
    providersThatProducedPasses: ["openai"],
  });
  assert.equal(engineSharedProvider, "same-provider");
  assert.equal(theCriticDiversityWarningIsDue(engineSharedProvider), false);

  // A shared model tier alone (gpt-5-mini against gpt-5) is not the same model.
  const idOfSharedTier = criticIdentityOfFormB({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
  });
  const sharedTier = diversityOfIdentity(idOfSharedTier, passes);
  assert.equal(sharedTier.diversity, "diverse");
  assert.equal(sharedTier.sameModelWarning, false);
  const engineSharedTier = diversityResultOf(idOfSharedTier.model, passes, {
    criticProvider: idOfSharedTier.provider,
  });
  assert.equal(engineSharedTier, "diverse");
  assert.equal(theCriticDiversityWarningIsDue(engineSharedTier), false);
});

test("CT-131-40: the identity reaches the engine's comparison before the call, and the call proceeds", async () => {
  const identity = criticIdentityOfFormA({ model: "gpt-5" });
  const sessionIdsOfThePasses = ["pass-session-1"];
  const calls: string[] = [];
  const engine = createCriticCall({
    gate: {
      phaseEvidence: { logicalName: "evidence", hash: "h", size: 1 },
      groundingSnapshot: { logicalName: "snapshot", hash: "h", size: 1 },
      verificationResult: null,
      factBlock: [],
      rolePlan: null,
    },
    form: "tool-less",
    criticModel: identity.model,
    modelsThatProducedPasses: ["gpt-5"],
    sessionIdsOfThePasses,
    testedHarnessAdapter: true,
    assemble: ({ demand }) => demand,
    complete: async (request) => {
      calls.push(request.model ?? "");
      return {
        reply: `APPROVED ${request.nonce}`,
        versionPin: "codex-cli 0.153.4",
        preflight: true,
        flagSet: true,
        model: request.model,
      };
    },
  });
  const outcome = await engine.call("Judge the phase evidence.");
  // The comparison ran before the call: same model, warning raised — and the
  // call proceeded anyway (the warning never blocks).
  assert.deepEqual(calls, ["gpt-5"]);
  assert.equal(outcome.verdict, "APPROVED");
  assert.equal(outcome.sameModelWarning, true);
  const record = engine.records()[0];
  assert.equal(record.diversity, "same-model");
  assert.equal(record.sameModelWarning, true);
  assert.equal(record.model, "gpt-5");
  const warningEvent = engine.events().find((event) => event.warning !== undefined);
  assert.equal(warningEvent?.warning, "critic-diversity warning");
  assert.equal(warningEvent?.blocking, false);
  // The warning event precedes the event of the call: the comparison runs
  // before the call itself (the engine emits the call event after the test).
  const events = engine.events();
  const warningIndex = events.findIndex((event) => event.name === CRITIC_DIVERSITY_WARNING_EVENT);
  const callIndex = events.findIndex((event) => event.name === CRITIC_CALL_EVENT);
  assert.ok(warningIndex > -1);
  assert.ok(callIndex > -1);
  assert.ok(warningIndex < callIndex);
});

test("CT-131-40: the fields of the call record carry the identity, the result and the warning", () => {
  const fields = callRecordIdentityFields(
    criticIdentityOfFormB({ baseUrl: "https://api.openai.com/v1", model: "gpt-5" }),
    ["gpt-5"],
  );
  assert.deepEqual(fields, {
    provider: "openai",
    model: "gpt-5",
    diversity: "same-model",
    sameModelWarning: true,
  });
  const calm = callRecordIdentityFields(
    criticIdentityOfFormA({ model: "gpt-5-codex" }),
    ["gpt-5"],
    { providersThatProducedPasses: ["openai"] },
  );
  assert.deepEqual(calm, {
    provider: "openai",
    model: "gpt-5-codex",
    diversity: "same-provider",
    sameModelWarning: false,
  });
});

test("CT-131-40: the record and the event stay when the line is silenced; nothing printed under `parity`", () => {
  const identity = criticIdentityOfFormA({ model: "gpt-5" });
  const { diversity, sameModelWarning } = diversityOfIdentity(identity, ["gpt-5"]);
  assert.equal(sameModelWarning, true);
  // The line is printed by default, silenced on request, absent under parity.
  assert.match(
    diversityWarningLine({ diversity, sameModelWarning }) ?? "",
    /critic-diversity warning/,
  );
  assert.equal(diversityWarningLine({ diversity, sameModelWarning, silenced: true }), null);
  assert.equal(diversityWarningLine({ diversity, sameModelWarning, profile: "parity" }), null);
  assert.equal(diversityWarningLine({ diversity, sameModelWarning: false }), null);
  // Silencing the line does not silence the record or the event: the fields
  // the record and the event carry are unchanged.
  const fields = callRecordIdentityFields(identity, ["gpt-5"]);
  assert.equal(fields.sameModelWarning, true);
  assert.equal(fields.diversity, "same-model");
});

test("CT-131-40: the warning event stays when the printed line is silenced", async () => {
  const identity = criticIdentityOfFormA({ model: "gpt-5" });
  const engine = createCriticCall({
    gate: {
      phaseEvidence: { logicalName: "evidence", hash: "h", size: 1 },
      groundingSnapshot: { logicalName: "snapshot", hash: "h", size: 1 },
      verificationResult: null,
      factBlock: [],
      rolePlan: null,
    },
    form: "tool-less",
    criticModel: identity.model,
    modelsThatProducedPasses: ["gpt-5"],
    sessionIdsOfThePasses: ["pass-session-1"],
    testedHarnessAdapter: true,
    assemble: ({ demand }) => demand,
    complete: async (request) => ({
      reply: `APPROVED ${request.nonce}`,
      versionPin: "codex-cli 0.153.4",
      preflight: true,
      flagSet: true,
      model: request.model,
    }),
  });
  await engine.call("Judge the phase evidence.");
  const eventsBefore = engine.events();
  assert.ok(eventsBefore.some((event) => event.warning !== undefined));
  // Silencing the printed line changes no event: the line only prints.
  void diversityWarningLine({ diversity: "same-model", sameModelWarning: true, silenced: true });
  void diversityWarningLine({ diversity: "same-model", sameModelWarning: true, profile: "parity" });
  const eventsAfter = engine.events();
  assert.equal(eventsAfter.length, eventsBefore.length);
  assert.equal(
    eventsAfter.some((event) => event.warning !== undefined),
    true,
  );
  assert.deepEqual(
    eventsAfter.find((event) => event.warning !== undefined),
    eventsBefore.find((event) => event.warning !== undefined),
  );
});
