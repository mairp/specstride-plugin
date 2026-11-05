/**
 * T030 of feature 118 — the consecutive cap kills and the result 10
 * (F118-FR-011, F118-FR-028; C-010, C-055, C-009, C-012; B-0133, B-0149,
 * B-0220, B-0613, B-2784, B-0788; annex D and annex E §E.3 of feature 100).
 *
 * Consecutive kills of passes at the hard cap are counted apart from the
 * error counter. When the count reaches the limit (default 3) the pass loop
 * ends with the result 10 and the engine records the stop reason
 * `proposer_cap_exhausted` with the fields `iter`, `kill_reason` and
 * `consec`, on both the legacy path and the structured path. A `hard_cap`
 * kill neither increases nor resets the error counter. Every kill by a
 * watchdog keeps the status 124 of a pass in the pass's own record (not the
 * exit of a process); the results 9 and 10 map to engine exit 4.
 */

/** The default limit of consecutive cap kills (F118-FR-014). */
export const MAX_CONSECUTIVE_CAPS_DEFAULT = 3;

/** The result the pass loop ends with when the cap breaker fires. */
export const RESULT_CAP_EXHAUSTED = 10;

/** The engine stop reason of the cap breaker. */
export const STOP_REASON_CAP_EXHAUSTED = "proposer_cap_exhausted";

/** The status a killed pass keeps in its own record (the `timeout` convention). */
export const PASS_KILL_STATUS = 124;

/** The engine exit the results 9 and 10 map to (F118-FR-028). */
export const ENGINE_EXIT_FOR_RESULTS_9_AND_10 = 4;

/** A running count of consecutive cap kills (survives a resume via the ledger). */
export interface CapBreakerCounter {
  /** The consecutive cap kills so far, INCLUDING this one. */
  readonly consec: number;
  /** The limit in force (default 3; `SPECSTRIDE_PROPOSER_MAX_CAPS`). */
  readonly max: number;
}

/** The state after one more `hard_cap` kill. */
export interface CapBreakerAfterKill {
  readonly counter: CapBreakerCounter;
  /** The event `iter_cap` of this kill (F118-FR-027). */
  readonly iterCap: {
    readonly iter: number;
    readonly reason: "hard_cap";
    readonly elapsed: number;
    readonly consec: number;
    readonly max: number;
  };
  /** Set when the breaker fired: the pass loop ends with the result 10. */
  readonly halting:
    | {
        readonly result: typeof RESULT_CAP_EXHAUSTED;
        readonly stopReason: typeof STOP_REASON_CAP_EXHAUSTED;
        readonly fields: {
          readonly iter: number;
          readonly kill_reason: "hard_cap";
          readonly consec: number;
        };
      }
    | undefined;
}

/** Register one more consecutive `hard_cap` kill (F118-FR-011). */
export function registerCapKill(input: {
  iter: number;
  elapsedSec: number;
  previousConsec: number;
  max?: number;
}): CapBreakerAfterKill {
  const max = input.max ?? MAX_CONSECUTIVE_CAPS_DEFAULT;
  const consec = input.previousConsec + 1;
  return {
    counter: { consec, max },
    iterCap: {
      iter: input.iter,
      reason: "hard_cap",
      elapsed: input.elapsedSec,
      consec,
      max,
    },
    halting:
      consec >= max
        ? {
            result: RESULT_CAP_EXHAUSTED,
            stopReason: STOP_REASON_CAP_EXHAUSTED,
            fields: {
              iter: input.iter,
              kill_reason: "hard_cap",
              consec,
            },
          }
        : undefined,
  };
}

/**
 * A `hard_cap` kill leaves the error counter exactly as it was
 * (F118-FR-011): neither increased nor reset.
 */
export function capKillEffectOnErrorCounter(errorCount: number): number {
  return errorCount;
}

/**
 * A pass that ends in any other way resets the consecutive cap counter to 0
 * (annex E §E.3); only consecutive kills at the ceiling keep it.
 */
export function resetCapCounter(): CapBreakerCounter {
  return { consec: 0, max: MAX_CONSECUTIVE_CAPS_DEFAULT };
}
