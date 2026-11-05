/**
 * T010 — `seq` continuation and the reader that tolerates a torn line
 * (F111-FR-018).
 *
 * *`seq` MUST rise by one, without gaps, from 1 for each run. A writer that
 * starts MUST read the last complete line of the file and continue after it,
 * whatever writer wrote it. Each event MUST be one line with a final line end,
 * written in one append. A reader MUST tolerate a torn last line. A writer that
 * finds a last line without a line end MUST begin its first event on a new
 * line.*
 *
 * The module is the READ side of the primary file and nothing else: it opens no
 * lock and appends nothing. `writer.ts` (T008) owns the lock and the append and
 * asks this module two questions at the moment it starts — what number comes
 * next, and does the first event need a line end before it.
 *
 * A COMPLETE LINE is a line that a line end terminates. Bytes after the last
 * line end are a TORN TAIL: a process died in the middle of its one append. The
 * tail is tolerated — it is skipped, it never fails the run (Principle V), and
 * above all its apparent `seq` is NOT counted, because the bytes that carried
 * the number may themselves be half written.
 *
 * The file calls live in this edge package of layer L1, never in a core package
 * (F100-FR-012, CQ-185).
 */
import { readFileSync } from "node:fs";
import { readEventLine, type EventEnvelope } from "@specstride/contracts/envelope/event";

/** `seq` starts at 1 for each run (F111-FR-018). */
export const FIRST_SEQ = 1 as const;

/** One event is one line, terminated by this (F111-FR-018). */
export const LINE_END = "\n" as const;

/** The bytes after the last line end: half of one append. */
export type TornTail = { readonly bytes: number; readonly text: string };

/** What the bytes of the file are, before any of them is parsed. */
export type FileScan = {
  readonly bytes: number;
  /** Every line a line end terminated, in order. */
  readonly completeLines: readonly string[];
  /** The bytes after the last line end, or null where there are none. */
  readonly tornLastLine: TornTail | null;
  readonly endsWithLineEnd: boolean;
};

const EMPTY_SCAN: FileScan = Object.freeze({
  bytes: 0,
  completeLines: Object.freeze([]),
  tornLastLine: null,
  endsWithLineEnd: false,
});

/** Split the text of the file into its complete lines and its torn tail. */
export function scanEventText(text: string): FileScan {
  if (text.length === 0) return EMPTY_SCAN;
  const lastEnd = text.lastIndexOf(LINE_END);
  const head = lastEnd < 0 ? "" : text.slice(0, lastEnd);
  const tail = text.slice(lastEnd + 1);
  const completeLines = head.length === 0 ? [] : head.split(LINE_END);
  return Object.freeze({
    bytes: Buffer.byteLength(text, "utf8"),
    completeLines: Object.freeze(completeLines.filter((line) => line.length > 0)),
    tornLastLine:
      tail.length === 0
        ? null
        : Object.freeze({ bytes: Buffer.byteLength(tail, "utf8"), text: tail }),
    endsWithLineEnd: lastEnd === text.length - 1,
  });
}

/** Scan the file. A file that is not there scans as an empty one, without an error. */
export function scanEventFile(file: string): FileScan {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return EMPTY_SCAN;
  }
  return scanEventText(text);
}

/** Why a line of the file gave no event. */
export type SkippedLine = {
  readonly index: number;
  readonly reason: "torn" | "invalid" | "outside-range";
};

/** What a reader found in the file. */
export type ReadResult = {
  readonly events: readonly EventEnvelope[];
  readonly skipped: readonly SkippedLine[];
  readonly tornLastLine: TornTail | null;
  /** The `seq` of the last complete line, or 0 where the file holds none. */
  readonly lastCompleteSeq: number;
};

/** Read every complete line of the text. The torn tail is skipped, never thrown. */
export function readEventsFromText(text: string): ReadResult {
  const scan = scanEventText(text);
  const events: EventEnvelope[] = [];
  const skipped: SkippedLine[] = [];
  for (const [index, line] of scan.completeLines.entries()) {
    const read = readEventLine(line, false);
    if (read.ok) {
      events.push(read.event);
      continue;
    }
    skipped.push(
      Object.freeze({ index, reason: read.reason === "torn" ? "invalid" : read.reason }),
    );
  }
  if (scan.tornLastLine !== null) {
    skipped.push(Object.freeze({ index: scan.completeLines.length, reason: "torn" as const }));
  }
  return Object.freeze({
    events: Object.freeze(events),
    skipped: Object.freeze(skipped),
    tornLastLine: scan.tornLastLine,
    lastCompleteSeq: lastSeqOf(scan),
  });
}

/** Read the file. A file that is not there reads as an empty one, without an error. */
export function readEvents(file: string): ReadResult {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  return readEventsFromText(text);
}

/**
 * The `seq` of the last complete line, or 0 where there is none. The TORN TAIL
 * is never read for a number: the bytes that would carry it may be half
 * written. A line that carries no number is passed over, so a foreign line in
 * the middle of the file does not reset the run's count.
 */
function lastSeqOf(scan: FileScan): number {
  for (let index = scan.completeLines.length - 1; index >= 0; index -= 1) {
    const line = scan.completeLines[index];
    if (line === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const seq = (parsed as { seq?: unknown }).seq;
    if (typeof seq === "number" && Number.isInteger(seq) && seq > 0) return seq;
  }
  return 0;
}

/** What a writer that starts needs to know about the file it inherits. */
export type Continuation = {
  /** The number of the first event this writer appends. */
  readonly nextSeq: number;
  /** True where the last line has no line end: the first event begins on a new line. */
  readonly beginOnANewLine: boolean;
  readonly tornLastLine: TornTail | null;
};

/** The continuation of a scanned file (F111-FR-018). */
export function continuationOf(scan: FileScan): Continuation {
  return Object.freeze({
    nextSeq: lastSeqOf(scan) + 1,
    beginOnANewLine: scan.tornLastLine !== null,
    tornLastLine: scan.tornLastLine,
  });
}

/** The continuation of the file at this path, whatever writer wrote it. */
export function continuationFor(file: string): Continuation {
  return continuationOf(scanEventFile(file));
}

/** One event as one line, with its final line end (F111-FR-018). */
export function encodeEventLine(event: unknown): string {
  // `JSON.stringify` escapes a line end inside a value, so one event is one line.
  return `${JSON.stringify(event)}${LINE_END}`;
}

/**
 * True where the numbers rise by one from 1, without a gap, a repeat or a fall
 * (F111-FR-018, measured by F111-SC-007). An empty file is intact.
 */
export function seqIsGapless(seqs: readonly number[]): boolean {
  return seqs.every((seq, index) => seq === FIRST_SEQ + index);
}
