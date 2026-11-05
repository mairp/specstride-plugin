/**
 * T021 — the derived conditions of the view: the liveness table, `dead`,
 * `stale` and `launch-abandoned` (F129-FR-012, F129-FR-013, F129-FR-014).
 *
 * A reader DERIVES these and writes them nowhere (F129-FR-015).
 */
import { LIVE_STATES, RESTING_STATES } from "@specstride/contracts/state/run-state";
import type { Liveness, MajorRange, StaleCondition, ViewState } from "../model/view.ts";
import type { LeaseObservation } from "../model/inputs.ts";

/** The liveness table of F129-FR-012, as data: the result of `probe` to the liveness. */
export const LIVENESS_TABLE: Readonly<Record<string, { liveness: Liveness; dead: boolean }>> =
  Object.freeze({
    "held-live": { liveness: "alive", dead: false },
    free: { liveness: "dead", dead: true },
    "stale-owner-dead": { liveness: "dead", dead: true },
    "owner-dead-group-alive": { liveness: "dead", dead: true },
    "held-foreign": { liveness: "foreign", dead: false },
    unknown: { liveness: "unknown", dead: false },
  });

/** A state in which the run has a lease (annex E §E.2). */
export function isLiveState(state: ViewState): boolean {
  return (LIVE_STATES as readonly string[]).includes(state);
}

/** A state in which the run rests: the liveness is `not-applicable`. */
export function isRestingState(state: ViewState): boolean {
  return (RESTING_STATES as readonly string[]).includes(state);
}

/** The reasons of `stale` (row 247 of annex X §X.6). */
export const STALE_HEARTBEAT_AND_EVENTS_OLD = "heartbeat-and-events-old" as const;
export const STALE_EVENT_MAJOR_OUT_OF_RANGE = "event-major-out-of-range" as const;

/** The result of the liveness table for one view. */
export type LivenessOutcome = { readonly liveness: Liveness; readonly dead: boolean };

/**
 * F129-FR-012 — the liveness of the run, and whether the owner is gone. A run
 * record in a resting state has the liveness `not-applicable`. The state
 * `created` has no lease and is judged by F129-FR-014. A run in `starting`
 * with no lease yet is not `dead` before the handshake limit has passed since
 * the launch record was written.
 */
export function livenessOf(options: {
  readonly state: ViewState;
  readonly lease: LeaseObservation | null;
  readonly now: string;
  readonly launchWrittenAt: string | null;
  readonly handshakeLimitSec: number | null;
}): LivenessOutcome {
  const { state, lease, now, launchWrittenAt, handshakeLimitSec } = options;
  if (isRestingState(state)) return Object.freeze({ liveness: "not-applicable", dead: false });
  if (state === "created" || state === "none" || state === "unknown") {
    return Object.freeze({ liveness: "not-applicable", dead: false });
  }
  if (lease === null) return Object.freeze({ liveness: "unknown", dead: false });
  const row = LIVENESS_TABLE[lease.probe] ?? LIVENESS_TABLE["unknown"];
  if (row === undefined) return Object.freeze({ liveness: "unknown", dead: false });
  if (
    state === "starting" &&
    row.dead &&
    !handshakeHasPassed(launchWrittenAt, now, handshakeLimitSec)
  ) {
    return Object.freeze({ liveness: row.liveness, dead: false });
  }
  return Object.freeze({ liveness: row.liveness, dead: row.dead });
}

/** True when the handshake limit has passed since the launch record was written. */
export function handshakeHasPassed(
  launchWrittenAt: string | null,
  now: string,
  handshakeLimitSec: number | null,
): boolean {
  if (launchWrittenAt === null || handshakeLimitSec === null) return false;
  const age = ageInSeconds(launchWrittenAt, now);
  return age !== null && age > handshakeLimitSec;
}

/** The age of a timestamp at `now`, in whole seconds, or null where unreadable. */
export function ageInSeconds(at: string | null, now: string): number | null {
  if (at === null) return null;
  const then = Date.parse(at);
  const here = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(here)) return null;
  return Math.floor((here - then) / 1000);
}

/**
 * F129-FR-013 — `stale` in its two cases. The reason
 * `event-major-out-of-range` stands first: it is a fact of the stream, and it
 * holds whatever the heartbeat says.
 */
export function staleOf(options: {
  readonly liveness: Liveness;
  readonly heartbeatLate: boolean;
  readonly newestEventAt: string | null;
  readonly now: string;
  readonly staleEventSec: number;
  readonly majorOutOfRange: { readonly majorFound: number; readonly accepted: MajorRange } | null;
}): StaleCondition | null {
  const { liveness, heartbeatLate, newestEventAt, now, staleEventSec, majorOutOfRange } = options;
  if (majorOutOfRange !== null) {
    return Object.freeze({
      reason: STALE_EVENT_MAJOR_OUT_OF_RANGE,
      majorFound: majorOutOfRange.majorFound,
      majorsAccepted: majorOutOfRange.accepted,
    });
  }
  if (liveness !== "alive") return null;
  if (!heartbeatLate) return null;
  const eventAge = ageInSeconds(newestEventAt, now);
  if (eventAge === null || eventAge <= staleEventSec) return null;
  return Object.freeze({
    reason: STALE_HEARTBEAT_AND_EVENTS_OLD,
    majorFound: null,
    majorsAccepted: null,
  });
}

/**
 * F129-FR-014 — `launch-abandoned`: the newest launch record has no `outcome`,
 * is older than the handshake limit, and no lease carries its launch nonce.
 */
export function launchAbandonedOf(options: {
  readonly newestLaunchRecord: Readonly<Record<string, unknown>> | null;
  readonly lease: LeaseObservation | null;
  readonly now: string;
  readonly handshakeLimitSec: number | null;
}): boolean {
  const { newestLaunchRecord, lease, now, handshakeLimitSec } = options;
  if (newestLaunchRecord === null) return false;
  const outcome = newestLaunchRecord["outcome"];
  if (typeof outcome === "string" && outcome !== "") return false;
  const createdAt = newestLaunchRecord["createdAt"];
  if (
    !handshakeHasPassed(typeof createdAt === "string" ? createdAt : null, now, handshakeLimitSec)
  ) {
    return false;
  }
  const nonce = newestLaunchRecord["launchNonce"];
  const leaseNonce = lease?.lease?.["launchNonce"];
  if (typeof nonce === "string" && nonce !== "" && nonce === leaseNonce) return false;
  return true;
}

/**
 * F129-FR-027 — the `st` value: the written state, or the first of `dead`,
 * `launch-abandoned`, `stale`, `unknown` where more than one holds.
 */
export function displayOf(options: {
  readonly state: ViewState;
  readonly dead: boolean;
  readonly launchAbandoned: boolean;
  readonly stale: StaleCondition | null;
  /**
   * T052 — the `refusal` of the newest launch record when it is one the
   * consumer caused (CQ-166: never `launch-abandoned`, which the next launch
   * writes to close its own abandoned record). A refused `resume` or launch
   * shows the run as `blocked-on-human` from observation 2 alone: no run
   * record is written for such a refusal (F102-FR-016).
   */
  readonly refused?: string | null;
}): string {
  if (options.dead) return "dead";
  if (options.launchAbandoned) return "launch-abandoned";
  if (options.stale !== null) return "stale";
  if (options.state === "unknown") return "unknown";
  if (options.refused !== null && options.refused !== undefined && options.refused !== "") {
    return "blocked-on-human";
  }
  return options.state;
}
