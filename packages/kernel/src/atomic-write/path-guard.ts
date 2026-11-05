/**
 * T243 — the path guard of the kernel (annex B, §B.2, SL-1 and F100-FR-043,
 * F100-FR-035).
 *
 * The runtime resolves real paths and requires them to stay inside their
 * root, refuses a symbolic link inside the control plane, opens the files it
 * reads as claims (the outbox, the phase evidence) without following links,
 * and creates the directories and files of the control plane, the user-level
 * state and the worker root 0700 and 0600, owner only.
 */
import {
  constants,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath, sep } from "node:path";

/** The mode of a directory of the control plane, the user state, the worker root. */
export const DIRECTORY_MODE = 0o700;
/** The mode of a file of those roots. */
export const FILE_MODE = 0o600;

/** A path that leaves its root, or a link where none is allowed. */
export class PathGuardError extends Error {
  /** The path that was refused. */
  readonly path: string;
  /** The root it had to stay inside. */
  readonly root: string;
  readonly reason: "outside-root" | "symbolic-link" | "not-absolute";
  constructor(reason: PathGuardError["reason"], path: string, root: string, message: string) {
    super(message);
    this.name = "PathGuardError";
    this.reason = reason;
    this.path = path;
    this.root = root;
  }
}

/** True when `path` is `root` or lies under it, compared by path segment. */
export function isInside(path: string, root: string): boolean {
  const p = path.endsWith(sep) ? path.slice(0, -1) : path;
  const r = root.endsWith(sep) ? root.slice(0, -1) : root;
  return p === r || p.startsWith(r + sep);
}

/**
 * The real path of the deepest part of `path` that exists, with the rest
 * appended. A path that does not exist yet still has a real root.
 */
export function realPathOf(path: string): string {
  let head = resolvePath(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return [realpathSync(head), ...tail].join(sep).replace(/\/{2,}/g, "/");
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolvePath(path);
      tail.unshift(head.slice(parent.length + 1));
      head = parent;
    }
  }
}

/**
 * F100-FR-043 — resolve the real path and require it inside its root. Returns
 * the real path; throws `PathGuardError` with the path and the root when it
 * leaves the root.
 */
export function requireInsideRoot(path: string, root: string): string {
  if (!isAbsolute(path)) {
    throw new PathGuardError(
      "not-absolute",
      path,
      root,
      `refused the path "${path}": a path of a root is absolute (F100-FR-043)`,
    );
  }
  const realRoot = realPathOf(root);
  const real = realPathOf(path);
  if (!isInside(real, realRoot)) {
    throw new PathGuardError(
      "outside-root",
      path,
      root,
      `refused the path "${path}": its real path "${real}" leaves the root "${root}" ` +
        `(real root "${realRoot}") (F100-FR-043)`,
    );
  }
  return real;
}

/**
 * F100-FR-043 — refuse a symbolic link inside the control plane. Every part
 * of the path below the root is checked; a link anywhere under the control
 * plane is refused with the path and the root.
 */
export function refuseSymbolicLinkInsideControlPlane(path: string, controlRoot: string): void {
  const root = resolvePath(controlRoot);
  const target = resolvePath(path);
  if (!isInside(target, root)) return;
  let at = target;
  while (isInside(at, root) && at !== root) {
    try {
      if (lstatSync(at).isSymbolicLink()) {
        throw new PathGuardError(
          "symbolic-link",
          at,
          controlRoot,
          `refused the path "${path}": "${at}" is a symbolic link inside the control ` +
            `plane "${controlRoot}" (F100-FR-043)`,
        );
      }
    } catch (err) {
      if (err instanceof PathGuardError) throw err;
      // The part does not exist yet: nothing to refuse.
    }
    at = dirname(at);
  }
}

/** The guard of one write or read: inside the root, and no link in the control plane. */
export function guardPath(path: string, root: string, controlRoot?: string): string {
  const real = requireInsideRoot(path, root);
  if (controlRoot !== undefined) refuseSymbolicLinkInsideControlPlane(path, controlRoot);
  return real;
}

/**
 * F100-FR-035, F100-FR-043 — open a file the runtime reads as a claim (the
 * outbox, the phase evidence) without following links. A claim decides
 * nothing: the caller reads it after the pass has exited, as a regular file.
 */
export function readClaim(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      throw new PathGuardError(
        "symbolic-link",
        path,
        dirname(path),
        `refused the claim "${path}": a claim is read as a regular file (F100-FR-035)`,
      );
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** A file in the workspace part decides nothing (annex B, §B.2, SL-1). */
export const A_CLAIM_DECIDES_ANYTHING = false as const;

/**
 * F100-FR-043 — create a directory of the control plane, of the user-level
 * state or of the worker root, readable and writable by its owner only.
 */
export function makeOwnerOnlyDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
}

/** The modes the roots of F100-FR-043 use, as data for a caller and a test. */
export const OWNER_ONLY_ROOTS = ["control", "user", "worker-root"] as const;
export const OWNER_ONLY_MODES = Object.freeze({
  directory: DIRECTORY_MODE,
  file: FILE_MODE,
});

/** True when the mode of a directory or a file is owner-only. */
export function isOwnerOnly(mode: number, kind: "directory" | "file"): boolean {
  const wanted = kind === "directory" ? DIRECTORY_MODE : FILE_MODE;
  return (mode & 0o777) === wanted;
}
