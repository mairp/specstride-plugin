/**
 * T054 — the auth handling of the prime adapter (F138-FR-005).
 *
 * Auth is by provider API key, handed to the process BY ENVIRONMENT, from a
 * secret reference resolved at the moment of use — never by an argument and
 * never by the prompt. The adapter reads no authentication file of the
 * harness. The environment of every process is an allow-list: the search
 * path, the locale, the home the auth tier gives (F138-FR-045), the session
 * directory variable, the variables the consumer named for the provider in
 * use, and the telemetry switches — nothing else. The credentials of the
 * critic are not in the environment of the proposer, or the reverse. A
 * credential the secret resolver reports absent fails the launch before the
 * first pass and names what is missing.
 */

/** The telemetry switches of F138-FR-041 (from the dialect row's env names). */
export const TELEMETRY_ENV_NAMES = ["PRIME_AGENT_TELEMETRY", "DO_NOT_TRACK"] as const;

/** The session directory variable of the harness (F138-FR-014, F138-FR-045). */
export const SESSION_DIR_VAR = "PRIME_AGENT_SESSION_DIR";

/** The fixed members of the allow-list: search path, locale, home. */
export const FIXED_ALLOW_NAMES = ["PATH", "LANG", "LC_*"] as const;

/** The only channel a credential travels by: the environment. */
export const CREDENTIAL_CHANNELS = ["environment"] as const;

/** A role of a call, as the allow-list sees it. */
export type PrimeRole = "proposer" | "critic";

/** A provider credential: the variable name and the secret reference of it. */
export type ProviderCredential = {
  /** The environment variable the key is handed under. */
  readonly envName: string;
  /** The secret reference (§K.7), resolved at the moment of use. */
  readonly secretRef: string;
};

/** What the environment of one call may hold, as names (patterns allowed). */
export type AllowListInput = {
  /** The home the auth tier gives (F138-FR-045). Always `HOME` here. */
  readonly homeVar?: string;
  /** The session directory variable, where the call sets it. */
  readonly sessionDirVar?: string | null;
  /** The variables the consumer named for the provider in use. */
  readonly providerEnvNames?: readonly string[];
  /** The telemetry switches (always present). */
  readonly telemetryEnvNames?: readonly string[];
};

/** The full allow-list of a call, as an ordered list of names. */
export function environmentAllowList(input: AllowListInput = {}): readonly string[] {
  return Object.freeze([
    ...FIXED_ALLOW_NAMES,
    input.homeVar ?? "HOME",
    ...(input.sessionDirVar ? [input.sessionDirVar] : []),
    ...(input.providerEnvNames ?? []),
    ...(input.telemetryEnvNames ?? TELEMETRY_ENV_NAMES),
  ]);
}

/** One name of the actual environment against one allow-list entry. */
function nameAllowed(name: string, entry: string): boolean {
  if (entry.endsWith("*")) return name.startsWith(entry.slice(0, -1));
  return name === entry;
}

/** True when the variable name is in the allow-list. */
export function nameInAllowList(name: string, allow: readonly string[]): boolean {
  return allow.some((entry) => nameAllowed(name, entry));
}

/**
 * The environment a process sees: only the variables the allow-list names,
 * nothing else. The values are copied as they are; no secret value is
 * dropped here — the allow-list decides what the process sees at all.
 */
export function filterEnvironment(
  env: Readonly<Record<string, string>>,
  allow: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    if (nameInAllowList(name, allow)) out[name] = env[name];
  }
  return out;
}

/** A credential the secret resolver reports absent: the launch fails. */
export class CredentialAbsentError extends Error {
  readonly role: PrimeRole;
  readonly envName: string;
  readonly secretRef: string;
  constructor(role: PrimeRole, credential: ProviderCredential) {
    super(
      `prime: the ${role} credential is absent — the secret reference ` +
        `\`${credential.secretRef}\` for the environment variable ` +
        `\`${credential.envName}\` could not be resolved; the launch fails ` +
        `before the first pass`,
    );
    this.name = "CredentialAbsentError";
    this.role = role;
    this.envName = credential.envName;
    this.secretRef = credential.secretRef;
  }
}

/**
 * Resolve the credential of one role at the moment of use and hand it back
 * as the environment entry it travels by. A reference the resolver reports
 * absent throws `CredentialAbsentError` — the launch fails before the first
 * pass and names what is missing. The key never reaches an argument or the
 * prompt: the only channel of the return value is the environment.
 */
export function resolveCredential(input: {
  role: PrimeRole;
  credential: ProviderCredential;
  /** The secret resolver; called at the moment of use. */
  resolve: (secretRef: string) => string | null;
}): { envName: string; value: string } {
  const value = input.resolve(input.credential.secretRef);
  if (value === null || value === undefined) {
    throw new CredentialAbsentError(input.role, input.credential);
  }
  return { envName: input.credential.envName, value };
}

/** Which role's credential a variable name belongs to, if either. */
export function credentialRoleOfName(
  name: string,
  credentials: Readonly<Record<PrimeRole, ProviderCredential | null>>,
): PrimeRole | null {
  for (const role of ["proposer", "critic"] as const) {
    const credential = credentials[role];
    if (credential && credential.envName === name) return role;
  }
  return null;
}

/**
 * The credential isolation of F138-FR-005: the critic's credential is not in
 * the proposer's environment, and the reverse. `filterEnvironment` already
 * drops unknown names; this states the rule over a built environment and is
 * the check the tests and the doctor read.
 */
export function credentialIsolationHolds(input: {
  role: PrimeRole;
  env: Readonly<Record<string, string>>;
  credentials: Readonly<Record<PrimeRole, ProviderCredential | null>>;
}): boolean {
  const other: PrimeRole = input.role === "proposer" ? "critic" : "proposer";
  const names = Object.keys(input.env);
  return !names.some((name) => credentialRoleOfName(name, input.credentials) === other);
}
