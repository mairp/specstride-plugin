/**
 * T015 of feature 101 — the boundaries of the feature (F101-FR-040,
 * F100-FR-147).
 *
 * At every boundary at which the engine reads the stop request it also verifies
 * the lease, through `verify` of the lock port (EP-13,
 * `@specstride/contracts/ep/lock`). The two readings belong together: a run
 * that keeps working after its owner is gone writes state a second run also
 * writes, and an approval record written then would be an approval no live
 * owner ever asked for.
 *
 * When the owner of the lease is lost the engine runs NO phase gate and writes
 * NO approval record, and ends as F100-FR-147 states: exit 6, stop reason
 * `stop_flag`, cause `owner-lost`, `causedBy: crash`, `retryable` false. The
 * shape of that outcome is feature 100's (`OWNER_LOST`); this module decides
 * only WHERE it is read and hands the outcome on.
 *
 * A provider that FAILS in `verify` makes the engine treat the owner as lost
 * (`FAILURE_PATHS.verify` of the port): the safe failure of a lock is to stop,
 * never to carry on.
 */
import {
  FAILURE_PATHS,
  type HandDownToken,
  type LockProvider,
} from "@specstride/contracts/ep/lock";
import {
  LEASE_IS_VERIFIED_AT_EVERY_BOUNDARY_THAT_READS_THE_STOP_REQUEST,
  OWNER_LOST,
  type OwnerLostOutcome,
} from "@specstride/contracts/records/run-record";

export { OWNER_LOST, LEASE_IS_VERIFIED_AT_EVERY_BOUNDARY_THAT_READS_THE_STOP_REQUEST };
export type { OwnerLostOutcome };

/**
 * The six boundaries of this feature, in the order F101-FR-040 names them.
 * Every one of them reads the stop request and verifies the lease.
 */
export const BOUNDARIES = [
  "before-a-phase-starts",
  "before-a-phase-attempt-starts",
  "before-the-verification-gate",
  "before-a-critic-class-call",
  "before-the-approval-record-is-written",
  "before-the-steps-after-an-approval",
] as const;

/** One boundary of the feature (F101-FR-040). */
export type Boundary = (typeof BOUNDARIES)[number];

/** Six boundaries, no seventh (F101-FR-040). */
export const BOUNDARY_COUNT: 6 = BOUNDARIES.length;

/** What the engine does when the owner of the lease is lost (F100-FR-147). */
export const WHEN_THE_OWNER_IS_LOST = Object.freeze({
  runsThePhaseGate: false as const,
  writesTheApprovalRecord: false as const,
  exitCode: OWNER_LOST.exitCode,
  stopReason: OWNER_LOST.stopReason,
  cause: OWNER_LOST.cause,
  causedBy: OWNER_LOST.causedBy,
  retryable: OWNER_LOST.retryable,
});

/** A failure of `verify` makes the engine treat the owner as lost (§F.5). */
export const VERIFY_FAILURE_PATH = FAILURE_PATHS.verify;

/** How the engine reads the stop request at a boundary. */
export type StopRequestReader = {
  /** True when a stop was requested; the reason, where one was given. */
  requested(): { readonly stop: boolean; readonly reason?: string | undefined };
};

/** What this module is handed to check one boundary. */
export type BoundaryInputs = {
  /** The lock provider of the run (EP-13). */
  readonly lock: Pick<LockProvider, "verify">;
  /** The token the parent handed down, which `verify` is asked about. */
  readonly token: HandDownToken;
  /** The reader of the stop request. */
  readonly stopRequest: StopRequestReader;
};

/** The engine may go on past the boundary. */
export type BoundaryClear = {
  readonly pass: true;
  readonly boundary: Boundary;
};

/** The engine must stop at the boundary: the owner is lost, or a stop was requested. */
export type BoundaryStop = {
  readonly pass: false;
  readonly boundary: Boundary;
  /** Why the boundary stopped the engine. */
  readonly because: "owner-lost" | "verify-failed" | "stop-requested";
  /** The terminal outcome of F100-FR-147, for `owner-lost` and `verify-failed`. */
  readonly outcome: OwnerLostOutcome | undefined;
  /** The reason the stop request carried, where it carried one. */
  readonly stopReasonGiven?: string | undefined;
};

/** The result of one boundary. */
export type BoundaryResult = BoundaryClear | BoundaryStop;

/** True when the boundary stopped the engine. */
export function stopped(result: BoundaryResult): result is BoundaryStop {
  return result.pass === false;
}

/**
 * F101-FR-040 — check ONE boundary: read the stop request, and verify the
 * lease. The lease is verified FIRST: the owner being gone is the stronger
 * fact, and it decides the exit code and the cause, where a stop request is a
 * clean stop that the caller's own halt table reads.
 *
 * A thrown error out of `verify` is the owner treated as lost, never a boundary
 * that passes.
 */
export async function checkBoundary(
  boundary: Boundary,
  inputs: BoundaryInputs,
): Promise<BoundaryResult> {
  let live: boolean;
  try {
    live = await inputs.lock.verify(inputs.token);
  } catch {
    return {
      pass: false,
      boundary,
      because: "verify-failed",
      outcome: OWNER_LOST,
    };
  }
  if (!live) {
    return { pass: false, boundary, because: "owner-lost", outcome: OWNER_LOST };
  }
  const stop = inputs.stopRequest.requested();
  if (stop.stop) {
    return {
      pass: false,
      boundary,
      because: "stop-requested",
      outcome: undefined,
      stopReasonGiven: stop.reason,
    };
  }
  return { pass: true, boundary };
}

/**
 * The boundaries of one phase attempt, checked in the order F101-FR-040 gives
 * them. It returns at the FIRST boundary that stops the engine, so that no
 * later boundary — and no phase gate — runs after the owner was found lost.
 */
export async function checkBoundaries(
  boundaries: readonly Boundary[],
  inputs: BoundaryInputs,
): Promise<BoundaryResult> {
  let last: BoundaryResult = { pass: true, boundary: boundaries[0] ?? BOUNDARIES[0] };
  for (const boundary of boundaries) {
    last = await checkBoundary(boundary, inputs);
    if (stopped(last)) return last;
  }
  return last;
}
