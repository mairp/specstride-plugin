/**
 * T102 — the check of the plan at CRITIC START, and at every other step the
 * baseline hands the spec together with the plan, UNDER THE `parity` PROFILE
 * ONLY (F105-FR-042, `research.md` D-10, DV-082).
 *
 * Under the profile:
 *
 *  - a plan that is invalid, stale, or not given by an absolute place ends the
 *    CRITIC CALL with the result code 3 and `invalid verification plan:
 *    <reason>`; a plan is STALE, with `verification plan is stale`, when the
 *    hash of the spec differs from `source.contentHash`;
 *  - the plan is named to the critic call by an argument whose default is the
 *    as-is variable `SPECSTRIDE_VERIFICATION_PLAN`, and an EMPTY VALUE means
 *    no plan;
 *  - every step of the engine that the baseline hands the spec together with
 *    the plan makes the SAME check when it loads the plan, with the effect the
 *    baseline has: the verification gate and release verification end with the
 *    code 3, which is a FAILED verification gate — so in the mode `required` a
 *    stale plan is met AT THE VERIFICATION GATE, before any critic call; the
 *    phase context is left out of the prompt; and the step of commands staged
 *    before writes NEITHER its log line NOR its event.
 *
 * Outside the profile this feature makes NO staleness check at critic start,
 * at the verification gate or in either of those steps, and no critic call is
 * refused for a stale plan: the baseline refused a critic call 22 hours into a
 * phase attempt, and ruling K3 ended that.
 */
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import { CONFIGURATION_ERROR_CODE } from "../mode/closed-sets.ts";
import { parityValueOf, STALENESS_CHECK_POINTS_KEY } from "../mode/switches.ts";
import { VerificationError, type VerificationPlan } from "../plan/record.ts";
import { loadPlan, STALE, type ExpectedSpec } from "../plan/validate.ts";

/** The prefix of the refusal a critic call ends with (F105-FR-042). */
export const INVALID_PREFIX = "invalid verification plan" as const;
/** The result code the refusal ends with: 3 (F105-FR-042). */
export const INVALID_CODE = CONFIGURATION_ERROR_CODE;
/** The as-is variable the argument of the critic call defaults to. */
export const PLAN_VARIABLE = "SPECSTRIDE_VERIFICATION_PLAN" as const;
/** The argument that names the plan to the critic call (B-0803). */
export const PLAN_ARGUMENT = "--verification-plan" as const;
/** The message a stale plan gives (F105-FR-042, an as-is literal). */
export const STALE_MESSAGE = STALE;

/** The whole refusal of F105-FR-042. */
export function invalidPlanMessage(reason: string): string {
  return `${INVALID_PREFIX}: ${reason}`;
}

/**
 * The place of the plan the critic call takes: the argument where it is given,
 * else the as-is variable, and an EMPTY VALUE MEANS NO PLAN (F105-FR-042,
 * B-0849).
 */
export function planPlaceOf(input: {
  readonly argument?: string | undefined;
  readonly variable?: string | undefined;
}): string | undefined {
  const argument = input.argument ?? "";
  if (argument !== "") return argument;
  const variable = input.variable ?? "";
  return variable === "" ? undefined : variable;
}

/** The four steps that load the plan under the profile (F105-FR-042). */
export const STEPS_THAT_LOAD_THE_PLAN = [
  "critic-start",
  "verification-gate",
  "release-verification",
  "phase-context",
  "prestage",
] as const;
export type StepThatLoadsThePlan = (typeof STEPS_THAT_LOAD_THE_PLAN)[number];

/**
 * What a step does with a plan it refused (F105-FR-042), as DATA: the effect
 * is the baseline's and differs per step, and a reader of one step must be
 * able to see the whole table.
 */
export const EFFECT_OF_A_REFUSAL: Readonly<Record<StepThatLoadsThePlan, string>> = Object.freeze({
  "critic-start":
    "the critic call ends with the result code 3 and `invalid verification plan: <reason>`",
  "verification-gate":
    "the verification gate ends with the code 3, which is a failed verification gate (F105-FR-005), so in the mode `required` a stale plan is met at the gate, before any critic call",
  "release-verification":
    "release verification ends with the code 3, which is a failed verification gate (F105-FR-008)",
  "phase-context": "the phase context is left out of the prompt",
  prestage: "the step of commands staged before writes neither its log line nor its event",
});

/**
 * The profile the check lives under (F105-FR-042): the name is feature 100's
 * (`PROFILE_NAME` of `@specstride/contracts/profile/parity`) and is never
 * retyped here.
 */
export const PARITY_PROFILE: string = PROFILE_NAME;

/** The row of §X.7 that holds the check points of staleness: row 15. */
export const CHECK_POINTS_ROW = 15 as const;

/**
 * The value of row 15 under `parity`, read from the annex: `critic start
 * only`. The default of the row is `launch, resume and every pass start`,
 * which the comparison of the hashes of spec, plan and task list makes and
 * which is NOT this feature's (F105-FR-043).
 */
export const CHECK_POINTS_UNDER_PARITY: unknown = parityValueOf(STALENESS_CHECK_POINTS_KEY);

/**
 * Whether THIS FEATURE makes its staleness check: only under the `parity`
 * profile (F105-FR-042, `research.md` D-10, ruling K3). Outside it the
 * function is false for every step, and no critic call is refused for a stale
 * plan.
 */
export function planStalenessIsChecked(profile: string | undefined): boolean {
  return profile === PARITY_PROFILE;
}

/** Outside the `parity` profile NO critic call is refused for a stale plan. */
export const A_CRITIC_CALL_IS_REFUSED_OUTSIDE_THE_PROFILE = false as const;

/** The outcome of a plan check at a step (F105-FR-042). */
export type PlanCheck =
  | { readonly checked: false; readonly reason: string; readonly plan?: VerificationPlan }
  | { readonly checked: true; readonly passed: true; readonly plan: VerificationPlan }
  | {
      readonly checked: true;
      readonly passed: false;
      readonly code: typeof INVALID_CODE;
      readonly message: string;
      readonly stale: boolean;
    };

/**
 * The check of one step (F105-FR-042). `profile` decides whether the check is
 * made at all: outside `parity` it is NOT, and the function says so with
 * `checked: false` and its reason, having loaded the plan WITHOUT the
 * comparison of the source hash.
 */
export function checkThePlan(input: {
  readonly step: StepThatLoadsThePlan;
  readonly profile: string | undefined;
  readonly path: string | undefined;
  readonly read: (path: string) => string;
  readonly expected: ExpectedSpec;
}): PlanCheck {
  if (input.path === undefined) {
    return Object.freeze({
      checked: false as const,
      reason: "no plan was named: an empty value means no plan (F105-FR-042)",
    });
  }
  if (!planStalenessIsChecked(input.profile)) {
    // Outside the profile the plan is still LOADED where a step needs it, but
    // no staleness check is made and no call is refused for a stale plan.
    let plan: VerificationPlan | undefined;
    try {
      plan = loadPlan({ path: input.path, read: input.read });
    } catch {
      plan = undefined;
    }
    return Object.freeze({
      checked: false as const,
      reason:
        `the staleness check of the verification plan stays under the \`${PARITY_PROFILE}\` ` +
        "profile only (F105-FR-042, ruling K3); this run is outside it",
      ...(plan !== undefined ? { plan } : {}),
    });
  }
  try {
    const plan = loadPlan({ path: input.path, read: input.read, expected: input.expected });
    return Object.freeze({ checked: true as const, passed: true as const, plan });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      checked: true as const,
      passed: false as const,
      code: INVALID_CODE,
      message: invalidPlanMessage(reason),
      stale: reason.startsWith(STALE_MESSAGE),
    });
  }
}

/** The check at CRITIC START (F105-FR-042, B-0803, B-0849, B-0864). */
export function checkThePlanAtCriticStart(input: {
  readonly profile: string | undefined;
  readonly argument?: string | undefined;
  readonly variable?: string | undefined;
  readonly read: (path: string) => string;
  readonly expected: ExpectedSpec;
}): PlanCheck {
  const place = planPlaceOf({ argument: input.argument, variable: input.variable });
  return checkThePlan({
    step: "critic-start",
    profile: input.profile,
    path: place,
    read: input.read,
    expected: input.expected,
  });
}

/**
 * A plan that is not given by an ABSOLUTE place is refused the same way
 * (F105-FR-042): the refusal comes out of `loadPlan`, and this helper is what
 * a caller asserts on.
 */
export function refusalOfARelativePlace(path: string): string {
  return invalidPlanMessage(`verification plan path must be absolute: ${path}`);
}

/** The verification error a refusal of this module raises, for a caller. */
export function errorOf(check: PlanCheck): VerificationError | undefined {
  return check.checked && !check.passed ? new VerificationError(check.message) : undefined;
}

/**
 * The plan a STEP loads (F105-FR-042). It is the one call every step of the
 * engine that the baseline hands the spec together with the plan makes:
 *
 *  - under the `parity` profile the plan is checked, and a plan that is
 *    invalid, stale or not given by an absolute place THROWS the verification
 *    error of the requirement — which in the verification gate and in release
 *    verification is a gate that COULD NOT RUN, so its code is 3 and the
 *    rejection is the same one a failed command makes (F105-FR-005,
 *    F105-FR-008); in the phase context it is a context left out of the
 *    prompt; in the step of commands staged before it is a step that writes
 *    neither its log line nor its event;
 *  - OUTSIDE the profile no staleness check is made: the plan is loaded
 *    WITHOUT the comparison of the source hash, and a plan whose source moved
 *    is handed back unchanged.
 *
 * `runGateOrCode3` of `../gate/gate.ts` is the seam the verification gate
 * calls it through: a `prepare` that throws becomes the code 3.
 */
export function planForAStep(input: {
  readonly step: StepThatLoadsThePlan;
  readonly profile: string | undefined;
  readonly path: string | undefined;
  readonly read: (path: string) => string;
  readonly expected: ExpectedSpec;
}): VerificationPlan | undefined {
  const check = checkThePlan(input);
  if (check.checked && !check.passed) throw new VerificationError(check.message);
  if (check.checked) return check.plan;
  // Outside the profile, or with no plan named: whatever was loaded, which is
  // `undefined` where nothing was.
  return check.plan;
}

/**
 * Whether a step writes its line and its event after the plan was refused
 * (F105-FR-042): the step of commands staged before writes NEITHER, and the
 * phase context is left out of the prompt. The table is data so that a reader
 * of one step sees the whole rule.
 */
export const AFTER_A_REFUSAL: Readonly<
  Record<
    StepThatLoadsThePlan,
    {
      readonly resultCode?: number;
      readonly writesItsLine: boolean;
      readonly writesItsEvent: boolean;
      readonly reachesThePrompt?: boolean;
    }
  >
> = Object.freeze({
  "critic-start": Object.freeze({
    resultCode: INVALID_CODE,
    writesItsLine: false,
    writesItsEvent: false,
  }),
  "verification-gate": Object.freeze({
    resultCode: INVALID_CODE,
    writesItsLine: true,
    writesItsEvent: true,
  }),
  "release-verification": Object.freeze({
    resultCode: INVALID_CODE,
    writesItsLine: true,
    writesItsEvent: true,
  }),
  "phase-context": Object.freeze({
    writesItsLine: false,
    writesItsEvent: false,
    reachesThePrompt: false,
  }),
  prestage: Object.freeze({ writesItsLine: false, writesItsEvent: false }),
});
