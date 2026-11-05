/**
 * T043 — `handDown` and `verify` (F122-FR-018; annex F §F.5; annex E §E.2,
 * F100-FR-147).
 *
 * The runtime root holds the lock. The engine does not, and must not: *an
 * engine in start mode `child` MUST never take a lock*. What it gets instead
 * is a TOKEN, handed down, which it presents at every boundary at which it
 * reads the stop request. The lease holds only the HASH of that token, so the
 * record on disk never carries the secret (F100-FR-052, annex B §B.8).
 *
 * `verify` answers one question: *does the process that handed the token down
 * still hold the lease?* Three things make the answer "no", and the third is
 * the one the task names:
 *
 *   1. the token does not hash to what the lease records;
 *   2. the lease is gone, or its owner is no longer the owner of the lock —
 *      the lock was reclaimed by another launch;
 *   3. **the provider failed.** §F.5 "Failure of an implementation" says a
 *      provider that fails in `verify` makes the engine treat the owner as
 *      lost, and F122-FR-018 says `verify` MUST answer "no" when the provider
 *      fails. So every path out of this module that cannot read an answer
 *      returns `false`, and a provider that THROWS is such a path: the throw
 *      is caught here and turned into "no". An exception that reached the
 *      engine would be an unhandled error at a boundary, not a lost owner, and
 *      the engine would not write the terminal record of F100-FR-147.
 */
import { FAILURE_PATHS, type HandDownToken } from "@specstride/contracts/ep/lock";
import type { Lease } from "@specstride/contracts/records/lease";
import { START_MODES, type StartMode } from "../root/start.ts";
import { hashToken, mintLeaseToken, type MintedToken } from "../procs/run-token.ts";

/** The requirement this module carries. */
export const HAND_DOWN_REQUIREMENT = "F122-FR-018" as const;

/** §F.5 — what a provider that fails in `verify` means for the engine. */
export const VERIFY_FAILURE_PATH = FAILURE_PATHS.verify;

/** F122-FR-018 — the answer when the provider fails. */
export const VERIFY_ANSWERS_WHEN_THE_PROVIDER_FAILS = false as const;

/** F122-FR-018 — an engine in start mode `child` never takes a lock. */
export const START_MODE_THAT_TAKES_A_LOCK: StartMode = "standalone";
export function engineTakesALock(startMode: StartMode): boolean {
  return startMode === START_MODE_THAT_TAKES_A_LOCK;
}
export { START_MODES };
export type { StartMode, HandDownToken };

/**
 * F100-FR-147 — what the engine does when `verify` says "no". It is stated
 * here as data so that the engine and this module cannot drift apart about it.
 */
export const WHEN_THE_OWNER_IS_LOST = Object.freeze({
  finishesTheCurrentPass: true as const,
  runsAPhaseGate: false as const,
  terminalRecordCause: "owner-lost" as const,
  stopReason: "stop_flag" as const,
  causedBy: "crash" as const,
  exit: 6 as const,
});

/** The field of §B.8 that holds the hash of the token handed down. */
export const LEASE_TOKEN_HASH_FIELD = "leaseTokenHash" as const;

/** The two operations of EP-13 this module is about, and nothing else. */
export type LeaseProvider = {
  handDown(lease: Lease): HandDownToken;
  verify(token: HandDownToken): Promise<boolean>;
};

/** The lease token of a hand-down, as the caller holds it. */
export type HandedDown = {
  /** The secret, to be placed in the environment of the child and nowhere else. */
  readonly token: HandDownToken;
  /** The hash, which is what the lease records. */
  readonly hash: string;
};

/**
 * F122-FR-018 — hand the lease down to the engine as a token. The provider
 * mints it and records its hash in the lease; this function is the one the
 * root calls, and it checks the thing a caller cannot see for itself: that
 * what came back is a secret and not the hash.
 */
export function handDown(provider: LeaseProvider, lease: Lease): HandedDown {
  const token = provider.handDown(lease);
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(
      `\`handDown\` of the lock provider returned no token (F122-FR-018, annex F §F.5)`,
    );
  }
  const recorded = (lease as unknown as Record<string, unknown> | null | undefined)?.[
    LEASE_TOKEN_HASH_FIELD
  ];
  if (typeof recorded === "string" && token === recorded) {
    // The provider handed back what the LEASE RECORDS, which is the hash. A
    // child given that could never prove anything: the hash is public — it lies
    // in a record every reader of the run may read — and the whole point of the
    // hand-down is that only the child holds the value that hashes to it.
    throw new Error(
      `\`handDown\` returned the HASH of the lease token and not the token; the lease holds ` +
        `only the hash and the child needs the secret (F122-FR-018, annex B §B.8)`,
    );
  }
  return Object.freeze({ token, hash: hashToken(token) });
}

/**
 * F122-FR-018 — whether the process that handed the token down still holds the
 * lease. "No" wherever the answer cannot be read, and that includes a provider
 * that threw: see the header.
 */
export async function verify(
  provider: LeaseProvider,
  token: HandDownToken | null | undefined,
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0) return false;
  try {
    const answer = await provider.verify(token);
    // A provider that answered something other than a truth value has failed
    // to answer, which is "no" and not "probably yes".
    return answer === true;
  } catch {
    return VERIFY_ANSWERS_WHEN_THE_PROVIDER_FAILS;
  }
}

/**
 * The richer answer, for a caller that must report WHY the owner reads as
 * lost — the doctor, and the engine's terminal record.
 */
export type VerifyOutcome = {
  readonly holdsTheLease: boolean;
  readonly reason:
    | "the token matches the lease and the owner still holds the lock"
    | "no token was presented"
    | "the token does not match the lease"
    | "the provider failed";
  /** Set where the provider threw; the message, for a doctor finding. */
  readonly providerFailure?: string;
};

/** `verify` with its reason, over the same three paths. */
export async function verifyWithReason(
  provider: LeaseProvider,
  token: HandDownToken | null | undefined,
): Promise<VerifyOutcome> {
  if (typeof token !== "string" || token.length === 0) {
    return Object.freeze({ holdsTheLease: false, reason: "no token was presented" as const });
  }
  try {
    const answer = await provider.verify(token);
    return Object.freeze(
      answer === true
        ? {
            holdsTheLease: true,
            reason: "the token matches the lease and the owner still holds the lock" as const,
          }
        : { holdsTheLease: false, reason: "the token does not match the lease" as const },
    );
  } catch (error) {
    return Object.freeze({
      holdsTheLease: false,
      reason: "the provider failed" as const,
      providerFailure: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The lease token of a child, as it is read out of that child's environment.
 * The engine calls `verify` with this and never with anything it composed.
 */
export function mintTheLeaseToken(): MintedToken {
  return mintLeaseToken();
}
