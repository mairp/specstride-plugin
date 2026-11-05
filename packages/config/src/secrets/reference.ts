/**
 * T031 — the grammar of a secret reference, the four operations and the three
 * errors every resolver of EP-10 shares (F110-FR-027, F110-FR-028; §K.7; annex
 * C §C.11).
 *
 * §K.7 gives three schemes and their reference forms:
 *
 * - `env:NAME`                  a variable of the environment of the process
 * - `file:/absolute/path`       a file that holds the value (a leading `~/` is
 *                               expanded first)
 * - `keychain:SERVICE/ACCOUNT`  an entry of the keychain of the platform
 *
 * The registry is open (F110-FR-035), so this module fixes the SHAPE of a
 * reference (`<scheme>:<target>`) and leaves the set of schemes to the
 * registry. Every name of the interface comes from
 * `@specstride/contracts/ep/secret-resolver`, which feature 100 owns: the four
 * operations, the three errors and the three results of `exists` are read from
 * there and never spelled a second time.
 *
 * Nothing in this module ever carries a secret VALUE. `SecretError` holds the
 * reference, the key and the scheme, and the value is never one of its fields
 * (F110-FR-027, last sentence).
 */
import {
  ERRORS,
  EXISTENCE,
  OPERATIONS,
  WAVE_1_SCHEMES,
  A_RESOLVER_MAKES_A_NETWORK_CALL,
  STATE_WHEN_MISSING_IN_A_RUN,
  schemeOf,
  unknownValueOutcome,
} from "@specstride/contracts/ep/secret-resolver";
import type {
  Existence,
  ResolvedSecret,
  SecretReference,
  SecretResolver,
  SecretResolverError,
  SecretResolverOperation,
} from "@specstride/contracts/ep/secret-resolver";
import type { Redactor } from "@specstride/contracts/ep/redactor";

export {
  WAVE_1_SCHEMES,
  A_RESOLVER_MAKES_A_NETWORK_CALL,
  STATE_WHEN_MISSING_IN_A_RUN,
  schemeOf,
  unknownValueOutcome,
};
export type {
  Existence,
  ResolvedSecret,
  SecretReference,
  SecretResolver,
  SecretResolverError,
  SecretResolverOperation,
};

/**
 * F110-FR-028, first sentence — the four operations of a resolver, in the
 * order of the requirement. Read from the contract of feature 100.
 */
export const RESOLVER_OPERATIONS: readonly SecretResolverOperation[] = OPERATIONS;

/** F110-FR-028, first sentence — the three errors, from the same contract. */
export const RESOLVER_ERRORS: readonly SecretResolverError[] = ERRORS;

/** F110-FR-028, second sentence — the three results of `exists` (§K.7). */
export const EXISTENCE_RESULTS: readonly Existence[] = EXISTENCE;

/** The schemes Wave 1 ships (§K.7). The registry itself is open (F110-FR-035). */
export const SECRET_SCHEMES: readonly string[] = WAVE_1_SCHEMES;

/**
 * The shape of a reference: a scheme of lower-case letters, digits and hyphens,
 * then a colon, then the target. The same expression as `SECRET_REFERENCE` of
 * `src/load/files.ts`, which the loader uses to tell a reference from an inline
 * value; `tests/unit/resolvers.test.ts` asserts that the two agree, so the
 * product has one grammar and not two.
 */
export const SCHEME_FORM = /^[a-z][a-z0-9-]*:/;

/** A parsed reference: the scheme WITH its colon, and the target after it. */
export interface ParsedSecretReference {
  /** `env:`, `file:`, `keychain:`, … — the colon is part of the scheme. */
  readonly scheme: string;
  /** Everything after the colon, verbatim. */
  readonly target: string;
}

/**
 * Parse a reference, or `undefined` where the text carries no scheme and is
 * therefore not a reference at all (F110-FR-027: such a value is the secret
 * itself and is `inline-secret`).
 */
export function parseSecretReference(text: string): ParsedSecretReference | undefined {
  if (!SCHEME_FORM.test(text)) return undefined;
  const scheme = schemeOf(text);
  if (scheme === undefined) return undefined;
  return Object.freeze({ scheme, target: text.slice(scheme.length) });
}

/** True where the text has the shape of a reference of §K.7. */
export function isSecretReferenceText(text: unknown): boolean {
  return typeof text === "string" && parseSecretReference(text) !== undefined;
}

/**
 * The part of the redactor a resolver needs: `register` only (annex X §X.4).
 * Every resolver takes one, because F110-FR-032 requires every resolved value
 * to be registered for exact-match removal at the moment it is resolved — not
 * later and not by its caller.
 */
export type SecretRegistrar = Pick<Redactor, "register">;

/**
 * A resolver of this package: the four operations of the contract, plus the
 * scheme it handles and an id the conformance report names.
 */
export interface ConfigSecretResolver extends SecretResolver {
  /** The id of the implementation, as the conformance report prints it. */
  readonly id: string;
  /** The one scheme the resolver handles, with its colon. */
  readonly scheme: string;
  /** False for every resolver of this package (F110-FR-028, fourth sentence). */
  readonly makesANetworkCall: false;
}

/**
 * What a resolver is told about where its references were declared, so that
 * `boundHost` can answer (F110-FR-033). `src/secrets/binding.ts` builds it.
 */
export interface BoundHostLookup {
  /** The host the secret of this reference may be sent to, or `null`. */
  hostOf(reference: SecretReference): string | null;
}

/**
 * One of the three errors of F110-FR-028. The error names the key and the
 * reference and NEVER the value: there is no field that could hold one, which
 * is how F110-FR-027's last sentence is kept by construction rather than by
 * care.
 */
export class SecretError extends Error {
  /** `missing`, `inline-secret` or `unsafe-file`. */
  readonly reason: SecretResolverError;
  /** The reference as it was written, or `(no reference)` for an inline value. */
  readonly reference: string;
  /** The configuration key the reference was declared under, where it is known. */
  readonly key: string | undefined;
  /** The scheme of the reference, where it has one. */
  readonly scheme: string | undefined;
  /**
   * True where the error is a configuration error that refuses the launch:
   * every `inline-secret`, and the `missing` of a scheme no resolver handles
   * (F110-FR-027, F110-FR-035).
   */
  readonly isConfigurationError: boolean;
  /** No field of this error ever holds a secret value (F110-FR-027). */
  readonly valueIsNeverCarried = true as const;

  constructor(fields: {
    reason: SecretResolverError;
    reference: string;
    key?: string | undefined;
    scheme?: string | undefined;
    isConfigurationError?: boolean | undefined;
    detail: string;
  }) {
    const where = fields.key === undefined ? "" : ` of the key \`${fields.key}\``;
    super(
      `${fields.reason}: the secret reference \`${fields.reference}\`${where} ` +
        `${fields.detail}. The value is not printed`,
    );
    this.name = "SecretError";
    this.reason = fields.reason;
    this.reference = fields.reference;
    this.key = fields.key;
    this.scheme = fields.scheme;
    this.isConfigurationError =
      fields.isConfigurationError ?? (fields.reason === "inline-secret" ? true : false);
  }
}

/** `missing`: the reference names nothing (F110-FR-028, last sentence). */
export function missingError(
  reference: string,
  detail: string,
  key?: string | undefined,
): SecretError {
  return new SecretError({
    reason: "missing",
    reference,
    ...(key === undefined ? {} : { key }),
    ...(parseSecretReference(reference) === undefined
      ? {}
      : { scheme: parseSecretReference(reference)?.scheme }),
    detail,
  });
}

/** `inline-secret`: a configuration error (F110-FR-027). */
export function inlineSecretError(
  reference: string,
  detail: string,
  key?: string | undefined,
): SecretError {
  return new SecretError({
    reason: "inline-secret",
    reference,
    ...(key === undefined ? {} : { key }),
    isConfigurationError: true,
    detail,
  });
}

/** `unsafe-file`: a `file:` target inside the workspace or readable by others. */
export function unsafeFileError(
  reference: string,
  detail: string,
  key?: string | undefined,
): SecretError {
  return new SecretError({
    reason: "unsafe-file",
    reference,
    ...(key === undefined ? {} : { key }),
    scheme: "file:",
    detail,
  });
}
