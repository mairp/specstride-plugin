/**
 * T037 — the critic-diversity rule of feature 124 (F124-FR-045, F124-FR-046,
 * F124-FR-047; scenario F124-SC-004; research R23v rule IR-47).
 *
 * The rule has ONE name, the "critic-diversity warning". `same-model` is a
 * RESULT of the diversity test (closed set 183) and not a name of the warning
 * (W-100-15). The warning is raised when, and only when, the diversity result
 * is `same-model` or `unverified`; a shared provider alone (`same-provider`)
 * and a shared model tier alone (`diverse`) do not raise it. A higher effort
 * on the same model does not count as a different model: it is allowed and
 * the warning is raised (W-115-02, CQ-191). The warning never blocks a launch
 * or a run and is never a launch check; the consumer may silence the line
 * (row 92 of annex X §X.7) and the record and the event stay.
 *
 * Diversity is decided on the provider identity and on the model id that is
 * SENT, never on the wire format. The provider identity of an endpoint comes
 * from the HOST of the endpoint, never from a label of the harness descriptor
 * (F124-FR-047). A candidate whose real model is not known is `unverified`,
 * is eligible, and raises the warning.
 *
 * Exported for the critic strategy seam: the critic order applies it at
 * launch (`roles/critic-order.ts`), and the engine applies it before every
 * critic-class call through feature 100, annex E §E.1, as a pure predicate.
 */
import { resultsOfTheDiversityTest } from "@specstride/contracts/enums/all-sets";
import type { DiversityResult } from "./types.ts";

/** The one name of the warning (F124-FR-045; W-100-15). */
export const CRITIC_DIVERSITY_WARNING = "critic-diversity warning" as const;

/** The label of the warning line (row 32 of the product lines; T033). */
export const CRITIC_DIVERSITY_LINE_LABEL = "SPECSTRIDE-DIVERSITY" as const;

/** The results of the diversity test that raise the warning — and no others. */
export const WARNING_RESULTS_OF_DIVERSITY = ["same-model", "unverified"] as const;

/**
 * The rule NEVER blocks. Kept as data so a caller (the launch checks, the
 * pass loop) can assert the shape of the seam rather than trust a comment:
 * the warning is never a launch check (F124-FR-045) and the call proceeds
 * after the warning is recorded (F124-FR-046).
 */
export const CRITIC_DIVERSITY_NEVER_BLOCKS = true as const;

/**
 * The identity of a model as the rule reads it: the model id that is SENT
 * (or null where the real model is unknown), the provider identity from the
 * HOST of the endpoint, and the effort of the call, which the comparison
 * deliberately ignores (a higher effort on the same model is the same model).
 */
export type ModelIdentity = {
  /** The model id sent, or null when the real model is not known. */
  readonly model: string | null;
  /** The provider identity, from the host of the endpoint (F124-FR-047). */
  readonly provider: string | null;
  /** The effort of the call; never part of the comparison (F124-FR-045). */
  readonly effort?: string | null;
};

/**
 * The provider identity of an endpoint, from the HOST of the endpoint and
 * never from a label of the harness descriptor (F124-FR-047). Returns null
 * for a candidate without an endpoint host (a CLI without a URL).
 */
export function providerFromEndpointHost(endpoint: string | null | undefined): string | null {
  if (endpoint === null || endpoint === undefined) return null;
  const text = String(endpoint).trim();
  if (text === "") return null;
  let host: string | null = null;
  if (text.includes("://")) {
    try {
      host = new URL(text).host;
    } catch {
      host = null;
    }
  } else {
    // An authority-only form, e.g. `api.example.com/v1`: take up to the
    // first slash. A form with neither scheme nor authority is not a host.
    const head = text.split("/", 1)[0];
    host = head.includes(".") || head.includes(":") ? head : null;
  }
  if (host === null || host === "") return null;
  // A host is compared case-insensitively and without its port: the
  // identity of the provider lives in the host, not in the port.
  return host.toLowerCase().split(":", 1)[0] || null;
}

/**
 * The result of the diversity test for a raw value: a value outside the
 * closed set 183 takes the unknown-value branch, which is `unverified`, with
 * the warning (row 183 of annex X §X.6).
 */
export function resultOfDiversity(raw: string | null | undefined): DiversityResult {
  const value = raw === null || raw === undefined ? "" : String(raw);
  if ((resultsOfTheDiversityTest.members as readonly string[]).includes(value)) {
    return value as DiversityResult;
  }
  return "unverified";
}

/**
 * The diversity result of the critic against the proposer (F124-FR-047):
 * decided on the model id SENT and on the provider identity, never on the
 * wire format; the effort is not a difference; an unknown real model on
 * either side gives `unverified`. A shared model tier alone is NOT read:
 * only model id and provider identity enter the decision.
 */
export function diversityBetween(critic: ModelIdentity, proposer: ModelIdentity): DiversityResult {
  // An unknown real model: `unverified`, eligible, with the warning.
  if (critic.model === null || proposer.model === null) return "unverified";
  // The comparison is on the model id that is sent. The effort of the call
  // is deliberately not read here (F124-FR-045, W-115-02): a higher effort
  // on the same model is the same model.
  if (critic.model === proposer.model) return "same-model";
  // A shared provider alone: a result, not a warning.
  if (
    critic.provider !== null &&
    proposer.provider !== null &&
    critic.provider === proposer.provider
  ) {
    return "same-provider";
  }
  return "diverse";
}

/**
 * Whether the critic-diversity warning is raised for a result of the
 * diversity test: `same-model` and `unverified` — and NO other result
 * (F124-FR-045). An unknown result takes the `unverified` branch of the
 * closed set and warns.
 */
export function sameModelWarningOf(result: DiversityResult | string): boolean {
  const settled = resultOfDiversity(result);
  return (WARNING_RESULTS_OF_DIVERSITY as readonly string[]).includes(settled);
}

/** What the rule produces: the result, the warning, and the decision. */
export type DiversityDecision = {
  /** The result of the diversity test (closed set 183). */
  readonly diversity: DiversityResult;
  /** Whether the critic-diversity warning is raised (F124-FR-045). */
  readonly sameModelWarning: boolean;
  /** Always true: the warning never blocks (F124-FR-045, F124-FR-046). */
  readonly proceed: typeof CRITIC_DIVERSITY_NEVER_BLOCKS;
  /** The one name of the warning, present only when it is raised. */
  readonly warning?: typeof CRITIC_DIVERSITY_WARNING;
};

/**
 * The critic-diversity rule at launch: the critic against the proposer of a
 * phase. Pure, never throws on a null identity, never blocks and never is a
 * launch check: the launch proceeds with the warning recorded (F124-SC-004).
 */
export function checkCriticDiversity(
  critic: ModelIdentity,
  proposer: ModelIdentity,
): DiversityDecision {
  const diversity = diversityBetween(critic, proposer);
  const sameModelWarning = sameModelWarningOf(diversity);
  return sameModelWarning
    ? { diversity, sameModelWarning, proceed: true, warning: CRITIC_DIVERSITY_WARNING }
    : { diversity, sameModelWarning, proceed: true };
}

/**
 * The rule applied before a critic-class call (F124-FR-046): the resolved
 * model of the call is compared with the models that produced passes in the
 * phase attempt. A match raises and records the warning and the call
 * PROCEEDS. The feature supplies the rule and the record; the engine applies
 * it (feature 100, annex E §E.1), carrying the fields `diversity` and
 * `sameModelWarning` of the event `critic.call`.
 */
export function diversityBeforeCriticCall(input: {
  /** The model the critic-class call resolves to, or null when unknown. */
  readonly resolvedModel: string | null;
  /** The provider identity of the resolved endpoint, or null. */
  readonly resolvedProvider?: string | null;
  /** The models that produced passes in the phase attempt. */
  readonly passModels: readonly (string | null)[];
  /** The provider identities of those passes, where they are known. */
  readonly passProviders?: readonly (string | null)[];
  /** The effort of the critic-class call; never part of the comparison. */
  readonly effort?: string | null;
}): DiversityDecision {
  const models = input.passModels.filter(
    (model) => model !== null && model !== undefined && model !== "",
  );
  // No pass to compare against, or an unknown resolved model: the result is
  // `unverified`, which raises the warning, and the call proceeds.
  if (input.resolvedModel === null || input.resolvedModel === undefined || models.length === 0) {
    return {
      diversity: "unverified",
      sameModelWarning: true,
      proceed: true,
      warning: CRITIC_DIVERSITY_WARNING,
    };
  }
  const sameModel = models.includes(input.resolvedModel);
  const diversity: DiversityResult = sameModel
    ? "same-model"
    : providersMatch(input)
      ? "same-provider"
      : "diverse";
  const sameModelWarning = sameModelWarningOf(diversity);
  return sameModelWarning
    ? { diversity, sameModelWarning, proceed: true, warning: CRITIC_DIVERSITY_WARNING }
    : { diversity, sameModelWarning, proceed: true };
}

function providersMatch(input: {
  resolvedProvider?: string | null;
  passProviders?: readonly (string | null)[];
}): boolean {
  const provider = input.resolvedProvider ?? null;
  if (provider === null) return false;
  return (input.passProviders ?? []).some((candidate) => candidate === provider);
}

/**
 * Whether a diversity result disqualifies a critic candidate: NEVER. An
 * unknown real model is `unverified` and ELIGIBLE (F124-FR-047); the rule
 * records and warns, and qualification is never refused for diversity.
 */
export function diversityDisqualifies(_result: DiversityResult | string): boolean {
  return false;
}
