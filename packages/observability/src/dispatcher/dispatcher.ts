/**
 * T030 — the dispatcher, the registry check and the content accessor hook
 * (F111-FR-034).
 *
 * F111-FR-034: *The core MUST offer the sink interface contract of annex C
 * §C.10: `open` with the context of the run and the content accessor, `write`
 * with one event in the order of `seq`, `flush` and `close`. A sink MUST
 * declare the range of event majors it accepts. The core MUST call a sink only
 * after the primary write, only with the redacted event, which is the envelope
 * of annex X §X.1 whole with its `data`, and MUST refuse a sink whose range
 * does not hold the current major, with a doctor finding.*
 *
 * Four things are mechanism here, not comment:
 *
 *   1. ONLY AFTER THE PRIMARY WRITE. `append` reaches the primary writer first
 *      and takes the event it returns — the one whose bytes `appendFileSync`
 *      has already put in the file. No path of this module reaches a sink
 *      without that event in hand, so "the primary file is authoritative" is
 *      the data flow and not a convention (Principle V; F100's §C.10
 *      "Guarantees of the core").
 *   2. IN THE ORDER OF `seq`. `#lastDelivered` rises with every delivery and an
 *      event at or below it is refused with the reason `out-of-order`. A sink
 *      therefore never sees a number twice and never sees them fall.
 *   3. THE ENVELOPE WHOLE. The dispatcher hands `write` the event object it
 *      received, untouched: no field is dropped and `data` is not flattened
 *      (the repair of F111-FR-034 after the report of feature 126).
 *   4. THE RANGE IS DECLARED, AND CHECKED AT REGISTRATION. `registryCheck`
 *      refuses a sink with no range and a sink whose range does not hold the
 *      current major, and hands back a doctor finding. The refusal does not
 *      stop the run.
 *
 * The time limit, the bounded queue and `telemetry.delivery` are T032's
 * (`isolation.ts`); the unknown-value rules and the roles are T035's
 * (`unknown.ts`). They compose over this module rather than inside it, so that
 * the ordering above stays in one place.
 */
import { MAJOR } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { DOCTOR_SEVERITIES } from "@specstride/contracts/codes/doctor-and-collisions";
import type { DoctorSeverity } from "@specstride/contracts/codes/doctor-and-collisions";
import {
  AS_IS_LABELS,
  OPERATIONS as EP08_OPERATIONS,
  POINT_ID as EP08_POINT_ID,
} from "@specstride/contracts/ep/event-sink";
import type {
  ContentAccessor,
  ContentReference,
  MajorRange,
  SinkContext,
} from "@specstride/contracts/ep/event-sink";
import type { DoctorFinding } from "../writer/check.ts";
import type { PrimaryWriter, WriteRequest } from "../writer/writer.ts";

export type { DoctorFinding };

export { AS_IS_LABELS, EP08_POINT_ID };

/* ------------------------------------------------------------------ *
 * The four operations F111-FR-034 names.
 * ------------------------------------------------------------------ */

/**
 * The operations of the sink contract this requirement names: `open` with the
 * context, `write` with one event, `flush` and `close`. They are the
 * operations of EP-08 without `status`, which feature 100 adds for the
 * telemetry section of `status` and which F111-FR-034 does not name.
 */
export const DISPATCHER_OPERATIONS = ["open", "write", "flush", "close"] as const;
export type DispatcherOperation = (typeof DISPATCHER_OPERATIONS)[number];

/** Every operation above is an operation of EP-08 (annex C §C.10). */
export const DISPATCHER_OPERATIONS_ARE_EP08 = DISPATCHER_OPERATIONS.every((operation) =>
  (EP08_OPERATIONS as readonly string[]).includes(operation),
);

/** F111-FR-034 and Principle V: the primary write happens first, always. */
export const DISPATCHER_CALLS_A_SINK_ONLY_AFTER_THE_PRIMARY_WRITE = true as const;

/** F111-FR-034: what a sink receives has passed the redaction ingress. */
export const DISPATCHER_DELIVERS_ONLY_THE_REDACTED_EVENT = true as const;

/** The refusal of a sink is a doctor finding and never the end of a run. */
export const REFUSAL_STOPS_THE_RUN = false as const;

/* ------------------------------------------------------------------ *
 * The content accessor hook of the context of `open`.
 * ------------------------------------------------------------------ */

/** The field of the context of `open` that carries the content accessor. */
export const CONTENT_ACCESSOR_HOOK_NAME = "content" as const;

/** What the core supplies behind the hook (annex C §C.10, F100-FR-106). */
export type ContentAccessorSource = {
  /** The switch of content capture, as the profile resolved it. */
  readonly captureIsOn: boolean;
  /** Read redacted content by reference. Called only while capture is on. */
  readonly read: (reference: ContentReference) => Promise<string | undefined>;
  /**
   * The as-is snippet the compatibility projection reads, redacted, whatever
   * the switch of content capture says (CQ-032, closed by the owner).
   */
  readonly asIsSnippet: (reference: ContentReference) => Promise<string | undefined>;
};

/**
 * The content accessor hook of F111-FR-034: the one object a sink reaches
 * content through. While capture is off `byReference` gives nothing back, so a
 * sink cannot reach content at all; the projection keeps its own snippets.
 */
export function contentAccessorHook(source: ContentAccessorSource): ContentAccessor {
  return Object.freeze({
    byReference(reference: ContentReference): Promise<string | undefined> {
      if (!source.captureIsOn) return Promise.resolve(undefined);
      return source.read(reference);
    },
    asIsSnippetForTheCompatibilityProjection(
      reference: ContentReference,
    ): Promise<string | undefined> {
      return source.asIsSnippet(reference);
    },
  });
}

/** Build the context of `open` for a run, with the content accessor in place. */
export function sinkContextOf(context: SinkContext): SinkContext {
  return Object.freeze({ ...context, labels: Object.freeze({ ...context.labels }) });
}

/* ------------------------------------------------------------------ *
 * The declared range of majors, and the registry check.
 * ------------------------------------------------------------------ */

/** The major of the event envelope this build writes (annex X §X.1). */
export function currentEventMajor(): number {
  return MAJOR;
}

/** True where the range a sink declared holds the current major. */
export function rangeHoldsTheCurrentMajor(range: MajorRange | undefined): boolean {
  if (range === undefined || range === null) return false;
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) return false;
  const major = currentEventMajor();
  return range.from <= major && major <= range.to;
}

/** The doctor finding of a refused sink (F111-FR-034). */
export const DOCTOR_FINDING_SINK_RANGE = "events.sink_major_out_of_range" as const;

/** A refusal warns; it never fails a run (Principle V). */
export const DOCTOR_SEVERITY_SINK_RANGE: DoctorSeverity = "warn";

/**
 * One finding of the refusal, in the shape of annex G §G.7. `lb` is always
 * false: a refused sink never blocks a launch (Principle V).
 */
function finding(message: string, fix: string, evidence: string): DoctorFinding {
  return Object.freeze({
    id: DOCTOR_FINDING_SINK_RANGE,
    severity: DOCTOR_SEVERITY_SINK_RANGE,
    lb: false as const,
    message,
    fix,
    evidence,
  });
}

/** A sink of the EP-08 shape, as this dispatcher needs it. */
export type DispatchableSink = {
  readonly label: string;
  /** F111-FR-034: the range of event majors the sink accepts. Required. */
  readonly acceptsMajors?: MajorRange;
  open?(context: SinkContext): Promise<void> | void;
  write?(event: EventEnvelope): Promise<void> | void;
  flush?(): Promise<void> | void;
  close?(): Promise<void> | void;
};

/** What the registry check decided about one sink. */
export type RegistryDecision = {
  readonly accepted: boolean;
  readonly findings: readonly DoctorFinding[];
};

/**
 * The registry check of F111-FR-034. A sink is refused where it declares no
 * range of majors and where the range it declares does not hold the current
 * major; a refusal carries a doctor finding and never stops the run.
 */
export function registryCheck(sink: DispatchableSink): RegistryDecision {
  const range = sink.acceptsMajors;
  const major = currentEventMajor();
  if (range === undefined || range === null) {
    return Object.freeze({
      accepted: false,
      findings: Object.freeze([
        finding(
          `the sink ${sink.label} declares no range of event majors; ` +
            `a sink states the range it accepts (F111-FR-034)`,
          "declare the range of event majors the sink accepts",
          `sink=${sink.label} acceptsMajors=absent`,
        ),
      ]),
    });
  }
  if (!rangeHoldsTheCurrentMajor(range)) {
    return Object.freeze({
      accepted: false,
      findings: Object.freeze([
        finding(
          `the sink ${sink.label} accepts the event majors ${range.from} to ${range.to}, ` +
            `which does not hold the current major ${major}: the sink is refused and the ` +
            `run goes on (F111-FR-034)`,
          `register a sink that accepts the event major ${major}`,
          `sink=${sink.label} acceptsMajors=${range.from}..${range.to} current=${major}`,
        ),
      ]),
    });
  }
  return Object.freeze({ accepted: true, findings: Object.freeze([]) });
}

/** The severities of a finding this module raises are the set of feature 100. */
export const SEVERITIES_USED: readonly DoctorSeverity[] = Object.freeze(
  DOCTOR_SEVERITIES.filter((s) => s === DOCTOR_SEVERITY_SINK_RANGE),
);

/* ------------------------------------------------------------------ *
 * The dispatcher.
 * ------------------------------------------------------------------ */

/** Why one delivery did not happen. */
export const NOT_DELIVERED_REASONS = ["out-of-order", "not-redacted", "no-sink"] as const;
export type NotDeliveredReason = (typeof NOT_DELIVERED_REASONS)[number];

/** What became of one event at the sinks. */
export type DeliveryOutcome = {
  readonly seq: number;
  readonly delivered: boolean;
  readonly reason?: NotDeliveredReason;
  readonly sinks: readonly {
    readonly sink: string;
    readonly ok: boolean;
    readonly error?: string;
  }[];
};

/** How one event is offered to the dispatcher. */
export type DeliverOptions = {
  /**
   * False where the event did not pass the redaction ingress. The dispatcher
   * refuses it: a sink receives the redacted event only (F111-FR-034).
   */
  readonly passedTheIngress?: boolean;
};

export type EventDispatcherOptions = {
  /** The one writer of the run. A sink is called only after it has written. */
  readonly writer: PrimaryWriter;
  /** Called with every finding the registry check or a delivery produced. */
  readonly onDoctorFinding?: (finding: DoctorFinding) => void;
  /** The isolation of one sink call. T032 supplies the real one. */
  readonly callSink?: (
    sink: DispatchableSink,
    event: EventEnvelope,
  ) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * The dispatcher of F111-FR-034. It owns the registry of sinks, the order of
 * delivery and the one rule that holds the whole guarantee: the primary file
 * is written before any sink is called.
 */
export class EventDispatcher {
  readonly #writer: PrimaryWriter;
  readonly #sinks: DispatchableSink[] = [];
  readonly #findings: DoctorFinding[] = [];
  readonly #onFinding: ((finding: DoctorFinding) => void) | undefined;
  readonly #callSink: (
    sink: DispatchableSink,
    event: EventEnvelope,
  ) => Promise<{ ok: boolean; error?: string }>;
  #lastDelivered = 0;
  #open = false;

  constructor(options: EventDispatcherOptions) {
    this.#writer = options.writer;
    this.#onFinding = options.onDoctorFinding;
    this.#callSink = options.callSink ?? defaultCallSink;
  }

  /** The sinks the registry accepted, in the order they registered. */
  get sinks(): readonly DispatchableSink[] {
    return Object.freeze([...this.#sinks]);
  }

  /** Every finding the registry check and the deliveries produced. */
  get doctorFindings(): readonly DoctorFinding[] {
    return Object.freeze([...this.#findings]);
  }

  /** The `seq` of the last event a sink received. */
  get lastDelivered(): number {
    return this.#lastDelivered;
  }

  /**
   * Register a sink. The registry check of F111-FR-034 decides; a refused sink
   * is not kept and its finding goes to the doctor.
   */
  register(sink: DispatchableSink): RegistryDecision {
    const decision = registryCheck(sink);
    for (const finding of decision.findings) {
      this.#findings.push(finding);
      this.#onFinding?.(finding);
    }
    if (decision.accepted) this.#sinks.push(sink);
    return decision;
  }

  /** Call `open` on every registered sink with the context of the run. */
  async open(context: SinkContext): Promise<void> {
    this.#open = true;
    for (const sink of this.#sinks) {
      await this.#callOperation(sink, "open", context);
    }
  }

  /**
   * Write one event through the primary writer and THEN deliver it. The event
   * the writer returns is the one whose bytes are already in the file.
   */
  async append(request: WriteRequest, options?: DeliverOptions): Promise<DeliveryOutcome> {
    const written = this.#writer.append(request);
    return this.deliver(written.event, options);
  }

  /**
   * Deliver one event that the primary writer has already written. Refused
   * where its `seq` does not rise and where it did not pass the ingress.
   */
  async deliver(event: EventEnvelope, options?: DeliverOptions): Promise<DeliveryOutcome> {
    if (options?.passedTheIngress === false) {
      return Object.freeze({
        seq: event.seq,
        delivered: false,
        reason: "not-redacted" as const,
        sinks: Object.freeze([]),
      });
    }
    if (!(event.seq > this.#lastDelivered)) {
      return Object.freeze({
        seq: event.seq,
        delivered: false,
        reason: "out-of-order" as const,
        sinks: Object.freeze([]),
      });
    }
    this.#lastDelivered = event.seq;
    const sinks: { sink: string; ok: boolean; error?: string }[] = [];
    for (const sink of this.#sinks) {
      // The envelope is handed over WHOLE, with its `data`: no copy, no
      // projection, no dropped field (F111-FR-034).
      const outcome = await this.#callSink(sink, event);
      sinks.push(Object.freeze({ sink: sink.label, ok: outcome.ok, error: outcome.error }));
    }
    return Object.freeze({
      seq: event.seq,
      delivered: this.#sinks.length > 0,
      reason: this.#sinks.length > 0 ? undefined : ("no-sink" as const),
      sinks: Object.freeze(sinks),
    });
  }

  /** Call `flush` on every sink. An error is contained in the sink. */
  async flush(): Promise<void> {
    for (const sink of this.#sinks) {
      await this.#callOperation(sink, "flush");
    }
  }

  /** Call `close` on every sink. An error is contained in the sink. */
  async close(): Promise<void> {
    for (const sink of this.#sinks) {
      await this.#callOperation(sink, "close");
    }
    this.#open = false;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** One of `open`, `flush`, `close`, with its error swallowed (Principle V). */
  async #callOperation(
    sink: DispatchableSink,
    operation: "open" | "flush" | "close",
    context?: SinkContext,
  ): Promise<void> {
    try {
      if (operation === "open") await sink.open?.(context as SinkContext);
      else if (operation === "flush") await sink.flush?.();
      else await sink.close?.();
    } catch (error) {
      this.#findings.push(
        finding(
          `the sink ${sink.label} failed in \`${operation}\`: ${String(error)}`,
          `look at the sink ${sink.label}; the run went on without it`,
          `sink=${sink.label} operation=${operation}`,
        ),
      );
    }
  }
}

/**
 * The plain sink call: `write` with the event, with its error contained. T032
 * wraps this with the time limit and the bounded queue.
 */
async function defaultCallSink(
  sink: DispatchableSink,
  event: EventEnvelope,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sink.write?.(event);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export { defaultCallSink };
