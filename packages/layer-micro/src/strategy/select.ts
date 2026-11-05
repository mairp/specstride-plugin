/**
 * T092 — the selection of the loop strategy at launch, its record per run
 * and per phase attempt, and the replay on resume (F115-FR-001; IR-27).
 *
 * The strategy is a switch of the closed set `classic, micro` (annex X §X.6
 * row 55) with `micro` as the default. The strategy, the micro level and the
 * hash of each check manifest are chosen ONCE at launch, written to the run
 * record and the run snapshot, recorded per phase attempt, and left
 * unchanged by a resume or a relaunch. A resume that finds another
 * configured strategy uses the recorded one and prints a warning.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process
 * (F100-FR-012; research.md D-1).
 */
import { epVerificationSource } from "@specstride/contracts";

/** The closed set of loop strategies (row 55); `micro` is the default. */
export const LOOP_STRATEGIES = ["classic", "micro"] as const;
export type LoopStrategy = (typeof LOOP_STRATEGIES)[number];

/** F115-FR-001 — `micro` is the default strategy. */
export const DEFAULT_STRATEGY: LoopStrategy = "micro";

/** The micro level chosen at launch (Wave 1: L1, row 56). */
export const LAUNCH_LEVEL = "L1" as const;

/** The verification modes whose gate does not execute (F115-FR-004). */
const GATELESS_MODES: readonly string[] = ["plan", "off"];

/** A value is a strategy of the closed set, or the run has a configuration error. */
export function isLoopStrategy(value: unknown): value is LoopStrategy {
  return typeof value === "string" && (LOOP_STRATEGIES as readonly string[]).includes(value);
}

/** The run record field `loop`, as this feature defines its content. */
export type StrategyRecord = {
  readonly runId: string;
  /** The strategy pinned at launch. */
  readonly strategy: LoopStrategy;
  /** The micro level pinned at launch (irrelevant when the strategy is `classic`). */
  readonly level: typeof LAUNCH_LEVEL;
  /** The hash of each check manifest, chosen at launch, keyed by phase. */
  readonly manifestHashes: Readonly<Record<string, string>>;
  /** Whether the strategy came from the configuration or from the default. */
  readonly source: "configured" | "default";
  /** Whether a resume replayed this record over another configured strategy. */
  readonly replayedOnResume: boolean;
};

/**
 * F115-FR-001 — the selection at launch. The verification mode is part of
 * the launch read (a gateless mode falls back later, F115-FR-004), but the
 * strategy itself does not depend on it: the strategy is pinned from the
 * configuration, else the default.
 */
export function selectStrategyAtLaunch(input: {
  readonly runId: string;
  /** The configured strategy, when the configuration names one. */
  readonly configured?: unknown;
  /** Hash of the check manifest of each phase, as read at launch. */
  readonly manifestHashes?: Readonly<Record<string, string>>;
}):
  | { readonly ok: true; readonly record: StrategyRecord }
  | {
      readonly ok: false;
      readonly error: "configuration-error";
      readonly value: unknown;
    } {
  if (input.configured === undefined) {
    return {
      ok: true,
      record: {
        runId: input.runId,
        strategy: DEFAULT_STRATEGY,
        level: LAUNCH_LEVEL,
        manifestHashes: input.manifestHashes ?? {},
        source: "default",
        replayedOnResume: false,
      },
    };
  }
  if (!isLoopStrategy(input.configured)) {
    // Unknown value of a closed set (row 55): a configuration error.
    return { ok: false, error: "configuration-error", value: input.configured };
  }
  return {
    ok: true,
    record: {
      runId: input.runId,
      strategy: input.configured,
      level: LAUNCH_LEVEL,
      manifestHashes: input.manifestHashes ?? {},
      source: "configured",
      replayedOnResume: false,
    },
  };
}

/** The per-phase-attempt record of the strategy in force. */
export type AttemptStrategyRecord = {
  readonly phase: number;
  readonly attempt: number;
  /** The strategy pinned at launch, unchanged by the attempt. */
  readonly strategy: LoopStrategy;
  /** The reason the classic loop is in force, when it is. */
  readonly fallbackReason?: string;
};

/** F115-FR-001 — the strategy is recorded per phase attempt from the run record. */
export function recordStrategyForAttempt(
  record: StrategyRecord,
  phase: number,
  attempt: number,
  fallbackReason?: string,
): AttemptStrategyRecord {
  return {
    phase,
    attempt,
    strategy: record.strategy,
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}

/** What the replay on resume produces (F115-FR-001). */
export type StrategyReplay = {
  /** The strategy in force after the resume: the recorded one. */
  readonly strategy: LoopStrategy;
  /** The record replayed, byte-stable in its pinned fields. */
  readonly record: StrategyRecord;
  /** The warning printed when the configuration now names another strategy. */
  readonly warning?: string;
};

/**
 * F115-FR-001 — a resume or a relaunch replays the recorded strategy. A
 * resume that finds another configured strategy uses the recorded one and
 * prints a warning. No recorded record means the run never launched with
 * this feature, and the caller falls back to the selection at launch.
 */
export function replayStrategyOnResume(input: {
  readonly recorded: StrategyRecord;
  /** The strategy the configuration names at resume time. */
  readonly configured?: unknown;
}): StrategyReplay | undefined {
  const recorded = input.recorded;
  if (input.configured === undefined || input.configured === recorded.strategy) {
    return { strategy: recorded.strategy, record: recorded };
  }
  if (!isLoopStrategy(input.configured)) {
    // An unknown value is a configuration error of the configuration in
    // force, not of the pinned record; the record still applies.
    return {
      strategy: recorded.strategy,
      record: recorded,
      warning:
        `strategy pinned at launch as ${recorded.strategy}; the configured value ` +
        `${String(input.configured)} is not a member of the closed set and is ignored`,
    };
  }
  return {
    strategy: recorded.strategy,
    record: recorded,
    warning:
      `strategy pinned at launch as ${recorded.strategy}; ` +
      `the configured ${input.configured} does not apply to this run`,
  };
}

/** True when the verification gate of the mode does not execute (F115-FR-004). */
export function gateDoesNotExecute(mode: string): boolean {
  return (
    GATELESS_MODES.includes(mode) &&
    (epVerificationSource.VERIFICATION_MODES as readonly string[]).includes(mode)
  );
}
