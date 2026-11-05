/**
 * T141 — the interface types of EP-13, the lock and liveness provider, from
 * `contracts/extension-points/EP-13.lock.json` and annex F, §F.5
 * (F100-FR-164).
 *
 * `specstride.lock/1`. One run at a time works in a workspace, and a live
 * owner is told from a dead one.
 */
import type { OwnerRecord } from "../records/owner-record.ts";
import type { Lease } from "../records/lease.ts";

export const POINT_ID = "specstride.lock/1" as const;
export const EP = "EP-13" as const;
export const ANNEX_SECTION = "annex F, §F.5" as const;

/** F100-FR-164 — the seven operations of the provider. */
export const OPERATIONS = [
  "acquire",
  "heartbeat",
  "release",
  "probe",
  "reclaim",
  "handDown",
  "verify",
] as const;
export type LockOperation = (typeof OPERATIONS)[number];

/** The closed set `probe` returns (§F.5, Outputs). */
export const PROBE_RESULTS = [
  "free",
  "held-live",
  "held-foreign",
  "stale-owner-dead",
  "owner-dead-group-alive",
  "unknown",
] as const;
export type ProbeResult = (typeof PROBE_RESULTS)[number];

/** Unknown-value rule of §F.5: an unknown result of `probe` is read as `unknown`. */
export const PROBE_RESULT_WHEN_UNKNOWN: ProbeResult = "unknown";

/** The errors of §F.5, with the codes they lead to. */
export const ERRORS = ["conflict", "foreign-owner", "unknown"] as const;
export type LockError = (typeof ERRORS)[number];
export const CONFLICT_ENGINE_CODE = 5 as const;
export const CONFLICT_PIPELINE_CODE = 24 as const;
/** `unknown` counts as held (§F.5, Errors). */
export const UNKNOWN_COUNTS_AS_HELD = true as const;

/** The scope of a lock is the workspace (§F.5). */
export type LockScope = { readonly workspaceId: string; readonly path: string };

/** The result of `acquire`: a lease, or a conflict that names the holder. */
export type AcquireResult =
  | { readonly acquired: true; readonly lease: Lease }
  | { readonly acquired: false; readonly conflict: "conflict"; readonly holder: OwnerRecord };

/** The result of `reclaim`: a lease, or `lost-race`. */
export type ReclaimResult =
  | { readonly reclaimed: true; readonly lease: Lease }
  | { readonly reclaimed: false; readonly reason: "lost-race" | "foreign-owner" };

/** A token for a child, as `handDown` returns it. */
export type HandDownToken = string;

/** F100-FR-164 — the lock and liveness provider. */
export type LockProvider = {
  readonly id: string;
  acquire(scope: LockScope, owner: OwnerRecord): Promise<AcquireResult>;
  heartbeat(lease: Lease): Promise<void>;
  release(lease: Lease): Promise<void>;
  probe(scope: LockScope): Promise<ProbeResult>;
  reclaim(scope: LockScope): Promise<ReclaimResult>;
  handDown(lease: Lease): HandDownToken;
  /** Whether the parent still holds the lease. */
  verify(token: HandDownToken): Promise<boolean>;
};

/** "Guarantees of the core" of §F.5, as data. */
export const CORE_GUARANTEES = [
  "one run per workspace",
  "the scope is the workspace",
  "a lease is handed down, so a child never takes a second lock",
  "`owner-dead-group-alive` refuses a start and names the survivors",
  "`adoptable` processes never cause `owner-dead-group-alive`",
  "a signal is sent only when pid, start time and run token all match",
  "the provider in use is recorded in the workspace record; a different provider refuses",
] as const;

/** F100-FR-164 — a foreign owner is never reclaimed automatically. */
export const A_FOREIGN_OWNER_IS_RECLAIMED_AUTOMATICALLY = false as const;

/** F100-FR-164 — the as-is lock fallback that was never released is not carried. */
export const THE_AS_IS_LOCK_FALLBACK_IS_CARRIED = false as const;

/** "Guarantees of an implementation" of §F.5, as data. */
export const IMPLEMENTATION_GUARANTEES = [
  "exclusion is atomic",
  "a lock never exists without its owner record",
  "reclaim is atomic and never a removal followed by a creation",
  "liveness rests on something the kernel releases when the owner dies",
  "behaviour is the same on Linux and macOS",
  "no component is compiled at install",
] as const;

/**
 * "Failure of an implementation" of §F.5 — the plainer path: a provider that
 * fails in `acquire` or `probe` gives `unknown`, which counts as held, and
 * the launch is refused with exit 5 or 24; a provider that fails in `verify`
 * makes the engine treat the owner as lost.
 */
export const FAILURE_PATHS: Readonly<Record<LockOperation, string>> = Object.freeze({
  acquire: "`unknown`, which counts as held: the launch is refused with exit 5 or 24",
  heartbeat: "`unknown`, which counts as held",
  release: "`unknown`, which counts as held",
  probe: "`unknown`, which counts as held: the launch is refused with exit 5 or 24",
  reclaim: "`unknown`, which counts as held",
  handDown: "`unknown`, which counts as held",
  verify: "the engine treats the owner as lost",
});

/**
 * Unknown-value rule of §F.5: an owner record with an unknown field is
 * accepted; one that lacks a required field is `unknown`.
 */
export const OWNER_RECORD_REQUIRED_FIELD_MISSING: ProbeResult = "unknown";
export const OWNER_RECORD_UNKNOWN_FIELD_IS_ACCEPTED = true as const;
