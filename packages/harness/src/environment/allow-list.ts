/**
 * T021 — the builder of the environment of a call (F109-FR-028).
 *
 * The environment of every call of a harness is an ALLOW-LIST: the search
 * path, the locale, the home or its overlay, the harness's own auth
 * variables, and the variables that `isolation.envAllow` of the descriptor
 * names. No other variable of the consumer reaches the harness. The
 * credentials of the critic are never in the environment of the proposer,
 * and the reverse. Under the `parity` profile the allow-list is exactly the
 * set of variables the baseline hands to the harness.
 */

/** The base of the allow-list: search path, locale, home. */
export const BASE_ALLOW_LIST = ["PATH", "LANG", "LC_ALL", "HOME"] as const;

/** The roles whose credentials must never cross (F109-FR-028). */
export const CALL_ROLES = ["proposer", "critic"] as const;
export type CallRole = (typeof CALL_ROLES)[number];

/** What the builder reads. */
export type AllowListInput = {
  readonly role: CallRole;
  /**
   * Per role: the names of the harness's own auth variables. Only the role's
   * own names are taken; the other role's credentials never appear.
   */
  readonly credentialVars?: Readonly<Record<string, readonly string[]>>;
  /** The names `isolation.envAllow` of the descriptor lists. */
  readonly envAllow?: readonly string[];
  /** The process environment of the consumer; read only through the list. */
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  /** The overlay home of the call, where one was built; becomes `HOME`. */
  readonly overlayHome?: string;
  /**
   * Under the `parity` profile: the exact variable names the baseline hands
   * to the harness. Where this is given, it IS the allow-list.
   */
  readonly parityVariables?: readonly string[];
};

/**
 * The allow-list of one call, before the values are read: base, the role's
 * own credentials, and the descriptor's `isolation.envAllow`.
 */
export function allowListOf(input: {
  readonly role: CallRole;
  readonly credentialVars?: Readonly<Record<string, readonly string[]>>;
  readonly envAllow?: readonly string[];
  readonly parityVariables?: readonly string[];
}): readonly string[] {
  if (input.parityVariables !== undefined) {
    // Under `parity` the allow-list IS the baseline's set, nothing added.
    return [...input.parityVariables];
  }
  const own = input.credentialVars?.[input.role] ?? [];
  const otherRoles = CALL_ROLES.filter((role) => role !== input.role);
  const others = otherRoles.flatMap((role) => input.credentialVars?.[role] ?? []);
  return [
    ...BASE_ALLOW_LIST,
    ...own.filter((name) => !others.includes(name)),
    // `envAllow` never overrides the separation of the roles' credentials.
    ...(input.envAllow ?? []).filter((name) => !own.includes(name) && !others.includes(name)),
  ];
}

/**
 * F109-FR-028 — build the environment of one call: the allow-list and
 * nothing else. Values are read from the consumer's environment only for the
 * names on the list; a name the consumer does not hold is left out.
 */
export function buildCallEnvironment(input: AllowListInput): Record<string, string> {
  const names = allowListOf(input);
  const environment: Record<string, string> = {};
  for (const name of names) {
    const value = input.processEnv[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  if (input.overlayHome !== undefined) {
    // The home or its overlay: an overlay home replaces `HOME`.
    environment.HOME = input.overlayHome;
  }
  return environment;
}
