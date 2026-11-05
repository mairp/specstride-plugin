/**
 * T013 — the six normalized records of the seam (F126-FR-002, row 38 of
 * annex X §X.6).
 *
 * A reader produces only these kinds; a record of another kind is dropped and
 * a `stream.diagnostic` is emitted (the unknown-value rule of row 38). Every
 * unknown value inside a record is null, never a guess (constitution XI,
 * research R14 EV-31). A reader needs no writer: the diagnostics are
 * collected in `closed-sets.ts` and the tap hands them onward.
 */
import { recordKindOrDrop, type RecordKind } from "./closed-sets.ts";

/** `init` — the model, the tool list or its count, the session (F126-FR-002). */
export type InitRecord = {
  readonly kind: "init";
  readonly model: string | null;
  /** The tool list where the stream states it, else null. */
  readonly tools: readonly string[] | null;
  /** The count of the tool list where only a count is stated, else null. */
  readonly toolCount: number | null;
  readonly sessionId: string | null;
  /** Where the stream states them (F126-FR-002). */
  readonly sandboxMode: string | null;
  readonly networkState: string | null;
  readonly synthesized: boolean;
};

/** `text` — one non-empty block of assistant text (F126-FR-002). */
export type TextRecord = {
  readonly kind: "text";
  readonly text: string;
  readonly sessionId: string | null;
  readonly synthesized: boolean;
};

/** `tool` — one call of a tool, canonically named (F126-FR-002, F126-FR-004). */
export type ToolRecord = {
  readonly kind: "tool";
  readonly name: string;
  readonly target: string;
  readonly targets: readonly string[];
  readonly toolId: string | null;
  readonly category: string | null;
  readonly durationMs: number | null;
  /** The raw input of the call, as the stream carried it (never executed). */
  readonly input: Readonly<Record<string, unknown>>;
  readonly sessionId: string | null;
  readonly synthesized: boolean;
};

/** `usage` — the fields of the cost record, null where unreported (F126-FR-002). */
export type UsageRecord = {
  readonly kind: "usage";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cost: number | null;
  readonly scope: string | null;
  readonly cumulative: boolean;
  readonly usageId: string | null;
  readonly sessionId: string | null;
  readonly synthesized: boolean;
};

/** `error` — a code and a message (F126-FR-002). */
export type ErrorRecord = {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
  readonly sessionId: string | null;
  readonly synthesized: boolean;
};

/** `terminal` — status, stop reason, model, duration, turns, tokens, cost (F126-FR-002). */
export type TerminalRecord = {
  readonly kind: "terminal";
  readonly status: "success" | "error";
  readonly stopReason: string | null;
  readonly model: string | null;
  readonly durationMs: number | null;
  readonly numTurns: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cost: number | null;
  /** True where the cost comes from the harness's own estimate (F126-FR-003). */
  readonly costIsEstimate: boolean;
  /** The reason code the provider gave on an error, where the stream states one. */
  readonly reasonCode: string | null;
  /** The provider's own error text, where the stream carries one. */
  readonly reason: string | null;
  readonly sessionId: string | null;
  readonly synthesized: boolean;
};

/** Any of the six normalized records (row 38). */
export type NormalizedRecord =
  InitRecord | TextRecord | ToolRecord | UsageRecord | ErrorRecord | TerminalRecord;

/** The empty init: every value unknown (null), never a guess. */
export function makeInitRecord(
  fields: Partial<Omit<InitRecord, "kind">> & { readonly synthesized?: boolean | undefined } = {},
): InitRecord {
  return {
    kind: "init",
    model: fields.model ?? null,
    tools: fields.tools ?? null,
    toolCount: fields.toolCount ?? null,
    sessionId: fields.sessionId ?? null,
    sandboxMode: fields.sandboxMode ?? null,
    networkState: fields.networkState ?? null,
    synthesized: fields.synthesized ?? false,
  };
}

/** A text record; an empty block is never handed on (F126-FR-002). */
export function makeTextRecord(text: string, sessionId: string | null = null): TextRecord | null {
  if (text.trim().length === 0) return null;
  return { kind: "text", text, sessionId, synthesized: false };
}

/** A terminal record with null for every value the stream did not state. */
export function makeTerminalRecord(
  fields: Partial<Omit<TerminalRecord, "kind">> & {
    readonly synthesized?: boolean | undefined;
  } = {},
): TerminalRecord {
  return {
    kind: "terminal",
    status: fields.status ?? "success",
    stopReason: fields.stopReason ?? null,
    model: fields.model ?? null,
    durationMs: fields.durationMs ?? null,
    numTurns: fields.numTurns ?? null,
    inputTokens: fields.inputTokens ?? null,
    outputTokens: fields.outputTokens ?? null,
    cost: fields.cost ?? null,
    costIsEstimate: fields.costIsEstimate ?? false,
    reasonCode: fields.reasonCode ?? null,
    reason: fields.reason ?? null,
    sessionId: fields.sessionId ?? null,
    synthesized: fields.synthesized ?? false,
  };
}

/**
 * Keep a record only where its kind is inside row 38; drop it and emit a
 * `stream.diagnostic` with code `unknown_record_kind` otherwise
 * (F126-FR-002). The narrow guard every reader ends with.
 */
export function recordOfKind<T extends NormalizedRecord>(record: T): T | null {
  return recordKindOrDrop(record.kind) === null ? null : record;
}

/** True for every kind of row 38 — the check the conformance replay uses. */
export function isNormalizedKind(kind: string): kind is RecordKind {
  return recordKindOrDrop(kind) !== null;
}
