/**
 * T042 of feature 101 — the verdict record of a phase attempt (F101-FR-012).
 *
 * For EVERY critic call the engine writes a verdict record: for APPROVED, for
 * REJECTED and for MALFORMED alike, and for a FAILED CALL as well (B-0877). A
 * phase attempt has exactly ONE verdict record; where a critic strategy made
 * several calls, that one record holds the record of every call — also when two
 * calls fall in the same second, which at the baseline made the second
 * transcript overwrite the first (B-0874, defect of the as-is system).
 *
 * The record is `specstride.verdict/1` of `data-model.md` ("Verdict record"),
 * at the logical name `attempt:<N>:<k>:<n>:verdict`. Its field `transcript`
 * carries the AS-IS FORM of B-0876: the heading, the six header lines in their
 * order, the prompt in full and the reply or `(empty)`.
 *
 * A failed write of the verdict record gives a WARNING only, and the result
 * stays a rejection (F101-FR-012). `../gate/writers.ts` already names the
 * verdict record as one of the two records whose failed write is a warning.
 */
import { SCHEMA_ID, LOGICAL_NAME } from "@specstride/contracts/records/verdict-record";
import type { MalformedDetail } from "@specstride/contracts/enums/gate";
import { PARSE_OK, type VerdictResult } from "./verdict-parser.ts";
import { reasonOf } from "./feedback.ts";

export { SCHEMA_ID, LOGICAL_NAME };

/** B-0876 — the heading of the as-is transcript. */
export const TRANSCRIPT_HEADING = "# Specstride critic transcript" as const;

/** B-0876 — the six header lines, in their order, by their label. */
export const TRANSCRIPT_HEADER_LABELS = Object.freeze([
  "phase",
  "attempt",
  "provider",
  "nonce",
  "verdict",
  "parse",
]);

/** B-0876 — the as-is text of a reply that held no bytes. */
export const EMPTY_REPLY_IN_THE_TRANSCRIPT = "(empty)" as const;

/** F101-FR-012 — a failed write of the verdict record is a warning only. */
export const A_FAILED_WRITE_IS_A_WARNING = true as const;

/** F101-FR-012 — and the result stays a rejection. */
export const THE_RESULT_AFTER_A_FAILED_WRITE = "a rejection" as const;

/**
 * F101-FR-012 — a phase attempt has ONE verdict record, whatever the number of
 * calls the strategy made.
 */
export const VERDICT_RECORDS_PER_PHASE_ATTEMPT = 1 as const;

/** The critic of one call, as the record holds it (`data-model.md`). */
export type CriticOfACall = {
  readonly harness: string;
  readonly provider: string;
  readonly model: string;
  readonly form: string;
  readonly proof: Readonly<Record<string, unknown>> | null;
};

/** One call of the strategy, as the record holds it. */
export type CallOfTheStrategy = {
  readonly critic: CriticOfACall;
  readonly sessionId: string;
  readonly nonceHash: string;
  readonly at: string;
  readonly usage: Readonly<Record<string, number>> | null;
  readonly latencyMs: number | null;
  readonly outcome: string;
};

/** The as-is transcript of the record (B-0876). */
export type AsIsTranscript = {
  readonly header: readonly string[];
  readonly prompt: string;
  readonly reply: string;
};

/** The verdict record itself. */
export type VerdictRecordOfAPhaseAttempt = {
  readonly schema: typeof SCHEMA_ID;
  readonly verdictId: string;
  readonly attemptId: string;
  readonly phase: number;
  readonly ordinal: number;
  readonly verdict: VerdictResult;
  /** Present ONLY with MALFORMED (row 251 of annex X §X.6). */
  readonly detail?: MalformedDetail;
  readonly reason?: string;
  readonly calls: readonly CallOfTheStrategy[];
  readonly transcript: AsIsTranscript;
};

/** Everything the engine knows when it writes a verdict record. */
export type VerdictRecordInputs = {
  readonly verdictId: string;
  readonly attemptId: string;
  readonly phase: number;
  readonly ordinal: number;
  readonly verdict: VerdictResult;
  /** The detail of the parse; `ok` where the reply parsed. */
  readonly detail: MalformedDetail | typeof PARSE_OK;
  /** The as-is text of the detail, which the header line carries. */
  readonly detailText: string;
  /** The critic of the role plan, as the header line names it. */
  readonly provider: string;
  /** The nonce of the call. The verdict record MAY hold it in clear. */
  readonly nonce: string;
  readonly prompt: string;
  /** The reply as it was; the empty text becomes `(empty)` in the transcript. */
  readonly reply: string;
  readonly calls: readonly CallOfTheStrategy[];
};

/**
 * B-0876 — the six header lines of the as-is transcript, in their order. The
 * nonce stands in the transcript in clear, which is one of the two places
 * annex E §E.1 allows (`PLACES_THAT_MAY_HOLD_THE_NONCE_IN_CLEAR`), and only
 * AFTER the call has returned (F101-FR-006).
 */
export function transcriptHeader(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly provider: string;
  readonly nonce: string;
  readonly verdict: VerdictResult;
  readonly detailText: string;
}): readonly string[] {
  return Object.freeze([
    `phase: ${inputs.phase}`,
    `attempt: ${inputs.ordinal}`,
    `provider: ${inputs.provider}`,
    `nonce: ${inputs.nonce}`,
    `verdict: ${inputs.verdict}`,
    `parse: ${inputs.detailText}`,
  ]);
}

/** The as-is transcript of one phase attempt (B-0876). */
export function asIsTranscript(inputs: VerdictRecordInputs): AsIsTranscript {
  return Object.freeze({
    header: transcriptHeader(inputs),
    prompt: inputs.prompt,
    reply: inputs.reply.length === 0 ? EMPTY_REPLY_IN_THE_TRANSCRIPT : inputs.reply,
  });
}

/**
 * The as-is transcript as the ONE TEXT the baseline wrote per phase attempt,
 * named `phase<N>.attempt<M>.<time>.txt` under the verdicts directory of the
 * as-is state tree (B-0874; the places of the as-is trees are data, in
 * `packages/contracts/data/layout-old-side.json`, and are named nowhere else).
 * The record above is the form the port keeps; this is the text the
 * compatibility output reproduces, and feature 141's golden capture is the
 * authority for its exact bytes.
 */
export function asIsTranscriptText(transcript: AsIsTranscript): string {
  return [
    TRANSCRIPT_HEADING,
    ...transcript.header,
    "",
    "----- PROMPT -----",
    transcript.prompt,
    "----- REPLY -----",
    transcript.reply,
    "",
  ].join("\n");
}

/**
 * F101-FR-012 — build the verdict record of a phase attempt. `detail` stands
 * in the record ONLY with MALFORMED, and `reason` only where the verdict is no
 * approval.
 */
export function verdictRecord(inputs: VerdictRecordInputs): VerdictRecordOfAPhaseAttempt {
  const isApproval = inputs.verdict === "APPROVED";
  const detail =
    inputs.verdict === "MALFORMED" && inputs.detail !== PARSE_OK
      ? { detail: inputs.detail as MalformedDetail }
      : {};
  const reason = isApproval ? {} : { reason: reasonOf(inputs.reply, inputs.detailText) };
  return Object.freeze({
    schema: SCHEMA_ID,
    verdictId: inputs.verdictId,
    attemptId: inputs.attemptId,
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    verdict: inputs.verdict,
    ...detail,
    ...reason,
    calls: Object.freeze([...inputs.calls]),
    transcript: asIsTranscript(inputs),
  });
}

/**
 * F101-FR-012 — the one word the critic call reports as its as-is output line
 * (B-0900, B-0901). `../gate/lines.ts` holds the line itself; this names the
 * word the record and the line agree on.
 */
export function theOneWordOfTheRecord(record: VerdictRecordOfAPhaseAttempt): VerdictResult {
  return record.verdict;
}
