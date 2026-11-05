/**
 * T129 — the interface type of the tree-store service (annex D, §D.2;
 * F100-FR-121 to F100-FR-125).
 *
 * Schema id `specstride.tree-store/1`. Logical names `tree-store` and
 * `worker-root`. The engine offers the service to a layer that declared it;
 * the layer `parallel` uses it through the directives `requestPassGroup` and
 * `integrateGroup` of EP-04. Feature 143 builds the part that parallel units
 * need; nothing is built for `autoresearch`.
 *
 * This module holds the interface only: the seven operations and no other,
 * the refusal reason `overlap` of `compose`, the conditions a snapshot commit
 * must meet, and the two writes to the workspace that rule IR-60 as amended
 * permits — all as data, so that the owner of the behaviour and every
 * consumer read one list.
 */
import loopLayerTables from "../../data/loop-layer-tables.json" with { type: "json" };

/** The schema id of the service (annex D, §D.2). */
export const SCHEMA_ID = "specstride.tree-store/1" as const;

/** The two logical names the service touches (annex D, §D.2). */
export const LOGICAL_NAMES = ["tree-store", "worker-root"] as const;

/**
 * F100-FR-121 — the seven operations of the tree store, and no other. There
 * is no restore, no reset and no checkout of the workspace.
 */
export const TREE_STORE_OPERATIONS = [
  "snapshot",
  "materialize",
  "changed",
  "compose",
  "apply",
  "release",
  "sweep",
] as const;
export type TreeStoreOperation = (typeof TREE_STORE_OPERATIONS)[number];

/** The number of the row of annex X §X.6 that holds the operations. */
export const CLOSED_SET_ROW_OF_THE_OPERATIONS = 64 as const;

/** One row of the operation table of §D.2, from `data/loop-layer-tables.json`. */
export type TreeStoreOperationRow = {
  readonly operation: TreeStoreOperation;
  readonly input: string;
  readonly output: string;
  /** What the operation writes: the store, the worker root, the workspace or nothing. */
  readonly writes: string;
};

type RawRow = { Operation: string; Input: string; Output: string; Writes: string };

const BACKTICKED = /`([^`]+)`/;

/** The seven rows of the table of §D.2, in the order of the annex. */
export const treeStoreOperationRows: readonly TreeStoreOperationRow[] = Object.freeze(
  (loopLayerTables as { treeStoreOperations: RawRow[] }).treeStoreOperations.map((row) =>
    Object.freeze({
      operation: (BACKTICKED.exec(row.Operation)?.[1] ?? row.Operation) as TreeStoreOperation,
      input: row.Input,
      output: row.Output,
      writes: row.Writes,
    }),
  ),
);

/**
 * F100-FR-121 — the one operation that may write a path of the workspace is
 * `apply`; every other operation writes the store, the worker root or nothing.
 */
export const OPERATION_THAT_MAY_WRITE_THE_WORKSPACE: TreeStoreOperation = "apply";

/** True where the operation may write a path of the workspace (F100-FR-121). */
export function mayWriteTheWorkspace(operation: TreeStoreOperation): boolean {
  return operation === OPERATION_THAT_MAY_WRITE_THE_WORKSPACE;
}

/** The operations the service does NOT offer (F100-FR-121). */
export const OPERATIONS_THE_STORE_DOES_NOT_OFFER = ["restore", "reset", "checkout"] as const;

/* ------------------------------------------------------------------ *
 * The refusal reason `overlap` (F100-FR-122).
 * ------------------------------------------------------------------ */

/** F100-FR-122 — the one refusal reason of `compose`. */
export const COMPOSE_REFUSAL_REASON = "overlap" as const;

/** One accepted delta of a worker, in the order of the tasks at launch. */
export type AuditedDelta = {
  /** The worker whose final snapshot the paths come from. */
  readonly workerId: string;
  /** The tree id of the worker's final snapshot. */
  readonly treeId: string;
  /** The paths of the delta, relative to the workspace. */
  readonly paths: readonly string[];
};

/** The result of `compose`: a tree id, or the refusal `overlap` with the paths. */
export type ComposeResult =
  | { readonly composed: true; readonly treeId: string }
  | {
      readonly composed: false;
      readonly reason: typeof COMPOSE_REFUSAL_REASON;
      /** The paths a later delta shares with an earlier one. */
      readonly paths: readonly string[];
      /** The worker whose delta is refused. */
      readonly workerId: string;
    };

/**
 * F100-FR-122 — composition and never a merge of content. The path sets of
 * accepted deltas are pairwise disjoint; a delta that shares a path with an
 * earlier one in the order of the tasks at launch is refused with the reason
 * `overlap`. A model takes no part in integration.
 */
export function firstOverlap(
  deltas: readonly AuditedDelta[],
): { readonly workerId: string; readonly paths: readonly string[] } | undefined {
  const seen = new Map<string, string>();
  for (const delta of deltas) {
    const shared = delta.paths.filter((p) => seen.has(p));
    if (shared.length > 0)
      return Object.freeze({ workerId: delta.workerId, paths: Object.freeze(shared) });
    for (const p of delta.paths) seen.set(p, delta.workerId);
  }
  return undefined;
}

/** A model never takes part in integration (F100-FR-122). */
export const A_MODEL_TAKES_PART_IN_INTEGRATION = false as const;

/* ------------------------------------------------------------------ *
 * The conditions of a store commit (F100-FR-123).
 * ------------------------------------------------------------------ */

/**
 * F100-FR-123 — the conditions a snapshot commit of the store must meet.
 * Each is a condition of the commit, not of the caller.
 */
export const STORE_COMMIT_CONDITIONS = [
  "exists only in the store, which lies outside the project's repository",
  "has a fixed author, date and message",
  "is never a parent of a commit of the project",
  "is never pushed",
  "is removed with the run",
] as const;
export type StoreCommitCondition = (typeof STORE_COMMIT_CONDITIONS)[number];

/** The state of one snapshot commit, as a caller reports it. */
export type StoreCommitState = {
  readonly insideTheProjectRepository: boolean;
  readonly author: string;
  readonly date: string;
  readonly message: string;
  readonly isParentOfAProjectCommit: boolean;
  readonly pushed: boolean;
  readonly removedWithTheRun: boolean;
};

/** The fixed author, date and message of every store commit (F100-FR-123). */
export type FixedCommitIdentity = {
  readonly author: string;
  readonly date: string;
  readonly message: string;
};

/** The conditions a commit state breaks, in the order of the list (F100-FR-123). */
export function storeCommitConditionsBroken(
  state: StoreCommitState,
  fixed: FixedCommitIdentity,
): readonly StoreCommitCondition[] {
  const broken: StoreCommitCondition[] = [];
  if (state.insideTheProjectRepository) broken.push(STORE_COMMIT_CONDITIONS[0]);
  if (
    state.author !== fixed.author ||
    state.date !== fixed.date ||
    state.message !== fixed.message
  ) {
    broken.push(STORE_COMMIT_CONDITIONS[1]);
  }
  if (state.isParentOfAProjectCommit) broken.push(STORE_COMMIT_CONDITIONS[2]);
  if (state.pushed) broken.push(STORE_COMMIT_CONDITIONS[3]);
  if (!state.removedWithTheRun) broken.push(STORE_COMMIT_CONDITIONS[4]);
  return Object.freeze(broken);
}

/** F100-FR-123 — the store is unwritable by any worker. */
export const THE_STORE_IS_WRITABLE_BY_A_WORKER = false as const;

/** F100-FR-123 — each worker tree borrows the objects of the store read-only. */
export const WORKER_TREE_BORROWS_OBJECTS_READ_ONLY = true as const;

/* ------------------------------------------------------------------ *
 * The two permitted writes to the workspace (rule IR-60 as amended,
 * F100-FR-124).
 * ------------------------------------------------------------------ */

/** The rule of the architecture that F100-FR-124 amends. */
export const RULE = "IR-60 as amended" as const;

/** The two writes to the workspace the runtime may make, and only with parallel units on. */
export const PERMITTED_WRITES_TO_THE_WORKSPACE = [
  {
    ordinal: 1,
    what: "the application of the composed delta of a group",
    conditions: [
      "forward only",
      "only paths of audited deltas",
      "only onto a workspace equal to the base",
      "recorded before it is made",
      "never undone",
      "nothing under the repository directory",
    ],
    through: "the tree-store operation `apply`",
  },
  {
    ordinal: 2,
    what: "the ticks of the integrated tasks",
    conditions: ["through the spec-format adapter"],
    through: "EP-03 `specstride.spec-format/1`, the operation `tick`",
  },
] as const;

/** What the runtime never does to the workspace inside a phase attempt (F100-FR-124). */
export const NEVER_DONE_TO_THE_WORKSPACE = [
  "commit",
  "revert",
  "reset",
  "clean",
  "check out",
] as const;

/**
 * F100-FR-124 — the one write under the project's repository directory that
 * exists at the baseline and is therefore permitted.
 */
export const THE_ONE_PERMITTED_REPOSITORY_WRITE = "the approval commit" as const;

/** With parallel units off, the runtime makes neither of the two writes. */
export function permittedWrites(parallelUnitsOn: boolean): readonly { readonly ordinal: number }[] {
  return parallelUnitsOn ? PERMITTED_WRITES_TO_THE_WORKSPACE : Object.freeze([]);
}

/* ------------------------------------------------------------------ *
 * The interface itself.
 * ------------------------------------------------------------------ */

/** A tree id of the store. */
export type TreeId = string;

/** The kind of a changed path (annex D, §D.2, the row `changed`). */
export const CHANGE_KINDS = ["added", "changed", "deleted", "mode changed"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One changed path with its kind. */
export type ChangedPath = { readonly path: string; readonly kind: ChangeKind };

/** A worker tree the store materialized under the worker root. */
export type WorkerTree = {
  readonly workerId: string;
  readonly path: string;
  readonly treeId: TreeId;
};

/**
 * F100-FR-121 — the tree-store service. The seven operations of §D.2 and no
 * other: a wider interface is a different interface, and the engine refuses
 * a layer that declares an operation the engine does not offer.
 */
export type TreeStoreService = {
  snapshot(directory: string): Promise<TreeId>;
  materialize(treeId: TreeId, workerId: string): Promise<WorkerTree>;
  changed(baseTreeId: TreeId, treeId: TreeId): Promise<readonly ChangedPath[]>;
  compose(baseTreeId: TreeId, deltas: readonly AuditedDelta[]): Promise<ComposeResult>;
  apply(baseTreeId: TreeId, composed: TreeId, workspace: string): Promise<readonly string[]>;
  release(tree: WorkerTree): Promise<void>;
  sweep(): Promise<readonly TreeId[]>;
};

/** True when a service offers exactly the seven operations and no other. */
export function offersExactlyTheSevenOperations(service: object): boolean {
  const own = Object.keys(service).filter(
    (k) => typeof (service as Record<string, unknown>)[k] === "function",
  );
  return (
    own.length === TREE_STORE_OPERATIONS.length &&
    TREE_STORE_OPERATIONS.every((op) => own.includes(op))
  );
}
