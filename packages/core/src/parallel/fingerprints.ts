/**
 * T082 and T083 — the fingerprints of a group and the frozen workspace
 * (feature 142, `packages/core/src/parallel/`).
 *
 * T082 (F142-FR-063; rules PU-53, PU-94): the seven fingerprints of a group
 * are all recorded in the ledger, lettered as the requirement letters them —
 * (a) the workspace at group start, equal to the base snapshot; (b) each
 * worker tree after creation, equal to (a) in the scope of the snapshot;
 * (c) each worker tree at its end, which is its final snapshot; (d) the
 * workspace at the barrier; (e) the workspace after the application, equal to
 * the integrated tree **apart from the single-writer files** (PU-94); (f) and
 * (g) the workspace before and after the merge check. The protected set is
 * compared at (d) against (a).
 *
 * T083 (F142-FR-064; rule PU-54): the workspace is frozen during a group — no
 * pass of the main line, no check and no job of the runtime runs in it between
 * group start and the barrier. If the workspace at the barrier differs from
 * the workspace at group start, **nothing is applied**, every worker of the
 * group is refused with `workspace-changed`, the group counts as failed, and
 * the integrity kind `tree-changed-outside-pass` is raised.
 *
 * The module is pure: the fingerprints arrive as values the engine computed
 * (IR-31) and it writes no ledger record itself (F142-FR-074). The package is
 * `core` in the package graph, so `node:fs` is forbidden to it.
 */
import { rowOf } from "@specstride/contracts/enums";

import type { DeltaRefusalReason, WorkerAuditVerdict } from "./audits.ts";

/* ================================================================== *
 * 1. The seven fingerprints, lettered as F142-FR-063 letters them.
 * ================================================================== */

/** The seven stages a fingerprint of a group is taken at (F142-FR-063). */
export const FINGERPRINT_STAGES = Object.freeze([
  "workspace-at-group-start",
  "worker-tree-after-creation",
  "worker-tree-at-its-end",
  "workspace-at-the-barrier",
  "workspace-after-the-application",
  "workspace-before-the-merge-check",
  "workspace-after-the-merge-check",
] as const);
export type FingerprintStage = (typeof FINGERPRINT_STAGES)[number];

/** The letters of F142-FR-063, in the order of the stages. */
export const FINGERPRINT_LETTERS = Object.freeze(["a", "b", "c", "d", "e", "f", "g"] as const);
export type FingerprintLetter = (typeof FINGERPRINT_LETTERS)[number];

/** The stage of a letter (F142-FR-063). */
export const STAGE_OF_THE_LETTER: Readonly<Record<FingerprintLetter, FingerprintStage>> =
  Object.freeze({
    a: "workspace-at-group-start",
    b: "worker-tree-after-creation",
    c: "worker-tree-at-its-end",
    d: "workspace-at-the-barrier",
    e: "workspace-after-the-application",
    f: "workspace-before-the-merge-check",
    g: "workspace-after-the-merge-check",
  });

/** The letter of a stage: the inverse of `STAGE_OF_THE_LETTER`. */
export const LETTER_OF_THE_STAGE: Readonly<Record<FingerprintStage, FingerprintLetter>> =
  Object.freeze(
    Object.fromEntries(
      FINGERPRINT_LETTERS.map((letter) => [STAGE_OF_THE_LETTER[letter], letter]),
    ) as Record<FingerprintStage, FingerprintLetter>,
  );

/** The two letters that are taken once per **worker** and not once per group. */
export const PER_WORKER_LETTERS = Object.freeze(["b", "c"] as const);

/** True where the letter is recorded once per worker of the group. */
export function isPerWorker(letter: FingerprintLetter): boolean {
  return (PER_WORKER_LETTERS as readonly string[]).includes(letter);
}

/** What one worker contributes to the fingerprints of a group. */
export type WorkerFingerprints = {
  readonly workerId: string;
  /** (b) the worker tree after creation. */
  readonly afterCreation: string;
  /** (c) the worker tree at its end, which is its final snapshot. */
  readonly atItsEnd: string;
  /**
   * (b) is equal to (a) **in the scope of the snapshot**: where the worker tree
   * holds something the snapshot did not cover, the two fingerprints differ for
   * a reason that is no breach. The engine reports the fingerprint of the tree
   * restricted to the snapshot scope here.
   */
  readonly afterCreationInTheSnapshotScope?: string;
  /** The tree id of the final snapshot the store took of this worker's tree. */
  readonly finalSnapshotTreeId?: string;
  /** The fingerprint of the tree read again at the barrier (PU-96). */
  readonly atTheBarrier?: string;
};

/** Every fingerprint of one group, as the engine recorded them (F142-FR-063). */
export type GroupFingerprints = {
  readonly groupId: string;
  /** (a) the workspace at group start. */
  readonly workspaceAtGroupStart: string;
  /** The base snapshot (a) must equal. */
  readonly baseSnapshot: string;
  readonly workers: readonly WorkerFingerprints[];
  /** (d) the workspace at the barrier. */
  readonly workspaceAtTheBarrier: string;
  /** (e) the workspace after the application; absent where nothing was applied. */
  readonly workspaceAfterTheApplication?: string;
  /** The integrated tree (e) must equal apart from the single-writer files. */
  readonly integratedTree?: string;
  /** (e) compared apart from the single-writer files (PU-94). */
  readonly workspaceAfterTheApplicationApartFromSingleWriterFiles?: string;
  readonly integratedTreeApartFromSingleWriterFiles?: string;
  /** (f) and (g), absent where the merge check did not run. */
  readonly workspaceBeforeTheMergeCheck?: string;
  readonly workspaceAfterTheMergeCheck?: string;
};

/** The letters a record of the fingerprints of a group does not hold. */
export function lettersNotRecorded(
  fingerprints: GroupFingerprints,
  options: { readonly applied: boolean; readonly mergeCheckRan: boolean },
): readonly FingerprintLetter[] {
  const missing: FingerprintLetter[] = [];
  if (fingerprints.workspaceAtGroupStart.length === 0) missing.push("a");
  if (fingerprints.workers.length === 0) missing.push("b", "c");
  else {
    if (fingerprints.workers.some((worker) => worker.afterCreation.length === 0)) missing.push("b");
    if (fingerprints.workers.some((worker) => worker.atItsEnd.length === 0)) missing.push("c");
  }
  if (fingerprints.workspaceAtTheBarrier.length === 0) missing.push("d");
  if (options.applied && (fingerprints.workspaceAfterTheApplication ?? "").length === 0) {
    missing.push("e");
  }
  if (options.mergeCheckRan) {
    if ((fingerprints.workspaceBeforeTheMergeCheck ?? "").length === 0) missing.push("f");
    if ((fingerprints.workspaceAfterTheMergeCheck ?? "").length === 0) missing.push("g");
  }
  return Object.freeze(missing);
}

/* ================================================================== *
 * 2. The equalities F142-FR-063 asserts.
 * ================================================================== */

/** The equalities of F142-FR-063, each named as the requirement names it. */
export const EQUALITIES = Object.freeze([
  "(a) equals the base snapshot",
  "(b) equals (a) in the scope of the snapshot",
  "(c) is the final snapshot of that worker",
  "(e) equals the integrated tree apart from the single-writer files",
] as const);
export type Equality = (typeof EQUALITIES)[number];

/** One equality that does not hold, with what was compared. */
export type BrokenEquality = {
  readonly equality: Equality;
  readonly workerId?: string;
  readonly left: string;
  readonly right: string;
};

/**
 * The equalities of F142-FR-063 that do not hold (T082). Empty on a group that
 * ran as the requirement describes.
 *
 * (b) is compared in the scope of the snapshot, so the engine's reading of the
 * tree restricted to that scope is used where it gave one; (e) is compared
 * apart from the single-writer files (PU-94), likewise. Where the engine gave
 * no restricted reading the plain fingerprints are compared, which is the
 * stricter test of the two.
 */
export function brokenEqualities(fingerprints: GroupFingerprints): readonly BrokenEquality[] {
  const broken: BrokenEquality[] = [];
  if (fingerprints.workspaceAtGroupStart !== fingerprints.baseSnapshot) {
    broken.push(
      Object.freeze({
        equality: EQUALITIES[0],
        left: fingerprints.workspaceAtGroupStart,
        right: fingerprints.baseSnapshot,
      }),
    );
  }
  for (const worker of fingerprints.workers) {
    const left = worker.afterCreationInTheSnapshotScope ?? worker.afterCreation;
    if (left !== fingerprints.workspaceAtGroupStart) {
      broken.push(
        Object.freeze({
          equality: EQUALITIES[1],
          workerId: worker.workerId,
          left,
          right: fingerprints.workspaceAtGroupStart,
        }),
      );
    }
    if (worker.finalSnapshotTreeId !== undefined && worker.atTheBarrier !== undefined) {
      if (worker.atTheBarrier !== worker.atItsEnd) {
        broken.push(
          Object.freeze({
            equality: EQUALITIES[2],
            workerId: worker.workerId,
            left: worker.atTheBarrier,
            right: worker.atItsEnd,
          }),
        );
      }
    }
  }
  const applied = fingerprints.workspaceAfterTheApplication;
  const integrated = fingerprints.integratedTree;
  if (applied !== undefined && integrated !== undefined) {
    const left = fingerprints.workspaceAfterTheApplicationApartFromSingleWriterFiles ?? applied;
    const right = fingerprints.integratedTreeApartFromSingleWriterFiles ?? integrated;
    if (left !== right) {
      broken.push(Object.freeze({ equality: EQUALITIES[3], left, right }));
    }
  }
  return Object.freeze(broken);
}

/**
 * PU-96 — the worker trees that changed after their final snapshot: each gives
 * the event `worker-tree-changed-after-end`, which the critic never sees, and
 * that worker is refused with `tree-changed-after-end`.
 */
export function workerTreesChangedAfterTheirEnd(
  fingerprints: GroupFingerprints,
): readonly string[] {
  return Object.freeze(
    fingerprints.workers
      .filter(
        (worker) => worker.atTheBarrier !== undefined && worker.atTheBarrier !== worker.atItsEnd,
      )
      .map((worker) => worker.workerId),
  );
}

/* ================================================================== *
 * 3. The protected set is compared at (d) against (a) (F142-FR-063).
 * ================================================================== */

/** The fingerprint of one protected path at one stage. */
export type ProtectedPathReading = { readonly path: string; readonly fingerprint: string };

/**
 * The protected paths that differ between (d) and (a) (F142-FR-063). A
 * difference here is a change of the protected set that no worker's delta
 * carried: it was made in the workspace while the group ran, which
 * F142-FR-064 forbids.
 */
export function protectedPathsChangedDuringTheGroup(
  atGroupStart: readonly ProtectedPathReading[],
  atTheBarrier: readonly ProtectedPathReading[],
): readonly string[] {
  const start = new Map(atGroupStart.map((entry) => [entry.path, entry.fingerprint]));
  const barrier = new Map(atTheBarrier.map((entry) => [entry.path, entry.fingerprint]));
  const changed: string[] = [];
  for (const [path, fingerprint] of start) {
    if (barrier.get(path) !== fingerprint) changed.push(path);
  }
  for (const [path] of barrier) {
    if (!start.has(path)) changed.push(path);
  }
  return Object.freeze([...new Set(changed)].sort());
}

/** The two stages the protected set is compared at (F142-FR-063). */
export const PROTECTED_SET_IS_COMPARED_AT = Object.freeze(["d", "a"] as const);

/* ================================================================== *
 * 4. The frozen workspace (T083, F142-FR-064, PU-54).
 * ================================================================== */

/** F142-FR-064 — what may run in the workspace between group start and the barrier. */
export const MAY_RUN_IN_THE_WORKSPACE_DURING_A_GROUP = Object.freeze([] as const);

/** What F142-FR-064 names as forbidden in the workspace while a group runs. */
export const FROZEN_AGAINST = Object.freeze([
  "a pass of the main line",
  "a check",
  "a job of the runtime",
] as const);

/** The row of annex X §X.6 that holds the integrity kinds that reach the critic. */
export const INTEGRITY_KIND_ROW = 65 as const;

/** The neutral integrity kind a changed workspace raises (F142-FR-064, PU-83). */
export const TREE_CHANGED_OUTSIDE_PASS = "tree-changed-outside-pass" as const;

/** True where row 65 of annex X §X.6 holds the kind. */
export function rowHoldsTheKind(kind: string): boolean {
  return (rowOf(INTEGRITY_KIND_ROW)?.literals ?? []).includes(kind);
}

/** The reason every worker of a group is refused with when the workspace changed. */
export const WORKSPACE_CHANGED: DeltaRefusalReason = "workspace-changed";

/** What the decision of F142-FR-064 needs: the two fingerprints and the workers. */
export type FrozenWorkspaceInput = {
  readonly fingerprints: GroupFingerprints;
  /** The workers of the group, in the order of the tasks at launch. */
  readonly workerIds: readonly string[];
  /** The protected paths read at (a) and at (d), where the engine read them. */
  readonly protectedAtGroupStart?: readonly ProtectedPathReading[];
  readonly protectedAtTheBarrier?: readonly ProtectedPathReading[];
};

/** What F142-FR-064 decides about a group at its barrier. */
export type FrozenWorkspaceDecision = {
  /** False where the workspace at the barrier differs from the workspace at (a). */
  readonly frozen: boolean;
  /** Nothing is applied where the workspace changed (F142-FR-064). */
  readonly apply: boolean;
  /** Every worker of the group, refused with `workspace-changed`, or none. */
  readonly verdicts: readonly WorkerAuditVerdict[];
  /** A group whose workspace changed counts as failed (F142-FR-023). */
  readonly groupCountsAsFailed: boolean;
  /** The integrity kinds raised, by kind and without a count (F142-FR-066). */
  readonly integrityKinds: readonly string[];
  /** The protected paths that changed between (a) and (d), where any did. */
  readonly protectedPathsChanged: readonly string[];
  readonly detail: string;
};

/**
 * Decide at the barrier whether the workspace stayed frozen during the group
 * (T083, F142-FR-064).
 *
 * The comparison is the one the requirement names: the workspace at the barrier
 * (d) against the workspace at group start (a). Where they differ nothing is
 * applied, every worker of the group — not only the one that could have done
 * it — is refused with `workspace-changed`, the group counts as failed, and
 * the neutral kind `tree-changed-outside-pass` is raised. Where they agree the
 * group goes on to the application and nothing is raised.
 */
export function frozenWorkspace(input: FrozenWorkspaceInput): FrozenWorkspaceDecision {
  const { fingerprints } = input;
  const changed = fingerprints.workspaceAtTheBarrier !== fingerprints.workspaceAtGroupStart;
  const protectedPathsChanged =
    input.protectedAtGroupStart === undefined || input.protectedAtTheBarrier === undefined
      ? Object.freeze([])
      : protectedPathsChangedDuringTheGroup(
          input.protectedAtGroupStart,
          input.protectedAtTheBarrier,
        );
  if (!changed) {
    return Object.freeze({
      frozen: true,
      apply: true,
      verdicts: Object.freeze([]),
      groupCountsAsFailed: false,
      integrityKinds: Object.freeze([]),
      protectedPathsChanged,
      detail: "the workspace at the barrier equals the workspace at group start",
    });
  }
  return Object.freeze({
    frozen: false,
    apply: false,
    verdicts: Object.freeze(
      input.workerIds.map((workerId) =>
        Object.freeze({
          workerId,
          verdict: Object.freeze({ refused: WORKSPACE_CHANGED }),
          detail: "the workspace changed during the group; nothing of this delta is applied",
          dropped: Object.freeze([]),
          paths: Object.freeze([]),
          authorisedProtectedChanges: Object.freeze([]),
        }),
      ),
    ),
    groupCountsAsFailed: true,
    integrityKinds: Object.freeze([TREE_CHANGED_OUTSIDE_PASS]),
    protectedPathsChanged,
    detail:
      "the workspace at the barrier differs from the workspace at group start: " +
      "nothing is applied and every worker of the group is refused",
  });
}

/**
 * Apply nothing: the paths the application would write when the workspace
 * changed during the group (F142-FR-064). Empty, always — the function exists
 * so that the engine asks it instead of deciding for itself, and so that a test
 * can assert the emptiness on the decision itself.
 */
export function pathsToApply(
  decision: FrozenWorkspaceDecision,
  composed: readonly string[],
): readonly string[] {
  return decision.apply ? Object.freeze([...composed]) : Object.freeze([]);
}
