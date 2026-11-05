/**
 * T013 — starting the reader of a resolved row (F126-FR-001, F126-FR-007,
 * F126-FR-009).
 *
 * The row is data: a code reader (the constructor the row names) or a mapping
 * (read by the generic mapping reader, no code). The reader that starts is
 * wrapped where the row asks for it (F126-FR-009). A row whose reader cannot
 * start resolves to null, which is the route fallback of F126-FR-014 — never
 * a fault of the pass.
 */
import type { StreamReader } from "./claude-reader.ts";
import { ClaudeStreamReader } from "./claude-reader.ts";
import { MappingReader, type StreamMapping } from "./mapping-reader.ts";
import { SseFramingReader } from "./sse-reader.ts";
import type { ResolvedRow } from "./registry.ts";
import { TextStreamReader } from "./text-reader.ts";
import { maybeWrap, type WrapperOptions } from "./wrapper.ts";

/** The reader of the `claude` row, for the replay tests and the tap. */
export function newClaudeReader(): ClaudeStreamReader {
  return new ClaudeStreamReader();
}

/** The reader of the `text` row. */
export function newTextReader(): TextStreamReader {
  return new TextStreamReader();
}

/** A mapping reader straight from descriptor data (F126-FR-007). */
export function newMappingReader(mapping: StreamMapping): MappingReader {
  return new MappingReader(mapping);
}

/**
 * Start the reader a resolved row names, wrapped where the row asks for it.
 * Null where the row's reader cannot start (the JSONL reader of `prime-v3`
 * is feature 138's and is not present yet).
 */
export function startRowReader(
  row: ResolvedRow,
  options: WrapperOptions = {},
): StreamReader | null {
  const reader = row.reader;
  if (reader.type === "mapping") {
    const mapping: StreamMapping = {
      selector: reader.selector,
      fields: reader.fields,
      usage: reader.usage,
      tolerate: reader.tolerate,
      dialect: reader.dialect,
    };
    // The server-sent-event framing is the only code over a data mapping
    // (F126-FR-040); without it one line is one JSON document.
    if (reader.framing === "sse") {
      return maybeWrap(row, new SseFramingReader(mapping), options);
    }
    return maybeWrap(row, new MappingReader(mapping), options);
  }
  const instance = reader.start();
  if (instance instanceof ClaudeStreamReader || instance instanceof TextStreamReader) {
    return maybeWrap(row, instance, options);
  }
  return null;
}
