/**
 * T056 / CT-131-36 — the Codex stream mapping, as data (F131-FR-036).
 *
 * The mapping from the records of the JSONL stream to the six normalized
 * records of feature 100, annex C §C.5, is DATA
 * (`data/stream-mapping.json`), not code: each row names the record kind
 * selector (a dotted path whose value must equal the row's condition), the
 * normalized kinds the record emits, and the field paths (or literals) that
 * fill them. This module is the thin interpreter that the seam's own
 * mapping reader (`MappingReader`) is not for this format: the Codex stream
 * changes its shape per record kind, so the data carries one row per kind
 * and the interpreter picks the row per document. A record no row matches is
 * dropped with a diagnostic event; a stream that ends without a completed or
 * a failed turn is reported as `missing_terminal`. The record shapes are the
 * seam's: the constructors and the canonical tool name come from
 * `@specstride/harness`'s stream module.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosticOf } from "../../harness/src/stream/closed-sets.ts";
import {
  makeInitRecord,
  makeTerminalRecord,
  type NormalizedRecord,
} from "../../harness/src/stream/records.ts";
import { canonicalizeToolName, resolveToolTarget } from "../../harness/src/stream/target.ts";

/** The report for a stream that ends without a completed or a failed turn. */
export const MISSING_TERMINAL = "missing_terminal" as const;

/** One row of `data/stream-mapping.json`. */
export type MappingRow = {
  readonly record: string;
  readonly match: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[]>
  >;
  readonly emits: readonly string[];
  readonly fields?: Readonly<Record<string, string | { readonly literal: unknown }>> | undefined;
  readonly usage?: Readonly<Record<string, string>> | undefined;
};

/** The mapping as data. */
export type StreamMappingData = {
  readonly schema: string;
  readonly status: string;
  readonly verifiedOn: string;
  readonly pin: string;
  readonly recordKindSelector: string;
  readonly noTerminal: string;
  readonly otherwise: string;
  readonly rows: readonly MappingRow[];
};

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load the mapping; data, not code. */
export function loadStreamMapping(
  path: string = join(PACKAGE, "data", "stream-mapping.json"),
): StreamMappingData {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as StreamMappingData;
  if (parsed.schema !== "specstride.stream-mapping/1") {
    throw new Error(`unknown stream-mapping schema '${String(parsed.schema)}'`);
  }
  return parsed;
}

/** Resolve one dotted path against a document; null where it reaches nothing. */
export function resolvePath(document: unknown, path: string): unknown {
  let current: unknown = document;
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)] ?? null;
      continue;
    }
    if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Readonly<Record<string, unknown>>)[segment] ?? null;
  }
  return current;
}

/** Whether one row's condition holds for the document. */
function rowMatches(row: MappingRow, document: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(row.match).every(([path, expected]) => {
    const value = resolvePath(document, path);
    return Array.isArray(expected) ? expected.some((one) => one === value) : value === expected;
  });
}

/** A string field of the document, else null. */
function textAt(document: Readonly<Record<string, unknown>>, path: string): string | null {
  const value = resolvePath(document, path);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A whole number field of the document, else null. */
function numberAt(document: Readonly<Record<string, unknown>>, path: string): number | null {
  const value = resolvePath(document, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The literal or path value of one field entry. */
function fieldValue(
  document: Readonly<Record<string, unknown>>,
  entry: string | { readonly literal: unknown },
): unknown {
  return typeof entry === "string" ? resolvePath(document, entry) : entry.literal;
}

function stringField(
  document: Readonly<Record<string, unknown>>,
  entry: string | { readonly literal: unknown } | undefined,
): string | null {
  if (entry === undefined) return null;
  const value = fieldValue(document, entry);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(
  document: Readonly<Record<string, unknown>>,
  entry: string | { readonly literal: unknown } | undefined,
): number | null {
  if (entry === undefined) return null;
  const value = fieldValue(document, entry);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The records one row emits for one document, in the row's `emits` order. */
function emitRow(row: MappingRow, document: Readonly<Record<string, unknown>>): NormalizedRecord[] {
  const fields = row.fields ?? {};
  const out: NormalizedRecord[] = [];
  for (const kind of row.emits) {
    if (kind === "init") {
      out.push(makeInitRecord({ sessionId: stringField(document, fields["init.sessionId"]) }));
    } else if (kind === "text") {
      const text = stringField(document, fields["text"]);
      if (text !== null) out.push({ kind: "text", text, sessionId: null, synthesized: false });
    } else if (kind === "tool") {
      const name = canonicalizeToolName(stringField(document, fields["tool.name"]) ?? "");
      const input = (resolvePath(document, "item") ?? {}) as Readonly<Record<string, unknown>>;
      out.push({
        kind: "tool",
        name,
        target: resolveToolTarget(name, input),
        targets: [],
        toolId: stringField(document, fields["tool.id"]),
        category: stringField(document, fields["tool.category"]),
        durationMs: numberField(document, fields["tool.durationMs"]),
        input,
        sessionId: null,
        synthesized: false,
      });
    } else if (kind === "usage") {
      const usage = row.usage ?? {};
      const at = (field: string): number | null =>
        usage[field] !== undefined ? numberAt(document, usage[field]) : null;
      out.push({
        kind: "usage",
        inputTokens: at("inputTokens"),
        outputTokens: at("outputTokens"),
        cacheReadTokens: at("cacheReadTokens"),
        cacheWriteTokens: at("cacheWriteTokens"),
        reasoningTokens: at("reasoningTokens"),
        cost: at("cost"),
        scope: null,
        cumulative: false,
        usageId: null,
        sessionId: null,
        synthesized: false,
      });
    } else if (kind === "error") {
      out.push({
        kind: "error",
        code: stringField(document, fields["error.code"]) ?? "adapter_error",
        message: stringField(document, fields["error.message"]) ?? "",
        sessionId: null,
        synthesized: false,
      });
    } else if (kind === "terminal") {
      const status = stringField(document, fields["terminal.status"]);
      out.push(
        makeTerminalRecord({
          status: status === "error" ? "error" : "success",
          stopReason: stringField(document, fields["terminal.stopReason"]),
        }),
      );
    } else {
      // The mapping reaches only the six normalized records (row 38).
      diagnosticOf("unknown_record_kind", `the mapping names the kind '${kind}', outside row 38`);
    }
  }
  return out;
}

/** Map one stream document through the data; `dropped` where no row matched. */
export function mapCodexDocument(
  document: Readonly<Record<string, unknown>>,
  mapping: StreamMappingData = loadStreamMapping(),
): { readonly records: readonly NormalizedRecord[]; readonly dropped: boolean } {
  const row = mapping.rows.find((candidate) => rowMatches(candidate, document));
  if (row === undefined) {
    const kind = textAt(document, mapping.recordKindSelector) ?? "(no record kind)";
    diagnosticOf(
      "unknown_record_kind",
      `the Codex stream carried the record kind '${kind}' — ` +
        `${mapping.otherwise} (F131-FR-036)`,
    );
    return { records: [], dropped: true };
  }
  return { records: emitRow(row, document), dropped: false };
}

/** Map one stream line; a line that is not a JSON object is dropped. */
export function mapCodexLine(
  line: string,
  mapping: StreamMappingData = loadStreamMapping(),
): { readonly records: readonly NormalizedRecord[]; readonly dropped: boolean } {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { records: [], dropped: false };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    diagnosticOf(
      "malformed_json",
      `a Codex stream line was not JSON: ${(error as Error).message.slice(0, 120)}`,
    );
    return { records: [], dropped: true };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    diagnosticOf("malformed_json", "a Codex stream line held JSON that is not an object");
    return { records: [], dropped: true };
  }
  return mapCodexDocument(value as Readonly<Record<string, unknown>>, mapping);
}

/** One stream read through the mapping: the records, drops and the terminal report. */
export type StreamRead = {
  readonly records: readonly NormalizedRecord[];
  readonly droppedRecords: number;
  /** True where the stream ended without a completed or a failed turn. */
  readonly missingTerminal: boolean;
  readonly noTerminal: typeof MISSING_TERMINAL | null;
};

/** Read a whole stream (lines) through the mapping (F131-FR-036). */
export function readCodexStream(
  lines: readonly string[],
  mapping: StreamMappingData = loadStreamMapping(),
): StreamRead {
  const records: NormalizedRecord[] = [];
  let dropped = 0;
  let sessionId: string | null = null;
  for (const line of lines) {
    const { records: produced, dropped: wasDropped } = mapCodexLine(line, mapping);
    if (wasDropped) dropped += 1;
    for (const record of produced) {
      if (record.kind === "init" && record.sessionId !== null) sessionId = record.sessionId;
      records.push(
        record.sessionId === null && sessionId !== null ? { ...record, sessionId } : record,
      );
    }
  }
  const missingTerminal = !records.some((record) => record.kind === "terminal");
  return {
    records,
    droppedRecords: dropped,
    missingTerminal,
    noTerminal: missingTerminal ? MISSING_TERMINAL : null,
  };
}
