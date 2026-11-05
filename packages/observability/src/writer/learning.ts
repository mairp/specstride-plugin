/**
 * T016 — the learning writer domain (F111-FR-022).
 *
 * *Learning MUST have its own writer domain, its own `seq` and its own event
 * file, `feature:<slug>:learning:events`, written by the learning feature
 * under the same envelope and the same ingress. The projection MUST read that
 * file as its own writer class.*
 *
 * A DOMAIN here is three things that are separate and two that are not:
 *
 *   - separate FILE — `feature:<slug>:learning:events`, not
 *     `run:<runId>:events`. Learning outlives one run: its records are read
 *     across runs, so they do not belong in a stream a run owns;
 *   - separate `seq` — the number is a position in ITS stream and counts from
 *     1 whatever the run stream has reached, because the two folds are
 *     different folds;
 *   - separate LOCK — therefore one writer PER DOMAIN, not one writer in
 *     total. The learning feature writes while the engine writes, and neither
 *     waits for the other; a SECOND writer of the learning file is still
 *     refused, because the domain has one writer too;
 *   - the SAME envelope and the SAME ingress — nothing of feature 100's
 *     envelope and nothing of the validation of T006 is relaxed here. The one
 *     schema stays one schema; only the file and the counter are the domain's
 *     own.
 *
 * The class composes `BestEffortEmitter` (T012) rather than re-implementing
 * it, so the lock, the `seq`, the ordering primary-before-sinks and the three
 * drop reasons are the same code in both domains and cannot drift apart.
 */
import { CATALOGUE } from "../catalogue/index.ts";
import { BestEffortEmitter, type EmitOutcome } from "./besteffort.ts";
import { EVENTS_LOGICAL_NAME } from "./check.ts";
import { DROP_REASON_INVALID, type DropCount } from "./validate.ts";
import {
  appendLockPathOf,
  type EventSink,
  type WriteRequest,
  type WrittenEvent,
} from "./writer.ts";

/** The logical name of the learning stream of a feature (annex B). */
export const LEARNING_LOGICAL_NAME = "feature:<slug>:learning:events" as const;

/** The logical name of the learning stream of one feature. */
export function learningEventsLogicalNameOf(slug: string): string {
  return LEARNING_LOGICAL_NAME.replace("<slug>", slug);
}

/** The writer class a projection reads the run's own stream as. */
export const MAIN_WRITER_CLASS = "run" as const;

/** The writer class a projection reads the learning file as (F111-FR-022). */
export const LEARNING_WRITER_CLASS = "learning" as const;

/** The writer classes of the product, in the order a projection reads them. */
export const WRITER_CLASSES = [MAIN_WRITER_CLASS, LEARNING_WRITER_CLASS] as const;
export type WriterClass = (typeof WRITER_CLASSES)[number];

/** The logical name each writer class reads. */
export const LOGICAL_NAME_OF_WRITER_CLASS: Readonly<Record<WriterClass, string>> = Object.freeze({
  [MAIN_WRITER_CLASS]: EVENTS_LOGICAL_NAME,
  [LEARNING_WRITER_CLASS]: LEARNING_LOGICAL_NAME,
});

/** Every type of the learning domain starts with this. */
export const LEARNING_TYPE_PREFIX = "learning." as const;

/** The types of the learning domain, READ from the catalogue and not listed here. */
export const LEARNING_TYPES: readonly string[] = Object.freeze(
  CATALOGUE.filter((entry) => entry.type.startsWith(LEARNING_TYPE_PREFIX)).map(
    (entry) => entry.type,
  ),
);

/** True where the type belongs to the learning domain. */
export function isLearningType(type: string): boolean {
  return type.startsWith(LEARNING_TYPE_PREFIX);
}

export type LearningWriterOptions = {
  readonly file: string;
  /** The feature whose learning stream this is: the `<slug>` of the name. */
  readonly slug: string;
  readonly runId: string;
  readonly launchId: string;
  readonly holder?: string;
  readonly now?: () => Date;
  readonly maxEventBytes?: number;
  /**
   * Refuse a type that is not of the learning domain. Off by default, because
   * the domain also writes `event.dropped` into its own stream.
   */
  readonly domainOnly?: boolean;
};

/**
 * The writer of the learning stream of one feature (F111-FR-022). It is the
 * same writer as the run's, pointed at the domain's own file, holding the
 * domain's own lock and keeping the domain's own count.
 */
export class LearningWriter {
  readonly #emitter: BestEffortEmitter;
  readonly #slug: string;
  readonly #file: string;
  readonly #domainOnly: boolean;

  private constructor(options: LearningWriterOptions, emitter: BestEffortEmitter) {
    this.#slug = options.slug;
    this.#file = options.file;
    this.#domainOnly = options.domainOnly ?? false;
    this.#emitter = emitter;
  }

  /**
   * Open the writer of a feature's learning stream, or throw `AppendLockHeld`
   * where another writer of THAT domain holds its lock.
   */
  static open(options: LearningWriterOptions): LearningWriter {
    const emitter = BestEffortEmitter.open({
      destination: options.file,
      runId: options.runId,
      launchId: options.launchId,
      holder: options.holder ?? `learning-${options.slug}`,
      now: options.now,
      maxEventBytes: options.maxEventBytes,
      strict: true,
    });
    return new LearningWriter(options, emitter);
  }

  get slug(): string {
    return this.#slug;
  }

  get file(): string {
    return this.#file;
  }

  /** The logical name of this stream. */
  get logicalName(): string {
    return learningEventsLogicalNameOf(this.#slug);
  }

  /** The writer class a projection reads this file as. */
  get writerClass(): WriterClass {
    return LEARNING_WRITER_CLASS;
  }

  /** The domain's OWN lock, beside the domain's own file. */
  get lockPath(): string {
    return appendLockPathOf(this.#file);
  }

  /** The domain's OWN count. */
  get nextSeq(): number {
    return this.#emitter.nextSeq;
  }

  addSink(sink: EventSink): void {
    this.#emitter.addSink(sink);
  }

  /** Append through the domain's writer, without the best-effort gates. */
  append(request: WriteRequest): WrittenEvent {
    const writer = this.#emitter.writer;
    if (writer === null) throw new Error(`the learning stream ${this.#file} is not open`);
    return writer.append(request);
  }

  /** What the domain's ledger owes: one entry per reason, not yet reported. */
  pending(): readonly DropCount[] {
    return this.#emitter.pending();
  }

  /** Emit one learning event, best effort and through the same gate (T006). */
  emit(request: WriteRequest): EmitOutcome {
    if (this.#domainOnly && !isLearningType(request.type)) {
      this.#emitter.countDrop(DROP_REASON_INVALID);
      return Object.freeze({
        written: false as const,
        reason: DROP_REASON_INVALID,
        seqUsed: false as const,
        sinksCalled: 0 as const,
        detail: `${request.type} is no type of the learning domain`,
      });
    }
    return this.#emitter.emit(request);
  }

  close(): void {
    this.#emitter.close();
  }
}
