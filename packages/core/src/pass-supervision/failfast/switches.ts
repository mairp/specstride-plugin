/**
 * T063 of feature 118 — the switches and defaults of the first-failure
 * predicate (F118-FR-041; CT-118-7; rows 4, 5, 11 and 51 of annex X §X.7).
 *
 * The predicate is its own switch, `verification.failfast`: on by default,
 * off under the `parity` profile, and nothing rides on the switch of a loop
 * layer (F100-FR-134: `FAILFAST_RIDES_ON_A_LOOP_LAYER` is false in
 * `@specstride/contracts`). `verification.failfast_action` is `stop` by
 * default; `continue-and-notify` as the default is an option that is off.
 * With the switch off, a yield of the kind `first_failure` is refused with
 * the reason `first-failure-off`, and the job is left running as at the
 * baseline.
 */

/** The switch of the first-failure predicate (F118-FR-041). */
export const FAILFAST_SWITCH_KEY = "verification.failfast" as const;

/** The switch of the default action on a first failure (F118-FR-041). */
export const FAILFAST_ACTION_KEY = "verification.failfast_action" as const;

/** The grace of the stop ladder, row 51 of annex X §X.7 (F118-FR-039). */
export const FAILFAST_GRACE_KEY = "verification.failfastGraceSec" as const;

/** The switch is on by default (F118-FR-041; F100-FR-134). */
export const FAILFAST_DEFAULT = true as const;

/** The default action on a first failure (F118-FR-041; F100-FR-134). */
export const FAILFAST_ACTION_DEFAULT = "stop" as const;

/**
 * `continue-and-notify` as the default is an option that is OFF
 * (F118-FR-041): only an explicit declaration of the artifact selects it.
 */
export const CONTINUE_AND_NOTIFY_AS_DEFAULT = false as const;

/** The grace between the termination and the kill, in seconds (row 51). */
export const FAILFAST_GRACE_SEC_DEFAULT = 10 as const;

/** The refusal of a `first_failure` yield while the switch is off (F118-FR-041). */
export const FIRST_FAILURE_OFF_REFUSAL = "first-failure-off" as const;

/** The profiles under which the switch is off. The `parity` profile is one. */
export const FAILFAST_OFF_PROFILES: readonly string[] = Object.freeze(["parity"]);

/** The environment the resolver reads: handed in, never the host's. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The resolved switches of one phase attempt. */
export interface FailfastSettings {
  /** True unless the profile turns the switch off or the operator set `false`. */
  readonly enabled: boolean;
  /** Where the value came from (the switch is auditable). */
  readonly source: "default" | "operator" | "profile";
  /** The action on a first failure: `stop` unless explicitly declared otherwise. */
  readonly action: "stop" | "continue-and-notify";
  /** The grace of the stop ladder, in seconds (default 10). */
  readonly graceSec: number;
}

function exactlyTrue(raw: string | undefined): boolean {
  return raw === "true";
}

/**
 * Resolve the switches of F118-FR-041. An explicit operator value wins over
 * the profile; the profile wins over the default; the default is on. A value
 * of `false` turns the switch off in any profile.
 */
export function resolveFailfastSettings(input: {
  readonly environment: Environment;
  readonly profile?: string | undefined;
}): FailfastSettings {
  const raw = input.environment[FAILFAST_SWITCH_KEY];
  const offByProfile =
    input.profile !== undefined &&
    (FAILFAST_OFF_PROFILES as readonly string[]).includes(input.profile);
  if (raw !== undefined && raw !== "") {
    return {
      enabled: exactlyTrue(raw),
      source: "operator",
      action: firstFailureAction({ declared: input.environment[FAILFAST_ACTION_KEY] }),
      graceSec: failfastGraceSec(input.environment),
    };
  }
  if (offByProfile) {
    return {
      enabled: false,
      source: "profile",
      action: firstFailureAction({ declared: input.environment[FAILFAST_ACTION_KEY] }),
      graceSec: failfastGraceSec(input.environment),
    };
  }
  return {
    enabled: FAILFAST_DEFAULT,
    source: "default",
    action: firstFailureAction({ declared: input.environment[FAILFAST_ACTION_KEY] }),
    graceSec: failfastGraceSec(input.environment),
  };
}

/**
 * The action on a first failure (F118-FR-041): `stop` is the default; only
 * the exact text `continue-and-notify` selects the other value, and
 * `continue-and-notify` can never become the default (the option is off).
 */
export function firstFailureAction(input: {
  readonly declared: string | undefined;
}): "stop" | "continue-and-notify" {
  return input.declared === "continue-and-notify" ? "continue-and-notify" : FAILFAST_ACTION_DEFAULT;
}

/** The grace of the stop ladder in seconds; a non-positive value reads as unset. */
export function failfastGraceSec(environment: Environment): number {
  const raw = environment[FAILFAST_GRACE_KEY];
  if (raw === undefined || raw === "") return FAILFAST_GRACE_SEC_DEFAULT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FAILFAST_GRACE_SEC_DEFAULT;
}

/**
 * The refusal of a yield of the kind `first_failure` while the switch is
 * off (F118-FR-041): the artifact is refused with the reason
 * `first-failure-off` and the job is left running as at the baseline.
 * `undefined` when the yield is allowed through.
 */
export function refuseFirstFailureYield(input: {
  readonly kind: string;
  readonly enabled: boolean;
}): typeof FIRST_FAILURE_OFF_REFUSAL | undefined {
  if (input.kind === "first_failure" && !input.enabled) return FIRST_FAILURE_OFF_REFUSAL;
  return undefined;
}
