/**
 * T067, first half — `release` (F143-FR-027; R29 PU-27; R29v PU-93; CQ-237).
 *
 * F143-FR-027 names four removals and splits them between the two operations
 * of the interface that may remove anything. THE TWO THIS FILE OWNS:
 *
 *  1 A STALE TREE, BEFORE A WORKER TREE IS CREATED. "Before a worker tree is
 *    created, a stale tree of the same run, group and worker MUST be removed."
 *    Keyed by RUN, GROUP AND WORKER (R29 PU-27) — not by worker alone, because
 *    the same worker id may be used by a later group of the same run, and not
 *    by path, because the path carries an opaque component that a new
 *    `materialize` will not reproduce.
 *
 *  2 EVERY WORKER TREE OF THE GROUP, AT GROUP CLOSE, ON SUCCESS AND ON
 *    FAILURE. The second half of that sentence is the whole of it: a failed
 *    group leaves no tree behind either, because a tree left behind is a tree
 *    a later sweep has to guess about.
 *
 * WHAT `release` REMOVES AND WHAT IT MUST NOT TOUCH. "The removal of a worker
 * tree (`release`) MUST remove the tree AND ITS TEMPORARY DIRECTORY and MUST
 * WRITE THE WORKER ROOT ONLY (annex D §D.2); SNAPSHOTS MUST LEAVE THE STORE
 * WITH `sweep`." The last clause is CQ-237, and it is the reason this file
 * exists apart from `sweep.ts`: before CQ-237 was answered, `release` was
 * thought to prune the tree's entry in the store as well (R29v PU-93's last
 * sentence), and the answer of the owner is that it does not. So every removal
 * here goes through `removeUnderTheWorkerRoot`, which REFUSES A PATH THAT IS
 * NOT UNDER THE WORKER ROOT — the store and the control plane included. A
 * snapshot of a killed or refused worker therefore survives the close of its
 * group and is still there for the operator (R29 PU-27, F143-FR-014).
 *
 * THE INDEX. "The same run, group and worker" and "no open group owns it"
 * (`sweep.ts`) are questions about trees made by an engine that may since have
 * been killed, so the answer cannot live in memory. `trees.jsonl` IN THE
 * WORKER ROOT is the record: one line per tree, appended when it is made,
 * marked when it is released. It is a FILE in the worker root, so writing it
 * is writing the worker root and nothing else, and `sweep` can tell it from
 * the directory of a tree.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { TreeId, WorkerTree } from "@specstride/contracts/ep/tree-store";
import { placeOfThePath, type StorePlaces } from "./git.ts";

/* ------------------------------------------------------------------ *
 * What the requirement fixes, as values.
 * ------------------------------------------------------------------ */

/** F143-FR-027, annex D §D.2 — the one place `release` may write. */
export const RELEASE_WRITES = "the worker root only" as const;

/** F143-FR-027 — what it removes: the tree AND its temporary directory. */
export const RELEASE_REMOVES = ["the tree", "its temporary directory"] as const;

/** CQ-237 — and a snapshot is not among them. */
export const A_SNAPSHOT_LEAVES_THE_STORE_WITH = "sweep" as const;
export const RELEASE_REMOVES_A_SNAPSHOT = false as const;
export const RELEASE_PRUNES_THE_ENTRY_IN_THE_STORE = false as const;

/** R29 PU-27 — a stale tree is keyed by these three and no fewer. */
export const A_STALE_TREE_IS_KEYED_BY = ["run", "group", "worker"] as const;

/** F143-FR-027 — at group close, on success AND on failure. */
export const TREES_ARE_REMOVED_AT_GROUP_CLOSE_ON = ["success", "failure"] as const;

/** The index of the trees of the worker root, by file name. */
export const TREE_INDEX_FILE = "trees.jsonl" as const;

/** The refusal of a removal that would write outside the worker root. */
export class ARemovalOutsideTheWorkerRoot extends Error {
  readonly path: string;
  readonly where: string;
  constructor(path: string, where: string) {
    super(
      `\`release\` writes ${RELEASE_WRITES} and \`${path}\` lies in \`${where}\`: the tree and ` +
        `its temporary directory are removed, the store is left as it was, and a snapshot ` +
        `leaves the store with \`${A_SNAPSHOT_LEAVES_THE_STORE_WITH}\` (F143-FR-027, CQ-237)`,
    );
    this.name = "ARemovalOutsideTheWorkerRoot";
    this.path = path;
    this.where = where;
  }
}

/**
 * Remove one path, and ONLY where it is under the worker root. This is the one
 * removal `release` has: a path in the store, in the control plane or anywhere
 * else is refused before a byte is touched.
 */
export function removeUnderTheWorkerRoot(places: StorePlaces, path: string): boolean {
  const where = placeOfThePath(places, path);
  if (where !== "worker-root") throw new ARemovalOutsideTheWorkerRoot(path, where);
  // The worker root ITSELF is not a tree; removing it is `sweep`'s at run end.
  if (resolve(path) === resolve(places.workerRoot)) {
    throw new ARemovalOutsideTheWorkerRoot(path, "the worker root itself");
  }
  const was = existsSync(path);
  rmSync(path, { recursive: true, force: true });
  return was;
}

/* ------------------------------------------------------------------ *
 * The index of the trees of the worker root.
 * ------------------------------------------------------------------ */

/** Who owns one tree of the worker root (R29 PU-27). */
export type TreeOwnership = {
  /** The run that made it. */
  readonly runId: string;
  /** The group that made it. */
  readonly groupId: string;
  /** The worker it was made for. */
  readonly workerId: string;
  /** The opaque component of its path (F143-FR-005). */
  readonly opaque: string;
  /** The tree itself. */
  readonly tree: string;
  /** Its temporary directory, beside it (F143-FR-009). */
  readonly temporaryDirectory: string;
  /** The tree id it was materialized from. */
  readonly treeId: TreeId;
  /** True once it has been released. */
  readonly released?: boolean;
};

/** The path of the index in the worker root. */
export function treeIndexPath(places: StorePlaces): string {
  return join(places.workerRoot, TREE_INDEX_FILE);
}

/** True where a name of the worker root is the index and not a tree. */
export function isTheIndex(name: string): boolean {
  return name === TREE_INDEX_FILE;
}

/**
 * Record the owner of a tree. Called by `materialize` through the service, so
 * that the index is written by the same operation that makes the directory and
 * cannot fall behind it.
 */
export function recordTheOwnerOfATree(places: StorePlaces, ownership: TreeOwnership): void {
  mkdirSync(places.workerRoot, { recursive: true, mode: 0o700 });
  appendFileSync(treeIndexPath(places), JSON.stringify(ownership) + "\n", { mode: 0o600 });
}

/** Every tree the index knows, in the order it was made. A torn last line is dropped. */
export function treesOfTheWorkerRoot(places: StorePlaces): readonly TreeOwnership[] {
  const path = treeIndexPath(places);
  if (!existsSync(path)) return Object.freeze([]);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const tail = lines.pop();
  if (tail !== undefined && tail !== "") {
    // A crash can cut the last line; a reader tolerates that one and no other.
  }
  const out: TreeOwnership[] = [];
  for (const line of lines) {
    if (line === "") continue;
    try {
      out.push(JSON.parse(line) as TreeOwnership);
    } catch {
      // Not a whole record: it is not a tree this file may speak for.
    }
  }
  return Object.freeze(out);
}

/** Write the index again, marking the trees that have been released. */
export function markAsReleased(places: StorePlaces, opaques: readonly string[]): void {
  const marked = new Set(opaques);
  const all = treesOfTheWorkerRoot(places).map((entry) =>
    marked.has(entry.opaque) ? { ...entry, released: true } : entry,
  );
  const path = treeIndexPath(places);
  mkdirSync(places.workerRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    all.map((entry) => JSON.stringify(entry)).join("\n") + (all.length === 0 ? "" : "\n"),
    {
      mode: 0o600,
    },
  );
}

/** The trees the index says are still there: made and not released. */
export function treesStillHeld(places: StorePlaces): readonly TreeOwnership[] {
  return Object.freeze(treesOfTheWorkerRoot(places).filter((entry) => entry.released !== true));
}

/* ------------------------------------------------------------------ *
 * 1 — the stale tree, before a worker tree is created.
 * ------------------------------------------------------------------ */

/** The three things that key a stale tree (R29 PU-27). */
export type StaleTreeKey = {
  readonly runId: string;
  readonly groupId: string;
  readonly workerId: string;
};

/** The trees of the index that are stale for this run, group and worker. */
export function staleTreesOf(places: StorePlaces, key: StaleTreeKey): readonly TreeOwnership[] {
  return Object.freeze(
    treesStillHeld(places).filter(
      (entry) =>
        entry.runId === key.runId &&
        entry.groupId === key.groupId &&
        entry.workerId === key.workerId,
    ),
  );
}

/** What one removal did. */
export type Released = {
  /** The paths that were removed. */
  readonly removed: readonly string[];
  /** The opaque components of the trees that were released. */
  readonly opaques: readonly string[];
  /** Where it wrote, which is the worker root and nothing else. */
  readonly wrote: typeof RELEASE_WRITES;
  /** CQ-237 — the store was left as it was. */
  readonly storeLeftAsItWas: true;
};

/**
 * F143-FR-027 — REMOVE A STALE TREE OF THE SAME RUN, GROUP AND WORKER, BEFORE
 * A WORKER TREE IS CREATED. Called by `materialize` through the service, which
 * is the only moment at which "before" is a moment and not a hope.
 */
export function removeAStaleTree(places: StorePlaces, key: StaleTreeKey): Released {
  return releaseTheseTrees(places, staleTreesOf(places, key));
}

/* ------------------------------------------------------------------ *
 * 2 — every tree of the group, at group close.
 * ------------------------------------------------------------------ */

/** The trees of the index that this group made and still holds. */
export function treesOfTheGroup(
  places: StorePlaces,
  input: { readonly runId: string; readonly groupId: string },
): readonly TreeOwnership[] {
  return Object.freeze(
    treesStillHeld(places).filter(
      (entry) => entry.runId === input.runId && entry.groupId === input.groupId,
    ),
  );
}

/**
 * F143-FR-027 — AT GROUP CLOSE, EVERY WORKER TREE OF THE GROUP IS REMOVED, ON
 * SUCCESS AND ON FAILURE. The outcome is taken as an argument and NOT USED to
 * decide anything: it is there so that a caller must state it and a reader can
 * see that it changes nothing.
 */
export function releaseTheTreesOfTheGroup(
  places: StorePlaces,
  input: {
    readonly runId: string;
    readonly groupId: string;
    /** `closed` or `failed`; every tree goes either way. */
    readonly outcome: (typeof TREES_ARE_REMOVED_AT_GROUP_CLOSE_ON)[number] | string;
  },
): Released {
  return releaseTheseTrees(
    places,
    treesOfTheGroup(places, { runId: input.runId, groupId: input.groupId }),
  );
}

/**
 * F143-FR-027, CQ-237 — RELEASE ONE WORKER TREE: the tree and its temporary
 * directory, which lie together in the home directory the opaque component
 * names, and NOTHING of the store.
 */
export function releaseAWorkerTree(
  places: StorePlaces,
  tree: WorkerTree & { readonly temporaryDirectory?: string },
): Released {
  const found = treesStillHeld(places).find((entry) => resolve(entry.tree) === resolve(tree.path));
  if (found !== undefined) return releaseTheseTrees(places, [found]);
  // A tree the index does not know — a service built over an existing worker
  // root, say. Its home is still the parent of the tree, which holds the
  // temporary directory beside it (F143-FR-009).
  return releaseTheseTrees(places, [
    {
      runId: "",
      groupId: "",
      workerId: tree.workerId,
      opaque: "",
      tree: tree.path,
      temporaryDirectory: tree.temporaryDirectory ?? join(dirname(tree.path), "tmp"),
      treeId: tree.treeId,
    },
  ]);
}

/** The home directory of a tree: the one with the opaque component. */
export function homeOf(places: StorePlaces, tree: string): string {
  const below = relative(resolve(places.workerRoot), resolve(tree));
  if (below === "" || below.startsWith("..") || isAbsolute(below)) return dirname(tree);
  const first = below.split(/[\\/]/)[0] ?? "";
  return join(places.workerRoot, first);
}

/**
 * The removal itself, for a list of trees. One place, so that every one of the
 * removals of F143-FR-027 that belongs to `release` goes through the same
 * guard and the same marking of the index.
 */
export function releaseTheseTrees(places: StorePlaces, trees: readonly TreeOwnership[]): Released {
  const removed: string[] = [];
  const opaques: string[] = [];
  for (const entry of trees) {
    // THE TREE AND ITS TEMPORARY DIRECTORY. They sit in the home directory the
    // opaque component names, so removing the home removes both and nothing
    // of another worker.
    const home =
      entry.opaque === "" ? homeOf(places, entry.tree) : join(places.workerRoot, entry.opaque);
    if (removeUnderTheWorkerRoot(places, home)) removed.push(home);
    if (entry.opaque !== "") opaques.push(entry.opaque);
  }
  if (opaques.length > 0) markAsReleased(places, opaques);
  return Object.freeze({
    removed: Object.freeze(removed),
    opaques: Object.freeze(opaques),
    wrote: RELEASE_WRITES,
    storeLeftAsItWas: true as const,
  });
}
