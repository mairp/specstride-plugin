/**
 * The resolution of an executable (T043; F109-FR-020).
 *
 * The executable of a harness is resolved to an absolute path at launch,
 * with the consumer's real search path and home, BEFORE any variable of an
 * overlay is applied. The path and the version are recorded. An executable
 * inside the workspace, or in a directory that everyone may write, is
 * refused. A path that changed since the last run gives a warning. When the
 * executable is not on the search path, the pass fails with the result code
 * 127 and the message `<component>: <executable> not found`, and the harness
 * is not started.
 *
 * Ported from as-is `backend_overlay_exec` of `proposer.sh` ("The binary is
 * resolved to an absolute path FIRST, with the real HOME/PATH, before any
 * overlay variable is applied") and the `command -v … not found … return 127`
 * arms of `run_agent()`.
 */

/** The result code of a pass whose executable is not on the search path. */
export const EXECUTABLE_NOT_FOUND_CODE = 127;

/** Why a resolved executable is refused. */
export type ExecutableRefusalReason = "inside-workspace" | "world-writable-directory";

/** The outcome of a resolution. */
export type ExecutableResolution =
  | {
      ok: true;
      /** The resolved absolute path. */
      path: string;
      /** The recorded version, where a probe was given and answered. */
      version: string | null;
      /** The warning for a path that changed since the last run, if any. */
      warning: string | null;
    }
  | { ok: false; resultCode: 127; message: string }
  | {
      ok: false;
      refusal: ExecutableRefusalReason;
      message: string;
    };

/** One directory of the search path, with what the resolver needs of it. */
export type PathDir = {
  path: string;
  /** Whether the directory is writable by everyone (mode & 0o002). */
  worldWritable: boolean;
};

/** Whether `candidate` lies inside `directory` (both absolute). */
function inside(candidate: string, directory: string): boolean {
  if (directory === "/") return candidate.startsWith("/");
  return candidate === directory || candidate.startsWith(directory + "/");
}

/**
 * Resolves NAME on the search path DIRS (the consumer's real search path —
 * the caller passes the PATH of before any overlay variable is applied).
 *
 * - Not found: result code 127 and `<component>: <executable> not found`
 *   (as-is: `proposer.sh: DeepSeek Harness not found: dsh`).
 * - Inside WORKSPACE_ROOT: refused (F109-FR-020).
 * - In a directory everyone may write: refused (F109-FR-020).
 * - Found: the absolute path, the version PROBE records (where given), and
 *   the warning for a path that changed since PREVIOUS run's path.
 */
export function resolveExecutable(
  name: string,
  options: {
    /** The real search path, before any overlay variable is applied. */
    dirs: readonly PathDir[];
    /** A test for the executable's presence and executability in a directory. */
    exists?: (dir: string, name: string) => boolean;
    /** The root of the workspace; an executable inside it is refused. */
    workspaceRoot: string | null;
    /** The absolute path recorded on the last run, if any. */
    previousPath?: string | null;
    /** Records the version of the executable, where the caller probes it. */
    probeVersion?: (path: string) => string | null;
    /** The component named in the messages (`proposer`, `critic`, …). */
    component?: string;
  },
): ExecutableResolution {
  const component = options.component ?? "proposer.sh";
  const exists = options.exists ?? (() => true);
  for (const dir of options.dirs) {
    if (!exists(dir.path, name)) continue;
    const path = `${dir.path}/${name}`;
    if (options.workspaceRoot !== null && inside(path, options.workspaceRoot)) {
      return {
        ok: false,
        refusal: "inside-workspace",
        message:
          `${component}: ${name} resolves inside the workspace: ${path}; ` +
          "an executable of a harness inside the workspace is refused",
      };
    }
    if (dir.worldWritable) {
      return {
        ok: false,
        refusal: "world-writable-directory",
        message:
          `${component}: ${name} resolves into a directory that everyone may write: ` +
          `${dir.path}; the path is refused`,
      };
    }
    const warning =
      options.previousPath && options.previousPath !== path
        ? `${component}: the path of ${name} changed since the last run: ` +
          `${options.previousPath} -> ${path}`
        : null;
    const version = options.probeVersion ? options.probeVersion(path) : null;
    return { ok: true, path, version, warning };
  }
  return {
    ok: false,
    resultCode: EXECUTABLE_NOT_FOUND_CODE as 127,
    message: `${component}: ${name} not found`,
  };
}

/**
 * Splits a PATH string into the directories the resolver walks, in order —
 * the consumer's real search path, read once at launch, before any overlay
 * variable is applied. Empty entries mean the current directory, as in a
 * shell; they resolve against the process's working directory and are
 * dropped here: a harness executable is never taken from the CWD.
 */
export function searchDirsFromPath(
  path: string,
  worldWritable: (dir: string) => boolean = () => false,
): PathDir[] {
  const dirs: PathDir[] = [];
  for (const raw of path.split(":")) {
    if (raw === "") continue;
    dirs.push({ path: raw, worldWritable: worldWritable(raw) });
  }
  return dirs;
}
