/**
 * T041 — the reading of a checkpoint as a claim (F115-FR-009, F115-FR-010,
 * IR-55), the implementation of the port `CheckpointClaimReader` of
 * `packages/contracts/src/ports/layer-micro.ts` (T003).
 *
 * A checkpoint is a claim, never a verdict. The runtime reads it only after
 * the pass has exited, as a regular file inside the outbox, opened without
 * following links and without blocking, newer than the start of the pass,
 * not larger than 16 kilobytes, and unchanged between two reads. Of the
 * note at most 512 bytes are kept. Every other field of the file is
 * ignored: only the ids and the bounded note reach the layer. A checkpoint
 * that was read is moved into the control plane under the logical name
 * `unit:<unitId>:checkpoint`, with the atomic write of `@specstride/kernel`
 * (F100-FR-234) for the copy and a removal for the outbox file. A
 * checkpoint that is present when a pass starts is removed with an event of
 * the type `checkpoint.removed`.
 *
 * A refused read never throws: it carries exactly one reason of the closed
 * set of the refusal reasons of a checkpoint (annex X §X.6 row 138). The
 * reasons of the pass itself — `pass-killed`, `foreign-id`,
 * `yield-in-pass` — are facts the runtime holds, so this reader refuses
 * only with `not-regular`, `stale`, `too-large`, `changed-while-read` and
 * `empty`.
 *
 * Edge package: this module may import `node:fs`; the layer itself never
 * does (F100-FR-012; research.md D-1).
 */
import {
  openSync,
  readSync,
  closeSync,
  lstatSync,
  unlinkSync,
  mkdirSync,
  constants as fsConstants,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "@specstride/kernel";
import {
  CHECKPOINT_SCHEMA_ID,
  type CheckpointClaim,
  type CheckpointClaimReader,
  type CheckpointClaimResult,
  type CheckpointRefusal,
} from "@specstride/contracts";

/** The schema id of a checkpoint (feature 100, annex B §B.20; owner 115). */
const SCHEMA_ID: string = CHECKPOINT_SCHEMA_ID;

/** The file is at most 16 kilobytes (F115-FR-010). */
export const CHECKPOINT_MAX_BYTES = 16 * 1024;

/** At most 512 bytes of the note are kept (F115-FR-009, F115-FR-010). */
export const NOTE_MAX_BYTES = 512;

/** The event type of the removal of a stale checkpoint (F115-FR-010). */
export const CHECKPOINT_REMOVED_EVENT = "checkpoint.removed" as const;

/** The logical name of a checkpoint in the control plane (F115-FR-010). */
export function logicalCheckpointName(unitId: string): string {
  return `unit:${unitId}:checkpoint`;
}

/** The path of the checkpoint file of a unit inside the outbox. */
export function checkpointPath(outboxPath: string, unitId: string): string {
  return join(outboxPath, `${unitId}.checkpoint.json`);
}

/** Cut a note to at most 512 bytes without splitting a code point. */
export function boundedNote(note: string): string {
  if (Buffer.byteLength(note, "utf8") <= NOTE_MAX_BYTES) return note;
  let cut = note;
  while (cut.length > 0 && Buffer.byteLength(cut, "utf8") > NOTE_MAX_BYTES) {
    cut = cut.slice(0, -1);
  }
  return cut;
}

/** One removal of a stale checkpoint, as an event of the type of F115-FR-010. */
export type CheckpointRemovedEvent = {
  readonly type: typeof CHECKPOINT_REMOVED_EVENT;
  readonly unitId: string;
  readonly path: string;
};

/**
 * F115-FR-010 — a checkpoint that is present when a pass starts is removed
 * with an event of the type `checkpoint.removed`. Returns the event when a
 * file was removed, and `undefined` when the outbox held no checkpoint.
 */
export function removeStaleCheckpoint(
  outboxPath: string,
  unitId: string,
): CheckpointRemovedEvent | undefined {
  const path = checkpointPath(outboxPath, unitId);
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    return undefined;
  }
  if (!stats.isFile()) {
    // Not a regular file: a link or a directory is unlinked the same way,
    // never followed.
    unlinkSync(path);
    return { type: CHECKPOINT_REMOVED_EVENT, unitId, path };
  }
  unlinkSync(path);
  return { type: CHECKPOINT_REMOVED_EVENT, unitId, path };
}

/** The services of the reading: where the files are and when the pass began. */
export type CheckpointReaderOptions = {
  /** The outbox directory of the proposer, `feature:<slug>:outbox`. */
  readonly outboxPath: string;
  /** The directory of the control plane the read checkpoints move into. */
  readonly controlPlanePath: string;
  /** The start of the pass, in milliseconds; the file must be newer. */
  readonly passStartedAtMs: number;
  /** Create the control plane directory when it is missing (default true). */
  readonly createControlPlane?: boolean;
  /**
   * The reader of the bytes of one pass over the descriptor. It defaults to
   * `readAll`; the two reads of F115-FR-010 go through it, and the test of
   * the `changed-while-read` refusal replaces it with a reader whose two
   * reads differ. Nothing else may set it.
   */
  readonly readBytes?: (fd: number, limit: number) => Buffer;
};

/**
 * Read the checkpoint file of a unit and hand it over as a claim
 * (F115-FR-010). Refuses, without throwing, with exactly one reason of the
 * closed set of the refusal reasons of a checkpoint.
 */
export function readClaimSync(
  options: CheckpointReaderOptions,
  unitId: string,
): CheckpointClaimResult {
  const path = checkpointPath(options.outboxPath, unitId);

  // Opened without following links (O_NOFOLLOW) and without blocking
  // (O_NONBLOCK); the lstat before it never follows either.
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    // No checkpoint: absence is not a refusal of the closed set.
    return { ok: false, absent: true };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return refused(path, "not-regular");
  }
  if (stats.size > CHECKPOINT_MAX_BYTES) return refused(path, "too-large");
  if (stats.mtimeMs <= options.passStartedAtMs) return refused(path, "stale");

  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch {
    return refused(path, "not-regular");
  }
  const readBytes = options.readBytes ?? readAll;
  try {
    const first = readBytes(fd, CHECKPOINT_MAX_BYTES);
    const second = readBytes(fd, CHECKPOINT_MAX_BYTES);
    if (Buffer.compare(first, second) !== 0) return refused(path, "changed-while-read");
    // The file must still be a regular file after the reads.
    const after = lstatSync(path);
    if (!after.isFile()) return refused(path, "not-regular");

    const claim = parseClaim(first);
    if (claim === undefined) return refused(path, "empty");

    // Move the checkpoint into the control plane under its logical name:
    // the copy goes through the atomic write of the kernel (F100-FR-234),
    // so a crash leaves either the old state or the new one, never a half
    // record; then the outbox file is removed.
    if (options.createControlPlane !== false) {
      mkdirSync(options.controlPlanePath, { recursive: true });
    }
    atomicWrite(join(options.controlPlanePath, logicalCheckpointName(unitId)), first);
    unlinkSync(path);
    return { ok: true, claim };
  } catch {
    return refused(path, "changed-while-read");
  } finally {
    closeSync(fd);
  }
}

/** A refusal with the path the read was attempted on. */
function refused(path: string, reason: CheckpointRefusal["reason"]): CheckpointClaimResult {
  return { ok: false, refusal: { reason, path } };
}

/** Read the whole file from the descriptor, up to the size limit. */
function readAll(fd: number, limit: number): Buffer {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(4096);
  let total = 0;
  // Each read pass starts at the beginning of the file, so the two reads of
  // F115-FR-010 see the same range of the file.
  let position = 0;
  for (;;) {
    const read = readSync(fd, buffer, 0, buffer.length, position);
    position += read;
    if (read === 0) break;
    total += read;
    if (total > limit) {
      // Larger than the limit: stop reading; the size check has the lstat,
      // and a file that grew past the limit while being read is refused.
      chunks.push(buffer.subarray(0, read));
      return Buffer.concat(chunks);
    }
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }
  return Buffer.concat(chunks);
}

/**
 * The claim from the bytes: the ids and the bounded note, every other field
 * ignored (F115-FR-009). A file that is not JSON, carries a schema id other
 * than `specstride.checkpoint/1`, or holds no task id, holds no usable
 * declaration; the closed set has no schema reason, so it refuses as
 * `empty` — the checkpoint holds no id.
 */
function parseClaim(bytes: Buffer): CheckpointClaim | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.schema !== SCHEMA_ID) return undefined;
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) return undefined;
  const tasks: string[] = [];
  for (const id of record.tasks) {
    if (typeof id !== "string" || id.length === 0) return undefined;
    tasks.push(id);
  }
  const note = typeof record.note === "string" ? boundedNote(record.note) : undefined;
  return {
    schema: SCHEMA_ID,
    tasks,
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * The port implementation: the same reading behind the interface of T003,
 * so the composition root hands the layer an object of the port type.
 */
export function createCheckpointClaimReader(
  options: CheckpointReaderOptions,
): CheckpointClaimReader {
  return {
    async readClaim(unitId: string): Promise<CheckpointClaimResult> {
      return readClaimSync(options, unitId);
    },
  };
}
