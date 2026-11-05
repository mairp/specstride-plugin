/**
 * T112 — the interface types of EP-08, the event sink, from
 * `contracts/extension-points/EP-08.event-sink.json` and annex C, §C.10
 * (F100-FR-104 to F100-FR-106).
 *
 * `specstride.event-sink/1`. A sink delivers events to a destination other
 * than the primary event file. Local first: the primary file is written
 * before any sink is called and is authoritative.
 */
import type { EventEnvelope } from "../envelope/event.ts";

export const POINT_ID = "specstride.event-sink/1" as const;
export const EP = "EP-08" as const;
export const ANNEX_SECTION = "annex C, §C.10" as const;

/** F100-FR-104 — the five operations of a sink. */
export const OPERATIONS = ["open", "write", "flush", "close", "status"] as const;
export type EventSinkOperation = (typeof OPERATIONS)[number];

/** The four as-is labels the context of `open` holds (§C.10, Inputs). */
export const AS_IS_LABELS = ["job", "service.name", "task", "backend"] as const;

/** A reference to content: logical name, hash and size; never content. */
export type ContentReference = {
  readonly logicalName: string;
  readonly hash: string;
  readonly size: number;
};

/**
 * The content accessor of the context: it returns content by reference,
 * redacted, and returns nothing while capture is off. It serves the
 * compatibility projection with its own as-is snippets whatever the switch of
 * content capture says.
 */
export type ContentAccessor = {
  byReference(reference: ContentReference): Promise<string | undefined>;
  asIsSnippetForTheCompatibilityProjection(
    reference: ContentReference,
  ): Promise<string | undefined>;
};

/** F100-FR-104 — the context of `open`, with everything §C.10 lists. */
export type SinkContext = {
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId: string;
  readonly feature: string;
  readonly workspaceId: string;
  /** The four as-is labels the as-is form of a payload needs. */
  readonly labels: Readonly<Record<(typeof AS_IS_LABELS)[number], string>>;
  readonly profile: string;
  /** The resolved switches that concern sinks. */
  readonly switches: Readonly<Record<string, unknown>>;
  readonly content: ContentAccessor;
  /** Read access to the table of the compatibility projection. */
  readonly compatibilityProjection: { asIsNameOf(eventType: string): string | null };
};

/** The range of event schema majors a sink declares it accepts (§C.10, Inputs). */
export type MajorRange = { readonly from: number; readonly to: number };

/** The delivery status `status` returns, as one line and as a record. */
export type DeliveryStatus = {
  readonly line: string;
  readonly record: {
    readonly sinkLabel: string;
    readonly receiverState: string;
    readonly lastDeliveryStatus: string;
    readonly reason: string | null;
  };
};

/** F100-FR-104 — an event sink. */
export type EventSink = {
  readonly label: string;
  readonly acceptsMajors: MajorRange;
  open(context: SinkContext): Promise<void>;
  /** One event, in the order of `seq`, already written to the primary file and redacted. */
  write(event: EventEnvelope): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  status(): DeliveryStatus;
};

/** "Errors" of §C.10: every error is contained in the sink. */
export const ERROR_IS_CONTAINED_IN_THE_SINK = true as const;
/** The writer records this event and goes on. */
export const EVENT_THE_WRITER_RECORDS = "telemetry.delivery" as const;

/** "Guarantees of the core" of §C.10, as data. */
export const CORE_GUARANTEES = [
  "the primary file is written before any sink is called, and it is authoritative",
  "the primary file writer is part of the core and is not replaceable",
  "events reach a sink already redacted",
  "the event file holds references to content and never content",
  "content reaches a sink only through the redaction point and only while content capture is on",
] as const;

/**
 * "Failure of an implementation" of §C.10 — the plainer path the degradation
 * of F100-FR-019 takes for this point: a slow, failing or dead sink is
 * skipped for the event, its failure is recorded, and the outcome of the run
 * and the primary event file are unchanged.
 */
export const FAILURE_PATH =
  "A slow, failing or dead sink is skipped for the event, its failure is recorded, and the outcome of the run and the primary event file are unchanged." as const;

export const FAILURE_PATHS: Readonly<Record<EventSinkOperation, string>> = Object.freeze({
  open: FAILURE_PATH,
  write: FAILURE_PATH,
  flush: FAILURE_PATH,
  close: FAILURE_PATH,
  status: FAILURE_PATH,
});

/**
 * "Unknown-value rule" of §C.10: a sink ignores fields and event types it does
 * not know. Event types that start with `x.` belong to third parties; they
 * are never projected and never change the read model.
 */
export const THIRD_PARTY_PREFIX = "x." as const;
export function isNeverProjected(eventType: string): boolean {
  return eventType.startsWith(THIRD_PARTY_PREFIX);
}

/** F100-FR-105 — the compatibility projection is a sink of its own. */
export const COMPATIBILITY_PROJECTION_SWITCH = "compat.legacyEvents" as const;
export const COMPATIBILITY_PROJECTION_WRITES_THE_PRIMARY_STREAM = false as const;

/** F100-FR-106 — captured content always passes the single redaction point. */
export const CAPTURED_CONTENT_PASSES_THE_REDACTOR = true as const;
/** Content is dropped, with a mark that says so, when the redactor cannot run. */
export const MARK_WHEN_THE_REDACTOR_CANNOT_RUN = "content-dropped-redactor-unavailable" as const;
