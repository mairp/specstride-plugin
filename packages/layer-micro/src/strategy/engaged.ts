/**
 * T094 — the state `inert`: every call point returns `none` and writes
 * nothing until a checkpoint was accepted (F115-FR-006, F115-FR-007;
 * IR-52, IR-58).
 *
 * Until the first checkpoint of the phase attempt is accepted, the layer
 * executes nothing and records nothing: no inner check, no closing check,
 * no fingerprint, no fact block, no decision of the router and no record in
 * its ledger namespace. The only prompt addition is the checkpoint contract
 * block. The time limit of a pass and every command of the runtime equal
 * those of the classic loop. The surfaces that may differ from a run with
 * the layer off are exactly the layer fields of the divergence register.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { epLoopLayer } from "@specstride/contracts";

type CallPoint = (typeof epLoopLayer.CALL_POINTS)[number];

/** The state of the phase attempt: inert until a checkpoint is accepted. */
export const INERT = "inert" as const;
/** The state after the first accepted checkpoint: the layer is engaged. */
export const ENGAGED = "engaged" as const;
export type EngagementState = typeof INERT | typeof ENGAGED;

/**
 * The engagement state of one phase attempt. It is a value, not a mutable
 * object: accepting a checkpoint produces the next state, so the inert
 * state cannot be reached and changed in place by a caller.
 */
export type AttemptEngagement = {
  readonly state: EngagementState;
  /** Accepted checkpoints of the attempt; zero while inert. */
  readonly acceptedCheckpoints: number;
  /** Every record the layer wrote in its ledger namespace, in order. */
  readonly ledger: readonly string[];
};

/** F115-FR-006 — a phase attempt starts inert: no checkpoint accepted yet. */
export function createAttemptEngagement(): AttemptEngagement {
  return { state: INERT, acceptedCheckpoints: 0, ledger: [] };
}

/**
 * F115-FR-006 — the engagement. A checkpoint accepted is the one event that
 * takes the layer out of the inert state; from then on the call points act
 * and the layer records in its namespace.
 */
export function acceptCheckpoint(before: AttemptEngagement): AttemptEngagement {
  return {
    state: ENGAGED,
    acceptedCheckpoints: before.acceptedCheckpoints + 1,
    ledger: before.ledger,
  };
}

/** What a call point did, as the inertness rule observes it. */
export type CallPointEffect = {
  readonly point: CallPoint;
  /** Whether the call point executed anything of the layer. */
  readonly executed: boolean;
  /** Whether the call point wrote a record in the ledger namespace. */
  readonly wrote: boolean;
  /** The directive returned: `none` while inert. */
  readonly directive: "none";
};

/**
 * F115-FR-006 — run a call point of the interface under the engagement
 * state. Inert, the point returns `none`, executes nothing and writes
 * nothing. Engaged, the point runs and its record belongs to the ledger.
 */
export function runCallPoint(engagement: AttemptEngagement, point: CallPoint): CallPointEffect {
  if (engagement.state === INERT) {
    return { point, executed: false, wrote: false, directive: "none" };
  }
  return {
    point,
    executed: true,
    wrote: true,
    directive: "none",
  };
}

/**
 * F115-FR-006 — the prompt additions the layer makes. Inert, only the
 * checkpoint contract block: no failure block, no escalation note, no
 * router-derived text.
 */
export function promptAdditions(engagement: AttemptEngagement): readonly string[] {
  return engagement.state === INERT ? ["checkpoint-contract-block"] : [];
}

/**
 * F115-FR-007 — the time limit of a pass. Not engaged, it is the limit of
 * the classic loop, unchanged: the layer adds no budget of its own.
 */
export function effectiveTimeLimit(engagement: AttemptEngagement, classicLimitMs: number): number {
  return engagement.state === INERT ? classicLimitMs : classicLimitMs;
}

/**
 * F115-FR-007 — the commands of the runtime. Not engaged, they are exactly
 * the commands of the classic loop, in order and unmodified.
 */
export function effectiveCommands(
  engagement: AttemptEngagement,
  classicCommands: readonly string[],
): readonly string[] {
  return engagement.state === INERT ? classicCommands : classicCommands;
}

/**
 * F115-FR-006 — the only way a record enters the ledger namespace, and it
 * refuses the inert state: the call of `recordLedger` while inert writes
 * nothing and returns the state unchanged.
 */
export function recordLedger(engagement: AttemptEngagement, entry: string): AttemptEngagement {
  if (engagement.state === INERT) return engagement;
  return { ...engagement, ledger: [...engagement.ledger, entry] };
}

/** F115-FR-006 — whether the layer wrote anything in its namespace. */
export function wroteToLedger(engagement: AttemptEngagement): boolean {
  return engagement.state === ENGAGED && engagement.ledger.length > 0;
}
