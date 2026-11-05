/**
 * `@specstride/tree-store` — the tree store of the parallel engine services
 * (feature 143; research.md D-5).
 *
 * An EDGE package of layer L1: it runs the `git` executable of the machine as
 * a child process, which the core may not do (architecture section 6). A core
 * package reaches it through `specstride.tree-store/1`, the interface of
 * `@specstride/contracts` (`ep/tree-store.ts`, F100-FR-234), and never by
 * importing this package.
 *
 * T027 — THE SERVICE ITSELF, `treeStore()` below: F143-FR-001 says the store
 * offers EXACTLY THE SEVEN OPERATIONS `snapshot`, `materialize`, `changed`,
 * `compose`, `apply`, `release` and `sweep`, has NO RESTORE, NO RESET AND NO
 * CHECKOUT OF THE WORKSPACE, and lets NO OPERATION BUT `apply` WRITE A PATH
 * OF THE WORKSPACE. The object `treeStore()` returns therefore carries seven
 * own function properties and not an eighth: a wider interface is a different
 * interface, and `offersExactlyTheSevenOperations` of the contract is what
 * every conformance case checks it with.
 *
 * WHERE THE BEHAVIOUR LIVES. One module per operation, so that each can be
 * read against its own requirement: `snapshot.ts` (F143-FR-003),
 * `materialize.ts` (F143-FR-005 to F143-FR-007), `changed.ts` (F143-FR-006,
 * F143-FR-008, F143-FR-019), `compose.ts` (F143-FR-019), `apply.ts`
 * (F143-FR-020). The removal POLICY of F143-FR-027 — stale trees before
 * creation, every tree at group close, orphans at engine start, snapshots at
 * the end of the phase attempt, the store and the worker root at run end —
 * landed with T067 in `release.ts` and `sweep.ts`, and the sixth and the
 * seventh operation below are now two lines each that delegate to them. The
 * service keeps SEVEN MEMBERS: the policy gained files, not operations.
 *
 * ONLY `apply` WRITES THE WORKSPACE, and that is kept by construction and not
 * by care: `snapshot` and `changed` only read a directory, `materialize`,
 * `release` and `sweep` are given the WORKER ROOT and name no workspace path
 * at all, and `compose` touches nothing outside the store. The behaviour case
 * of the test kit digests the whole workspace around every one of the seven
 * calls, so a byte written by the wrong operation fails a test rather than
 * merely contradicting this comment.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditedDelta,
  ChangedPath,
  ComposeResult,
  TreeId,
  TreeStoreService,
  WorkerTree,
} from "@specstride/contracts/ep/tree-store";
import {
  initializeTheStore,
  recordTheStoreConfiguration,
  recordedStoreConfigurationHash,
  type StorePlaces,
} from "./git.ts";
import { snapshot as takeSnapshot } from "./snapshot.ts";
import {
  materialize as makeWorkerTree,
  type MaterializeOptions,
  type SeedPath,
} from "./materialize.ts";
import { changed as deltaBetween, type DeltaExclusions } from "./changed.ts";
import { compose as composeDeltas } from "./compose.ts";
import { applyComposedTree, type ApplicationPlan } from "./apply.ts";
import {
  releaseAWorkerTree,
  recordTheOwnerOfATree,
  removeAStaleTree,
  treesStillHeld,
} from "./release.ts";
import { sweep as sweepTheWorkerRootAndTheStore, type SweepRequest } from "./sweep.ts";

/* ------------------------------------------------------------------ *
 * The places the store owns, and the store itself.
 * ------------------------------------------------------------------ */

/** The three places of the store, by logical name (annex B, §B.5). */
export type { StorePlaces };

/**
 * Make the store and the worker root. The store is a BARE repository of the
 * runtime, one per run, in the control plane (F143-FR-002): it holds objects
 * and nothing else, and it is never the project's repository.
 */
export function initStore(places: StorePlaces): StorePlaces {
  mkdirSync(places.control, { recursive: true, mode: 0o700 });
  mkdirSync(places.workerRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(join(places.store, "objects"))) {
    mkdirSync(places.store, { recursive: true, mode: 0o700 });
    // The one `init` of the store, which also RECORDS THE HASH OF ITS
    // CONFIGURATION (F143-FR-004, T048).
    initializeTheStore(places);
  } else if (recordedStoreConfigurationHash(places) === "") {
    // A store opened again — by a relaunch, or by a second service over the
    // same places — records the hash it is being opened with.
    recordTheStoreConfiguration(places);
  }
  return places;
}

/** What the service is built with, beyond the places. */
export type TreeStoreOptions = {
  /** The directory the seed paths are copied FROM, ordinarily the workspace. */
  readonly seedSource?: string;
  /** The seed paths of the toolchain profile or of user configuration (F143-FR-007). */
  readonly seedPaths?: readonly (string | SeedPath)[];
  /** The path of the task list in the workspace, dropped from every delta (F143-FR-008). */
  readonly taskListPath?: string;
  /** The paths of the audited deltas, where the caller has them (F143-FR-020). */
  readonly auditedPaths?: readonly string[];
  /** The write-ahead recorder of the application (F143-FR-020). */
  readonly recordAhead?: (plan: ApplicationPlan) => void;
  /**
   * The base snapshot of the group, where the caller already has one — after
   * a resume, say. Where it is absent the FIRST snapshot the service takes is
   * the base, and every later one uses its ignore rules (R29v PU-100).
   */
  readonly baseTreeId?: TreeId;
  /**
   * The run and the group this service makes trees for. Together with the
   * worker id they are the key of a STALE TREE (F143-FR-027, R29 PU-27), and
   * the group is what `sweep` asks the ledger about, so `materialize` records
   * all three in the index of the worker root. Both default to a name of this
   * service's own, so that a caller that does not state them still gets the
   * stale-tree removal and the orphan sweep within its own run.
   */
  readonly runId?: string;
  readonly groupId?: string;
  /**
   * What `sweep` is to remove beyond the orphans: the snapshots at the end of
   * a phase attempt (CQ-237), and the store and the worker root at the end of
   * the run (F143-FR-027). The interface gives `sweep` no argument, so the
   * caller states it here.
   */
  readonly sweep?: Omit<SweepRequest, "openGroups">;
};

/**
 * F143-FR-001 — THE TREE STORE: exactly the seven operations of annex D §D.2
 * and no other. The object below has seven own function properties; add an
 * eighth and `offersExactlyTheSevenOperations` refuses it.
 */
export function treeStore(places: StorePlaces, options: TreeStoreOptions = {}): TreeStoreService {
  /** The worker trees this service made, so that `sweep` can tell an orphan. */
  const workerTrees = new Map<string, WorkerTree>();

  /**
   * The run and the group of the trees this service makes (F143-FR-027, R29
   * PU-27). A service built without them still keys its stale trees and its
   * orphans within itself, which is what the conformance of T010 exercises.
   */
  const runId = options.runId ?? "run";
  const groupId = options.groupId ?? "group";

  /**
   * THE BASE SNAPSHOT OF THE GROUP (F143-FR-003). The interface gives
   * `snapshot` one argument, so the service itself knows which snapshot is
   * the base: the FIRST one it takes. Every snapshot after it is a FINAL
   * snapshot and uses THE IGNORE RULES OF THE BASE (R29v PU-100), so that a
   * worker cannot change what its own delta covers by editing `.gitignore`.
   */
  let theBase: TreeId | undefined = options.baseTreeId;

  const exclusions: DeltaExclusions = {
    ...(options.seedPaths === undefined
      ? {}
      : { seedPaths: options.seedPaths.map((s) => (typeof s === "string" ? s : s.path)) }),
    ...(options.taskListPath === undefined ? {} : { taskListPath: options.taskListPath }),
  };

  const materializeOptions: MaterializeOptions = {
    ...(options.seedSource === undefined ? {} : { seedSource: options.seedSource }),
    ...(options.seedPaths === undefined ? {} : { seedPaths: options.seedPaths }),
  };

  return {
    /** 1 `snapshot(directory) → treeId`. Writes the STORE (F143-FR-003). */
    snapshot(directory: string): Promise<TreeId> {
      if (theBase === undefined) {
        theBase = takeSnapshot(places, directory);
        return Promise.resolve(theBase);
      }
      return Promise.resolve(takeSnapshot(places, directory, { ignoreRulesOf: theBase }));
    },

    /** 2 `materialize(treeId, workerId) → worker tree`. Writes the WORKER ROOT. */
    materialize(treeId: TreeId, workerId: string): Promise<WorkerTree> {
      // F143-FR-027 — BEFORE A WORKER TREE IS CREATED, a stale tree of the
      // same run, group and worker is removed. Here and nowhere else: this is
      // the only moment at which "before" is a moment (T067, `release.ts`).
      removeAStaleTree(places, { runId, groupId, workerId });
      const made = makeWorkerTree(places, treeId, workerId, materializeOptions);
      // The index of the worker root, written by the operation that made the
      // directory, so that a relaunched engine can tell whose tree it is.
      recordTheOwnerOfATree(places, {
        runId,
        groupId,
        workerId,
        opaque: made.opaque,
        tree: made.path,
        temporaryDirectory: made.temporaryDirectory,
        treeId,
      });
      workerTrees.set(workerId, made);
      return Promise.resolve(made);
    },

    /** 3 `changed(base, tree) → paths with kind`. Writes NOTHING. */
    changed(baseTreeId: TreeId, treeId: TreeId): Promise<readonly ChangedPath[]> {
      return Promise.resolve(deltaBetween(places, baseTreeId, treeId, exclusions));
    },

    /** 4 `compose(base, deltas) → treeId or `overlap``. Writes the STORE. */
    compose(baseTreeId: TreeId, deltas: readonly AuditedDelta[]): Promise<ComposeResult> {
      return Promise.resolve(composeDeltas(places, baseTreeId, deltas));
    },

    /** 5 `apply(base, composed, workspace) → paths`. THE ONE THAT WRITES IT. */
    apply(baseTreeId: TreeId, composed: TreeId, workspace: string): Promise<readonly string[]> {
      return Promise.resolve(
        applyComposedTree(places, baseTreeId, composed, workspace, {
          ...(options.auditedPaths === undefined ? {} : { auditedPaths: options.auditedPaths }),
          ...(options.recordAhead === undefined ? {} : { recordAhead: options.recordAhead }),
        }).paths,
      );
    },

    /**
     * 6 `release(worker tree)`. Writes the WORKER ROOT ONLY: the tree AND its
     * temporary directory, which lies beside it (F143-FR-009, F143-FR-027,
     * CQ-237). A SNAPSHOT IS NOT TOUCHED — it leaves the store with `sweep`.
     */
    release(tree: WorkerTree): Promise<void> {
      releaseAWorkerTree(places, tree);
      workerTrees.delete(tree.workerId);
      return Promise.resolve();
    },

    /**
     * 7 `sweep() → the trees removed`. Writes the WORKER ROOT ONLY. An
     * ORPHAN is a directory of the worker root whose worker this service does
     * not know; a live tree is left alone.
     */
    sweep(): Promise<readonly TreeId[]> {
      // The OPEN GROUPS, as this service knows them: the groups of the trees
      // it still holds. A caller with the ledger in hand states the groups
      // itself through `TreeStoreOptions.sweep` of a service it builds for the
      // engine start; a service in the middle of a group has its own group
      // open and nothing else (F143-FR-027, T067, `sweep.ts`).
      const openGroups = [
        ...new Set(
          treesStillHeld(places)
            .filter((entry) => workerTrees.has(entry.workerId))
            .map((entry) => entry.groupId),
        ),
      ];
      const result = sweepTheWorkerRootAndTheStore(places, {
        openGroups,
        ...(options.sweep ?? {}),
      });
      for (const [workerId, tree] of [...workerTrees]) {
        if (!existsSync(tree.path)) workerTrees.delete(workerId);
      }
      return Promise.resolve(Object.freeze([...result.removed].sort()));
    },
  };
}

/* ------------------------------------------------------------------ *
 * The modules, for a caller that needs one operation on its own.
 * ------------------------------------------------------------------ */

export {
  FIXED_COMMIT as STORE_COMMIT,
  freshIndexFile,
  indexInfoLine,
  inStore,
  listTree,
  objectIdOfBytes,
  objectIsPresent,
  readObject,
  storeBytes,
  treeByPath,
  writeTreeFromEntries,
  writeTreeFromLines,
  type StoreTreeEntry,
} from "./git.ts";

export {
  GROUNDING_RUNS_ON_A_SNAPSHOT,
  IGNORE_FILE,
  IGNORE_RULES_DIRECTORY,
  REPOSITORY_DIRECTORY,
  VERIFICATION_RUNS_ON,
  WORKSPACE_PART,
  copyUnreachableObjects,
  fingerprintScope,
  ignoreFilesOfTree,
  ignoreRulesDirectory,
  indexInfoLineForPath,
  isIgnoreFile,
  isRepositoryDirectory,
  isWorkspacePart,
  objectsNoReferenceOfTheProjectReaches,
  objectsReachableFromAReferenceOf,
  pathsIgnoredByTheRulesOf,
  snapshot,
  storeCommitOf,
  takeASnapshot,
  type SnapshotDetail,
  type SnapshotOptions,
  type UnreachableObjects,
} from "./snapshot.ts";

export {
  THE_GROUP_IS_REFUSED,
  THE_LAYER_IS_OFF_FOR,
  VERIFIED_BEFORE,
  missingObjectsOfTheTree,
  verifyBeforeMaterialize,
  verifyBeforeTheApplication,
  verifyEveryObjectIsPresent,
  type Verification,
  type VerifiedBefore,
} from "./verify.ts";

export {
  ALTERNATES_FILE,
  A_SEED_PATH_IS_LINKED,
  A_SEED_PATH_IS_SHARED_WRITABLE,
  BITS_BEYOND_THE_OWNER,
  OPAQUE_COMPONENT_BYTES,
  OWNER_ONLY_DIRECTORY,
  OWNER_ONLY_EXECUTABLE,
  OWNER_ONLY_FILE,
  ObjectMissingFromTheStore,
  SOURCES_OF_SEED_PATHS,
  TEMPORARY_COMPONENT,
  TREE_COMPONENT,
  alternatesFileOf,
  borrowState,
  borrowsTheStoreReadOnly,
  copySeedPaths,
  everyObjectIsPresent,
  giveItARepositoryOfItsOwn,
  homeOfAWorkerTree,
  makeOwnerOnly,
  materialize,
  objectsOfTheStore,
  opaqueComponent,
  ownerOnly,
  pathIsOpaqueUnderTheWorkerRoot,
  pathNamesAnOrdinal,
  pathsBeyondTheOwner,
  remotesOfRepository,
  repositoryDirectoryOf,
  seedPathOf,
  workerRootIsOutside,
  type BorrowState,
  type MaterializeOptions,
  type MaterializedTree,
  type SeedPath,
} from "./materialize.ts";

export {
  KINDS,
  NO_RENAMES,
  changed,
  isDroppedFromEveryDelta,
  kindOfRawChange,
  parseRawDiff,
  type DeltaExclusions,
} from "./changed.ts";

export {
  CONTENT_IS_MERGED,
  THE_ORDER_OF_COMPLETION_HAS_AN_EFFECT,
  THE_ORDER_THAT_DECIDES,
  compose,
  composedEntries,
} from "./compose.ts";

export {
  APPLICATION_REFUSAL_REASONS,
  ApplicationRefused,
  FORWARD_ONLY,
  KIND_AFTER_THE_APPLICATION,
  NEVER_DONE_TO_THE_WORKSPACE,
  NEVER_UNDONE,
  RECORDED_BEFORE_IT_IS_MADE,
  WRITE_AHEAD_KIND,
  applicationPlan,
  applyComposedTree,
  pathIsForbidden,
  pathsThatAreNotAudited,
  workspaceDiffersFromTheBase,
  type ApplicationPlan,
  type ApplicationRefusalReason,
  type ApplicationResult,
  type ApplyOptions,
  type Difference,
  type PlannedPath,
} from "./apply.ts";

export {
  ARGUMENTS_THE_CALLER_MAY_NOT_PASS,
  AWriteOutsideThePlaces,
  COMMANDS_THAT_WRITE_A_REPOSITORY,
  FIXED_ARGV_PREFIX,
  FIXED_COMMIT,
  FIXED_CONFIG,
  FIXED_ENVIRONMENT_VARIABLES,
  GIT,
  GIT_EXECUTABLE_VARIABLE,
  GitCallFailed,
  NEUTRAL_HOME,
  NO_OPTIONAL_LOCKS,
  OUTPUT_CAP_BYTES,
  PLACES_A_CALL_MAY_WRITE,
  STORE_CONFIGURATION_FILE,
  STORE_CONFIGURATION_HASH,
  STORE_CONFIGURATION_HASH_FILE,
  StoreConfigurationChanged,
  THE_ONE_PLACE,
  THE_PROJECTS_REPOSITORY_IS_NEVER_WRITTEN,
  TIME_LIMIT_MS,
  argvOf,
  commandWritesARepository,
  compareTheStoreConfigurationWithItsHash,
  fixedEnvironment,
  gitExecutable,
  gitOutput,
  hashOfBytes,
  initializeARepositoryOfTheRuntime,
  initializeAWorkerRepository,
  initializeTheStore,
  placeOfThePath,
  readInDirectory,
  recordTheStoreConfiguration,
  recordedStoreConfigurationHash,
  runGit,
  storeConfigurationHash,
  storeConfigurationHashPath,
  storeConfigurationPath,
  theCommandOf,
  theVersionOnly,
  tryGit,
  tryInStore,
  type GitCall,
  type GitResult,
  type PlaceACallMayWrite,
  type StoreConfigurationComparison,
} from "./git.ts";

export {
  GIT_CHECK_GROUP,
  GIT_CHECK_ID,
  GIT_CHECK_MESSAGE_TEMPLATE,
  GIT_CHECK_FIX_HINT,
  GIT_CHECK_ORDER,
  GIT_DOCTOR_CHECK,
  GIT_EXECUTABLE,
  GIT_FLOOR,
  GIT_FLOOR_SOURCE,
  GIT_FLOOR_VERSION_PROBED,
  PROBE_OUTPUT_CAP_BYTES,
  PROBE_TIME_LIMIT_MS,
  RUN_TOKEN_HOLDERS_CHECK_FIX_HINT,
  RUN_TOKEN_HOLDERS_CHECK_GROUP,
  RUN_TOKEN_HOLDERS_CHECK_ID,
  RUN_TOKEN_HOLDERS_CHECK_MESSAGE_TEMPLATE,
  RUN_TOKEN_HOLDERS_CHECK_ORDER,
  RUN_TOKEN_HOLDERS_UNOBSERVED,
  STORE_CONFIGURATION_HASH_CHECK_FIX_HINT,
  STORE_CONFIGURATION_HASH_CHECK_GROUP,
  STORE_CONFIGURATION_HASH_CHECK_ID,
  STORE_CONFIGURATION_HASH_CHECK_MESSAGE_TEMPLATE,
  STORE_CONFIGURATION_HASH_CHECK_ORDER,
  WORKER_CACHES_CHECK_FIX_HINT,
  WORKER_CACHES_CHECK_GROUP,
  WORKER_CACHES_CHECK_ID,
  WORKER_CACHES_CHECK_MESSAGE_TEMPLATE,
  WORKER_CACHES_CHECK_ORDER,
  WORKER_CACHES_REQUIRED,
  checksOfThisPackage,
  compareVersions,
  findingOf,
  gitDoctorCheck,
  gitSeverity,
  meetsTheGitFloor,
  observeStoreConfigurationHash,
  probeGit,
  readObservation,
  readRunTokenHoldersObservation,
  registerGitDoctorChecks,
  registerTheDoctorChecksOfTheFeature,
  runTokenHoldersDoctorCheck,
  runTokenHoldersSeverity,
  runTokenHoldersState,
  stateOf,
  storeConfigurationHashDoctorCheck,
  storeConfigurationHashSeverity,
  storeConfigurationHashState,
  versionComponents,
  versionFromOutput,
  workerCachesDoctorCheck,
  workerCachesSeverity,
  workerCachesStateLabel,
  workerCachesStateOf,
  type DoctorCheckRegistry,
  type GitObservation,
  type RunTokenHoldersObservation,
  type StoreConfigurationHashObservation,
} from "./doctor.ts";

export {
  A_STALE_TREE_IS_KEYED_BY,
  ARemovalOutsideTheWorkerRoot,
  RELEASE_REMOVES,
  RELEASE_WRITES,
  TREE_INDEX_FILE,
  TREES_ARE_REMOVED_AT_GROUP_CLOSE_ON,
  recordTheOwnerOfATree,
  releaseAWorkerTree,
  releaseTheTreesOfTheGroup,
  removeAStaleTree,
  removeUnderTheWorkerRoot,
  staleTreesOf,
  treeIndexPath,
  treesOfTheGroup,
  treesOfTheWorkerRoot,
  treesStillHeld,
  type Released,
  type StaleTreeKey,
  type TreeOwnership,
} from "./release.ts";

export {
  AN_ORPHAN_IS,
  ASweepBeforeTheProcessesAreEnded,
  A_TREE_IS_SWEPT_ONLY_AFTER_ITS_PROCESSES_ARE_ENDED,
  REMOVED_AT_RUN_END,
  SNAPSHOTS_LEAVE_THE_STORE_WITH,
  directoriesOfTheWorkerRoot,
  mayBeSwept,
  openGroupsOf,
  snapshotReference,
  sweepOrphansAtEngineStart,
  sweepSnapshotsFromTheStore,
  sweepTheStoreAndTheWorkerRootAtRunEnd,
  type DirectoryOfTheWorkerRoot,
  type SweepRequest,
  type SweepResult,
  type SweptAtRunEnd,
  type SweptSnapshots,
  type SweptTrees,
} from "./sweep.ts";
