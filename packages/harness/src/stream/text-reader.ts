/**
 * T013 — the reader of a plain text stream (F126-FR-008).
 *
 * Every non-empty line is one text record. The reader itself only marks what
 * it saw; the synthesized `init` and `terminal` of a text stream are made up
 * by the wrapper of the seam (F126-FR-008, F126-FR-009), which is what makes
 * them marked as synthesized and idempotent. This file holds the inner
 * reader, the synthesized records, and the marking the tests observe.
 */
import { makeInitRecord, makeTerminalRecord, type NormalizedRecord } from "./records.ts";
import type { StreamReader } from "./claude-reader.ts";

/** A text line is one text record; an empty line is nothing. */
export class TextStreamReader implements StreamReader {
  push(line: string): readonly NormalizedRecord[] {
    const text = line.replace(/\n$/, "");
    if (text.trim().length === 0) return [];
    return [{ kind: "text", text, sessionId: null, synthesized: false }];
  }

  finish(): readonly NormalizedRecord[] {
    return [];
  }
}

/**
 * The synthesized `init` of a text stream (F126-FR-008): the model of the
 * invocation where one is known, else null; the tool list is null. It is
 * marked synthesized.
 */
export function synthesizedInit(invocationModel: string | null): NormalizedRecord {
  return { ...makeInitRecord({ model: invocationModel ?? null, tools: null }), synthesized: true };
}

/**
 * The synthesized `terminal` of a stream that ended without one
 * (F126-FR-008): the stop reason is `missing_terminal`, every metric is
 * null, and the record is marked synthesized. A stream without a terminal
 * never decides a call (F126-FR-010) — the tap only reports it.
 */
export function synthesizedMissingTerminal(): NormalizedRecord {
  return {
    ...makeTerminalRecord({
      status: "error",
      stopReason: "missing_terminal",
      reasonCode: "missing_terminal",
      reason: "Provider stream ended without a terminal result",
    }),
    synthesized: true,
  };
}
