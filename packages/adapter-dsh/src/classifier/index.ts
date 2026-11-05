/**
 * T048 — the classifier entries of dsh as a PURE table (F130-FR-038).
 *
 * Every pass and every critic call has both of its streams scanned for the
 * as-is form `dsh: <CODE>: <message>`; what matches is handed to the quota
 * classifier of EP-12 as the code, the message and the stream. The entries
 * themselves are the table below: no input or output, no clock, no model —
 * the guarantee §C.13 states for a classifier implementation. The message
 * forms wait for capture 5 and stay `unverified`; the CODES are what the
 * pinned version `0.1.0-rc.8` prints (verified on 2026-09-29).
 *
 * A line that matches no entry is `provider_other` with confidence `text`,
 * the same classification the seam gives when no entry matches at all
 * (`NO_ENTRY_MATCHES` of `@specstride/contracts`).
 */
import type {
  Classification,
  Confidence,
  QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";

/** The as-is form of a signal line: `dsh: <CODE>: <message>`. */
export const DSH_SIGNAL_FORM = "dsh: <CODE>: <message>" as const;

/** The prefix every signal line starts with (the harness name). */
export const DSH_SIGNAL_PREFIX = "dsh: " as const;

/** The two streams the adapter scans for the form (F130-FR-038). */
export const DSH_SIGNAL_STREAMS = ["stderr", "stdout"] as const;
export type DshSignalStream = (typeof DSH_SIGNAL_STREAMS)[number];

/** One entry of the classifier table (F130-FR-038). */
export type DshClassifierEntry = {
  /** The as-is code the harness prints. */
  readonly code: string;
  /** The class the quota classifier is given. */
  readonly quotaClass: QuotaClass;
  /** The confidence of the classification. */
  readonly confidence: Confidence;
  /** Where the message says so, the entry gives this class instead. */
  readonly orWhen?: {
    /** The message must contain this text (case-insensitive). */
    readonly messageSays: string;
    /** The class given instead. */
    readonly quotaClass: QuotaClass;
  };
  /** A class the entry must NEVER be scored as, or the verdict `MALFORMED`. */
  readonly neverScoredAs?: QuotaClass | "MALFORMED";
  /** Whether the classification is retryable. */
  readonly retryable: boolean;
};

/** The row the table gives a line that matches no entry (F130-FR-038). */
export const DSH_NO_MATCH: Readonly<{
  quotaClass: QuotaClass;
  confidence: Confidence;
  retryable: boolean;
}> = Object.freeze({
  quotaClass: "provider_other",
  confidence: "text",
  retryable: true,
});

/**
 * The table itself (F130-FR-038, `contracts/classifier-entries.json`):
 * QUOTA gives `quota_window`, or `quota_credit` when the message says so;
 * RATE_LIMIT gives `rate_limit_transient`; CONTEXT_WINDOW_EXCEEDED gives
 * `context_window` and is NEVER scored MALFORMED; INVALID_CREDENTIAL gives
 * `auth`.
 */
export const DSH_CLASSIFIER_ENTRIES: readonly DshClassifierEntry[] = Object.freeze([
  {
    code: "QUOTA",
    quotaClass: "quota_window",
    confidence: "status",
    orWhen: { messageSays: "credit", quotaClass: "quota_credit" },
    retryable: true,
  },
  {
    code: "RATE_LIMIT",
    quotaClass: "rate_limit_transient",
    confidence: "status",
    retryable: true,
  },
  {
    code: "CONTEXT_WINDOW_EXCEEDED",
    quotaClass: "context_window",
    confidence: "status",
    neverScoredAs: "MALFORMED",
    retryable: false,
  },
  {
    code: "INVALID_CREDENTIAL",
    quotaClass: "auth",
    confidence: "status",
    retryable: false,
  },
]);

/** One signal the adapter saw on a stream of a pass or a critic call. */
export type DshSignal = {
  /** The as-is code between the prefix and the second `: `. */
  readonly code: string;
  /** The rest of the line. */
  readonly message: string;
  /** Which of the two streams carried the line. */
  readonly stream: DshSignalStream;
};

/** The result of scanning both streams of one call. */
export type DshSignalScan = {
  /** Every line of either stream that matched the form, in order. */
  readonly signals: readonly DshSignal[];
  /** The stream each matched line was read from, carried in `signals`. */
  readonly streams: readonly DshSignalStream[];
};

/**
 * Scans BOTH streams for the form `dsh: <CODE>: <message>` (F130-FR-038).
 * Pure text: the streams are given, nothing is read from a process here.
 */
export function scanDshStreams(stdout: string, stderr: string): DshSignalScan {
  const signals: DshSignal[] = [];
  for (const [stream, text] of [
    ["stderr", stderr],
    ["stdout", stdout],
  ] as const) {
    for (const line of text.split("\n")) {
      const match = parseDshSignalLine(line);
      if (match !== null) {
        signals.push({ code: match.code, message: match.message, stream });
      }
    }
  }
  return { signals, streams: signals.map((signal) => signal.stream) };
}

/** Parses one line; null where the line does not carry the form. */
export function parseDshSignalLine(line: string): { code: string; message: string } | null {
  if (!line.startsWith(DSH_SIGNAL_PREFIX)) return null;
  const rest = line.slice(DSH_SIGNAL_PREFIX.length);
  const separator = rest.indexOf(": ");
  if (separator <= 0) return null;
  const code = rest.slice(0, separator);
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return null;
  return { code, message: rest.slice(separator + 2) };
}

/**
 * Parses the reset time out of a signal message: an ISO 8601 timestamp the
 * message carries, else null (F130-FR-038). Pure: no clock is read — the
 * message must STATE the moment, as the form of capture 5 will settle.
 */
export function parseResetTime(message: string): string | null {
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/;
  const found = iso.exec(message);
  if (found !== null) return found[0];
  // The HTTP-date form some providers print: `resets 30s` is NOT parsed —
  // a duration would need a clock, and the table is pure.
  return null;
}

/** The entry of the table for a code, or undefined where none matches. */
export function dshClassifierEntryOf(code: string): DshClassifierEntry | undefined {
  return DSH_CLASSIFIER_ENTRIES.find((entry) => entry.code === code);
}

/**
 * Classifies one signal through the pure table (F130-FR-038): the entry of
 * the code, `orWhen` applied to the message, the reset time parsed or null,
 * and `DSH_NO_MATCH` where no entry matches. `CONTEXT_WINDOW_EXCEEDED` is
 * never scored MALFORMED: the table gives it the class `context_window` on
 * every stream, so the gate never reads a malformed reply where the code
 * states a full context window.
 */
export function classifyDshSignal(signal: DshSignal): Classification {
  const entry = dshClassifierEntryOf(signal.code);
  if (entry === undefined) {
    return {
      quotaClass: DSH_NO_MATCH.quotaClass,
      confidence: DSH_NO_MATCH.confidence,
      resetsAt: null,
      retryable: DSH_NO_MATCH.retryable,
    };
  }
  const orWhen =
    entry.orWhen !== undefined &&
    signal.message.toLowerCase().includes(entry.orWhen.messageSays.toLowerCase())
      ? entry.orWhen
      : undefined;
  return {
    quotaClass: orWhen !== undefined ? orWhen.quotaClass : entry.quotaClass,
    confidence: entry.confidence,
    resetsAt: parseResetTime(signal.message),
    retryable: entry.retryable,
  };
}

/**
 * The classification of one call: the FIRST signal of either stream decides,
 * and a call with no signal line at all matches no entry (`provider_other`,
 * confidence `text` — F130-FR-038).
 */
export function classifyDshStreams(stdout: string, stderr: string): Classification {
  const { signals } = scanDshStreams(stdout, stderr);
  if (signals.length === 0) {
    return {
      quotaClass: DSH_NO_MATCH.quotaClass,
      confidence: DSH_NO_MATCH.confidence,
      resetsAt: null,
      retryable: DSH_NO_MATCH.retryable,
    };
  }
  return classifyDshSignal(signals[0]!);
}
