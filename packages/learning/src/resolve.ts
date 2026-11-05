/**
 * T027 — `resolve`: the value and the arm of one knob for one phase at the
 * start of a pass (F106-FR-010, F106-FR-011), behind the plain function
 * interface of F100-FR-235 (`LEARNING_OPERATIONS.resolve` of
 * `@specstride/contracts`, whose `ResolvedKnob` this module's result is
 * shaped as: `value`, `arm`, `decisionId`, plus the provenance the doctor
 * reports).
 *
 * A value is a learned one ONLY when the mode is exactly `apply` and the
 * latest bound decision for (knob, phase, shape) is an `apply` entry; that
 * value is clamped into the hard bounds at read time and returned as a whole
 * number. Otherwise the value is the default handed in, the arm is
 * `baseline`, and the decision log is NOT opened. The arm is `applied` even
 * when the learned value equals the default (B-1325). Under any other mode,
 * and at every failure, the run stays on the value it would have had without
 * learning (F100-FR-235).
 *
 * The replay of F106-FR-011 is a different read: `advise` and `apply` read
 * the replayed value (a revert's recorded value too) as the current value —
 * `decision-log.ts`'s `effectiveValue` is that read, and the verb uses it.
 * The RUN-time read is this one: after a revert a run uses the default handed
 * in, whatever the revert recorded.
 *
 * The two read sites of a learned value (F106-FR-003) are the assembly of the
 * pass limit (`packages/core/src/pass-supervision/watchdogs/hard-cap.ts`) and
 * the poll interval of a detached job
 * (`packages/core/src/pass-supervision/yield/settings.ts`); the read sites are
 * locked by CT-106-1 (`tests/characterization/106/read-sites.test.ts`), which
 * fails when another place reads a learned value.
 *
 * Purity: the decision log is read through the lenient reader of
 * `decision-log.ts` only when the mode asks for it; the environment and the
 * clock are handed in, never read here.
 */
import { clampToBounds, isAdjustableKnob, type AdjustableKnob } from "./knobs.ts";
import type { LearningMode } from "./mode.ts";
import { decisionsFor } from "./decision-log.ts";
import { readDecisionEntries } from "./events-reader.ts";

/** The inputs of one resolution. */
export type ResolveRequest = {
  /** The knob; a name outside the allowlist is refused before the log is touched. */
  readonly knob: AdjustableKnob;
  readonly phase: number;
  /** The phase shape the pass runs under; `null` when the run is shape-less. */
  readonly shape?: string | null;
  /** The default handed in, which the run uses when no learned value is in force. */
  readonly defaultValue: number;
  /** The resolved learning mode (F106-FR-009): only `apply` lets a value take effect. */
  readonly mode: LearningMode;
  /** The bound learning.through of the launch contract, when one is bound. */
  readonly through?: string | null;
  /** The entries to replay, already read; given, the log file is not opened. */
  readonly entries?: readonly Record<string, unknown>[];
  /** The path of the decision log, read only when `mode` is `apply` and no entries were handed in. */
  readonly logPath?: string | undefined;
};

/** What one resolution returns (the `ResolvedKnob` of the interface, and the provenance). */
export type ResolvedKnobValue = {
  /** The value the run uses for the knob, a whole number of seconds. */
  readonly value: number;
  /** `applied` when a learned decision is in force, `baseline` otherwise (F106-FR-010). */
  readonly arm: "applied" | "baseline";
  /** The run id of the decision the value came from, where it did (the `decisionId` of the interface). */
  readonly decisionId: string | null;
  /** The source of the value: `learned` per applied value, else the source of the rank that gave it. */
  readonly source: string;
  /** The replayed value before clamping, where a decision was in force. */
  readonly replayed: number | null;
  /** True when clamping moved a replayed value into the hard bounds at read time (F106-FR-010). */
  readonly clamped: boolean;
};

/** The source the value carries when it is not learned: the rank that handed the default in. */
export const BASELINE_SOURCE = "default" as const;

/**
 * Resolve the value and the arm of one knob for one phase (F106-FR-010). A
 * knob outside the allowlist throws before anything is read: the allowlist is
 * locked, and a learned value can exist only for its members.
 */
export function resolve(request: ResolveRequest): ResolvedKnobValue {
  if (!isAdjustableKnob(request.knob)) {
    throw new TypeError(
      `resolve: '${request.knob}' is not an adjustable knob of learning (F106-FR-001)`,
    );
  }

  // Not `apply`: the run stays on the default, and the decision log is NOT opened.
  if (request.mode !== "apply") {
    return {
      value: request.defaultValue,
      arm: "baseline",
      decisionId: null,
      source: BASELINE_SOURCE,
      replayed: null,
      clamped: false,
    };
  }

  const entries =
    request.entries ?? (request.logPath !== undefined ? readDecisionEntries(request.logPath) : []);
  const list = decisionsFor(
    entries,
    request.knob,
    request.phase,
    request.shape ?? null,
    request.through ?? null,
  );
  const last = list[list.length - 1];
  if (!last || last["action"] !== "apply") {
    // A revert last, or no decision at all: the run uses the default handed in
    // (F106-FR-011), whatever value the revert recorded.
    return {
      value: request.defaultValue,
      arm: "baseline",
      decisionId: null,
      source: BASELINE_SOURCE,
      replayed: null,
      clamped: false,
    };
  }

  const replayed = typeof last["value"] === "number" ? last["value"] : null;
  if (replayed === null) {
    return {
      value: request.defaultValue,
      arm: "baseline",
      decisionId: null,
      source: BASELINE_SOURCE,
      replayed: null,
      clamped: false,
    };
  }
  // Clamping moves a value into the hard bounds; rounding a whole number of
  // seconds is not a clamp, so `clamped` is decided BEFORE the rounding
  // (F106-FR-010).
  const bounded = clampToBounds(replayed, request.knob, request.defaultValue);
  const value = Math.round(bounded);
  return {
    value,
    arm: "applied",
    decisionId: typeof last["run_id"] === "string" ? last["run_id"] : null,
    source: "learned",
    replayed,
    clamped: bounded !== replayed,
  };
}
