/**
 * T036 — the three blocked cases of this feature (F127-FR-017).
 *
 * Three things cannot be waited out, so the run rests and asks a person:
 *
 * | Blocked reason | When | What the consumer must do |
 * |---|---|---|
 * | `quota-credit` | the class `quota_credit`, and no fallback entry remains | add credit |
 * | `auth` | the class `auth` | repair the login |
 * | `budget-cap` | a hard cap of spend was reached (F127-FR-034) | raise the cap |
 *
 * For each the engine emits `blocked` with the reason, says in ONE LINE what
 * the consumer must do, writes the terminal record with the stop reason and
 * the exit code of feature 100's own table (annex E §E.2 —
 * `proposer_consecutive_errors` with 4 for the first two, `wall_budget` with 4
 * for the third, each with `retryable: false`), releases the lock and ends.
 * Neither relaunch classifier table relaunches it.
 *
 * A TRIPPED WALL-CLOCK BUDGET IS NOT AMONG THEM (F127-FR-027): it ends as at
 * the baseline, with the stop reason `wall_budget`, exit 4, `retryable: true`
 * and NO blocked reason. The two are easy to confuse because the hard cap of
 * spend shares `wall_budget` as its stop reason; `WALL_CLOCK_IS_NOT_BLOCKED`
 * and `wallClockTrip` below keep them apart.
 *
 * Every value of the table is READ from `@specstride/contracts`
 * (`state/blocked-reasons`, `codes/stop-reasons`) and never restated here, so
 * a change in annex E reaches this module without an edit.
 */
import {
  WHAT_A_BLOCKED_RUN_DOES,
  blockedReasonRow,
  isBlockedReason,
  type BlockedReason,
} from "@specstride/contracts/state/blocked-reasons";
import type { EventWriter, PolicyEvent } from "./ports.ts";
import { type EmitOptions, blocked } from "./events.ts";
import type { QuotaClass } from "@specstride/contracts/ep/quota-classifier";

/* ------------------------------------------------------------------ *
 * The three reasons this feature owns, and the class each comes from.
 * ------------------------------------------------------------------ */

/** The three blocked reasons of F127-FR-017, in the order the requirement lists them. */
export const QUOTA_BLOCKED_REASONS = ["quota-credit", "auth", "budget-cap"] as const;
export type QuotaBlockedReason = (typeof QUOTA_BLOCKED_REASONS)[number];

/** The class that leads to each reason; `budget-cap` comes from a ceiling. */
export const REASON_OF_CLASS: Readonly<Partial<Record<QuotaClass, QuotaBlockedReason>>> =
  Object.freeze({
    quota_credit: "quota-credit",
    auth: "auth",
    budget_cap: "budget-cap",
  });

/** The one line each reason tells the consumer (F127-FR-017). */
export const NEEDS: Readonly<Record<QuotaBlockedReason, string>> = Object.freeze({
  "quota-credit":
    "the provider refused the call for credit, plan or billing: add credit to the account, or " +
    "opt in to a fallback entry, then run `resume`",
  auth: "the credential was refused or is missing: repair the login, then run `resume`",
  "budget-cap":
    "a hard cap of spend was reached: raise the cap in the configuration, then run `resume`",
});

/** `auth` takes no retry and no fallback (§Q.1). */
export const AUTH_TAKES_NO_FALLBACK = true as const;

/** `quota_credit` blocks only when NO FALLBACK ENTRY REMAINS (F127-FR-017). */
export const CREDIT_BLOCKS_WHEN_NO_FALLBACK_REMAINS = true as const;

/* ------------------------------------------------------------------ *
 * The terminal record values.
 * ------------------------------------------------------------------ */

/** The terminal record values of a blocked reason (annex E §E.2). */
export type BlockedTerminal = {
  readonly blockedReason: QuotaBlockedReason;
  /** The stop reason of the row of §E.2. */
  readonly stopReason: string;
  /** The exit code of the engine of the row of §E.2. */
  readonly exitCode: number;
  /** `retryable` of the terminal record: false for every blocked reason. */
  readonly retryable: boolean;
};

/** A reason this module refuses. */
export class BlockedCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedCaseError";
  }
}

/**
 * The terminal record values of one of the three reasons, read from feature
 * 100's own table of §E.2 (F127-FR-017).
 */
export function terminalOf(reason: QuotaBlockedReason): BlockedTerminal {
  const row = blockedReasonRow(reason);
  if (row === undefined || !isBlockedReason(reason)) {
    throw new BlockedCaseError(`${reason} is not a blocked reason of annex E §E.2 (F127-FR-017)`);
  }
  return Object.freeze({
    blockedReason: reason,
    stopReason: row.stopReason,
    exitCode: row.engineExit,
    retryable: row.retryable,
  });
}

/** The terminal record values of all three, for a reader and for a test. */
export function terminals(): Readonly<Record<QuotaBlockedReason, BlockedTerminal>> {
  const out: Partial<Record<QuotaBlockedReason, BlockedTerminal>> = {};
  for (const reason of QUOTA_BLOCKED_REASONS) out[reason] = terminalOf(reason);
  return Object.freeze(out as Record<QuotaBlockedReason, BlockedTerminal>);
}

/* ------------------------------------------------------------------ *
 * The block itself.
 * ------------------------------------------------------------------ */

/** The state a blocked run rests in. */
export const BLOCKED_STATE = "blocked-on-human" as const;

/** The transition of the run-state machine a block performs. */
export const BLOCKED_TRANSITION = "T9" as const;

/** What `blockOnAHuman` answers. */
export type BlockedOutcome = {
  readonly state: typeof BLOCKED_STATE;
  readonly transition: typeof BLOCKED_TRANSITION;
  readonly reason: QuotaBlockedReason;
  /** The event `blocked`, with the reason and the one-line need. */
  readonly event: PolicyEvent;
  /** The one line the consumer is told (F127-FR-017). */
  readonly needs: string;
  readonly terminal: BlockedTerminal;
  /** True: the lock is released and the run ends. */
  readonly releasesTheLock: boolean;
  readonly ends: boolean;
  /** False: neither relaunch classifier table relaunches it. */
  readonly relaunched: boolean;
  readonly note: string;
};

/** What `blockOnAHuman` is handed. */
export type BlockInput = {
  readonly reason: QuotaBlockedReason;
  readonly role?: string | undefined;
  /** The ceiling that was reached, where the reason is `budget-cap`. */
  readonly ceilingKey?: string | undefined;
  /** True where a fallback entry still remains: `quota-credit` then does NOT block. */
  readonly fallbackRemains?: boolean | undefined;
};

/**
 * F127-FR-017 — block on a human (transition T9).
 *
 * Emits `blocked` with the reason and the one-line need, gives the terminal
 * record values of §E.2, releases the lock and ends.
 *
 * `quota-credit` with a fallback entry still in the list is REFUSED: the
 * requirement blocks only "when no fallback entry remains", and a run that
 * blocked with a fallback left would never make the switch group G3 exists
 * for.
 */
export function blockOnAHuman(
  eventWriter: EventWriter,
  input: BlockInput,
  options: EmitOptions = {},
): BlockedOutcome {
  if (input.reason === "quota-credit" && input.fallbackRemains === true) {
    throw new BlockedCaseError(
      `the class quota_credit blocks only when no fallback entry remains (F127-FR-017); a ` +
        `fallback entry remains for the role ${input.role ?? "(unnamed)"}, so the engine ` +
        `switches instead of blocking`,
    );
  }
  const terminal = terminalOf(input.reason);
  const needs =
    input.reason === "budget-cap" && input.ceilingKey !== undefined
      ? `${NEEDS["budget-cap"]} (the ceiling ${input.ceilingKey})`
      : NEEDS[input.reason];
  const event = blocked(
    eventWriter,
    {
      reason: input.reason,
      needs,
      ...(input.role === undefined ? {} : { role: input.role }),
    },
    options,
  );
  return Object.freeze({
    state: BLOCKED_STATE,
    transition: BLOCKED_TRANSITION,
    reason: input.reason,
    event,
    needs,
    terminal,
    releasesTheLock: WHAT_A_BLOCKED_RUN_DOES.releasesTheLock,
    ends: WHAT_A_BLOCKED_RUN_DOES.ends,
    relaunched: WHAT_A_BLOCKED_RUN_DOES.relaunchedByEitherClassifierTable,
    note:
      `the run rests in ${BLOCKED_STATE} with the blocked reason ${input.reason}: the terminal ` +
      `record carries the stop reason ${terminal.stopReason}, the exit code ` +
      `${terminal.exitCode} and retryable ${String(terminal.retryable)}; the lock is released ` +
      `and neither relaunch classifier table relaunches it (F127-FR-017)`,
  });
}

/** The blocked reason a class leads to, or null where it leads to none. */
export function reasonForClass(quotaClass: QuotaClass): QuotaBlockedReason | null {
  return REASON_OF_CLASS[quotaClass] ?? null;
}

/* ------------------------------------------------------------------ *
 * What a tripped wall-clock budget is NOT.
 * ------------------------------------------------------------------ */

/**
 * F127-FR-017 and F127-FR-027 — a tripped wall-clock budget is NOT a blocked
 * case. It ends as at the baseline: the stop reason `wall_budget`, exit 4,
 * `retryable: true` and NO blocked reason.
 */
export const WALL_CLOCK_IS_NOT_BLOCKED = Object.freeze({
  stopReason: "wall_budget",
  exitCode: 4,
  retryable: true,
  blockedReason: null,
  restsIn: null,
});

/** The terminal record values of a tripped wall-clock budget (F127-FR-027). */
export function wallClockTrip(): typeof WALL_CLOCK_IS_NOT_BLOCKED {
  return WALL_CLOCK_IS_NOT_BLOCKED;
}

/** The blocked reasons of §E.2 this feature does NOT own, for a reader. */
export function reasonsOfOtherFeatures(): readonly BlockedReason[] {
  const mine = QUOTA_BLOCKED_REASONS as readonly string[];
  return Object.freeze(
    (["declared-block", "quota-wait-ceiling", "source-changed"] as BlockedReason[]).filter(
      (reason) => !mine.includes(reason),
    ),
  );
}
