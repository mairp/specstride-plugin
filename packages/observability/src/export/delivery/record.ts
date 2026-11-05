/**
 * T030 — the delivery record, the batch id and the statuses (F128-FR-026).
 *
 * F128-FR-026: *Every flush that had a batch MUST give one delivery record
 * for each sink: the sink label, a batch id of the form
 * `<sink>-<time in nanoseconds>-<sequence>`, the number of events, the
 * status, the HTTP status and the reason. A flush with nothing buffered MUST
 * give no record. A sink whose flush raises MUST give a record with the
 * status `failed` and the reason `transport_error`. The status MUST be one of
 * `attempted`, `accepted`, `failed`, `unknown`, and a status outside the set
 * MUST be written as `unknown`. The record MUST reach the run as the event
 * `telemetry.delivery` through the writer of the run, and MUST never be
 * delivered to a remote sink; there MUST be no other ledger and no spool.
 * The sink label of a record MUST be the label the status surfaces query:
 * `loki` for the Loki sink and `otel` for the OTLP exporter* (the fix of
 * defect D-40, proven by CT-128-23).
 *
 * The fields are the data fields of the catalogue row of `telemetry.delivery`
 * (`sink`, `batchId`, `eventCount`, `status`, `httpStatus`, `reasonCode`,
 * packages/observability/data/event-catalogue.tsv, line 101); a field whose
 * value is null is DROPPED, not written null (the envelope convention of
 * annex X §X.1: absence for a value that does not apply). `queryVerified` is
 * only ever READ (the data model: nothing in this feature sets it).
 */

/** The type of the delivery record (feature 111's row 93). */
export const DELIVERY_EVENT_TYPE = "telemetry.delivery" as const;

/** The schema id of the envelope the record travels in (annex X §X.1). */
export const ENVELOPE_SCHEMA = "specstride.event" as const;
/** The envelope major the exporter writes. */
export const ENVELOPE_MAJOR = 1 as const;

/** The four statuses of the record; anything else is written `unknown`. */
export const DELIVERY_STATUSES = Object.freeze([
  "attempted",
  "accepted",
  "failed",
  "unknown",
] as const);
export type DeliveryStatusName = (typeof DELIVERY_STATUSES)[number];

/** The status a status outside the set is written as (row 93's rule). */
export const STATUS_WHEN_UNKNOWN = "unknown" as const;

/** The recursion guard of the baseline (research D-8): the record reaches no remote sink. */
export const DELIVERY_REACHES_A_REMOTE_SINK = false as const;
/** The record reaches the run through the WRITER of the run — local first. */
export const DELIVERY_GOES_THROUGH_THE_WRITER = true as const;
/** No ledger and no spool: nothing on disk belongs to the delivery record. */
export const DELIVERY_KEEPS_NO_LEDGER = true as const;
export const DELIVERY_KEEPS_NO_SPOOL = true as const;

/** A status outside the set is rewritten `unknown` (F128-FR-026). */
export function normalizeDeliveryStatus(status: string): DeliveryStatusName {
  return (DELIVERY_STATUSES as readonly string[]).includes(status)
    ? (status as DeliveryStatusName)
    : STATUS_WHEN_UNKNOWN;
}

/**
 * One batch id: `<sink>-<time in nanoseconds>-<sequence>`. The sequence rises
 * within the exporter start and starts at 1.
 */
export function batchIdOf(
  sink: string,
  timeNanos: bigint | number | string,
  sequence: number,
): string {
  return `${sink}-${timeNanos.toString()}-${String(sequence)}`;
}

/** The sequence source of one exporter start: 1, 2, 3, … per sink. */
export class BatchSequencer {
  #next: number = 1;
  /** The next sequence, rising. */
  take(): number {
    return this.#next++;
  }
}

/** The data of one `telemetry.delivery` event (the catalogue row's fields). */
export type DeliveryRecordData = {
  readonly sink: string;
  readonly batchId: string;
  readonly eventCount: number;
  readonly status: DeliveryStatusName;
  /** Absent when there was no HTTP status (a transport error). */
  readonly httpStatus?: number;
  /** Absent on `accepted`. */
  readonly reasonCode?: string;
  /** Only ever read; nothing in this feature sets it. */
  readonly queryVerified?: boolean;
};

/**
 * Build the data of one delivery record. A null or undefined HTTP status and
 * reason are DROPPED (absence, never null); a status outside the set is
 * written `unknown`.
 */
export function deliveryRecordDataOf(input: {
  readonly sink: string;
  readonly batchId: string;
  readonly eventCount: number;
  readonly status: string;
  readonly httpStatus?: number | null;
  readonly reasonCode?: string | null;
  readonly queryVerified?: boolean;
}): DeliveryRecordData {
  const data: {
    sink: string;
    batchId: string;
    eventCount: number;
    status: DeliveryStatusName;
    httpStatus?: number;
    reasonCode?: string;
    queryVerified?: boolean;
  } = {
    sink: input.sink,
    batchId: input.batchId,
    eventCount: input.eventCount,
    status: normalizeDeliveryStatus(input.status),
  };
  if (typeof input.httpStatus === "number") data.httpStatus = input.httpStatus;
  if (typeof input.reasonCode === "string") data.reasonCode = input.reasonCode;
  if (input.queryVerified === true) data.queryVerified = true;
  return Object.freeze(data);
}

/**
 * Read the record data back out of an event the writer gave (CT-128-23 and the
 * probe read this shape): the `data` of the event, or the event itself when
 * someone stored the data directly.
 */
export function deliveryDataOf(event: unknown): DeliveryRecordData {
  if (event !== null && typeof event === "object" && "data" in event) {
    return (event as { data: DeliveryRecordData }).data;
  }
  return event as DeliveryRecordData;
}

/** One `telemetry.delivery` event, envelope and all (annex X §X.1). */
export type DeliveryEvent = {
  readonly schema: typeof ENVELOPE_SCHEMA;
  readonly v: typeof ENVELOPE_MAJOR;
  readonly seq: number;
  readonly ts: string;
  readonly type: typeof DELIVERY_EVENT_TYPE;
  readonly runId: string;
  readonly launchId: string;
  readonly data: DeliveryRecordData;
};

/**
 * Build the event an envelope-shaped record travels in. Nulls are dropped in
 * the data (see `deliveryRecordDataOf`), never written as null.
 */
export function deliveryEventOf(
  data: DeliveryRecordData,
  meta: {
    readonly seq: number;
    readonly ts: string;
    readonly runId: string;
    readonly launchId: string;
  },
): DeliveryEvent {
  return Object.freeze({
    schema: ENVELOPE_SCHEMA,
    v: ENVELOPE_MAJOR,
    seq: meta.seq,
    ts: meta.ts,
    type: DELIVERY_EVENT_TYPE,
    runId: meta.runId,
    launchId: meta.launchId,
    data,
  });
}

/** The recursion guard: is this event a delivery record? (Sinks never re-ship it.) */
export function isDeliveryEvent(type: string): boolean {
  return type === DELIVERY_EVENT_TYPE;
}

/**
 * The writer of the run the record goes through: the primary writer's append,
 * or whatever stands in for it in a test. The recorder calls it and NOTHING
 * else — no remote sink, no ledger file, no spool directory.
 */
export type DeliveryWriter = {
  write(event: DeliveryEvent): void;
};

/** What the recorder needs from a sink's flush, already decided. */
export type DeliveryOutcome = {
  readonly status: string;
  readonly httpStatus?: number | null;
  readonly reasonCode?: string | null;
};

/**
 * The delivery recorder of one exporter start. One record per flush that had
 * a batch, per sink: the writer of the run receives the event, the remote
 * never does, and nothing is kept on disk. The sequence rises per sink.
 */
export class DeliveryRecorder {
  readonly #writerFor: (sink: string) => DeliveryWriter | undefined;
  readonly #sequencers = new Map<string, BatchSequencer>();
  readonly #batchSequencers = new Map<string, BatchSequencer>();
  readonly #meta: {
    readonly runId: () => string;
    readonly launchId: () => string;
    readonly ts: () => string;
  };

  constructor(
    writerFor: (sink: string) => DeliveryWriter | undefined = () => undefined,
    meta: {
      readonly runId?: () => string;
      readonly launchId?: () => string;
      readonly ts?: () => string;
    } = {},
  ) {
    this.#writerFor = writerFor;
    this.#meta = {
      runId: meta.runId ?? (() => ""),
      launchId: meta.launchId ?? (() => ""),
      ts: meta.ts ?? (() => new Date().toISOString()),
    };
  }

  /**
   * Build and deliver one record: the writer of the run gets the event FIRST
   * (local first, B-2415), before the caller could do anything else with it.
   * The call never throws and never touches a remote sink.
   */
  record(
    sink: string,
    batchId: string,
    eventCount: number,
    outcome: DeliveryOutcome,
  ): DeliveryEvent | undefined {
    try {
      const data = deliveryRecordDataOf({
        sink,
        batchId,
        eventCount,
        status: outcome.status,
        httpStatus: outcome.httpStatus ?? null,
        reasonCode: outcome.reasonCode ?? null,
      });
      const event = deliveryEventOf(data, {
        seq: this.#nextSeq(sink),
        ts: this.#meta.ts(),
        runId: this.#meta.runId(),
        launchId: this.#meta.launchId(),
      });
      const writer = this.#writerFor(sink);
      writer?.write(event);
      return event;
    } catch {
      // Best-effort: a failing writer never breaks the flush (F128-FR-035).
      return undefined;
    }
  }

  /**
   * The batch id of the next batch of a sink: `<sink>-<nanos>-<sequence>`,
   * the sequence rising within the exporter start (F128-FR-026).
   */
  nextBatchId(sink: string, timeNanos: bigint | number | string): string {
    let sequencer = this.#batchSequencers.get(sink);
    if (sequencer === undefined) {
      sequencer = new BatchSequencer();
      this.#batchSequencers.set(sink, sequencer);
    }
    return batchIdOf(sink, timeNanos, sequencer.take());
  }

  #nextSeq(sink: string): number {
    let sequencer = this.#sequencers.get(sink);
    if (sequencer === undefined) {
      sequencer = new BatchSequencer();
      this.#sequencers.set(sink, sequencer);
    }
    return sequencer.take();
  }
}
