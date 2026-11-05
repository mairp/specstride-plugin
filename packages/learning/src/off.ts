/**
 * T038 — `off` (F106-FR-017): revert every knob, phase and shape whose latest
 * decision is an `apply`, one `revert` entry and one event each, one
 * `learn: reverted ...` line per reverted decision, or
 * `learn: nothing was applied — already at defaults`. It always ends with the
 * note that the mode `off`, or unset, in the environment of a run is what
 * makes learned values ignored — the command only clears recorded decisions.
 * Exit 0, or 2 when no decision log can be found.
 *
 * Purity: the planners read the entries handed in; the caller holds the
 * writer-domain lock across the deciding read and the appends.
 */
import { entryShape, isDecision, toInt } from "./decision-log.ts";
import { planRevert } from "./revert.ts";
import { utcSeconds } from "./apply.ts";

/** The note every `off` ends with (F106-FR-017; the captured bytes of `FX-29/off`). */
export const OFF_NOTE_LINE =
  "learn: note — SPECSTRIDE_LEARNING=off (or unset) in the run's environment is what actually " +
  "makes `resolve` ignore applied.json; this command only clears the recorded decisions.";

/** The line when nothing is recorded as applied (F106-FR-017). */
export const NOTHING_APPLIED_LINE = "learn: nothing was applied — already at defaults" as const;

/**
 * The keys whose latest decision is an `apply`, in first-seen log order: one
 * revert each (F106-FR-017).
 */
export function offTargets(entries: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const keys: string[] = [];
  const lastByKey = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (!isDecision(e)) continue;
    const knob = String(e["knob"] ?? "");
    const phase = toInt(e["phase"]);
    if (!knob || phase === null) continue;
    const key = `${knob}\u0000${phase}\u0000${entryShape(e) ?? ""}`;
    if (!lastByKey.has(key)) keys.push(key);
    lastByKey.set(key, e);
  }
  const out: Record<string, unknown>[] = [];
  for (const key of keys) {
    const last = lastByKey.get(key)!;
    if (last["action"] === "apply") out.push(last);
  }
  return out;
}

export type OffPlan = {
  readonly refused: false;
  readonly targets: Record<string, unknown>[];
  /** One plan per target, aligned with `targets`. */
  readonly reverts: ReturnType<typeof planRevert>[];
  readonly lines: readonly string[];
};

/**
 * Plan the whole `off`: one revert per target, the revert run id shared by
 * the batch, in the log order of the targets (F106-FR-017).
 */
export function planOff(input: {
  readonly entries: readonly Record<string, unknown>[];
  readonly runId: string;
  readonly appliedAt?: string;
}): OffPlan {
  const targets = offTargets(input.entries);
  const reverts = targets.map((t) =>
    planRevert({
      entries: input.entries,
      runId: String(t["run_id"] ?? ""),
      revertRunId: input.runId,
      appliedAt: input.appliedAt ?? utcSeconds(),
    }),
  );
  const lines = reverts
    .filter((r): r is Extract<typeof r, { refused: false }> => !r.refused)
    .map((r) => r.line);
  return {
    refused: false,
    targets,
    reverts,
    lines: targets.length ? lines : [NOTHING_APPLIED_LINE],
  };
}
