/**
 * T038 — `revert <run id>` (F106-FR-016): undo exactly one earlier `apply`,
 * restoring the value that was current before it, by a new `revert` entry and
 * one `learning.knob_adjusted` event with the reason `revert`.
 *
 * Only the entry that is currently on top of its knob, phase and shape may be
 * reverted; any other is refused with exit 2 and nothing written:
 *  - `run_id '<id>' is not the active decision for <knob>[<phase>] — nothing to revert`
 *  - `no applied entry with run_id '<id>'`
 *
 * A manual revert carries no `auto`; its members are, in order: `schema`,
 * `action`, `run_id`, `reverts_run_id`, `knob`, `phase`, `shape`, `value`,
 * `previous`, `applied_at` (data-model.md; the automatic form and its
 * extra members are the later automatic-revert work).
 *
 * Purity: the planners read the entries handed in; the caller holds the
 * writer-domain lock across the deciding read and the appends.
 */
import { entryShape, isDecision, LEARN_APPLIED_SCHEMA, toInt } from "./decision-log.ts";
import { knobAdjustedAsisLine, knobAdjustedMembersForRevert } from "./stream.ts";
import { revertedLine } from "./lines.ts";
import { utcSeconds } from "./apply.ts";

/** An `apply` entry, as the log holds it. */
export type ApplyEntry = Record<string, unknown>;

/** True when the entry is an `apply` (a decision this verb may undo). */
export function isApplyEntry(entry: Record<string, unknown>): boolean {
  return isDecision(entry) && entry["action"] === "apply";
}

/** The `apply` entries with the given run id, in log order. */
export function appliedEntriesWithRunId(
  entries: readonly Record<string, unknown>[],
  runId: string,
): ApplyEntry[] {
  return entries.filter((e) => isApplyEntry(e) && e["run_id"] === runId);
}

/** The last decision for one key: knob, phase and shape (F106-FR-010, F106-FR-011). */
export function lastDecisionFor(
  entries: readonly Record<string, unknown>[],
  knob: string,
  phase: number,
  shape: string | null,
  bound?: string | null,
): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (const e of entries) {
    if (!isDecision(e)) continue;
    if (e["knob"] !== knob || toInt(e["phase"]) !== phase) continue;
    if ((entryShape(e) ?? null) !== (shape ?? null)) continue;
    if (bound && e["run_id"] === bound) break; // applies after the bound are ignored, reverts after it count
    last = e;
  }
  return last;
}

/** The message when the id names no `apply` at all (F106-FR-016, exit 2). */
export function noAppliedEntryMessage(runId: string): string {
  return `no applied entry with run_id '${runId}'`;
}

/** The message when the id names an `apply` that is not on top of its key (exit 2). */
export function notActiveDecisionMessage(runId: string, knob: string, phase: number): string {
  return `run_id '${runId}' is not the active decision for ${knob}[${phase}] — nothing to revert`;
}

export type RevertRefusal = {
  readonly refused: true;
  readonly message: string;
  readonly exit: 2;
};
export type RevertPlan = {
  readonly refused: false;
  /** The `apply` entry being undone. */
  readonly applyEntry: ApplyEntry;
  /** The new `revert` entry to append. */
  readonly entry: Record<string, unknown>;
  /** The as-is line of the `learning.knob_adjusted` event of the revert. */
  readonly eventLine: string;
  /** The line the command prints (F106-FR-026). */
  readonly line: string;
};

/** Build the `revert` entry that undoes one `apply`. */
export function buildRevertEntry(input: {
  readonly applyEntry: ApplyEntry;
  readonly runId: string;
  readonly value: number;
  readonly previous: number;
  readonly appliedAt: string;
}): Record<string, unknown> {
  const a = input.applyEntry;
  return {
    schema: LEARN_APPLIED_SCHEMA,
    action: "revert",
    run_id: input.runId,
    reverts_run_id: a["run_id"],
    knob: a["knob"],
    phase: a["phase"],
    shape: a["shape"] ?? null,
    value: input.value,
    previous: input.previous,
    applied_at: input.appliedAt,
  };
}

/**
 * Plan the revert of one earlier `apply` (F106-FR-016): the value restored is
 * the value that was current before the apply (its `previous`), the new
 * current is the value the apply wrote.
 */
export function planRevert(input: {
  readonly entries: readonly Record<string, unknown>[];
  readonly runId: string;
  readonly revertRunId: string;
  readonly appliedAt?: string;
}): RevertRefusal | RevertPlan {
  const { entries, runId, revertRunId } = input;
  const matches = appliedEntriesWithRunId(entries, runId);
  if (matches.length === 0) {
    return { refused: true, message: noAppliedEntryMessage(runId), exit: 2 };
  }
  const applyEntry = matches[matches.length - 1]!;
  const knob = String(applyEntry["knob"]);
  const phase = toInt(applyEntry["phase"]) ?? 0;
  const shape = entryShape(applyEntry);
  const top = lastDecisionFor(entries, knob, phase, shape);
  if (!top || top["run_id"] !== runId) {
    return { refused: true, message: notActiveDecisionMessage(runId, knob, phase), exit: 2 };
  }
  const value = typeof applyEntry["previous"] === "number" ? applyEntry["previous"] : 0;
  const previous = typeof applyEntry["value"] === "number" ? applyEntry["value"] : 0;
  const entry = buildRevertEntry({
    applyEntry,
    runId: revertRunId,
    value,
    previous,
    appliedAt: input.appliedAt ?? utcSeconds(),
  });
  return {
    refused: false,
    applyEntry,
    entry,
    eventLine: knobAdjustedAsisLine(
      knobAdjustedMembersForRevert({
        knob,
        phase,
        from: previous,
        to: value,
        reason: "revert",
        samples: null,
        metric: null,
        runId: revertRunId,
        revertsRunId: runId,
      }),
    ),
    line: revertedLine({ runId, knob, phase, value }),
  };
}
