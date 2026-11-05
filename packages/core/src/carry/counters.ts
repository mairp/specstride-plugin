/**
 * T074 of feature 103, second half — THE COUNTERS (F103-FR-040).
 *
 * The pass index, the yield index and the consecutive breakers LIVE IN THE
 * COUNTERS OF THE LEDGER and CONTINUE across a resume and a relaunch. This
 * module is the counters themselves: their names, their zero, how they are
 * read back out of a ledger, and the two rules F103-FR-040 adds to the
 * baseline's behaviour.
 *
 * ## Why this file holds no state and writes no file
 *
 * The baseline kept the breaker state of the structured path in a PER-RUN FILE
 * next to the run, `.breaker-state.<run-id>.json`, and DELETED IT AT EVERY
 * START — so no counter ever carried over between invocations, which is the
 * defect F103-FR-040 closes. The requirement is therefore as much about what
 * MUST NOT exist as about what must: `THE_BREAKER_STATE_FILE_IS_WRITTEN` is
 * `false`, `FILES_THIS_MODULE_WRITES` is empty, and
 * `tests/characterization/103/counts.test.ts` (CT-103-140) drives a resume and
 * then asserts that no such file was written anywhere.
 *
 * The one place the counts live is the ledger (`run:<runId>:ledger`,
 * annex B §B.13), whose records carry `counters` "as they stand after this
 * record". So reading the counts on resume is reading the newest record that
 * carries them — `countsOf` — and nothing else. That is what makes the
 * continuation across a relaunch free: a relaunch reads the same ledger.
 *
 * ## `--reset-counts`
 *
 * The flag sets them all to zero AND is recorded, as a ledger record of kind
 * `counts-reset` (F103-FR-040, F100-FR-069). `countsOnResume` returns both the
 * zeroed counts and the record the engine must append, so a reset that is not
 * recorded cannot happen by forgetting: the caller is handed the obligation
 * with the value.
 *
 * Under the `parity` profile the resume fixtures pass the flag, so the pass
 * loop starts every engine start with all counters at zero, as at the
 * baseline (`PARITY_RESUME_FIXTURES_PASS_THE_FLAG`).
 *
 * Boundary: `@specstride/contracts` for the record type and nothing else of
 * the product (F100-FR-012). No file is read or written here.
 */
import type { LedgerRecord } from "@specstride/contracts/records/ledger-record";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-040"] as const;

/* ------------------------------------------------------------------ *
 * The names.
 * ------------------------------------------------------------------ */

/**
 * The counters the PASS LOOP keeps, in the order of the table "Counters" of
 * `specs/103-proposer-pass/data-model.md`: "Pass index, yield index, error
 * count, cap count, no-progress count, short-pass count".
 */
export const PASS_LOOP_COUNTERS = [
  "passIndex",
  "yieldIndex",
  "errorCount",
  "capCount",
  "noProgressCount",
  "shortPassCount",
] as const;

/**
 * "and the outer-loop counts the engine adds" — the three of annex B §B.13 and
 * F100-FR-069 that the engine, not the pass loop, moves: the reject count, the
 * ordinal of the phase attempt and the MALFORMED streak. The pass loop reads
 * them and never writes them, which `PASS_LOOP_WRITES` records.
 */
export const OUTER_LOOP_COUNTERS = [
  "rejectCount",
  "phaseAttemptOrdinal",
  "malformedStreak",
] as const;

/** Every counter of the namespace `core`, pass-loop counters first. */
export const COUNTER_NAMES = [...PASS_LOOP_COUNTERS, ...OUTER_LOOP_COUNTERS] as const;

/** The name of one counter of the namespace `core`. */
export type CounterName = (typeof COUNTER_NAMES)[number];

/** The counters a ledger record of the namespace `core` carries. */
export type Counts = Readonly<Record<CounterName, number>>;

/** Which counters the pass loop itself writes; the rest are the engine's. */
export const PASS_LOOP_WRITES: readonly CounterName[] = Object.freeze([...PASS_LOOP_COUNTERS]);

/* ------------------------------------------------------------------ *
 * Zero, and the reset.
 * ------------------------------------------------------------------ */

/** Every counter at zero. */
export const ZERO_COUNTS: Counts = Object.freeze(
  Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])) as Record<CounterName, number>,
);

/** F103-FR-040 — `--reset-counts` sets them ALL to zero. */
export function resetCounts(): Counts {
  return ZERO_COUNTS;
}

/** F103-FR-040 — the flag of the consumer. */
export const RESET_COUNTS_FLAG = "--reset-counts" as const;

/** F103-FR-040 — the kind of ledger record the reset is recorded as. */
export const RESET_COUNTS_RECORD_KIND = "counts-reset" as const;

/** Row 13 of annex X §X.7 — the resume fixtures of `parity` pass the flag. */
export const PARITY_RESUME_FIXTURES_PASS_THE_FLAG = true as const;

/* ------------------------------------------------------------------ *
 * The per-run file of the baseline that MUST NOT be written.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-040 — "The per-run file that holds the breaker state of the
 * structured path at the baseline (`.breaker-state.<run-id>.json`), which the
 * baseline deletes at every start so that no counter carries over between
 * invocations, MUST NOT be written."
 */
export const BASELINE_BREAKER_STATE_FILE = ".breaker-state.<run-id>.json" as const;

/** The name the baseline gave that file for one run id. */
export function baselineBreakerStateFileName(runId: string): string {
  return BASELINE_BREAKER_STATE_FILE.replace("<run-id>", runId);
}

/** The baseline deleted it at every start, so no counter carried over. */
export const BASELINE_DELETED_IT_AT_EVERY_START = true as const;

/** F103-FR-040 — the runtime does NOT write it. */
export const THE_BREAKER_STATE_FILE_IS_WRITTEN = false as const;

/** The divergence register rows F103-FR-040 carries. */
export const DIVERGENCE = ["DV-011", "DV-044"] as const;

/** The counters live in the ledger and nowhere else (annex B §B.13). */
export const WHERE_THE_COUNTS_LIVE = "run:<runId>:ledger" as const;

/** This module writes no file at all; the ledger is the one store. */
export const FILES_THIS_MODULE_WRITES: readonly string[] = Object.freeze([]);

/** F103-FR-040 — the counts continue across both. */
export const COUNTS_CONTINUE_ACROSS_A_RESUME = true as const;
export const COUNTS_CONTINUE_ACROSS_A_RELAUNCH = true as const;

/* ------------------------------------------------------------------ *
 * Reading the counts.
 * ------------------------------------------------------------------ */

/**
 * The counts of a value that came out of a ledger record. A counter the record
 * does not carry, or carries as something that is not a whole number at or
 * above zero, reads as ZERO — the safe side: a counter that cannot be read is
 * never read as "a breaker is already half spent".
 */
export function readCounts(value: unknown): Counts {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const counts: Record<CounterName, number> = { ...ZERO_COUNTS };
  for (const name of COUNTER_NAMES) {
    const held = source[name];
    counts[name] = typeof held === "number" && Number.isSafeInteger(held) && held >= 0 ? held : 0;
  }
  return Object.freeze(counts);
}

/** True when every counter of the value is a whole number at or above zero. */
export function countsAreWellFormed(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return COUNTER_NAMES.every((name) => {
    const held = source[name];
    return typeof held === "number" && Number.isSafeInteger(held) && held >= 0;
  });
}

/**
 * F103-FR-040 — the counts as they stand after the ledger: the `counters` of
 * the NEWEST record of the namespace `core` that carries them. An empty
 * ledger, or one with no record of the namespace, gives the zero — which is
 * the first start of a run and not a reset.
 *
 * The search is from the END, so it is the newest record that wins however
 * many records of a layer's namespace stand between.
 */
export function countsOf(records: readonly LedgerRecord[], namespace = "core"): Counts {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i] as LedgerRecord;
    if (record.ns !== namespace) continue;
    if (record.counters === undefined || record.counters === null) continue;
    return readCounts(record.counters);
  }
  return ZERO_COUNTS;
}

/* ------------------------------------------------------------------ *
 * Resume.
 * ------------------------------------------------------------------ */

/** What a resume is given. */
export type ResumeInput = {
  /** The ledger of the run, oldest first. */
  readonly records: readonly LedgerRecord[];
  /** Whether the consumer passed `--reset-counts`. */
  readonly resetCounts?: boolean | undefined;
  /** The namespace whose counters are read; `core` by default. */
  readonly namespace?: string | undefined;
};

/** What a resume gives back. */
export type ResumeResult = {
  /** The counts the pass loop starts this engine start with. */
  readonly counts: Counts;
  /** Where they came from: the ledger, the reset, or an empty ledger. */
  readonly source: "ledger" | "reset" | "empty";
  /**
   * The kind of ledger record the caller MUST append for this resume, where
   * the resume must be recorded. `--reset-counts` is recorded as
   * `counts-reset` (F103-FR-040); a plain resume records nothing of its own.
   */
  readonly recordKind?: typeof RESET_COUNTS_RECORD_KIND | undefined;
  /** The counts the ledger held before the reset, for the record's `data`. */
  readonly countsBefore?: Counts | undefined;
};

/**
 * F103-FR-040 — the counts at the start of an engine start.
 *
 * Without the flag the counts CONTINUE: they are the ledger's. With it they
 * are all zero AND the caller is handed the record kind it must append, so
 * that "`--reset-counts` MUST set them all to zero and MUST be recorded as a
 * record of kind `counts-reset`" cannot be half kept.
 */
export function countsOnResume(input: ResumeInput): ResumeResult {
  const held = countsOf(input.records, input.namespace ?? "core");
  if (input.resetCounts === true) {
    return Object.freeze({
      counts: resetCounts(),
      source: "reset" as const,
      recordKind: RESET_COUNTS_RECORD_KIND,
      countsBefore: held,
    });
  }
  const hasCoreRecord = input.records.some(
    (r) => r.ns === (input.namespace ?? "core") && r.counters !== undefined && r.counters !== null,
  );
  return Object.freeze({
    counts: held,
    source: hasCoreRecord ? ("ledger" as const) : ("empty" as const),
  });
}

/* ------------------------------------------------------------------ *
 * Moving a counter.
 * ------------------------------------------------------------------ */

/** The counts with one counter raised by `by` (1 by default). */
export function bump(counts: Counts, name: CounterName, by = 1): Counts {
  return Object.freeze({ ...counts, [name]: counts[name] + by });
}

/** The counts with the named counters set back to zero. */
export function clear(counts: Counts, names: readonly CounterName[]): Counts {
  const next: Record<CounterName, number> = { ...counts };
  for (const name of names) next[name] = 0;
  return Object.freeze(next);
}

/** The counts with the named counters set to the given values. */
export function withCounts(counts: Counts, changes: Partial<Record<CounterName, number>>): Counts {
  const next: Record<CounterName, number> = { ...counts };
  for (const name of COUNTER_NAMES) {
    const given = changes[name];
    if (typeof given === "number") next[name] = given;
  }
  return Object.freeze(next);
}

/** True when the two sets of counts are equal counter by counter. */
export function countsEqual(a: Counts, b: Counts): boolean {
  return COUNTER_NAMES.every((name) => a[name] === b[name]);
}
