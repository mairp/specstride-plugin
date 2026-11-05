/**
 * T044 — the server-sent-event framing reader (F126-FR-040).
 *
 * The framing is the only code: the seam reads the stream line by line,
 * gathers the `event:` and `data:` fields of one event up to a blank line,
 * joins several `data:` lines of one event with a line end, and ignores a
 * comment line (one that starts with `:`, such as a keep-alive) and a field
 * it does not know (`id:`, `retry:`). It hands the data of each event, with
 * its event name, to the mapping of the row as one document. Only this
 * framing is parsed (F126-FR-018): the stream is untrusted text.
 *
 * A data field that is not JSON gives a diagnostic `malformed_json` and sets
 * the malformed-stream flag (F126-FR-016), except the literal `[DONE]`. The
 * literal `ping` event (a keep-alive of either provider) gives no record. The
 * fragments of text of one content block are joined and handed on as one
 * `text` record when the block ends: a document whose text path resolves to
 * nothing closes the open block, and so does the end of the stream.
 */
import { diagnosticOf } from "./closed-sets.ts";
import type { StreamReader } from "./claude-reader.ts";
import { readThroughMapping, resolvePath, type StreamMapping } from "./mapping-reader.ts";
import type { NormalizedRecord } from "./records.ts";

/** The literal that ends an OpenAI stream (F126-FR-040). */
export const SSE_DONE = "[DONE]" as const;

/**
 * True where the line is one the framing gathers: `event:`, `data:` and the
 * fields it does not know. A comment line (it starts with `:`) is not one.
 */
function fieldOf(line: string, name: string): string | null {
  if (!line.startsWith(name + ":")) return null;
  let value = line.slice(name.length + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  return value;
}

/**
 * The SSE framing reader over the mapping of one data row (F126-FR-040).
 * The mapping is data; this class holds no member of either provider.
 */
export class SseFramingReader implements StreamReader {
  private readonly mapping: StreamMapping;
  private eventName: string | null = null;
  private dataLines: string[] = [];
  private textBlock: string | null = null;
  private done = false;
  /** Set by a data field that is not JSON (F126-FR-016). */
  malformedStream = false;

  constructor(mapping: StreamMapping) {
    this.mapping = mapping;
  }

  /** The path the mapping reads the text fragments from, or null. */
  private get textPath(): string | null {
    return this.mapping.fields?.["text"] ?? this.mapping.fields?.["text.text"] ?? null;
  }

  /** Gather one line of the framing; dispatch on the blank line. */
  push(line: string): readonly NormalizedRecord[] {
    if (this.done) return [];
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.trim().length === 0) return this.dispatch();
    if (clean.startsWith(":")) return []; // a comment line (F126-FR-040)
    const event = fieldOf(clean, "event");
    if (event !== null) {
      this.eventName = event;
      return [];
    }
    const data = fieldOf(clean, "data");
    if (data !== null) {
      this.dataLines.push(data);
      return [];
    }
    return []; // a field the framing does not know: `id:`, `retry:`
  }

  /** The end of the stream: dispatch a last unterminated event, close the block. */
  finish(): readonly NormalizedRecord[] {
    const tail = this.dispatch();
    return [...tail, ...this.flushTextBlock()];
  }

  /** Dispatch one gathered event, or nothing where none was gathered. */
  private dispatch(): readonly NormalizedRecord[] {
    const eventName = this.eventName;
    const data = this.dataLines.join("\n");
    this.eventName = null;
    this.dataLines = [];
    if (this.done || (eventName === null && data.length === 0)) return [];
    if (data === SSE_DONE) {
      // The literal that ends an OpenAI stream: no record (F126-FR-040).
      this.done = true;
      return this.flushTextBlock();
    }
    if (eventName === "ping" && data.trim().length === 0) return [];
    let document: unknown;
    try {
      document = JSON.parse(data);
    } catch {
      // Not JSON: a diagnostic and the malformed-stream flag (F126-FR-016),
      // and no record; the stream is untrusted text (F126-FR-018).
      this.malformedStream = true;
      diagnosticOf("malformed_json", "a server-sent event held data that is not JSON");
      return [];
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      this.malformedStream = true;
      diagnosticOf("malformed_json", "a server-sent event held JSON that is not an object");
      return [];
    }
    return this.handleDocument(document as Readonly<Record<string, unknown>>, eventName);
  }

  /**
   * Hand one event document to the mapping of the row, with its event name
   * (F126-FR-040). The text fragments are joined here: the mapping reader
   * would hand one `text` record per fragment.
   */
  private handleDocument(
    document: Readonly<Record<string, unknown>>,
    eventName: string | null,
  ): readonly NormalizedRecord[] {
    const path = this.textPath;
    const fragment = path !== null ? resolvePath(document, path) : null;
    if (typeof fragment === "string" && fragment.length > 0) {
      this.textBlock = (this.textBlock ?? "") + fragment;
      return [];
    }
    // A document without a text fragment closes the open block (one `text`
    // record per content block) and hands the document on to the mapping.
    const closed = this.flushTextBlock();
    const records = readThroughMapping(withoutTextPaths(this.mapping), document, eventName);
    return [...closed, ...records];
  }

  /** Close an open text block into one `text` record, or return nothing. */
  private flushTextBlock(): readonly NormalizedRecord[] {
    if (this.textBlock === null) return [];
    const text = this.textBlock;
    this.textBlock = null;
    const record: NormalizedRecord = {
      kind: "text",
      text,
      sessionId: null,
      synthesized: false,
    };
    return [record];
  }
}

/** The mapping without its text paths and its selector: the framing gathers
 *  the data of the event as the document, and joins the text itself. */
function withoutTextPaths(mapping: StreamMapping): StreamMapping {
  return {
    ...mapping,
    selector: undefined,
    fields: Object.fromEntries(
      Object.entries(mapping.fields ?? {}).filter(([key]) => key !== "text" && key !== "text.text"),
    ),
  };
}
