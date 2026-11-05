/**
 * T031 — the statements of no continuation, of the approval behaviour and of
 * the containment ceiling (F130-FR-016, F130-FR-017, F130-FR-018).
 *
 * The descriptor data (`data/descriptor-dsh.json`) carries the facts:
 * `continuation.supported: false`, `session.continuation: "none"`, and
 * `containment: {ceiling: "C1", provenance: "adapter", status: "unverified"}`.
 * This module states them as the run-record fragments a pass repeats, with
 * the derived rules: the continuation switch has no effect on this harness
 * and the run records that; the micro-loop layer runs at level L1; a pass
 * never waits on a human (standard input closed; the approval mode `ask`
 * `unverified` until capture 1; a pass that ends without a reply is classified
 * `agent_failure`); the ceiling is C1 with the mark `unverified`, the record
 * says `protection=detect`, the adapter never claims a sandbox, and parallel
 * units stay off with the reason stated unless the consumer set
 * `loop.parallel.allow_detect` in USER CONFIGURATION only (ruling P2;
 * F100-FR-112).
 */

/** The continuation facts of the descriptor, restated for a run record. */
export const DSH_CONTINUATION_STATEMENT = Object.freeze({
  "session.continuation": "none",
  supported: false,
  /** Every headless run creates a new session: every pass is fresh. */
  freshSessionEveryPass: true,
  /** Context travels by the handoff and the ledger, never by a session. */
  contextBy: "handoff and ledger",
} as const);

/** The record of the continuation switch having no effect (F130-FR-016). */
export type ContinuationSwitchRecord = {
  readonly switch: "carry.continuation";
  readonly effect: "none";
  readonly recorded: true;
};

/** The run record that the switch `carry.continuation` had NO effect. */
export function continuationSwitchRecord(): ContinuationSwitchRecord {
  return { switch: "carry.continuation", effect: "none", recorded: true };
}

/** The level the micro-loop layer runs at for a phase attempt on dsh. */
export function dshMicroLoopLevel(): "L1" {
  return "L1";
}

/** The approval behaviour of a headless pass (F130-FR-017). */
export const DSH_APPROVAL_STATEMENT = Object.freeze({
  /** A pass NEVER waits on a human. */
  waitsOnHuman: false,
  /** The standard input of the process is closed. */
  stdin: "closed",
  /** What the approval mode `ask` does headless is not established. */
  approvalModeAsk: "unverified (capture 1)",
  /** Until capture 1 exists: a pass that ends without a reply is classified so. */
  noReplyClassification: "agent_failure",
  /** The watchdogs of the pass supervision apply like for any other harness. */
  watchdogs: "pass supervision",
} as const);

/** The containment ceiling of the descriptor, restated (F130-FR-018). */
export const DSH_CONTAINMENT_STATEMENT = Object.freeze({
  ceiling: "C1",
  provenance: "adapter",
  mark: "unverified",
  /** Whether the operating system enforces the mode is not established. */
  protection: "detect",
  /** The adapter MUST NOT claim a sandbox (F100-FR-111, F130-FR-018). */
  sandboxClaimed: false,
  /** The adapter MUST NOT claim C2 by itself. */
  claimedCeiling: "C1",
} as const);

/** The origin a value came from; `allow_detect` from user configuration only. */
export type ConfigOrigin = "user-config" | "env" | "flag" | "project-config";

/** The decision on parallel units for this harness (F130-FR-018). */
export type ParallelUnitsDecision =
  | { readonly units: "off"; readonly reason: string }
  | { readonly units: "detect"; readonly reason: string; readonly allowedBy: "user-config" };

/**
 * The parallel-units decision (F130-FR-018): off, with the reason stated,
 * while `protection=detect` — unless the consumer set
 * `loop.parallel.allow_detect` in user configuration, which alone unlocks it
 * (the environment, a flag and project configuration must not, ruling P2).
 */
export function dshParallelUnitsDecision(allowDetect?: {
  readonly value: boolean;
  readonly origin: ConfigOrigin;
}): ParallelUnitsDecision {
  if (allowDetect !== undefined && allowDetect.value && allowDetect.origin === "user-config") {
    return {
      units: "detect",
      reason: `loop.parallel.allow_detect set in user configuration at protection=detect`,
      allowedBy: "user-config",
    };
  }
  const source = allowDetect === undefined || !allowDetect.value ? "unset" : allowDetect.origin;
  return {
    units: "off",
    reason:
      `containment C1 is unverified (protection=detect) and ` +
      `loop.parallel.allow_detect is ${source} (accepted from user configuration only)`,
  };
}
