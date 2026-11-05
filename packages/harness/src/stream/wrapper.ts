/**
 * T013 — the wrapper of the seam (F126-FR-008, F126-FR-009).
 *
 * A reader is wrapped when its format row declares at least one of
 * `synthInit`, `synthTerminal`, `noActivity` and `trackTerminal`. The wrapper
 * synthesizes the `init` of a text stream on the first consumed record and
 * the `terminal` at the end of the stream, drops a terminal that arrives
 * after the pass already had one (diagnostic `duplicate_terminal`, severity
 * `warning`, the first decides), and finishes a stream at most once per pass,
 * idempotently. A reader that is not wrapped hands every terminal on as it
 * arrives.
 */
import { diagnosticOf } from "./closed-sets.ts";
import type { StreamReader } from "./claude-reader.ts";
import { synthesizedInit, synthesizedMissingTerminal } from "./text-reader.ts";
import type { NormalizedRecord } from "./records.ts";

/** True where the row must be wrapped (F126-FR-009). */
export function isWrappedRow(row: {
  synthInit: boolean;
  synthTerminal: boolean;
  noActivity: boolean;
  trackTerminal: boolean;
}): boolean {
  return row.synthInit || row.synthTerminal || row.noActivity || row.trackTerminal;
}

/** Options of the wrapper: the invocation model, where one is resolvable. */
export type WrapperOptions = {
  /** The invocation model, for the synthesized init (F126-FR-008). */
  readonly invocationModel?: string | null | undefined;
};

/** The wrapped reader of the seam. */
export class WrappedStreamReader implements StreamReader {
  private sawFirst = false;
  private sawTerminal = false;
  private finishCount = 0;
  private readonly inner: StreamReader;
  private readonly row: {
    synthInit: boolean;
    synthTerminal: boolean;
    noActivity: boolean;
    trackTerminal: boolean;
  };
  private readonly options: WrapperOptions;

  /** Whether the wrapped reader saw a malformed line (F126-FR-016). */
  get malformedStream(): boolean {
    return (
      (this.inner as { readonly malformedStream?: boolean | undefined }).malformedStream === true
    );
  }

  constructor(
    inner: StreamReader,
    row: {
      synthInit: boolean;
      synthTerminal: boolean;
      noActivity: boolean;
      trackTerminal: boolean;
    },
    options: WrapperOptions = {},
  ) {
    this.inner = inner;
    this.row = row;
    this.options = options;
  }

  push(line: string): readonly NormalizedRecord[] {
    const head: NormalizedRecord[] = [];
    if (!this.sawFirst) {
      this.sawFirst = true;
      if (this.row.synthInit) head.push(synthesizedInit(this.options.invocationModel ?? null));
    }
    for (const record of this.inner.push(line)) {
      if (record.kind === "terminal") {
        if (this.sawTerminal) {
          diagnosticOf(
            "duplicate_terminal",
            "duplicate terminal dropped: the pass already had one",
          );
          continue;
        }
        this.sawTerminal = true;
      }
      head.push(record);
    }
    return head;
  }

  finish(): readonly NormalizedRecord[] {
    // Finishing is done at most once per pass and is idempotent (F126-FR-009).
    this.finishCount += 1;
    if (this.finishCount > 1) return [];
    const tail: NormalizedRecord[] = [];
    if (!this.sawFirst) {
      this.sawFirst = true;
      if (this.row.synthInit) tail.push(synthesizedInit(this.options.invocationModel ?? null));
    }
    if (this.row.synthTerminal && !this.sawTerminal) {
      this.sawTerminal = true;
      tail.push(synthesizedMissingTerminal());
    }
    for (const record of this.inner.finish()) {
      if (record.kind === "terminal") {
        if (this.sawTerminal) {
          diagnosticOf(
            "duplicate_terminal",
            "duplicate terminal dropped: the pass already had one",
          );
          continue;
        }
        this.sawTerminal = true;
      }
      tail.push(record);
    }
    return tail;
  }
}

/**
 * Wrap a reader where its row asks for it; hand the reader back unwrapped
 * where it does not — an unwrapped reader hands every terminal on as it
 * arrives, as at the baseline (F126-FR-009).
 */
export function maybeWrap(
  row: {
    synthInit: boolean;
    synthTerminal: boolean;
    noActivity: boolean;
    trackTerminal: boolean;
  },
  inner: StreamReader,
  options: WrapperOptions = {},
): StreamReader {
  return isWrappedRow(row) ? new WrappedStreamReader(inner, row, options) : inner;
}
