/**
 * The operation `snapshot` of the tree store (annex D §D.2, row 1;
 * F143-FR-003, F143-FR-004).
 *
 * `snapshot(directory) → treeId`. WHAT IT COVERS is exactly the fingerprint
 * scope — tracked files with their uncommitted changes, and untracked files
 * that are not ignored — LESS THE WORKSPACE PART. So:
 *
 *  - an ignored path is in no snapshot, and therefore in no worker tree and in
 *    no delta (F143-FR-007);
 *  - the workspace part is in no snapshot, because it is the runtime's own
 *    state and not the proposer's work (F143-FR-003);
 *  - the TASK LIST is an ordinary tracked file of the workspace, so it IS in
 *    every snapshot (F143-FR-008). It is dropped from the DELTA instead, by
 *    `changed.ts`, which is a different thing from never storing it.
 *
 * HOW IT STORES BYTES. Every file is read by this process and handed to git on
 * standard input with `--no-filters` (`storeBytes` of `git.ts`). git is never
 * shown the path the bytes came from and never checks a file out, so no
 * attributes file of any tree — the project's own included — can start a
 * filter process or convert a line end: A SNAPSHOT STORES THE BYTES ON DISK
 * (F143-FR-004). A symbolic link is stored as a link whose content is its
 * target, and the link is never followed.
 *
 * THE STORE COMMIT. Every snapshot also writes a commit over the tree, with
 * the fixed author, date and message of `FIXED_COMMIT` (F143-FR-003). It
 * exists only in the store, which lies outside the project's repository; it is
 * never a parent of a commit of the project and is never pushed, because
 * `protocol.allow=never` is one of the fixed settings; and it goes with the
 * run. The commit is not the result of the operation — a tree id is — but it
 * is what makes the objects of the snapshot reachable inside the store.
 *
 * T047 ADDS THE TWO THINGS R29v PU-100 ASKS FOR.
 *
 *  1 EVERY OBJECT THAT NO REFERENCE OF THE PROJECT REACHES IS COPIED INTO THE
 *    STORE (`copyUnreachableObjects`). The blob of an uncommitted change and
 *    the blob of an untracked file are reachable from no reference of the
 *    project, so a `gc` in the project may remove them at any moment; a store
 *    that only pointed at them would hold a tree it could not read an hour
 *    later. The store therefore holds ITS OWN COPY of every object of every
 *    snapshot — `storeBytes` writes it as the scope is walked — and this
 *    function is the statement of that guarantee, taken against the project's
 *    own reachability and not against a comment.
 *  2 A FINAL SNAPSHOT USES THE IGNORE RULES OF THE BASE SNAPSHOT
 *    (`ignoreRulesOf`). A worker owns the files of its tree, `.gitignore`
 *    among them. Were a final snapshot to use the tree's own rules, a worker
 *    could DELETE a rule and pull an ignored file — `.env`, a build output —
 *    into its delta and from there into the workspace, or ADD one and hide a
 *    file it had created. So the candidates come from the worker tree and the
 *    ignore DECISION comes from the ignore files of the base tree, replayed in
 *    a directory of the control plane that holds nothing else.
 *
 * The verification gate and grounding still run on the WORKING TREE and never
 * on a snapshot (F143-FR-003): the store offers no checkout and hands no path
 * of itself to anything, which is what `VERIFICATION_RUNS_ON` states.
 */
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TreeId } from "@specstride/contracts/ep/tree-store";
import {
  FIXED_COMMIT,
  initializeARepositoryOfTheRuntime,
  inStore,
  listTree,
  objectIsPresent,
  readInDirectory,
  readObject,
  storeBytes,
  writeTreeFromLines,
  type StorePlaces,
  type StoreTreeEntry,
} from "./git.ts";

/** The workspace part (annex B, §B.2). A snapshot never covers it. */
export const WORKSPACE_PART = ".specstride" as const;

/** True where the path is the workspace part or lies under it. */
export function isWorkspacePart(path: string): boolean {
  return path === WORKSPACE_PART || path.startsWith(`${WORKSPACE_PART}/`);
}

/** The repository directory of a tree, which no snapshot covers (F143-FR-006). */
export const REPOSITORY_DIRECTORY = ".git" as const;

/** True where the path is the repository directory of a tree or lies under it. */
export function isRepositoryDirectory(path: string): boolean {
  return path === REPOSITORY_DIRECTORY || path.startsWith(`${REPOSITORY_DIRECTORY}/`);
}

/** F143-FR-003 — the verification gate and grounding run on the working tree. */
export const VERIFICATION_RUNS_ON = "the working tree" as const;

/** F143-FR-003 — grounding never runs on a snapshot. */
export const GROUNDING_RUNS_ON_A_SNAPSHOT = false as const;

/* ------------------------------------------------------------------ *
 * The ignore rules of a tree (R29v PU-100).
 * ------------------------------------------------------------------ */

/** The name of an ignore file of a tree. */
export const IGNORE_FILE = ".gitignore" as const;

/** Where the replayed ignore rules of a tree are kept: the control plane. */
export const IGNORE_RULES_DIRECTORY = "ignore-rules" as const;

/** True where the path is an ignore file of a tree. */
export function isIgnoreFile(path: string): boolean {
  return path === IGNORE_FILE || path.endsWith(`/${IGNORE_FILE}`);
}

/** The ignore files of a tree of the store, in the order of their paths. */
export function ignoreFilesOfTree(places: StorePlaces, treeId: TreeId): readonly StoreTreeEntry[] {
  return Object.freeze(listTree(places, treeId).filter((entry) => isIgnoreFile(entry.path)));
}

/**
 * R29v PU-100 — THE IGNORE RULES OF A TREE, REPLAYED. A directory of the
 * control plane that holds the ignore files of `treeId` at their own paths and
 * NOTHING ELSE, with a repository of its own so that `check-ignore` can be
 * asked about a path. Its index stays empty, so the answer is the rules and
 * never the state of a file.
 */
export function ignoreRulesDirectory(places: StorePlaces, treeId: TreeId): string {
  const directory = join(places.control, IGNORE_RULES_DIRECTORY, treeId);
  const marker = join(directory, REPOSITORY_DIRECTORY, "HEAD");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const entry of ignoreFilesOfTree(places, treeId)) {
    const target = join(directory, entry.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, readObject(places, entry.oid), { mode: 0o600 });
  }
  try {
    lstatSync(marker);
  } catch {
    initializeARepositoryOfTheRuntime(places, directory, { place: "control" });
  }
  return directory;
}

/**
 * R29v PU-100 — the candidates the ignore rules of `treeId` exclude. The
 * decision is taken by git itself against the replayed rules, so every shape
 * of pattern a project uses — a directory rule, a negation, a rule in a
 * subdirectory — means here exactly what it means in the project.
 */
export function pathsIgnoredByTheRulesOf(
  places: StorePlaces,
  treeId: TreeId,
  candidates: readonly string[],
): ReadonlySet<string> {
  if (candidates.length === 0) return new Set();
  const directory = ignoreRulesDirectory(places, treeId);
  const result = readInDirectory(
    places,
    directory,
    ["check-ignore", "--no-index", "-z", "--stdin"],
    { stdin: candidates.join("\0") + "\0", allowFailure: true },
  );
  // `check-ignore` exits 1 when no candidate matched, which is not a failure.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `the ignore rules of ${treeId} could not be read: git exited ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }
  return new Set(result.stdout.split("\0").filter((path) => path !== ""));
}

/* ------------------------------------------------------------------ *
 * The fingerprint scope.
 * ------------------------------------------------------------------ */

/** What a snapshot of a directory is taken with. */
export type SnapshotOptions = {
  /**
   * The tree whose ignore rules decide what is ignored. Given for a FINAL
   * snapshot, where the rules of the BASE snapshot stand (R29v PU-100).
   */
  readonly ignoreRulesOf?: TreeId;
};

/**
 * F143-FR-003 — THE FINGERPRINT SCOPE of a directory: tracked files with
 * their uncommitted changes, and untracked files that are not ignored, less
 * the workspace part and less the repository directory of the tree itself.
 *
 * `ls-files --cached --others` is a PURE READ of the index of that directory,
 * and it carries `--no-optional-locks` from the fixed argv prefix, so not even
 * a refresh of the index is written (F143-FR-002) — `readInDirectory` refuses
 * a command that could write one at all.
 *
 * WHICH RULES DECIDE. Without `ignoreRulesOf` the rules are the directory's
 * own, through `--exclude-standard`: that is a BASE snapshot, where the
 * directory IS the project. With `ignoreRulesOf` the candidates are listed
 * WITHOUT `--exclude-standard` and the ignore decision is taken against the
 * rules of that tree: that is a FINAL snapshot, where the directory is a
 * worker tree whose own `.gitignore` the worker may have edited (R29v PU-100).
 */
export function fingerprintScope(
  places: StorePlaces,
  directory: string,
  options: SnapshotOptions = {},
): readonly string[] {
  const base = options.ignoreRulesOf;
  const listed = readInDirectory(places, directory, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    ...(base === undefined ? ["--exclude-standard"] : []),
  ]).stdout;
  const candidates = [...new Set(listed.split("\0").filter((path) => path !== ""))]
    .filter((path) => !isWorkspacePart(path) && !isRepositoryDirectory(path))
    .sort();
  if (base === undefined) return Object.freeze(candidates);
  const ignored = pathsIgnoredByTheRulesOf(places, base, candidates);
  return Object.freeze(candidates.filter((path) => !ignored.has(path)));
}

/** The `update-index --index-info` line for one path of a directory. */
export function indexInfoLineForPath(
  places: StorePlaces,
  directory: string,
  path: string,
): string | undefined {
  const full = join(directory, path);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    // Listed by the index but gone from disk: a deletion, which a snapshot
    // records by leaving the path out rather than by storing an empty file.
    return undefined;
  }
  if (stat.isSymbolicLink()) {
    return `120000 ${storeBytes(places, Buffer.from(readlinkSync(full)))}\t${path}`;
  }
  if (!stat.isFile()) return undefined;
  const mode = (stat.mode & 0o111) !== 0 ? "100755" : "100644";
  return `${mode} ${storeBytes(places, readFileSync(full))}\t${path}`;
}

/* ------------------------------------------------------------------ *
 * The objects no reference of the project reaches (R29v PU-100).
 * ------------------------------------------------------------------ */

/**
 * The objects a reference of the repository of `directory` reaches. A pure
 * read: `rev-list --objects --all` walks the references and writes nothing.
 * A directory with no reference at all — a fresh worker tree — gives the
 * empty set, which is the honest answer and makes every object of its final
 * snapshot unreachable, as it is.
 */
export function objectsReachableFromAReferenceOf(
  places: StorePlaces,
  directory: string,
): ReadonlySet<string> {
  const listed = readInDirectory(
    places,
    directory,
    ["rev-list", "--objects", "--all", "--no-object-names"],
    { allowFailure: true },
  );
  if (listed.status !== 0) return new Set();
  return new Set(
    listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((l) => l !== ""),
  );
}

/**
 * R29v PU-100 — the objects of the tree that NO REFERENCE OF THE PROJECT
 * REACHES. These are the objects a `gc` in the project may remove, and the
 * ones the store must therefore hold itself.
 */
export function objectsNoReferenceOfTheProjectReaches(
  places: StorePlaces,
  directory: string,
  treeId: TreeId,
): readonly string[] {
  const reachable = objectsReachableFromAReferenceOf(places, directory);
  return Object.freeze(
    [...new Set(listTree(places, treeId).map((entry) => entry.oid))]
      .filter((oid) => !reachable.has(oid))
      .sort(),
  );
}

/** What one copy of the unreachable objects of a tree did. */
export type UnreachableObjects = {
  /** The objects of the tree no reference of the project reaches. */
  readonly unreachable: readonly string[];
  /** Those of them this call had to copy in, because the store lacked them. */
  readonly copied: readonly string[];
};

/**
 * R29v PU-100 — COPY INTO THE STORE EVERY OBJECT THAT NO REFERENCE OF THE
 * PROJECT REACHES. In the ordinary course `copied` is empty, because
 * `indexInfoLineForPath` has already written every object of the scope into
 * the store's OWN object database with `hash-object -w`; this call is what
 * makes the guarantee true rather than incidental — it is taken against the
 * project's reachability, and an object the store does not hold is fetched
 * from the project and written in before the snapshot is handed back.
 */
export function copyUnreachableObjects(
  places: StorePlaces,
  directory: string,
  treeId: TreeId,
): UnreachableObjects {
  const unreachable = objectsNoReferenceOfTheProjectReaches(places, directory, treeId);
  const copied: string[] = [];
  for (const oid of unreachable) {
    if (objectIsPresent(places, oid)) continue;
    const bytes = readInDirectory(places, directory, ["cat-file", "blob", oid]).stdoutBytes;
    storeBytes(places, bytes);
    copied.push(oid);
  }
  return Object.freeze({ unreachable, copied: Object.freeze(copied) });
}

/* ------------------------------------------------------------------ *
 * The operation.
 * ------------------------------------------------------------------ */

/** Everything one snapshot did, for a caller that needs more than a tree id. */
export type SnapshotDetail = {
  readonly treeId: string;
  /** The store commit over the tree (F143-FR-003). */
  readonly commit: string;
  /** The paths the snapshot covers, sorted. */
  readonly paths: readonly string[];
  /** The tree whose ignore rules decided, for a final snapshot. */
  readonly ignoreRulesOf: string;
  /** The objects no reference of the project reaches, and those copied in. */
  readonly unreachable: readonly string[];
  readonly copied: readonly string[];
};

/**
 * F143-FR-003 — TAKE A SNAPSHOT of `directory` into the store. Writes the
 * store and NOTHING ELSE: not one path of the directory it reads, and nothing
 * under that directory's repository directory.
 */
export function takeASnapshot(
  places: StorePlaces,
  directory: string,
  options: SnapshotOptions = {},
): SnapshotDetail {
  const paths = fingerprintScope(places, directory, options);
  const lines: string[] = [];
  const covered: string[] = [];
  for (const path of paths) {
    const line = indexInfoLineForPath(places, directory, path);
    if (line === undefined) continue;
    lines.push(line);
    covered.push(path);
  }
  const treeId = writeTreeFromLines(places, lines);
  const commit = storeCommitOf(places, treeId);
  const { unreachable, copied } = copyUnreachableObjects(places, directory, treeId);
  return Object.freeze({
    treeId,
    commit,
    paths: Object.freeze(covered),
    ignoreRulesOf: options.ignoreRulesOf ?? "",
    unreachable,
    copied,
  });
}

/** F143-FR-003 — the operation of the interface: a snapshot's tree id. */
export function snapshot(
  places: StorePlaces,
  directory: string,
  options: SnapshotOptions = {},
): string {
  return takeASnapshot(places, directory, options).treeId;
}

/**
 * F143-FR-003 — the store commit over a tree: fixed author, fixed date, fixed
 * message, no parent. It exists only in the store and goes with the run.
 */
export function storeCommitOf(places: StorePlaces, treeId: string): string {
  return inStore(places, ["commit-tree", treeId, "-m", FIXED_COMMIT.message]).stdout.trim();
}
