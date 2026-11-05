/**
 * T013 — the run token and the lease token: mint, hash, place in an
 * environment (F122-FR-024, F122-FR-018; research D-9).
 *
 * Two secrets of one launch, with the same shape and different jobs:
 *
 *   - the **run token** marks every process of a launch. *Every process that
 *     the runtime root or the engine starts MUST carry the run token in its
 *     environment. The run token MUST be minted at every launch from a secure
 *     random source, MUST be stored nowhere except in the environment of the
 *     processes of that launch, and MUST appear in records only as its hash*
 *     (F122-FR-024). It is what makes the identity check of F122-FR-025
 *     possible and what the search for survivors looks for (F122-FR-027).
 *   - the **lease token** is handed to the engine by `handDown` and presented
 *     to `verify`, so that a child never takes a second lock (F122-FR-018,
 *     EP-13 `handDown`/`verify`).
 *
 * **The rule this module exists to make hard to break**: the token itself
 * never reaches disk, and a record carries only its hash. So the type that
 * holds a token is not a `string`. `MintedToken` keeps the secret behind a
 * method, prints as its hash under `toString`, under `toJSON` and under the
 * inspector of the platform, and so cannot be written into a record by
 * accident — a caller that tries gets the hash, which is what belongs there.
 * Reading the secret out is one named call, `secret()`, which is easy to find
 * in a review.
 *
 * The hash is hexadecimal, and the algorithm is `HASH_ALGORITHM` of the kernel
 * — SHA-256 — so that this module holds no second opinion about what a hash
 * is. It is named and not spelled out, so a change of the kernel's algorithm
 * reaches the token hashes too.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HASH_ALGORITHM } from "@specstride/kernel";

/** The requirements this module carries, and the decision it carries out. */
export const RUN_TOKEN_REQUIREMENTS = ["F122-FR-024", "F122-FR-018"] as const;
export const RUN_TOKEN_DECISION = "D-9" as const;

/**
 * F122-FR-024, `data-model.md` — the run token is 32 random bytes. The lease
 * token is "random bytes"; it is minted at the same width, because a token
 * that guards a lock is not worth less than one that marks a process.
 */
export const RUN_TOKEN_BYTES = 32 as const;
export const LEASE_TOKEN_BYTES = 32 as const;

/** The variable the run token is carried in (F122-FR-024). */
export const RUN_TOKEN_VAR = "SPECSTRIDE_RUN_TOKEN" as const;

/** The variable the lease token is handed down in (F122-FR-018). */
export const LEASE_TOKEN_VAR = "SPECSTRIDE_LEASE_TOKEN" as const;

/** F122-FR-024 — the token is stored nowhere but the environment of a process. */
export const TOKEN_IS_EVER_WRITTEN_TO_DISK = false as const;

/** F122-FR-024 — in a record the token appears only as its hash. */
export const TOKEN_IN_A_RECORD_IS = "its hash" as const;

/**
 * The hash the fields `runTokenHash` and `leaseTokenHash` carry: the one the
 * kernel names, so the two cannot drift apart.
 */
export const TOKEN_HASH_ALGORITHM: string = HASH_ALGORITHM;

/**
 * A minted token. The secret is held in a closure; everything that could leak
 * it by accident — string conversion, JSON, the inspector of the platform —
 * yields the HASH instead. `secret()` is the one way out, and it is named so
 * that a review can grep for it.
 */
export type MintedToken = {
  /** The hash that goes into a record (F122-FR-024). */
  readonly hash: string;
  /** How many bytes of randomness the token holds. */
  readonly bytes: number;
  /** The secret itself. The only way to read it; never put it in a record. */
  secret(): string;
  /** The hash, so that an accidental interpolation leaks nothing. */
  toString(): string;
  /** The hash, so that an accidental `JSON.stringify` leaks nothing. */
  toJSON(): string;
};

/** The tag the inspector of the platform prints a token under. */
export const TOKEN_INSPECT_TAG = "[specstride token: hash " as const;

/** Make a `MintedToken` over bytes that are already chosen. */
function tokenOver(raw: Buffer): MintedToken {
  const secret = raw.toString("hex");
  const hash = hashToken(secret);
  const token: MintedToken = {
    hash,
    bytes: raw.length,
    secret: () => secret,
    toString: () => hash,
    toJSON: () => hash,
  };
  // `util.inspect` is what `console.log` prints with, and it would otherwise
  // walk the object and show nothing of the secret anyway — the secret lives
  // in a closure — but the tag makes the intent plain in a log.
  Object.defineProperty(token, Symbol.for("nodejs.util.inspect.custom"), {
    value: () => `${TOKEN_INSPECT_TAG}${hash}]`,
    enumerable: false,
  });
  return Object.freeze(token);
}

/* ------------------------------------------------------------------ *
 * Mint.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-024 — mint a run token at a launch, from a secure random source.
 * `randomBytes` of the platform is that source; a token is never derived from
 * a time, a process id or a counter, because all three are guessable by the
 * process we are trying to tell apart from a stranger.
 */
export function mintRunToken(): MintedToken {
  return tokenOver(randomBytes(RUN_TOKEN_BYTES));
}

/** F122-FR-018 — mint a lease token, from the same source. */
export function mintLeaseToken(): MintedToken {
  return tokenOver(randomBytes(LEASE_TOKEN_BYTES));
}

/**
 * Rebuild a token value from a secret a process read out of its own
 * environment. It mints nothing: it is how a child that inherited a token
 * gets the same hash its parent recorded.
 */
export function tokenFromSecret(secret: string): MintedToken {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("a token cannot be rebuilt from an empty secret");
  }
  const hash = hashToken(secret);
  const token: MintedToken = {
    hash,
    bytes: Math.floor(secret.length / 2),
    secret: () => secret,
    toString: () => hash,
    toJSON: () => hash,
  };
  Object.defineProperty(token, Symbol.for("nodejs.util.inspect.custom"), {
    value: () => `${TOKEN_INSPECT_TAG}${hash}]`,
    enumerable: false,
  });
  return Object.freeze(token);
}

/* ------------------------------------------------------------------ *
 * Hash.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-024 — the hash a record carries, in hexadecimal, under the
 * algorithm the kernel names, so that `runTokenHash` and `leaseTokenHash` mean
 * the same thing wherever they are compared.
 */
export function hashToken(secret: string): string {
  return createHash(TOKEN_HASH_ALGORITHM).update(secret, "utf8").digest("hex");
}

/**
 * Whether a secret is the one a recorded hash was made from.
 *
 * The comparison of the two hashes is time-safe. The hashes are not secret, so
 * this is not strictly needed; it costs nothing and it means that no caller
 * has to think about whether the thing it is comparing is the hash or the
 * token.
 */
export function tokenMatchesHash(secret: string, hash: string): boolean {
  if (typeof secret !== "string" || typeof hash !== "string") return false;
  const made = Buffer.from(hashToken(secret), "utf8");
  const given = Buffer.from(hash, "utf8");
  if (made.length !== given.length) return false;
  return timingSafeEqual(made, given);
}

/* ------------------------------------------------------------------ *
 * Place in an environment.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-024 — place the run token in the environment a process will be
 * started with, and the lease token where one is handed down.
 *
 * The environment is returned and never mutated in place: `process.env` of the
 * starter is not where a child's token belongs, and a function that edited its
 * argument would eventually be called with it.
 */
export function withRunToken(
  environment: Readonly<Record<string, string | undefined>>,
  runToken: MintedToken,
  leaseToken?: MintedToken,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) out[name] = value;
  }
  out[RUN_TOKEN_VAR] = runToken.secret();
  if (leaseToken !== undefined) out[LEASE_TOKEN_VAR] = leaseToken.secret();
  return Object.freeze(out);
}

/**
 * The run token a process carries, read from an environment, or `null` where
 * it carries none. The environment may be this process's own or one read from
 * the process table of another process of the same user (D-8).
 */
export function runTokenOf(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = environment[RUN_TOKEN_VAR];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The lease token an environment carries, or `null`. */
export function leaseTokenOf(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = environment[LEASE_TOKEN_VAR];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The run token of THIS process, where it was started by a launch; `null` in a
 * process that was not. A process reads its own token to prove that it belongs
 * to the launch that claims it.
 */
export function runTokenOfThisProcess(): string | null {
  return runTokenOf(process.env);
}

/**
 * An environment with both tokens taken out. It is what goes to a process that
 * must NOT be able to pass the identity check of the launch — and it is what a
 * record of an environment is filtered through before it is reported, so that
 * neither token reaches a log.
 */
export function withoutTokens(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (name === RUN_TOKEN_VAR || name === LEASE_TOKEN_VAR) continue;
    if (value !== undefined) out[name] = value;
  }
  return Object.freeze(out);
}

/** The two variables a token is carried in; nothing else carries one. */
export const TOKEN_VARS = Object.freeze([RUN_TOKEN_VAR, LEASE_TOKEN_VAR]);
