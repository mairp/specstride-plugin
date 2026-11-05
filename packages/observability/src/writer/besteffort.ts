/**
 * T012 — best effort and `event.dropped` (F111-FR-019).
 *
 * *Emission MUST be best effort. A failed write, a full disk or a missing file
 * MUST never fail or stall a run. The failed event is dropped, MUST NOT use a
 * `seq` and MUST reach no sink: a sink receives only events that are in the
 * primary file. The next event that is written MUST be preceded by
 * `event.dropped` with the count and the reason (`write-failed`, `invalid`,
 * `too-large`). An empty destination MUST switch emission off without an
 * error.*
 *
 * The as-is behaviour this translates is B-0352 (cluster C-020): *events are
 * appended to the file named by `SPECSTRIDE_EVENTS`; a failed write is ignored
 * and nothing is written when the variable is empty*. Two recorded
 * divergences widen it: DV-006, the drop is counted and reported where the
 * baseline was silent; DV-115, a dropped event reaches no sink.
 *
 * The order of the gates, and why it is this order:
 *
 *   1. EMISSION OFF. An empty destination writes nothing and counts nothing —
 *      an event that was never meant to go anywhere is not a drop.
 *   2. `invalid` — the schema gate of T006, before any byte is formed.
 *   3. `too-large` — the encoded line is measured before it is appended, so an
 *      event that cannot fit never half-writes the file.
 *   4. `write-failed` — the append itself. Nothing below this line throws: the
 *      error is swallowed, counted, and the run goes on (Principle V).
 *
 * In every one of the three refusals the `seq` counter does not move and no
 * sink is called, because `seq` is given and the sinks are called inside
 * `PrimaryWriter.append`, which a refused event never reaches.
 *
 * `maxEventBytes`: no source of the product names a ceiling for one event
 * line, so the default here is 64 KiB, the size at which a single line stops
 * being readable by the tools that fold the stream. A caller that knows better
 * passes its own. Recorded as this feature's choice, not as a quoted limit.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import {
  PrimaryWriter,
  type EventSink,
  type PrimaryWriterOptions,
  type WriteRequest,
} from "./writer.ts";
import { continuationFor, encodeEventLine } from "./seq.ts";
import {
  DROPPED_EVENT_TYPE,
  DROP_REASON_INVALID,
  DropLedger,
  droppedEventOf,
  validateBeforeWrite,
  type DropCount,
} from "./validate.ts";

export { DROPPED_EVENT_TYPE, DROP_REASON_INVALID };
export type { DropCount };

/** The name B-0352 gives the destination of the stream. */
export const DESTINATION_VARIABLE = "SPECSTRIDE_EVENTS" as const;

/** The append of the line failed: a full disk, a missing file, a read-only tree. */
export const DROP_REASON_WRITE_FAILED = "write-failed" as const;

/** The encoded line did not fit the ceiling for one event. */
export const DROP_REASON_TOO_LARGE = "too-large" as const;

/** The three reasons F111-FR-019 names, in the order the gates apply. */
export const DROP_REASONS = [
  DROP_REASON_INVALID,
  DROP_REASON_TOO_LARGE,
  DROP_REASON_WRITE_FAILED,
] as const;

/** This feature's ceiling for one event line, in bytes. */
export const DEFAULT_MAX_EVENT_BYTES = 65_536;

/** True where the destination names no file: emission is off (B-0352). */
export function destinationIsEmpty(destination: string | null | undefined): boolean {
  return destination === null || destination === undefined || destination.trim().length === 0;
}

/** The destination the environment names, or null where it names none. */
export function destinationOfEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const named = environment[DESTINATION_VARIABLE];
  return destinationIsEmpty(named) ? null : (named as string);
}

/** What became of one emitted event. */
export type EmitOutcome =
  | { readonly written: true; readonly seq: number; readonly reported: readonly DropCount[] }
  | {
      readonly written: false;
      readonly reason: "emission-off" | (typeof DROP_REASONS)[number];
      /** F111-FR-019: a dropped event uses no `seq`. */
      readonly seqUsed: false;
      /** F111-FR-019 with DV-115: a dropped event reaches no sink. */
      readonly sinksCalled: 0;
      readonly detail?: string;
    };

export type BestEffortOptions = Omit<PrimaryWriterOptions, "file"> & {
  /** The file the events go to. Empty, blank or null switches emission off. */
  readonly destination: string | null | undefined;
  readonly maxEventBytes?: number;
  /** A ledger to share with another emitter; one of its own by default. */
  readonly ledger?: DropLedger;
  /**
   * Let a failure to take the writer at `open` through to the caller instead
   * of leaving emission lazily on. The learning domain (T016) uses it: a
   * second writer of that domain is a mistake to report, not a drop to count.
   */
  readonly strict?: boolean;
};

function refusal(
  reason: "emission-off" | (typeof DROP_REASONS)[number],
  detail?: string,
): EmitOutcome {
  return Object.freeze({
    written: false as const,
    reason,
    seqUsed: false as const,
    sinksCalled: 0 as const,
    detail,
  });
}

/**
 * The best-effort face of the primary writer (F111-FR-019). It owns the
 * destination, the ledger and the three refusals; the lock, the `seq` and the
 * ordering primary-before-sinks stay in `PrimaryWriter` (T008).
 *
 * Nothing on this class throws: `open` on a destination that cannot be opened
 * leaves emission off, and `emit` turns every error into a counted drop.
 */
export class BestEffortEmitter {
  readonly #file: string | null;
  readonly #maxEventBytes: number;
  readonly #ledger: DropLedger;
  readonly #sinks: EventSink[] = [];
  readonly #options: BestEffortOptions;
  #writer: PrimaryWriter | null = null;
  #closed = false;

  private constructor(options: BestEffortOptions, file: string | null) {
    this.#options = options;
    this.#file = file;
    this.#maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
    this.#ledger = options.ledger ?? new DropLedger();
  }

  /**
   * Open the emitter. An EMPTY destination switches emission off, which is the
   * one state in which nothing is counted. A destination that is NAMED but
   * cannot be reached right now — a missing tree, a full disk, a lock another
   * process holds — leaves emission ON: the writer is taken lazily at the first
   * event and retried at each one, so the drops are counted with
   * `write-failed` and reported the moment the destination answers again.
   * Neither path throws.
   */
  static open(options: BestEffortOptions): BestEffortEmitter {
    if (destinationIsEmpty(options.destination)) return new BestEffortEmitter(options, null);
    const emitter = new BestEffortEmitter(options, options.destination as string);
    if (options.strict === true) {
      emitter.#writer = PrimaryWriter.open({ ...options, file: options.destination as string });
      return emitter;
    }
    emitter.#takeTheWriter();
    return emitter;
  }

  /** The one writer of the stream, or null while it could not be taken. */
  get writer(): PrimaryWriter | null {
    return this.#writer;
  }

  /** Take the one writer of the run, or leave it for the next event. */
  #takeTheWriter(): PrimaryWriter | null {
    if (this.#closed || this.#file === null) return null;
    if (this.#writer !== null) return this.#writer;
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
    } catch {
      /* the append is what decides; a directory that cannot be made is a drop */
    }
    try {
      const writer = PrimaryWriter.open({ ...this.#options, file: this.#file });
      for (const sink of this.#sinks) writer.addSink(sink);
      this.#writer = writer;
      return writer;
    } catch {
      return null;
    }
  }

  /** True where a destination is named: emission is on, reachable or not. */
  get isOn(): boolean {
    return !this.#closed && this.#file !== null;
  }

  /** The destination, or null where emission is off. */
  get file(): string | null {
    return this.isOn ? this.#file : null;
  }

  /** The number the next event that IS written will carry. */
  get nextSeq(): number {
    if (this.#writer !== null) return this.#writer.nextSeq;
    if (this.#file === null) return 0;
    return continuationFor(this.#file).nextSeq;
  }

  /** What the ledger owes: one entry per reason, not yet reported. */
  pending(): readonly DropCount[] {
    return this.#ledger.pending();
  }

  /**
   * Count a drop this emitter did not itself refuse: a caller that puts a gate
   * of its own in front (the learning domain of T016) reports through the same
   * ledger, so every refusal reaches an `event.dropped`.
   */
  countDrop(reason: string): void {
    this.#ledger.count(reason);
  }

  addSink(sink: EventSink): void {
    this.#sinks.push(sink);
    this.#writer?.addSink(sink);
  }

  get sinks(): readonly EventSink[] {
    return Object.freeze([...this.#sinks]);
  }

  /** The bytes one event would take on the line, measured before the append. */
  #lineBytes(request: WriteRequest, seq: number): number {
    try {
      return Buffer.byteLength(
        encodeEventLine({ ...request, seq, data: request.data ?? {} }),
        "utf8",
      );
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  /** Append one request through the writer, counting a failure. Never throws. */
  #append(
    request: WriteRequest,
  ): { ok: true; event: EventEnvelope } | { ok: false; detail: string } {
    const writer = this.#takeTheWriter();
    if (writer === null) {
      return { ok: false, detail: `the destination ${this.#file ?? ""} cannot be opened` };
    }
    try {
      return { ok: true, event: writer.append(request).event };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }

  /**
   * Emit one event, best effort (F111-FR-019). Returns what became of it and
   * never throws.
   */
  emit(request: WriteRequest): EmitOutcome {
    // 1. An empty destination: nothing is written, nothing is counted (B-0352).
    if (!this.isOn) return refusal("emission-off");

    // 2. The schema gate of T006 (F111-FR-020).
    const verdict = validateBeforeWrite(request);
    if (!verdict.admitted) {
      this.#ledger.count(DROP_REASON_INVALID);
      return refusal(DROP_REASON_INVALID, verdict.findings[0]?.message);
    }

    // 3. The ceiling for one line, measured before any byte is appended.
    if (this.#lineBytes(request, this.nextSeq) > this.#maxEventBytes) {
      this.#ledger.count(DROP_REASON_TOO_LARGE);
      return refusal(
        DROP_REASON_TOO_LARGE,
        `the event does not fit the ceiling of ${this.#maxEventBytes} bytes for one line`,
      );
    }

    // 4. What the ledger owes goes FIRST, so the next event that is written is
    //    preceded by `event.dropped` with the count and the reason.
    const owed = this.#ledger.take();
    const reported: DropCount[] = [];
    const unreported: DropCount[] = [];
    for (const entry of owed) {
      const report = droppedEventOf(entry) as WriteRequest;
      const appended = this.#append(report);
      if (appended.ok) reported.push(entry);
      else unreported.push(entry);
    }

    // 5. The append of the event itself.
    const appended = this.#append(request);
    if (!appended.ok) {
      this.#ledger.count(DROP_REASON_WRITE_FAILED);
      // A report that could not be written is still owed.
      for (const entry of unreported) this.#ledger.restore(entry);
      return refusal(DROP_REASON_WRITE_FAILED, appended.detail);
    }
    for (const entry of unreported) this.#ledger.restore(entry);
    return Object.freeze({
      written: true as const,
      seq: appended.event.seq,
      reported: Object.freeze(reported),
    });
  }

  /** Give up the run's append lock. Emission is off afterwards. */
  close(): void {
    this.#writer?.close();
    this.#writer = null;
    this.#closed = true;
  }

  /** The options the emitter was opened with, for a relaunch on the same file. */
  get options(): BestEffortOptions {
    return this.#options;
  }
}
