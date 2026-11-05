/**
 * T007 — THE ONE PLACE THAT STARTS GIT, with the fixed environment
 * (F143-FR-004; R29v PU-80; research.md D-3).
 *
 * Every repository process of the runtime is started here and nowhere else.
 * That is not tidiness: F143-FR-004 is a statement about EVERY such process —
 * no system configuration, no global configuration, hooks and the file-system
 * monitor off, no filter, no text conversion, no external difference tool and
 * no merge driver — and a requirement of that shape is only keepable if there
 * is exactly one door. `packages/tree-store/test/git.test.ts` asserts that
 * this file is the only file of the package that names `node:child_process`,
 * so a second door would fail the suite rather than merely exist.
 *
 * WHAT THE HARDENING IS MADE OF, and why each part is needed:
 *
 *  1 THE SYSTEM CONFIGURATION is removed by `GIT_CONFIG_NOSYSTEM=1`, which
 *    every git since 1.7 obeys.
 *  2 THE GLOBAL CONFIGURATION is removed by pointing `HOME` and
 *    `XDG_CONFIG_HOME` at a directory THAT DOES NOT EXIST. `GIT_CONFIG_GLOBAL`
 *    is set as well, but is NOT relied on: it arrived in git 2.32 and the
 *    floor of research.md D-3 is 2.31, where it is simply ignored. A
 *    non-existent `HOME` is the mechanism that works on both.
 *  3 HOOKS are off by `core.hooksPath=/dev/null`: the path is a file, so no
 *    hook of any name can be found under it.
 *  4 THE FILE-SYSTEM MONITOR is off by `core.fsmonitor=false`, and the
 *    untracked cache with it.
 *  5 NO FILTER AND NO TEXT CONVERSION: `core.autocrlf=false`,
 *    `core.safecrlf=false`, `core.eol=lf` and `core.attributesFile=/dev/null`,
 *    so no attributes file outside a tree can name a filter. An attributes
 *    file INSIDE a tree cannot start one either, because the operations never
 *    check out and never apply a patch — they write the bytes of the stored
 *    object themselves (research.md D-4) — and because the one command that
 *    reads a file into an object carries `--no-filters`.
 *  6 NO EXTERNAL DIFFERENCE TOOL AND NO MERGE DRIVER: `diff.external=` and
 *    `merge.default=` are carried as EMPTY settings, and `protocol.allow=never`
 *    stops anything being fetched or pushed. An empty `diff.external` FAILS
 *    CLOSED, which is the point: a patch that would have started a tool named
 *    by a repository's OWN configuration — the one source that removing the
 *    system and global configuration cannot reach — exits non-zero and starts
 *    nothing. The store never needs a patch (research.md D-4: it writes the
 *    bytes of the stored object and never applies one), and the plumbing it
 *    does read, `diff-tree --name-status`, is unaffected.
 *  7 THE SETTINGS TRAVEL ON THE COMMAND LINE, as `-c` pairs, and are never
 *    written into a configuration file. No file of any repository — the
 *    project's included — has to be trusted for the hardening to hold.
 *  8 THE PROJECT'S REPOSITORY IS NEVER WRITTEN. A call that writes names the
 *    store in `gitDir` and a temporary index of the control plane in
 *    `indexFile`; `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0` stop even a
 *    read refreshing the project's index.
 *
 * WHAT IS NOT HERE. Comparing the configuration of the store with its
 * recorded hash is task T048 and the rule that no write lands under the
 * project's repository directory is task T046; both belong to this file and
 * arrive with User Story 2. This phase builds the door and the environment.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";

/* ------------------------------------------------------------------ *
 * The executable.
 * ------------------------------------------------------------------ */

/** The executable the store starts (plan.md, "Primary Dependencies"). */
export const GIT = "git" as const;

/**
 * The variable that names a different git executable. It exists so that a
 * run on the floor version of research.md D-3 drives the same code as a run
 * on the git of the machine, and for nothing else.
 */
export const GIT_EXECUTABLE_VARIABLE = "SPECSTRIDE_TREE_STORE_GIT" as const;

/** The git executable of this process. */
export function gitExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const named = env[GIT_EXECUTABLE_VARIABLE];
  return named !== undefined && named !== "" ? named : GIT;
}

/* ------------------------------------------------------------------ *
 * The fixed commit data (F143-FR-003).
 * ------------------------------------------------------------------ */

/** The fixed author, date and message of every store commit (F143-FR-003). */
export const FIXED_COMMIT = Object.freeze({
  author: "Specstride <specstride@invalid>",
  name: "Specstride",
  email: "specstride@invalid",
  /** The value handed to git in `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`. */
  date: "1970-01-01T00:00:00+00:00",
  /**
   * The same instant as git prints it with `%aI`. THE RENDERING IS NOT STABLE
   * ACROSS VERSIONS: git 2.31 writes the offset `+00:00` and git 2.47 writes
   * `Z` (task T002). Both name the one instant below, so a caller compares
   * the instant and never the rendering.
   */
  datesAsGitPrintsThem: Object.freeze(["1970-01-01T00:00:00Z", "1970-01-01T00:00:00+00:00"]),
  /** The same instant as `%at` prints it. */
  unixTime: "0",
  message: "specstride tree-store snapshot",
});

/* ------------------------------------------------------------------ *
 * The fixed settings (F143-FR-004).
 * ------------------------------------------------------------------ */

/**
 * F143-FR-004 — the settings every repository process of the runtime carries,
 * passed as `-c` pairs on the command line and never written to a file.
 */
export const FIXED_CONFIG = Object.freeze([
  // Hooks off: the path is a file, so no hook of any name can be found.
  "core.hooksPath=/dev/null",
  // The file-system monitor off, and the untracked cache with it.
  "core.fsmonitor=false",
  "core.untrackedCache=false",
  // No text conversion, in either direction.
  "core.autocrlf=false",
  "core.safecrlf=false",
  "core.eol=lf",
  // No attributes file outside a tree can name a filter.
  "core.attributesFile=/dev/null",
  // No external difference tool and no merge driver.
  "diff.external=",
  "diff.noprefix=false",
  "merge.default=",
  // Nothing is ever fetched or pushed by the store.
  "protocol.allow=never",
  // Deterministic reading.
  "core.quotePath=false",
  "core.precomposeUnicode=false",
  "log.showSignature=false",
  // No background work of any kind in the store.
  "gc.auto=0",
  "maintenance.auto=false",
]);

/**
 * The flag that stands before the settings: a READ may not refresh the
 * project's index (F143-FR-002).
 */
export const NO_OPTIONAL_LOCKS = "--no-optional-locks" as const;

/** The argv prefix of every repository process: the flag and the settings. */
export const FIXED_ARGV_PREFIX: readonly string[] = Object.freeze([
  NO_OPTIONAL_LOCKS,
  ...FIXED_CONFIG.flatMap((setting) => ["-c", setting]),
]);

/* ------------------------------------------------------------------ *
 * The fixed environment (F143-FR-004).
 * ------------------------------------------------------------------ */

/**
 * The home of a repository process: A DIRECTORY THAT DOES NOT EXIST. See
 * point 2 of the head of this file — this, and not `GIT_CONFIG_GLOBAL`, is
 * what removes the global configuration on the floor version.
 */
export const NEUTRAL_HOME = "/nonexistent/specstride-tree-store" as const;

/** The variables the fixed environment sets, in the order they are read. */
export const FIXED_ENVIRONMENT_VARIABLES = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_ATTR_NOSYSTEM",
  "GIT_TERMINAL_PROMPT",
  "GIT_OPTIONAL_LOCKS",
  "GIT_ASKPASS",
  "GIT_PAGER",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "LC_ALL",
  "LANG",
  "TZ",
] as const;

/**
 * F143-FR-004 — THE FIXED ENVIRONMENT of a repository process. The
 * environment of the parent takes no part in it but `PATH`: the returned
 * record is built from nothing, so a variable of the machine — `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, a proxy, a credential helper — cannot
 * reach the child by being inherited.
 */
export function fixedEnvironment(
  options: {
    readonly neutralHome?: string;
    readonly gitDir?: string;
    readonly indexFile?: string;
    readonly parentEnv?: NodeJS.ProcessEnv;
  } = {},
): Record<string, string> {
  const home = options.neutralHome ?? NEUTRAL_HOME;
  const parent = options.parentEnv ?? process.env;
  const env: Record<string, string> = {
    PATH: parent["PATH"] ?? "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: `${home}/xdg`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_ASKPASS: "/bin/true",
    GIT_PAGER: "cat",
    GIT_AUTHOR_NAME: FIXED_COMMIT.name,
    GIT_AUTHOR_EMAIL: FIXED_COMMIT.email,
    GIT_AUTHOR_DATE: FIXED_COMMIT.date,
    GIT_COMMITTER_NAME: FIXED_COMMIT.name,
    GIT_COMMITTER_EMAIL: FIXED_COMMIT.email,
    GIT_COMMITTER_DATE: FIXED_COMMIT.date,
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
  };
  if (options.gitDir !== undefined) env["GIT_DIR"] = options.gitDir;
  if (options.indexFile !== undefined) env["GIT_INDEX_FILE"] = options.indexFile;
  return env;
}

/* ------------------------------------------------------------------ *
 * The call.
 * ------------------------------------------------------------------ */

/** The time one repository process may take. */
export const TIME_LIMIT_MS = 120_000 as const;

/** The output one repository process may produce. */
export const OUTPUT_CAP_BYTES = 256 * 1024 * 1024;

/**
 * The arguments a CALLER may not pass, because this module owns them: the
 * settings, the repository, the working tree and the directory. A caller that
 * passed its own `-c` could undo the hardening of F143-FR-004 silently, so
 * the attempt is refused rather than merged.
 */
export const ARGUMENTS_THE_CALLER_MAY_NOT_PASS = [
  "-c",
  "--config-env",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "-C",
  NO_OPTIONAL_LOCKS,
] as const;

/** One call of git. */
export type GitCall = {
  /** The arguments after the fixed prefix, e.g. `["write-tree"]`. */
  readonly argv: readonly string[];
  /** The working directory of the process. */
  readonly cwd: string;
  /** The repository this process may write. NEVER the project's. */
  readonly gitDir?: string;
  /** The index this process may write. NEVER the project's. */
  readonly indexFile?: string;
  /** The home of the process; a directory that need not exist. */
  readonly neutralHome?: string;
  /** Bytes fed to standard input; standard input is closed when absent. */
  readonly stdin?: Uint8Array | string;
  /** The executable, when it is not the one `gitExecutable()` gives. */
  readonly executable?: string;
  /** When true, a non-zero exit and a failure to start are returned. */
  readonly allowFailure?: boolean;
  /** A shorter time limit than `TIME_LIMIT_MS`. */
  readonly timeLimitMs?: number;
  /** A smaller output cap than `OUTPUT_CAP_BYTES`. */
  readonly outputCapBytes?: number;
};

/** What one call of git gave back. */
export type GitResult = {
  /** False where the process could not be started at all. */
  readonly started: boolean;
  readonly status: number;
  readonly stdout: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderr: string;
  /** The message of a failure to start, or the empty string. */
  readonly error: string;
  /** The argv the process was given, the fixed prefix included. */
  readonly argv: readonly string[];
};

/** The error a failed call throws. */
export class GitCallFailed extends Error {
  readonly result: GitResult;
  constructor(result: GitResult) {
    super(
      result.started
        ? `git ${result.argv.join(" ")} exited ${String(result.status)}: ${result.stderr.trim()}`
        : `git could not be started: ${result.error}`,
    );
    this.name = "GitCallFailed";
    this.result = result;
  }
}

/** The whole argv of a call: the fixed prefix and then the caller's. */
export function argvOf(call: GitCall): readonly string[] {
  for (const argument of call.argv) {
    if ((ARGUMENTS_THE_CALLER_MAY_NOT_PASS as readonly string[]).includes(argument)) {
      throw new Error(
        `\`${argument}\` belongs to the one place that starts git (F143-FR-004) and may not be passed by a caller`,
      );
    }
  }
  return Object.freeze([...FIXED_ARGV_PREFIX, ...call.argv]);
}

/**
 * F143-FR-004 — START GIT. The ONE place in the product that does, and the
 * only file of this package that names `node:child_process`.
 *
 * Synchronous on purpose: every operation of the store is a short sequence of
 * processes whose next step depends on the output of the one before, the
 * engine owns its own concurrency through the group executor, and a
 * synchronous call cannot interleave two writes of the same temporary index.
 */
export function runGit(call: GitCall): GitResult {
  const argv = argvOf(call);
  const env = fixedEnvironment({
    neutralHome: call.neutralHome,
    gitDir: call.gitDir,
    indexFile: call.indexFile,
  });
  const spawned = spawnSync(call.executable ?? gitExecutable(), [...argv], {
    cwd: call.cwd,
    env,
    input: call.stdin,
    timeout: call.timeLimitMs ?? TIME_LIMIT_MS,
    maxBuffer: call.outputCapBytes ?? OUTPUT_CAP_BYTES,
    // Standard input is closed when nothing is fed in.
    stdio: call.stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  const stdoutBytes =
    spawned.stdout instanceof Uint8Array
      ? spawned.stdout
      : Buffer.from(String(spawned.stdout ?? ""));
  const failedToStart = spawned.error !== undefined && spawned.error !== null;
  const result: GitResult = Object.freeze({
    started: !failedToStart,
    status: failedToStart ? -1 : (spawned.status ?? -1),
    stdout: Buffer.from(stdoutBytes).toString("utf8"),
    stdoutBytes,
    stderr: String(spawned.stderr ?? ""),
    error: failedToStart ? String(spawned.error?.message ?? spawned.error) : "",
    argv,
  });
  if (call.allowFailure !== true && (!result.started || result.status !== 0)) {
    throw new GitCallFailed(result);
  }
  return result;
}

/** `runGit` that returns the result of a failure instead of throwing. */
export function tryGit(call: GitCall): GitResult {
  return runGit({ ...call, allowFailure: true });
}

/** The standard output of a call, trimmed. The ordinary reading of a value. */
export function gitOutput(call: GitCall): string {
  return runGit(call).stdout.trim();
}

/** The name of this file, for a message that must say where the door is. */
export const THE_ONE_PLACE = "packages/tree-store/src/git.ts" as const;

/* ------------------------------------------------------------------ *
 * THE TYPED READERS OVER THE STORE.
 *
 * The operations of the store (T027 onward) are policy: what a snapshot
 * covers, which paths a delta holds, which entries a composition replaces.
 * The plumbing underneath is a handful of git calls, and those calls live
 * HERE, beside the door, for the reason the head of this file gives: the only
 * way "every repository process of the runtime is hardened" (F143-FR-004)
 * stays true is that there is exactly one file from which a repository
 * process can be started. A reader placed in an operation module would need
 * its own `runGit` import and would be a second place to audit; placed here
 * it is the same door with a type on it.
 * ------------------------------------------------------------------ */

/**
 * The three places the store owns, all by logical name (annex B, §B.5):
 * `tree-store` and `worker-root` of the service, and the control plane in
 * which a temporary index lives. NONE of them is the project's repository.
 */
export type StorePlaces = {
  /** The store: a repository of the runtime, one per run (F143-FR-002). */
  readonly store: string;
  /** The worker root, under which worker trees are made (F143-FR-005). */
  readonly workerRoot: string;
  /** The control plane, which holds the temporary index files. */
  readonly control: string;
};

/** One entry of a tree of the store: a blob or a link, never a subtree. */
export type StoreTreeEntry = {
  /** `100644`, `100755` or `120000`. */
  readonly mode: string;
  /** The object id of the content. */
  readonly oid: string;
  /** The path, relative to the root of the tree. */
  readonly path: string;
};

/** A call of git against the store, with the store as its repository. */
export function inStore(
  places: StorePlaces,
  argv: readonly string[],
  extra: { readonly stdin?: Uint8Array | string; readonly indexFile?: string } = {},
): GitResult {
  // F143-FR-004, T048 — the configuration of the store is compared with its
  // recorded hash BEFORE the process is started, and never after it.
  compareTheStoreConfigurationWithItsHash(places);
  return runGit({
    argv,
    cwd: places.store,
    gitDir: places.store,
    ...(extra.stdin === undefined ? {} : { stdin: extra.stdin }),
    ...(extra.indexFile === undefined ? {} : { indexFile: extra.indexFile }),
  });
}

/**
 * The blobs and links of a tree, recursively and by path. `-z` is used
 * because a path of a real project holds spaces, quotation marks and bytes
 * that are not text, and `core.quotePath=false` of the fixed settings keeps
 * them as they are.
 */
export function listTree(places: StorePlaces, treeId: string): readonly StoreTreeEntry[] {
  return Object.freeze(
    inStore(places, ["ls-tree", "-r", "-z", "--full-tree", treeId])
      .stdout.split("\0")
      .filter((line) => line !== "")
      .map((line) => {
        const tab = line.indexOf("\t");
        const [mode, , oid] = line.slice(0, tab).split(" ");
        return Object.freeze({ mode: String(mode), oid: String(oid), path: line.slice(tab + 1) });
      }),
  );
}

/** A tree of the store as a map from path to entry. */
export function treeByPath(
  places: StorePlaces,
  treeId: string,
): ReadonlyMap<string, StoreTreeEntry> {
  return new Map(listTree(places, treeId).map((entry) => [entry.path, entry]));
}

/** The bytes of one object of the store, exactly as they were stored. */
export function readObject(places: StorePlaces, oid: string): Uint8Array {
  return inStore(places, ["cat-file", "blob", oid]).stdoutBytes;
}

/**
 * True where the object is present in the store. The check before
 * `materialize` and before the application is made of this (F143-FR-003).
 */
export function objectIsPresent(places: StorePlaces, oid: string): boolean {
  return tryInStore(places, ["cat-file", "-e", oid]).status === 0;
}

/** `inStore` that returns the result of a failure instead of throwing. */
export function tryInStore(places: StorePlaces, argv: readonly string[]): GitResult {
  compareTheStoreConfigurationWithItsHash(places);
  return tryGit({ argv, cwd: places.store, gitDir: places.store });
}

/**
 * Store the bytes handed in and give the object id. `--no-filters` and the
 * bytes on standard input together mean NO ATTRIBUTE OF ANY TREE CAN START A
 * PROCESS: git is never shown the path the bytes came from (F143-FR-004).
 */
export function storeBytes(places: StorePlaces, bytes: Uint8Array): string {
  return inStore(places, ["hash-object", "-w", "--no-filters", "--stdin"], {
    stdin: bytes,
  }).stdout.trim();
}

/**
 * The object id the bytes WOULD have, without storing them. Used to compare a
 * file of the workspace with an entry of a tree while writing nothing at all
 * (F143-FR-020, "only onto a workspace whose fingerprint equals the base").
 */
export function objectIdOfBytes(places: StorePlaces, bytes: Uint8Array): string {
  return inStore(places, ["hash-object", "--no-filters", "--stdin"], {
    stdin: bytes,
  }).stdout.trim();
}

/** A temporary index of the control plane. NEVER the project's index. */
let temporaryIndexOrdinal = 0;
export function freshIndexFile(places: StorePlaces): string {
  temporaryIndexOrdinal += 1;
  return `${places.control}/index-${String(process.pid)}-${String(temporaryIndexOrdinal)}`;
}

/**
 * Write a tree from `<mode> <oid>\t<path>` lines, through a temporary index of
 * the control plane. The lines carry object ids only, so no path of any
 * working tree is read and no filter can be reached.
 */
export function writeTreeFromLines(places: StorePlaces, lines: readonly string[]): string {
  const indexFile = freshIndexFile(places);
  inStore(places, ["update-index", "--index-info"], {
    indexFile,
    stdin: lines.length === 0 ? "" : lines.join("\n") + "\n",
  });
  return inStore(places, ["write-tree"], { indexFile }).stdout.trim();
}

/** The line one entry contributes to `update-index --index-info`. */
export function indexInfoLine(entry: StoreTreeEntry): string {
  return `${entry.mode} ${entry.oid}\t${entry.path}`;
}

/**
 * The tree written from a set of entries, sorted by path so that the same set
 * always gives the same tree id whatever order it was built in
 * (F143-FR-019, "the order of completion must have no effect").
 */
export function writeTreeFromEntries(
  places: StorePlaces,
  entries: Iterable<StoreTreeEntry>,
): string {
  return writeTreeFromLines(
    places,
    [...entries]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(indexInfoLine),
  );
}

/* ------------------------------------------------------------------ *
 * T046 — THE PROJECT'S REPOSITORY IS NEVER WRITTEN (F143-FR-002).
 *
 * F143-FR-002 says the store is a repository of the runtime, one per run, in
 * the CONTROL PLANE, and that no operation of the store or of the layer writes
 * a file under the PROJECT'S repository directory, creates a reference there
 * or changes the project's index.
 *
 * That is kept BY CONSTRUCTION rather than by care, and the construction is
 * the four doors below. Every call the store makes goes through exactly one of
 * them:
 *
 *   `inStore` / `tryInStore`       — name the STORE as their repository, always.
 *   `readInDirectory`              — may read any directory and REFUSES a
 *                                    command that can write a repository.
 *   `initializeARepositoryOfTheRuntime` — the one `init`, refused unless the
 *                                    path is in one of the three places;
 *                                    `initializeTheStore` and
 *                                    `initializeAWorkerRepository` are its
 *                                    two narrower forms.
 *
 * and `theVersionOnly`, which is given no repository at all. A write can
 * therefore land only under `places.store`, `places.workerRoot` or
 * `places.control` — the three places the runtime owns (annex B §B.5) — and
 * `packages/tree-store/test/git.test.ts` asserts that no file of `src/` but
 * this one names `runGit` or `tryGit`, so a fifth door would fail the suite
 * rather than merely exist.
 * ------------------------------------------------------------------ */

/** F143-FR-002 — the project's repository directory is never written. */
export const THE_PROJECTS_REPOSITORY_IS_NEVER_WRITTEN = true as const;

/** The three places of the runtime a call may write, by logical name. */
export const PLACES_A_CALL_MAY_WRITE = ["tree-store", "worker-root", "control"] as const;
export type PlaceACallMayWrite = (typeof PLACES_A_CALL_MAY_WRITE)[number] | "somewhere else";

/**
 * The git commands that can write a repository. The list is a DENY list on
 * purpose: a command that is not named here is one the store has been read
 * through, and a command this package does not use yet cannot be reached from
 * `readInDirectory` at all, because the four doors are the only callers.
 */
export const COMMANDS_THAT_WRITE_A_REPOSITORY: readonly string[] = Object.freeze([
  "add",
  "am",
  "apply",
  "bisect",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "commit-tree",
  "config",
  "fast-import",
  "fetch",
  "filter-branch",
  "gc",
  "hash-object",
  "index-pack",
  "init",
  "maintenance",
  "merge",
  "mktag",
  "mktree",
  "mv",
  "notes",
  "pack-objects",
  "pack-refs",
  "prune",
  "prune-packed",
  "pull",
  "push",
  "rebase",
  "reflog",
  "remote",
  "repack",
  "replace",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "symbolic-ref",
  "tag",
  "unpack-objects",
  "update-index",
  "update-ref",
  "worktree",
  "write-tree",
]);

/** The command of an argv: its first member that is not an option. */
export function theCommandOf(argv: readonly string[]): string {
  for (const argument of argv) if (!argument.startsWith("-")) return argument;
  return "";
}

/** True where the command of the argv can write a repository. */
export function commandWritesARepository(argv: readonly string[]): boolean {
  return COMMANDS_THAT_WRITE_A_REPOSITORY.includes(theCommandOf(argv));
}

/** Which of the runtime's places a path lies in, if any. */
export function placeOfThePath(places: StorePlaces, path: string): PlaceACallMayWrite {
  const inside = (place: string): boolean => {
    const r = relative(resolve(place), resolve(path));
    return r === "" || (!r.startsWith("..") && !isAbsolute(r));
  };
  if (inside(places.store)) return "tree-store";
  if (inside(places.workerRoot)) return "worker-root";
  if (inside(places.control)) return "control";
  return "somewhere else";
}

/**
 * The refusal of a call that could write outside the three places of the
 * runtime — the project's repository above all (F143-FR-002).
 */
export class AWriteOutsideThePlaces extends Error {
  readonly command: string;
  readonly where: string;
  constructor(command: string, where: string) {
    super(
      `\`git ${command}\` can write a repository and \`${where}\` is none of the places the ` +
        `runtime owns (${PLACES_A_CALL_MAY_WRITE.join(", ")}): the project's repository is never ` +
        `written, no reference is made there and its index never changes (F143-FR-002)`,
    );
    this.name = "AWriteOutsideThePlaces";
    this.command = command;
    this.where = where;
  }
}

/**
 * F143-FR-002 — READ A DIRECTORY the runtime does not own: the workspace, or a
 * worker tree. The call is given no `gitDir`, so git discovers the repository
 * of that directory, and A COMMAND THAT CAN WRITE A REPOSITORY IS REFUSED
 * BEFORE THE PROCESS IS STARTED. With `--no-optional-locks` of the fixed argv
 * prefix and `GIT_OPTIONAL_LOCKS=0` of the fixed environment, not even a
 * refresh of the project's index is written by what remains.
 */
export function readInDirectory(
  places: StorePlaces,
  directory: string,
  argv: readonly string[],
  extra: { readonly stdin?: Uint8Array | string; readonly allowFailure?: boolean } = {},
): GitResult {
  if (commandWritesARepository(argv)) {
    throw new AWriteOutsideThePlaces(theCommandOf(argv), directory);
  }
  compareTheStoreConfigurationWithItsHash(places);
  return runGit({
    argv,
    cwd: directory,
    ...(extra.stdin === undefined ? {} : { stdin: extra.stdin }),
    ...(extra.allowFailure === undefined ? {} : { allowFailure: extra.allowFailure }),
  });
}

/**
 * F143-FR-002 — MAKE A REPOSITORY OF THE RUNTIME. The one `init` of this
 * package: refused unless the path lies in one of the three places the
 * runtime owns, so that no `init` reachable from here can touch the project.
 */
export function initializeARepositoryOfTheRuntime(
  places: StorePlaces,
  path: string,
  options: { readonly bare?: boolean; readonly place?: PlaceACallMayWrite } = {},
): GitResult {
  const where = placeOfThePath(places, path);
  const wanted = options.place;
  if (where === "somewhere else" || (wanted !== undefined && where !== wanted)) {
    throw new AWriteOutsideThePlaces("init", path);
  }
  return runGit({
    argv: options.bare === true ? ["init", "--bare", "--quiet", path] : ["init", "--quiet", path],
    cwd: places.control,
  });
}

/**
 * F143-FR-002 — make the store: a BARE repository of the runtime, in the
 * control plane. The one write of `init` the store makes to itself, and the
 * place its configuration hash is first recorded (F143-FR-004, T048).
 */
export function initializeTheStore(places: StorePlaces): GitResult {
  const result = initializeARepositoryOfTheRuntime(places, places.store, {
    bare: true,
    place: "tree-store",
  });
  recordTheStoreConfiguration(places);
  return result;
}

/**
 * F143-FR-006 — make the repository of a worker tree. Refused unless the tree
 * lies under the worker root, so that no `init` of this package can reach the
 * project (F143-FR-002).
 */
export function initializeAWorkerRepository(places: StorePlaces, treePath: string): GitResult {
  compareTheStoreConfigurationWithItsHash(places);
  return initializeARepositoryOfTheRuntime(places, treePath, { place: "worker-root" });
}

/** `git --version` and nothing else: the one call given no repository. */
export function theVersionOnly(options: {
  readonly executable?: string;
  readonly timeLimitMs?: number;
  readonly outputCapBytes?: number;
}): GitResult {
  return tryGit({
    argv: ["--version"],
    cwd: process.cwd(),
    ...(options.executable === undefined ? {} : { executable: options.executable }),
    ...(options.timeLimitMs === undefined ? {} : { timeLimitMs: options.timeLimitMs }),
    ...(options.outputCapBytes === undefined ? {} : { outputCapBytes: options.outputCapBytes }),
  });
}

/* ------------------------------------------------------------------ *
 * T048 — THE CONFIGURATION OF THE STORE, COMPARED WITH ITS HASH
 * (F143-FR-004).
 *
 * F143-FR-004 asks that every repository process of the runtime run "with the
 * configuration of the store compared with its recorded hash first". The
 * reason is the one source the fixed settings cannot reach: `-c` pairs beat
 * the system and the global configuration, and `GIT_CONFIG_NOSYSTEM` removes
 * one and a non-existent `HOME` the other — but A REPOSITORY'S OWN
 * `config` IS READ BY GIT WHATEVER THE COMMAND LINE SAYS for settings the
 * fixed list does not name. The store's `config` is written once, by
 * `initializeTheStore`, and its hash is recorded beside it in the control
 * plane. Every later call through a door of this file compares the two FIRST
 * and refuses to start a process when they differ, so a hand that edits the
 * store's configuration stops the store instead of steering it.
 * ------------------------------------------------------------------ */

/** The configuration file of a repository, relative to its directory. */
export const STORE_CONFIGURATION_FILE = "config" as const;

/** Where the recorded hash is kept: the control plane, beside the store. */
export const STORE_CONFIGURATION_HASH_FILE = "tree-store-config.sha256" as const;

/** The algorithm of the recorded hash. */
export const STORE_CONFIGURATION_HASH = "sha256" as const;

/** The path of the configuration file of the store. */
export function storeConfigurationPath(places: StorePlaces): string {
  return join(places.store, STORE_CONFIGURATION_FILE);
}

/** The path of the recorded hash of the configuration of the store. */
export function storeConfigurationHashPath(places: StorePlaces): string {
  return join(places.control, STORE_CONFIGURATION_HASH_FILE);
}

/** The hash of the bytes, as the recorded hash is taken. */
export function hashOfBytes(bytes: Uint8Array): string {
  return createHash(STORE_CONFIGURATION_HASH).update(bytes).digest("hex");
}

/**
 * The hash of the configuration of the store as it is on disk NOW, or the
 * empty string where the store has no configuration file at all.
 */
export function storeConfigurationHash(places: StorePlaces): string {
  const path = storeConfigurationPath(places);
  if (!existsSync(path)) return "";
  return hashOfBytes(readFileSync(path));
}

/** F143-FR-004 — record the hash of the configuration of the store. */
export function recordTheStoreConfiguration(places: StorePlaces): string {
  const hash = storeConfigurationHash(places);
  mkdirSync(places.control, { recursive: true, mode: 0o700 });
  writeFileSync(storeConfigurationHashPath(places), hash + "\n", { mode: 0o600 });
  return hash;
}

/** The recorded hash, or the empty string where none has been recorded. */
export function recordedStoreConfigurationHash(places: StorePlaces): string {
  const path = storeConfigurationHashPath(places);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

/** What one comparison of the configuration with its hash found. */
export type StoreConfigurationComparison = {
  /** The hash recorded beside the store, or the empty string. */
  readonly recorded: string;
  /** The hash of the configuration as it is on disk now. */
  readonly found: string;
  /** False only where a hash was recorded and the two differ. */
  readonly equal: boolean;
  /** False where nothing has been recorded yet, so nothing was compared. */
  readonly compared: boolean;
};

/** The refusal of a store whose configuration is not the one that was recorded. */
export class StoreConfigurationChanged extends Error {
  readonly comparison: StoreConfigurationComparison;
  constructor(comparison: StoreConfigurationComparison) {
    super(
      `the configuration of the store does not match its recorded hash ` +
        `(recorded ${comparison.recorded || "<nothing>"}, found ${comparison.found || "<nothing>"}): ` +
        `no repository process of the runtime is started (F143-FR-004)`,
    );
    this.name = "StoreConfigurationChanged";
    this.comparison = comparison;
  }
}

/**
 * F143-FR-004 — COMPARE THE CONFIGURATION OF THE STORE WITH ITS RECORDED
 * HASH, and throw rather than start a process when they differ. Called by
 * every door of this file before the process, which is what makes "every
 * repository process of the runtime" true of it.
 */
export function compareTheStoreConfigurationWithItsHash(
  places: StorePlaces,
): StoreConfigurationComparison {
  const recorded = recordedStoreConfigurationHash(places);
  const found = storeConfigurationHash(places);
  const comparison: StoreConfigurationComparison = Object.freeze({
    recorded,
    found,
    equal: recorded === "" || recorded === found,
    compared: recorded !== "",
  });
  if (!comparison.equal) throw new StoreConfigurationChanged(comparison);
  return comparison;
}
