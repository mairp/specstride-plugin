/**
 * T103 — the plan STAYS BOUND to its sources (F105-FR-043).
 *
 * Inside AND OUTSIDE the `parity` profile the verification plan stays bound to
 * the hashes of its sources, and the public command `verify` REFUSES A STALE
 * PLAN WITH THE CODE 3 whenever it loads one. That is the one staleness check
 * this feature makes outside the profile, and it is not a check of a running
 * loop: `verify` is a command a person or a script calls, and it is told what
 * it refused.
 *
 * The comparison of the hashes of spec, plan and task list at launch, at
 * `resume` and at every pass start is NOT made by this feature (F105-FR-043):
 * it is the default of row 15 of annex X §X.7, whose owners are 102, 103 and
 * 105, and the two features before this one make it.
 */
import { CONFIGURATION_ERROR_CODE } from "../mode/closed-sets.ts";
import { VerificationError, type VerificationPlan } from "../plan/record.ts";
import { loadPlan, STALE, type ExpectedSpec } from "../plan/validate.ts";
import { PARITY_PROFILE } from "./plan-check.ts";

/** The binding holds inside AND outside the profile (F105-FR-043). */
export const THE_BINDING_HOLDS_OUTSIDE_THE_PROFILE = true as const;

/** `verify` refuses a stale plan with the code 3 (F105-FR-043). */
export const VERIFY_REFUSES_A_STALE_PLAN = true as const;
/** The code that refusal ends with (F105-FR-043). */
export const STALE_CODE = CONFIGURATION_ERROR_CODE;

/**
 * The three comparisons this feature does NOT make (F105-FR-043): they are the
 * default of row 15 and belong to the features that own staleness of a source.
 */
export const COMPARISONS_THIS_FEATURE_DOES_NOT_MAKE = [
  "launch",
  "resume",
  "every pass start",
] as const;

/** The features that make them (the owner cell of row 15 of §X.7). */
export const OWNERS_OF_THOSE_COMPARISONS = ["102", "103"] as const;

/** The outcome of the binding check of `verify` (F105-FR-043). */
export type BindingCheck =
  | { readonly bound: true; readonly plan: VerificationPlan }
  | {
      readonly bound: false;
      readonly code: typeof STALE_CODE;
      readonly reason: string;
      readonly stale: boolean;
    };

/**
 * The check the public command `verify` makes WHENEVER IT LOADS A PLAN
 * (F105-FR-043). It is made under every profile — `profile` is taken only so
 * that a caller can record which run it was, and it never changes the answer.
 */
export function checkTheBinding(input: {
  readonly path: string;
  readonly read: (path: string) => string;
  readonly expected: ExpectedSpec;
  readonly profile?: string | undefined;
}): BindingCheck {
  try {
    const plan = loadPlan({ path: input.path, read: input.read, expected: input.expected });
    return Object.freeze({ bound: true as const, plan });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      bound: false as const,
      code: STALE_CODE,
      reason,
      stale: reason.startsWith(STALE),
    });
  }
}

/** The verification error the refusal raises, for a caller that throws. */
export function errorOfTheBinding(check: BindingCheck): VerificationError | undefined {
  return check.bound ? undefined : new VerificationError(check.reason);
}

/**
 * True where the profile is `parity`. The binding does not depend on it; the
 * helper exists so a test can say which run it drove and assert that the
 * answer did NOT change (F105-FR-043).
 */
export function isTheParityProfile(profile: string | undefined): boolean {
  return profile === PARITY_PROFILE;
}
