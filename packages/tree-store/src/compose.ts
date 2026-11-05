/**
 * T039 — the operation `compose` of the tree store: COMPOSE DISJOINT DELTAS IN
 * TASK ORDER; REFUSE A SHARED PATH WITH `overlap` (annex D §D.2, row 4;
 * F143-FR-019; research.md D-1).
 *
 * COMPOSITION REPLACES MERGE, and that is a decision about safety and not
 * about convenience (R29v V-10, which amends R29 PU-47). A content merge would
 * start a merge driver, detect renames and depend on the order in which
 * workers happened to finish; all three are ways for the result to depend on
 * something no one audited. So:
 *
 *   the integrated tree is THE BASE in which each path of an accepted delta
 *   holds the content of the final snapshot of that worker.
 *
 * Nothing is merged, nothing is three-way, no model takes part. A path is
 * REPLACED, or DELETED where the worker deleted it, and every other entry of
 * the base is carried over untouched.
 *
 * DISJOINTNESS IS THE WHOLE PRECONDITION. Because a path is replaced outright,
 * two deltas that name the same path cannot both be honoured, and the one that
 * loses would lose silently. So the path sets of accepted deltas must be
 * pairwise disjoint, and a delta that shares a path with an EARLIER ONE IN THE
 * ORDER OF THE TASKS AT LAUNCH is refused with the reason `overlap`. The order
 * is the order of the tasks at launch and never the order of completion, so a
 * group gives the same result however its workers raced: the refusal names a
 * worker that the plan, and not the clock, decided.
 *
 * `firstOverlap` of `@specstride/contracts/ep/tree-store` is the one place that
 * finds the overlap, so the engine, the loop layer and this operation cannot
 * disagree about which worker is refused (F100-FR-122).
 *
 * THE RESULT IS DETERMINISTIC. The entries are written out sorted by path
 * (`writeTreeFromEntries` of `git.ts`), so two runs that accept the same
 * deltas give the same tree id.
 */
import {
  COMPOSE_REFUSAL_REASON,
  firstOverlap,
  type AuditedDelta,
  type ComposeResult,
} from "@specstride/contracts/ep/tree-store";
import {
  listTree,
  treeByPath,
  writeTreeFromEntries,
  type StorePlaces,
  type StoreTreeEntry,
} from "./git.ts";

/** F143-FR-019 — no content is ever merged. */
export const CONTENT_IS_MERGED = false as const;

/** F143-FR-019 — the order of completion has no effect. */
export const THE_ORDER_OF_COMPLETION_HAS_AN_EFFECT = false as const;

/** F143-FR-019 — the order that decides a refusal is the order of the tasks at launch. */
export const THE_ORDER_THAT_DECIDES = "the order of the tasks at launch" as const;

/**
 * The entries of the composed tree: the base, with each path of each delta
 * replaced by the entry of that worker's final snapshot, or removed where the
 * worker removed it. Exposed on its own so that the write-ahead record of the
 * application can name every path with its base and composed object id before
 * one byte of the workspace is written (F143-FR-020).
 */
export function composedEntries(
  places: StorePlaces,
  baseTreeId: string,
  deltas: readonly AuditedDelta[],
): ReadonlyMap<string, StoreTreeEntry> {
  const entries = new Map<string, StoreTreeEntry>();
  for (const entry of listTree(places, baseTreeId)) entries.set(entry.path, entry);
  for (const delta of deltas) {
    const theirs = treeByPath(places, delta.treeId);
    for (const path of delta.paths) {
      const entry = theirs.get(path);
      // Absent from the worker's final snapshot: the worker deleted it.
      if (entry === undefined) entries.delete(path);
      else entries.set(path, entry);
    }
  }
  return entries;
}

/**
 * F143-FR-019 — compose the audited deltas onto the base. Gives the tree id of
 * the composed tree, or the refusal `overlap` with the shared paths and the
 * worker whose delta is refused.
 */
export function compose(
  places: StorePlaces,
  baseTreeId: string,
  deltas: readonly AuditedDelta[],
): ComposeResult {
  const overlap = firstOverlap(deltas);
  if (overlap !== undefined) {
    return Object.freeze({
      composed: false as const,
      reason: COMPOSE_REFUSAL_REASON,
      paths: overlap.paths,
      workerId: overlap.workerId,
    });
  }
  return Object.freeze({
    composed: true as const,
    treeId: writeTreeFromEntries(places, composedEntries(places, baseTreeId, deltas).values()),
  });
}
