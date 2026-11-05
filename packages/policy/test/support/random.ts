/**
 * T003 — the fixed random source of the test frame of feature 127 (`plan.md`,
 * *Jitter*: "A random source port; the test fixes it").
 *
 * The one place this feature draws a random number is the jitter of `resumeAt`:
 * `resetsAt` + `pause.marginMs` + a jitter of 0 to `pause.jitterMs`
 * (F127-FR-013). A test that fixes the source gets one `resumeAt` and can
 * assert it to the millisecond.
 */
import type { RandomSource } from "../../src/quota/ports.ts";

/** A source that returns the same fraction at every draw. */
export type FixedRandom = RandomSource & {
  /** Every fraction the source handed out, in order. */
  readonly draws: readonly number[];
};

/**
 * A fixed random source. With one fraction it returns that fraction for ever;
 * with several it walks the list and then repeats it, so a test of the probe
 * schedule can give a different jitter per probe and stay deterministic.
 *
 * A fraction outside `[0, 1)` is refused: the contract of `RandomSource` is a
 * fraction in `[0, 1)`, and a fake that breaks it would hide a bug in the
 * module that scales it.
 */
export function fixedRandom(...fractions: readonly number[]): FixedRandom {
  const values = fractions.length > 0 ? fractions : [0];
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`a fraction of the random source is in [0, 1): ${value}`);
    }
  }
  const draws: number[] = [];
  let next = 0;
  return {
    fraction(): number {
      const value = values[next % values.length];
      next += 1;
      draws.push(value);
      return value;
    },
    draws,
  };
}
