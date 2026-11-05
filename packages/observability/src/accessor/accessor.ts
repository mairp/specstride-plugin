/**
 * T046 — the content accessor (F111-FR-032).
 *
 * F111-FR-032: *Prompt and reply content for telemetry MUST be captured whenever
 * traces are on, and the consumer MUST be able to switch it off. The primary
 * event file MUST still hold references and no content. Content MUST reach a sink
 * only through the content accessor that the core gives the sink at `open`, which
 * reads by reference, redacts, and returns nothing when the redactor cannot run; a
 * text that the point cannot treat MUST NOT be delivered and its reference MUST be
 * delivered in its place. The compatibility projection MUST get the sanitised
 * snippets that the old vocabulary shows (`text`, targets, summaries, result
 * summaries, diagnostic messages) through the same accessor, only for its own
 * files.*
 *
 * CONTENT FOLLOWS TRACES, AND THE CONSUMER MAY STILL SAY NO (ruling 43). Capture
 * is on when traces are on AND the consumer has not switched content off. The
 * asymmetry is deliberate: traces off means no content whatever the switch says,
 * because the switch can only ever subtract. `captureIsOn` is a pure function of
 * those two inputs, so a reader can see the whole rule in one line.
 *
 * NOTHING IS THE ANSWER ON EVERY FAILURE. `byReference` returns `undefined` when
 * capture is off, when the reference names nothing, and when the redactor cannot
 * run. One return value for three different reasons is not vagueness: a sink has
 * exactly one thing it may do with any of them, which is to use the reference
 * instead, and giving it three shapes to distinguish would invite it to treat one
 * of them as recoverable. `drops()` records the ones that WERE content, with the
 * mark, for the record that says so.
 *
 * THE RETURN IS THE REDACTED TEXT AND NEVER THE RAW ONE. The accessor reads
 * through the caller's store and then puts the result through THE INGRESS — not
 * through a redactor of its own. There is one point of redaction, and this module
 * is a caller of it like any other (F111-FR-023).
 *
 * THE PROJECTION'S SNIPPET IS NOT THE SINK'S CONTENT. The compatibility
 * projection gets its sanitised snippet whatever the switch of content capture
 * says (CQ-032, closed by the owner), because the old vocabulary's lines ARE the
 * projection's files and switching them off would change the as-is output rather
 * than protect anything. It is still the same accessor and the same ingress, so
 * the snippet is redacted exactly as a sink's content would have been.
 */
import type { ContentAccessor, ContentReference } from "@specstride/contracts/ep/event-sink";
import type { DropMark } from "@specstride/kernel";
import { Ingress } from "../ingress/ingress.ts";

/** F111-FR-032 — content is captured whenever traces are on (ruling 43). */
export const CONTENT_FOLLOWS_TRACES = true as const;

/** F111-FR-032 — the primary event file holds references and no content. */
export const PRIMARY_FILE_HOLDS_REFERENCES_AND_NO_CONTENT = true as const;

/** The switch the consumer turns (row 16 of annex X §X.7). */
export const CONTENT_SWITCH = "telemetry.content" as const;

/** The classes the old vocabulary's snippets arrive under (F111-FR-032). */
export const PROJECTION_SNIPPETS = [
  "text",
  "targets",
  "summaries",
  "result summaries",
  "diagnostic messages",
] as const;

/** What decides whether content is captured. */
export type CaptureSwitches = {
  /** Whether traces are on. */
  readonly tracesAreOn: boolean;
  /** The consumer's switch. Absent or true: on. False: off. */
  readonly contentCapture?: boolean | undefined;
};

/**
 * Capture is on when traces are on and the consumer has not switched content
 * off. Traces off is final: the switch can only ever subtract.
 */
export function captureIsOn(switches: CaptureSwitches): boolean {
  if (!switches.tracesAreOn) return false;
  return switches.contentCapture !== false;
}

/** One text that was not delivered, with the mark that says why. */
export type ContentDrop = {
  readonly logicalName: string;
  readonly mark: DropMark;
  /** The reference that was delivered in its place. */
  readonly reference: ContentReference;
};

/** How the accessor reaches the raw text of a reference. */
export type ReferenceReader = (
  reference: ContentReference,
) => string | undefined | Promise<string | undefined>;

/** What `createContentAccessor` is given. */
export type ContentAccessorOptions = CaptureSwitches & {
  /** Read the raw text of a reference, from wherever the runtime kept it. */
  readonly read: ReferenceReader;
  /** THE ingress. One point of redaction (F111-FR-023). */
  readonly ingress: Ingress;
  /** The class a prompt or a reply enters under. Default: `stream-text`. */
  readonly ingressClass?: string;
  /** The class the projection's snippets enter under. Default: `free-text`. */
  readonly snippetClass?: string;
};

/** The accessor the core gives a sink at `open`, with what this feature adds. */
export type SpecstrideContentAccessor = ContentAccessor & {
  /** Whether content is captured at all. */
  readonly captureIsOn: boolean;
  /** The reference to deliver where the content was not (F111-FR-024). */
  referenceInstead(reference: ContentReference): ContentReference;
  /** The texts that were not delivered, with their marks. */
  drops(): readonly ContentDrop[];
};

/**
 * The content accessor. It reads by reference, redacts through the ingress, and
 * returns nothing where capture is off or the redactor cannot run.
 */
export function createContentAccessor(options: ContentAccessorOptions): SpecstrideContentAccessor {
  const on = captureIsOn(options);
  const ingressClass = options.ingressClass ?? "stream-text";
  const snippetClass = options.snippetClass ?? "free-text";
  const drops: ContentDrop[] = [];

  async function through(reference: ContentReference, klass: string): Promise<string | undefined> {
    let raw: string | undefined;
    try {
      raw = await options.read(reference);
    } catch {
      return undefined;
    }
    if (typeof raw !== "string") return undefined;
    const result = options.ingress.text(raw, klass, reference);
    if (!result.ok) {
      // A text the point cannot treat is NOT delivered; its reference is.
      drops.push(
        Object.freeze({ logicalName: reference.logicalName, mark: result.mark, reference }),
      );
      return undefined;
    }
    return result.text;
  }

  return Object.freeze({
    captureIsOn: on,

    byReference(reference: ContentReference): Promise<string | undefined> {
      if (!on) return Promise.resolve(undefined);
      return through(reference, ingressClass);
    },

    asIsSnippetForTheCompatibilityProjection(
      reference: ContentReference,
    ): Promise<string | undefined> {
      // Whatever the switch of content capture says (CQ-032), and only for the
      // projection's own files.
      return through(reference, snippetClass);
    },

    referenceInstead(reference: ContentReference): ContentReference {
      return reference;
    },

    drops(): readonly ContentDrop[] {
      return Object.freeze([...drops]);
    },
  });
}
