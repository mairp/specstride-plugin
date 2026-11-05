/**
 * T120 — the record of every check and the per-phase time report
 * (F115-FR-064).
 *
 * "Every run MUST record each check with the id of its command, its duration
 * and its result, and MUST report per phase the share of time spent in inner
 * checks and the time spent on fingerprints."
 *
 * What the module owns:
 *
 * - `CheckRecord` — one entry per command run of one check: the command id,
 *   the duration in milliseconds, and the result (`pass` or a failure or
 *   condition kind). Nothing else: no output, no note (an event holds no
 *   output; the record here is the same fact at the granularity the paired
 *   design consumes).
 * - `recordCheck` — appends the records of one check to the run log, with
 *   the phase and the ordinal of the check (inner or closing), so a report
 *   can be cut per phase.
 * - `phaseTimeReport` — the per-phase report: the time spent in inner
 *   checks, the time spent on fingerprints, the share of the phase's
 *   measured time each of the two is, and the per-command roll-up. This is
 *   the row the paired runner of the experiment kit
 *   (`experiments/115/paired/runner.ts`) carries for every arm.
 *
 * Killed time is carried, not hidden: a check that an exclusion (slow,
 * budget) or an interruption ended still records its duration, marked by its
 * result, so the experiment sees the time it cost (F115-FR-064 pairs with
 * F115-FR-065, where every pass ended by a time limit or a watchdog counts
 * as killed, with hours beside the count).
 *
 * Purity: imports nothing; the layer holds logic only (research.md D-1).
 * The caller — the engine between passes — owns the clock and the read-only
 * view; this module only adds and sums.
 */

/** The result of one command run, as the check runner reports it. */
export type CheckResult =
  "pass" | "fail" | "tainted" | "cached" | "flaky" | "interrupted" | "unchecked";

/** Whether the check the command belongs to was an inner check or the closing check. */
export type CheckKind = "inner" | "closing";

/** One recorded command run of a check (F115-FR-064: id, duration, result). */
export interface CheckRecord {
  /** The id of the command in the check manifest of the phase. */
  readonly commandId: string;
  /** The duration of the command run, in milliseconds, as the runner measured it. */
  readonly durationMs: number;
  /** The result of the run, as the check runner delivered it. */
  readonly result: CheckResult;
}

/** One check of the run: the phase, the ordinal, and the commands it ran. */
export interface CheckEntry {
  /** The number of the phase attempt the check belongs to. */
  readonly phase: number;
  /** The ordinal of the check within the phase attempt, starting at 1. */
  readonly ordinal: number;
  /** Inner check or closing check. */
  readonly kind: CheckKind;
  /** The records of the command runs of the check, in manifest order. */
  readonly commands: readonly CheckRecord[];
}

/** The log of checks of a run, as this feature records it. */
export type CheckLog = readonly CheckEntry[];

/** A guard: the results a record may carry. */
export const CHECK_RESULTS: readonly CheckResult[] = [
  "pass",
  "fail",
  "tainted",
  "cached",
  "flaky",
  "interrupted",
  "unchecked",
];

/**
 * Record one check: every command with its id, its duration and its result.
 * Returns a new log with the entry appended; the given log is not changed.
 * A command without a duration, a negative duration, or a result outside
 * `CHECK_RESULTS` is refused, never silently recorded.
 */
export function recordCheck(
  log: CheckLog,
  entry: {
    phase: number;
    ordinal: number;
    kind: CheckKind;
    commands: readonly CheckRecord[];
  },
): CheckLog {
  if (!Number.isInteger(entry.phase) || entry.phase < 1) {
    throw new Error(`recordCheck: phase must be a whole number of at least 1, got ${entry.phase}`);
  }
  if (!Number.isInteger(entry.ordinal) || entry.ordinal < 1) {
    throw new Error(
      `recordCheck: ordinal must be a whole number of at least 1, got ${entry.ordinal}`,
    );
  }
  if (entry.kind !== "inner" && entry.kind !== "closing") {
    throw new Error(`recordCheck: kind must be "inner" or "closing", got ${String(entry.kind)}`);
  }
  if (!Array.isArray(entry.commands) || entry.commands.length === 0) {
    throw new Error("recordCheck: a check records at least one command run");
  }
  for (const command of entry.commands) {
    if (typeof command.commandId !== "string" || command.commandId === "") {
      throw new Error("recordCheck: every command needs a non-empty command id");
    }
    if (!Number.isFinite(command.durationMs) || command.durationMs < 0) {
      throw new Error(
        `recordCheck: duration of ${command.commandId} must be a non-negative number of ms`,
      );
    }
    if (!CHECK_RESULTS.includes(command.result)) {
      throw new Error(
        `recordCheck: result of ${command.commandId} must be one of ${CHECK_RESULTS.join(", ")}`,
      );
    }
  }
  const next: CheckEntry = {
    phase: entry.phase,
    ordinal: entry.ordinal,
    kind: entry.kind,
    commands: entry.commands.map((c) => ({ ...c })),
  };
  return [...log, next];
}

/** One per-command roll-up row of the phase report. */
export interface CommandRollup {
  readonly commandId: string;
  /** How many times the command ran in the phase. */
  readonly runs: number;
  /** The sum of the durations of its runs, in milliseconds. */
  readonly durationMs: number;
  /** How many of its runs ended `pass`. */
  readonly passes: number;
}

/** The per-phase report of F115-FR-064. */
export interface PhaseTimeReport {
  readonly phase: number;
  /** The checks recorded for the phase. */
  readonly checks: number;
  /** The command runs recorded for the phase. */
  readonly commandRuns: number;
  /** Time spent in inner checks, in milliseconds. */
  readonly innerCheckMs: number;
  /** Time spent on the closing check, in milliseconds. */
  readonly closingCheckMs: number;
  /** Time spent on fingerprints (before and after every check), in milliseconds. */
  readonly fingerprintMs: number;
  /** Share of `measuredMs` spent in inner checks, 0..1 (0 when nothing was measured). */
  readonly innerCheckShare: number;
  /** Share of `measuredMs` spent on fingerprints, 0..1 (0 when nothing was measured). */
  readonly fingerprintShare: number;
  /** The measured time of the phase the two shares are cut from, in milliseconds. */
  readonly measuredMs: number;
  /** Per-command roll-up, in first-seen order. */
  readonly byCommand: readonly CommandRollup[];
}

/**
 * Report the per-phase times: inner-check time, fingerprint time, their
 * shares of the measured time of the phase, and the per-command roll-up.
 * `fingerprintMs` and `measuredMs` come from the engine (the read-only view
 * of the phase attempt); the check times come from this feature's log.
 */
export function phaseTimeReport(
  log: CheckLog,
  phase: number,
  fingerprintMs: number,
  measuredMs: number,
): PhaseTimeReport {
  if (!Number.isFinite(fingerprintMs) || fingerprintMs < 0) {
    throw new Error(`phaseTimeReport: fingerprintMs must be non-negative, got ${fingerprintMs}`);
  }
  if (!Number.isFinite(measuredMs) || measuredMs < 0) {
    throw new Error(`phaseTimeReport: measuredMs must be non-negative, got ${measuredMs}`);
  }
  const entries = log.filter((e) => e.phase === phase);
  let innerCheckMs = 0;
  let closingCheckMs = 0;
  let commandRuns = 0;
  const rollups = new Map<string, CommandRollup>();
  for (const entry of entries) {
    let checkMs = 0;
    for (const command of entry.commands) {
      checkMs += command.durationMs;
      commandRuns += 1;
      const seen = rollups.get(command.commandId);
      rollups.set(
        command.commandId,
        seen
          ? {
              commandId: command.commandId,
              runs: seen.runs + 1,
              durationMs: seen.durationMs + command.durationMs,
              passes: seen.passes + (command.result === "pass" ? 1 : 0),
            }
          : {
              commandId: command.commandId,
              runs: 1,
              durationMs: command.durationMs,
              passes: command.result === "pass" ? 1 : 0,
            },
      );
    }
    if (entry.kind === "inner") innerCheckMs += checkMs;
    else closingCheckMs += checkMs;
  }
  const share = (ms: number) => (measuredMs > 0 ? ms / measuredMs : 0);
  return {
    phase,
    checks: entries.length,
    commandRuns,
    innerCheckMs,
    closingCheckMs,
    fingerprintMs,
    innerCheckShare: share(innerCheckMs),
    fingerprintShare: share(fingerprintMs),
    measuredMs,
    byCommand: [...rollups.values()],
  };
}
