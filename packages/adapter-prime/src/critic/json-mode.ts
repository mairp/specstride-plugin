/**
 * The JSON-mode critic (T049; covers F138-FR-020, test CT-138-20 in
 * `tests/characterization/138/critic.test.ts`).
 *
 * Outside the `parity` profile the prime critic runs in JSON mode, so that a
 * provider error is seen in the terminal record and not guessed from text.
 * The reply handed to the verdict parser is the visible text of the TEXT
 * records only — never a display line, a tool argument or thinking. The
 * outcome is that of the terminal record (`../classifier/outcome.ts`); the
 * reason of a failed call is the code of the FIRST diagnostic of severity
 * `error`, or else the reason of the terminal. The model, the provider, the
 * usage and the duration are recorded as the OBSERVATION of the call and
 * MUST NOT change the verdict: the verdict reads the outcome and the reply
 * alone.
 */
import type { ExitStatus } from "../classifier/outcome.ts";
import { decideOutcome, type Outcome } from "../classifier/outcome.ts";
import type { PrimeStreamResult } from "../reader/reader.ts";
import type { NormalizedRecord, TextRecord } from "../reader/records.ts";

/** What the verdict parser receives for one JSON-mode critic call. */
export type CriticVerdict = {
  /** The visible text of the text records, in stream order. */
  readonly reply: string;
  /** The outcome the terminal record and the exit status decided. */
  readonly outcome: Outcome;
};

/** What a JSON-mode critic call records alongside the verdict. */
export type CriticObservation = {
  /** The model the stream stated, or null. */
  readonly model: string | null;
  /** The provider the stream stated, or null. */
  readonly provider: string | null;
  /** The usage totals at the end of the stream. */
  readonly usage: PrimeStreamResult["usage"];
  /** The wall-clock duration of the call, in milliseconds. */
  readonly durationMs: number;
};

/** The full result of one JSON-mode critic call. */
export type CriticJsonResult = {
  readonly verdict: CriticVerdict;
  readonly observation: CriticObservation;
};

/**
 * The visible-text reply (F138-FR-020): only the text of closed TEXT
 * records, in stream order. A display line, a tool argument, a usage record
 * or a diagnostic never reaches the reply.
 */
export function visibleTextReply(records: readonly NormalizedRecord[]): string {
  const parts: string[] = [];
  for (const record of records) {
    if (record.kind !== "text") continue;
    parts.push((record as TextRecord).text);
  }
  return parts.join("\n");
}

/** The codes of the diagnostics of severity `error`, in order. */
export function errorDiagnosticCodes(stream: PrimeStreamResult): string[] {
  return stream.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

/**
 * One JSON-mode critic call: the verdict from the reply and the outcome of
 * the terminal, the observation recorded without a vote (F138-FR-020).
 */
export function criticJsonResult(
  stream: PrimeStreamResult,
  exit: ExitStatus,
  durationMs: number,
): CriticJsonResult {
  const reply = visibleTextReply(stream.records);
  const errorCodes = errorDiagnosticCodes(stream);
  const outcome = decideOutcome(stream, exit, errorCodes);
  const init = stream.records.find((record) => record.kind === "init");
  const model = init && "model" in init ? (init.model ?? null) : null;
  const provider = init && "provider" in init ? (init.provider ?? null) : null;
  return {
    verdict: { reply, outcome },
    observation: {
      model: model as string | null,
      provider: provider as string | null,
      usage: stream.usage,
      durationMs,
    },
  };
}
