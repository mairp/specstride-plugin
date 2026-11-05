/**
 * T006 of feature 101 — the port through which the extracted gate store
 * reaches the tree (F100-FR-012, F100-FR-234, F101-FR-028).
 *
 * `@specstride/core` may not import `node:fs` or `node:fs/promises`
 * (`packages/contracts/data/package-graph.json`, row `@specstride/core`). The
 * gate store of Lisa calls eight file-system operations; they are named here,
 * one for one, so that the extraction keeps the baseline's bodies and only the
 * RECEIVER of each call moves outside the core. The composition root implements
 * the port over `@specstride/kernel`: `write` is the atomic write of the kernel
 * (temporary name in the same directory, fsync, rename), which is the same
 * three steps the baseline wrote by hand.
 */
import { STEPS } from "@specstride/kernel/atomic-write";

/** The three steps of the atomic write every `write` of the port carries out. */
export const atomicWriteSteps = STEPS;

/**
 * The eight operations the extracted store calls, with the baseline's function
 * beside each. The implementation lives outside the core.
 */
export const OPERATIONS = Object.freeze({
  join: "node:path join",
  makeDirectory: "mkdirSync(..., { recursive: true })",
  write: "openSync/writeSync/fsyncSync/closeSync/renameSync — the atomic write",
  read: "readFileSync(..., 'utf8')",
  exists: "existsSync",
  move: "renameSync",
  copy: "copyFileSync",
  list: "readdirSync",
  modifiedAtMs: "statSync(...).mtimeMs",
});

/** The tree the gate store writes in, as the core sees it. */
export type GateTree = {
  /** Join path segments, as `node:path` does. */
  join(...segments: readonly string[]): string;
  /** Create a directory and every parent of it; idempotent. */
  makeDirectory(path: string): void;
  /**
   * Write a file through the atomic write of the kernel: a temporary name in
   * the SAME directory, fsync, rename. No reader sees a part of the file
   * (F101-FR-028, F100-FR-036).
   */
  write(path: string, content: string): void;
  /** Read a file the runtime wrote, as UTF-8. */
  read(path: string): string;
  /** True when the path exists. */
  exists(path: string): boolean;
  /** Move a file; within one directory this is the rename of the atomic write. */
  move(from: string, to: string): void;
  /** Copy a file. */
  copy(from: string, to: string): void;
  /** The names of the entries of a directory; throws when it does not exist. */
  list(directory: string): readonly string[];
  /** The modification time of a file, in milliseconds. */
  modifiedAtMs(path: string): number;
};
