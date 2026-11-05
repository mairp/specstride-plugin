/**
 * T027 of feature 118 — the kill reasons and their classes
 * (F118-FR-007; closed set row 10 of annex X §X.6, owner 118; C-055).
 *
 * The family and the classes are the literals of the baseline: `idle_timeout`
 * (class `hang`), `repeat_stall` and `progress_stall` (class `futility`) and
 * `hard_cap` (class `budget`). A reason outside the family is classed
 * `futility` — the behaviour the baseline shows for an unknown reason
 * (research decision 3, B-0606).
 *
 * The registered set in `@specstride/contracts`
 * (`packages/contracts/src/codes/stop-reason-literals.ts`) is generated from
 * the same row of the annex; this module keeps its own literal table so the
 * watchdogs stay a pure module, and the parity tests cross-check the two.
 */

/** The members of the closed family of kill reasons (row 10). */
export const KILL_REASONS = ["idle_timeout", "repeat_stall", "progress_stall", "hard_cap"] as const;

/** One kill reason of row 10 of annex X §X.6. */
export type KillReason = (typeof KILL_REASONS)[number];

/** The classes a kill reason can carry. */
export type KillClass = "hang" | "futility" | "budget";

/** The class of every member of the family, as the baseline writes them. */
export const KILL_REASON_CLASS: Readonly<Record<KillReason, KillClass>> = Object.freeze({
  idle_timeout: "hang",
  repeat_stall: "futility",
  progress_stall: "futility",
  hard_cap: "budget",
});

/** True when `reason` is a member of the closed family. */
export function isKnownKillReason(reason: string): reason is KillReason {
  return (KILL_REASONS as readonly string[]).includes(reason);
}

/**
 * The class of a kill reason. A reason outside the family is classed
 * `futility` (F118-FR-007); nothing throws and no class is invented.
 */
export function classOfKillReason(reason: string): KillClass {
  return isKnownKillReason(reason) ? KILL_REASON_CLASS[reason] : "futility";
}

/** The reason and the class of one watchdog kill, as the events carry them. */
export interface KillClassification {
  readonly reason: KillReason;
  readonly class: KillClass;
}

/** Classify a reason of the family into its `{reason, class}` pair. */
export function classifyKill(reason: KillReason): KillClassification {
  return { reason, class: classOfKillReason(reason) };
}
