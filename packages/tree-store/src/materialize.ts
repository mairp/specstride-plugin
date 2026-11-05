/**
 * The operation `materialize` of the tree store (annex D §D.2, row 2):
 * `materialize(treeId, workerId) → worker tree`. Three tasks live here, and
 * each is a separate requirement about the same directory:
 *
 *  T028, F143-FR-005 — WHERE THE TREE IS. Under the WORKER ROOT, which lies
 *    outside the workspace and outside the control plane; the path holds ONE
 *    OPAQUE RANDOM COMPONENT and no run, group or worker ordinal; the
 *    directory and everything in it are READABLE AND WRITABLE BY THE OWNER
 *    ONLY.
 *
 *  T029, F143-FR-006 — WHAT THE TREE IS. A REPOSITORY OF ITS OWN: the
 *    repository directory lies INSIDE the tree and BORROWS THE OBJECTS OF THE
 *    STORE READ-ONLY, so that no worker can write the store. Nothing is made
 *    in the project's repository: no branch, no reference, not one file.
 *
 *  T030, F143-FR-007 — WHAT IS IN IT. An IGNORED PATH IS ABSENT, because it
 *    is in no snapshot. A SEED PATH IS COPIED IN before the pass — copied,
 *    never linked and never shared writable. Neither is ever part of a delta,
 *    which `changed.ts` enforces from the same two lists.
 *
 * WHY A COPY AND NEVER A CHECKOUT (research.md D-4). The bytes of every entry
 * are read out of the store with `cat-file` and written by this process to a
 * temporary name, then renamed. git is never asked to put a file in the tree,
 * so no attributes file — of this tree or of any other — can start a filter
 * or convert a line end on the way in (F143-FR-004). The bytes in the tree
 * are the bytes of the snapshot, byte for byte.
 *
 * WHY THE REPOSITORY IS INSIDE THE TREE and not a linked worktree of the
 * store (ruling P6, R29v V-06, research.md D-2). A linked worktree keeps the
 * worker's repository directory in the CONTROL PLANE, inside a proposer's
 * write scope; a repository of its own keeps it inside the tree, where the
 * worker may do as it likes with it, because the engine reads the FILES and
 * never the history (F143-FR-006).
 *
 * WHY AN ALTERNATE IS A READ-ONLY BORROW. `objects/info/alternates` names
 * the store's object directory, so the worker's git can READ every object of
 * the base snapshot; git NEVER WRITES into an alternate — a new object of the
 * worker lands in the worker repository's own object directory. The borrow is
 * therefore read-only by the shape of the mechanism and not by a permission
 * that someone must remember to set, and `CT-143-106` proves it from the
 * outside: it commits in a worker tree and shows the store's object list is
 * the same list afterwards.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { TreeId, WorkerTree } from "@specstride/contracts/ep/tree-store";
import {
  initializeAWorkerRepository,
  inStore,
  listTree,
  readObject,
  type StorePlaces,
  type StoreTreeEntry,
} from "./git.ts";
import { REPOSITORY_DIRECTORY } from "./snapshot.ts";
import { verifyBeforeMaterialize } from "./verify.ts";

/* ------------------------------------------------------------------ *
 * T028 — the place of a worker tree (F143-FR-005).
 * ------------------------------------------------------------------ */

/** The mode of every directory of a worker tree: the owner only. */
export const OWNER_ONLY_DIRECTORY = 0o700 as const;

/** The mode of an ordinary file of a worker tree: the owner only. */
export const OWNER_ONLY_FILE = 0o600 as const;

/** The mode of an executable file of a worker tree: the owner only. */
export const OWNER_ONLY_EXECUTABLE = 0o700 as const;

/** The bits no path of a worker tree may carry: anything beyond the owner. */
export const BITS_BEYOND_THE_OWNER = 0o077 as const;

/** The number of random bytes the opaque component of a path is made of. */
export const OPAQUE_COMPONENT_BYTES = 16 as const;

/** The name of the tree inside its opaque directory. */
export const TREE_COMPONENT = "tree" as const;

/** The name of the temporary directory of a worker, BESIDE its tree (F143-FR-009). */
export const TEMPORARY_COMPONENT = "tmp" as const;

/**
 * F143-FR-005 — the opaque component of the path of a worker tree. RANDOM,
 * so that it can carry no ordinal of a run, a group or a worker even by
 * accident, and so that two runs never choose the same name.
 */
export function opaqueComponent(): string {
  return randomBytes(OPAQUE_COMPONENT_BYTES).toString("hex");
}

/** The suffix `materialize` writes to before it renames (never a checkout). */
export const TEMPORARY_SUFFIX = ".tree-store-tmp" as const;

/**
 * F143-FR-005 — true where the path has the ONE SHAPE the requirement allows:
 * exactly ONE component below the worker root, that component 32 hexadecimal
 * characters of random data, and then the fixed name `tree`. The check is
 * positive, so a test states what the path may be and not merely what it may
 * not.
 */
export function pathIsOpaqueUnderTheWorkerRoot(workerRoot: string, treePath: string): boolean {
  const below = relative(resolve(workerRoot), resolve(treePath)).split(sep);
  if (below.length !== 2 || below[0] === ".." || below[1] !== TREE_COMPONENT) return false;
  return new RegExp(`^[0-9a-f]{${String(OPAQUE_COMPONENT_BYTES * 2)}}$`).test(String(below[0]));
}

/**
 * F143-FR-005 — true where the path NAMES one of the ordinals handed in: the
 * ordinal appears in a component of the path as a DELIMITED TOKEN, which is
 * what "the path holds no run, group or worker ordinal" means.
 *
 * It is read as a token and not as a substring on purpose. The opaque
 * component is 32 hexadecimal characters of random data, so the decimal digit
 * `1` is inside almost every one of them by chance; a path that CARRIES an
 * ordinal carries it the way a name does — `group-2`, `worker_3`, `run.17` —
 * and that is what this finds. The stronger guarantee, that the path is not a
 * function of any ordinal AT ALL, is observed in `CT-143-105` by making two
 * trees for the same worker and the same tree id and showing their paths
 * differ.
 */
export function pathNamesAnOrdinal(
  treePath: string,
  ordinals: readonly (string | number)[],
): boolean {
  return ordinals.some((ordinal) => {
    const token = String(ordinal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![0-9A-Za-z])${token}(?![0-9A-Za-z])`).test(treePath);
  });
}

/**
 * F143-FR-005 — true where the worker root lies outside the workspace and
 * outside the control plane. A path inside either would put a worker tree
 * where a proposer of the main line, or the runtime's own state, already is.
 */
export function workerRootIsOutside(
  workerRoot: string,
  places: { readonly workspace: string; readonly control: string },
): boolean {
  const inside = (parent: string): boolean => {
    const rel = relative(resolve(parent), resolve(workerRoot));
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
  };
  return !inside(places.workspace) && !inside(places.control);
}

/** F143-FR-005 — true where the path is readable and writable by the owner only. */
export function ownerOnly(path: string): boolean {
  return (lstatSync(path).mode & BITS_BEYOND_THE_OWNER) === 0;
}

/**
 * Every path under `directory`, with the paths that carry a bit beyond the
 * owner. An empty list is what F143-FR-005 asks for.
 */
export function pathsBeyondTheOwner(directory: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if ((lstatSync(dir).mode & BITS_BEYOND_THE_OWNER) !== 0) out.push(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // the mode of a link is not its own
      if (entry.isDirectory()) walk(full);
      else if ((lstatSync(full).mode & BITS_BEYOND_THE_OWNER) !== 0) out.push(full);
    }
  };
  if (existsSync(directory)) walk(directory);
  return Object.freeze(out.sort());
}

/* ------------------------------------------------------------------ *
 * T029 — a repository of its own that borrows the store read-only
 * (F143-FR-006).
 * ------------------------------------------------------------------ */

/** The file of a repository that names the object directories it borrows. */
export const ALTERNATES_FILE = "objects/info/alternates" as const;

/** The object directory of a repository, relative to it. */
export const OBJECTS_DIRECTORY = "objects" as const;

/** F143-FR-006 — the repository directory of a worker tree lies INSIDE it. */
export function repositoryDirectoryOf(treePath: string): string {
  return join(treePath, REPOSITORY_DIRECTORY);
}

/** The alternates file of a worker tree. */
export function alternatesFileOf(treePath: string): string {
  return join(repositoryDirectoryOf(treePath), ...ALTERNATES_FILE.split("/"));
}

/**
 * F143-FR-006 — give a worker tree a repository of its own that borrows the
 * objects of the store read-only. The repository is made in the tree, not in
 * the store and not in the project; `objects/info/alternates` is the whole of
 * the link, and git writes no object through an alternate.
 */
export function giveItARepositoryOfItsOwn(places: StorePlaces, treePath: string): string {
  initializeAWorkerRepository(places, treePath);
  const repository = repositoryDirectoryOf(treePath);
  const info = join(repository, OBJECTS_DIRECTORY, "info");
  mkdirSync(info, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  writeFileSync(alternatesFileOf(treePath), join(places.store, OBJECTS_DIRECTORY) + "\n", {
    mode: OWNER_ONLY_FILE,
  });
  return repository;
}

/**
 * F143-FR-006 — what a reader can check about the borrow, as data: the tree's
 * repository is inside the tree, its alternates file names the store's
 * objects, its own object directory is NOT the store's, and it has no remote
 * through which anything could be pushed to the store.
 */
export type BorrowState = {
  readonly repositoryIsInsideTheTree: boolean;
  readonly alternatesNamesTheStore: boolean;
  readonly itsOwnObjectDirectoryIsNotTheStore: boolean;
  readonly remotes: readonly string[];
};

/** Read the state of the borrow of one worker tree. */
export function borrowState(places: StorePlaces, treePath: string): BorrowState {
  const repository = repositoryDirectoryOf(treePath);
  const alternates = existsSync(alternatesFileOf(treePath))
    ? readlinkOrRead(alternatesFileOf(treePath))
    : "";
  const remotes = remotesOfRepository(repository);
  return Object.freeze({
    repositoryIsInsideTheTree: relative(resolve(treePath), resolve(repository)) === ".git",
    alternatesNamesTheStore: alternates.trim() === join(places.store, OBJECTS_DIRECTORY),
    itsOwnObjectDirectoryIsNotTheStore:
      resolve(join(repository, OBJECTS_DIRECTORY)) !==
      resolve(join(places.store, OBJECTS_DIRECTORY)),
    remotes: Object.freeze(remotes),
  });
}

/**
 * The remotes a repository names, READ FROM ITS CONFIGURATION FILE and not
 * through a process. `git remote` would list them too, but `remote` is one of
 * the commands that can WRITE a repository (`remote add` makes a reference
 * namespace), and `readInDirectory` refuses those outright (F143-FR-002): the
 * deny list of `git.ts` is absolute rather than argument-dependent, so the
 * borrow is read with `readFileSync` instead of a fifth door into git.
 */
export function remotesOfRepository(repository: string): readonly string[] {
  const path = join(repository, "config");
  if (!existsSync(path)) return Object.freeze([]);
  const named: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*\[\s*remote\s+"([^"]*)"\s*\]/.exec(line);
    if (m !== null) named.push(String(m[1]));
  }
  return Object.freeze(named);
}

/**
 * The content of the alternates file. A LINK in its place is read as its
 * target, so a borrow pointed somewhere else by a link fails the comparison
 * rather than passing it.
 */
function readlinkOrRead(path: string): string {
  return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path, "utf8");
}

/** F143-FR-006 — true where the borrow is in the one shape the requirement allows. */
export function borrowsTheStoreReadOnly(places: StorePlaces, treePath: string): boolean {
  const state = borrowState(places, treePath);
  return (
    state.repositoryIsInsideTheTree &&
    state.alternatesNamesTheStore &&
    state.itsOwnObjectDirectoryIsNotTheStore &&
    state.remotes.length === 0
  );
}

/** The object ids the store holds, sorted. The instrument of "no worker can write the store". */
export function objectsOfTheStore(places: StorePlaces): readonly string[] {
  return Object.freeze(
    inStore(places, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"])
      .stdout.split("\n")
      .filter((line) => line !== "")
      .sort(),
  );
}

/* ------------------------------------------------------------------ *
 * T030 — seed paths (F143-FR-007).
 * ------------------------------------------------------------------ */

/** F143-FR-007 — a seed path is never linked. */
export const A_SEED_PATH_IS_LINKED = false as const;

/** F143-FR-007 — a seed path is never shared writable. */
export const A_SEED_PATH_IS_SHARED_WRITABLE = false as const;

/** Where seed paths come from (F143-FR-007). */
export const SOURCES_OF_SEED_PATHS = ["a toolchain profile", "user configuration"] as const;

/** A seed path with its source, as a profile or configuration names it. */
export type SeedPath = {
  /** The path, relative to the workspace. */
  readonly path: string;
  /** Which of `SOURCES_OF_SEED_PATHS` named it. */
  readonly source?: (typeof SOURCES_OF_SEED_PATHS)[number];
};

/** The path of a seed path, whichever of the two forms it was given in. */
export function seedPathOf(seed: string | SeedPath): string {
  return (typeof seed === "string" ? seed : seed.path).replace(/\/+$/, "");
}

/**
 * F143-FR-007 — copy the seed paths into a worker tree BEFORE THE PASS. Each
 * is a real copy: `cpSync` with `dereference`, so a link in the source
 * becomes the FILE it names and no path of the tree reaches outside it, and
 * with the owner-only modes of F143-FR-005, so nothing is shared writable.
 *
 * A seed path that is absent from the source is skipped and reported, because
 * a profile may name a cache that this project has not built yet.
 */
export function copySeedPaths(
  from: string,
  treePath: string,
  seeds: readonly (string | SeedPath)[],
): { readonly copied: readonly string[]; readonly absent: readonly string[] } {
  const copied: string[] = [];
  const absent: string[] = [];
  for (const seed of seeds) {
    const path = seedPathOf(seed);
    const source = join(from, path);
    if (!existsSync(source)) {
      absent.push(path);
      continue;
    }
    const target = join(treePath, path);
    mkdirSync(dirname(target), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    cpSync(source, target, {
      recursive: true,
      // A seed path is NEVER LINKED: a link in the source is followed and
      // the bytes are copied, so the tree holds no handle to anything
      // outside itself (F143-FR-007).
      dereference: true,
      force: true,
      preserveTimestamps: false,
    });
    makeOwnerOnly(target);
    copied.push(path);
  }
  return Object.freeze({
    copied: Object.freeze(copied.sort()),
    absent: Object.freeze(absent.sort()),
  });
}

/** Set the owner-only modes of F143-FR-005 over a path and everything under it. */
export function makeOwnerOnly(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, OWNER_ONLY_DIRECTORY);
    for (const entry of readdirSync(path)) makeOwnerOnly(join(path, entry));
    return;
  }
  chmodSync(path, (stat.mode & 0o111) !== 0 ? OWNER_ONLY_EXECUTABLE : OWNER_ONLY_FILE);
}

/* ------------------------------------------------------------------ *
 * The operation.
 * ------------------------------------------------------------------ */

/** What `materialize` is given beyond the tree id and the worker id. */
export type MaterializeOptions = {
  /** The directory the seed paths are copied FROM, ordinarily the workspace. */
  readonly seedSource?: string;
  /** The seed paths of the toolchain profile or of user configuration. */
  readonly seedPaths?: readonly (string | SeedPath)[];
};

/** What one call of `materialize` made, beyond the worker tree itself. */
export type MaterializedTree = WorkerTree & {
  /** The temporary directory of the worker, beside the tree (F143-FR-009). */
  readonly temporaryDirectory: string;
  /** The opaque component of the path (F143-FR-005). */
  readonly opaque: string;
  /** The repository directory of the tree (F143-FR-006). */
  readonly repository: string;
  /** The seed paths copied in, and those the source did not hold (F143-FR-007). */
  readonly seedPaths: readonly string[];
  readonly seedPathsAbsent: readonly string[];
};

/**
 * F143-FR-003 — every object of the tree is present in the store. Checked
 * BEFORE one directory is made, so a missing object refuses the group rather
 * than leaving half a tree behind. The check and its refusal live in
 * `verify.ts` from T047 on; the two names below are re-exported so that a
 * caller of this module keeps reading one interface.
 */
export { ObjectMissingFromTheStore, everyObjectIsPresent } from "./verify.ts";

/** Write one entry of the tree into the worker tree. Never a checkout. */
export function writeEntry(places: StorePlaces, treePath: string, entry: StoreTreeEntry): void {
  const target = join(treePath, entry.path);
  mkdirSync(dirname(target), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  const bytes = readObject(places, entry.oid);
  if (entry.mode === "120000") {
    rmSync(target, { force: true });
    symlinkSync(Buffer.from(bytes).toString("utf8"), target);
    return;
  }
  const temporary = `${target}${TEMPORARY_SUFFIX}`;
  writeFileSync(temporary, bytes, {
    mode: entry.mode === "100755" ? OWNER_ONLY_EXECUTABLE : OWNER_ONLY_FILE,
  });
  renameSync(temporary, target);
}

/**
 * F143-FR-005, F143-FR-006, F143-FR-007 — MAKE A WORKER TREE from a tree of
 * the store. Writes the WORKER ROOT and nothing else: not one path of the
 * workspace, and nothing under the project's repository directory.
 */
export function materialize(
  places: StorePlaces,
  treeId: TreeId,
  workerId: string,
  options: MaterializeOptions = {},
): MaterializedTree {
  verifyBeforeMaterialize(places, treeId);

  const opaque = opaqueComponent();
  const home = join(places.workerRoot, opaque);
  const treePath = join(home, TREE_COMPONENT);
  const temporaryDirectory = join(home, TEMPORARY_COMPONENT);
  mkdirSync(home, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  chmodSync(home, OWNER_ONLY_DIRECTORY);
  mkdirSync(treePath, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  chmodSync(treePath, OWNER_ONLY_DIRECTORY);
  mkdirSync(temporaryDirectory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  chmodSync(temporaryDirectory, OWNER_ONLY_DIRECTORY);

  // The bytes of the snapshot, written by this process (research.md D-4).
  for (const entry of listTree(places, treeId)) writeEntry(places, treePath, entry);

  // T029 — a repository of its own that borrows the store read-only.
  giveItARepositoryOfItsOwn(places, treePath);

  // T030 — the seed paths, copied in before the pass. An IGNORED path needs
  // nothing done to it: it is in no snapshot, so it is already absent.
  const seeds =
    options.seedPaths === undefined || options.seedSource === undefined
      ? { copied: [] as readonly string[], absent: [] as readonly string[] }
      : copySeedPaths(options.seedSource, treePath, options.seedPaths);

  // The owner-only rule holds over every path of the tree, the repository
  // directory included (F143-FR-005).
  makeOwnerOnly(home);

  return Object.freeze({
    workerId,
    path: treePath,
    treeId,
    temporaryDirectory,
    opaque,
    repository: repositoryDirectoryOf(treePath),
    seedPaths: seeds.copied,
    seedPathsAbsent: seeds.absent,
  });
}

/** The directory of a worker: its tree, its temporary directory, and nothing else. */
export function homeOfAWorkerTree(treePath: string): string {
  return dirname(treePath);
}

/** True where the path exists and is a directory. Used by `release` and `sweep`. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
