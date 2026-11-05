/**
 * T022 of feature 140 — the INVENTORY WALK CORE: the git mode, the
 * file-system mode, the ignore rules, the exclusions and the names of state
 * (F140-FR-017, F140-FR-018).
 *
 * This is the half of the inventory that decides WHICH paths exist. What each
 * path then IS (its size, hash, language, role or skip reason) is
 * `./entries.ts` (T023), and the document that holds them is `./document.ts`
 * (T024).
 *
 * Two modes, and the rule that picks between them (F140-FR-017):
 *
 *  * **git** — only when the source is inside a work tree AND is its top
 *    level. A SUBDIRECTORY of a repository is walked by the file-system mode,
 *    because `git ls-files` run there would list paths of the whole
 *    repository. The listing is `git ls-files -co --exclude-standard -z`:
 *    tracked plus untracked-but-not-ignored. The directory deny list does NOT
 *    apply in git mode — git's own ignore rules already settled it.
 *  * **walk** — everything else: a recursive listing that skips the deny list
 *    and the names of state at any depth, honours only the ROOT `.gitignore`
 *    as a glob subset, and never follows a link.
 *
 * Why the glob translation is written out here instead of reusing a library:
 * the baseline matched with Python's `fnmatch.fnmatchcase`, in which `*`
 * matches ANY character INCLUDING `/`. A `*` that stops at `/` — the rule of
 * `.gitignore` proper, and of most glob libraries — would ignore a different
 * set of files and so change the fingerprint. Parity before capability
 * (constitution, principle XVIII): this module reproduces `fnmatch`, not
 * `gitignore(5)`.
 *
 * Every list this module returns is sorted by CODE POINT through
 * `compareCodePoint` of `./serialize.ts` (F140-FR-017, F140-FR-021,
 * decision D-2 of `research.md`): JavaScript's own `<` is UTF-16 order and
 * disagrees for astral characters, which a source tree may hold in a path.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { InventoryError } from "./limits.ts";
import { compareCodePoint } from "./serialize.ts";

/* ------------------------------------------------------------------------- *
 * The names the walk never enters (F140-FR-017, F140-FR-018)
 * ------------------------------------------------------------------------- */

/**
 * The names of state that are never walked in either mode (F140-FR-017): the
 * workspace part `.specstride` and the old tree `.lisa`. The legacy state
 * directory name of the as-is walk is not carried (divergence DV-036).
 */
export const STATE_DIRECTORY_NAMES = Object.freeze([".specstride", ".lisa"] as const);

/**
 * The directories the FILE-SYSTEM walk skips at any depth, the names of state
 * included (F140-FR-018). In GIT mode this list does not apply
 * (F140-FR-017).
 */
export const DENY_DIRECTORIES = Object.freeze([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  "vendor",
  "testautomation",
  ...STATE_DIRECTORY_NAMES,
] as const);

/** The one ignore file the file-system walk reads (F140-FR-018). */
export const ROOT_IGNORE_FILE = ".gitignore" as const;

/** The two modes the inventory reports under `walk` (F140-FR-017). */
export const WALK_MODES = Object.freeze(["git", "walk"] as const);

/** The mode of one walk. */
export type WalkMode = (typeof WALK_MODES)[number];

/** How long each git call may take, in milliseconds (F140-FR-017). */
export const GIT_TIMEOUTS = Object.freeze({
  /** `rev-parse`, for the work-tree question and for HEAD. */
  head: 30_000,
  /** `status --porcelain`. */
  status: 60_000,
  /** `ls-files`, the listing itself. */
  listing: 300_000,
} as const);

/* ------------------------------------------------------------------------- *
 * The exclusions (F140-FR-017)
 * ------------------------------------------------------------------------- */

/**
 * The exclusions as the document records them: each stripped of its leading
 * and trailing `/`, de-duplicated, and sorted by code point. An empty
 * exclusion, and one that is only slashes, is dropped.
 */
export function normalizeExcludes(excludes: Iterable<string>): readonly string[] {
  const kept = new Set<string>();
  for (const raw of excludes) {
    const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmed !== "") kept.add(trimmed);
  }
  return Object.freeze([...kept].sort(compareCodePoint));
}

/** An exclusion matches ITSELF and everything under it (F140-FR-017). */
export function isUnderAnExclusion(relative: string, excludes: readonly string[]): boolean {
  return excludes.some((exclude) => relative === exclude || relative.startsWith(`${exclude}/`));
}

/**
 * True where any DIRECTORY component of a path is a name of state. The last
 * component is the file's own name and is not a directory, so it is not
 * consulted — this is the rule git mode drops a path by (F140-FR-017).
 */
export function hasAStateDirectoryComponent(relative: string): boolean {
  const names: readonly string[] = STATE_DIRECTORY_NAMES;
  const parts = relative.split("/");
  return parts.slice(0, -1).some((part) => names.includes(part));
}

/* ------------------------------------------------------------------------- *
 * The glob subset: Python's `fnmatch`, not `gitignore(5)` (F140-FR-018)
 * ------------------------------------------------------------------------- */

/** Escape the characters a regular expression gives a meaning to. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translate one glob the way Python's `fnmatch.translate` does, and match it
 * whole, as `fnmatchcase` does: `*` is `.*` and CROSSES `/`, `?` is one
 * character (any, `/` included), `[seq]` is a class and `[!seq]` its
 * complement, and every other character is literal. The `.` of the pattern
 * matches a line end too (`s`), because Python wraps the translation in
 * `(?s:...)`.
 *
 * Consecutive `*` collapse into one `.*`, as Python's translation does.
 * A `[` with no closing `]` is a literal `[`.
 */
export function fnmatchToRegExp(glob: string): RegExp {
  let source = "";
  let index = 0;
  while (index < glob.length) {
    const character = glob[index] as string;
    index += 1;
    if (character === "*") {
      while (glob[index] === "*") index += 1;
      source += ".*";
      continue;
    }
    if (character === "?") {
      source += ".";
      continue;
    }
    if (character !== "[") {
      source += escapeForRegExp(character);
      continue;
    }
    // `[` — find the closing `]`, as Python's translate scans for it: a `!`
    // right after the `[` and a `]` as the FIRST member are part of the class.
    let end = index;
    if (glob[end] === "!") end += 1;
    if (glob[end] === "]") end += 1;
    while (end < glob.length && glob[end] !== "]") end += 1;
    if (end >= glob.length) {
      source += "\\[";
      continue;
    }
    let members = glob.slice(index, end);
    index = end + 1;
    members = members.replace(/\\/g, "\\\\");
    if (members === "") {
      source += "(?!)";
    } else if (members === "!") {
      source += ".";
    } else {
      if (members.startsWith("!")) members = `^${members.slice(1)}`;
      else if (members.startsWith("^") || members.startsWith("[")) members = `\\${members}`;
      source += `[${members}]`;
    }
  }
  return new RegExp(`^(?:${source})$`, "s");
}

/** One rule of the root `.gitignore`, compiled (F140-FR-018). */
export type IgnoreRule = {
  /** `!pattern` — the rule UN-ignores what it matches. */
  readonly negate: boolean;
  /** A trailing `/` — the rule matches a directory only. */
  readonly directoryOnly: boolean;
  /** The pattern held a `/` — it is matched against the relative PATH. */
  readonly anchored: boolean;
  /** The translated pattern. */
  readonly test: RegExp;
  /** The line the rule was read from, for a message. */
  readonly line: string;
};

/**
 * Compile the lines of a root `.gitignore` into rules, in FILE ORDER — the
 * last matching rule wins, so the order is the rule (F140-FR-018).
 *
 * The subset, exactly as the baseline fixed it: a blank line and a `#` comment
 * are dropped; a leading `!` negates; a trailing `/` makes the rule
 * directory-only; the rule is ANCHORED when the pattern, BEFORE the two
 * rewrites below, starts with `/` or holds a `/` anywhere; then every `**\/`
 * is REMOVED and every `/**` becomes `/*`; a leading `/` is stripped. A
 * pattern that is empty after that is dropped. There is no nested ignore file.
 */
export function compileIgnoreRules(text: string): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  // Python's `str.splitlines()`: `\n`, `\r\n` and `\r` all end a line.
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    let pattern = negate ? line.slice(1) : line;
    const directoryOnly = pattern.endsWith("/");
    pattern = pattern.replace(/\/+$/, "");
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    pattern = pattern.replace(/^\/+/, "").split("**/").join("").split("/**").join("/*");
    if (pattern === "") continue;
    rules.push(
      Object.freeze({
        negate,
        directoryOnly,
        anchored,
        test: fnmatchToRegExp(pattern),
        line,
      }),
    );
  }
  return Object.freeze(rules);
}

/**
 * Whether the root `.gitignore` ignores a source-relative path. The LAST
 * matching rule wins; an anchored pattern is matched against the whole
 * relative path, an unanchored one against the BASE NAME or the path
 * (F140-FR-018).
 */
export function isIgnored(
  rules: readonly IgnoreRule[],
  relative: string,
  isDirectory: boolean,
): boolean {
  const base = relative.slice(relative.lastIndexOf("/") + 1);
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    const hit = rule.anchored
      ? rule.test.test(relative)
      : rule.test.test(base) || rule.test.test(relative);
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

/** The rules of the source's root `.gitignore`; empty where it has none. */
export function rootIgnoreRules(src: string): readonly IgnoreRule[] {
  try {
    // `errors="replace"` at the baseline: an undecodable byte is U+FFFD and
    // never an exception, so one bad byte cannot lose every rule.
    return compileIgnoreRules(readFileSync(join(src, ROOT_IGNORE_FILE), "utf8"));
  } catch {
    return Object.freeze([]);
  }
}

/* ------------------------------------------------------------------------- *
 * git
 * ------------------------------------------------------------------------- */

/** What one git call returned. */
type GitRun = {
  readonly ok: boolean;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
};

/**
 * Run git in the source. A git that is missing, that fails to start or that
 * runs past its timeout is NOT an error of the inventory: it is reported as
 * `ok: false` and the caller falls back, exactly as the baseline's
 * `except (OSError, subprocess.SubprocessError)` did.
 */
export function runGit(src: string, args: readonly string[], timeout: number): GitRun {
  const result = spawnSync("git", ["-C", src, ...args], {
    timeout,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  return Object.freeze({
    ok: result.error === undefined && result.status === 0,
    stdout,
    stderr,
  });
}

/** The real path of a path, or the path itself where it cannot be resolved. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether the source is walked in GIT mode: it must be inside a work tree AND
 * be that work tree's TOP LEVEL (F140-FR-017). A subdirectory of a repository
 * answers false and is walked by the file-system mode.
 */
export function isGitTopLevel(src: string): boolean {
  const run = runGit(
    src,
    ["rev-parse", "--is-inside-work-tree", "--show-toplevel"],
    GIT_TIMEOUTS.head,
  );
  if (!run.ok) return false;
  const lines = run.stdout
    .toString("utf8")
    .split(/\s+/)
    .filter((part) => part !== "");
  if (lines.length === 0 || lines[0] !== "true") return false;
  return realOrSelf(lines[lines.length - 1] as string) === realOrSelf(src);
}

/**
 * The verified HEAD commit, or null where there is no commit and where git
 * fails (F140-FR-017).
 */
export function gitHead(src: string): string | null {
  const run = runGit(src, ["rev-parse", "--verify", "-q", "HEAD"], GIT_TIMEOUTS.head);
  const head = run.stdout.toString("utf8").trim();
  return run.ok && head !== "" ? head : null;
}

/**
 * The sorted `XY path` entries of `git status --porcelain=v1 -z
 * --untracked-files=all`, or null where git fails (F140-FR-017).
 *
 * The `-z` form separates entries by NUL and a RENAME or COPY carries its
 * SOURCE path as the next entry; that source is dropped, so an `R`/`C` row
 * names the destination alone.
 */
export function gitStatus(src: string): readonly string[] | null {
  const run = runGit(
    src,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    GIT_TIMEOUTS.status,
  );
  if (!run.ok) return null;
  const parts = run.stdout.toString("utf8").split("\0");
  const entries: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const item = parts[index] as string;
    index += 1;
    if (item === "") continue;
    const code = item.slice(0, 2);
    const path = item.slice(3);
    if (code[0] === "R" || code[0] === "C") index += 1;
    entries.push(`${code} ${path}`);
  }
  return Object.freeze(entries.sort(compareCodePoint));
}

/**
 * The candidate paths of GIT mode: the tracked and the untracked-not-ignored
 * files, with a path dropped when any of its directory components is a name of
 * state and when it is under an exclusion (F140-FR-017). The deny list is NOT
 * applied. A failing listing is invalid input:
 * `git ls-files failed in <src>: <stderr>`.
 *
 * A path git lists that the WORK TREE LACKS — tracked but deleted — is kept
 * here and dropped by `./entries.ts`, which finds nothing to stat; `git_status`
 * still reports it.
 */
export function gitCandidates(src: string, excludes: readonly string[]): readonly string[] {
  const run = runGit(src, ["ls-files", "-co", "--exclude-standard", "-z"], GIT_TIMEOUTS.listing);
  if (!run.ok) {
    throw new InventoryError(
      `git ls-files failed in ${src}: ${run.stderr.toString("utf8").trim()}`,
    );
  }
  const kept = new Set<string>();
  for (const relative of run.stdout.toString("utf8").split("\0")) {
    if (relative === "") continue;
    if (hasAStateDirectoryComponent(relative)) continue;
    if (isUnderAnExclusion(relative, excludes)) continue;
    kept.add(relative);
  }
  return Object.freeze([...kept].sort(compareCodePoint));
}

/* ------------------------------------------------------------------------- *
 * The file-system walk (F140-FR-018)
 * ------------------------------------------------------------------------- */

/**
 * The candidate paths of the FILE-SYSTEM walk. A directory is entered only
 * when its name is not on the deny list, it is not under an exclusion and the
 * root `.gitignore` does not ignore it; a LINK is never followed, so a link to
 * a directory is ONE candidate and is not entered.
 *
 * The order of the recursion does not matter — the result is sorted by code
 * point — but the deny list, the exclusions and the ignore rules are applied
 * in the baseline's order, because a directory that is skipped hides its whole
 * subtree.
 */
export function fileSystemCandidates(src: string, excludes: readonly string[]): readonly string[] {
  const rules = rootIgnoreRules(src);
  const denied: readonly string[] = DENY_DIRECTORIES;
  const found: string[] = [];
  const pending: string[] = [""];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let listing;
    try {
      listing = readdirSync(join(src, directory), { withFileTypes: true });
    } catch {
      // A directory that cannot be read contributes nothing, as `os.walk`
      // with its default `onerror` does.
      continue;
    }
    for (const child of listing) {
      const relative = directory === "" ? child.name : `${directory}/${child.name}`;
      const full = join(src, directory, child.name);
      const link = child.isSymbolicLink();
      // `os.walk` asks whether the entry IS a directory, following a link to
      // decide — so a link to a directory lands among the directories and is
      // then recorded as a link and never entered.
      let isDirectory = child.isDirectory();
      if (link) {
        try {
          isDirectory = statSync(full).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (isDirectory) {
        if (link) {
          if (!isUnderAnExclusion(relative, excludes) && !isIgnored(rules, relative, true)) {
            found.push(relative);
          }
          continue;
        }
        if (denied.includes(child.name)) continue;
        if (isUnderAnExclusion(relative, excludes)) continue;
        if (isIgnored(rules, relative, true)) continue;
        pending.push(relative);
        continue;
      }
      if (isUnderAnExclusion(relative, excludes)) continue;
      if (isIgnored(rules, relative, false)) continue;
      found.push(relative);
    }
  }
  return Object.freeze(found.sort(compareCodePoint));
}

/* ------------------------------------------------------------------------- *
 * The walk core
 * ------------------------------------------------------------------------- */

/** The candidate paths of a source and the mode they were found in. */
export type Candidates = {
  /** The source-relative paths, sorted by code point. */
  readonly paths: readonly string[];
  /** `git` or `walk` (F140-FR-017). */
  readonly mode: WalkMode;
};

/**
 * The candidate paths of a source, before any classification: git mode when
 * the source is the top level of a work tree, the file-system walk otherwise
 * (F140-FR-017, F140-FR-018).
 */
export function candidatePaths(src: string, excludes: readonly string[]): Candidates {
  if (isGitTopLevel(src)) {
    return Object.freeze({ paths: gitCandidates(src, excludes), mode: "git" as const });
  }
  return Object.freeze({ paths: fileSystemCandidates(src, excludes), mode: "walk" as const });
}

/** Whether a path under the source is a directory, following no link. */
export function isADirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
