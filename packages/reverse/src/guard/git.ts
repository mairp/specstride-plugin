/**
 * T023 of feature 108 — the git PROCESSES the guard runs (F108-FR-030).
 *
 * `plan.md`, "Physical choices behind the specification": git is called as a
 * process, with `git status --porcelain=v1 -z --untracked-files=all` and
 * `git rev-parse --verify -q HEAD` and the as-is time limits (B-1917, B-1918).
 * Git mode also lists the candidates of the re-walk with
 * `git ls-files -co --exclude-standard -z` (B-1921).
 *
 * Every call is one process with a FIXED argument list and `shell: false`, like
 * the call into the inventory of T004: nothing here is built from a string.
 * The runner is a seam, so a test proves the argument lists and the parsing
 * without a repository and without a `git` on the path.
 */
import { spawnSync } from "node:child_process";

/** The executable, as the as-is code called it. */
export const GIT_EXECUTABLE = "git" as const;

/** `git rev-parse --verify -q HEAD` — the verified HEAD commit (B-1917). */
export const HEAD_ARGS = Object.freeze(["rev-parse", "--verify", "-q", "HEAD"] as const);

/** `git status --porcelain=v1 -z --untracked-files=all` (B-1918). */
export const STATUS_ARGS = Object.freeze([
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
] as const);

/** `git ls-files -co --exclude-standard -z` (B-1921). */
export const LS_FILES_ARGS = Object.freeze([
  "ls-files",
  "-co",
  "--exclude-standard",
  "-z",
] as const);

/** `git rev-parse --show-toplevel` — the top level of the work tree (B-1916). */
export const TOPLEVEL_ARGS = Object.freeze(["rev-parse", "--show-toplevel"] as const);

/** The time limits of the three calls, in seconds (F140-FR-017, B-1917, B-1918). */
export const TIMEOUTS_SEC = Object.freeze({ head: 30, status: 60, listing: 300 } as const);

/** The options every call is made with: no shell, no inherited standard input. */
export const FIXED_SPAWN_OPTIONS = Object.freeze({
  shell: false,
  windowsHide: true,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
} as const);

/** What one git call gave back. */
export type GitRun = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** The seam: one git process, a fixed argument list, a working directory. */
export type GitRunner = (
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutSec: number },
) => GitRun;

/** The default runner: `spawnSync`, no shell. */
export const spawnGit: GitRunner = (args, options) => {
  const result = spawnSync(GIT_EXECUTABLE, [...args], {
    ...FIXED_SPAWN_OPTIONS,
    stdio: [...FIXED_SPAWN_OPTIONS.stdio],
    cwd: options.cwd,
    timeout: options.timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/* ------------------------------------------------------------------------- *
 * HEAD
 * ------------------------------------------------------------------------- */

/**
 * B-1917 — the verified HEAD commit, or `null` where there is no commit or git
 * fails. `--verify -q` makes git silent and non-zero on a tree with no commit,
 * so the null is observed, never guessed.
 */
export function gitHead(src: string, run: GitRunner = spawnGit): string | null {
  const result = run(HEAD_ARGS, { cwd: src, timeoutSec: TIMEOUTS_SEC.head });
  if (result.status !== 0) return null;
  const head = result.stdout.trim();
  return head === "" ? null : head;
}

/* ------------------------------------------------------------------------- *
 * The status
 * ------------------------------------------------------------------------- */

/**
 * B-1918 — the entries of `--porcelain=v1 -z`: each record is `XY path`, and a
 * rename or a copy is followed by ONE more record holding the ORIGINAL path,
 * which is dropped. The result is sorted by code point, as the inventory sorts
 * it, so that the guard's list and the baseline's are comparable.
 */
export function parsePorcelainZ(stdout: string): readonly string[] {
  const records = stdout.split("\0").filter((record) => record !== "");
  const entries: string[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] as string;
    if (record.length < 3) continue;
    entries.push(record);
    const x = record[0];
    const y = record[1];
    // The source path of a rename or a copy is the NEXT record; drop it.
    if (x === "R" || x === "C" || y === "R" || y === "C") i += 1;
  }
  return Object.freeze(entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** B-1918 — the sorted `XY path` entries of the work tree, or `[]` on failure. */
export function gitStatus(src: string, run: GitRunner = spawnGit): readonly string[] {
  const result = run(STATUS_ARGS, { cwd: src, timeoutSec: TIMEOUTS_SEC.status });
  if (result.status !== 0) return Object.freeze([]);
  return parsePorcelainZ(result.stdout);
}

/** The source-relative path of a `XY path` entry: everything after `XY `. */
export function pathOfAStatusEntry(entry: string): string {
  return entry.slice(3);
}

/* ------------------------------------------------------------------------- *
 * The listing of git mode
 * ------------------------------------------------------------------------- */

/** A failing listing (B-1874, F140-FR-017). */
export function lsFilesFailedMessage(src: string, stderr: string): string {
  return `git ls-files failed in ${src}: ${stderr}`;
}

/**
 * B-1921 — the tracked and untracked-not-ignored paths of the work tree, as a
 * NUL-separated listing. A failing call throws the as-is message; the caller
 * turns it into `reverse: <message>` and exit 3 (F108-FR-031).
 */
export function gitListing(src: string, run: GitRunner = spawnGit): readonly string[] {
  const result = run(LS_FILES_ARGS, { cwd: src, timeoutSec: TIMEOUTS_SEC.listing });
  if (result.status !== 0) {
    throw new Error(lsFilesFailedMessage(src, result.stderr.trim()));
  }
  return Object.freeze(result.stdout.split("\0").filter((path) => path !== ""));
}

/**
 * B-1916 — the source is in git mode only when it is inside a work tree AND is
 * its top level. The guard does not decide the mode by itself: it repeats the
 * baseline's `walk`. This probe is here for the one case the guard needs it —
 * a baseline in git mode whose source is no longer the top level of a work
 * tree, where the git checks have nothing to read.
 */
export function isTheTopLevelOfAWorkTree(src: string, run: GitRunner = spawnGit): boolean {
  const result = run(TOPLEVEL_ARGS, { cwd: src, timeoutSec: TIMEOUTS_SEC.head });
  if (result.status !== 0) return false;
  return result.stdout.trim() !== "";
}
