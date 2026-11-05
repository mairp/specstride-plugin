/**
 * T075 — the exclusions `slow` and `budget`, and the record of every
 * exclusion (F115-FR-023; IR-08, the exclusions half).
 *
 * A command of the inner set has a time limit of 5 minutes by default
 * (`loop.micro.caps.checkMin`). A command whose measured duration exceeds
 * the limit is excluded for the phase with the reason `slow`, and its result
 * reads `unchecked` and not failed. From the third cycle of a phase attempt
 * the time spent in inner checks must not exceed 15 per cent of the elapsed
 * time of the attempt (`loop.micro.caps.checkSharePercent`); on a breach the
 * slowest command is excluded with the reason `budget`.
 *
 * Only the runtime excludes a command. The layer decides nothing here: the
 * runtime measures the duration and the share, the layer computes which
 * reason applies and states the record. Every exclusion carries a reason and
 * is recorded as an event of the type `check.excluded`, and every exclusion
 * is given to the builder of the fact block (annex D §D.7).
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/** The default time limit of one command of the inner set: 5 minutes (row 65). */
export const CHECK_TIME_LIMIT_MS_DEFAULT = 5 * 60 * 1000;

/** The default share of the time of the attempt inner checks may take: 15 per cent. */
export const CHECK_SHARE_PERCENT_DEFAULT = 15;

/** Why a command was excluded (F115-FR-023). */
export type ExclusionReason = "slow" | "budget";

/** The exclusion of one command, with its reason. */
export type Exclusion = {
  readonly id: string;
  readonly reason: ExclusionReason;
  /** The measured duration in milliseconds that led to the exclusion. */
  readonly measuredMs: number;
  /** The limit the measured duration was read against. */
  readonly limitMs: number;
};

/** The event of one exclusion (F115-FR-023; the catalogue type). */
export type ExclusionEvent = {
  readonly type: "check.excluded";
  readonly commandId: string;
  readonly reason: ExclusionReason;
  readonly measuredMs: number;
  readonly limitMs: number;
};

/**
 * F115-FR-023 — the exclusion of a command that ran longer than its time
 * limit: the reason `slow`, `undefined` while the command is inside the
 * limit. The comparison is strict: a duration equal to the limit stands.
 */
export function slowExclusion(
  id: string,
  measuredMs: number,
  limitMs: number = CHECK_TIME_LIMIT_MS_DEFAULT,
): Exclusion | undefined {
  if (measuredMs > limitMs) {
    return { id, reason: "slow", measuredMs, limitMs };
  }
  return undefined;
}

/**
 * F115-FR-023 — the result a check states for an excluded command: it reads
 * `unchecked`, never failed. The command takes no part in the decision on
 * the unit (`outcome.ts` skips it).
 */
export function excludedResult(id: string): {
  readonly id: string;
  readonly exit: 0;
  readonly conditions: readonly string[];
  readonly excluded: true;
  readonly reads: "unchecked";
} {
  return { id, exit: 0, conditions: [], excluded: true, reads: "unchecked" };
}

/** One candidate of the budget exclusion, with its measured duration. */
export type BudgetCandidate = {
  readonly id: string;
  readonly measuredMs: number;
};

/**
 * F115-FR-023 — from the third cycle of the attempt, when the share of time
 * in inner checks exceeds the cap, the slowest command is excluded with the
 * reason `budget`. Before the third cycle, or under the cap, nothing is
 * excluded.
 */
export function budgetExclusion(
  candidates: readonly BudgetCandidate[],
  state: {
    /** The ordinal of the cycle, 1-based. */
    readonly cycle: number;
    /** The share of the attempt time spent in inner checks, in per cent. */
    readonly checkSharePercent: number;
    /** The cap of the share (default 15). */
    readonly capPercent?: number;
  },
): Exclusion | undefined {
  const cap = state.capPercent ?? CHECK_SHARE_PERCENT_DEFAULT;
  if (state.cycle < 3) return undefined;
  if (state.checkSharePercent <= cap) return undefined;
  if (candidates.length === 0) return undefined;
  const slowest = candidates.reduce((a, b) => (b.measuredMs > a.measuredMs ? b : a));
  return { id: slowest.id, reason: "budget", measuredMs: slowest.measuredMs, limitMs: cap };
}

/**
 * F115-FR-023 — the event of an exclusion, beside the exclusion itself.
 */
export function exclusionEvent(exclusion: Exclusion): ExclusionEvent {
  return {
    type: "check.excluded",
    commandId: exclusion.id,
    reason: exclusion.reason,
    measuredMs: exclusion.measuredMs,
    limitMs: exclusion.limitMs,
  };
}

/**
 * F115-FR-023 — every exclusion is recorded: the events of the exclusions
 * of one check, in the order the exclusions were decided.
 */
export function exclusionEvents(exclusions: readonly Exclusion[]): readonly ExclusionEvent[] {
  return exclusions.map(exclusionEvent);
}

/**
 * F115-FR-023 — the rows the builder of the fact block receives for the
 * exclusions (annex D §D.7): one row per exclusion, with the reason.
 */
export function factBlockRows(
  exclusions: readonly Exclusion[],
): readonly { readonly commandId: string; readonly reason: ExclusionReason }[] {
  return exclusions.map((exclusion) => ({
    commandId: exclusion.id,
    reason: exclusion.reason,
  }));
}
