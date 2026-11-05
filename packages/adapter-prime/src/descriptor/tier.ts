/**
 * T054 — the auth tier and terms data of the prime descriptor
 * (F138-FR-004; user story 5, "no containment on purpose, terms unknown").
 *
 * The tiers of prime are 1 and 2, never 3. `provider.termsRef` is null, so
 * the terms gate of feature 100 (annex C §C.12) reads UNKNOWN terms: prime is
 * "fleet only" — usable when the consumer names it, never a default of a
 * role and never picked automatically as critic, under EVERY audience. A
 * login of the harness that reuses a subscription token is auth tier 3 and
 * is refused. A change of the terms data that gives prime a row needs no
 * code change: the terms gate reads `provider.termsRef` from the descriptor
 * data, and this module reads the same field at run time.
 */
import { primeDescriptor } from "./index.ts";

/** The audiences of feature 100 (row 41 of the closed sets). */
export type Audience = "personal" | "distributed";
/** Every audience there is: the bar holds under each of them. */
export const AUDIENCES: readonly Audience[] = ["personal", "distributed"];

/** The auth tiers prime offers, from the descriptor data. */
export const PRIME_AUTH_TIERS: readonly number[] = Object.freeze(
  (primeDescriptor.auth as { tiers: number[] }).tiers,
);

/** The tier a subscription-token login of the harness would be: refused. */
export const PRIME_TIER_REFUSED = 3;

/** The terms reference of prime, from the descriptor data: null (unknown). */
export const PRIME_TERMS_REF: string | null = (
  primeDescriptor.provider as { termsRef: string | null }
).termsRef;

/** The phrase every launch that names prime states, and the doctor warns with. */
export const UNKNOWN_TERMS_WARNING =
  "prime: the terms of the harness are unknown (provider.termsRef is null); " +
  "prime is never a default of a role and never picked automatically as critic, " +
  "under every audience";

/** A login that reuses a subscription token is auth tier 3: refused. */
export class Tier3RefusedError extends Error {
  readonly tier: number;
  constructor(tier: number) {
    super(
      `prime: auth tier ${tier} is refused; prime offers the tiers ` +
        `${PRIME_AUTH_TIERS.join(" and ")} and never ${PRIME_TIER_REFUSED} ` +
        `(a login that reuses a subscription token)`,
    );
    this.name = "Tier3RefusedError";
    this.tier = tier;
  }
}

/** Refuse an auth tier prime does not offer (tier 3 in particular). */
export function assertAuthTierAllowed(tier: number): void {
  if (!PRIME_AUTH_TIERS.includes(tier)) throw new Tier3RefusedError(tier);
}

/** True when the tier is one prime offers. */
export function authTierAllowed(tier: number): boolean {
  return PRIME_AUTH_TIERS.includes(tier);
}

/**
 * The terms gate's reading of prime: `unknown`, because `provider.termsRef`
 * is null. The gate reads the descriptor field, so a terms data change that
 * gives prime a row needs no code change here.
 */
export function termsOfPrime(): "unknown" | { known: string } {
  if (PRIME_TERMS_REF === null) return "unknown";
  return { known: PRIME_TERMS_REF };
}

/** True while the terms of prime are unknown. */
export function termsAreUnknown(): boolean {
  return PRIME_TERMS_REF === null;
}

/**
 * Is prime the DEFAULT of a role? Never, for either role, under every
 * audience (ruling P14; F138-FR-004, F138-FR-047).
 */
export function primeMayBeDefault(audience: Audience, role: "proposer" | "critic"): boolean {
  void audience;
  void role;
  return false;
}

/**
 * May discovery or the critic order PICK prime automatically? Never, under
 * every audience, whatever step it would qualify in (F138-FR-004,
 * F138-FR-047).
 */
export function primeMayBeAutoPicked(audience: Audience, role: "proposer" | "critic"): boolean {
  void audience;
  void role;
  return false;
}

/**
 * Is prime usable when the consumer NAMES it in configuration? Yes —
 * "fleet only" bars the default and the automatic pick, not the named use.
 */
export function primeUsableWhenNamed(audience: Audience, role: "proposer" | "critic"): boolean {
  void audience;
  void role;
  return true;
}

/**
 * The role gate of a launch (F138-SC-011): prime is in a role only when the
 * consumer named it. A role the configuration does not name stays unfilled
 * even when discovery found prime.
 */
export function roleForPrime(input: {
  audience: Audience;
  role: "proposer" | "critic";
  named: boolean;
  discovered?: boolean;
}): "named" | "not-in-role" {
  void input.discovered;
  if (!primeUsableWhenNamed(input.audience, input.role)) return "not-in-role";
  return input.named ? "named" : "not-in-role";
}
