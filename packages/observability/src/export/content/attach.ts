/**
 * T063 — the content attachment through the accessor (F128-FR-037; CT-128-18).
 *
 * F128-FR-037: *The exporter MUST attach content to a span only after the
 * content passed the redaction point of feature 100, and only through the
 * content accessor that the core gives a sink. It MUST NOT read a file of the
 * control plane and MUST NOT redact by itself. Content that the redaction
 * point refuses MUST be replaced by its reference (path, hash, size), and the
 * refusal MUST be a delivery record with the status `attempted` and the reason
 * `content_withheld`, with the number of items withheld as the event count.*
 *
 * THREE THINGS THIS MODULE DOES NOT DO, and one thing it does:
 *  - it does not open a file: the only way in is the `byReference` of the
 *    accessor the context of `open` handed the sink, and the accessor (the
 *    core's) is the only reader;
 *  - it does not redact: it imports no ingress and no redactor; the text it
 *    returns is the text the accessor returned, already redacted;
 *  - it does not guess: when the accessor answers nothing — capture off, a
 *    refusal of the redaction point, a redactor that cannot run — the side
 *    becomes the reference, path, hash and whole size, and the withheld count
 *    rises by one;
 *  - it does build the record that says so: one record per flush that
 *    withheld, status `attempted`, reason `content_withheld`, the number of
 *    withheld items as the event count.
 */
import type { ContentAccessor, ContentReference } from "@specstride/contracts/ep/event-sink";
import type { SpanContent } from "../spans/attributes.ts";
import { REASON_CONTENT_WITHHELD } from "../delivery/reasons.ts";

/** F128-FR-037 — content reaches a span only through the accessor. */
export const CONTENT_ONLY_THROUGH_THE_ACCESSOR = true as const;

/** F128-FR-037 — the exporter opens no file of the control plane. */
export const EXPORTER_READS_NO_CONTROL_PLANE_FILE = true as const;

/** F128-FR-037 — the exporter redacts nothing itself (one redaction point). */
export const EXPORTER_REDACTS_NOTHING_ITSELF = true as const;

/** The status of the record a refusal produces (F128-FR-037). */
export const CONTENT_WITHHELD_STATUS = "attempted" as const;

/** The reason of the record a refusal produces (F128-FR-037). */
export const CONTENT_WITHHELD_REASON = REASON_CONTENT_WITHHELD;

/** The fields of the `telemetry.delivery` record a refusal produces. */
export type ContentWithheldRecord = {
  readonly status: typeof CONTENT_WITHHELD_STATUS;
  readonly reason: typeof CONTENT_WITHHELD_REASON;
  /** The number of items withheld (F128-FR-037). */
  readonly eventCount: number;
};

/** The record of one refusal: `attempted`, `content_withheld`, the count. */
export function contentWithheldRecordOf(withheld: number): ContentWithheldRecord {
  return Object.freeze({
    status: CONTENT_WITHHELD_STATUS,
    reason: CONTENT_WITHHELD_REASON,
    eventCount: withheld,
  });
}

/** One side of content as a span takes it: the text, or only the reference. */
export type AttachedSide = SpanContent;

/** What one attachment produced: the two sides, and how many were withheld. */
export type ContentAttachment = {
  readonly prompt: AttachedSide | null;
  readonly reply: AttachedSide | null;
  /** How many sides the accessor did not answer with a text. */
  readonly withheld: number;
};

/** The references of one attachment: the prompt and the reply. */
export type ContentReferences = {
  readonly prompt?: ContentReference | null;
  readonly reply?: ContentReference | null;
};

/** The paths the references take on the span attributes (F128-FR-038). */
export type ReferenceFields = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

/** A reference as the span attributes name it: path, hash, whole size. */
export function referenceFieldsOf(reference: ContentReference): ReferenceFields {
  return Object.freeze({
    path: reference.logicalName,
    sha256: reference.hash,
    bytes: reference.size,
  });
}

/**
 * Attach the content of a prompt and a reply to a span, THROUGH THE ACCESSOR
 * and through nothing else (F128-FR-037). A side whose reference the accessor
 * answers with a string travels as the (already redacted) text; a side the
 * accessor answers with nothing travels as its reference, and counts as
 * withheld for the `content_withheld` record.
 *
 * This function is async only because the accessor's is; it awaits nothing
 * else and touches no file system.
 */
export async function attachContentThroughTheAccessor(
  accessor: ContentAccessor,
  references: ContentReferences,
): Promise<ContentAttachment> {
  let withheld = 0;

  const side = async (
    reference: ContentReference | null | undefined,
  ): Promise<AttachedSide | null> => {
    if (!reference) return null;
    const text = await accessor.byReference(reference);
    if (typeof text !== "string") {
      withheld += 1;
      return Object.freeze(referenceFieldsOf(reference));
    }
    return Object.freeze({ text });
  };

  const prompt = await side(references.prompt);
  const reply = await side(references.reply);
  return Object.freeze({ prompt, reply, withheld });
}
