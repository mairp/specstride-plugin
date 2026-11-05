/**
 * T058 — the pure quota classifier of the Claude harness adapter
 * (F125-FR-031, CT-125-22).
 *
 * The rows live in `data/classifier.json`; this module holds only the
 * matching and the codes the data file cannot state (the text patterns of
 * rows 11 to 15 are data too, but the terminal-record kinds and the
 * stream-shape decoding of the recorded fixtures are code here). The
 * classifier is PURE: no I/O, no clock, no model. An unknown signal is
 * `provider_other` with confidence `text` (row 18 of the contract).
 *
 * Classes and confidences are the closed sets of annex C §C.13; `retryable`
 * is a value of the class, not of the row. Every row stays `unverified`
 * until fixture capture C exists; the tests replay streams written from the
 * documented shapes and never wait for the capture.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The classifier data, as `data/classifier.json` holds it. */
type ClassifierRow = {
  readonly row: number;
  readonly signal: {
    readonly kind?: string;
    readonly anyKind?: readonly string[];
    readonly status?: string | number;
    readonly category?: string;
    readonly code?: string;
    readonly subtype?: string;
  };
  readonly class: string | null;
  readonly confidence: string | null;
  readonly resetsAt: string | null;
  readonly retryable: boolean | null;
  readonly portFailure: string | null;
};

export type ClassifierData = {
  readonly schema: string;
  readonly status: string;
  readonly retryableByClass: Readonly<Record<string, boolean>>;
  readonly rows: readonly ClassifierRow[];
  readonly textRows: readonly (ClassifierRow & { readonly patterns: readonly string[] })[];
  readonly exitRows: readonly (ClassifierRow & { readonly exitCode: number | string })[];
  readonly fallbackRow: ClassifierRow;
  readonly directRows: readonly (ClassifierRow & { readonly status: number[] | string })[];
};

function readClassifierData(): ClassifierData {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    readFileSync(path.join(here, "..", "data", "classifier.json"), "utf8"),
  ) as ClassifierData;
}

/** The classifier table as data (T058), read once at load. */
export const classifierTable: ClassifierData = readClassifierData();

/** Why a signal was classified: the closed set of the contract table. */
export type QuotaClass =
  | "quota_window"
  | "rate_limit_transient"
  | "overload"
  | "quota_credit"
  | "auth"
  | "context_window"
  | "budget_cap"
  | "agent_failure"
  | "provider_other";

/** `retryable` is a value of the class, not of the row (the contract). */
export function classIsRetryable(cls: QuotaClass): boolean {
  const value = classifierTable.retryableByClass[cls];
  if (typeof value !== "boolean") {
    throw new Error(`the class ${cls} has no retryable value in data/classifier.json`);
  }
  return value;
}

/** The outcome of a classification; null where the contract gives no class. */
export type Classification = {
  readonly row: number;
  readonly class: QuotaClass | null;
  readonly confidence: "structured" | "text" | "status" | null;
  /** An ISO instant, or null where the reset time is not trustworthy. */
  readonly resetsAt: string | null;
  readonly retryable: boolean | null;
  readonly portFailure: string | null;
  /** Present only for row 2: an observe gauge, never a class. */
  readonly gauge?: {
    readonly type: "observe";
    readonly field: "utilization";
    readonly value: number;
  };
};

/** One event of a recorded CLI or SDK stream, as the documented shapes give it. */
export type StreamEvent = {
  readonly kind: "limit_event" | "retry_event" | "error" | "result" | "exit" | "stream";
  readonly status?: string | number;
  readonly category?: string;
  readonly code?: string;
  readonly subtype?: string;
  /** The reset instant of a limit event; the unit is fixed by capture C. */
  readonly resetsAt?: string | number | null;
  /** The terminal text of a result record (rows 11 to 15). */
  readonly text?: string;
  /** The process exit code of a stream that ended without a terminal record. */
  readonly exitCode?: number;
  /** True when the stream ended with no terminal record at all. */
  readonly noTerminalRecord?: boolean;
  /** The utilization of an allowed_warning gauge. */
  readonly utilization?: number;
};

function matches(row: ClassifierRow, event: StreamEvent): boolean {
  const signal = row.signal;
  if (signal.kind !== undefined && event.kind !== signal.kind) return false;
  if (signal.anyKind !== undefined && !signal.anyKind.includes(event.kind)) return false;
  if (signal.status !== undefined && event.status !== signal.status) return false;
  if (signal.category !== undefined && event.category !== signal.category) return false;
  if (signal.code !== undefined && event.code !== signal.code) return false;
  if (signal.subtype !== undefined && event.subtype !== signal.subtype) return false;
  return true;
}

function fromRow(row: ClassifierRow, resetsAt: string | null): Classification {
  return {
    row: row.row,
    class: (row.class as QuotaClass | null) ?? null,
    confidence: (row.confidence as Classification["confidence"]) ?? null,
    resetsAt,
    retryable: row.retryable,
    portFailure: row.portFailure,
  };
}

/** The text patterns of rows 11 to 15 (the codes the structured data cannot state). */
export function textPatterns(): readonly {
  readonly row: number;
  readonly patterns: readonly string[];
}[] {
  return classifierTable.textRows.map((row) => ({ row: row.row, patterns: row.patterns }));
}

/**
 * Classifies one event of a recorded stream (pure; F125-FR-031). A text
 * reset time is null: the time in the text is local and ambiguous. Overload
 * is never a quota class. An unknown signal falls to row 18,
 * `provider_other` with confidence `text`.
 */
export function classify(event: StreamEvent): Classification {
  // Row 16 first: exit 143 is a stop the caller asked for, never a failure.
  if (event.kind === "exit") {
    const exitRow = classifierTable.exitRows.find((row) => row.exitCode === event.exitCode);
    if (exitRow) return fromRow(exitRow, null);
    // Row 17: any other non-zero exit, or a stream without a terminal record.
    return fromRow(
      classifierTable.exitRows.find((row) => row.exitCode === "other-non-zero")!,
      null,
    );
  }
  if (event.kind === "stream" && event.noTerminalRecord === true) {
    return fromRow(
      classifierTable.exitRows.find((row) => row.exitCode === "other-non-zero")!,
      null,
    );
  }

  // The more specific rows (a code, a subtype) win over the coarse status
  // rows, so the credits_required code of row 3 outranks row 1's status.
  const specific = classifierTable.rows.filter(
    (row) => row.signal.code !== undefined || row.signal.subtype !== undefined,
  );
  const coarse = classifierTable.rows.filter((row) => !specific.includes(row));
  for (const row of [...specific, ...coarse]) {
    if (matches(row, event)) {
      // Row 2: an observe gauge with utilization, never a class.
      if (row.class === null && row.row === 2) {
        return {
          row: row.row,
          class: null,
          confidence: null,
          resetsAt: null,
          retryable: null,
          portFailure: null,
          gauge: { type: "observe", field: "utilization", value: event.utilization ?? 0 },
        };
      }
      // Row 1: the reset value of the event; the unit is fixed by capture C.
      const resetsAt =
        row.resetsAt === "event"
          ? typeof event.resetsAt === "string"
            ? event.resetsAt
            : null
          : null;
      return fromRow(row, resetsAt);
    }
  }

  // Rows 11 to 15: the text fallback on the terminal record's text.
  if (typeof event.text === "string") {
    for (const row of classifierTable.textRows) {
      if (row.patterns.some((pattern) => event.text!.includes(pattern))) {
        return fromRow(row, null); // a text reset time is null
      }
    }
  }

  // Row 18: anything else.
  return fromRow(classifierTable.fallbackRow, null);
}

/** The status code of a direct call at auth tier 2. */
export type DirectOutcome =
  | {
      readonly kind: "status";
      readonly status: number;
      readonly retryAfter?: string | null;
      readonly bodyNamesBilling?: boolean;
      readonly bodyNamesTooLongPrompt?: boolean;
      readonly noReply?: false;
    }
  | {
      readonly kind: "status";
      readonly noReply: true;
    };

/**
 * Classifies a direct call's outcome (the second table of the contract).
 * No reply is `transport_failed`, not a class.
 */
export function classifyDirect(outcome: DirectOutcome): Classification {
  if (outcome.noReply === true) {
    return fromRow(
      classifierTable.directRows.find((row) => row.status === "no-reply")!,
      null,
    );
  }
  const { status } = outcome;
  // 400 is the context_window row only when the body names a too-long
  // prompt; a billing error anywhere in the body is the 402 row.
  if (outcome.bodyNamesBilling === true) {
    const billing = classifierTable.directRows.find(
      (row) => Array.isArray(row.status) && (row.status as number[]).includes(402),
    )!;
    return fromRow(billing, null);
  }
  const statusForRow = status === 400 && outcome.bodyNamesTooLongPrompt !== true ? -1 : status;
  const row =
    classifierTable.directRows.find(
      (row) => Array.isArray(row.status) && (row.status as number[]).includes(statusForRow),
    ) ?? classifierTable.directRows.find((row) => row.status === "other-4xx-5xx")!;
  const resetsAt = row.resetsAt === "retry-after" ? (outcome.retryAfter ?? null) : null;
  return fromRow(row, resetsAt);
}
