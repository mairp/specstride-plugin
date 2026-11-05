/**
 * T115 — the interface types of EP-10, the secret resolver, from
 * `contracts/extension-points/EP-10.secret-resolver.json` and annex C, §C.11
 * (F100-FR-107).
 *
 * `specstride.secret-resolver/1`. A reference becomes a value at the moment
 * of use, and never earlier.
 */
export const POINT_ID = "specstride.secret-resolver/1" as const;
export const EP = "EP-10" as const;
export const ANNEX_SECTION = "annex C, §C.11" as const;

/** F100-FR-107 — the four operations of a resolver. */
export const OPERATIONS = ["handles", "exists", "resolve", "boundHost"] as const;
export type SecretResolverOperation = (typeof OPERATIONS)[number];

/** The errors of §C.11. */
export const ERRORS = ["missing", "inline-secret", "unsafe-file"] as const;
export type SecretResolverError = (typeof ERRORS)[number];

/** The schemes Wave 1 ships. A scheme is an open set, resolved through the registry. */
export const WAVE_1_SCHEMES = ["env:", "file:", "keychain:"] as const;

/** The result of `exists`: never the value (§C.11, Outputs). */
export const EXISTENCE = ["yes", "no", "unprobed"] as const;
export type Existence = (typeof EXISTENCE)[number];

/**
 * On Linux the existence check of the keychain reads `unprobed` until a query
 * is found that prints nothing (§C.11, Wave 1 implementations).
 */
export const KEYCHAIN_EXISTENCE_ON_LINUX: Existence = "unprobed";

/** A secret reference of the form `<scheme>:<target>`. */
export type SecretReference = string;

/** The scheme of a reference, with the colon; `undefined` where there is none. */
export function schemeOf(reference: SecretReference): string | undefined {
  const at = reference.indexOf(":");
  return at < 0 ? undefined : reference.slice(0, at + 1);
}

/** A resolved value: in memory, registered with the redactor. */
export type ResolvedSecret = {
  readonly value: string;
  readonly registeredWithTheRedactor: true;
};

/** F100-FR-107 — a secret resolver. */
export type SecretResolver = {
  handles(scheme: string): boolean;
  /** Never prints and never returns the value. */
  exists(reference: SecretReference): Promise<Existence>;
  resolve(reference: SecretReference): Promise<ResolvedSecret>;
  /** The host the secret may be sent to. */
  boundHost(reference: SecretReference): string | null;
};

/** "Guarantees of the core" of §C.11, as data. */
export const CORE_GUARANTEES = [
  "a secret is resolved at the moment of use",
  "passed by environment or standard input and never in an argument list",
  "written to no state, event, log or launch contract",
  "sent only to its bound host",
  "every resolved value is registered with the redactor for exact-match removal",
] as const;

/** "Guarantees of an implementation" of §C.11: a resolver makes no network call. */
export const A_RESOLVER_MAKES_A_NETWORK_CALL = false as const;

/** "Failure of an implementation" of §C.11, as data. */
export const FAILURE_PATH = "the resolver gives `missing`" as const;
export const FAILURE_PATHS: Readonly<Record<SecretResolverOperation, string>> = Object.freeze({
  handles: FAILURE_PATH,
  exists: FAILURE_PATH,
  resolve: FAILURE_PATH,
  boundHost: FAILURE_PATH,
});

/** For a role in use, `missing` refuses the launch or leads to this state. */
export const STATE_WHEN_MISSING_IN_A_RUN = "blocked-on-human" as const;

/**
 * "Unknown-value rule" of §C.11: a reference with a scheme that no resolver
 * handles is a configuration error; a value that is not a reference where a
 * reference is required is `inline-secret`.
 */
export function unknownValueOutcome(
  reference: string,
  handledSchemes: readonly string[],
): SecretResolverError | undefined {
  const scheme = schemeOf(reference);
  if (scheme === undefined) return "inline-secret";
  return handledSchemes.includes(scheme) ? undefined : "missing";
}

/** F100-FR-107 — a `file:` target lies outside the workspace, owner-readable only. */
export const FILE_TARGET_RULES = [
  "lies outside the workspace",
  "is readable by its owner only",
] as const;
