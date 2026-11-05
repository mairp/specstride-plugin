/**
 * T063 — the identity for the critic-diversity test and the fields of the
 * call record (F131-FR-040; the data model's "Identity of a critic-class
 * call").
 *
 * The engine applies the critic-diversity rule of feature 100 (F100-FR-024);
 * this adapter supplies what that rule reads:
 *
 * | What | Requirement |
 * |---|---|
 * | the provider and the model id sent, or null where unknown, for both forms | F131-FR-040 |
 * | the provider of form (b) from the host of the endpoint, never from a descriptor label; on a host that is not the provider's own, the model is null where the real model is not known | F131-FR-040 |
 * | a higher effort on the same model is not a different model | F131-FR-040 |
 * | the fields of the call record: provider, model, diversity result, warning raised | F131-FR-040, F131-FR-004 |
 *
 * The engine applies the comparison itself — `diversityResultOf` of feature
 * 100's seam — before every call; this module mirrors it over the identity it
 * supplies, and CT-131-40 asserts the two agree (F100-FR-024). The warning
 * never blocks a launch, a run or a call, and the consumer may silence the
 * printed line — the record and the event stay (`diversityWarningLine`).
 */
import { DIVERSITY_RESULTS_THAT_WARN } from "@specstride/contracts/ep/critic-strategy";
import { resultsOfTheDiversityTest } from "@specstride/contracts/enums/all-sets";

/** The result of the diversity test (row 183 of annex X §X.6). */
export type DiversityResult = (typeof resultsOfTheDiversityTest.members)[number];
export { DIVERSITY_RESULTS_THAT_WARN, resultsOfTheDiversityTest };

/** The provider of this adapter, from the descriptor (`provider.id`). */
export const PROVIDER_ID = "openai" as const;

/** The provider host that names the provider of form (b) (F131-FR-040). */
export const PROVIDER_HOST = "api.openai.com" as const;

/** The hosts that are the provider's own, mapped to the provider id. */
export const PROVIDER_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  [PROVIDER_HOST]: PROVIDER_ID,
});

/** The reasoning efforts a model id may carry as a suffix (form (b), as-is). */
export const EFFORT_SUFFIXES: readonly string[] = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

/** The name of the one warning (F131-FR-040; feature 100). */
export const CRITIC_DIVERSITY_WARNING = "critic-diversity warning" as const;

/** The result of the diversity test that a null identity gives. */
export const DIVERSITY_WHEN_UNKNOWN: DiversityResult = "unverified";

/**
 * The identity of one critic-class call (the data model, "Identity of a
 * critic-class call"): the provider and the model id that is sent, or null
 * where the adapter does not know one; `model` is the id the diversity test
 * compares — the same model without an effort suffix — and is null wherever
 * `modelSent` is null.
 */
export type CriticIdentity = {
  /** `readonly-sandbox` (form (a)) or `direct-call` (form (b)). */
  readonly form: "readonly-sandbox" | "direct-call";
  /** The provider, from the host of the endpoint on form (b); null if unknown. */
  readonly provider: string | null;
  /** The model id exactly as it is sent; null where the adapter sends none. */
  readonly modelSent: string | null;
  /** The model the diversity test compares: `modelSent` without an effort suffix. */
  readonly model: string | null;
};

/**
 * F131-FR-040 — the identity of a form (a) call (the harness under its
 * read-only sandbox). The provider is the descriptor's provider; the model id
 * is the one the invocation sends, or null where the harness picks its own
 * (the adapter does not know one).
 */
export function criticIdentityOfFormA(input: {
  /** The model id the invocation sends, where it sends one. */
  readonly model?: string | null;
  readonly provider?: string | null;
}): CriticIdentity {
  const modelSent =
    typeof input.model === "string" && input.model.trim().length > 0 ? input.model.trim() : null;
  return Object.freeze({
    form: "readonly-sandbox",
    provider: input.provider ?? PROVIDER_ID,
    modelSent,
    model: modelWithoutEffort(modelSent),
  });
}

/**
 * F131-FR-040 — the identity of a form (b) call (the direct call). The
 * provider comes from the host of the endpoint, never from a label of the
 * descriptor. Where the base address is not the provider's own host the real
 * model is not known and the model is reported as null, unless the caller
 * marks the model as verified for that endpoint.
 */
export function criticIdentityOfFormB(input: {
  /** The base address of the endpoint of the call. */
  readonly baseUrl: string | null | undefined;
  /** The model id the call sends. */
  readonly model?: string | null;
  /** True only where the caller knows the endpoint serves that model. */
  readonly modelVerified?: boolean;
}): CriticIdentity {
  const host = hostOf(input.baseUrl);
  const provider = host === null ? null : (PROVIDER_HOSTS[host] ?? host);
  const modelSent =
    typeof input.model === "string" && input.model.trim().length > 0 ? input.model.trim() : null;
  const onTheProvidersOwnHost = provider === PROVIDER_ID;
  const known = onTheProvidersOwnHost || input.modelVerified === true;
  return Object.freeze({
    form: "direct-call",
    provider,
    modelSent,
    model: known ? modelWithoutEffort(modelSent) : null,
  });
}

/** The host of a base address, lowercased, without the port; null if unusable. */
export function hostOf(baseUrl: string | null | undefined): string | null {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * F131-FR-040 — a higher effort on the same model is not a different model:
 * a trailing effort suffix is not part of the id the diversity test compares.
 */
export function modelWithoutEffort(model: string | null | undefined): string | null {
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  if (trimmed.length === 0) return null;
  const lowered = trimmed.toLowerCase();
  for (const effort of EFFORT_SUFFIXES) {
    if (lowered.endsWith(`-${effort}`)) {
      return trimmed.slice(0, trimmed.length - (effort.length + 1)).trim() || null;
    }
  }
  return trimmed;
}

/**
 * F131-FR-040 — the comparison of feature 100 (F100-FR-024; row 183) applied
 * to the identity this adapter supplies. The engine runs the same comparison
 * (`diversityResultOf` of `@specstride/core`) before every call; the test
 * CT-131-40 asserts the two agree on this identity.
 *
 * | Result | When |
 * |---|---|
 * | `same-model` | the model of the call equals a model that produced a pass |
 * | `unverified` | the model of the call, or a model of a pass, is not known |
 * | `same-provider` | the providers are given and share one, the models differ |
 * | `diverse` | otherwise |
 */
export function diversityResultForIdentity(
  identity: CriticIdentity,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providers?: {
    readonly providersThatProducedPasses?: readonly (string | null | undefined)[];
  },
): DiversityResult {
  const normalize = (model: string | null | undefined): string | null =>
    typeof model === "string" && model.trim().length > 0 ? model.trim().toLowerCase() : null;
  const critic = normalize(identity.model);
  if (critic === null) return "unverified";
  const passes = modelsThatProducedPasses.map((model) => modelWithoutEffort(normalize(model)));
  if (passes.some((model) => model === null)) return "unverified";
  if (passes.includes(critic)) return "same-model";
  const criticProvider = normalize(identity.provider);
  const passProviders = (providers?.providersThatProducedPasses ?? []).map(normalize);
  if (criticProvider !== null && passProviders.includes(criticProvider)) return "same-provider";
  return "diverse";
}

/**
 * F131-FR-040 — the result of the diversity test for one identity, with the
 * warning that feature 100's rule (F100-FR-024) raises for it. The model of
 * the call is compared, as this adapter reports it, with the models that
 * produced passes in the phase attempt. The warning is due for `same-model`
 * and for `unverified`, and never for `same-provider` or `diverse`.
 */
export function diversityOfIdentity(
  identity: CriticIdentity,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providers?: {
    readonly providersThatProducedPasses?: readonly (string | null | undefined)[];
  },
): { readonly diversity: DiversityResult; readonly sameModelWarning: boolean } {
  const diversity = diversityResultForIdentity(identity, modelsThatProducedPasses, providers);
  return Object.freeze({
    diversity,
    sameModelWarning: (DIVERSITY_RESULTS_THAT_WARN as readonly string[]).includes(diversity),
  });
}

/**
 * F131-FR-040, F131-FR-004 — the fields of the call record that the identity
 * and the diversity test supply: the provider, the model, the result of the
 * diversity test and whether the critic-diversity warning was raised.
 */
export function callRecordIdentityFields(
  identity: CriticIdentity,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providers?: {
    readonly providersThatProducedPasses?: readonly (string | null | undefined)[];
  },
): {
  readonly provider: string | null;
  readonly model: string | null;
  readonly diversity: DiversityResult;
  readonly sameModelWarning: boolean;
} {
  const { diversity, sameModelWarning } = diversityOfIdentity(
    identity,
    modelsThatProducedPasses,
    providers,
  );
  return Object.freeze({
    provider: identity.provider,
    model: identity.modelSent,
    diversity,
    sameModelWarning,
  });
}

/**
 * F131-FR-040 — the printed line of the warning. The consumer MAY silence the
 * line, and under the `parity` profile nothing is printed; the record and the
 * event stay either way (they come from `callRecordIdentityFields`). Returns
 * the line, or null where nothing is printed.
 */
export function diversityWarningLine(input: {
  readonly diversity: DiversityResult;
  readonly sameModelWarning: boolean;
  readonly profile?: "parity" | "default" | string;
  /** True where the consumer silenced the line. */
  readonly silenced?: boolean;
}): string | null {
  if (!input.sameModelWarning) return null;
  if (input.silenced === true) return null;
  if (input.profile === "parity") return null;
  return `${CRITIC_DIVERSITY_WARNING}: the critic runs on the same model as the proposer, or on an unknown model (result: ${input.diversity}); the warning never blocks.`;
}
