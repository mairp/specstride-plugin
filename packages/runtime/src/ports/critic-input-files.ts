// T093 — the file-reading port and the file-moving port of feature 117 ON THE
// FILE SYSTEM, with the adapters handed to the modules of
// `packages/core/src/critic-input/` at the composition root
// (`assumption: CQ-185`).
//
// The types live in `packages/core/src/critic-input/ports.ts`; this module
// implements their SHAPE structurally and imports no core package, so the
// dependency layout of feature 122 stays as it is. The core modules hold the
// order of the steps and the records; every call of the file system stands
// behind the two ports (F117-FR-040 to F117-FR-042).
//
// The move carries the bytes, the mode and the modification time exactly: it
// writes the content to a temporary name in the TARGET directory, sets the
// mode and the modification time, renames, and only then removes the source.
// A write that never renames leaves the file at its old place, and a rename
// inside one directory never crosses a file system — so the move keeps bytes,
// mode and mtime across file systems as well (T092).
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** The stat of one path, as `packages/core/src/critic-input/ports.ts` shapes it. */
type PortStat = {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  mode?: number;
};

/** The file-reading port, as `packages/core/src/critic-input/ports.ts` shapes it. */
export interface NodeFileReadingPort {
  stat(path: string, options?: { readonly noFollow?: boolean }): PortStat | undefined;
  read(path: string, offset: number, limit: number): Uint8Array | undefined;
  realpath(path: string): string | undefined;
  listDirectory(path: string): readonly string[] | undefined;
  matchBelow(root: string, pattern: string): readonly string[];
}

/** A move carries the bytes, the mode and the modification time. */
export interface NodeMovedFile {
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly mtimeMs: number;
}

/** The file-moving port, as `packages/core/src/critic-input/ports.ts` shapes it. */
export interface NodeFileMovingPort {
  moveFile(from: string, to: string, file: NodeMovedFile): void;
  setAside(from: string, asideRoot: string): void;
  exists(path: string): boolean;
  listWorkerRoot(): readonly string[];
}

/** The file-reading port on the file system (T093). */
export function nodeFileReader(): NodeFileReadingPort {
  return {
    stat(path, options) {
      try {
        const st = options?.noFollow === true ? lstatSync(path) : statSync(path);
        return {
          isFile: st.isFile(),
          isDirectory: st.isDirectory(),
          size: st.size,
          mtimeMs: st.mtimeMs,
          mode: st.mode & 0o7777,
        };
      } catch {
        return undefined;
      }
    },
    read(path, offset, limit) {
      let fd = -1;
      try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(limit);
        const read = readSync(fd, buffer, 0, limit, offset);
        return new Uint8Array(buffer.subarray(0, read));
      } catch {
        return undefined;
      } finally {
        if (fd >= 0) closeSync(fd);
      }
    },
    realpath(path) {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
    listDirectory(path) {
      try {
        return readdirSync(path).sort();
      } catch {
        return undefined;
      }
    },
    matchBelow(root, pattern) {
      const out: string[] = [];
      collect(root, pattern, "", out);
      return out.sort();
    },
  };
}

/** Walk `root` below `prefix`, matching the glob against the relative path. */
function collect(root: string, pattern: string, prefix: string, out: string[]): void {
  let names: readonly string[];
  try {
    names = readdirSync(join(root, prefix));
  } catch {
    return;
  }
  for (const name of names) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (matchGlob(pattern, relative)) out.push(relative);
    let isDirectory = false;
    try {
      isDirectory = statSync(join(root, relative)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (isDirectory) collect(root, pattern, relative, out);
  }
}

/** The one glob form the port fixes: `*` inside a segment, `**` across them. */
function matchGlob(pattern: string, relative: string): boolean {
  const marker = "@@globstar@@";
  const source = pattern
    .split("**/")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join("(?:.*/)?")
    .split(marker)
    .join(".*");
  return new RegExp(`^${source}$`).test(relative);
}

let moveCounter = 0;

/** The file-moving port on the file system (T093). */
export function nodeFileMover(workerRoot: string): NodeFileMovingPort {
  return {
    moveFile(from, to, file) {
      const directory = dirname(to);
      mkdirSync(directory, { recursive: true });
      // A temporary name in the TARGET directory: the rename is atomic, and a
      // failure anywhere before it leaves the source at its old place.
      const temporary = join(directory, `.${basename(to)}.move-${process.pid}-${moveCounter++}`);
      let fd = -1;
      try {
        fd = openSync(temporary, "wx", file.mode & 0o7777);
        writeSync(fd, file.bytes);
      } finally {
        if (fd >= 0) closeSync(fd);
      }
      try {
        chmodSync(temporary, file.mode & 0o7777);
        const instant = new Date(file.mtimeMs);
        utimesSync(temporary, instant, instant);
        renameSync(temporary, to);
      } catch (err) {
        try {
          rmSync(temporary, { force: true });
        } catch {
          /* the temporary name may never have been created */
        }
        throw err;
      }
      // The content is at the new place; now the old one goes.
      rmSync(from, { force: true });
    },
    setAside(from, asideRoot) {
      mkdirSync(asideRoot, { recursive: true });
      renameSync(from, join(asideRoot, basename(from)));
    },
    exists(path) {
      return existsSync(path);
    },
    listWorkerRoot() {
      try {
        return readdirSync(workerRoot)
          .filter((name) => !name.startsWith("."))
          .sort();
      } catch {
        return [];
      }
    },
  };
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
