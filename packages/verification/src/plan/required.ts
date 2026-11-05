/**
 * T095 — the refusal of an AMBIGUOUS plan in the mode `required`
 * (F105-FR-019).
 *
 * In the mode `required` a plan with ANY ambiguity is not written. The
 * derivation fails with `required verification is blocked: <ambiguities>` and
 * the code 3. The ambiguities are joined with `"; "`, as the baseline joins
 * them (`lib/verification_plan.py`:2318), and they are the plan's own list —
 * which the blocker rule of F105-FR-015 has already filled with every blocker
 * and its provenance.
 *
 * The refusal is the check of the MODE: it happens after the plan is derived
 * and BEFORE it is persisted, so a blocked launch leaves no plan behind.
 */
import { CONFIGURATION_ERROR_CODE } from "../mode/closed-sets.ts";
import { VerificationError, type VerificationPlan } from "./record.ts";

/** The as-is message of F105-FR-019, without its list. */
export const BLOCKED_PREFIX = "required verification is blocked" as const;

/** The separator the baseline joins the ambiguities with (`:2318`). */
export const AMBIGUITY_SEPARATOR = "; " as const;

/** The result code the refusal ends with: 3 (F105-FR-019). */
export const BLOCKED_CODE = CONFIGURATION_ERROR_CODE;

/** The whole message of F105-FR-019 (`required verification is blocked: …`). */
export function blockedMessage(ambiguities: readonly string[]): string {
  return `${BLOCKED_PREFIX}: ${ambiguities.join(AMBIGUITY_SEPARATOR)}`;
}

/** True where the mode `required` refuses this plan (F105-FR-019). */
export function requiredIsBlocked(input: {
  readonly required: boolean;
  readonly ambiguities: readonly string[];
}): boolean {
  return input.required && input.ambiguities.length > 0;
}

/**
 * The check of the mode `required` on a derived plan (F105-FR-019): it throws
 * the verification error of the requirement, and otherwise returns the plan
 * unchanged, so a caller writes `persist(refuseAnAmbiguousPlan(...))`.
 */
export function refuseAnAmbiguousPlan(input: {
  readonly plan: VerificationPlan;
  readonly required: boolean;
}): VerificationPlan {
  if (requiredIsBlocked({ required: input.required, ambiguities: input.plan.ambiguities })) {
    throw new VerificationError(blockedMessage(input.plan.ambiguities));
  }
  return input.plan;
}

/** In the mode `required` a plan with any ambiguity is NOT WRITTEN. */
export const AN_AMBIGUOUS_PLAN_IS_WRITTEN_IN_REQUIRED = false as const;
