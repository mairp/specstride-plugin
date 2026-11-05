/**
 * The JSONL reader of the family, stream schema version 3 (T031; covers
 * F138-FR-023, F138-FR-025, F138-FR-026 and F138-FR-037).
 *
 * One reader serves every harness of the family; what differs per harness is
 * a row of the dialect table (`./dialect.ts`). The reader never names a
 * harness: a static search of the reader source for the dialect names of the
 * family finds none (CT-138-23 proves that). The state machine lives in
 * `./reader.ts`; the message handling in `./messages.ts`, the tool handling
 * in `./summarize.ts`, the terminal in `./terminal.ts`, the usage in
 * `./usage.ts`, the caps of the framing in `./framing.ts` and the display in
 * `./display.ts`. The diagnostics use the codes of
 * `specs/138-adapter-prime/contracts/diagnostics.json`; the normalized
 * records are the six of `./records.ts`.
 */
import type { DialectRow } from "./dialect.ts";
import { DialectUnknownError, dialectNames, dialectRowFor } from "./dialect.ts";
import { PrimeStreamReader, type PrimeStreamResult } from "./reader.ts";
import type { NormalizedRecord } from "./records.ts";

export type {
  ErrorRecord,
  InitRecord,
  NormalizedBase,
  NormalizedKind,
  NormalizedRecord,
  TerminalRecord,
  TextRecord,
  ToolRecord,
  UsageRecord,
  UsageTotals,
} from "./records.ts";
export { NORMALIZED_KINDS, emptyUsageTotals, isNormalizedKind, usageRecord } from "./records.ts";
export type { AsIsEvent, FullDiagnostic, PrimeReaderOptions, PrimeStreamResult } from "./reader.ts";
export { KNOWN_RECORD_TYPES, PrimeStreamReader } from "./reader.ts";

/** One diagnostic of the reader, with the codes of the diagnostics contract. */
export type ReaderDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

/** One accepted record of the stream, normalized, with its line number. */
export type ReaderRecord = {
  line: number;
  record: NormalizedRecord;
};

/** The per-stream state: a stream is read once, in order. */
export type StreamReader = {
  /** The dialect row in force for this stream. */
  readonly dialect: string;
  /** Feed one physical line of the stream. */
  feed(line: string): void;
  /** End the stream; runs once; a second call is a no-op. */
  finish(): void;
  /** The state read after the feed: accepted records and diagnostics. */
  readonly records: readonly ReaderRecord[];
  readonly diagnostics: readonly ReaderDiagnostic[];
  readonly schemaVersion: number | null;
  readonly finished: boolean;
};

/** Wrap the full reader in the stable stream surface of this module. */
export function createStreamReader(row: DialectRow): StreamReader {
  const reader = new PrimeStreamReader({ row });
  let finished = false;
  const snapshot = (): PrimeStreamResult => (finished ? reader.finish() : reader.partial);
  return {
    dialect: row.dialect,
    get records(): readonly ReaderRecord[] {
      return snapshot().records.map((record) => ({ line: record.line, record }));
    },
    get diagnostics(): readonly ReaderDiagnostic[] {
      return snapshot().diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
      }));
    },
    get schemaVersion(): number | null {
      return snapshot().schemaVersion;
    },
    get finished(): boolean {
      return finished;
    },
    feed(line: string): void {
      reader.feed(line);
    },
    finish(): void {
      if (finished) return;
      finished = true;
      reader.finish();
    },
  };
}

/**
 * Open a stream by dialect name. A name the dialect table does not hold
 * refuses the stream before any line is read, with `DialectUnknownError`
 * (F138-FR-023).
 */
export function createStreamReaderFor(dialect: string): StreamReader {
  const row = dialectRowFor(dialect);
  if (row === undefined) throw new DialectUnknownError(dialect, dialectNames());
  return createStreamReader(row);
}
