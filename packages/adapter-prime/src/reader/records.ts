/**
 * The six normalized record types of the JSONL reader (T009; covers
 * F138-FR-037 and feature 100 annex C §C.5).
 *
 * A stream reader turns the raw stream of a harness into normalized records.
 * The kinds are a closed set: `init`, `text`, `tool`, `usage`, `error`,
 * `terminal`. Every normalized record carries the dialect that produced it,
 * the 1-based stream line it came from and the kind; the reader (phases 3-4)
 * builds these from the dialect row's record data and never from a name
 * written in code.
 */

/** The closed set of the normalized kinds (annex C §C.5). */
export const NORMALIZED_KINDS = ["init", "text", "tool", "usage", "error", "terminal"] as const;

/** One of the six normalized kinds. */
export type NormalizedKind = (typeof NORMALIZED_KINDS)[number];

/** Fields every normalized record carries. */
export type NormalizedBase = {
  /** Which of the six kinds the record is. */
  kind: NormalizedKind;
  /** The dialect row in force for the stream the record was read from. */
  dialect: string;
  /** The 1-based line of the raw stream the record was read from. */
  line: number;
};

/** The redaction metadata every content-bearing record carries (F138-FR-036). */
export type RedactionMetadata = {
  redacted: boolean;
  truncated: boolean;
  originalBytes: number;
  retainedBytes: number;
};

/** `init`: the session header resolved — schema, session, cwd, model, provider. */
export type InitRecord = NormalizedBase & {
  kind: "init";
  schemaVersion: number;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  provider: string | null;
  /** True on the `init` update a message start may follow with (F138-FR-027). */
  update?: boolean | undefined;
};

/** `text`: one closed text block of one message, in order. */
export type TextRecord = NormalizedBase & {
  kind: "text";
  messageId: string;
  index: number;
  text: string;
  /** The message key `<message id>:<index>` (F138-FR-028). */
  messageKey?: string | undefined;
  finalFragment?: boolean | undefined;
} & Partial<RedactionMetadata>;

/** `tool`: one tool call, from its start to its end. */
export type ToolRecord = NormalizedBase & {
  kind: "tool";
  toolId: string;
  name: string;
  args: unknown;
  started: boolean;
  ended: boolean;
  /** `start`, `progress` or `end`, as the requirement holds them (F138-FR-029). */
  status?: "start" | "progress" | "end" | undefined;
  targets?: readonly string[] | undefined;
  summary?: string | undefined;
  isError?: boolean | undefined;
  durationMs?: number | null | undefined;
  resultSummary?: string | undefined;
  /** The expected evidence path, where the start matched (F138-FR-030). */
  evidencePath?: string | undefined;
} & Partial<RedactionMetadata>;

/**
 * `usage`: the running usage totals of the stream, typed. A value the stream
 * does not give is null and never zero (F138-FR-040); each record is one
 * increment with its own usage id.
 */
export type UsageRecord = NormalizedBase & {
  kind: "usage";
  turns: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  total: number | null;
  cost: number | null;
  /** The unique id of this usage increment (F138-FR-040). */
  usageId?: string | undefined;
  /** True where the pass was killed before the agent ended. */
  incomplete?: boolean | undefined;
  /** True on the reducing increment that closes the merged total (F138-FR-040). */
  final?: boolean | undefined;
};

/** `error`: a diagnostic of the stream: a provider error, a retry, a cap. */
export type ErrorRecord = NormalizedBase & {
  kind: "error";
  code: string;
  message: string;
  retry: { attempt: number; of: number } | null;
  /** The record type of the raw stream the diagnostic came from (F138-FR-036). */
  providerRecordType?: string | null | undefined;
  /** The extras of the code: attempt, delay, tool id and tool, where held. */
  extras?: Readonly<Record<string, unknown>> | undefined;
  severity?: "error" | "warning" | undefined;
} & Partial<RedactionMetadata>;

/** `terminal`: the last record of the agent; where `terminalDecides` is set, it decides the outcome. */
export type TerminalRecord = NormalizedBase & {
  kind: "terminal";
  success: boolean;
  reason: string | null;
  /** `success` or `error`, as the requirement holds it (F138-FR-032, F138-FR-033). */
  status?: "success" | "error" | undefined;
  reasonCode?: string | undefined;
  stopReason?: string | null | undefined;
  model?: string | null | undefined;
  /** The usage fields of the terminal, as the baseline carries them. */
  usage?: Readonly<Record<string, number>> | undefined;
};

/** The six normalized records, as a discriminated union. */
export type NormalizedRecord =
  InitRecord | TextRecord | ToolRecord | UsageRecord | ErrorRecord | TerminalRecord;

/** Is `value` one of the six normalized kinds? */
export function isNormalizedKind(value: unknown): value is NormalizedKind {
  return typeof value === "string" && (NORMALIZED_KINDS as readonly string[]).includes(value);
}

/** A typed usage accumulator, all fields starting at 0. */
export type UsageTotals = {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
};

/** The usage accumulator a fresh stream starts with. */
export function emptyUsageTotals(): UsageTotals {
  return { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

/** Build a `usage` record from the totals. */
export function usageRecord(dialect: string, line: number, totals: UsageTotals): UsageRecord {
  return { kind: "usage", dialect, line, ...totals };
}
