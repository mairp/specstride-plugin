/**
 * T075 — the clock of the kernel (F100-FR-234).
 *
 * A core package reads no clock of the platform: the table evaluator of the
 * kernel is pure for the same reason (annex X, §X.3). The composition root
 * hands this clock to the core as an argument, and a test hands a clock of its
 * own, so that a duration is a value a test chooses and not a value a machine
 * happens to have.
 *
 * `monotonicMs` is a reading a change of the wall clock must not move: it comes
 * from the monotonic source of the platform, not from the epoch. A duration is
 * measured with it; a time that goes into a record is measured with `nowMs`.
 */
import type { Clock } from "@specstride/contracts/ep/kernel-services";

/** The requirement this module carries. */
export const PROC_CLOCK_REQUIREMENT = "F100-FR-234" as const;

/** The clock of the kernel over the platform (F100-FR-234). */
export const systemClock: Clock = Object.freeze({
  nowMs(): number {
    return Date.now();
  },
  nowIso(): string {
    return new Date().toISOString();
  },
  monotonicMs(): number {
    // A reading a change of the wall clock must not move.
    return Number(process.hrtime.bigint() / 1_000_000n);
  },
});

/**
 * A clock a test drives by hand. It is here and not in a test tree because the
 * conformance suites of the extension points need it too, and because a clock
 * that a test cannot move is a clock a test cannot use.
 */
export function fixedClock(startMs: number): Clock & { advance(byMs: number): void } {
  let ms = startMs;
  return {
    nowMs: (): number => ms,
    nowIso: (): string => new Date(ms).toISOString(),
    monotonicMs: (): number => ms,
    advance: (byMs: number): void => {
      ms += byMs;
    },
  };
}
