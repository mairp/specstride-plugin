/**
 * T032 — the time limit, the bounded queue and `telemetry.delivery`
 * (F111-FR-035).
 *
 * F111-FR-035: *A sink that is slow, throws or is dead MUST be skipped for the
 * event. The core MUST bound the time of every call by
 * `telemetry.sinkTimeoutMs`, MUST bound the queue of every sink, MUST record
 * the failure as `telemetry.delivery` (sink, batch, event count, status
 * `attempted`, `accepted`, `failed` or `unknown`, HTTP status, reason) and MUST
 * go on. `telemetry.delivery` MUST NOT be delivered to a remote sink. The
 * outcome of the run, the exit code and the primary event file MUST be
 * unchanged.*
 *
 * Four things are mechanism here, not comment:
 *
 *   1. THE TIME LIMIT IS A RACE, NOT A HOPE. `withTimeLimit` races the sink's
 *      promise against a timer and returns on whichever comes first; the timer
 *      is cleared the moment the race settles. A DEAD collector — a call that
 *      never comes back at all — therefore costs the run `limitMs` once and no
 *      more: the race resolves, the abandoned promise is dropped and holds
 *      nothing open, and the loop goes on. Without the race, one dead
 *      collector would hang every run for ever.
 *   2. THE QUEUE DROPS THE OLDEST. `BoundedSinkQueue` has a capacity per sink
 *      and, when it is full, drops the OLDEST event of THAT sink (research
 *      D-9). The primary file is authoritative, so the loss is of telemetry
 *      and never of the record; the alternative is memory that grows without
 *      bound behind a dead collector.
 *   3. `telemetry.delivery` IS LOCAL. It is written to the local delivery log
 *      beside the event file, and to no sink at all — which is the recursion
 *      guard of the baseline (`lib/telemetry_delivery.py`, research D-8): a
 *      delivery record delivered through a sink produces a delivery record.
 *      It is kept OUT of the primary event file of the run, because
 *      F111-FR-035 requires that file to be UNCHANGED by a sink's failure and
 *      F111-SC-003 compares it byte for byte with the run that had no failing
 *      sink. The local delivery log is not a writer class of the projection
 *      (F111-FR-022 has two, `run` and `learning`); it is local telemetry,
 *      which no projection reads.
 *   4. THE RUN IS NEVER TOLD. `callSink` resolves — it never rejects and never
 *      throws — so no failure of a sink can reach the loop (Principle V,
 *      F111-SC-003). The outcome of the run and its exit code are decided
 *      where they were decided before.
 *
 * The four statuses and their meanings are the baseline's, read from row 93 of
 * annex X §X.6 and never written here.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MAJOR, SCHEMA } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { deliveryStatusesOfASink } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE_BY_TYPE } from "../catalogue/index.ts";
import { LINE_END } from "../writer/seq.ts";
import type { DispatchableSink } from "./dispatcher.ts";

/* ------------------------------------------------------------------ *
 * The time limit of every sink call (row 46 of annex X §X.7).
 * ------------------------------------------------------------------ */

/** The setting that bounds the time of every sink call (F111-FR-035). */
export const SINK_TIMEOUT_SETTING = "telemetry.sinkTimeoutMs" as const;

/** Row 46 of annex X §X.7: the default of that setting. */
export const DEFAULT_SINK_TIMEOUT_MS = 2000 as const;

/**
 * Row 46 under the `parity` profile: the value is the same and is NOT USED,
 * because no other sink runs there (`assumption: CQ-177`).
 */
export const SINK_TIMEOUT_IS_USED_UNDER_PARITY = false as const;

/** The time limit of this run, from the resolved switches. */
export function sinkTimeoutMsOf(switches: Readonly<Record<string, unknown>> = {}): number {
  const value = switches[SINK_TIMEOUT_SETTING];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_SINK_TIMEOUT_MS;
}

/** What one bounded call came to. */
export type LimitedCall = {
  readonly ok: boolean;
  /** True where the limit came first: a slow sink or a dead collector. */
  readonly timedOut: boolean;
  readonly error?: string;
  /** The HTTP status the sink reported, where it reported one. */
  readonly httpStatus: number | null;
};

/** The error of a sink that reported an HTTP status with it. */
function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { httpStatus?: unknown }).httpStatus;
  return typeof value === "number" ? value : null;
}

/**
 * Call `work` and give up after `limitMs`. The call NEVER rejects: a throw and
 * a timeout both come back as a value, so no failure of a sink reaches the
 * loop. The timer is cleared as soon as the race settles, so a dead collector
 * delays the run by the limit once and never holds the process open.
 */
export async function withTimeLimit<T>(
  work: () => Promise<T> | T,
  limitMs: number,
): Promise<LimitedCall> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<LimitedCall>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          timedOut: true,
          error: `the sink did not answer within ${limitMs} ms`,
          httpStatus: null,
        }),
      limitMs,
    );
  });
  const call = (async (): Promise<LimitedCall> => {
    try {
      await work();
      return { ok: true, timedOut: false, httpStatus: null };
    } catch (error) {
      return { ok: false, timedOut: false, error: String(error), httpStatus: httpStatusOf(error) };
    }
  })();
  try {
    return await Promise.race([call, limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * The bounded queue of every sink (research D-9).
 * ------------------------------------------------------------------ */

/** How many events one sink's queue holds before the oldest is dropped. */
export const DEFAULT_QUEUE_CAPACITY = 128 as const;

/** D-9: a full queue drops the OLDEST event of that sink. */
export const FULL_QUEUE_DROPS = "oldest" as const;

/**
 * The queue of one sink. Bounded: a push into a full queue drops the oldest
 * event of that sink and counts it. A dead sink therefore costs a fixed amount
 * of memory and never grows without bound.
 */
export class BoundedSinkQueue {
  readonly #events: EventEnvelope[] = [];
  readonly #capacity: number;
  #droppedOldest = 0;

  constructor(capacity: number = DEFAULT_QUEUE_CAPACITY) {
    this.#capacity = Math.max(1, Math.floor(capacity));
  }

  get capacity(): number {
    return this.#capacity;
  }

  get length(): number {
    return this.#events.length;
  }

  /** How many events this queue dropped because it was full. */
  get droppedOldest(): number {
    return this.#droppedOldest;
  }

  /** Put one event in. Returns the event that was dropped, or null. */
  push(event: EventEnvelope): EventEnvelope | null {
    this.#events.push(event);
    if (this.#events.length <= this.#capacity) return null;
    const dropped = this.#events.shift() ?? null;
    if (dropped !== null) this.#droppedOldest += 1;
    return dropped;
  }

  /** Take up to `many` events off the head, oldest first. */
  take(many: number): readonly EventEnvelope[] {
    return Object.freeze(this.#events.splice(0, Math.max(0, Math.floor(many))));
  }

  /** Put events back at the head, in their order: a call that did not land. */
  putBack(events: readonly EventEnvelope[]): void {
    this.#events.unshift(...events);
    while (this.#events.length > this.#capacity) {
      this.#events.shift();
      this.#droppedOldest += 1;
    }
  }

  get events(): readonly EventEnvelope[] {
    return Object.freeze([...this.#events]);
  }
}

/* ------------------------------------------------------------------ *
 * `telemetry.delivery` (research D-8, row 93 of annex X §X.6).
 * ------------------------------------------------------------------ */

/** The type of the record F111-FR-035 names. */
export const TELEMETRY_DELIVERY_TYPE = "telemetry.delivery" as const;

/**
 * The fields of that record, read from the row of the catalogue:
 * `sink`, `batchId`, `eventCount`, `status`, `httpStatus`, `reasonCode`.
 */
export const TELEMETRY_DELIVERY_FIELDS: readonly string[] = Object.freeze([
  ...(CATALOGUE_BY_TYPE.get(TELEMETRY_DELIVERY_TYPE)?.dataFields ?? []),
]);

/** The four statuses of row 93, read from the row (research D-8). */
export const DELIVERY_STATUSES: readonly string[] = Object.freeze([
  ...deliveryStatusesOfASink.members,
]);

/** Row 93's unknown-value rule: a status outside the set reads as `unknown`. */
export const STATUS_WHEN_UNKNOWN = "unknown" as const;

/** The recursion guard of the baseline: the record reaches no sink at all. */
export const TELEMETRY_DELIVERY_REACHES_A_SINK = false as const;

/**
 * F111-FR-035: the primary event file of the run is UNCHANGED by a sink's
 * failure, so the record is not written there; it goes to the local delivery
 * log.
 */
export const TELEMETRY_DELIVERY_REACHES_THE_PRIMARY_EVENT_FILE = false as const;

/** The suffix of the local delivery log, beside the event file of the run. */
export const DELIVERY_LOG_SUFFIX = ".delivery.jsonl" as const;

/** The local delivery log of an event file. */
export function deliveryLogPathOf(eventsFile: string): string {
  return `${eventsFile}${DELIVERY_LOG_SUFFIX}`;
}

/** The short reasons this module records. */
export const DELIVERY_REASON_CODES = [
  "ok",
  "threw",
  "timed-out",
  "queue-overflow",
  "not-open",
] as const;
export type DeliveryReasonCode = (typeof DELIVERY_REASON_CODES)[number];

/** The `data` of one `telemetry.delivery` record. */
export type DeliveryRecord = {
  readonly sink: string;
  readonly batchId: string;
  readonly eventCount: number;
  readonly status: string;
  readonly httpStatus: number | null;
  readonly reasonCode: string;
};

/** One `telemetry.delivery` event, envelope and all. */
export type TelemetryDeliveryEvent = {
  readonly schema: string;
  readonly v: number;
  readonly seq: number;
  readonly ts: string;
  readonly type: typeof TELEMETRY_DELIVERY_TYPE;
  readonly runId: string;
  readonly launchId: string;
  readonly data: DeliveryRecord;
};

/**
 * The status of one delivery, from row 93. A status the SINK reported that is
 * not a member of the row reads as `unknown`, which is the row's own rule; a
 * throw is a definite `failed`; a time limit that came first is `attempted`,
 * because the call was made and whether it landed is not known; a call that
 * came back is `accepted`.
 */
export function deliveryStatusOf(call: {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly reported?: string;
}): string {
  if (call.reported !== undefined) {
    return deliveryStatusesOfASink.has(call.reported) ? call.reported : STATUS_WHEN_UNKNOWN;
  }
  if (call.ok) return "accepted";
  if (call.timedOut) return "attempted";
  return "failed";
}

/** Build one `telemetry.delivery` event with the six fields of its row. */
export function telemetryDeliveryEvent(options: {
  readonly record: DeliveryRecord;
  readonly seq: number;
  readonly ts: string;
  readonly runId: string;
  readonly launchId: string;
}): TelemetryDeliveryEvent {
  return Object.freeze({
    schema: SCHEMA,
    v: MAJOR,
    seq: options.seq,
    ts: options.ts,
    type: TELEMETRY_DELIVERY_TYPE,
    runId: options.runId,
    launchId: options.launchId,
    data: Object.freeze({ ...options.record }),
  });
}

/**
 * The local delivery log: an append-only file beside the event file of the
 * run. It is local telemetry — no sink receives it and no projection reads it.
 */
export class LocalDeliveryLog {
  readonly #path: string | undefined;
  readonly #records: TelemetryDeliveryEvent[] = [];

  constructor(path?: string) {
    this.#path = path;
    if (path !== undefined) mkdirSync(dirname(path), { recursive: true });
  }

  get path(): string | undefined {
    return this.#path;
  }

  get records(): readonly TelemetryDeliveryEvent[] {
    return Object.freeze([...this.#records]);
  }

  /** Record one delivery. A failure to write is swallowed: best effort. */
  record(event: TelemetryDeliveryEvent): void {
    this.#records.push(event);
    if (this.#path === undefined) return;
    try {
      appendFileSync(this.#path, `${JSON.stringify(event)}${LINE_END}`);
    } catch {
      // Principle V: telemetry about telemetry never breaks the loop.
    }
  }
}

/* ------------------------------------------------------------------ *
 * The isolation of one sink call.
 * ------------------------------------------------------------------ */

export type SinkIsolationOptions = {
  /** The resolved switches of the run; `telemetry.sinkTimeoutMs` is read. */
  readonly switches?: Readonly<Record<string, unknown>>;
  /** The time limit, where the caller sets it directly. */
  readonly timeoutMs?: number;
  /** The capacity of the queue of each sink. */
  readonly queueCapacity?: number;
  /** How many queued events one call tries to deliver. */
  readonly batchMax?: number;
  /** The event file of the run; the delivery log sits beside it. */
  readonly eventsFile?: string;
  /** The local delivery log, where the caller supplies its own. */
  readonly deliveryLog?: LocalDeliveryLog;
  readonly runId?: string;
  readonly launchId?: string;
  readonly now?: () => Date;
};

/**
 * The isolation of F111-FR-035. `callSink` is the function the dispatcher of
 * T030 takes: it bounds the time, bounds the queue, records the outcome as
 * `telemetry.delivery` locally, and ALWAYS resolves.
 */
export class SinkIsolation {
  readonly #timeoutMs: number;
  readonly #queueCapacity: number;
  readonly #batchMax: number;
  readonly #queues = new Map<string, BoundedSinkQueue>();
  readonly #log: LocalDeliveryLog;
  readonly #runId: string;
  readonly #launchId: string;
  readonly #now: () => Date;
  #batches = 0;
  #seq = 0;

  constructor(options: SinkIsolationOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? sinkTimeoutMsOf(options.switches ?? {});
    this.#queueCapacity = options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    this.#batchMax = options.batchMax ?? 1;
    this.#log =
      options.deliveryLog ??
      new LocalDeliveryLog(
        options.eventsFile === undefined ? undefined : deliveryLogPathOf(options.eventsFile),
      );
    this.#runId = options.runId ?? "";
    this.#launchId = options.launchId ?? "";
    this.#now = options.now ?? (() => new Date());
    this.callSink = this.callSink.bind(this);
  }

  /** The time limit every call of every sink is bounded by. */
  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /** The `telemetry.delivery` events this isolation recorded, in order. */
  get deliveries(): readonly TelemetryDeliveryEvent[] {
    return this.#log.records;
  }

  /** The local delivery log this isolation writes to, or undefined. */
  get deliveryLogPath(): string | undefined {
    return this.#log.path;
  }

  /** The queue of one sink, created on first use. */
  queueOf(label: string): BoundedSinkQueue {
    const found = this.#queues.get(label);
    if (found !== undefined) return found;
    const fresh = new BoundedSinkQueue(this.#queueCapacity);
    this.#queues.set(label, fresh);
    return fresh;
  }

  /** How deep the queue of each sink is now. */
  queueDepths(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [label, queue] of this.#queues) out[label] = queue.length;
    return Object.freeze(out);
  }

  /** How many events each sink's queue dropped because it was full. */
  droppedOldest(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [label, queue] of this.#queues) out[label] = queue.droppedOldest;
    return Object.freeze(out);
  }

  /**
   * Offer one event to one sink, bounded in time and in memory. It resolves
   * `{ ok }`; it never rejects, so the loop is never told (Principle V).
   */
  async callSink(
    sink: DispatchableSink,
    event: EventEnvelope,
  ): Promise<{ ok: boolean; error?: string }> {
    const queue = this.queueOf(sink.label);
    const dropped = queue.push(event);
    if (dropped !== null) {
      this.#record(sink.label, 1, "attempted", null, "queue-overflow");
    }

    const batch = queue.take(this.#batchMax);
    if (batch.length === 0) return { ok: true };

    let ok = true;
    let error: string | undefined;
    for (let i = 0; i < batch.length; i++) {
      const one = batch[i] as EventEnvelope;
      const call = await withTimeLimit(() => sink.write?.(one), this.#timeoutMs);
      const status = deliveryStatusOf(call);
      const reasonCode: DeliveryReasonCode = call.ok ? "ok" : call.timedOut ? "timed-out" : "threw";
      this.#record(sink.label, 1, status, call.httpStatus, reasonCode);
      if (!call.ok) {
        ok = false;
        error = call.error;
        // The sink is SKIPPED for this event: what did not land goes back in
        // the bounded queue, where the oldest falls out when it is full.
        queue.putBack(batch.slice(i));
        break;
      }
    }
    return error === undefined ? { ok } : { ok, error };
  }

  #record(
    sink: string,
    eventCount: number,
    status: string,
    httpStatus: number | null,
    reasonCode: DeliveryReasonCode,
  ): void {
    this.#batches += 1;
    this.#seq += 1;
    this.#log.record(
      telemetryDeliveryEvent({
        record: {
          sink,
          batchId: `batch-${this.#batches}`,
          eventCount,
          status,
          httpStatus,
          reasonCode,
        },
        seq: this.#seq,
        ts: this.#now().toISOString(),
        runId: this.#runId,
        launchId: this.#launchId,
      }),
    );
  }
}

/** The `callSink` of a fresh isolation, for a caller that wants the function. */
export function isolatedCallSink(
  options: SinkIsolationOptions = {},
): (sink: DispatchableSink, event: EventEnvelope) => Promise<{ ok: boolean; error?: string }> {
  return new SinkIsolation(options).callSink;
}
