/**
 * The entries of the quota classifier (T042; covers F138-FR-039).
 *
 * The adapter supplies the entries of the quota classifier of feature 100,
 * annex C §C.13 (`specstride.quota-classifier/1`), for the error classes of
 * the reader. `provider_auth` gives the class `auth`. For `provider_error`,
 * a message that states a limit together with a time or a duration of reset
 * gives `quota_window` with the confidence `text` and `resetsAt` read from
 * the message, so that the run pauses only after the confirming probe; every
 * other message gives `provider_other`. Prime has no structured code for
 * quota. The typed failure of the port is `authentication_failed` for
 * `auth`, `quota_exhausted` for `quota_window`, and `agent_failure`
 * otherwise. The entries are data under `packages/adapter-prime/data/` and
 * the classifier is a pure table or pure code: no I/O, no clock, no model.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Classification,
  Confidence,
  QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";
import type { HarnessFailure } from "@specstride/contracts/ep/harness";

/** The schema id of the quota classifier entries. */
export const CLASSIFIER_ENTRIES_SCHEMA_ID = "specstride.quota-classifier/1";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The package data file the classifier entries ship from. */
export const CLASSIFIER_ENTRIES_PATH = join(HERE, "..", "..", "data", "classifier-entries.json");

/** One entry of the quota classifier, as the contract holds it. */
export type ClassifierEntry = {
  /** What stream fact the entry matches, in the words of the contract. */
  readonly from: string;
  /** The typed failure of the port (annex C §C.1 "Errors"). */
  readonly portFailure: HarnessFailure;
  /** The class the classifier reports (annex C §C.13). */
  readonly class: QuotaClass;
  /** The confidence the classifier reports. */
  readonly confidence: Confidence;
  /** Where the reset time comes from, when the entry reads one. */
  readonly resetsAt?: string;
  /** Whether the failure may be retried. */
  readonly retryable: boolean;
  /** Capture status, while a fact waits for its capture. */
  readonly status?: string;
};

/** The entries file, as data. */
export type ClassifierEntriesFile = {
  readonly schema: typeof CLASSIFIER_ENTRIES_SCHEMA_ID;
  readonly harness: string;
  readonly entries: readonly ClassifierEntry[];
  /** Prime has no structured code for quota (F138-FR-039). */
  readonly structuredQuotaCode: boolean;
};

/** Read the entries file from the package data directory. */
export function loadClassifierEntries(): ClassifierEntriesFile {
  const parsed = JSON.parse(readFileSync(CLASSIFIER_ENTRIES_PATH, "utf8")) as ClassifierEntriesFile;
  if (parsed.schema !== CLASSIFIER_ENTRIES_SCHEMA_ID) {
    throw new Error(`the classifier entries file does not satisfy ${CLASSIFIER_ENTRIES_SCHEMA_ID}`);
  }
  return parsed;
}

/** The error classes of the reader the classifier is fed from (F138-FR-038). */
export type ReaderErrorClass = "provider_auth" | "provider_error";

/**
 * A message that states a limit: the word `limit`, `quota` or `rate limit`,
 * in any case.
 */
export const LIMIT_MARKER = /\blimit\b|\bquota\b|rate limit/i;

/**
 * A time or a duration of reset in the message: an ISO timestamp, a duration
 * after `retry after` or `try again in`, or a bare duration.
 */
export const RESET_MARKER =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?|(?:retry\s+after|try\s+again\s+in|resets?\s+in)\s+\S+(?:\s+\S+)?|\b\d+\s*(?:seconds?|minutes?|hours?|days?)\b/i;

/** The `resetsAt` the message states, read out of it, or null. */
export function resetsAtOf(message: string): string | null {
  const iso = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (iso !== null) return iso[0];
  const duration = message.match(
    /(?:retry\s+after|try\s+again\s+in|resets?\s+in)\s+([^\n]*?[0-9][^\n.,;]*)/i,
  );
  if (duration !== null) return duration[1];
  const bare = message.match(/\b\d+\s*(?:seconds?|minutes?|hours?|days?)\b/i);
  return bare === null ? null : bare[0];
}

/** What one reader error classifies as (annex C §C.13, Outputs). */
export type PrimeClassification = Classification & {
  /** The typed failure of the port (annex C §C.1). */
  readonly portFailure: HarnessFailure;
  /** The entry of the table that matched. */
  readonly entry: string;
};

/** The classification of an input that matches no entry (§C.13). */
export function classifyReaderError(seen: {
  readerErrorClass: ReaderErrorClass;
  message: string;
}): PrimeClassification {
  if (seen.readerErrorClass === "provider_auth") {
    return {
      quotaClass: "auth",
      confidence: "text",
      resetsAt: null,
      retryable: false,
      portFailure: "authentication_failed",
      entry: "reader error class provider_auth",
    };
  }
  if (LIMIT_MARKER.test(seen.message) && RESET_MARKER.test(seen.message)) {
    return {
      quotaClass: "quota_window",
      confidence: "text",
      resetsAt: resetsAtOf(seen.message),
      retryable: true,
      portFailure: "quota_exhausted",
      entry:
        "reader error class provider_error, message states a limit and a time or duration of reset",
    };
  }
  return {
    quotaClass: "provider_other",
    confidence: "text",
    resetsAt: null,
    retryable: true,
    portFailure: "agent_failure",
    entry: "any other message",
  };
}
