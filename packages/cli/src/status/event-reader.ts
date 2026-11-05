/**
 * T024 — the event reader: the ONLY reader of the event file (F129-FR-032).
 *
 * The pure read model takes events as values and opens nothing (F129-FR-001).
 * This module, outside the pure core, is the one place that opens
 * `run:<runId>:events`: it reads from a byte offset, keeps the byte cursor, and
 * reports what it found.
 *
 * - A TORN last line (a last line without its line end, or one that is not a
 *   complete record) is ignored, and the cursor stops BEFORE it (F129-FR-004).
 * - A complete line in the middle that is not a record of the schema is
 *   SKIPPED and counted (F129-FR-004).
 * - A GAP in the sequence of `seq` is recorded with the numbers on both sides.
 * - None of the three changes any other field of the view or fails a command.
 *
 * No renderer and no other command may import this module: a renderer takes a
 * `RunView` and is given no file handle (F129-FR-032).
 */
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { SCHEMA, majorIsSupported } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";

/**
 * A gap in the sequence of `seq`, with the numbers on both sides (F129-FR-004).
 *
 * The record is declared here and not imported from `@specstride/view`: the
 * import-boundary check of feature 100 refuses an import between two packages of
 * layer L6 that the `mayImport` of the graph does not name explicitly, and the
 * entry of `@specstride/cli` carries the prose "every package above"
 * (`packages/contracts/data/package-graph.json`). The record of the view is
 * structurally the same, so the reader's output is the view's input without a
 * conversion. The request to feature 100 is open; see
 * `specs/129-run-view-and-status/contracts/README.md`, "Requests to feature 100".
 */
export type SeqGap = { readonly after: number; readonly before: number };

/** The line end of the event file; one record per line (annex X §X.1). */
export const LINE_END = "\n" as const;

/** What the reader found besides the events (F129-FR-004). */
export type ReaderDiagnostics = {
  readonly tornLastLine: boolean;
  readonly skippedLines: number;
  readonly gaps: readonly SeqGap[];
};

/** The result of one read: the events, the new cursor, and what was found. */
export type ReadResult = {
  readonly events: readonly EventEnvelope[];
  /** The byte offset AFTER the last complete line read. */
  readonly offset: number;
  /** The size of the file in bytes at the moment of the read. */
  readonly bytes: number;
  /** The `seq` of the last complete record read, or the one the caller gave. */
  readonly lastSeq: number;
  readonly diagnostics: ReaderDiagnostics;
  /** The time of the newest event read, or null. */
  readonly newestEventAt: string | null;
};

/** What the caller asks of the reader. */
export type ReadOptions = {
  /** The byte offset to read from; 0 reads the whole file. */
  readonly offset?: number;
  /** The `seq` of the last record the caller already folded, for the gap check. */
  readonly lastSeq?: number;
};

const empty = (offset: number, bytes: number, lastSeq: number): ReadResult =>
  Object.freeze({
    events: Object.freeze([]),
    offset,
    bytes,
    lastSeq,
    diagnostics: Object.freeze({ tornLastLine: false, skippedLines: 0, gaps: Object.freeze([]) }),
    newestEventAt: null,
  });

/** True where the value is a complete record of the event envelope. */
export function isEventRecord(value: unknown): value is EventEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["schema"] !== SCHEMA) return false;
  if (typeof record["v"] !== "number") return false;
  if (typeof record["seq"] !== "number" || !Number.isInteger(record["seq"])) return false;
  if (typeof record["ts"] !== "string") return false;
  if (typeof record["type"] !== "string") return false;
  if (typeof record["runId"] !== "string") return false;
  return true;
}

/** The size of the event file in bytes, or null where it cannot be read. */
export function eventFileBytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * Read the event file from `offset`. The file is read as bytes and split on the
 * line end, so that a cursor is always a byte offset and never a line count.
 */
export function readEvents(path: string, options: ReadOptions = {}): ReadResult {
  const from = Math.max(0, options.offset ?? 0);
  let handle: number;
  try {
    handle = openSync(path, "r");
  } catch {
    return empty(from, 0, options.lastSeq ?? 0);
  }
  let text: string;
  let size: number;
  try {
    size = fstatSync(handle).size;
    if (size <= from) return empty(Math.min(from, size), size, options.lastSeq ?? 0);
    const length = size - from;
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(handle, buffer, 0, length, from);
    text = buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(handle);
  }

  const events: EventEnvelope[] = [];
  const gaps: SeqGap[] = [];
  let skippedLines = 0;
  let tornLastLine = false;
  let lastSeq = options.lastSeq ?? 0;
  let newestEventAt: string | null = null;
  let consumed = 0;

  const endsWithLineEnd = text.endsWith(LINE_END);
  const lines = text.split(LINE_END);
  // `split` leaves an empty final element where the text ends with the line end.
  const lastIndex = lines.length - 1;

  for (const [index, line] of lines.entries()) {
    const isTail = index === lastIndex;
    if (isTail && !endsWithLineEnd) {
      // A last line without its line end: torn. The cursor stops BEFORE it.
      if (line !== "") tornLastLine = true;
      break;
    }
    if (isTail && endsWithLineEnd && line === "") break;
    const lineBytes = Buffer.byteLength(line, "utf8") + LINE_END.length;
    if (line.trim() === "") {
      consumed += lineBytes;
      continue;
    }
    let parsed: unknown;
    let parsedOk = true;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsedOk = false;
    }
    if (!parsedOk || !isEventRecord(parsed)) {
      // A COMPLETE line in the middle that is not a record: skipped and counted.
      skippedLines += 1;
      consumed += lineBytes;
      continue;
    }
    const event = parsed;
    if (lastSeq > 0 && event.seq > lastSeq + 1) gaps.push({ after: lastSeq, before: event.seq });
    lastSeq = Math.max(lastSeq, event.seq);
    if (majorIsSupported(event.v)) newestEventAt = event.ts;
    events.push(event);
    consumed += lineBytes;
  }

  return Object.freeze({
    events: Object.freeze(events),
    offset: from + consumed,
    bytes: size,
    lastSeq,
    diagnostics: Object.freeze({ tornLastLine, skippedLines, gaps: Object.freeze(gaps) }),
    newestEventAt,
  });
}
