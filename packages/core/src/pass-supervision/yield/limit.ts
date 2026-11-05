/**
 * T047 of feature 118 — the limit of yields per phase attempt and the result
 * 9 (F118-FR-021; PT-118-C-055, C-010).
 *
 * When a phase attempt yields for the fifth time (the limit, default 4), the
 * pass loop deletes the artifact, starts no job, logs the line of the
 * baseline, writes `run_stop reason=proposer_yield_budget` with the fields
 * `iter`, `yields` and `max`, and ends with the result 9, which the engine
 * maps to exit 4. The counter is per proposer invocation, is never reset
 * inside it, advances only on an accepted or over-budget yield, and continues
 * across a resume and a relaunch (F100-FR-069).
 */
import { YIELD_MAX_PER_ATTEMPT_DEFAULT } from "./schema/index.ts";

/** The result the pass loop ends with when the yield budget is spent. */
export const YIELD_BUDGET_RESULT = 9;

/** The stop reason of the run-stop record (the engine maps result 9 to exit 4). */
export const YIELD_BUDGET_STOP_REASON = "proposer_yield_budget";

/** The yield counter of one phase attempt (carried across resumes by the ledger). */
export interface YieldCounter {
  /** The yields accepted so far in this attempt (an over-budget one counts too). */
  readonly yields: number;
}

/** A fresh counter for one phase attempt. */
export function freshYieldCounter(): YieldCounter {
  return { yields: 0 };
}

/** The decision on reading an artifact when the counter already stands at `yields`. */
export type YieldLimitDecision =
  | { readonly kind: "within-limit"; readonly next: YieldCounter }
  | {
      readonly kind: "over-budget";
      readonly next: YieldCounter;
      readonly result: typeof YIELD_BUDGET_RESULT;
      readonly stopReason: typeof YIELD_BUDGET_STOP_REASON;
      readonly fields: Readonly<{ iter: number; yields: number; max: number }>;
    };

/**
 * Count one artifact that the pass wants to act on (an accepted yield or the
 * one over the limit — a refused artifact gives the index back and is counted
 * nowhere, F118-FR-024).
 */
export function countYield(
  counter: YieldCounter,
  max: number = YIELD_MAX_PER_ATTEMPT_DEFAULT,
  iter: number = 0,
): YieldLimitDecision {
  // The limit is 4: the artifact of the fifth yield is over budget. A max of
  // 0 disables the cap (F118-FR-015).
  if (max === 0 || counter.yields < max) {
    return { kind: "within-limit", next: { yields: counter.yields + 1 } };
  }
  return {
    kind: "over-budget",
    next: { yields: counter.yields + 1 },
    result: YIELD_BUDGET_RESULT,
    stopReason: YIELD_BUDGET_STOP_REASON,
    fields: { iter, yields: counter.yields + 1, max },
  };
}

/** The line of the baseline when the budget is spent (F118-FR-029, byte for byte). */
export function yieldBudgetSpentLine(phase: number): string {
  return `>>> proposer's yield budget is spent for phase ${phase} — halting (exit 4).`;
}
