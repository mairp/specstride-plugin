/**
 * T005 — the adjustable-knob allowlist, the hard bounds and the step cap
 * (F106-FR-001, F106-FR-002).
 *
 * Ported from the baseline (`lib/learn.py` at the pinned commit `9cab15d2`,
 * `ADJUSTABLE_KNOBS`, `KNOB_HARD_MIN`, `KNOB_HARD_MAX_FIXED`,
 * `STEP_CAP_FRACTION`, `YIELD_POLL_WASTE_FRACTION`). The set is locked on
 * purpose: a name added here without a change of the specification fails
 * `tests/parity/106/knobs.test.ts`, which compares the set with the closed
 * set 187 that feature 100 generates into `@specstride/contracts`
 * (`adjustableKnobsOfLearning`) — the set is never written a second time.
 *
 * The former third knob (`inject_yield_hint`) does not exist. No breaker, no
 * grounding cap, no critic setting and no verification command is ever
 * adjustable. The bounds are not options: they are constants here.
 */
import { adjustableKnobsOfLearning } from "@specstride/contracts";

/** The members of the allowlist, sorted (the form the refusal message lists). */
export const ADJUSTABLE_KNOBS = ["proposer_timeout", "yield_poll_interval"] as const;

export type AdjustableKnob = (typeof ADJUSTABLE_KNOBS)[number];

/**
 * The lock on the allowlist (F106-FR-001): the members here and the members of
 * the closed set 187 of feature 100 must be the same list. Importing the set
 * reads feature 100's generated data (`packages/contracts/data/closed-sets.json`,
 * row 187); this module never restates it.
 */
if (
  ADJUSTABLE_KNOBS.length !== adjustableKnobsOfLearning.members.length ||
  [...ADJUSTABLE_KNOBS].some((knob) => !adjustableKnobsOfLearning.has(knob))
) {
  throw new Error(
    "the adjustable-knob allowlist of learning differs from the closed set 187 " +
      "of feature 100 (adjustableKnobsOfLearning); the specification stands where " +
      "the two differ (F106-FR-001)",
  );
}

/**
 * The refusal of a name outside the set, in the words of F106-FR-001, with the
 * members sorted and written in the list form of the baseline
 * (`['proposer_timeout', 'yield_poll_interval']`).
 */
export function allowlistRefusalMessage(knob: string): string {
  const members = [...ADJUSTABLE_KNOBS]
    .sort()
    .map((name) => `'${name}'`)
    .join(", ");
  return `learn: '${knob}' is not in the adjustable-knob allowlist (${members}) — refusing`;
}

/** True when `knob` is a member of the allowlist. */
export function isAdjustableKnob(knob: string): knob is AdjustableKnob {
  return (ADJUSTABLE_KNOBS as readonly string[]).includes(knob);
}

/** Hard lower bound per knob (seconds). */
export const KNOB_HARD_MIN: Readonly<Record<AdjustableKnob, number>> = Object.freeze({
  proposer_timeout: 900,
  yield_poll_interval: 10,
});

/** Fixed hard upper bound per knob; `proposer_timeout`'s is 2 × the default in force. */
export const KNOB_HARD_MAX_FIXED: Readonly<Partial<Record<AdjustableKnob, number>>> = Object.freeze(
  {
    yield_poll_interval: 300,
  },
);

/** Every numeric knob moves by at most 50 per cent per step (F106-FR-002). */
export const STEP_CAP_FRACTION = 0.5;

/** The target of `yield_poll_interval`: a tenth of the job's own measured length. */
export const YIELD_POLL_WASTE_FRACTION = 0.1;

/** The step a `proposer_timeout` value rounds to (seconds). */
export const TIMEOUT_STEP_SEC = 60;

/** [min, max] of the hard bounds of `knob`; `proposer_timeout`'s max is twice `defaultValue`. */
export function hardBounds(knob: AdjustableKnob, defaultValue: number): [number, number] {
  const lo = KNOB_HARD_MIN[knob]!;
  const hi = KNOB_HARD_MAX_FIXED[knob] ?? 2 * defaultValue;
  return [lo, hi];
}

/** [base × ½, base × 3⁄2]: the window the step cap allows around `base`. */
export function stepWindow(base: number): [number, number] {
  return [base * (1 - STEP_CAP_FRACTION), base * (1 + STEP_CAP_FRACTION)];
}

/** The value clamped into the hard bounds (F106-FR-002: they always decide). */
export function clampToBounds(value: number, knob: AdjustableKnob, defaultValue: number): number {
  const [lo, hi] = hardBounds(knob, defaultValue);
  return Math.min(Math.max(value, lo), hi);
}

/** Round to the timeout step of 60 seconds (`_round_step` of the baseline). */
export function roundToStep(value: number, step: number = TIMEOUT_STEP_SEC): number {
  return Math.round(value / step) * step;
}

/**
 * The value `target` may take under the step cap and the hard bounds together
 * (the clamp of the two suggestion engines): the step window around `base`
 * intersected with the hard bounds, the hard bounds alone when the two do not
 * overlap (F106-FR-002). `target` is then clamped into that window, rounded —
 * `roundToStep` for `proposer_timeout`, integer rounding otherwise — and
 * clamped once more so rounding never escapes the hard bounds.
 */
export function boundSuggestion(
  knob: AdjustableKnob,
  target: number,
  base: number,
  defaultValue: number,
): number {
  const [hardLo, hardHi] = hardBounds(knob, defaultValue);
  const [stepLo, stepHi] = stepWindow(base);
  let lo = Math.max(hardLo, stepLo);
  let hi = Math.min(hardHi, stepHi);
  if (lo > hi) {
    // A degenerate window (`base` sits outside the hard bounds already): the
    // hard bounds alone decide (F106-FR-002).
    lo = hardLo;
    hi = hardHi;
  }
  let value = Math.min(Math.max(target, lo), hi);
  value = knob === "proposer_timeout" ? roundToStep(value) : Math.round(value);
  return Math.min(Math.max(value, hardLo), hardHi);
}
