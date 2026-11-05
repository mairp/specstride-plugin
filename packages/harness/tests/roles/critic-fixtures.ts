/**
 * The shared fixtures of the critic-order tests of phase 4 (T023 to T029).
 * Candidates are data, spelled as the field `harnesses` of annex C §C.6
 * reads them; no list of harnesses lives under `src/roles/`.
 */
import type { CriticOrderCandidate, CriticOrderInput } from "../../src/roles/critic-order.ts";

/** One candidate of the critic order, fully qualified by default. */
export function candidate(
  overrides: Partial<CriticOrderCandidate> & { readonly id?: string } = {},
): CriticOrderCandidate {
  return {
    id: "disc-a",
    state: "tested",
    origin: "discovered",
    version: "1.0.0",
    descriptorHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    resolvedPath: "http://127.0.0.1:0/v1",
    kind: "openai-chat",
    completionForm: { value: "tool-less", provenance: "declared" },
    costClass: { value: "subscription", provenance: "declared" },
    contextWindow: { tokens: 128000, source: "declared" },
    memory: { value: { native: false }, provenance: "declared" },
    terms: { decision: "allowed", row: "provider:fixture", provenance: "configuration" },
    containmentCeiling: "C2",
    namedByTheConsumer: false,
    modelId: "model-a",
    providerId: "provider-a",
    testedAdapter: true,
    credentialPresent: true,
    preflightAuthOk: true,
    quotaExhausted: false,
    readDenialConfirmed: true,
    ...overrides,
  } as CriticOrderCandidate;
}

/** The default harness of step 4, with two model tiers. */
export function defaultHarness(
  overrides: Partial<CriticOrderInput["defaultHarness"]> = {},
): CriticOrderInput["defaultHarness"] {
  return {
    id: "default-harness",
    modelId: "default-model",
    providerId: "provider-default",
    modelTiers: [
      { tier: "proposer", model: "default-model" },
      { tier: "critic", model: "default-critic-model" },
    ],
    proposerTier: "proposer",
    state: "tested",
    form: "tool-less",
    windowTokens: 200000,
    windowSource: "declared",
    supportsCritic: true,
    ...overrides,
  };
}

/** An input for `pickCritic` with no critic configured and no candidate. */
export function orderInput(overrides: Partial<CriticOrderInput> = {}): CriticOrderInput {
  return {
    configured: null,
    gateway: null,
    discovered: [],
    defaultHarness: defaultHarness(),
    proposer: {
      harness: "default-harness",
      model: "default-model",
      providerId: "provider-default",
    },
    autoPick: true,
    budgetInForce: true,
    capUsd: 5,
    profile: "default",
    warnSameModel: true,
    phases: ["1"],
    surface: "launch",
    ...overrides,
  };
}
