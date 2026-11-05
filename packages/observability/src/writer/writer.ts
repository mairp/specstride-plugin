/**
 * T008 — the primary file writer (F111-FR-017).
 *
 * *The primary file writer MUST be part of the core and MUST NOT be
 * replaceable. At any moment exactly one process MUST write the event file of a
 * run, as in F100-FR-005. The writer MUST give `seq` at the append, under the
 * append lock of the run, and MUST write the event to the primary file before
 * it calls any sink.*
 *
 * Four things are mechanism here, not comment:
 *
 *   1. ONE WRITER PER RUN. The run's append lock is a file created with the
 *      exclusive flag `wx`, which the kernel grants to one caller only, so the
 *      guarantee holds across PROCESSES and not merely across objects. The lock
 *      names its holder and its pid; a lock whose pid is gone is a lock a crash
 *      left behind and is reclaimed, else a crash would silence the run for
 *      good (Principle V).
 *   2. `seq` AT THE APPEND, UNDER THE LOCK. The number is taken inside
 *      `#underTheLock`, between the check that the lock is still this writer's
 *      and the one append that writes the line. Nothing between the two can
 *      interleave a second number.
 *   3. THE PRIMARY FILE BEFORE ANY SINK. `appendFileSync` returns before the
 *      first `receive` is called. A sink that throws or hangs cannot unwrite
 *      the line, and its error is swallowed here: a sink never breaks the loop
 *      (Principle V, F111-SC-003).
 *   4. NOT REPLACEABLE. The writer is reached as this class. It takes no
 *      "writer" extension point and reads no registry; `EP-08` registers SINKS,
 *      which run after the primary file is written.
 *
 * The validation of the `data` is T006's (`validate.ts`) and the best-effort
 * behaviour of a failed write is T012's (`besteffort.ts`); both compose over
 * this class rather than inside it, so that the ordering above stays one place.
 *
 * The file calls live in this edge package of layer L1, never in a core package
 * (F100-FR-012, CQ-185).
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { MAJOR, SCHEMA } from "@specstride/contracts/envelope/event";
import { LINE_END, continuationFor, encodeEventLine } from "./seq.ts";

/** Principle V and F111-FR-017: the writer is core. */
export const THE_PRIMARY_WRITER_IS_PART_OF_THE_CORE = true as const;

/** F111-FR-017: there is no extension point that replaces the primary writer. */
export const THE_PRIMARY_WRITER_IS_REPLACEABLE = false as const;

/* ------------------------------------------------------------------ *
 * The append lock of the run (F100-FR-005).
 * ------------------------------------------------------------------ */

/** The lock of a file sits beside it under this suffix. */
export const LOCK_SUFFIX = ".lock" as const;

/** The append lock of an event file. */
export function appendLockPathOf(file: string): string {
  return `${file}${LOCK_SUFFIX}`;
}

/** What the lock file holds: who holds it, in which process, since when. */
export type AppendLockRecord = {
  readonly holder: string;
  readonly pid: number;
  readonly at: string;
};

/** Another writer holds the append lock of the run: this one does not write. */
export class AppendLockHeld extends Error {
  readonly lockPath: string;
  readonly heldBy: string | null;
  constructor(lockPath: string, heldBy: string | null) {
    super(
      `the append lock ${lockPath} is held by ${heldBy ?? "another writer"}; ` +
        `exactly one process writes the event file of a run (F111-FR-017, F100-FR-005)`,
    );
    this.name = "AppendLockHeld";
    this.lockPath = lockPath;
    this.heldBy = heldBy;
  }
}

/** A held append lock. */
export type AppendLock = {
  readonly path: string;
  readonly holder: string;
  readonly pid: number;
  /** True while this object still owns the lock file. */
  isHeld(): boolean;
  release(): void;
};

/** The record in a lock file, or null where there is none to read. */
export function readAppendLockRecord(lockPath: string): AppendLockRecord | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<AppendLockRecord>;
    if (typeof parsed.holder !== "string") return null;
    return Object.freeze({
      holder: parsed.holder,
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      at: typeof parsed.at === "string" ? parsed.at : "",
    });
  } catch {
    return null;
  }
}

/** Who holds the append lock, as the lock file says. */
export function readAppendLockHolder(lockPath: string): string | null {
  return readAppendLockRecord(lockPath)?.holder ?? null;
}

/** True where the process that took the lock is gone: a crash left it behind. */
export function lockIsStale(record: AppendLockRecord | null): boolean {
  if (record === null) return true;
  if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
  if (record.pid === process.pid) return false;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    // `ESRCH`: no such process. `EPERM`: it exists and is not ours.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function sleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockObject(path: string, holder: string): AppendLock {
  let held = true;
  return {
    path,
    holder,
    pid: process.pid,
    isHeld: () => held,
    release() {
      if (!held) return;
      held = false;
      try {
        rmSync(path, { force: true });
      } catch {
        /* a lock that cannot be removed is reclaimed by the next writer as stale */
      }
    },
  };
}

/**
 * Take the append lock, or return null where another LIVE process holds it. A
 * lock whose process is gone is reclaimed once.
 */
export function tryAcquireAppendLock(
  lockPath: string,
  holder: string,
  options: { readonly reclaimStale?: boolean } = {},
): AppendLock | null {
  const reclaimStale = options.reclaimStale ?? true;
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, JSON.stringify({ holder, pid: process.pid, at: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return lockObject(lockPath, holder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!reclaimStale || attempt === 1) return null;
      if (!lockIsStale(readAppendLockRecord(lockPath))) return null;
      try {
        rmSync(lockPath, { force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Take the append lock, waiting between attempts. Throws `AppendLockHeld`. */
export function acquireAppendLock(
  lockPath: string,
  holder: string,
  options: {
    readonly attempts?: number;
    readonly waitMs?: number;
    readonly reclaimStale?: boolean;
  } = {},
): AppendLock {
  const attempts = Math.max(1, options.attempts ?? 1);
  const waitMs = options.waitMs ?? 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lock = tryAcquireAppendLock(lockPath, holder, options);
    if (lock !== null) return lock;
    if (attempt + 1 < attempts) sleep(waitMs);
  }
  throw new AppendLockHeld(lockPath, readAppendLockHolder(lockPath));
}

/* ------------------------------------------------------------------ *
 * The sink side: what runs AFTER the primary file is written.
 * ------------------------------------------------------------------ */

/** A sink receives events after the writer has written them (the EP-08 shape). */
export type EventSink = {
  readonly id: string;
  receive(event: EventEnvelope, line: string): void;
};

/** What became of one sink call. A failure is recorded, never thrown. */
export type SinkOutcome = {
  readonly sink: string;
  readonly ok: boolean;
  readonly error?: string;
};

/** One written event: its number, its bytes and the sinks that were called. */
export type WrittenEvent = {
  readonly seq: number;
  readonly line: string;
  readonly event: EventEnvelope;
  readonly sinkOutcomes: readonly SinkOutcome[];
};

/** What the caller asks the writer to write: a type, its `data`, and envelope fields. */
export type WriteRequest = {
  readonly type: string;
  readonly data?: unknown;
} & Readonly<Record<string, unknown>>;

export type PrimaryWriterOptions = {
  readonly file: string;
  readonly lockPath?: string;
  readonly runId: string;
  readonly launchId: string;
  /** A name for the holder of the lock: the engine start, the supervisor, a test. */
  readonly holder?: string;
  readonly now?: () => Date;
  /** How long `open` waits for the lock of a run another writer still holds. */
  readonly attempts?: number;
  readonly waitMs?: number;
  /**
   * Called with the number the moment it is given, INSIDE the append lock and
   * before the bytes are on disk. The writer uses it for tracing; a test uses
   * it to probe the lock from outside (CT-111-117).
   */
  readonly onSeqGiven?: (seq: number, lock: AppendLock) => void;
};

/**
 * The one writer of the event file of a run (F111-FR-017). It holds the run's
 * append lock for its whole life, so "at any moment exactly one process writes
 * the event file" is the lock and not a convention.
 */
export class PrimaryWriter {
  readonly #file: string;
  readonly #lock: AppendLock;
  readonly #runId: string;
  readonly #launchId: string;
  readonly #now: () => Date;
  readonly #onSeqGiven: ((seq: number, lock: AppendLock) => void) | undefined;
  readonly #sinks: EventSink[] = [];
  #nextSeq: number;
  #beginOnANewLine: boolean;
  #open = true;

  private constructor(options: PrimaryWriterOptions, lock: AppendLock) {
    this.#file = options.file;
    this.#lock = lock;
    this.#runId = options.runId;
    this.#launchId = options.launchId;
    this.#now = options.now ?? (() => new Date());
    this.#onSeqGiven = options.onSeqGiven;
    // F111-FR-018: read the last complete line and continue after it, whatever
    // writer wrote it; a last line without a line end means a new line first.
    const continuation = continuationFor(options.file);
    this.#nextSeq = continuation.nextSeq;
    this.#beginOnANewLine = continuation.beginOnANewLine;
    mkdirSync(dirname(options.file), { recursive: true });
  }

  /** Open the one writer of the run, or throw `AppendLockHeld`. */
  static open(options: PrimaryWriterOptions): PrimaryWriter {
    const lockPath = options.lockPath ?? appendLockPathOf(options.file);
    const lock = acquireAppendLock(lockPath, options.holder ?? `pid-${process.pid}`, {
      attempts: options.attempts ?? 1,
      waitMs: options.waitMs ?? 0,
    });
    return new PrimaryWriter(options, lock);
  }

  /** Open the one writer of the run, or null where another process holds it. */
  static tryOpen(options: PrimaryWriterOptions): PrimaryWriter | null {
    const lockPath = options.lockPath ?? appendLockPathOf(options.file);
    const lock = tryAcquireAppendLock(lockPath, options.holder ?? `pid-${process.pid}`);
    if (lock === null) return null;
    return new PrimaryWriter(options, lock);
  }

  get file(): string {
    return this.#file;
  }

  get lockPath(): string {
    return this.#lock.path;
  }

  get holder(): string {
    return this.#lock.holder;
  }

  /** The number the next event will carry. */
  get nextSeq(): number {
    return this.#nextSeq;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  get sinks(): readonly EventSink[] {
    return Object.freeze([...this.#sinks]);
  }

  /** Register a sink. A sink is called only after the primary file is written. */
  addSink(sink: EventSink): void {
    this.#sinks.push(sink);
  }

  /** The envelope of one event, with the fields the caller supplied. */
  #envelope(request: WriteRequest, seq: number): EventEnvelope {
    const { type, data, ...rest } = request;
    return {
      schema: SCHEMA,
      v: MAJOR,
      seq,
      ts: this.#now().toISOString(),
      type,
      runId: this.#runId,
      launchId: this.#launchId,
      ...rest,
      data: (data ?? {}) as Record<string, unknown>,
    } as EventEnvelope;
  }

  /**
   * Give `seq` and append the one line, with the lock held throughout
   * (F111-FR-017). Returns the event and its bytes; it does NOT call a sink —
   * that is `append`, after this returns.
   */
  #underTheLock(request: WriteRequest): { event: EventEnvelope; line: string } {
    if (!this.#open) throw new Error("the writer is closed");
    if (!this.#lock.isHeld()) {
      throw new AppendLockHeld(this.#lock.path, readAppendLockHolder(this.#lock.path));
    }
    const seq = this.#nextSeq;
    this.#onSeqGiven?.(seq, this.#lock);
    const event = this.#envelope(request, seq);
    const line = encodeEventLine(event);
    // F111-FR-018: a torn last line is left where it is, and this event begins
    // on a new line of its own.
    const bytes = this.#beginOnANewLine ? `${LINE_END}${line}` : line;
    appendFileSync(this.#file, bytes);
    this.#beginOnANewLine = false;
    this.#nextSeq = seq + 1;
    return { event, line };
  }

  /**
   * Write one event: the number and the append under the lock, then every sink
   * (F111-FR-017). A sink that throws is recorded and does not break the loop.
   */
  append(request: WriteRequest): WrittenEvent {
    const { event, line } = this.#underTheLock(request);
    const sinkOutcomes: SinkOutcome[] = [];
    for (const sink of this.#sinks) {
      try {
        sink.receive(event, line);
        sinkOutcomes.push(Object.freeze({ sink: sink.id, ok: true }));
      } catch (error) {
        sinkOutcomes.push(Object.freeze({ sink: sink.id, ok: false, error: String(error) }));
      }
    }
    return Object.freeze({
      seq: event.seq,
      line,
      event,
      sinkOutcomes: Object.freeze(sinkOutcomes),
    });
  }

  /** Give up the run's append lock. */
  close(): void {
    this.#open = false;
    this.#lock.release();
  }

  /**
   * Stop writing WITHOUT releasing the lock: what a crash leaves behind. Used
   * by the tests of the crash path; the next writer reclaims the stale lock.
   */
  abandon(): void {
    this.#open = false;
  }
}

/** True where a lock file is lying beside the event file. */
export function appendLockExists(file: string): boolean {
  return existsSync(appendLockPathOf(file));
}
