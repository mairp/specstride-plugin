/**
 * T073 — the operation `changed` of the tree store: THE DELTA BETWEEN TWO
 * TREE IDS, BY NAME AND STATUS, FROM THE FILES ONLY, WITH NO RENAME DETECTED
 * (annex D §D.2, row 3; F143-FR-006, F143-FR-019).
 *
 * `changed(base, tree) → paths with kind`. Three properties, and each one is a
 * requirement rather than a detail of taste:
 *
 *  1 FROM THE FILES ONLY. A worker may commit in its own tree, reset it or
 *    stash in it; F143-FR-006 says those acts have NO EFFECT, because the
 *    delta is taken from the files. This operation is given TWO TREE IDS of
 *    the store — the base snapshot and the worker's FINAL snapshot — and
 *    never a reference, a branch or a commit range of the worker's
 *    repository. `diff-tree` between two trees cannot see a history, so the
 *    property holds by the shape of the call and not by a promise.
 *
 *  2 NO RENAME DETECTED. `--no-renames` is passed, and `diff.renames` cannot
 *    turn it back on because the fixed settings travel on the command line
 *    after it. A move therefore appears as an addition and a deletion, which
 *    is what composition needs: a rename is a pair of paths, and a pair of
 *    paths cannot be checked for disjointness against another worker's delta
 *    the way a plain path set can (F143-FR-019, research.md D-1).
 *
 *  3 BY NAME AND STATUS. The four kinds of annex D §D.2 are `added`,
 *    `changed`, `deleted` and `mode changed`, and no other. `--raw` carries
 *    the old and the new mode beside the status letter, which is the only way
 *    to tell `mode changed` from `changed`: git reports both as `M`, and they
 *    differ in that the object id is equal and the mode is not.
 *
 * WHAT A DELTA NEVER HOLDS. Three sets of paths are dropped here, each by a
 * requirement of its own:
 *
 *  - THE WORKSPACE PART (F143-FR-003), which is in no snapshot at all, so it
 *    cannot appear; the filter is kept as a belt rather than a brace.
 *  - A SEED PATH, and anything under one (F143-FR-007). A seed path is copied
 *    into every worker tree before the pass, so it is present in the final
 *    snapshot and absent from the base, and would otherwise read as an
 *    addition by every worker at once — the worst possible shape, since every
 *    pair of workers would then overlap.
 *  - THE TASK LIST (F143-FR-008). It is in every snapshot, so that a worker
 *    can read its own task, and in no delta, so that a change a worker made
 *    to it is dropped: a tick remains the claim of the worker and is applied
 *    by the runtime through the spec-format adapter (F143-FR-021).
 *
 * An IGNORED path needs no filter: it is absent from both snapshots, because
 * `fingerprintScope` excludes it from each, and a final snapshot uses the
 * ignore rules of the base (F143-FR-007, F143-FR-003).
 */
import {
  CHANGE_KINDS,
  type ChangeKind,
  type ChangedPath,
} from "@specstride/contracts/ep/tree-store";
import { inStore, type StorePlaces } from "./git.ts";
import { isWorkspacePart } from "./snapshot.ts";

/** The flag that stops a rename being detected (F143-FR-019). */
export const NO_RENAMES = "--no-renames" as const;

/** The four kinds a changed path may carry, and no other (annex D, §D.2). */
export const KINDS: readonly ChangeKind[] = CHANGE_KINDS;

/** What a delta never holds, beyond the workspace part (F143-FR-007, F143-FR-008). */
export type DeltaExclusions = {
  /** Seed paths; a path under one is dropped as well. */
  readonly seedPaths?: readonly string[];
  /** The task list, by its path in the workspace. */
  readonly taskListPath?: string;
};

/**
 * True where the path is dropped from every delta: the workspace part, a seed
 * path or anything under one, or the task list.
 */
export function isDroppedFromEveryDelta(path: string, exclusions: DeltaExclusions = {}): boolean {
  if (isWorkspacePart(path)) return true;
  if (exclusions.taskListPath !== undefined && path === exclusions.taskListPath) return true;
  for (const seed of exclusions.seedPaths ?? []) {
    const trimmed = seed.replace(/\/+$/, "");
    if (path === trimmed || path.startsWith(`${trimmed}/`)) return true;
  }
  return false;
}

/** One record of `diff-tree -r -z --raw`, parsed. */
type RawChange = {
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldOid: string;
  readonly newOid: string;
  readonly status: string;
  readonly path: string;
};

/**
 * The kind of one raw change. `A` is an addition and `D` a deletion; of the
 * rest, a change whose object id is equal and whose mode is not is a change of
 * the MODE and nothing else, and everything else is a change of content.
 */
export function kindOfRawChange(change: {
  readonly status: string;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldOid: string;
  readonly newOid: string;
}): ChangeKind {
  if (change.status === "A") return "added";
  if (change.status === "D") return "deleted";
  if (change.oldOid === change.newOid && change.oldMode !== change.newMode) return "mode changed";
  return "changed";
}

/** Parse the `-z --raw` output into records. */
export function parseRawDiff(output: string): readonly RawChange[] {
  const fields = output.split("\0").filter((field) => field !== "");
  const out: RawChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const head = String(fields[i]).replace(/^:/, "").split(" ");
    out.push(
      Object.freeze({
        oldMode: String(head[0]),
        newMode: String(head[1]),
        oldOid: String(head[2]),
        newOid: String(head[3]),
        status: String(head[4]),
        path: String(fields[i + 1]),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * F143-FR-006, F143-FR-019 — the delta between two tree ids: the paths that
 * differ, each with its kind, sorted by path, with no rename detected and
 * with the paths that belong in no delta dropped.
 */
export function changed(
  places: StorePlaces,
  baseTreeId: string,
  treeId: string,
  exclusions: DeltaExclusions = {},
): readonly ChangedPath[] {
  const raw = inStore(places, [
    "diff-tree",
    "-r",
    "-z",
    "--raw",
    NO_RENAMES,
    baseTreeId,
    treeId,
  ]).stdout;
  return Object.freeze(
    parseRawDiff(raw)
      .filter((change) => !isDroppedFromEveryDelta(change.path, exclusions))
      .map((change) => Object.freeze({ path: change.path, kind: kindOfRawChange(change) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
}
