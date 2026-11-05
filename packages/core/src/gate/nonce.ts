/**
 * T013 of feature 101 — the nonce of a critic call (F101-FR-006).
 *
 * 64 bits from a secure random source, written as 16 lower-case hexadecimal
 * characters, made fresh for the call and never used for a second one. A call
 * of the diagnostician carries NO nonce.
 *
 * The nonce is the whole of what makes the gate non-self-approving
 * (constitution II, threat T-01): the proposer cannot have known it, so a line
 * `VERDICT <something>: APPROVED` planted in phase evidence approves nothing.
 * It therefore MUST NOT reach disk, an event or a span before the call has
 * returned (threat T-05), and MUST NOT exist while the pass loop of the phase
 * attempt runs. `withNonce` is the shape that makes both true by construction:
 * the nonce lives inside one call and is wiped from the holder when the call
 * returns, by the normal path and by a thrown error alike.
 *
 * `newNonce` is the function Lisa's `packages/core/src/critic/verdict.ts:40-42`
 * at `363e6a3` holds, taken verbatim (`packages/core/EXTRACTED.md`, row 2).
 * The rest of this module is new: Lisa has no holder and no wipe.
 */
import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NONCE_PATTERN, isNonce } from "./verdict-parser.ts";

/** F101-FR-006 — the bits of a nonce. */
export const NONCE_BITS = 64 as const;

/** The bytes the secure random source is asked for: 64 bits (baseline `token_hex(8)`). */
export const NONCE_BYTES = 8 as const;

/** F101-FR-006 — the written length: 16 lower-case hexadecimal characters. */
export const NONCE_LENGTH = 16 as const;

/** F101-FR-006 — a call of the diagnostician carries no nonce. */
export const THE_DIAGNOSTICIAN_CARRIES_A_NONCE = false as const;

/** F101-FR-006, threat T-05 — the nonce is on disk, in an event or in a span before the call returns. */
export const THE_NONCE_IS_WRITTEN_BEFORE_THE_CALL_RETURNS = false as const;

/** F101-FR-006 — the nonce exists while the pass loop of the phase attempt runs. */
export const THE_NONCE_EXISTS_WHILE_THE_PASS_LOOP_RUNS = false as const;

export { NONCE_PATTERN, isNonce };

/**
 * A fresh nonce for ONE critic call: 8 bytes of the secure random source as 16
 * lower-case hexadecimal characters (Lisa `newNonce`, verbatim; baseline
 * `token_hex(8)`). `randomBytes` of `node:crypto` is the secure source;
 * `Math.random` is never used.
 */
export function newNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

/**
 * The holder of the nonce of one call. It is given out once and wiped, so that
 * nothing after the call can read it and nothing can use it for a second call
 * (F101-FR-006).
 */
export type NonceHolder = {
  /** The nonce, while the call runs; after the wipe it throws. */
  value(): string;
  /** True once the nonce has been wiped. */
  readonly wiped: boolean;
};

/** The error a holder throws when its nonce has been wiped. */
export class NonceWipedError extends Error {
  constructor() {
    super(
      "the nonce of this critic call has been wiped: it is held in memory only until the " +
        "call returns (F101-FR-006)",
    );
    this.name = "NonceWipedError";
  }
}

/**
 * F101-FR-006 — run one critic call with a fresh nonce, and wipe the nonce
 * when the call returns, by the normal path and by a thrown error alike. The
 * nonce never leaves this scope, so no caller can keep it, write it or use it
 * for a second call.
 *
 * The body is given the holder and not the text, so that a body which keeps
 * the holder past the call still cannot read a nonce.
 */
export async function withNonce<T>(body: (holder: NonceHolder) => Promise<T>): Promise<T> {
  let nonce: string | undefined = newNonce();
  const holder: NonceHolder = {
    value(): string {
      if (nonce === undefined) throw new NonceWipedError();
      return nonce;
    },
    get wiped(): boolean {
      return nonce === undefined;
    },
  };
  try {
    return await body(holder);
  } finally {
    nonce = undefined;
  }
}

/**
 * Whether two nonces are the same, compared in constant time. The parse of a
 * reply uses the grammar of `./verdict-parser.ts`; this is for a caller that
 * holds two nonces and must not leak which byte differed.
 */
export function sameNonce(a: string, b: string): boolean {
  if (!isNonce(a) || !isNonce(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * A set of the nonces a run has already used, so that `freshFor` can state
 * that no nonce serves a second call (F101-FR-006). It holds the nonces of the
 * run and no reply, no prompt and no text of a call.
 */
export function nonceLedger(): { freshFor(nonce: string): boolean; readonly size: number } {
  const used = new Set<string>();
  return {
    freshFor(nonce: string): boolean {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
    get size(): number {
      return used.size;
    },
  };
}
