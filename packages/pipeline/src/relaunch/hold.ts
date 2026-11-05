/**
 * T030 — the inbox request `hold-relaunch` (F123-FR-032).
 *
 * The request holds every relaunch by the runtime root while `hold` is true
 * and lifts the hold when `hold` is false. A held relaunch leaves the root
 * in the state `relaunching`, emits nothing that changes the count, and is
 * decided again when the hold is lifted. When the deadline of the relaunch
 * budget passes while a hold is in force, the run ends `failed` with the
 * reason `budget-deadline-exceeded` and the detail of that decision says
 * that the relaunch was held. With `relaunch.owner: supervise` the request
 * has no effect and the verbs refuse with `no-live-run`, exit 4.
 */
import { readFileSync } from "node:fs";
import type { RelaunchBudget } from "./budget.ts";
import { deadlinePassed } from "./budget.ts";
import type { RelaunchOwner } from "./owner.ts";

/** The name of the inbox request (data-model: `inbox:hold-relaunch`). */
export const HOLD_INBOX_NAME = "hold-relaunch";

/** The one member of the closed set "Hold refusals". */
export const HOLD_REFUSAL_NO_LIVE_RUN = "no-live-run";

/** The exit of a refused `hold` or `release` verb. */
export const HOLD_REFUSAL_EXIT = 4;

/** The detail of a run that ended because the deadline passed under a hold. */
export const HOLD_DEADLINE_DETAIL =
  "relaunch held: the deadline of the relaunch budget passed while hold-relaunch was in force";

/** The reason of a run that ended because the deadline passed under a hold. */
export const HOLD_DEADLINE_REASON = "budget-deadline-exceeded";

/** The request record the verbs write and the root reads. */
export type HoldRequest = {
  hold: boolean;
  reason?: string;
};

/**
 * Read the inbox request; a missing or unreadable file reads as no request
 * in force. Pure over the filesystem.
 */
export function readHoldRequest(path: string): HoldRequest | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record["hold"] !== "boolean") return null;
  return {
    hold: record["hold"],
    reason: typeof record["reason"] === "string" ? record["reason"] : undefined,
  };
}

/** Whether a hold is in force at `path` right now. */
export function holdInForce(path: string): boolean {
  return readHoldRequest(path)?.hold === true;
}

/** The poll while held: short, and only in the `relaunching` state. */
export const HOLD_POLL_SECONDS = 5;

/**
 * The result of the wait in `relaunching`: either the hold lifted and the
 * table decides again, or the deadline of the budget passed while the hold
 * stood, which ends the run `failed` (T12).
 */
export type HoldWaitResult = {
  /** Whether a hold was in force when the wait ended. */
  held: boolean;
  /** Whether the deadline passed while the hold stood. */
  deadlinePassedUnderHold: boolean;
  /** The reason the request carried, when it did. */
  reason: string | null;
};

/**
 * The wait in `relaunching` (F123-FR-032): while the hold stands, sleep one
 * poll on the injected clock and read the request again; the moment the
 * hold lifts, return so the table decides again. When the deadline of the
 * budget passes while the hold stands, return with
 * `deadlinePassedUnderHold: true` — the caller ends the run `failed` with
 * `budget-deadline-exceeded` and `HOLD_DEADLINE_DETAIL`.
 */
export async function waitWhileHeld(input: {
  requestPath: string;
  budget: RelaunchBudget;
  clock: { now(): number; sleep(ms: number): Promise<number> };
  pollSeconds?: number;
}): Promise<HoldWaitResult> {
  const pollMs = (input.pollSeconds ?? HOLD_POLL_SECONDS) * 1000;
  for (;;) {
    const request = readHoldRequest(input.requestPath);
    if (request === null || !request.hold) {
      return { held: false, deadlinePassedUnderHold: false, reason: request?.reason ?? null };
    }
    if (deadlinePassed(input.budget, input.clock.now())) {
      return { held: true, deadlinePassedUnderHold: true, reason: request.reason ?? null };
    }
    await input.clock.sleep(pollMs);
  }
}

/** The refusal of a `hold` or `release` verb that must not take effect. */
export type HoldVerbRefusal = { ok: false; refusal: typeof HOLD_REFUSAL_NO_LIVE_RUN; exit: number };

/** A `hold` or `release` verb that wrote its request. */
export type HoldVerbWritten = { ok: true };

/**
 * Resolve the `hold` and `release` verbs (F123-FR-032): under
 * `relaunch.owner: supervise` the request has no effect, and without a live
 * run there is nothing to hold — both refuse with `no-live-run`, exit 4.
 */
export function resolveHoldVerb(input: {
  verb: "hold" | "release";
  owner: RelaunchOwner;
  /** Whether a live run of this consumer exists (`relaunch.owner: root`). */
  liveRun: boolean;
}): HoldVerbWritten | HoldVerbRefusal {
  if (input.owner !== "root" || !input.liveRun) {
    return { ok: false, refusal: HOLD_REFUSAL_NO_LIVE_RUN, exit: HOLD_REFUSAL_EXIT };
  }
  return { ok: true };
}

/**
 * The terminal record of T12: a hold past the deadline ends the run `failed`
 * with `budget-deadline-exceeded` and the detail that says the relaunch was
 * held.
 */
export function holdDeadlineOutcome(): {
  state: "failed";
  exitReason: typeof HOLD_DEADLINE_REASON;
  detail: string;
  exitCode: number;
} {
  return {
    state: "failed",
    exitReason: HOLD_DEADLINE_REASON,
    detail: HOLD_DEADLINE_DETAIL,
    exitCode: 22,
  };
}
