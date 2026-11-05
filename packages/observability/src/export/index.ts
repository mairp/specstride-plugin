/**
 * T014 — the two sinks of feature 128, the Loki sink and the OTLP exporter,
 * registered through the registration call of EP-08 (F128-FR-008,
 * F128-FR-011, F128-FR-020).
 *
 * F128-FR-008: *The Loki sink and the OTLP exporter MUST be implementations
 * of the event sink of annex C §C.10. ... `write` MUST only buffer, and the
 * network request MUST be made by the sink's own flush. An exception, a
 * timeout or a full buffer of one sink MUST NOT stop the event reaching the
 * other sink, and MUST NOT change the outcome of the run, the exit code or
 * the event file. A sink MUST ignore an event type and a field it does not
 * know, and MUST declare the range of event schema majors it accepts.
 * `telemetry.delivery` events MUST never be delivered to a remote sink.*
 *
 * F128-FR-020 (Loki): a push to `<base>/loki/api/v1/push` counts as accepted
 * only on HTTP 200 or 204; after a flush the buffered streams are cleared
 * even when the push failed.
 *
 * F128-FR-011 (OTLP logs): one log record per event — `timeUnixNano`,
 * `observedTimeUnixNano`, `severityNumber` 9, `severityText` `INFO`, a body
 * that is the logfmt line, attributes that are the event name and every
 * non-null field, typed by the rule of the requirement. The time is the clock
 * of the exporter in the as-is form and the `ts` of the event in the new
 * form.
 *
 * The registration is the dispatcher's `register`, the registration call of
 * EP-08 that feature 100 checks (`registryCheck`); a sink the check refuses
 * is refused with a doctor finding and never stops the run.
 */
import type { DeliveryStatus, EventSink, SinkContext } from "@specstride/contracts/ep/event-sink";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { encodeLogfmt } from "./forms/logfmt.ts";
import { payloadFormOf, shipsInAsIsForm, shippedNameOf, type PayloadForm } from "./forms/forms.ts";
import { FlushInterval, SinkBuffer } from "./delivery/buffer.ts";
import {
  postJson,
  resolveMaxBatchBytes,
  resolveTimeoutMs,
  signalIsSplit,
  splitBatch,
  type RequestResult,
  type SplitSignal,
} from "./delivery/request.ts";
import { DeliveryRecorder, type DeliveryEvent } from "./delivery/record.ts";
import { reasonOf, reasonForTransportError } from "./delivery/reasons.ts";
import { lokiPushBodyOf, lokiPushUrlOf, lokiStreamOf } from "./loki/sink.ts";
import { streamLabelsFor } from "./loki/labels.ts";
import { logRecordWithoutContent } from "./content/logs.ts";
import { buildLogsRequest } from "./otlp/logs.ts";
import { otlpUrlOf } from "./otlp/post.ts";

/** The labels of the two sinks (the data model of the feature). */
export const LOKI_LABEL = "loki" as const;
export const OTEL_LABEL = "otel" as const;

/** The range of event schema majors both sinks accept. */
export const ACCEPTS_MAJORS = { from: 1, to: 1 } as const;

/** The event the writer records and no sink ever delivers (F128-FR-008). */
const TELEMETRY_DELIVERY = "telemetry.delivery";

/** The name a verdict must never ship under (F128-FR-009). */
export const THE_NAME_NO_RUN_SHIPS = "gate" as const;

/** Third-party types are never projected and never shipped (annex C §C.10). */
function isThirdParty(type: string): boolean {
  return type.startsWith("x.");
}

/** Nanoseconds of an ISO `ts`, as the new form timestamps its records. */
export function tsToNanos(ts: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return "";
  return (BigInt(ms) * 1_000_000n).toString();
}

function defaultNanos(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/** OTLP typed attribute value (F128-FR-011): bool, int-as-text, double, string. */
export function anyValue(value: unknown): {
  boolValue?: boolean;
  intValue?: string;
  doubleValue?: number;
  stringValue?: string;
} {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function _attrsKv(record: Record<string, unknown>): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    out.push({ key, value: anyValue(value) });
  }
  return out;
}

/** The options both sinks share (the keys of F128-FR-010 and F128-FR-008). */
export type ExportSinkOptions = {
  /** Base address, without a trailing slash. */
  readonly url: string;
  readonly enabled?: boolean;
  /** The time limit of one request, in milliseconds (default 2500). */
  readonly timeoutMs?: number;
  /** The body bound of a split signal, in bytes (default 3145728). */
  readonly maxBatchBytes?: number;
  /** The flush interval, in milliseconds (default 2000; 0 flushes per event). */
  readonly flushIntervalMs?: number;
  /** The buffer bound, in events (`telemetry.queueMaxEvents`). */
  readonly queueMaxEvents?: number;
  readonly fetchImpl?: typeof fetch;
  /** The clock of the sink, in nanoseconds (the as-is form's entry time). */
  readonly nowNanos?: () => bigint;
  readonly warn?: (message: string) => void;
  /**
   * The writer of the run the delivery record goes through (F128-FR-026):
   * the event `telemetry.delivery` is handed HERE — local first, never to a
   * remote sink, no ledger and no spool.
   */
  readonly onDeliveryRecord?: (event: DeliveryEvent) => void;
};

/** One buffered entry: everything a flush needs, decided at `write` time. */
type Entry = {
  /** The event name, of the form in force. */
  readonly name: string;
  /** The logfmt line (the same string for both sinks, F128-FR-022). */
  readonly line: string;
  /** The entry time in nanoseconds: the sink's clock or the event's `ts`. */
  readonly timeNanos: string;
  /** Every non-null field of the event, for the OTLP attributes. */
  readonly attrs: Record<string, unknown>;
};

/** The receiver state of a sink (the data model: the highest proved). */
type ReceiverState = "configured" | "reachable" | "request_accepted" | "closed";

/**
 * The shared body of both sinks: buffer on `write`, post on `flush`, flush
 * once bounded on `close`, best-effort everywhere (F128-FR-035).
 */
abstract class ExportSinkBase implements EventSink {
  abstract readonly label: string;
  readonly acceptsMajors = ACCEPTS_MAJORS;

  protected readonly options: ExportSinkOptions;
  protected readonly buffer: SinkBuffer<Entry>;
  protected readonly interval: FlushInterval;
  protected state: ReceiverState = "closed";
  protected lastDelivery: "attempted" | "accepted" | "failed" | "unknown" = "attempted";
  protected lastReason: string | null = null;
  protected context: SinkContext | undefined;
  protected form: PayloadForm = "new";

  protected constructor(options: ExportSinkOptions) {
    this.options = options;
    this.buffer = new SinkBuffer<Entry>(options.queueMaxEvents);
    this.interval = new FlushInterval(options.flushIntervalMs);
    // The delivery record goes through the writer of the run (F128-FR-026):
    // the writer is looked up per sink at flush time, local first, never a
    // remote sink.
    this.recorder = new DeliveryRecorder(
      (_sink) =>
        this.options.onDeliveryRecord ? { write: this.options.onDeliveryRecord } : undefined,
      {
        runId: () => this.context?.runId ?? "",
        launchId: () => this.context?.launchId ?? "",
      },
    );
  }

  /** The delivery recorder of this sink (F128-FR-026). */
  protected readonly recorder: DeliveryRecorder;

  /** The signal this sink posts, for the split rule. */
  protected abstract readonly signal: SplitSignal;
  /** The URL this sink posts to, from the base address. */
  protected abstract urlFor(base: string): string;
  /** The body of one request over one part of the batch. */
  protected abstract bodyFor(part: readonly Entry[]): string;

  async open(context: SinkContext): Promise<void> {
    this.context = context;
    this.form = payloadFormOf(
      context.switches as Readonly<Record<string, unknown>>,
      context.profile,
    );
    this.state = "configured";
  }

  /** F128-FR-008: `write` only buffers, and never throws. */
  async write(event: EventEnvelope): Promise<void> {
    try {
      if (event.type === TELEMETRY_DELIVERY) return; // never delivered to a remote sink
      if (isThirdParty(event.type)) return; // an unknown type is ignored
      // A major outside the declared range is ignored (F128-FR-008).
      if (event.v < this.acceptsMajors.from || event.v > this.acceptsMajors.to) return;
      const projection = this.context?.compatibilityProjection;
      const name = shippedNameOf(event.type, this.form, projection ?? { asIsNameOf: () => null });
      if (name === null || name === THE_NAME_NO_RUN_SHIPS) return;
      if (
        this.form === "as-is" &&
        !shipsInAsIsForm(event.type, projection ?? { asIsNameOf: () => null })
      )
        return;
      const data = (event.data ?? {}) as Record<string, unknown>;
      // F128-FR-039: no log record and no Loki line carries prompt or reply
      // content, whatever the capture setting is — content lives on spans
      // only, through the accessor (F128-FR-037), and never in the fields of
      // a shipped event.
      const safe = logRecordWithoutContent(data);
      const attrs: Record<string, unknown> = { event: name, ...safe };
      const timeNanos =
        this.form === "new"
          ? tsToNanos(event.ts)
          : (this.options.nowNanos?.() ?? defaultNanos).toString();
      this.buffer.push(
        Object.freeze({
          name,
          line: encodeLogfmt(attrs),
          timeNanos,
          attrs,
        }),
      );
    } catch {
      // Best-effort: a malformed event is ignored, never thrown (F128-FR-035).
    }
  }

  /** The sink's own flush: the network request lives here (F128-FR-008). */
  async flush(): Promise<void> {
    if (this.buffer.empty) return; // no record for a flush with nothing buffered
    const batch = this.buffer.take();
    this.buffer.takeDrops();
    let accepted = false;
    let httpStatus: number | null = null;
    try {
      const timeoutMs = resolveTimeoutMs(this.options.timeoutMs);
      const results: RequestResult[] = [];
      if (signalIsSplit(this.signal)) {
        const maxBytes = resolveMaxBatchBytes(this.options.maxBatchBytes);
        const parts = splitBatch(batch, maxBytes, (entry) => this.bodyFor([entry]).length);
        for (const part of parts) {
          // Ordered requests: each part is posted before the next one.
          results.push(
            await postJson(
              this.urlFor(this.options.url),
              this.bodyFor(part.items),
              timeoutMs,
              this.options.fetchImpl,
              this.options.warn,
            ),
          );
        }
      } else {
        // Metrics and traces requests are sent unsplit (F128-FR-010).
        results.push(
          await postJson(
            this.urlFor(this.options.url),
            this.bodyFor(batch),
            timeoutMs,
            this.options.fetchImpl,
            this.options.warn,
          ),
        );
      }
      accepted = results.every((r) => r.ok);
      // The HTTP status of the request that failed, when there was one; a
      // transport failure carries none (the field is dropped, never null).
      httpStatus = results.find((r) => !r.ok && r.status !== undefined)?.status ?? null;
      this.lastDelivery = accepted ? "accepted" : "failed";
      this.lastReason = accepted
        ? null
        : httpStatus !== null
          ? reasonOf({ ok: false, httpStatus })
          : reasonForTransportError();
      if (accepted) this.state = "request_accepted";
    } catch {
      // A raising flush is `failed` with `transport_error` (the data model).
      accepted = false;
      this.lastDelivery = "failed";
      this.lastReason = reasonForTransportError();
    } finally {
      // One delivery record for this flush (F128-FR-026): the sink label, the
      // batch id `<sink>-<nanos>-<sequence>`, the count, the status, the HTTP
      // status and the reason — through the writer of the run, local first.
      const nanos = (this.options.nowNanos?.() ?? defaultNanos()).toString();
      this.recorder.record(this.label, this.recorder.nextBatchId(this.label, nanos), batch.length, {
        status: this.lastDelivery,
        httpStatus,
        reasonCode: this.lastReason,
      });
      // The buffer is cleared even when the push failed (F128-FR-020).
      this.interval.flushed(Date.now());
    }
  }

  /** `close` flushes once, bounded by the time limit (F128-FR-010). */
  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      this.state = "closed";
      this.context = undefined;
    }
  }

  status(): DeliveryStatus {
    const phrase =
      this.state === "request_accepted"
        ? "events accepted"
        : this.state === "configured"
          ? "export configured"
          : this.state === "closed"
            ? "export closed"
            : "endpoint reachable";
    return Object.freeze({
      line: `${this.label}: ${phrase}`,
      record: Object.freeze({
        sinkLabel: this.label,
        receiverState: this.state,
        lastDeliveryStatus: this.lastDelivery,
        reason: this.lastReason,
      }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * The Loki sink (F128-FR-020).
 * ------------------------------------------------------------------ */

export class LokiSink extends ExportSinkBase {
  readonly label = LOKI_LABEL;
  protected readonly signal = "loki" as const;

  constructor(options: ExportSinkOptions) {
    super(options);
  }

  protected urlFor(base: string): string {
    return lokiPushUrlOf(base);
  }

  /** `{"streams":[{"stream":{labels},"values":[["<ns>","<line>"],…]}]}` */
  protected bodyFor(part: readonly Entry[]): string {
    const first = part[0];
    const labels = streamLabelsFor({
      form: this.form,
      eventName: first?.name ?? "",
      task: this.context?.labels.task,
      backend: this.context?.labels.backend,
      feature: this.context?.feature,
      harness: (this.context?.labels as Record<string, string | undefined> | undefined)?.harness,
      model:
        typeof first?.attrs["model"] === "string" ? (first.attrs["model"] as string) : undefined,
    });
    return lokiPushBodyOf({ streams: [lokiStreamOf(labels, part)] });
  }
}

/* ------------------------------------------------------------------ *
 * The OTLP exporter (F128-FR-011).
 * ------------------------------------------------------------------ */

export class OtlpSink extends ExportSinkBase {
  readonly label = OTEL_LABEL;
  /** Logs are a split signal; the metrics and traces requests are unsplit. */
  protected readonly signal = "logs" as const;

  constructor(options: ExportSinkOptions) {
    super(options);
  }

  protected urlFor(base: string): string {
    return otlpUrlOf(base, "logs");
  }

  /** One log record per entry, severity 9 INFO, body = the logfmt line. */
  protected bodyFor(part: readonly Entry[]): string {
    const observed = (this.options.nowNanos?.() ?? defaultNanos).toString();
    return buildLogsRequest({
      form: this.form,
      labels: {
        task: this.context?.labels.task,
        backend: this.context?.labels.backend,
        project: this.context?.feature,
        harness: (this.context?.labels as Record<string, string | undefined> | undefined)?.harness,
      },
      entries: part.map((entry) => ({
        timeNanos: entry.timeNanos,
        observedTimeNanos: observed,
        line: entry.line,
        attrs: entry.attrs,
      })),
    });
  }
}

/** Create the Loki sink. */
export function createLokiSink(options: ExportSinkOptions): LokiSink {
  return new LokiSink(options);
}

/** Create the OTLP exporter sink. */
export function createOtlpSink(options: ExportSinkOptions): OtlpSink {
  return new OtlpSink(options);
}

/**
 * The registration call of EP-08: each sink is handed to the dispatcher's
 * `register`, which checks the declared range of majors at registration
 * (F111-FR-034). The decisions come back so a refusal becomes a doctor
 * finding and never a failure of the run.
 */
export type DispatcherLike = {
  register(sink: {
    readonly label: string;
    readonly acceptsMajors: { readonly from: number; readonly to: number };
    open(context: SinkContext): Promise<void> | void;
    write(event: EventEnvelope): Promise<void> | void;
    flush(): Promise<void> | void;
    close(): Promise<void> | void;
  }): { readonly accepted: boolean; readonly findings: readonly unknown[] };
};

export type ExportRegistration = {
  readonly loki: LokiSink;
  readonly otel: OtlpSink;
  readonly lokiAccepted: boolean;
  readonly otelAccepted: boolean;
};

/** Register both sinks through the registration call of EP-08 (F128-FR-008). */
export function registerExportSinks(
  dispatcher: DispatcherLike,
  lokiOptions: ExportSinkOptions,
  otelOptions: ExportSinkOptions,
): ExportRegistration {
  const loki = createLokiSink(lokiOptions);
  const otel = createOtlpSink(otelOptions);
  return {
    loki,
    otel,
    lokiAccepted: dispatcher.register(loki).accepted,
    otelAccepted: dispatcher.register(otel).accepted,
  };
}
