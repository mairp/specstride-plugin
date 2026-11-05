// Feature 117 (T076) — the hiding, the return and the recovery of the
// proposer's notebook, handoff and outbox (F117-FR-040).
//
// Before a critic-class call of the form `read-only-tools` starts, the three
// files move out of the working tree into the control plane, under the
// logical name `attempt:<N>:<k>:<n>:hidden-files` (annex B §B.5). The record
// `specstride.hidden-files/1` (annex B §B.20, schema
// `contracts/schemas/hidden-files.schema.json`) is written with the ATOMIC
// WRITE OF THE KERNEL BEFORE THE FIRST FILE IS MOVED (research D-10: a kill
// between the move and the record must not lose a file), and again with the
// state `hidden` after the moves and `returned` after the files are back.
//
// EVERY file-system answer goes through the ports of `../ports.ts`: the
// reads through the `FileReadingPort`, the moves through the
// `FileMovingPort`. This module imports NO `node:fs` — the import-boundary
// test of `critic-input/imports` holds it — and the file-system adapters
// live in the edge packages, handed in at the composition root (T093, T094;
// no file of a core package names them, F100-FR-012).
//
// An engine start that finds the record in the state `planned` or `hidden`
// returns the files from the record BEFORE anything else happens in the
// workspace (`recoverHiddenFiles`). A file found at the place of a hidden
// file at its return never wins: the kept file is moved back, the found file
// is set aside in the control plane, and the integrity kind
// `tree-changed-outside-pass` is raised for the caller (F117-FR-040,
// ruling D1).
import { atomicWriteJson } from "@specstride/kernel/atomic-write";
import { contentHash } from "@specstride/kernel/hasher";
import type { FileMovingPort, FileReadingPort, MovedFile } from "../ports.ts";

/** The schema id of the hidden-files record (annex B §B.20). */
export const HIDDEN_FILES_SCHEMA = "specstride.hidden-files/1" as const;

/** The logical state name of the record and of the kept files (annex B §B.5). */
export function hiddenFilesStateKey(phase: number, call: number, index: number): string {
  return `attempt:${phase}:${call}:${index}:hidden-files`;
}

/**
 * The logical names of the three hidden files (annex B §B.5, as the schema
 * of the record holds them as patterns).
 */
export const HIDDEN_LOGICAL_NAMES = [
  "feature:<slug>:notebook",
  "feature:<slug>:handoff",
  "feature:<slug>:outbox",
] as const;
export type HiddenLogicalName = (typeof HIDDEN_LOGICAL_NAMES)[number];

/** The integrity kind raised when a file is found at the place of a hidden one. */
export const TREE_CHANGED_OUTSIDE_PASS = "tree-changed-outside-pass" as const;

/** The default mode of a moved file whose stat carries no mode. */
export const DEFAULT_FILE_MODE = 0o644 as const;

/** One of the three files the call hides, by logical name and place. */
export type HiddenFilePlan = {
  readonly logicalName: HiddenLogicalName;
  /** Where the file is in the working tree, relative to the workspace root. */
  readonly from: string;
};

/** One entry of the hidden-files record, per the schema of annex B §B.20. */
export type HiddenFileEntry = {
  readonly logicalName: HiddenLogicalName;
  readonly existed: boolean;
  readonly from?: string;
  readonly keptAt?: string;
  readonly bytes?: number;
  readonly hash?: string;
  readonly mode?: number;
  readonly mtime?: string;
  readonly setAside?: string;
};

/** The hidden-files record: `planned` → `hidden` → `returned` (data-model.md). */
export type HiddenFilesRecord = {
  readonly schema: typeof HIDDEN_FILES_SCHEMA;
  readonly attemptId: string;
  readonly callId: string;
  readonly state: "planned" | "hidden" | "returned";
  readonly files: readonly HiddenFileEntry[];
  /** The kinds raised at the return; present only where one was raised. */
  readonly integrityKinds?: readonly string[];
};

/** What `hideFiles` and `returnFiles` are given. */
export type HideInput = {
  /** The absolute root of the working tree. */
  readonly workspaceRoot: string;
  /** The absolute root of the control plane, where the record and the kept files live. */
  readonly controlRoot: string;
  /** The absolute directory the hidden files are kept in, under the record's logical name. */
  readonly keptDirectory: string;
  /** The absolute path of the record, under its logical name. */
  readonly recordPath: string;
  /** The phase attempt of the call. */
  readonly attemptId: string;
  /** The critic-class call. */
  readonly callId: string;
  /** The three files, by logical name and place. */
  readonly files: readonly HiddenFilePlan[];
  readonly reader: FileReadingPort;
  readonly mover: FileMovingPort;
};

/** What `returnFiles` adds to `HideInput`. */
export type ReturnInput = HideInput & {
  /** Where a file found at the place is set aside (inside the control plane). */
  readonly asideRoot: string;
};

/** A move joined with the bytes it carries, as the port wants them. */
type PlannedMove = {
  readonly entry: HiddenFileEntry;
  readonly fromAbsolute: string;
  readonly toAbsolute: string;
  readonly move: MovedFile;
};

function join(root: string, relative: string): string {
  return root.endsWith("/") ? root + relative : `${root}/${relative}`;
}

/** The mtime of the record, as the schema holds it: an ISO string. */
function mtimeIso(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

/**
 * Read one of the three files through the file-reading port: the whole
 * content, its mode and its modification time, exactly as they are.
 */
function planMove(
  input: HideInput,
  plan: HiddenFilePlan,
): PlannedMove | { readonly entry: HiddenFileEntry } {
  const fromAbsolute = join(input.workspaceRoot, plan.from);
  const stat = input.reader.stat(fromAbsolute);
  const existed = stat !== undefined && stat.isFile;
  if (!existed || stat === undefined) {
    return { entry: { logicalName: plan.logicalName, existed: false, from: plan.from } };
  }
  const bytes = input.reader.read(fromAbsolute, 0, stat.size);
  if (bytes === undefined) {
    return { entry: { logicalName: plan.logicalName, existed: false } };
  }
  const mode = stat.mode ?? DEFAULT_FILE_MODE;
  // keptAt is relative to the location of the record's logical name (the
  // schema of annex B §B.20): the kept directory the caller named.
  const keptAt = basename(plan.from);
  return {
    entry: {
      logicalName: plan.logicalName,
      existed: true,
      from: plan.from,
      keptAt,
      bytes: stat.size,
      hash: contentHash(Buffer.from(bytes).toString("latin1")),
      mode,
      mtime: mtimeIso(stat.mtimeMs),
    },
    fromAbsolute,
    toAbsolute: join(input.keptDirectory, basename(plan.from)),
    move: { bytes, mode, mtimeMs: stat.mtimeMs },
  };
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Hide the three files for one call (F117-FR-040): the record is written in
 * the state `planned` BEFORE the first move, then the files move, then the
 * record is written again in the state `hidden`. A file that did not exist
 * is recorded with `existed: false` and is never moved.
 */
export function hideFiles(input: HideInput): HiddenFilesRecord {
  const planned = input.files.map((plan) => planMove(input, plan));
  const record: HiddenFilesRecord = {
    schema: HIDDEN_FILES_SCHEMA,
    attemptId: input.attemptId,
    callId: input.callId,
    state: "planned",
    files: planned.map((p) => p.entry),
  };
  // BEFORE the first move (F117-FR-040; research D-10): the atomic write of
  // the kernel, so no reader — and no recovery — ever sees a partial record.
  atomicWriteJson(input.recordPath, record, { createDirectory: true });
  for (const move of planned) {
    if (!("move" in move)) continue;
    input.mover.moveFile(move.fromAbsolute, move.toAbsolute, move.move);
  }
  const hidden: HiddenFilesRecord = { ...record, state: "hidden" };
  atomicWriteJson(input.recordPath, hidden, { createDirectory: true });
  return hidden;
}

/**
 * Return the hidden files after the call, however it ended (F117-FR-040):
 * the same bytes, the same mode, the same modification time. A file that did
 * not exist before the call must not exist after it; a file found at the
 * place of a hidden one is set aside in the control plane, the kept file
 * wins, and the kind `tree-changed-outside-pass` is raised.
 */
export function returnFiles(input: ReturnInput): HiddenFilesRecord {
  const record = readHiddenFilesRecord(input.recordPath, input.reader);
  if (record === undefined) {
    throw new Error(`returnFiles: no hidden-files record at ${input.recordPath}`);
  }
  return returnRecordedFiles(input, record);
}

/**
 * The return itself, from a record the caller has already read (the recovery
 * path reads the record it found on disk).
 */
export function returnRecordedFiles(
  input: ReturnInput,
  record: HiddenFilesRecord,
): HiddenFilesRecord {
  const kinds: string[] = [];
  const files: HiddenFileEntry[] = record.files.map((entry) => {
    if (!entry.existed || entry.from === undefined) {
      // A file that did not exist before the call must not exist after it:
      // whatever stands at the place now came from outside and is set aside.
      if (entry.from !== undefined) {
        const place = join(input.workspaceRoot, entry.from);
        if (input.mover.exists(place)) {
          const aside = setFoundAside(input, place, entry.logicalName);
          kinds.push(TREE_CHANGED_OUTSIDE_PASS);
          return { ...entry, setAside: aside };
        }
      }
      return entry;
    }
    const place = join(input.workspaceRoot, entry.from);
    if (input.mover.exists(place)) {
      // The kept file wins (ruling D1): the found file is set aside FIRST,
      // then the kept file is moved back to the place.
      const aside = setFoundAside(input, place, entry.logicalName);
      kinds.push(TREE_CHANGED_OUTSIDE_PASS);
      moveKeptBack(input, entry, place);
      return { ...entry, setAside: aside };
    }
    moveKeptBack(input, entry, place);
    return entry;
  });
  const returned: HiddenFilesRecord = {
    ...record,
    state: "returned",
    files,
    ...(kinds.length > 0 ? { integrityKinds: kinds } : {}),
  };
  atomicWriteJson(input.recordPath, returned, { createDirectory: true });
  return returned;
}

function setFoundAside(
  input: ReturnInput,
  foundAbsolute: string,
  logicalName: HiddenLogicalName,
): string {
  const asideRelative = `${input.callId}/set-aside/${sanitize(logicalName)}/${basename(foundAbsolute)}`;
  input.mover.setAside(foundAbsolute, join(input.asideRoot, dirnameRelative(asideRelative)));
  return asideRelative;
}

function moveKeptBack(input: ReturnInput, entry: HiddenFileEntry, place: string): void {
  const keptAbsolute = join(input.keptDirectory, entry.keptAt ?? "");
  const stat = input.reader.stat(keptAbsolute);
  const bytes = input.reader.read(keptAbsolute, 0, stat?.size ?? 0);
  if (stat === undefined || bytes === undefined) {
    throw new Error(
      `returnFiles: the kept file of ${entry.logicalName} is gone from the control plane`,
    );
  }
  input.mover.moveFile(keptAbsolute, place, {
    bytes,
    mode: stat.mode ?? entry.mode ?? DEFAULT_FILE_MODE,
    mtimeMs: stat.mtimeMs,
  });
}

function dirnameRelative(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function sanitize(logicalName: string): string {
  return logicalName.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Read a hidden-files record from disk through the file-reading port, or
 * `undefined` where there is none or where it is not of this schema's major.
 */
export function readHiddenFilesRecord(
  recordPath: string,
  reader: FileReadingPort,
): HiddenFilesRecord | undefined {
  const stat = reader.stat(recordPath);
  if (stat === undefined || !stat.isFile) return undefined;
  const bytes = reader.read(recordPath, 0, stat.size);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  const candidate = parsed as HiddenFilesRecord;
  if (candidate.schema !== HIDDEN_FILES_SCHEMA) return undefined;
  if (
    candidate.state !== "planned" &&
    candidate.state !== "hidden" &&
    candidate.state !== "returned"
  ) {
    return undefined;
  }
  return candidate;
}

/**
 * Recovery at engine start (F117-FR-040): where the engine ended while the
 * files were hidden, the next engine start returns them from the record
 * BEFORE it does anything else in the workspace. A record in the state
 * `returned` needs nothing.
 */
export function recoverHiddenFiles(input: ReturnInput): {
  recovered: boolean;
  record: HiddenFilesRecord | undefined;
} {
  const record = readHiddenFilesRecord(input.recordPath, input.reader);
  if (record === undefined || record.state === "returned") {
    return { recovered: false, record };
  }
  return { recovered: true, record: returnRecordedFiles(input, record) };
}
