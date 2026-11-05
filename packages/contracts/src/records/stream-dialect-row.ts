/**
 * T166 — the type and the validator of a row of the dialect table from
 * `schemas/stream-dialect-row.schema.json` (annex C, §C.5; F100-FR-090,
 * F100-FR-091).
 *
 * Schema id `specstride.stream-dialect/1`. The table is product data: one row
 * per harness adapter of the family that shares the JSONL reader for stream
 * schema version 3. A row carries no field `schema` — it is a row of a table
 * and not a record of the control plane — so it is validated by schema id, and
 * a schema id whose major is not the one this package supports is refused.
 *
 * The kinds of normalized record are the closed set of §C.5, read from the key
 * `normalizedStreamRecords` of `data/harness-tables.json`.
 */
import harnessTables from "../../data/harness-tables.json" with { type: "json" };
import type { StreamDialectRow as Generated } from "./generated/stream-dialect-row.ts";
import { validate, type SchemaError } from "./compile.ts";
import { majorOf } from "./validate.ts";

/** The schema id a row is validated against (F100-FR-048). */
export const SCHEMA_ID = "specstride.stream-dialect/1" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.5" as const;

/** The content owners of §C.5: 138 for the reader and the table, 134 for one row. */
export const CONTENT_OWNER = "138 for the reader and the table; 134 for one row" as const;

/**
 * F100-FR-090 — the kinds of normalized record are a closed set (row 38 of
 * annex X §X.6), from the key `normalizedStreamRecords` of
 * `data/harness-tables.json`.
 */
export const NORMALIZED_STREAM_RECORDS: readonly string[] = Object.freeze([
  ...(harnessTables as { normalizedStreamRecords: string[] }).normalizedStreamRecords,
]);

/** The six kinds as a literal type (§C.5). */
export type NormalizedRecordKind = "init" | "text" | "tool" | "usage" | "error" | "terminal";

/** A key of `data/harness-tables.json` that is not the six kinds of §C.5. */
export class StreamDialectTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamDialectTableError";
  }
}

/** F100-FR-090 — a reader produces only these six records, and no other. */
export const NORMALIZED_RECORD_KINDS = [
  "init",
  "text",
  "tool",
  "usage",
  "error",
  "terminal",
] as const;

if (
  NORMALIZED_STREAM_RECORDS.length !== NORMALIZED_RECORD_KINDS.length ||
  NORMALIZED_STREAM_RECORDS.some((kind, i) => kind !== NORMALIZED_RECORD_KINDS[i])
) {
  throw new StreamDialectTableError(
    `the key \`normalizedStreamRecords\` of \`data/harness-tables.json\` holds ` +
      `${NORMALIZED_STREAM_RECORDS.join(", ")}; annex C §C.5 holds the six kinds ` +
      `${NORMALIZED_RECORD_KINDS.join(", ")} (F100-FR-090)`,
  );
}

/** True for one of the six kinds (§C.5). */
export function isNormalizedRecordKind(value: unknown): value is NormalizedRecordKind {
  return (
    typeof value === "string" && (NORMALIZED_RECORD_KINDS as readonly string[]).includes(value)
  );
}

/** Unknown-value rule of row 38: the record is dropped with a diagnostic event. */
export const RECORD_WHEN_THE_KIND_IS_UNKNOWN = Object.freeze({
  dropped: true as const,
  diagnosticEvent: true as const,
});

/** F100-FR-090 — for a text stream the reader synthesizes `init` and `terminal`. */
export const SYNTHESIZED_FOR_A_TEXT_STREAM = ["init", "terminal"] as const;

/**
 * F100-FR-090 — the rules of a stream reader, as data: one registry from
 * `stream.format` to a reader, only the six normalized records, only the
 * harness's own framing, never the output of a tool as a stream record, a cap
 * on line size and on rate, a stream that ends without a terminal record
 * reported, and a new format addable as data through `stream.mapping`.
 */
export const READER_RULES = Object.freeze({
  oneRegistryFrom: "stream.format" as const,
  producesOnly: NORMALIZED_RECORD_KINDS,
  parsesOnlyTheHarnessesOwnFraming: true as const,
  neverReadsToolOutputAsAStreamRecord: true as const,
  enforcesACapOnLineSize: true as const,
  enforcesACapOnLineRate: true as const,
  reportsAStreamWithoutATerminalRecord: true as const,
  newFormatIsAddableAsDataThrough: "stream.mapping" as const,
  newFormatNeedsNoCode: true as const,
});

/** F100-FR-091 — pi and prime share one JSONL reader; what differs is this table. */
export const SHARE_ONE_JSONL_READER = ["pi", "prime"] as const;

/** One row of the dialect table (annex C, §C.5). */
export type StreamDialectRow = Generated & {
  /**
   * Feature 126, the reader of prime: where it is set, a second terminal
   * record of one stream is dropped with the reason `duplicate_terminal`, and
   * the first decides. The row `prime-v3` sets it; the condition needs no
   * field of its own, so the schema of §C.5 does not list it.
   */
  readonly trackTerminal?: boolean;
};

/** The reason a second terminal record of one stream is dropped with. */
export const DUPLICATE_TERMINAL_REASON = "duplicate_terminal" as const;

/** The row that sets `trackTerminal` in Wave 1. */
export const ROW_THAT_SETS_TRACK_TERMINAL = "prime-v3" as const;

/** True when a second terminal record is dropped and the first decides. */
export function dropsASecondTerminalRecord(row: StreamDialectRow): boolean {
  return row.trackTerminal === true;
}

/** Why a row, or a stream read through it, is refused. */
export type DialectRefusal = "not-a-record" | "different-major" | "invalid" | "schema-version";

/** A row of the dialect table, or a stream, that §C.5 refuses. */
export class StreamDialectRefusedError extends Error {
  readonly reason: DialectRefusal;
  readonly majorFound: string;
  readonly majorSupported: string;
  readonly errors: readonly SchemaError[];

  constructor(init: {
    reason: DialectRefusal;
    message: string;
    majorFound?: string;
    majorSupported?: string;
    errors?: readonly SchemaError[];
  }) {
    super(init.message);
    this.name = "StreamDialectRefusedError";
    this.reason = init.reason;
    this.majorFound = init.majorFound ?? "—";
    this.majorSupported = init.majorSupported ?? majorOf(SCHEMA_ID);
    this.errors = Object.freeze([...(init.errors ?? [])]);
  }
}

/**
 * Read one row of the dialect table (annex C, §C.5).
 *
 * `schemaId` is the id the table declares; a major other than the one this
 * package supports is refused with both majors, and every required field of
 * §C.5 is required. An unknown field follows the rule of the schema, which is
 * open: a reader ignores it (annex B, §B.4).
 */
export function readStreamDialectRow(
  value: unknown,
  schemaId: string = SCHEMA_ID,
): StreamDialectRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StreamDialectRefusedError({
      reason: "not-a-record",
      message: "refused the row of the dialect table: it is no record (annex C, §C.5)",
    });
  }
  const majorFound = majorOf(schemaId);
  const majorSupported = majorOf(SCHEMA_ID);
  if (schemaId !== SCHEMA_ID) {
    throw new StreamDialectRefusedError({
      reason: "different-major",
      majorFound,
      majorSupported,
      message:
        `refused the row of the dialect table: the major found is ${majorFound}, the major ` +
        `supported is ${majorSupported} (schema id "${SCHEMA_ID}", F100-FR-049)`,
    });
  }
  const result = validate<StreamDialectRow>(SCHEMA_ID, value);
  if (!result.ok) {
    throw new StreamDialectRefusedError({
      reason: "invalid",
      majorFound,
      majorSupported,
      message:
        `refused the row of the dialect table: ` +
        result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors: result.errors,
    });
  }
  return result.record;
}

/** `readStreamDialectRow` that returns a result instead of throwing. */
export function tryReadStreamDialectRow(
  value: unknown,
  schemaId: string = SCHEMA_ID,
): { ok: true; record: StreamDialectRow } | { ok: false; error: StreamDialectRefusedError } {
  try {
    return { ok: true, record: readStreamDialectRow(value, schemaId) };
  } catch (err) {
    if (err instanceof StreamDialectRefusedError) return { ok: false, error: err };
    throw err;
  }
}

/** True when the value validates against `specstride.stream-dialect/1`. */
export function isStreamDialectRow(value: unknown): value is StreamDialectRow {
  return validate<StreamDialectRow>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-091 — a stream whose session header names a version outside
 * `schemaVersions` of its row is refused. The refusal names the version found
 * and the versions the row accepts.
 */
export function readSessionHeaderVersion(row: StreamDialectRow, version: unknown): number {
  const accepted = (row.schemaVersions as unknown[]).map(Number);
  if (typeof version !== "number" || !accepted.includes(version)) {
    throw new StreamDialectRefusedError({
      reason: "schema-version",
      message:
        `refused the stream of the dialect "${String(row.dialect)}": its session header names ` +
        `the version ${JSON.stringify(version)}; the row accepts ${accepted.join(", ")} ` +
        `(F100-FR-091)`,
    });
  }
  return version;
}

/**
 * F100-FR-091 — where `terminalDecides` is true, the outcome of a call is
 * taken from the terminal record of the stream and not from the exit code.
 */
export function outcomeIsTakenFrom(row: StreamDialectRow): "terminal-record" | "exit-code" {
  return row.terminalDecides === true ? "terminal-record" : "exit-code";
}

export type { SchemaError };
