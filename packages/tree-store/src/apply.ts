/**
 * T040 — the operation `apply` of the tree store: WRITE EXACTLY THE PATHS OF
 * AUDITED DELTAS, WRITE-AHEAD, ONTO A WORKSPACE EQUAL TO THE BASE (annex D
 * §D.2, row 5; F143-FR-020; rule IR-60 as amended, F100-FR-124; ruling P1).
 *
 * `apply(base, composed, workspace) → paths`. THE ONE OPERATION OF THE SEVEN
 * THAT MAY WRITE A PATH OF THE WORKSPACE (F143-FR-001), and the first of the
 * two writes the runtime makes to the workspace inside a phase attempt; the
 * second is the ticks (F143-FR-021), which go through the spec-format adapter
 * and not through here.
 *
 * THE SEVEN CONDITIONS OF F143-FR-020, each with the thing in this file that
 * keeps it:
 *
 *  1 FORWARD ONLY — `FORWARD_ONLY`. There is no inverse: nothing in this
 *    module can take the workspace back to the base, by design.
 *  2 EXACTLY THE PATHS OF AUDITED DELTAS — `applicationPlan` derives the
 *    paths from the difference between the base and the composed tree, which
 *    by the construction of `compose.ts` is the union of the accepted deltas;
 *    where the caller also hands in the audited paths, `pathsThatAreNotAudited`
 *    compares the two and `apply` REFUSES rather than writing a path no audit
 *    saw.
 *  3 ONLY ONTO A WORKSPACE WHOSE FINGERPRINT EQUALS THE BASE SNAPSHOT —
 *    `workspaceDiffersFromTheBase`, which reads every file of the fingerprint
 *    scope and hashes it WITHOUT STORING IT (`objectIdOfBytes`), so the check
 *    writes nothing at all. A workspace that differs refuses the application.
 *  4 BYTES A PROPOSER WROTE — the bytes come from `cat-file blob` of the
 *    stored object and are written by this process. Nothing is generated,
 *    nothing is merged, no line end is converted (F143-FR-004).
 *  5 NO INDEX, NO REFERENCE, NOTHING UNDER THE REPOSITORY DIRECTORY —
 *    `pathIsForbidden` refuses such a path before any byte is written, and
 *    the application runs no repository process at all: it reads the trees
 *    and then writes files.
 *  6 RECORDED BEFORE IT IS MADE — `apply` calls `recordAhead` with the whole
 *    plan, every path with its base and composed object id, and only then
 *    writes. A caller that hands in no recorder gets the plan back in the
 *    result, so the write-ahead record is never silently skipped.
 *  7 NEVER UNDONE — `NEVER_UNDONE`. A failure part way through leaves what is
 *    written written; the plan on disk is what a resume repeats
 *    (F143-FR-025), and that is why the record comes first.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { TreeId } from "@specstride/contracts/ep/tree-store";
import {
  objectIdOfBytes,
  objectIsPresent,
  readObject,
  treeByPath,
  type StorePlaces,
  type StoreTreeEntry,
} from "./git.ts";
import { fingerprintScope, isRepositoryDirectory, isWorkspacePart } from "./snapshot.ts";
import { verifyBeforeTheApplication } from "./verify.ts";

/* ------------------------------------------------------------------ *
 * The conditions, as data (F143-FR-020).
 * ------------------------------------------------------------------ */

/** F143-FR-020 — the application is forward only. */
export const FORWARD_ONLY = true as const;

/** F143-FR-020 — the application is never undone. */
export const NEVER_UNDONE = true as const;

/** F143-FR-020 — the application is recorded in the ledger before it is made. */
export const RECORDED_BEFORE_IT_IS_MADE = true as const;

/** F143-FR-020 — what the runtime never does to the workspace inside a phase attempt. */
export const NEVER_DONE_TO_THE_WORKSPACE = [
  "commit",
  "revert",
  "reset",
  "clean",
  "check out",
] as const;

/** The ledger kind of the write-ahead record (data-model.md, the states of a group). */
export const WRITE_AHEAD_KIND = "apply_started" as const;

/** The ledger kind written after the application (data-model.md). */
export const KIND_AFTER_THE_APPLICATION = "applied" as const;

/* ------------------------------------------------------------------ *
 * The paths the application may never touch (F143-FR-020).
 * ------------------------------------------------------------------ */

/**
 * F143-FR-020 — true where `path` is one the application may never write:
 * anything under the project's repository directory (where the index and the
 * references live) and the workspace part, which is the runtime's own state
 * and in no snapshot to begin with.
 */
export function pathIsForbidden(path: string): boolean {
  return isRepositoryDirectory(path) || isWorkspacePart(path) || path.split("/").includes("..");
}

/** The refusal of `apply`, with the reason the requirement names. */
export class ApplicationRefused extends Error {
  readonly reason: ApplicationRefusalReason;
  readonly detail: readonly string[];
  constructor(reason: ApplicationRefusalReason, detail: readonly string[], message: string) {
    super(message);
    this.name = "ApplicationRefused";
    this.reason = reason;
    this.detail = Object.freeze([...detail]);
  }
}

/** The reasons the application refuses, and no other. */
export const APPLICATION_REFUSAL_REASONS = [
  "workspace-differs-from-the-base",
  "path-not-audited",
  "forbidden-path",
  "object-missing-from-the-store",
] as const;
export type ApplicationRefusalReason = (typeof APPLICATION_REFUSAL_REASONS)[number];

/* ------------------------------------------------------------------ *
 * The write-ahead plan (condition 6).
 * ------------------------------------------------------------------ */

/** What the application will do to one path, with the two object ids. */
export type PlannedPath = {
  readonly path: string;
  /** The object id in the base tree, or `null` where the path is added. */
  readonly baseOid: string | null;
  /** The object id in the composed tree, or `null` where the path is deleted. */
  readonly composedOid: string | null;
  /** The mode of the composed entry, or `null` where the path is deleted. */
  readonly mode: string | null;
  readonly kind: "added" | "changed" | "deleted" | "mode changed";
};

/**
 * F143-FR-020 — THE WRITE-AHEAD RECORD: every path the application will
 * write, each with its base and its composed object id. The `data` of the
 * ledger kind `apply_started` (data-model.md).
 */
export type ApplicationPlan = {
  readonly baseTreeId: TreeId;
  readonly composedTreeId: TreeId;
  readonly workspace: string;
  readonly paths: readonly PlannedPath[];
};

/** The kind of one planned path, from the two entries. */
function kindOf(
  was: StoreTreeEntry | undefined,
  now: StoreTreeEntry | undefined,
): PlannedPath["kind"] {
  if (was === undefined) return "added";
  if (now === undefined) return "deleted";
  if (was.oid === now.oid && was.mode !== now.mode) return "mode changed";
  return "changed";
}

/**
 * F143-FR-020 — the plan: the paths on which the composed tree differs from
 * the base, in path order, each with its base and composed object id. Reads
 * the two trees and nothing else; writes nothing anywhere.
 */
export function applicationPlan(
  places: StorePlaces,
  baseTreeId: TreeId,
  composedTreeId: TreeId,
  workspace: string,
): ApplicationPlan {
  const base = treeByPath(places, baseTreeId);
  const composed = treeByPath(places, composedTreeId);
  const paths: PlannedPath[] = [];
  for (const path of new Set([...base.keys(), ...composed.keys()])) {
    const was = base.get(path);
    const now = composed.get(path);
    if (was !== undefined && now !== undefined && was.oid === now.oid && was.mode === now.mode) {
      continue;
    }
    paths.push(
      Object.freeze({
        path,
        baseOid: was?.oid ?? null,
        composedOid: now?.oid ?? null,
        mode: now?.mode ?? null,
        kind: kindOf(was, now),
      }),
    );
  }
  return Object.freeze({
    baseTreeId,
    composedTreeId,
    workspace,
    paths: Object.freeze(paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))),
  });
}

/**
 * F143-FR-020 — the planned paths that no audited delta named. An application
 * whose plan holds one of these is refused: a path that no audit saw is a
 * path no one approved.
 */
export function pathsThatAreNotAudited(
  plan: ApplicationPlan,
  auditedPaths: readonly string[],
): readonly string[] {
  const audited = new Set(auditedPaths);
  return Object.freeze(plan.paths.map((p) => p.path).filter((path) => !audited.has(path)));
}

/* ------------------------------------------------------------------ *
 * The fingerprint of the workspace against the base (condition 3).
 * ------------------------------------------------------------------ */

/** One way the workspace differs from the base snapshot. */
export type Difference = {
  readonly path: string;
  readonly inTheBase: boolean;
  readonly inTheWorkspace: boolean;
  readonly sameBytes: boolean;
  readonly sameMode: boolean;
};

/**
 * F143-FR-020 — HOW THE WORKSPACE DIFFERS FROM THE BASE SNAPSHOT, over the
 * fingerprint scope of the workspace. Every file is hashed WITHOUT BEING
 * STORED, so the check is a pure read of both sides: an empty list means the
 * fingerprint of the workspace equals the base and the application may run.
 */
export function workspaceDiffersFromTheBase(
  places: StorePlaces,
  baseTreeId: TreeId,
  workspace: string,
): readonly Difference[] {
  const base = treeByPath(places, baseTreeId);
  const scope = new Set(fingerprintScope(places, workspace));
  const out: Difference[] = [];
  for (const path of new Set([...base.keys(), ...scope])) {
    const entry = base.get(path);
    const full = join(workspace, path);
    const present = existsSync(full) || isALink(full);
    if (entry === undefined || !present) {
      out.push(
        Object.freeze({
          path,
          inTheBase: entry !== undefined,
          inTheWorkspace: present,
          sameBytes: false,
          sameMode: false,
        }),
      );
      continue;
    }
    const stat = lstatSync(full);
    const mode = stat.isSymbolicLink() ? "120000" : (stat.mode & 0o111) !== 0 ? "100755" : "100644";
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkOf(full)) : readFileSync(full);
    const oid = objectIdOfBytes(places, bytes);
    if (oid === entry.oid && mode === entry.mode) continue;
    out.push(
      Object.freeze({
        path,
        inTheBase: true,
        inTheWorkspace: true,
        sameBytes: oid === entry.oid,
        sameMode: mode === entry.mode,
      }),
    );
  }
  return Object.freeze(out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}

function isALink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The target of a link, as the bytes a snapshot stores for it. */
function readlinkOf(path: string): string {
  return readlinkSync(path);
}

/* ------------------------------------------------------------------ *
 * The operation.
 * ------------------------------------------------------------------ */

/** What `apply` is given beyond the three arguments of the interface. */
export type ApplyOptions = {
  /**
   * The paths of the audited deltas. Where it is given, a plan that holds a
   * path outside it is REFUSED (F143-FR-020, condition 2).
   */
  readonly auditedPaths?: readonly string[];
  /**
   * The write-ahead recorder. Called with the whole plan BEFORE one byte is
   * written (F143-FR-020, condition 6).
   */
  readonly recordAhead?: (plan: ApplicationPlan) => void;
};

/** What one application did. */
export type ApplicationResult = {
  /** The paths written and deleted, sorted. The return of the interface. */
  readonly paths: readonly string[];
  /** The plan, as it was recorded before the first byte (condition 6). */
  readonly plan: ApplicationPlan;
};

/**
 * F143-FR-020 — THE APPLICATION. Writes and deletes exactly the paths of the
 * plan, after the plan has been recorded, onto a workspace whose fingerprint
 * equals the base snapshot. Touches no index, no reference and nothing under
 * the repository directory; never undoes anything.
 */
export function applyComposedTree(
  places: StorePlaces,
  baseTreeId: TreeId,
  composedTreeId: TreeId,
  workspace: string,
  options: ApplyOptions = {},
): ApplicationResult {
  // F143-FR-003 — BEFORE THE APPLICATION, every object of the composed tree
  // is verified to be present in the store. A missing object refuses the
  // group and switches the loop layer off for the phase attempt, and it does
  // so before the plan is made, let alone recorded or written.
  verifyBeforeTheApplication(places, composedTreeId);

  const plan = applicationPlan(places, baseTreeId, composedTreeId, workspace);

  // Condition 5 — a forbidden path is refused before anything is read.
  const forbidden = plan.paths.map((p) => p.path).filter(pathIsForbidden);
  if (forbidden.length > 0) {
    throw new ApplicationRefused(
      "forbidden-path",
      forbidden,
      `the application touches no index, no reference and nothing under the repository directory (F143-FR-020): ${forbidden.join(", ")}`,
    );
  }

  // Condition 2 — exactly the paths of audited deltas.
  if (options.auditedPaths !== undefined) {
    const notAudited = pathsThatAreNotAudited(plan, options.auditedPaths);
    if (notAudited.length > 0) {
      throw new ApplicationRefused(
        "path-not-audited",
        notAudited,
        `the application writes exactly the paths of audited deltas (F143-FR-020); no audit named ${notAudited.join(", ")}`,
      );
    }
  }

  // Condition 3 — only onto a workspace whose fingerprint equals the base.
  const differences = workspaceDiffersFromTheBase(places, baseTreeId, workspace);
  if (differences.length > 0) {
    throw new ApplicationRefused(
      "workspace-differs-from-the-base",
      differences.map((d) => d.path),
      `the application runs only onto a workspace whose fingerprint equals the base snapshot (F143-FR-020); ${String(differences.length)} path(s) differ`,
    );
  }

  // Condition 4 — the bytes of the stored object, and it must be there.
  for (const planned of plan.paths) {
    if (planned.composedOid !== null && !objectIsPresent(places, planned.composedOid)) {
      throw new ApplicationRefused(
        "object-missing-from-the-store",
        [planned.path],
        `the object ${planned.composedOid} of ${planned.path} is not in the store (F143-FR-003)`,
      );
    }
  }

  // Condition 6 — RECORDED BEFORE IT IS MADE. Nothing above this line wrote
  // one byte of the workspace; nothing below it runs before the record.
  options.recordAhead?.(plan);

  const written: string[] = [];
  for (const planned of plan.paths) {
    const target = join(workspace, planned.path);
    if (planned.composedOid === null) {
      rmSync(target, { force: true });
      written.push(planned.path);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readObject(places, planned.composedOid);
    if (planned.mode === "120000") {
      rmSync(target, { force: true });
      symlinkSync(Buffer.from(bytes).toString("utf8"), target);
    } else {
      // By temporary name and rename: a reader of the workspace never sees
      // half a file, and no repository process takes part.
      const temporary = `${target}.tree-store-apply-tmp`;
      writeFileSync(temporary, bytes, { mode: planned.mode === "100755" ? 0o755 : 0o644 });
      renameSync(temporary, target);
    }
    written.push(planned.path);
  }

  return Object.freeze({
    paths: Object.freeze(written.sort()),
    plan,
  });
}
