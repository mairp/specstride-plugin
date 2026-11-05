/**
 * T087 — `sourceRevision` (F105-FR-011): the revision the verification gate
 * actually ran against.
 *
 * An exit code proves nothing if you cannot say which tree produced it
 * (the constitution, Principle III). So the record is `available`, `revision`,
 * `workingTreeDirty` and `capturedAt`, or `available: false` WITH A REASON
 * where there is no repository — fail-soft, but never silently: an unavailable
 * revision is recorded with its reason and never omitted.
 *
 * This package starts no process (F100-FR-234): the two readings of the
 * repository and the clock arrive as an injected PORT, so the shape of the
 * record is this feature's and the way a revision is read is the composition
 * root's.
 */
import type { SourceRevision } from "./record.ts";

/** The reason a revision is unavailable because no tool was found. */
export const NO_GIT_REASON = "git not found on PATH" as const;
/** The reason a revision is unavailable because the place is no directory. */
export const NO_WORKDIR_REASON = "workdir is not a directory" as const;
/** The reason the baseline gives when the revision command failed (`:210`). */
export const REV_PARSE_FAILED_REASON = "git rev-parse failed" as const;
/** The number of characters a recorded reason is cut to (`:212`). */
export const REASON_LENGTH = 400 as const;

/** What one reading of the repository gave. */
export type RepositoryReading = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * The port the composition root hands in: the two readings the record needs,
 * and the clock. `revision` is `rev-parse HEAD`, `status` is the porcelain
 * status, and either may be `undefined` where the tool is absent.
 */
export type RepositoryPort = {
  /** `undefined` where no tool to read a repository was found. */
  readonly toolIsAvailable: boolean;
  /** `undefined` where the place is no directory. */
  readonly workdirIsADirectory: boolean;
  revision(): RepositoryReading;
  status(): RepositoryReading;
  /** Whole seconds since the epoch, as the baseline's `int(time.time())`. */
  now(): number;
};

/** A reason, cut to the recorded length and trimmed (`:212`). */
export function reasonOf(text: string): string {
  return text.trim().slice(0, REASON_LENGTH);
}

/**
 * `sourceRevision` of F105-FR-011 (`lib/verification_plan.py`:197). A failed
 * status reading leaves `workingTreeDirty` as `null`, which says "not known"
 * and is the baseline's value, not `false`.
 */
export function sourceRevisionOf(port: RepositoryPort): SourceRevision {
  if (!port.toolIsAvailable) {
    return Object.freeze({ available: false as const, reason: NO_GIT_REASON });
  }
  if (!port.workdirIsADirectory) {
    return Object.freeze({ available: false as const, reason: NO_WORKDIR_REASON });
  }
  let head: RepositoryReading;
  let porcelain: RepositoryReading;
  try {
    head = port.revision();
    if (head.exitCode !== 0) {
      return Object.freeze({
        available: false as const,
        reason: reasonOf(head.stderr !== "" ? head.stderr : REV_PARSE_FAILED_REASON),
      });
    }
    porcelain = port.status();
  } catch (error) {
    return Object.freeze({
      available: false as const,
      reason: reasonOf(error instanceof Error ? error.message : String(error)),
    });
  }
  return Object.freeze({
    available: true as const,
    revision: head.stdout.trim(),
    workingTreeDirty: porcelain.exitCode !== 0 ? null : porcelain.stdout.trim() !== "",
    capturedAt: port.now(),
  });
}

/** True where two recorded revisions are the same tree and both clean. */
export function sameCleanRevision(left: SourceRevision, right: SourceRevision): boolean {
  if (!left.available || !right.available) return false;
  return (
    left.revision === right.revision &&
    left.workingTreeDirty === false &&
    right.workingTreeDirty === false
  );
}
