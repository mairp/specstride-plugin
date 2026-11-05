/**
 * T049 of feature 118 — the counters after a yield (F118-FR-024;
 * acceptance scenario 1 of user story 2).
 *
 * A yielded pass is exempt from the no-progress breaker and leaves the error
 * counter untouched. A satisfied yield spends no pass of the pass limit by
 * default (the pass is given back: the pass count is decremented, so a yield
 * and its resume are one logical pass); with `SPECSTRIDE_YIELD_COUNTS_AS_ITER`
 * (key `loop.yield.countsAsIter`) at `true` the pass is spent. After a
 * satisfied yield the next pass starts at once, without the inter-pass sleep.
 * A refused `adopt` gives the yield index back and the pass is accounted as an
 * ordinary pass with no evidence, to which the breakers and the short-pass
 * counter apply.
 */

/** The accounting state one yield touches. */
export interface YieldAccounting {
  /** The pass count of the pass limit (decremented when the pass is given back). */
  readonly passCount: number;
  /** The error counter (never touched by a yield). */
  readonly errorCount: number;
  /** The iteration index (`iter`) of the pass loop. */
  readonly iter: number;
}

/** How the loop must treat the pass that yielded. */
export interface YieldAccountingDecision {
  /** `giveIterationBack` is the directive the loop layer consumes (EP-04). */
  readonly giveIterationBack: boolean;
  /** A yielded pass is exempt from the no-progress breaker. */
  readonly exemptNoProgressBreaker: boolean;
  /** A yield leaves the error counter untouched. */
  readonly errorCountUnchanged: true;
  /** The next pass starts at once, without the inter-pass sleep. */
  readonly skipInterPassSleep: boolean;
  readonly next: YieldAccounting;
}

/**
 * Account one satisfied yield: the pass is given back unless the operator set
 * `countsAsIter` to true.
 */
export function accountSatisfiedYield(
  before: YieldAccounting,
  countsAsIter: boolean,
): YieldAccountingDecision {
  return {
    giveIterationBack: !countsAsIter,
    exemptNoProgressBreaker: true,
    errorCountUnchanged: true,
    skipInterPassSleep: true,
    next: {
      passCount: countsAsIter ? before.passCount : before.passCount - 1,
      errorCount: before.errorCount,
      iter: before.iter,
    },
  };
}

/**
 * Account a refused artifact or a refused `adopt`: the yield index is given
 * back and the pass counts as an ordinary pass with no evidence — the
 * breakers and the short-pass counter apply to it.
 */
export function accountRefusedYield(before: YieldAccounting): YieldAccountingDecision {
  return {
    giveIterationBack: false,
    exemptNoProgressBreaker: false,
    errorCountUnchanged: true,
    skipInterPassSleep: false,
    next: before,
  };
}
