/**
 * T075 to T079 and T087 — the audits of a delta (feature 142,
 * `packages/core/src/parallel/`).
 *
 * The engine runs these before composition. Each takes the delta of **one**
 * worker as the tree-store operation `changed` reported it and says whether
 * that worker's delta is accepted, or refused with exactly one reason of the
 * closed set of annex X §X.6 row 63 (F142-FR-058).
 *
 *  - T075 (F142-FR-054; rule PU-43) **scope audit**: every path of a delta —
 *    added, changed, deleted, mode changed — lies inside the scope of the
 *    worker; a symbolic link whose target resolves outside the tree is a
 *    violation; one violation refuses the worker; the audit reads the store
 *    and nothing in the directory of a worker.
 *  - T076 (F142-FR-055; rule PU-44) **protected-set audit**: a delta that
 *    changes, adds or deletes a path of the protected set without
 *    authorisation from the text, as read at launch, of the task assigned to
 *    that worker is refused. An authorised change is integrated and becomes a
 *    fact for the critic as on the serial path.
 *  - T077 (F142-FR-056; rule PU-82) **path-leak audit**: before integration
 *    every added or changed object of a delta is searched for the real path of
 *    the worker root, of the store and of the control plane, and for the
 *    opaque token of the worker. A hit refuses the delta with the reason
 *    `path-leak`.
 *  - T078 (F142-FR-057; rules PU-45, PU-94) **single-writer files**: the task
 *    list, the phase evidence, the notebook, the handoff and anything under
 *    the workspace part are dropped from every delta, and a change to one by a
 *    worker is not a violation.
 *  - T079 (F142-FR-058) **one refusal reason**: `auditADelta` returns one
 *    verdict per worker, and a refused verdict carries exactly one member of
 *    row 63.
 *  - T087 (F142-FR-068; ruling P9) **file times**: the application sets no
 *    file time; that the files of an applied delta carry nearly the same
 *    modification time is accepted and named in the divergence register as
 *    row DV-086. `fileTimesSetByTheApplication` asserts it on the result of a
 *    group.
 *
 * The module is pure: it reads no file and starts no process. The package is
 * `core` in the package graph, so `node:fs` is forbidden to it, which is how
 * "the audit reads the store and nothing in the directory of a worker" holds
 * by construction rather than by discipline — the delta, the objects and the
 * file times all arrive as values the engine read through the contracts.
 */
import { rowOf } from "@specstride/contracts/enums";
import type { ChangeKind } from "@specstride/contracts/ep/tree-store";

/* ================================================================== *
 * 1. The closed set of refusal reasons (T079, F142-FR-058, row 63).
 * ================================================================== */

/** The number of the row of annex X §X.6 that holds the refusal reasons. */
export const REFUSAL_REASON_ROW = 63 as const;

/**
 * The refusal reasons of a delta, read from row 63 of annex X §X.6 so that
 * this module and the table cannot drift (F142-FR-058).
 */
export const DELTA_REFUSAL_REASONS = Object.freeze([
  "scope",
  "protected",
  "overlap",
  "path-leak",
  "checkpoint",
  "yield",
  "tree-changed-after-end",
  "workspace-changed",
] as const);
export type DeltaRefusalReason = (typeof DELTA_REFUSAL_REASONS)[number];

/** True where the text is one of the eight reasons of row 63. */
export function isADeltaRefusalReason(value: string): value is DeltaRefusalReason {
  return (DELTA_REFUSAL_REASONS as readonly string[]).includes(value);
}

/**
 * The members row 63 of the table of annex X §X.6 holds, or an empty list
 * where the table has no such row. `refusalReasonDrift` compares the two.
 */
export function refusalReasonsOfRow63(): readonly string[] {
  return rowOf(REFUSAL_REASON_ROW)?.literals ?? Object.freeze([]);
}

/**
 * The difference between the reasons of this module and the members of row 63:
 * empty where the two agree (F142-FR-058).
 */
export function refusalReasonDrift(): readonly string[] {
  const row = refusalReasonsOfRow63();
  const drift: string[] = [];
  for (const reason of DELTA_REFUSAL_REASONS) {
    if (!row.includes(reason)) drift.push(`row ${REFUSAL_REASON_ROW} is missing "${reason}"`);
  }
  for (const member of row) {
    if (!isADeltaRefusalReason(member)) {
      drift.push(`row ${REFUSAL_REASON_ROW} holds "${member}", which this module does not`);
    }
  }
  return Object.freeze(drift);
}

/** The cell "unknown value" of row 63: a reason outside the set refuses the delta. */
export const REFUSAL_WHEN_THE_REASON_IS_UNKNOWN: DeltaRefusalReason = "scope";

/** The verdict of the audits on one delta: accepted, or one reason of row 63. */
export type AuditVerdict = "accepted" | { readonly refused: DeltaRefusalReason };

/** The verdict of the audits for one worker, with the detail that explains it. */
export type WorkerAuditVerdict = {
  readonly workerId: string;
  readonly verdict: AuditVerdict;
  /** Why, in words, for the event of the worker and the ledger. Never for a critic. */
  readonly detail: string;
  /** The paths dropped as single-writer files, which are no violation (F142-FR-057). */
  readonly dropped: readonly string[];
  /** The paths that remain in the delta after the drop, in the order of the delta. */
  readonly paths: readonly string[];
  /** The protected paths this delta changed with authorisation (F142-FR-055). */
  readonly authorisedProtectedChanges: readonly string[];
};

/** One reason of the closed set, and never two (F142-FR-058). */
export function refusalOf(verdict: AuditVerdict): DeltaRefusalReason | undefined {
  return verdict === "accepted" ? undefined : verdict.refused;
}

/** True where the verdict accepted the delta. */
export function isAccepted(verdict: AuditVerdict): verdict is "accepted" {
  return verdict === "accepted";
}

/* ================================================================== *
 * 2. What the audits are given, and where it comes from.
 * ================================================================== */

/**
 * The two places a delta could be read from. The audits read the store
 * (F142-FR-054): a delta offered from the directory of a worker is refused
 * before any audit runs, because the directory is still writable by that
 * worker and nothing read from it can be trusted.
 */
export const DELTA_SOURCES = Object.freeze(["store", "worker-directory"] as const);
export type DeltaSource = (typeof DELTA_SOURCES)[number];

/** The one source the audits accept (F142-FR-054, PU-43). */
export const THE_AUDITS_READ: DeltaSource = "store";

/** The operation of the tree store through which a delta is read (annex D §D.2). */
export const DELTA_IS_READ_THROUGH = "changed" as const;

/** The message a delta offered from the directory of a worker is refused with. */
export const DELTA_NOT_FROM_THE_STORE =
  "the audits read the store and nothing in the directory of a worker (F142-FR-054)" as const;

/**
 * One path of a delta as the audits need it: the kind the tree-store operation
 * `changed` gave it, and, where the path is a symbolic link, where its target
 * resolves (F142-FR-054).
 */
export type AuditedPath = {
  readonly path: string;
  readonly kind: ChangeKind;
  /** Set where the path is a symbolic link in the worker's final snapshot. */
  readonly symbolicLink?: {
    readonly target: string;
    /** Whether the target resolves outside the tree the snapshot was taken of. */
    readonly resolvesOutsideTheTree: boolean;
  };
  /**
   * The text of the object at this path in the worker's final snapshot, where
   * the kind is `added` or `changed`: the path-leak audit searches it
   * (F142-FR-056). A binary object arrives as its text or not at all.
   */
  readonly text?: string;
};

/** The delta of one worker, as the store reported it. */
export type WorkerDelta = {
  readonly workerId: string;
  /** The tree id of the worker's final snapshot. */
  readonly treeId: string;
  readonly paths: readonly AuditedPath[];
  /** Where these paths were read: `store`, or the audits refuse to run. */
  readonly source: DeltaSource;
};

/** The kinds of change the path-leak audit searches (F142-FR-056). */
export const SEARCHED_KINDS = Object.freeze(["added", "changed"] as const);

/** True where an object of this kind is searched for a leak (F142-FR-056). */
export function isSearched(kind: ChangeKind): boolean {
  return (SEARCHED_KINDS as readonly string[]).includes(kind);
}

/* ================================================================== *
 * 3. The scope audit (T075, F142-FR-054, PU-43).
 * ================================================================== */

/** The separator of a path prefix of a write scope (F142-FR-009). */
export const SEPARATOR = "/" as const;

/** An empty prefix list means the whole tree and covers every path. */
export const WHOLE_TREE_COVERS_EVERY_PATH = true as const;

/**
 * Fold a path for comparison where the file system ignores case
 * (F142-FR-009). The same rule the planner's scope module applies on the
 * other side of the package boundary; `ct-142-154-scope-audit.test.ts` asserts
 * that the two agree on the same inputs.
 */
export function foldForComparison(value: string, caseFolds: boolean): string {
  const normalised = value.normalize("NFC");
  return caseFolds ? normalised.toLowerCase() : normalised;
}

/**
 * True where the prefix covers the path, compared **at path boundaries**, so
 * that `src/a` does not cover `src/ab` (F142-FR-009). An empty prefix is the
 * whole tree.
 */
export function prefixCoversPath(prefix: string, path: string, caseFolds = false): boolean {
  if (prefix.length === 0) return true;
  const p = foldForComparison(prefix, caseFolds);
  const q = foldForComparison(path, caseFolds);
  return q === p || q.startsWith(`${p}${SEPARATOR}`);
}

/** True where the path lies inside the scope: an empty scope is the whole tree. */
export function pathIsInsideScope(
  path: string,
  prefixes: readonly string[],
  caseFolds = false,
): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => prefixCoversPath(prefix, path, caseFolds));
}

/** One violation the scope audit found, with the reason it is one. */
export type ScopeViolation = {
  readonly path: string;
  readonly kind: ChangeKind;
  /** `outside-the-scope`, or `link-leaves-the-tree` for a symbolic link. */
  readonly because: "outside-the-scope" | "link-leaves-the-tree";
  /** For a link: the target that resolves outside the tree. */
  readonly target?: string;
};

/** What the scope audit is given. */
export type ScopeAuditInput = {
  readonly delta: WorkerDelta;
  /** The normalised prefixes of the worker's scope; empty is the whole tree. */
  readonly prefixes: readonly string[];
  /** True on a file system that ignores case (F142-FR-009). */
  readonly caseFolds?: boolean;
};

/**
 * The violations of the scope audit, in the order of the delta (F142-FR-054).
 *
 * Every kind counts — added, changed, deleted and mode changed — and a
 * symbolic link whose target resolves outside the tree is a violation even
 * where its own path lies inside the scope: the write the link stands for
 * leaves the tree.
 */
export function scopeViolations(input: ScopeAuditInput): readonly ScopeViolation[] {
  const caseFolds = input.caseFolds ?? false;
  const found: ScopeViolation[] = [];
  for (const entry of input.delta.paths) {
    if (!pathIsInsideScope(entry.path, input.prefixes, caseFolds)) {
      found.push(
        Object.freeze({
          path: entry.path,
          kind: entry.kind,
          because: "outside-the-scope" as const,
        }),
      );
      continue;
    }
    if (entry.symbolicLink?.resolvesOutsideTheTree === true) {
      found.push(
        Object.freeze({
          path: entry.path,
          kind: entry.kind,
          because: "link-leaves-the-tree" as const,
          target: entry.symbolicLink.target,
        }),
      );
    }
  }
  return Object.freeze(found);
}

/**
 * The scope audit of one worker (T075, F142-FR-054). **One** violation refuses
 * the worker, with the reason `scope`.
 */
export function scopeAudit(input: ScopeAuditInput): {
  readonly verdict: AuditVerdict;
  readonly violations: readonly ScopeViolation[];
} {
  if (input.delta.source !== THE_AUDITS_READ) throw new Error(DELTA_NOT_FROM_THE_STORE);
  const violations = scopeViolations(input);
  return Object.freeze({
    verdict:
      violations.length === 0
        ? ("accepted" as const)
        : Object.freeze({ refused: "scope" as const }),
    violations,
  });
}

/* ================================================================== *
 * 4. The protected-set audit (T076, F142-FR-055, PU-44).
 * ================================================================== */

/**
 * The protected set of the phase as the engine read it: exact paths, and the
 * class A patterns of rule IR-38, which are evaluated on every delta. A
 * pattern is a path with at most one `*`, which stands for any run of
 * characters inside one path segment.
 */
export type ProtectedSet = {
  readonly paths: readonly string[];
  readonly patterns: readonly string[];
};

/** True where the pattern — a path with at most one `*` — matches the path. */
export function patternMatches(pattern: string, path: string, caseFolds = false): boolean {
  const p = foldForComparison(pattern, caseFolds);
  const q = foldForComparison(path, caseFolds);
  const star = p.indexOf("*");
  if (star === -1) return p === q;
  const head = p.slice(0, star);
  const tail = p.slice(star + 1);
  if (!q.startsWith(head) || !q.endsWith(tail)) return false;
  if (q.length < head.length + tail.length) return false;
  // `*` stands for a run inside one segment: the middle holds no separator.
  return !q.slice(head.length, q.length - tail.length).includes(SEPARATOR);
}

/** True where the path is a member of the protected set, by path or by pattern. */
export function isProtected(path: string, set: ProtectedSet, caseFolds = false): boolean {
  if (
    set.paths.some(
      (member) => foldForComparison(member, caseFolds) === foldForComparison(path, caseFolds),
    )
  ) {
    return true;
  }
  return set.patterns.some((pattern) => patternMatches(pattern, path, caseFolds));
}

/** The characters that bound a path where a task text names one. */
const PATH_CHARACTER = /[A-Za-z0-9._/-]/;

/**
 * True where the text of the task, as read at launch, **names** the path: the
 * path itself appears in the text bounded by characters no path holds, or an
 * ancestor directory of it does, written with its trailing separator
 * (F142-FR-055). Nothing else is authorisation: not configuration, not the
 * proposer, not a later reading of the task list.
 */
export function textNamesThePath(text: string, path: string): boolean {
  const candidates = [path, ...ancestorsOf(path)];
  for (const candidate of candidates) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(candidate, from);
      if (at === -1) break;
      const before = at === 0 ? "" : text[at - 1]!;
      const after = text[at + candidate.length] ?? "";
      const bounded =
        (before === "" || !PATH_CHARACTER.test(before)) &&
        (after === "" || !PATH_CHARACTER.test(after) || candidate.endsWith(SEPARATOR));
      if (bounded) return true;
      from = at + 1;
    }
  }
  return false;
}

/** The ancestor directories of a path, each with its trailing separator. */
export function ancestorsOf(path: string): readonly string[] {
  const parts = path.split(SEPARATOR);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    out.push(`${parts.slice(0, i).join(SEPARATOR)}${SEPARATOR}`);
  }
  return Object.freeze(out);
}

/** What the protected-set audit is given. */
export type ProtectedSetAuditInput = {
  readonly delta: WorkerDelta;
  readonly protectedSet: ProtectedSet;
  /** The text of the task assigned to this worker, **as read at launch**. */
  readonly taskTextAtLaunch: string;
  readonly caseFolds?: boolean;
};

/**
 * The protected-set audit of one worker (T076, F142-FR-055).
 *
 * A change, an addition or a deletion of a path of the protected set that the
 * launch-time text of the worker's **assigned** task does not name refuses the
 * delta with the reason `protected`. A change the text does name is
 * **authorised**: it is integrated and becomes a fact for the critic, as on
 * the serial path, which is what `authorised` carries up to the fact block.
 */
export function protectedSetAudit(input: ProtectedSetAuditInput): {
  readonly verdict: AuditVerdict;
  readonly unauthorised: readonly string[];
  readonly authorised: readonly string[];
} {
  if (input.delta.source !== THE_AUDITS_READ) throw new Error(DELTA_NOT_FROM_THE_STORE);
  const caseFolds = input.caseFolds ?? false;
  const unauthorised: string[] = [];
  const authorised: string[] = [];
  for (const entry of input.delta.paths) {
    if (!isProtected(entry.path, input.protectedSet, caseFolds)) continue;
    if (textNamesThePath(input.taskTextAtLaunch, entry.path)) authorised.push(entry.path);
    else unauthorised.push(entry.path);
  }
  return Object.freeze({
    verdict:
      unauthorised.length === 0
        ? ("accepted" as const)
        : Object.freeze({ refused: "protected" as const }),
    unauthorised: Object.freeze(unauthorised),
    authorised: Object.freeze(authorised),
  });
}

/* ================================================================== *
 * 5. The path-leak audit (T077, F142-FR-056, PU-82).
 * ================================================================== */

/** The four subjects every added or changed object is searched for. */
export const PATH_LEAK_SUBJECTS = Object.freeze([
  "worker-root",
  "tree-store",
  "control-plane",
  "worker-token",
] as const);
export type PathLeakSubject = (typeof PATH_LEAK_SUBJECTS)[number];

/**
 * The real paths and the token the search looks for (F142-FR-056). They are
 * values of the run: the engine resolves the logical names `worker-root` and
 * `tree-store` and the control plane, and mints the opaque token of the
 * worker.
 */
export type PathLeakSecrets = {
  readonly workerRoot: string;
  readonly treeStore: string;
  readonly controlPlane: string;
  /** The opaque token of **this** worker (PU-82). */
  readonly workerToken: string;
};

/** The subject of each secret, in the order of the search. */
export function secretsInOrder(
  secrets: PathLeakSecrets,
): readonly { readonly subject: PathLeakSubject; readonly text: string }[] {
  return Object.freeze([
    Object.freeze({ subject: "worker-root" as const, text: secrets.workerRoot }),
    Object.freeze({ subject: "tree-store" as const, text: secrets.treeStore }),
    Object.freeze({ subject: "control-plane" as const, text: secrets.controlPlane }),
    Object.freeze({ subject: "worker-token" as const, text: secrets.workerToken }),
  ]);
}

/** One hit of the path-leak search. */
export type PathLeak = {
  readonly path: string;
  readonly subject: PathLeakSubject;
  /** The text that was found, so that the event can name the subject. */
  readonly found: string;
};

/**
 * Every hit of the path-leak search, over the added and changed objects of the
 * delta and over nothing else (F142-FR-056). A path whose text the store did
 * not hand over is reported as a hit of no subject: it is not searched, so it
 * cannot be cleared — `objectsNotSearched` names those paths.
 */
export function pathLeaks(delta: WorkerDelta, secrets: PathLeakSecrets): readonly PathLeak[] {
  const subjects = secretsInOrder(secrets).filter((entry) => entry.text.length > 0);
  const hits: PathLeak[] = [];
  for (const entry of delta.paths) {
    if (!isSearched(entry.kind)) continue;
    const text = entry.text;
    if (text === undefined) continue;
    for (const subject of subjects) {
      if (text.includes(subject.text)) {
        hits.push(
          Object.freeze({ path: entry.path, subject: subject.subject, found: subject.text }),
        );
      }
    }
  }
  return Object.freeze(hits);
}

/** The added and changed paths whose object the store handed no text for. */
export function objectsNotSearched(delta: WorkerDelta): readonly string[] {
  return Object.freeze(
    delta.paths
      .filter((entry) => isSearched(entry.kind) && entry.text === undefined)
      .map((e) => e.path),
  );
}

/**
 * The path-leak audit of one worker (T077, F142-FR-056). A hit refuses the
 * delta with the reason `path-leak`.
 */
export function pathLeakAudit(input: {
  readonly delta: WorkerDelta;
  readonly secrets: PathLeakSecrets;
}): { readonly verdict: AuditVerdict; readonly leaks: readonly PathLeak[] } {
  if (input.delta.source !== THE_AUDITS_READ) throw new Error(DELTA_NOT_FROM_THE_STORE);
  const leaks = pathLeaks(input.delta, input.secrets);
  return Object.freeze({
    verdict:
      leaks.length === 0 ? ("accepted" as const) : Object.freeze({ refused: "path-leak" as const }),
    leaks,
  });
}

/**
 * F142-FR-056 — the search is by text: it narrows the leak and does not close
 * it, and the documentation of the option must say so. The sentence is here so
 * that the documentation and the code carry one text.
 */
export const THE_SEARCH_NARROWS_THE_LEAK_AND_DOES_NOT_CLOSE_IT = true as const;
export const WHAT_THE_DOCUMENTATION_MUST_SAY =
  "The search for a leaked path is by text. A path that a tool wrote encoded, or " +
  "relative to another root, is not found: the search narrows the leak and does " +
  "not close it (F142-FR-056).";

/* ================================================================== *
 * 6. Single-writer files (T078, F142-FR-057, PU-45, PU-94).
 * ================================================================== */

/** The five kinds of single-writer file F142-FR-057 names. */
export const SINGLE_WRITER_KINDS = Object.freeze([
  "task-list",
  "phase-evidence",
  "notebook",
  "handoff",
  "workspace-part",
] as const);
export type SingleWriterKind = (typeof SINGLE_WRITER_KINDS)[number];

/**
 * The single-writer paths of the run, by kind, as the engine resolved their
 * logical names. `workspacePart` is a directory: everything under it is a
 * single-writer path (F142-FR-057).
 */
export type SingleWriterReading = {
  readonly taskList: string;
  readonly phaseEvidence: readonly string[];
  readonly notebook: string;
  readonly handoff: string;
  /** The part of the control plane that lies under the workspace. */
  readonly workspacePart: string;
};

/** The kind of single-writer file a path is, or `undefined` where it is none. */
export function singleWriterKindOf(
  path: string,
  reading: SingleWriterReading,
  caseFolds = false,
): SingleWriterKind | undefined {
  const same = (a: string, b: string) =>
    a.length > 0 && foldForComparison(a, caseFolds) === foldForComparison(b, caseFolds);
  if (same(reading.taskList, path)) return "task-list";
  if (reading.phaseEvidence.some((evidence) => same(evidence, path))) return "phase-evidence";
  if (same(reading.notebook, path)) return "notebook";
  if (same(reading.handoff, path)) return "handoff";
  if (
    reading.workspacePart.length > 0 &&
    prefixCoversPath(reading.workspacePart, path, caseFolds)
  ) {
    return "workspace-part";
  }
  return undefined;
}

/**
 * F142-FR-057 — a change to a single-writer file by a worker is **not** a
 * violation: the path is dropped and the worker is not refused for it.
 */
export const A_CHANGE_TO_A_SINGLE_WRITER_FILE_IS_A_VIOLATION = false as const;

/**
 * PU-94 — the task list is in every snapshot and is dropped from every delta,
 * so that the staleness check of a worker pass can read it. The drop, and not
 * an exclusion from the snapshot, is what this feature implements.
 */
export const THE_TASK_LIST_IS_IN_EVERY_SNAPSHOT = true as const;
export const SINGLE_WRITER_FILES_ARE_DROPPED_FROM_THE_DELTA = true as const;

/**
 * Drop the single-writer files from a delta (T078, F142-FR-057). The order of
 * the paths that remain is the order of the delta; the dropped paths are
 * returned with the kind that made each one single-writer, for the event.
 */
export function withoutSingleWriterFiles(
  delta: WorkerDelta,
  reading: SingleWriterReading,
  caseFolds = false,
): {
  readonly delta: WorkerDelta;
  readonly dropped: readonly { readonly path: string; readonly kind: SingleWriterKind }[];
} {
  const kept: AuditedPath[] = [];
  const dropped: { path: string; kind: SingleWriterKind }[] = [];
  for (const entry of delta.paths) {
    const kind = singleWriterKindOf(entry.path, reading, caseFolds);
    if (kind === undefined) kept.push(entry);
    else dropped.push({ path: entry.path, kind });
  }
  return Object.freeze({
    delta: Object.freeze({ ...delta, paths: Object.freeze(kept) }),
    dropped: Object.freeze(dropped.map((entry) => Object.freeze(entry))),
  });
}

/* ================================================================== *
 * 7. The audits of one delta, in order (T079, F142-FR-058).
 * ================================================================== */

/** The audits, in the order in which they run on a delta. */
export const AUDIT_ORDER = Object.freeze(["scope", "protected", "path-leak"] as const);
export type Audit = (typeof AUDIT_ORDER)[number];

/** The reason each audit refuses with; one audit, one member of row 63. */
export const REASON_OF_THE_AUDIT: Readonly<Record<Audit, DeltaRefusalReason>> = Object.freeze({
  scope: "scope",
  protected: "protected",
  "path-leak": "path-leak",
});

/**
 * The end of a worker's pass, where it is one of the ends that refuses the
 * delta before any audit reads it (F142-FR-058): no valid checkpoint, a yield
 * artifact, or a tree that changed after its final snapshot (PU-96).
 */
export const ENDS_THAT_REFUSE_BEFORE_THE_AUDITS = Object.freeze([
  "checkpoint",
  "yield",
  "tree-changed-after-end",
] as const);
export type EndThatRefuses = (typeof ENDS_THAT_REFUSE_BEFORE_THE_AUDITS)[number];

/** What the audits of one worker are given, all of it read through the contracts. */
export type AuditInput = {
  readonly delta: WorkerDelta;
  readonly prefixes: readonly string[];
  readonly protectedSet: ProtectedSet;
  readonly taskTextAtLaunch: string;
  readonly secrets: PathLeakSecrets;
  readonly singleWriter: SingleWriterReading;
  readonly caseFolds?: boolean;
  /**
   * Set where the worker's own end already refuses it: no valid checkpoint
   * (`checkpoint`), a yield artifact (`yield`), or a tree that changed after
   * its final snapshot (`tree-changed-after-end`). The audits do not run.
   */
  readonly endRefuses?: EndThatRefuses;
  /**
   * Set where the workspace at the barrier differs from the workspace at
   * group start: every worker of the group is refused with
   * `workspace-changed` and nothing is applied (F142-FR-064).
   */
  readonly workspaceChanged?: boolean;
};

/**
 * Audit the delta of one worker (T075 to T079; F142-FR-054 to F142-FR-058).
 *
 * The single-writer files are dropped first, because a change to one is no
 * violation and must not be able to refuse a worker. Then the three audits run
 * in the order of `AUDIT_ORDER`, and the **first** that refuses gives the one
 * reason the verdict carries: a delta that leaves its scope and also leaks a
 * path is refused once, with `scope`. `overlap` is not raised here — the
 * composition of the tree store raises it (F100-FR-122) — and
 * `workspace-changed` comes from the fingerprints of the group.
 */
export function auditADelta(input: AuditInput): WorkerAuditVerdict {
  if (input.delta.source !== THE_AUDITS_READ) throw new Error(DELTA_NOT_FROM_THE_STORE);
  const caseFolds = input.caseFolds ?? false;
  const { delta, dropped } = withoutSingleWriterFiles(input.delta, input.singleWriter, caseFolds);
  const base = {
    workerId: delta.workerId,
    dropped: Object.freeze(dropped.map((entry) => entry.path)),
    paths: Object.freeze(delta.paths.map((entry) => entry.path)),
  };
  if (input.workspaceChanged === true) {
    return Object.freeze({
      ...base,
      verdict: Object.freeze({ refused: "workspace-changed" as const }),
      detail: "the workspace at the barrier differs from the workspace at group start",
      authorisedProtectedChanges: Object.freeze([]),
    });
  }
  if (input.endRefuses !== undefined) {
    return Object.freeze({
      ...base,
      verdict: Object.freeze({ refused: input.endRefuses }),
      detail: `the end of the worker refuses its delta: ${input.endRefuses}`,
      authorisedProtectedChanges: Object.freeze([]),
    });
  }
  const scope = scopeAudit({ delta, prefixes: input.prefixes, caseFolds });
  if (!isAccepted(scope.verdict)) {
    return Object.freeze({
      ...base,
      verdict: scope.verdict,
      detail: `the delta leaves its scope: ${scope.violations
        .map((violation) => `${violation.path} (${violation.because})`)
        .join(", ")}`,
      authorisedProtectedChanges: Object.freeze([]),
    });
  }
  const guarded = protectedSetAudit({
    delta,
    protectedSet: input.protectedSet,
    taskTextAtLaunch: input.taskTextAtLaunch,
    caseFolds,
  });
  if (!isAccepted(guarded.verdict)) {
    return Object.freeze({
      ...base,
      verdict: guarded.verdict,
      detail: `the text of the task authorises no change of ${guarded.unauthorised.join(", ")}`,
      authorisedProtectedChanges: guarded.authorised,
    });
  }
  const leak = pathLeakAudit({ delta, secrets: input.secrets });
  if (!isAccepted(leak.verdict)) {
    return Object.freeze({
      ...base,
      verdict: leak.verdict,
      detail: `an object of the delta holds the real path or the token of ${leak.leaks
        .map((hit) => hit.subject)
        .join(", ")}`,
      authorisedProtectedChanges: guarded.authorised,
    });
  }
  return Object.freeze({
    ...base,
    verdict: "accepted" as const,
    detail: "every path lies inside the scope; no unauthorised protected change; no leak",
    authorisedProtectedChanges: guarded.authorised,
  });
}

/** Audit every worker of a group, in the order of the tasks at launch. */
export function auditTheGroup(inputs: readonly AuditInput[]): readonly WorkerAuditVerdict[] {
  return Object.freeze(inputs.map((input) => auditADelta(input)));
}

/**
 * The verdicts in which more than one reason was recorded: empty, always
 * (F142-FR-058, "one reason per refused delta"). The function exists so that a
 * test can assert the property over any set of verdicts.
 */
export function verdictsWithMoreThanOneReason(
  verdicts: readonly WorkerAuditVerdict[],
): readonly string[] {
  return Object.freeze(
    verdicts
      .filter((entry) => {
        const reason = refusalOf(entry.verdict);
        return reason !== undefined && !isADeltaRefusalReason(reason);
      })
      .map((entry) => entry.workerId),
  );
}

/* ================================================================== *
 * 8. The application sets no file time (T087, F142-FR-068, ruling P9).
 * ================================================================== */

/** F142-FR-068 — the application sets no file time. */
export const THE_APPLICATION_SETS_FILE_TIMES = false as const;

/** The row of the divergence register that names the clustering (ruling P9). */
export const DIVERGENCE_REGISTER_ROW = "DV-086" as const;

/** Ruling P9 — the clustering of modification times after an application is accepted. */
export const THE_CLUSTERING_IS_ACCEPTED = true as const;

/** The modification time of one path, in milliseconds, as the engine read it. */
export type FileTimeReading = { readonly path: string; readonly modifiedMs: number };

/**
 * The paths whose modification time in the workspace equals the one the object
 * carried in the worker's tree: each is a time the application **set**, which
 * F142-FR-068 forbids. Empty on the result of a group.
 */
export function fileTimesSetByTheApplication(
  inTheWorkspace: readonly FileTimeReading[],
  inTheSource: readonly FileTimeReading[],
): readonly string[] {
  const source = new Map(inTheSource.map((entry) => [entry.path, entry.modifiedMs]));
  return Object.freeze(
    inTheWorkspace
      .filter((entry) => source.get(entry.path) === entry.modifiedMs)
      .map((entry) => entry.path),
  );
}

/**
 * The spread of the modification times of the applied paths, in milliseconds.
 * A small spread is the accepted leak of ruling P9: the function measures it
 * and names the register row; it refuses nothing.
 */
export function clusteringOfTheApplication(applied: readonly FileTimeReading[]): {
  readonly paths: number;
  readonly spreadMs: number;
  readonly accepted: true;
  readonly registerRow: typeof DIVERGENCE_REGISTER_ROW;
} {
  const times = applied.map((entry) => entry.modifiedMs);
  const spreadMs = times.length === 0 ? 0 : Math.max(...times) - Math.min(...times);
  return Object.freeze({
    paths: applied.length,
    spreadMs,
    accepted: true as const,
    registerRow: DIVERGENCE_REGISTER_ROW,
  });
}

/**
 * Assert F142-FR-068 on the result of a group: the application set no file
 * time. The returned list is the breach, and it is empty where the requirement
 * holds; the clustering is reported beside it and is never a breach.
 */
export function assertNoFileTimesSet(input: {
  readonly appliedPaths: readonly string[];
  readonly inTheWorkspace: readonly FileTimeReading[];
  readonly inTheSource: readonly FileTimeReading[];
}): {
  readonly breach: readonly string[];
  readonly clustering: ReturnType<typeof clusteringOfTheApplication>;
} {
  const applied = new Set(input.appliedPaths);
  const workspace = input.inTheWorkspace.filter((entry) => applied.has(entry.path));
  return Object.freeze({
    breach: fileTimesSetByTheApplication(workspace, input.inTheSource),
    clustering: clusteringOfTheApplication(workspace),
  });
}
