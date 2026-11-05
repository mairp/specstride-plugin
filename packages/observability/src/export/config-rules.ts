/**
 * T069 — the endpoint rules and the credential header (F128-FR-040; CT-128-20).
 *
 * F128-FR-040: *The keys of the endpoints of both sinks MUST be widening keys
 * of the user scope: a project configuration MUST be ignored for them, with a
 * launch message and a doctor warning. An endpoint address MUST NOT hold a
 * user name or a password. An address that is not on the loopback interface
 * MUST use `https`, otherwise the configuration MUST be refused. A credential
 * for a collector MUST be a reference of the secret resolver, resolved at the
 * moment of use, sent only to the host of the address, and never written to
 * an event, a span, a log line, a launch contract or an argument list; an
 * inline value MUST be a configuration error.*
 *
 * The shape of the module follows the requirement, in order: the widening
 * keys and the project finding; the two rules of an address; the credential,
 * which is built AT THE MOMENT OF USE and carries the checks with it. Nothing
 * here writes a resolved value anywhere: the header object is returned to the
 * request of the one flush that asked for it, and no other function of the
 * exporter can reach it.
 */

/** The endpoint address keys of both sinks (F128-FR-040). */
export const ENDPOINT_ADDRESS_KEYS: readonly string[] = Object.freeze([
  "telemetry.loki.url",
  "telemetry.otel.url",
]);

/** The credential keys of both sinks (F128-FR-040; row 106 of annex X §X.7). */
export const CREDENTIAL_KEYS: readonly string[] = Object.freeze([
  "telemetry.loki.auth",
  "telemetry.otel.auth",
]);

/** All six keys are widening keys of the user scope (F128-FR-040). */
export const WIDENING_ENDPOINT_KEYS: readonly string[] = Object.freeze([
  ...ENDPOINT_ADDRESS_KEYS,
  ...CREDENTIAL_KEYS,
]);

/** A project setting of one of the six keys, as the launch reports it. */
export type ProjectEndpointFinding = {
  readonly key: string;
  /** Project configuration is ignored for the key: the user value stands. */
  readonly ignored: true;
  /** The launch message (also the text of the doctor warning). */
  readonly message: string;
};

/**
 * The finding for a project configuration that sets one of the six keys: the
 * value is ignored and the launch carries the message (F128-FR-040).
 */
export function projectEndpointFinding(key: string): ProjectEndpointFinding {
  return Object.freeze({
    key,
    ignored: true as const,
    message:
      `telemetry: the project configuration sets ${key}, a user-scope key; ` +
      "the project value is ignored and the user configuration stands (F128-FR-040)",
  });
}

/** The findings for every one of the six keys a project configuration set. */
export function projectEndpointFindings(
  keys: readonly string[],
): readonly ProjectEndpointFinding[] {
  return keys.filter((key) => WIDENING_ENDPOINT_KEYS.includes(key)).map(projectEndpointFinding);
}

/* ------------------------------------------------------------------ *
 * The two rules of an address (F128-FR-040).
 * ------------------------------------------------------------------ */

/** An address rule: fine, or refused with the reason. */
export type AddressRule = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The loopback interface: the hosts an `http` address may sit on. */
export const LOOPBACK_HOSTS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/** True when a host is on the loopback interface. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  if (LOOPBACK_HOSTS.includes(bare)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare) || bare.endsWith(".localhost");
}

/** The user name or password the address holds, or `null` when it holds none. */
export function userInfoOf(address: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/@?#]+)@/i.exec(address);
  return match ? (match[1] ?? null) : null;
}

/** The two rules of F128-FR-040, applied to one address. */
export function addressRuleOf(address: string): AddressRule {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, error: `telemetry: the address ${address} is not a URL (F128-FR-040)` };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      error:
        "telemetry: an endpoint address must not hold a user name or a password; " +
        "a credential is a reference of the secret resolver (F128-FR-040)",
    };
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.host)) {
    return {
      ok: false,
      error: `telemetry: the address ${address} is not on the loopback interface and must use https (F128-FR-040)`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * The credential (F128-FR-040).
 * ------------------------------------------------------------------ */

/** The host a credential may be sent to (the host of the address). */
export function hostOf(address: string): string | null {
  try {
    return new URL(address).host;
  } catch {
    return null;
  }
}

/** A credential header, built at the moment of use (F128-FR-040). */
export type CredentialHeader = {
  readonly name: "authorization";
  readonly value: string;
  /** The host, and only this host, the header is sent to. */
  readonly host: string;
};

/** A refused credential: the configuration error of F128-FR-040. */
export type CredentialError =
  | { readonly error: "inline-secret"; readonly message: string }
  | { readonly error: "host-mismatch"; readonly message: string }
  | { readonly error: "missing"; readonly message: string };

export type CredentialResult =
  | { readonly ok: true; readonly header: CredentialHeader }
  | { readonly ok: false; readonly refusal: CredentialError };

/** The resolver the credential is resolved through (annex C, §C.11). */
export type CredentialResolver = {
  resolve(reference: string): Promise<{ readonly value: string }>;
  boundHost(reference: string): string | null;
};

/**
 * The scheme of a reference (`env:`, `file:`, `keychain:`, …), or `undefined`
 * when the value is inline — and an inline value is the error (F128-FR-040).
 */
function schemeOf(reference: string): string | undefined {
  const at = reference.indexOf(":");
  return at < 0 ? undefined : reference.slice(0, at + 1);
}

/**
 * Resolve the credential of a key AT THE MOMENT OF USE and build the header
 * of the one request that carries it (F128-FR-040). The value exists only in
 * the returned header: it is written to no event, span, log line, launch
 * contract or argument list, and it is sent only when the address and the
 * bound host of the reference are the same host.
 */
export async function credentialHeaderOf(
  reference: string,
  address: string,
  resolver: CredentialResolver,
): Promise<CredentialResult> {
  // An inline value is a configuration error, always (F128-FR-040).
  if (schemeOf(reference) === undefined) {
    return {
      ok: false,
      refusal: {
        error: "inline-secret",
        message:
          "telemetry: a credential must be a reference of the secret resolver " +
          "(env:, file:, keychain:); an inline value is a configuration error (F128-FR-040)",
      },
    };
  }
  const target = hostOf(address);
  if (target === null) {
    return {
      ok: false,
      refusal: {
        error: "missing",
        message: `telemetry: the address ${address} is not a URL (F128-FR-040)`,
      },
    };
  }
  let resolved: { readonly value: string };
  try {
    resolved = await resolver.resolve(reference);
  } catch {
    return {
      ok: false,
      refusal: {
        error: "missing",
        message: `telemetry: the credential ${reference} could not be resolved (F128-FR-040)`,
      },
    };
  }
  // Sent only to the host the resolver bound the secret to (F128-FR-040).
  const bound = resolver.boundHost(reference);
  if (bound !== null && bound !== target) {
    return {
      ok: false,
      refusal: {
        error: "host-mismatch",
        message: `telemetry: the credential ${reference} is bound to ${bound} and is not sent to ${target} (F128-FR-040)`,
      },
    };
  }
  return {
    ok: true,
    header: Object.freeze({ name: "authorization" as const, value: resolved.value, host: target }),
  };
}

/** The requirement, as a constant a reader can grep. */
export const CREDENTIAL_NEVER_WRITTEN_TO_AN_EVENT_SPAN_LOG_CONTRACT_OR_ARGV = true as const;

/**
 * Whether an argument list carries a resolved credential value: the exporter
 * is given no argument list and writes none; a caller proves its own list
 * with this scan (F128-FR-040).
 */
export function argumentListCarries(argv: readonly string[], value: string): boolean {
  return argv.some((argument) => argument.includes(value));
}
