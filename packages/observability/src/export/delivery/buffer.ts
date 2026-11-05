/**
 * T012 — the buffer of a sink and the flush interval (F128-FR-008,
 * F128-FR-010).
 *
 * F128-FR-008: *... `write` MUST only buffer, and the network request MUST be
 * made by the sink's own flush. ... The buffer of a sink MUST be bounded by
 * `telemetry.queueMaxEvents`; when it is full the newest events MUST be
 * dropped for that sink and the drop MUST be recorded with the reason
 * `queue_overflow`.*
 *
 * F128-FR-010: *... The flush interval MUST be `telemetry.flush.intervalMs`,
 * default 2000; the value 0 MUST flush at every event, one event to one
 * request, as the baseline shipped one event per process.*
 *
 * Dropping the NEWEST events when the buffer is full is the baseline's
 * discipline (the oldest events are the ones a consumer is already owed), and
 * every drop is recorded so the delivery record can carry it.
 */
import { DEFAULT_FLUSH_INTERVAL_MS } from "./request.ts";

/** The reason a full buffer records for a dropped event. */
export const QUEUE_OVERFLOW = "queue_overflow" as const;

/** The default bound of the buffer, from `telemetry.queueMaxEvents`. */
export const DEFAULT_QUEUE_MAX_EVENTS = 10000 as const;

/** The outcome of buffering one event. */
export type PushOutcome = {
  readonly buffered: boolean;
  /** Set only when the event was dropped. */
  readonly reason?: typeof QUEUE_OVERFLOW;
};

/** The drop records of a buffer: one per dropped event, in drop order. */
export type DropRecord = {
  readonly reason: typeof QUEUE_OVERFLOW;
  /** The `seq` of the event that was dropped, when the event carried one. */
  readonly seq: number | null;
  /** How many events were in the buffer when the drop happened. */
  readonly size: number;
};

/**
 * The bounded FIFO buffer of one sink. `write` only buffers; `take` hands the
 * whole batch to the flush. Every method is plain bookkeeping — nothing here
 * can throw into the caller (F128-FR-035).
 */
export class SinkBuffer<T> {
  private readonly items: T[] = [];
  private readonly maxEvents: number;
  private readonly drops: DropRecord[] = [];

  constructor(maxEvents: number = DEFAULT_QUEUE_MAX_EVENTS) {
    this.maxEvents =
      typeof maxEvents === "number" && Number.isFinite(maxEvents) && maxEvents > 0
        ? Math.trunc(maxEvents)
        : DEFAULT_QUEUE_MAX_EVENTS;
  }

  /** Buffer one event; when full, the NEWEST events are the ones dropped. */
  push(item: T, seq: number | null = null): PushOutcome {
    if (this.items.length >= this.maxEvents) {
      this.drops.push(Object.freeze({ reason: QUEUE_OVERFLOW, seq, size: this.items.length }));
      return Object.freeze({ buffered: false, reason: QUEUE_OVERFLOW });
    }
    this.items.push(item);
    return Object.freeze({ buffered: true });
  }

  /** How many events are buffered. */
  get size(): number {
    return this.items.length;
  }

  /** Whether nothing is buffered. */
  get empty(): boolean {
    return this.items.length === 0;
  }

  /** Take the whole batch out (the flush hands it to the request code). */
  take(): readonly T[] {
    const out = Object.freeze([...this.items]);
    this.items.length = 0;
    return out;
  }

  /** Every drop record since the last `takeDrops` (for the delivery record). */
  takeDrops(): readonly DropRecord[] {
    const out = Object.freeze([...this.drops]);
    this.drops.length = 0;
    return out;
  }

  /** How many events were dropped in the life of this buffer. */
  get dropped(): number {
    return this.drops.length;
  }
}

/**
 * The flush decision of the interval (F128-FR-010). `intervalMs` 0 flushes at
 * every event; otherwise a flush is due when the interval has elapsed since
 * the last flush (or the first event since one).
 */
export class FlushInterval {
  readonly intervalMs: number;
  private lastFlushAt: number | null = null;
  private firstEventAt: number | null = null;

  constructor(intervalMs: number = DEFAULT_FLUSH_INTERVAL_MS) {
    this.intervalMs =
      typeof intervalMs === "number" && Number.isFinite(intervalMs) && intervalMs >= 0
        ? Math.trunc(intervalMs)
        : DEFAULT_FLUSH_INTERVAL_MS;
  }

  /** Called on every event; answers whether a flush is due now. */
  due(nowMs: number, buffered: number): boolean {
    if (buffered === 0) return false;
    if (this.intervalMs === 0) return true;
    if (this.firstEventAt === null) this.firstEventAt = nowMs;
    return nowMs - this.firstEventAt >= this.intervalMs;
  }

  /** Called after a flush (and by `close`, which flushes once). */
  flushed(nowMs: number): void {
    this.lastFlushAt = nowMs;
    this.firstEventAt = null;
  }

  /** When the last flush happened, for the delivery status. */
  get lastFlush(): number | null {
    return this.lastFlushAt;
  }
}
