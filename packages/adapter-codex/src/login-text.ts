/**
 * T056 — the quota classifier of this adapter and its login-text parser
 * (F131-FR-032, F131-FR-033, F131-FR-034).
 *
 * The entries are DATA (`data/classifier.json`): when capture 1 lands a
 * structured quota record, the entries change as data, with no change of
 * code (F131-FR-034). This module is the thin interpreter: it matches a
 * failure against the entries and returns one classification. Until the
 * capture exists no entry carries the confidence `structured`, so no
 * classification of this adapter can.
 *
 * The login limit is TEXT (research decision 7; no structured event is
 * documented): the text may appear in an error record of the stream, in
 * standard error or in the reply, and the classifier looks in all three
 * (F131-FR-032). With an API key the status and the body code decide
 * (F131-FR-033): 429 without the exhausted-credit code, the credit code
 * `insufficient_quota`, 401. What matches no entry is `provider_other`.
 * `retryable` follows the class (research decision 12), from the
 * `retryableByClass` table of the data, and the loader refuses an entry
 * whose value differs from the class value or lacks one.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The nine quota classes (row 46 of annex X §X.6). */
export const QUOTA_CLASSES = [
  "quota_window",
  "rate_limit_transient",
  "overload",
  "agent_failure",
  "provider_other",
  "quota_credit",
  "auth",
  "context_window",
  "budget_cap",
] as const;

export type QuotaClass = (typeof QUOTA_CLASSES)[number];

/** One entry of `data/classifier.json`. */
export type ClassifierEntry = {
  readonly id: string;
  readonly tier: number | null;
  readonly source: readonly string[];
  readonly match: {
    readonly textAny?: readonly string[] | undefined;
    readonly bodyCode?: string | undefined;
    readonly bodyCodeNot?: string | undefined;
    readonly status?: number | undefined;
    readonly otherwise?: boolean | undefined;
  };
  readonly class: QuotaClass;
  readonly confidence: "structured" | "status" | "text" | "stall" | "host";
  readonly retryable: boolean;
  readonly resetsAt?: string | undefined;
  readonly state?: string | undefined;
  readonly remedy?: string | undefined;
  readonly status?: string | undefined;
};

/** The classifier as data. */
export type Classifier = {
  readonly schema: string;
  readonly status: string;
  readonly entries: readonly ClassifierEntry[];
  readonly retryableByClass: Readonly<Record<QuotaClass, boolean>>;
  readonly structured: string;
};

/** One classification of a failure. */
export type Classification = {
  readonly class: QuotaClass;
  readonly confidence: "structured" | "status" | "text" | "stall" | "host";
  /** Follows the class (F131-FR-033); present on every classification. */
  readonly retryable: boolean;
  /** From the text where it can be read, otherwise null (F131-FR-032). */
  readonly resetsAt: string | null;
  /** e.g. `blocked-on-human` for the exhausted credit (F131-FR-033). */
  readonly state: string | null;
  /** What to fix, named for an authentication failure (F131-FR-033). */
  readonly message: string | null;
  readonly matchedEntry: string;
};

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read the classifier as data; entries that disagree with the class table refuse. */
export function loadClassifier(
  path: string = join(PACKAGE, "data", "classifier.json"),
): Classifier {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Classifier;
  for (const entry of parsed.entries) {
    const byClass = parsed.retryableByClass[entry.class];
    if (byClass === undefined) {
      throw new Error(`classifier entry '${entry.id}' names the unknown class '${entry.class}'`);
    }
    if (typeof entry.retryable !== "boolean" || entry.retryable !== byClass) {
      throw new Error(
        `classifier entry '${entry.id}' states retryable ${String(entry.retryable)}, ` +
          `the class '${entry.class}' carries ${String(byClass)}`,
      );
    }
  }
  for (const quotaClass of QUOTA_CLASSES) {
    if (typeof parsed.retryableByClass[quotaClass] !== "boolean") {
      throw new Error(`the class '${quotaClass}' carries no retryable value (F131-FR-033)`);
    }
  }
  return parsed;
}

/** Parse the reset instant out of the limit text; null where the text states none. */
export function parseResetsAt(text: string): string | null {
  const match =
    /reset(?:s)?(?:\s+\w+){0,3}?\s+(?:at|on)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ]([0-9]{2}:[0-9]{2}(?::[0-9]{2})?)\s*(UTC|Z|\+[0-9]{2}:?[0-9]{2})?)?/i.exec(
      text,
    );
  if (match === null) return null;
  const time = match[2] ?? "00:00:00";
  const zone = match[3] === undefined || match[3] === "UTC" || match[3] === "Z" ? "Z" : match[3];
  const instant = Date.parse(`${match[1]}T${time}${zone}`);
  return Number.isNaN(instant) ? null : new Date(instant).toISOString();
}

/** Whether one entry matches the given facts. */
function entryMatches(
  entry: ClassifierEntry,
  facts: {
    readonly errorText: string | null;
    readonly stderr: string | null;
    readonly reply: string | null;
    readonly status: number | null;
    readonly bodyCode: string | null;
  },
): string | null {
  const match = entry.match;
  if (match.otherwise === true) return "no entry matched";
  if (match.textAny !== undefined) {
    for (const source of [facts.errorText, facts.stderr, facts.reply]) {
      if (source === null) continue;
      const lowered = source.toLowerCase();
      if (match.textAny.some((needle) => lowered.includes(needle.toLowerCase()))) return source;
    }
    return null;
  }
  if (match.bodyCode !== undefined && facts.bodyCode === match.bodyCode)
    return `code ${facts.bodyCode}`;
  if (
    match.status !== undefined &&
    facts.status === match.status &&
    (match.bodyCodeNot === undefined || facts.bodyCode !== match.bodyCodeNot)
  ) {
    return `status ${String(facts.status)}`;
  }
  return null;
}

/** Classify one failure against the entries; the first match wins, else `provider_other`. */
export function classifyFailure(
  facts: {
    readonly errorText?: string | null | undefined;
    readonly stderr?: string | null | undefined;
    readonly reply?: string | null | undefined;
    readonly status?: number | null | undefined;
    readonly bodyCode?: string | null | undefined;
  },
  classifier: Classifier = loadClassifier(),
): Classification {
  const full = {
    errorText: facts.errorText ?? null,
    stderr: facts.stderr ?? null,
    reply: facts.reply ?? null,
    status: facts.status ?? null,
    bodyCode: facts.bodyCode ?? null,
  };
  for (const entry of classifier.entries) {
    const matched = entryMatches(entry, full);
    if (matched === null) continue;
    return {
      class: entry.class,
      confidence: entry.confidence,
      retryable: classifier.retryableByClass[entry.class],
      resetsAt: entry.resetsAt === "parse" ? parseResetsAt(matched) : null,
      state: entry.state ?? null,
      message: entry.remedy === undefined ? null : `authentication failure: check ${entry.remedy}`,
      matchedEntry: entry.id,
    };
  }
  // The loader guarantees a terminal `otherwise` entry; this is the guard.
  return {
    class: "provider_other",
    confidence: "text",
    retryable: classifier.retryableByClass.provider_other,
    resetsAt: null,
    state: null,
    message: null,
    matchedEntry: "none",
  };
}
