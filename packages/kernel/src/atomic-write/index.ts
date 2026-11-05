/**
 * T023 — the atomic write of the kernel (annex B, §B.2, SL-2; F100-FR-036).
 *
 * Every file the runtime writes is written to a temporary name in the same
 * directory, fsynced, and renamed into place, so that no reader sees a
 * partial file. A state file holds current state only; history is the event
 * stream.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
  opendirSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { FILE_MODE, DIRECTORY_MODE, guardPath } from "./path-guard.ts";

export * from "./path-guard.ts";

/** A state file holds current state only; history is the event stream (SL-2). */
export const A_STATE_FILE_HOLDS_HISTORY = false as const;

/** The three steps of the atomic write, in order (F100-FR-036). */
export const STEPS = ["write-temporary-in-the-same-directory", "fsync", "rename"] as const;

/** What the caller may set on an atomic write. */
export type AtomicWriteOptions = {
  /** The mode of the file; owner-only by default (F100-FR-043). */
  readonly mode?: number | undefined;
  /** The root the path must stay inside (F100-FR-043). */
  readonly root?: string | undefined;
  /** The control plane, where a symbolic link is refused (F100-FR-043). */
  readonly controlRoot?: string | undefined;
  /** A counter that makes the temporary name unique; the caller may pin it. */
  readonly attempt?: number | undefined;
  /** Create the directory of the file when it is missing. */
  readonly createDirectory?: boolean | undefined;
};

let counter = 0;

/**
 * The temporary name of a write: a name in the SAME directory as the target,
 * so that the rename is atomic (F100-FR-036). It is hidden and carries the
 * process id and a counter, so that two writers never pick the same name.
 */
export function temporaryNameFor(path: string, attempt?: number): string {
  const n = attempt ?? counter++;
  return join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${n}`);
}

/**
 * F100-FR-036 — write to a temporary name in the same directory, fsync,
 * rename into place. No reader sees a partial file: a reader that opens
 * during the write sees the old file or the new one.
 */
export function atomicWrite(
  path: string,
  contents: string | Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  if (options.root !== undefined) guardPath(path, options.root, options.controlRoot);
  const directory = dirname(path);
  if (options.createDirectory === true) {
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  }
  const temporary = temporaryNameFor(path, options.attempt);
  const mode = options.mode ?? FILE_MODE;
  const bytes =
    typeof contents === "string" ? Buffer.from(contents, "utf8") : Buffer.from(contents);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", mode);
    writeSync(fd, bytes);
    // fsync the file, so that the bytes are on the medium before the rename.
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    fsyncDirectory(directory);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* the write already failed; the close adds nothing */
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* the temporary name may never have been created */
    }
    throw err;
  }
}

/** fsync the directory, so that the rename itself is durable. */
function fsyncDirectory(directory: string): void {
  let dir: ReturnType<typeof opendirSync> | undefined;
  try {
    dir = opendirSync(directory);
    fsyncSync((dir as unknown as { fd: number }).fd);
  } catch {
    /* not every platform lets a directory be fsynced; the rename stands */
  } finally {
    try {
      dir?.closeSync();
    } catch {
      /* nothing further to do */
    }
  }
}

/** Write a record as JSON with a final line end, atomically (F100-FR-036). */
export function atomicWriteJson(
  path: string,
  record: unknown,
  options: AtomicWriteOptions = {},
): void {
  atomicWrite(path, JSON.stringify(record, null, 2) + "\n", options);
}

/**
 * True for a name that `atomicWrite` produced as its temporary name: the
 * sweep of a directory skips them.
 */
export function isTemporaryName(name: string): boolean {
  return /^\..*\.tmp-\d+-\d+$/.test(basename(name));
}
