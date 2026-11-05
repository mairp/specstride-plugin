/**
 * T071 — the identity of each role for the critic-diversity test
 * (F138-FR-047; F138-FR-004; user story 5).
 *
 * While the terms of prime are unknown, prime is never picked automatically
 * as a critic, whatever step of the critic order it would qualify in, and it
 * is never the default critic, under EVERY audience — that is the rule of
 * `../descriptor/tier.ts`, which this module states again for the diversity
 * test. A consumer who NAMES prime as the critic gets the unknown-terms
 * warning at launch and the run goes on.
 *
 * The diversity test of feature 100 (F100-FR-024; annex E §E.1) needs the
 * provider and model identity of each side. On bare prime the identity is
 * the model the consumer named, and null where none was named; on
 * `prime:<variant>` it is null, because the variant selects a model the
 * product cannot see (F138-FR-022). A NULL IS NEVER REPLACED BY A GUESS.
 * A null on either side gives the result `unverified`, and the same model on
 * both sides the result `same-model`; both raise the critic-diversity
 * warning, which is recorded and does not block a run.
 */
import { primeDescriptor, type PrimeDescriptor } from "./index.ts";
import { AUDIENCES, type Audience } from "./tier.ts";

/** The harness name every identity states as the provider. */
export const IDENTITY_PROVIDER = "prime" as const;

/** The role an identity is for. */
export type IdentityRole = "proposer" | "critic";

/** The qualifier form the identity was read from. */
export type IdentityForm = "bare" | "variant";

/** The identity of one role, as the diversity test reads it. */
export type RoleIdentity = {
  /** The provider of the harness. */
  readonly provider: typeof IDENTITY_PROVIDER;
  /** The role this identity belongs to. */
  readonly role: IdentityRole;
  /** The qualifier form: bare prime, or `prime:<variant>`. */
  readonly form: IdentityForm;
  /**
   * The model identity: on bare prime the model the consumer named, else —
   * unnamed bare prime and EVERY variant — null. Never a guess.
   */
  readonly model: string | null;
};

/**
 * The identity of one role for the diversity test (F138-FR-047). A variant
 * ALWAYS gives a null model: the variant selects a model the product cannot
 * see. Bare prime gives the named model, or null where none was named. No
 * code path here invents a model name.
 */
export function identityForRole(input: {
  role: IdentityRole;
  form: IdentityForm;
  /** The model the consumer named, when one was named at all. */
  model?: string | null;
}): RoleIdentity {
  const named = input.model !== undefined && input.model !== null && input.model.trim() !== "";
  return {
    provider: IDENTITY_PROVIDER,
    role: input.role,
    form: input.form,
    model: input.form === "variant" ? null : named ? (input.model as string).trim() : null,
  };
}

/** The result of the critic-diversity test (feature 100, annex E §E.1). */
export type DiversityResult = "same-model" | "unverified" | "distinct";

/**
 * The diversity test over the two identities. A null on EITHER side gives
 * `unverified` — the product cannot see the other side's model, and it does
 * not guess. The same model on both sides gives `same-model`. Otherwise the
 * sides are distinct.
 */
export function criticDiversityResult(input: {
  proposer: RoleIdentity;
  critic: RoleIdentity;
}): DiversityResult {
  if (input.proposer.model === null || input.critic.model === null) return "unverified";
  return input.proposer.model === input.critic.model ? "same-model" : "distinct";
}

/** The results that raise the critic-diversity warning. */
export const DIVERSITY_WARNING_RESULTS: readonly DiversityResult[] = Object.freeze([
  "unverified",
  "same-model",
]);

/** The warning the run records; it never blocks the run. */
export function criticDiversityWarning(result: DiversityResult): string | null {
  if (!DIVERSITY_WARNING_RESULTS.includes(result)) return null;
  return (
    `critic-diversity: ${result} — the proposer and the critic do not present ` +
    `two distinct model identities; the run goes on, the warning is recorded ` +
    `(feature 100, annex E §E.1)`
  );
}

/** The per-run record of the diversity test: result, warning, not blocking. */
export function criticDiversityRecord(input: { proposer: RoleIdentity; critic: RoleIdentity }): {
  result: DiversityResult;
  warning: string | null;
  blocksRun: false;
} {
  const result = criticDiversityResult(input);
  return { result, warning: criticDiversityWarning(result), blocksRun: false };
}

/**
 * Prime is never picked AUTOMATICALLY as critic, and never the default
 * critic, under every audience (F138-FR-004, F138-FR-047). Read from the
 * descriptor's `x-automaticPick` field, so a descriptor change needs no code
 * change; the tier module states the same rule independently.
 */
export function primeNeverAutoPickedAsCritic(
  audience: Audience,
  descriptor: PrimeDescriptor = primeDescriptor,
): boolean {
  void audience;
  const pick = descriptor.x as { automaticPick?: { asCritic?: string } } | undefined;
  void pick;
  const stated = (descriptor as { "x-automaticPick"?: { asCritic?: string } })["x-automaticPick"];
  return stated?.asCritic === "never, under every audience";
}

/** Every audience the bar holds under (F138-FR-047). */
export const DIVERSITY_AUDIENCES: readonly Audience[] = AUDIENCES;
