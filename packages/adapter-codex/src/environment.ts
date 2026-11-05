/**
 * T023 — the builder of the environment of a Codex call (F131-FR-015).
 *
 * The environment of every call is an allow-list: the search path, the
 * locale, the home or its overlay, the variable that carries the API key at
 * auth tier 2 for the role that needs it, and what the descriptor names
 * (`CODEX_HOME`). No other provider key of the consumer reaches the
 * harness. The key of the critic is never in the environment of the
 * proposer, and the reverse. A key reaches the harness in the environment of
 * the process and NEVER in an argument list — `argumentListHoldsSecret`
 * checks a built argument list for a planted value.
 */

/**
 * The allow-list of names the descriptor names, beyond the base
 * (`PATH`, `LANG`, `LC_ALL`, `HOME`).
 */
export const CODEX_ENV_ALLOW = ["CODEX_HOME"] as const;

/** The base of the allow-list of every call. */
export const CODEX_BASE_ALLOW_LIST = ["PATH", "LANG", "LC_ALL", "HOME"] as const;

/** The roles whose credentials must never cross. */
export const CODEX_CALL_ROLES = ["proposer", "critic"] as const;
export type CodexCallRole = (typeof CODEX_CALL_ROLES)[number];

/** The key variable of auth tier 2; the critic's only, never the proposer's. */
export const CODEX_KEY_VARIABLE = "OPENAI_API_KEY" as const;

/**
 * Per role: the credential variables the role may hold. The proposer at
 * auth tier 1 runs on the consumer's login, so it holds NO credential
 * variable; only the critic at tier 2 holds the key. This is the table the
 * separation of the roles is enforced from.
 */
export const CODEX_CREDENTIAL_VARIABLES: Readonly<Record<CodexCallRole, readonly string[]>> =
  Object.freeze({
    proposer: [],
    critic: [CODEX_KEY_VARIABLE],
  });

/** The allow-list of one call, before the values are read. */
export function codexAllowList(input: {
  readonly role: CodexCallRole;
  readonly parityVariables?: readonly string[];
}): readonly string[] {
  if (input.parityVariables !== undefined) {
    // Under `parity` the allow-list IS the baseline's set, nothing added.
    return [...input.parityVariables];
  }
  const own = CODEX_CREDENTIAL_VARIABLES[input.role];
  const otherRole: CodexCallRole = input.role === "proposer" ? "critic" : "proposer";
  const others = CODEX_CREDENTIAL_VARIABLES[otherRole];
  return [
    ...CODEX_BASE_ALLOW_LIST,
    ...CODEX_ENV_ALLOW,
    ...own.filter((name) => !others.includes(name)),
  ];
}

/**
 * F131-FR-015 — build the environment of one call: the allow-list and
 * nothing else. Values are read from the consumer's environment only for
 * the names on the list; an overlay home replaces `HOME`.
 */
export function codexCallEnvironment(input: {
  readonly role: CodexCallRole;
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  readonly overlayHome?: string;
  readonly parityVariables?: readonly string[];
}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of codexAllowList(input)) {
    const value = input.processEnv[name];
    if (value !== undefined) environment[name] = value;
  }
  if (input.overlayHome !== undefined) environment.HOME = input.overlayHome;
  return environment;
}

/**
 * Whether a built argument list holds a secret value. A key reaches the
 * harness only in the environment of the process; the argument lists of the
 * descriptor are lists of flags and placeholders. Returns the index of the
 * offending argument, or `null`.
 */
export function argumentListHoldsSecret(
  args: readonly string[],
  secrets: readonly string[],
): number | null {
  for (let index = 0; index < args.length; index += 1) {
    if (secrets.some((secret) => secret !== "" && args[index].includes(secret))) {
      return index;
    }
  }
  return null;
}
