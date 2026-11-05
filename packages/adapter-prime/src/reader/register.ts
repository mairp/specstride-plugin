/**
 * The registration of the JSONL reader with the stream-format registry
 * (T038; covers F138-FR-037 and annex C §C.5).
 *
 * The reader is registered under the format name `jsonl` — one line, one
 * record — never under a harness name: the registry already holds a row per
 * harness family, and re-registering one is refused. What the reader is for
 * a given harness is decided by the dialect row of the stream, read as data;
 * the projection of the as-is events onto the six normalized kinds is a
 * table, also read as data.
 */
import {
  StreamFormatRegistry,
  type StreamFormatRow,
} from "../../../harness/src/stream/registry.ts";
import { dialectRowFor, dialectNames, loadDialectRow } from "./dialect.ts";
import { PrimeStreamReader, type AsIsEvent } from "./reader.ts";
import { isNormalizedKind, type NormalizedKind } from "./records.ts";

/** The registry format name the reader is listed under (annex C §C.5). */
export const READER_FORMAT_NAME = "jsonl";

/** The projection of the as-is events onto the normalized kinds, as data. */
export const EVENT_PROJECTION: Readonly<Record<string, NormalizedKind>> = Object.freeze({
  agent_init: "init",
  agent_text: "text",
  agent_tool: "tool",
  evidence_writing: "tool",
  agent_diagnostic: "error",
  usage: "usage",
  terminal: "terminal",
});

/** The kind one as-is event projects to; an unknown name is refused. */
export function projectedKind(event: AsIsEvent): NormalizedKind {
  const kind = EVENT_PROJECTION[event.name];
  if (kind === undefined || !isNormalizedKind(kind)) {
    throw new Error(`no normalized kind is named for the event '${event.name}'`);
  }
  return kind;
}

/** The row of the stream format the reader registers itself under. */
export function primeStreamFormatRow(): StreamFormatRow {
  return {
    name: READER_FORMAT_NAME,
    reason:
      "One reader serves the family of harnesses that share stream schema " +
      "version 3; the dialect row of the stream decides the rest, as data",
    reader: {
      type: "code",
      start: () => {
        const row = dialectRowFor(defaultDialect());
        if (row === undefined) {
          throw new Error(
            `no dialect row is held for '${defaultDialect()}' (known: ${dialectNames().join(", ")})`,
          );
        }
        return new PrimeStreamReader({ row });
      },
    },
    terminalDecides: true,
  };
}

/** The dialect the registered reader reads by default. */
function defaultDialect(): string {
  return loadDialectRow(dialectNames()[0] ?? "").dialect;
}

/**
 * Register the reader with a registry (F138-FR-037). A second registration
 * of the same format name is refused by the registry itself; the reader
 * never re-registers a harness's own row.
 */
export function registerPrimeReader(registry: StreamFormatRegistry): void {
  registry.register(primeStreamFormatRow());
}
