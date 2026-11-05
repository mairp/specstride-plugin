/**
 * T023 — the share of accounted passes per run (F126-FR-036, F126-SC-001).
 *
 * A pass is accounted for where it ends with complete usage, or with an
 * explicit `usage.unavailable`, or — the killed pass — with its last partial
 * usage and `usageComplete=false` (F126-FR-023). The share of accounted
 * passes is reported per run.
 */

/** How the usage of one pass ended. */
export type PassUsageOutcome =
  /** Every reported value of the pass arrived (`usageComplete=true`). */
  | "complete"
  /** An explicit `usage.unavailable` was carried, with its reason. */
  | "unavailable"
  /** The pass was killed; the last partial usage is kept, `usageComplete=false`. */
  | "killed-partial"
  /** No usage fact was recorded at all: not accounted for. */
  | "unaccounted";

/** The usage outcome of one pass of a run, as the run reports it. */
export type PassUsageOutcomeRecord = {
  readonly passId: string;
  readonly outcome: PassUsageOutcome;
};

/** True where the outcome counts as accounted for (F126-FR-036). */
export function isAccountedOutcome(outcome: PassUsageOutcome): boolean {
  return outcome !== "unaccounted";
}

/** True where the usage facts of a pass count as accounted for. */
export function isAccountedFacts(facts: {
  readonly usageComplete: boolean;
  readonly accounted: boolean;
}): boolean {
  return facts.usageComplete || facts.accounted;
}

/** The share of accounted passes of a run (F126-FR-036). */
export type AccountedShare = {
  readonly accounted: number;
  readonly total: number;
  /** accounted / total, in [0, 1]; null where the run held no pass. */
  readonly share: number | null;
};

/**
 * The share of accounted passes of a run (F126-FR-036): every pass with
 * complete usage or an explicit unavailable — including a killed pass that
 * kept its partial usage with `usageComplete=false` — is accounted for.
 */
export function accountedShare(passes: readonly PassUsageOutcomeRecord[]): AccountedShare {
  const total = passes.length;
  if (total === 0) return { accounted: 0, total: 0, share: null };
  const accounted = passes.filter((p) => isAccountedOutcome(p.outcome)).length;
  return { accounted, total, share: accounted / total };
}
