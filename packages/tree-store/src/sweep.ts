/**
 * T067, second half — `sweep` (F143-FR-027, F143-FR-018; R29 PU-27; R29v
 * PU-90; CQ-237).
 *
 * THE TWO REMOVALS OF F143-FR-027 THAT BELONG TO `sweep`, and the one that
 * CQ-237 moved here:
 *
 *  3 ORPHANS AT ENGINE START. "At engine start a sweep MUST remove every
 *    worker tree that NO OPEN GROUP OF THE LEDGER OWNS." The ledger is the
 *    authority and the index of the worker root is not: a tree whose group has
 *    a `group_closed` record is an orphan however the index was left, and a
 *    tree the index never recorded — because the engine was killed between
 *    `mkdir` and the append — is an orphan too. `sweepOrphansAtEngineStart`
 *    therefore takes THE OPEN GROUPS, reads the directories of the worker root
 *    and removes what no open group claims.
 *
 *  4 THE STORE AND THE WORKER ROOT, WHEN THE RUN ENDS. "The store and the
 *    worker root of the run MUST be removed when the run ends." This is the
 *    one removal that may touch the store, and it removes the whole of it.
 *
 *  5 SNAPSHOTS (CQ-237). "Snapshots MUST leave the store with `sweep`." The
 *    snapshot of a killed or refused worker is kept until the phase attempt
 *    ends (F143-FR-014, R29 PU-27) and then leaves the store HERE and never
 *    through `release`.
 *
 * F143-FR-018 AND R29v PU-90 GOVERN ALL OF THEM: "A tree MUST be swept only
 * after its processes are ended." So every function below takes the live
 * processes of a tree — or the means of asking — and `mayBeSwept` is false
 * while one is alive. A sweep that removed a tree under a live worker would
 * pull the ground out from under a process that is still writing to it, and
 * the ordering is the only defence, because a harness process is not ours to
 * make stop on request.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TreeId } from "@specstride/contracts/ep/tree-store";
import { placeOfThePath, tryInStore, type StorePlaces } from "./git.ts";
import {
  TREE_INDEX_FILE,
  isTheIndex,
  markAsReleased,
  removeUnderTheWorkerRoot,
  treesOfTheWorkerRoot,
  treesStillHeld,
  type TreeOwnership,
} from "./release.ts";

/* ------------------------------------------------------------------ *
 * What the requirements fix, as values.
 * ------------------------------------------------------------------ */

/** F143-FR-018, R29v PU-90 — the ordering that governs every sweep. */
export const A_TREE_IS_SWEPT_ONLY_AFTER_ITS_PROCESSES_ARE_ENDED = true as const;

/** F143-FR-027 — what makes a tree an orphan at engine start. */
export const AN_ORPHAN_IS = "a worker tree that no open group of the ledger owns" as const;

/** F143-FR-027 — and the ledger is what decides, not the index. */
export const THE_AUTHORITY_ON_AN_OPEN_GROUP = "the ledger" as const;

/** CQ-237 — snapshots leave the store here. */
export const SNAPSHOTS_LEAVE_THE_STORE_WITH = "sweep" as const;

/** F143-FR-014, R29 PU-27 — and not before this moment. */
export const A_SNAPSHOT_IS_KEPT_UNTIL = "the phase attempt ends" as const;

/** F143-FR-027 — what is removed when the run ends. */
export const REMOVED_AT_RUN_END = ["the store", "the worker root"] as const;

/** The record kind whose presence closes a group (F143-FR-023). */
export const THE_KIND_THAT_CLOSES_A_GROUP = "group_closed" as const;

/**
 * F143-FR-018 — may this tree be swept? Only where no process of it is alive.
 * Stated as a function of its own so that a caller cannot sweep first and
 * check after.
 */
export function mayBeSwept(input: { readonly liveProcesses: readonly number[] }): boolean {
  return input.liveProcesses.length === 0;
}

/** The refusal of a sweep of a tree whose processes are still alive. */
export class ASweepBeforeTheProcessesAreEnded extends Error {
  readonly tree: string;
  readonly liveProcesses: readonly number[];
  constructor(tree: string, liveProcesses: readonly number[]) {
    super(
      `\`${tree}\` has ${String(liveProcesses.length)} live process(es) ` +
        `(${liveProcesses.join(", ")}): a tree is swept only after its processes are ended ` +
        `(F143-FR-018, R29v PU-90)`,
    );
    this.name = "ASweepBeforeTheProcessesAreEnded";
    this.tree = tree;
    this.liveProcesses = liveProcesses;
  }
}

/* ------------------------------------------------------------------ *
 * 3 — the orphans, at engine start.
 * ------------------------------------------------------------------ */

/** One group of the ledger, as the sweep reads it. */
export type GroupOfTheLedger = {
  readonly groupId: string;
  /** True where the ledger holds a `group_closed` record for it. */
  readonly closed: boolean;
};

/**
 * F143-FR-027 — the OPEN groups of the ledger: those with no `group_closed`
 * record. Takes the record kinds per group, so that the caller hands in what
 * it read from the ledger and this file decides nothing about the format.
 */
export function openGroupsOf(
  ledger: readonly { readonly ns?: string; readonly kind?: string; readonly groupId?: string }[],
): readonly string[] {
  const groups = new Map<string, boolean>();
  for (const line of ledger) {
    if (line.ns !== "parallel") continue;
    const groupId = line.groupId;
    if (groupId === undefined) continue;
    const closed = groups.get(groupId) === true || line.kind === THE_KIND_THAT_CLOSES_A_GROUP;
    groups.set(groupId, closed);
  }
  return Object.freeze([...groups].filter(([, closed]) => !closed).map(([groupId]) => groupId));
}

/** One directory of the worker root, and what the index says about it. */
export type DirectoryOfTheWorkerRoot = {
  /** The opaque component, which is the name of the directory. */
  readonly opaque: string;
  /** The directory itself. */
  readonly home: string;
  /** What the index says owns it, where it says anything. */
  readonly ownership?: TreeOwnership;
};

/** Every directory of the worker root, with its entry of the index. */
export function directoriesOfTheWorkerRoot(
  places: StorePlaces,
): readonly DirectoryOfTheWorkerRoot[] {
  if (!existsSync(places.workerRoot)) return Object.freeze([]);
  const index = treesOfTheWorkerRoot(places);
  const out: DirectoryOfTheWorkerRoot[] = [];
  for (const name of readdirSync(places.workerRoot).sort()) {
    if (isTheIndex(name)) continue;
    const home = join(places.workerRoot, name);
    if (!statSync(home).isDirectory()) continue;
    const ownership = index.find((entry) => entry.opaque === name);
    out.push(
      Object.freeze({
        opaque: name,
        home,
        ...(ownership === undefined ? {} : { ownership }),
      }),
    );
  }
  return Object.freeze(out);
}

/** What a sweep of the worker root did. */
export type SweptTrees = {
  /** The opaque components of the trees removed. */
  readonly removed: readonly string[];
  /** The directories removed. */
  readonly paths: readonly string[];
  /** The trees an open group still owns, which were left alone. */
  readonly kept: readonly string[];
  /** The trees that were left because a process of theirs was still alive. */
  readonly keptForLiveProcesses: readonly string[];
};

/**
 * F143-FR-027 — THE SWEEP AT ENGINE START: remove every worker tree that no
 * open group of the ledger owns.
 *
 * A directory the index does not know is an ORPHAN BY DEFINITION, because a
 * tree is recorded in the index by the same operation that makes it: if there
 * is no record, there was no complete `materialize`, and nothing of a run
 * depends on it.
 *
 * F143-FR-018 — a tree with a live process is KEPT and reported, never
 * removed; `liveProcessesOf` is the caller's, because the core of a run knows
 * the process registry and this edge does not.
 */
export function sweepOrphansAtEngineStart(
  places: StorePlaces,
  input: {
    /** The open groups of the ledger (F143-FR-027). */
    readonly openGroups: readonly string[];
    /** The live processes of one tree, by its opaque component (F143-FR-018). */
    readonly liveProcessesOf?: (directory: DirectoryOfTheWorkerRoot) => readonly number[];
  },
): SweptTrees {
  const open = new Set(input.openGroups);
  const removed: string[] = [];
  const paths: string[] = [];
  const kept: string[] = [];
  const keptForLiveProcesses: string[] = [];
  for (const directory of directoriesOfTheWorkerRoot(places)) {
    const owner = directory.ownership;
    if (owner !== undefined && owner.released !== true && open.has(owner.groupId)) {
      kept.push(directory.opaque);
      continue;
    }
    const live = input.liveProcessesOf?.(directory) ?? [];
    if (!mayBeSwept({ liveProcesses: live })) {
      keptForLiveProcesses.push(directory.opaque);
      continue;
    }
    if (removeUnderTheWorkerRoot(places, directory.home)) paths.push(directory.home);
    removed.push(directory.opaque);
  }
  if (removed.length > 0) markAsReleased(places, removed);
  return Object.freeze({
    removed: Object.freeze(removed),
    paths: Object.freeze(paths),
    kept: Object.freeze(kept),
    keptForLiveProcesses: Object.freeze(keptForLiveProcesses),
  });
}

/* ------------------------------------------------------------------ *
 * 5 — the snapshots (CQ-237).
 * ------------------------------------------------------------------ */

/** The reference a snapshot is held by in the store, where it is held by one. */
export function snapshotReference(treeId: TreeId): string {
  return `refs/specstride/snapshots/${treeId}`;
}

/** What a sweep of the snapshots did. */
export type SweptSnapshots = {
  /** The tree ids that left the store. */
  readonly removed: readonly TreeId[];
  /** The tree ids that were kept because the caller named them. */
  readonly kept: readonly TreeId[];
  /** CQ-237 — where they left from. */
  readonly leftTheStoreWith: typeof SNAPSHOTS_LEAVE_THE_STORE_WITH;
};

/**
 * F143-FR-027, CQ-237 — SNAPSHOTS LEAVE THE STORE WITH `sweep`. Called when
 * the phase attempt ends: the snapshots of killed and refused workers were
 * kept for the operator until then (F143-FR-014) and now go.
 *
 * The store is a repository of objects; a snapshot leaves it by its reference
 * being removed, after which the objects are unreachable and the next
 * repacking of the store drops them. No `gc` is run here: running one is a
 * decision about the whole store and not about one snapshot, and `release` and
 * `sweep` of this feature never repack.
 */
export function sweepSnapshotsFromTheStore(
  places: StorePlaces,
  input: { readonly snapshots: readonly TreeId[]; readonly keep?: readonly TreeId[] },
): SweptSnapshots {
  const keep = new Set(input.keep ?? []);
  const removed: TreeId[] = [];
  const kept: TreeId[] = [];
  for (const treeId of input.snapshots) {
    if (keep.has(treeId)) {
      kept.push(treeId);
      continue;
    }
    const reference = snapshotReference(treeId);
    // `tryInStore`, not `inStore`: a snapshot that was never given a
    // reference has nothing to remove, and that is not an error of the sweep.
    tryInStore(places, ["update-ref", "-d", reference]);
    removed.push(treeId);
  }
  return Object.freeze({
    removed: Object.freeze(removed),
    kept: Object.freeze(kept),
    leftTheStoreWith: SNAPSHOTS_LEAVE_THE_STORE_WITH,
  });
}

/* ------------------------------------------------------------------ *
 * 4 — the store and the worker root, at the end of the run.
 * ------------------------------------------------------------------ */

/** What the sweep at the end of the run did. */
export type SweptAtRunEnd = {
  readonly storeRemoved: boolean;
  readonly workerRootRemoved: boolean;
  /** The trees that were still held when the run ended. */
  readonly treesStillHeld: readonly string[];
  /** The trees left because a process of theirs was still alive. */
  readonly keptForLiveProcesses: readonly string[];
};

/**
 * F143-FR-027 — THE STORE AND THE WORKER ROOT OF THE RUN ARE REMOVED WHEN THE
 * RUN ENDS. The one removal of this feature that writes the store, and it
 * removes the whole of it: there is nothing in a store that outlives its run
 * (R29 PU-27, "the store is removed when the run ends").
 *
 * F143-FR-018 still holds: a tree with a live process is NOT removed, and
 * neither is the worker root that holds it, so a run that ends with a holder
 * of the run token still alive leaves its worker root behind and says so. The
 * store goes either way, because no worker reads the store — a worker tree
 * borrows the objects read-only at `materialize` and holds no handle after it
 * (research.md D-2).
 */
export function sweepTheStoreAndTheWorkerRootAtRunEnd(
  places: StorePlaces,
  input: {
    readonly liveProcessesOf?: (directory: DirectoryOfTheWorkerRoot) => readonly number[];
  } = {},
): SweptAtRunEnd {
  const keptForLiveProcesses: string[] = [];
  for (const directory of directoriesOfTheWorkerRoot(places)) {
    const live = input.liveProcessesOf?.(directory) ?? [];
    if (!mayBeSwept({ liveProcesses: live })) keptForLiveProcesses.push(directory.opaque);
  }
  const held = treesStillHeld(places).map((entry) => entry.opaque);

  // The store. Removed outright; `placeOfThePath` is asked first so that a
  // caller that handed in places pointing at something else is refused.
  let storeRemoved = false;
  if (existsSync(places.store)) {
    if (placeOfThePath(places, places.store) !== "tree-store") {
      throw new Error(`\`${places.store}\` is not the store of these places`);
    }
    rmSync(places.store, { recursive: true, force: true });
    storeRemoved = true;
  }

  let workerRootRemoved = false;
  if (keptForLiveProcesses.length === 0 && existsSync(places.workerRoot)) {
    if (placeOfThePath(places, places.workerRoot) !== "worker-root") {
      throw new Error(`\`${places.workerRoot}\` is not the worker root of these places`);
    }
    rmSync(places.workerRoot, { recursive: true, force: true });
    workerRootRemoved = true;
  }

  return Object.freeze({
    storeRemoved,
    workerRootRemoved,
    treesStillHeld: Object.freeze(held),
    keptForLiveProcesses: Object.freeze(keptForLiveProcesses),
  });
}

/* ------------------------------------------------------------------ *
 * The whole of `sweep`, as the interface offers it.
 * ------------------------------------------------------------------ */

/** What `sweep` of the interface is given, where the caller has it. */
export type SweepRequest = {
  /** The open groups of the ledger (F143-FR-027, removal 3). */
  readonly openGroups?: readonly string[];
  /** The snapshots to remove, at the end of a phase attempt (CQ-237). */
  readonly snapshots?: readonly TreeId[];
  readonly keepSnapshots?: readonly TreeId[];
  /** True at the end of the run (F143-FR-027, removal 4). */
  readonly runHasEnded?: boolean;
  /** The live processes of one tree (F143-FR-018). */
  readonly liveProcessesOf?: (directory: DirectoryOfTheWorkerRoot) => readonly number[];
};

/** Everything one `sweep` removed. */
export type SweepResult = {
  readonly trees: SweptTrees;
  readonly snapshots: SweptSnapshots;
  readonly atRunEnd?: SweptAtRunEnd;
  /** The tree ids removed, which is what the interface returns. */
  readonly removed: readonly TreeId[];
};

/**
 * F143-FR-027 — `sweep`: the orphans, the snapshots and, at the end of the
 * run, the store and the worker root. The order is the requirement's: the
 * trees first, because a snapshot may not be removed while a tree that was
 * made from it is still there, and the store last, because removing it first
 * would leave the sweep of the snapshots nothing to read.
 */
export function sweep(places: StorePlaces, request: SweepRequest = {}): SweepResult {
  const trees = sweepOrphansAtEngineStart(places, {
    openGroups: request.openGroups ?? [],
    ...(request.liveProcessesOf === undefined ? {} : { liveProcessesOf: request.liveProcessesOf }),
  });
  const snapshots =
    request.snapshots === undefined
      ? Object.freeze({
          removed: Object.freeze([] as TreeId[]),
          kept: Object.freeze([] as TreeId[]),
          leftTheStoreWith: SNAPSHOTS_LEAVE_THE_STORE_WITH,
        })
      : sweepSnapshotsFromTheStore(places, {
          snapshots: request.snapshots,
          ...(request.keepSnapshots === undefined ? {} : { keep: request.keepSnapshots }),
        });
  const atRunEnd =
    request.runHasEnded === true
      ? sweepTheStoreAndTheWorkerRootAtRunEnd(places, {
          ...(request.liveProcessesOf === undefined
            ? {}
            : { liveProcessesOf: request.liveProcessesOf }),
        })
      : undefined;
  return Object.freeze({
    trees,
    snapshots,
    ...(atRunEnd === undefined ? {} : { atRunEnd }),
    removed: Object.freeze([...trees.removed, ...snapshots.removed]),
  });
}

/** The name of the index file, for a caller that lists the worker root. */
export { TREE_INDEX_FILE };
