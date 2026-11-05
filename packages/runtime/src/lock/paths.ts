/**
 * The places the shipped lock provider reads and writes, resolved from the
 * layout table of feature 100 and never written out as a literal here
 * (annex B, §B.5; F100-FR-053).
 *
 * This module exists so that `directory-lock.ts`, `probe.ts`, `reclaim.ts`
 * and the doctor checks all name the same four things, and so that none of
 * them has to repeat a path template. Every path below comes out of
 * `resolve()` of `@specstride/contracts/ids/logical-names`, which reads
 * `data/layout.json`: change the table and these paths follow, which is what
 * "the lock by logical name" (C-011, B-0161, B-0162) means when a test reads
 * it back.
 *
 * Inside the lock directory this feature owns two names, and they ARE literals
 * here, because the layout table stops at `workspace:lock` — the directory is
 * one logical item and what lies inside it is EP-13's business (annex B §B.5
 * gives the lock one row, `<control>/lock/`).
 */
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import { join } from "node:path";

/** The logical names this module resolves (annex B, §B.5). */
export const LOCK_LOGICAL_NAME = "workspace:lock" as const;
export const WORKSPACE_RECORD_LOGICAL_NAME = "workspace:record" as const;
export const ADVISORY_MARKER_LOGICAL_NAME = "workspace:active" as const;
export const LAYOUT_VERSION_LOGICAL_NAME = "workspace:layout-version" as const;

/** The two files the lock directory holds; EP-13 owns the inside of the lock. */
export const OWNER_RECORD_FILE = "owner.json" as const;
export const LEASE_FILE = "lease.json" as const;

/**
 * The prefix of a tombstone of `reclaim` (research D-4). It is a sibling of
 * the lock and never inside it, so that a reader of the lock directory never
 * meets one.
 */
export const TOMBSTONE_PREFIX = "lock.reclaimed-" as const;

/** The prefix of the temporary directory an `acquire` renames into place (D-1). */
export const PENDING_PREFIX = ".lock.pending-" as const;

/** Where the shipped provider works, for one workspace. */
export type LockPaths = {
  /** The control root of the workspace (`<control>`). */
  readonly controlRoot: string;
  /** `workspace:lock` — the lock directory itself. */
  readonly lockDirectory: string;
  /** The owner record inside the lock (annex B, §B.9). */
  readonly ownerRecordFile: string;
  /** The lease inside the lock (annex B, §B.8). */
  readonly leaseFile: string;
  /** `workspace:record` (annex B, §B.6). */
  readonly workspaceRecordFile: string;
  /** `workspace:active` — the advisory marker, in the workspace part. */
  readonly advisoryMarkerFile: string;
  /** `workspace:layout-version` (F122-FR-043), in the workspace part. */
  readonly layoutVersionFile: string;
  /** The directory a tombstone or a pending lock is made in. */
  readonly parentDirectory: string;
};

/** What a caller must know to resolve the paths of a workspace. */
export type LockPlace = {
  readonly controlRoot: string;
  /** The REAL path of the workspace root (F122-FR-019). */
  readonly workspaceRealPath: string;
};

/**
 * Resolve the four logical names this provider uses. `rootPathsOf` wants the
 * whole root environment; the two roots these names live under are `<control>`
 * and `<workspace-part>`, so the rest is given as empty and never reached —
 * `resolve` throws on a placeholder it cannot fill, so a name that started to
 * need another root would fail here and not silently resolve to `/`.
 */
export function lockPathsOf(place: LockPlace): LockPaths {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  const lockDirectory = stripTrailingSlash(resolve(LOCK_LOGICAL_NAME, {}, roots));
  return Object.freeze({
    controlRoot: place.controlRoot,
    lockDirectory,
    ownerRecordFile: join(lockDirectory, OWNER_RECORD_FILE),
    leaseFile: join(lockDirectory, LEASE_FILE),
    workspaceRecordFile: resolve(WORKSPACE_RECORD_LOGICAL_NAME, {}, roots),
    advisoryMarkerFile: resolve(ADVISORY_MARKER_LOGICAL_NAME, {}, roots),
    layoutVersionFile: resolve(LAYOUT_VERSION_LOGICAL_NAME, {}, roots),
    parentDirectory: place.controlRoot,
  });
}

/** `<control>/lock/` carries a trailing slash in the table; a path does not. */
function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}
