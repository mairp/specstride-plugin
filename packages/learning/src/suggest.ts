/**
 * T023 — the two suggestion engines (F106-FR-012, F106-FR-013): the advice
 * `learn --show` prints, one row per knob and phase, and never a write unless
 * an output was asked for (F106-FR-023).
 *
 * Ported from the baseline (`lib/learn.py` at the pinned commit `9cab15d2`):
 *  - `proposer_timeout` (F106-FR-012): the work seconds of the attempts of a
 *    phase are the samples; the target is 1.25 × the p90 of the samples when
 *    both percentiles exist (the p50 otherwise), clamped through
 *    `boundSuggestion` around the value currently in effect, and refused
 *    below the sample floor of three non-futility-killed samples.
 *  - `yield_poll_interval` (F106-FR-013): the target is a tenth of the p50 of
 *    the job durations of the phase (the poll interval should be about a
 *    tenth of the work a detached job takes, `YIELD_POLL_WASTE_FRACTION`),
 *    clamped the same way.
 *
 * The sample floor is a constant (F106-FR-014: floors are not options). A row
 * without a suggestion carries its reason text (C-092) and is still a row:
 * `advise` exits 0 when at least one row was printed, rows without a
 * suggestion included (F106-FR-025), and exits 1 with
 * `learn: no telemetry for any phase` only when no knob of any phase had any
 * sample.
 *
 * Purity: the summary document in, the rows and their lines out.
 */
import {
  YIELD_POLL_WASTE_FRACTION,
  boundSuggestion,
  hardBounds,
  stepWindow,
  type AdjustableKnob,
} from "./knobs.ts";
import { LEARN_MESSAGE_PREFIX, noTelemetryAnyPhaseLine, noTelemetryPhaseLine } from "./lines.ts";

/** The multiplier the proposer-timeout suggestion targets above the p90 (F106-FR-012). */
export const TIMEOUT_TARGET_FRACTION = 1.25;

/** The sample floor of both knobs: at least three usable samples (F106-FR-014). */
export const SAMPLE_FLOOR = 3 as const;

/** One row of the advice: what a phase's telemetry says about one knob. */
export type SuggestionRow = {
  readonly knob: AdjustableKnob;
  readonly phase: number;
  /** The samples the engine had; a row with none is no telemetry. */
  readonly samples: number;
  readonly p50: number | null;
  readonly p90: number | null;
  /** The value currently in effect: the replayed decision, else the default. */
  readonly current: number;
  /** The suggested value, or `null` below the floor. */
  readonly value: number | null;
  /** Why no value was suggested; `null` when one was (C-092). */
  readonly reason: string | null;
  readonly bounds: readonly [number, number];
  readonly stepCap: readonly [number, number];
};

/** True when the row may print a suggestion. */
export function hasSuggestion(row: SuggestionRow): boolean {
  return row.value !== null;
}

/** The floor reason of a knob with `n` samples (C-092). */
export function floorReason(knob: AdjustableKnob, n: number): string {
  if (knob === "proposer_timeout") {
    return `fewer than ${SAMPLE_FLOOR} non-futility-killed samples (have ${n})`;
  }
  return `fewer than ${SAMPLE_FLOOR} job-duration samples (have ${n})`;
}

/**
 * The advice of `proposer_timeout` for one phase (F106-FR-012): the samples
 * are the work seconds of the attempts of the phase, and the target is
 * 1.25 × their p90. The summary document of F106-FR-004 carries the figures
 * precomputed (`work_sec_samples`, `work_sec_p50`, `work_sec_p90`); they are
 * handed in here.
 */
export function suggestTimeout(input: {
  readonly phase: number;
  readonly samples: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly current: number;
  readonly defaultTimeout: number;
}): SuggestionRow {
  const samples = input.samples;
  const bounds = hardBounds("proposer_timeout", input.defaultTimeout);
  const stepCap = stepWindow(input.current);
  if (samples < SAMPLE_FLOOR) {
    return {
      knob: "proposer_timeout",
      phase: input.phase,
      samples,
      p50: input.p50,
      p90: input.p90,
      current: input.current,
      value: null,
      reason: floorReason("proposer_timeout", samples),
      bounds,
      stepCap,
    };
  }
  const basis = input.p90 ?? input.p50;
  const target = (basis ?? 0) * TIMEOUT_TARGET_FRACTION;
  return {
    knob: "proposer_timeout",
    phase: input.phase,
    samples,
    p50: input.p50,
    p90: input.p90,
    current: input.current,
    value: boundSuggestion("proposer_timeout", target, input.current, input.defaultTimeout),
    reason: null,
    bounds,
    stepCap,
  };
}

/**
 * The advice of `yield_poll_interval` for one phase (F106-FR-013): the
 * samples are the job durations of the phase, and the target is a tenth of
 * their p50 (`job_duration_samples`, `job_duration_p50`).
 */
export function suggestPoll(input: {
  readonly phase: number;
  readonly samples: number;
  readonly p50: number | null;
  readonly current: number;
}): SuggestionRow {
  const samples = input.samples;
  const bounds = hardBounds("yield_poll_interval", 0);
  const stepCap = stepWindow(input.current);
  if (samples < SAMPLE_FLOOR) {
    return {
      knob: "yield_poll_interval",
      phase: input.phase,
      samples,
      p50: input.p50,
      p90: null,
      current: input.current,
      value: null,
      reason: floorReason("yield_poll_interval", samples),
      bounds,
      stepCap,
    };
  }
  const target = (input.p50 ?? 0) * YIELD_POLL_WASTE_FRACTION;
  return {
    knob: "yield_poll_interval",
    phase: input.phase,
    samples,
    p50: input.p50,
    p90: null,
    current: input.current,
    value: boundSuggestion("yield_poll_interval", target, input.current, 0),
    reason: null,
    bounds,
    stepCap,
  };
}

/** A number in the seconds form the lines print: one decimal, `s` appended. */
export function secondsText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? `${rounded}.0` : String(rounded)}s`;
}

/** The suggestion line of one row (F106-FR-023, F106-FR-026). */
export function suggestionLine(row: SuggestionRow): string {
  if (row.value === null) {
    return (
      `${LEARN_MESSAGE_PREFIX} phase ${row.phase} ${row.knob}: ${row.samples} sample(s) — ` +
      `${row.reason}; no suggestion (need >=${SAMPLE_FLOOR})`
    );
  }
  if (row.knob === "proposer_timeout") {
    return (
      `${LEARN_MESSAGE_PREFIX} phase ${row.phase} proposer_timeout: ${row.samples} sample(s), ` +
      `work p50=${row.p50}s p90=${row.p90}s, current=${secondsText(row.current)} → ` +
      `suggest ${secondsText(row.value)} ` +
      `(bounds=[${row.bounds[0]}, ${row.bounds[1]}], step_cap=[${Math.round(row.stepCap[0])}, ${Math.round(row.stepCap[1])}]) ` +
      "[not applied — run `specstride learn --apply` to take effect]"
    );
  }
  return (
    `${LEARN_MESSAGE_PREFIX} phase ${row.phase} yield_poll_interval: ${row.samples} sample(s), ` +
    `job p50=${row.p50}s, current=${secondsText(row.current)} → ` +
    `suggest ${secondsText(row.value)} ` +
    `(bounds=[${row.bounds[0]}, ${row.bounds[1]}], step_cap=[${Math.round(row.stepCap[0])}, ${Math.round(row.stepCap[1])}]) ` +
    "[not applied — run `specstride learn --apply` to take effect]"
  );
}

/** The advice as a whole: the rows of the phases asked for, their lines, and the exit code. */
export type Advice = {
  readonly rows: readonly SuggestionRow[];
  readonly lines: readonly string[];
  /** A row had at least one sample (the exit is then 0). */
  readonly anyTelemetry: boolean;
  readonly exitCode: 0 | 1;
  /** The standard-error line when the advice found no telemetry (F106-FR-025). */
  readonly stderrLine?: string;
};

/** Options of the advice: which phases, and which knobs. */
export type AdviseOptions = {
  /** The phases to advise, in this order; every phase with telemetry when absent. */
  readonly phases?: readonly number[];
  /** The knobs to advise; `proposer_timeout` alone when absent — the poll engine is asked for with `--knob yield_poll_interval` (the captured advice of FX-29 prints the proposer line only). */
  readonly knobs?: readonly AdjustableKnob[];
  /** Restrict to one phase and report `learn: no telemetry for phase <N>` for it. */
  readonly onlyPhase?: number | undefined;
};

/**
 * The engines over one summary document (F106-FR-004): the phase figures of
 * the summary give the samples, the per-phase `proposer_cap` events the
 * current values through `currentOf`, and the defaults handed in complete
 * what the events did not carry.
 */
export function advise(
  summary: Record<string, unknown>,
  input: {
    readonly currentOf: (knob: AdjustableKnob, phase: number) => number;
    readonly defaultTimeout: number;
    readonly defaultPoll: number;
  },
  options: AdviseOptions = {},
): Advice {
  const phasesDoc = (summary["phases"] ?? {}) as Record<string, Record<string, unknown>>;
  const knobs = options.knobs ?? (["proposer_timeout"] as const);
  const phaseNumbers =
    options.phases ??
    Object.keys(phasesDoc)
      .map(Number)
      .sort((a, b) => a - b);
  const rows: SuggestionRow[] = [];
  for (const phase of phaseNumbers) {
    const rec = phasesDoc[String(phase)];
    for (const knob of knobs) {
      if (knob === "proposer_timeout") {
        rows.push(
          suggestTimeout({
            phase,
            samples: asCount(rec?.["work_sec_samples"]),
            p50: asFigure(rec?.["work_sec_p50"]),
            p90: asFigure(rec?.["work_sec_p90"]),
            current: input.currentOf(knob, phase),
            defaultTimeout: input.defaultTimeout,
          }),
        );
      } else {
        rows.push(
          suggestPoll({
            phase,
            samples: asCount(rec?.["job_duration_samples"]),
            p50: asFigure(rec?.["job_duration_p50"]),
            current: input.currentOf(knob, phase),
          }),
        );
      }
    }
  }
  const lines = rows.map(suggestionLine);
  const anyTelemetry = rows.some((row) => row.samples > 0);
  const stderrLine =
    options.onlyPhase !== undefined && !anyTelemetry
      ? noTelemetryPhaseLine(options.onlyPhase)
      : !anyTelemetry
        ? noTelemetryAnyPhaseLine()
        : null;
  return {
    rows,
    lines,
    anyTelemetry,
    exitCode: anyTelemetry ? 0 : 1,
    ...(stderrLine ? { stderrLine } : {}),
  };
}

/** A sample count read leniently: a missing or malformed figure is 0. */
function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** A percentile figure read leniently: a missing or malformed figure is `null`. */
function asFigure(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
