/**
 * The quota classifier of pi (feature 134, T030, F134-FR-024) — a PURE
 * TABLE over the message text of a provider error that arrives as an
 * assistant message with the stop reason `error`, after the retry records.
 *
 * It is the adapter-side counterpart of the classifier entries of
 * `specs/134-adapter-pi/contracts/classifier-entries.pi.json`: the entries
 * below are that contract, in the same order, as code the engine of feature
 * 127 can hand an error text to. The table is pure:
 *
 *  - no I/O — nothing here reads a file, a socket or the environment;
 *  - no clock — the only time source is the `messageAt` instant the caller
 *    passes in; the same input always gives the same classification, and a
 *    call without `messageAt` parses no reset time (`resetsAt` null);
 *  - no model and no randomness.
 *
 * The reset-time grammar is the duration grammar of the contract:
 * `<n>d`, `<n>h`, `<n>m`, `<n>s`, and combinations such as `1h30m`, read
 * after the phrases `reset after` / `reset in` / `resets after` /
 * `resets in`. The confidence is always `text` (F134-FR-024), so a pause
 * follows only a confirming probe. An input that matches no entry gives
 * `provider_other` with the confidence `text` and `retryable` true — the
 * default row of the contract (annex X §X.6 row 46; feature 127 §Q.1).
 */
import type {
  Classification,
  Confidence,
  QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";

/** One row of the classifier table of pi. */
export type PiClassifierEntry = {
  /** The id of the contract entry this row carries. */
  readonly id: string;
  /** The pattern over the message text. */
  readonly pattern: RegExp;
  /** The class of the closed set of annex X §X.6 row 46. */
  readonly quotaClass: QuotaClass;
  /** Whether a reset time present in the text is parsed into `resetsAt`. */
  readonly parseReset: boolean;
  readonly retryable: boolean;
};

/** The phrases that introduce a server-given reset time. */
const RESET_PHRASE = /resets?\s+(?:after|in)\s*[:-]?\s*((?:\d+(?:d|h|m|s)[\s,]*(?:and\s+)?)+)/i;

/** One duration unit of the contract's duration grammar, in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
};

/**
 * The duration parser: read the contract's duration grammar
 * (`<n>d`, `<n>h`, `<n>m`, `<n>s`, combinations such as `1h30m`) out of a
 * match of `RESET_PHRASE` and give the total in milliseconds. `null` when
 * the expression names no unit of the grammar. Pure.
 */
export function parseDurationMs(expression: string): number | null {
  const unitPattern = /(\d+)(d|h|m|s)/gi;
  let total = 0;
  let seen = 0;
  for (
    let next = unitPattern.exec(expression);
    next !== null;
    next = unitPattern.exec(expression)
  ) {
    total += Number(next[1]) * UNIT_MS[next[2].toLowerCase()]!;
    seen += 1;
  }
  unitPattern.lastIndex = 0;
  return seen > 0 ? total : null;
}

/**
 * Read the reset time out of the message text and add it to the instant of
 * the message. `null` when the text names no reset time or when the caller
 * gave no `messageAt` (no clock here: an instant of the message is the
 * caller's fact, never this table's).
 */
export function parseResetsAt(text: string, messageAt: string | null): string | null {
  if (messageAt === null) return null;
  const match = RESET_PHRASE.exec(text);
  if (match === null) return null;
  const durationMs = parseDurationMs(match[1] ?? "");
  if (durationMs === null) return null;
  return new Date(Date.parse(messageAt) + durationMs).toISOString();
}

/**
 * The classifier table of pi: the entries of
 * `specs/134-adapter-pi/contracts/classifier-entries.pi.json`, in the order
 * the contract gives, so the first row that fires is the one the contract
 * names for that text.
 */
export const PI_CLASSIFIER_ENTRIES: readonly PiClassifierEntry[] = Object.freeze([
  {
    id: "pi.quota.window",
    pattern: /quota|limit reached|usage limit/i,
    quotaClass: "quota_window",
    parseReset: true,
    retryable: true,
  },
  {
    id: "pi.quota.credit",
    pattern: /insufficient (?:credit|balance|funds)|billing|payment required/i,
    quotaClass: "quota_credit",
    parseReset: false,
    retryable: false,
  },
  {
    id: "pi.rate.transient",
    pattern: /rate limit|429|too many requests/i,
    quotaClass: "rate_limit_transient",
    parseReset: true,
    retryable: true,
  },
  {
    id: "pi.overload",
    pattern: /overloaded|529|capacity/i,
    quotaClass: "overload",
    parseReset: false,
    retryable: true,
  },
  {
    id: "pi.auth",
    pattern: /invalid api key|unauthori[sz]ed|401|403|no api key/i,
    quotaClass: "auth",
    parseReset: false,
    retryable: false,
  },
  {
    id: "pi.context",
    pattern: /context (?:length|window)|maximum context|too many tokens/i,
    quotaClass: "context_window",
    parseReset: false,
    retryable: false,
  },
]);

/** The confidence of every classification of pi: `text` (F134-FR-024). */
export const PI_CLASSIFIER_CONFIDENCE: Confidence = "text";

/** The default row: an input that matches no entry (F134-FR-024). */
export const PI_CLASSIFIER_DEFAULT: Classification = Object.freeze({
  quotaClass: "provider_other",
  confidence: PI_CLASSIFIER_CONFIDENCE,
  resetsAt: null,
  retryable: true,
});

/**
 * The input of the classifier of pi: the message text of the provider error
 * and the instant of the message, which the caller holds. Pure — no clock.
 */
export type PiClassifierInput = {
  readonly text: string;
  /** The instant of the message (an ISO timestamp), or null when unknown. */
  readonly messageAt: string | null;
};

/**
 * Classify one provider error of pi (F134-FR-024): the class from the text,
 * the reset time parsed into `resetsAt` where the text gives one and the
 * caller gave the instant of the message, the confidence always `text`, and
 * the default row `provider_other` for an input that matches no entry. A
 * server-requested delay above the cap of pi arrives as an ordinary error
 * text and is classified exactly like any other text.
 */
export function classifyPiProviderError(input: PiClassifierInput): Classification {
  for (const entry of PI_CLASSIFIER_ENTRIES) {
    if (!entry.pattern.test(input.text)) continue;
    return {
      quotaClass: entry.quotaClass,
      confidence: PI_CLASSIFIER_CONFIDENCE,
      resetsAt: entry.parseReset ? parseResetsAt(input.text, input.messageAt) : null,
      retryable: entry.retryable,
    };
  }
  return PI_CLASSIFIER_DEFAULT;
}
