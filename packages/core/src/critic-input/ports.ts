// Feature 117 (T009) — the ports of the critic-input group.
//
// Every file-system, file-moving and process call the feature makes stands
// behind one of these ports (F100-FR-012: a core package imports no
// `node:fs`, no process module and no network module). This file is TYPES
// ONLY: it holds no implementation and imports nothing at all, so the
// import-boundary test `npm test -w @specstride/core -- critic-input/imports`
// can never see a forbidden module here. The shipped adapters live in the
// edge packages; the tests carry their own adapters.
//
// The file-reading port serves the grounding snapshot (F117-FR-007 to
// F117-FR-014), the file-moving port serves the hiding and return of the
// proposer's notebook, handoff and outbox (F117-FR-039 to F117-FR-042), and
// the process port serves the single as-is probe — the check of the
// version-control tool whether a path is ignored, with a fixed argument list
// (F117-FR-017). The grounding pass starts no other process.

/** The stat of one path, as the file-reading port gives it. */
export interface PortStat {
  /** True for a regular file. */
  readonly isFile: boolean;
  /** True for a directory. */
  readonly isDirectory: boolean;
  /** Size in bytes. */
  readonly size: number;
  /** Modification time in milliseconds since the epoch, as the file system gives it (F117-FR-020: never coarsened). */
  readonly mtimeMs: number;
  /**
   * The permission bits, where the adapter can give them. The hiding of
   * F117-FR-040 carries the mode through a move and back; an adapter that
   * cannot see it leaves the field out and the caller falls back to the
   * platform default.
   */
  readonly mode?: number;
}

/**
 * The file-reading port of the grounding pass (F117-FR-017, F117-FR-018).
 * Read-only: nothing here creates, writes or removes.
 */
export interface FileReadingPort {
  /**
   * The stat of a path, or `undefined` when it does not exist. With
   * `noFollow` the call stats the link itself and never the file it points
   * to: a claim about a cited path is made about the path AS CITED
   * (F117-FR-018 tests the real path separately, through `realpath`).
   */
  stat(path: string, options?: { readonly noFollow?: boolean }): PortStat | undefined;
  /**
   * A bounded read: at most `limit` bytes from `offset` (0-based) of the
   * file, or `undefined` when the file cannot be read. No read exceeds the
   * limit the caller gives.
   */
  read(path: string, offset: number, limit: number): Uint8Array | undefined;
  /** The real path of an existing path, links resolved, or `undefined`. */
  realpath(path: string): string | undefined;
  /** Sorted names of a directory, or `undefined` when it is not a readable directory. */
  listDirectory(path: string): readonly string[] | undefined;
  /**
   * The paths matching one glob `pattern`, searched BELOW `root` only, in
   * sorted order. The pattern never escapes the root.
   */
  matchBelow(root: string, pattern: string): readonly string[];
}

/** The bytes, the mode and the modification time a move has to carry. */
export interface MovedFile {
  /** The full content of the file. */
  readonly bytes: Uint8Array;
  /** The permission bits, as the file had them. */
  readonly mode: number;
  /** The modification time in milliseconds since the epoch, kept exactly (F117-FR-020). */
  readonly mtimeMs: number;
}

/**
 * The file-moving port of the hiding and return of the proposer's files
 * (F117-FR-039 to F117-FR-042; research D-10: the record is written BEFORE
 * the move, and recovery reads the record — the port only moves).
 */
export interface FileMovingPort {
  /**
   * Move a file from `from` to `to`, carrying its bytes, its mode and its
   * modification time exactly. The caller records the move before the call.
   */
  moveFile(from: string, to: string, file: MovedFile): void;
  /** Set a file aside under the control plane: move it out of the worker's reach. */
  setAside(from: string, asideRoot: string): void;
  /** True when the path exists (links followed). */
  exists(path: string): boolean;
  /** The names under the worker root of the run, or an empty list when there is none. */
  listWorkerRoot(): readonly string[];
}

/** The result of one probe run through the process port. */
export interface ProbeResult {
  /** The exit code of the probe, or a non-zero sentinel when it was killed. */
  readonly code: number;
  /** Standard output, bounded by the caller's budget. */
  readonly stdout: string;
  /** Standard error, bounded by the caller's budget. */
  readonly stderr: string;
  /** True when the probe ran past its time limit and was killed (F117-FR-017: 10 seconds). */
  readonly timedOut: boolean;
}

/**
 * The process port (F117-FR-017). The grounding pass starts exactly ONE
 * kind of process: the check of the version-control tool whether a path is
 * ignored, with a FIXED argument list. `probe` takes that fixed argument
 * list and nothing else — there is no shell, no free-form command, no
 * second process kind.
 */
export interface ProcessPort {
  /**
   * Run the one fixed-argument ignore probe: `argv` is
   * `[tool, fixedSubcommand..., path]` as F117-FR-017 fixes it. The probe
   * has a time limit of 10 seconds and falls back to an exact match of the
   * base name in the ignore file when it cannot run.
   */
  probe(argv: readonly [string, ...string[]]): ProbeResult;
}
