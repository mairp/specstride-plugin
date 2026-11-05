/**
 * The framing of the JSONL reader (T032; covers F138-FR-023).
 *
 * The reader parses only the framing of the harness itself: one JSON
 * document per line of the harness's own standard output. The output of a
 * tool is never a stream record — a tool result reaches the reader as a
 * summary already attached to its tool record, never through the line loop.
 * The caps on the size of a line and on the rate of lines are data of the
 * dialect row; a line over the size cap gives a `malformed_json`
 * diagnostic and is dropped. A stream that ends without a terminal record is
 * reported by the reader, never guessed.
 */
import type { DialectRow } from "./dialect.ts";

/** The default cap on the size of one line, in bytes. */
export const DEFAULT_LINE_BYTES = 1048576;

/** The default cap on the rate of lines, in lines a second. */
export const DEFAULT_LINES_PER_SECOND = 5000;

/** The caps of one stream, read from the `limits` of the dialect row. */
export type LineCaps = {
  readonly lineBytes: number;
  readonly linesPerSecond: number;
};

/**
 * The caps of a dialect row, as data: the `limits` record of the row where
 * it names them, else the values of the stream seam.
 */
export function lineCapsOf(row: DialectRow): LineCaps {
  const limits = (row["limits"] ?? row["x-caps"] ?? {}) as Record<string, unknown>;
  const lineBytes =
    typeof limits["lineBytes"] === "number" && limits["lineBytes"] > 0
      ? limits["lineBytes"]
      : DEFAULT_LINE_BYTES;
  const linesPerSecond =
    typeof limits["linesPerSecond"] === "number" && limits["linesPerSecond"] > 0
      ? limits["linesPerSecond"]
      : DEFAULT_LINES_PER_SECOND;
  return { lineBytes, linesPerSecond };
}

/** Why a line was refused by the cap gate. */
export type LineCapVerdict = "admitted" | "line_too_long" | "line_rate_exceeded";

/** The cap gate of the line loop (F138-FR-023). */
export class LineCapGate {
  private readonly caps: LineCaps;
  private readonly stamps: number[] = [];

  constructor(caps: LineCaps) {
    this.caps = caps;
  }

  /** Admit one line at the instant `nowMs`, or name the cap it is over. */
  admit(line: string, nowMs: number): LineCapVerdict {
    if (Buffer.byteLength(line, "utf8") > this.caps.lineBytes) return "line_too_long";
    this.stamps.push(nowMs);
    while (this.stamps.length > 0 && nowMs - this.stamps[0] > 1000) this.stamps.shift();
    if (this.stamps.length > this.caps.linesPerSecond) return "line_rate_exceeded";
    return "admitted";
  }
}

/** The channel a fed line came from; only stdout carries stream records. */
export type LineChannel = "stdout" | "tool-output";

/**
 * The rule that the output of a tool is never a record (F138-FR-023): a line
 * fed from any channel other than the harness's own standard output is
 * refused before it is parsed, so a tool result can never enter the stream
 * state machine, whatever JSON it happens to hold.
 */
export function admitStreamLine(
  line: string,
  channel: LineChannel,
): { admitted: boolean; reason: "tool_output_is_not_a_record" | "ok" } {
  if (channel !== "stdout") return { admitted: false, reason: "tool_output_is_not_a_record" };
  return { admitted: true, reason: "ok" };
}

/** Split a chunk of standard output into its lines, keeping order. */
export function stdoutLines(chunk: string): string[] {
  return chunk.split(/\r?\n/).filter((line, index, all) => {
    // A trailing newline does not make an empty final line.
    return !(line === "" && index === all.length - 1);
  });
}

/** True where a stream ended without a terminal record (F138-FR-023). */
export function streamIsMissingTerminal(terminal: Record<string, unknown> | null): boolean {
  return terminal === null;
}
