/**
 * T006 — the reader of the counts from the ledger (F102-FR-032; F100-FR-012;
 * annex B §B.13).
 *
 * The six counts that limit a run — the reject count, the ordinal of the
 * phase attempt, the MALFORMED streak, the pass index, the yield index and
 * the consecutive breakers — live in the ledger, in the namespace `core`, and
 * continue across a resume and a relaunch. EVERY engine start takes them from
 * the ledger (F102-FR-032): no module of the runtime keeps its own copy,
 * because a copied counter would make a limit reached across a resume arrive
 * at a different pass. An identifier of a phase attempt is never reused, and
 * the oscillation window is keyed by the sequence of phase attempts — both
 * fall out of reading the counters in ledger order, from the first record to
 * the last.
 *
 * How the ledger is READ — and how it is not: `@specstride/core` may not
 * import `node:fs` or `node:fs/promises` (F100-FR-012, the import boundary;
 * the package graph forbids them to the core packages). The bytes of the
 * ledger are read THROUGH THE KERNEL — the caller resolves the logical name
 * `run:<runId>:ledger` and hands the kernel's stable read the path, as every
 * other reader of a control record does. This module therefore holds NO file
 * module of Node.js and no path logic: it takes the ledger records through
 * the `LedgerReader` port, whose implementation in the edge packages is a
 * kernel read, and it folds them purely.
 *
 * A reset record (`--reset-counts`, F102-FR-033) is a record of the kind
 * `counters-reset` in the namespace `core`: every count after it starts at
 * zero again. The flag itself is command-line only and is never replayed —
 * the reset lives in exactly one ledger record, so replaying the ledger
 * replays no flag.
 */
import {
  CORE_COUNTERS,
  CORE_NAMESPACE,
  resetCounts,
  type CoreCounter,
  type LedgerRecord,
} from "@specstride/contracts/records/ledger-record";
import { POINT_ID as LOOP_LAYER_POINT_ID } from "@specstride/contracts/ep/loop-layer";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-032"] as const;

/** The import boundary this module holds (F100-FR-012). */
export const READS_NO_FILE_MODULE_OF_NODE = true as const;

/**
 * The counts are read through the kernel: the port is implemented over the
 * kernel's read of the ledger file, never over `node:fs` here.
 */
export const THE_LEDGER_IS_READ_THROUGH_THE_KERNEL = true as const;

/** The namespace the six counts live in (annex B §B.13). */
export const NAMESPACE = CORE_NAMESPACE;

/** The kind of the ledger record a `--reset-counts` launch appends (F102-FR-033). */
export const RESET_RECORD_KIND = "counters-reset" as const;

/**
 * The port the counters are read through. The implementation in the edge
 * packages resolves `run:<runId>:ledger` and reads it through the kernel;
 * the engine hands this module the records it already read that way.
 */
export interface LedgerReader {
  /** The records of the ledger, in ledger order (first appended first). */
  readonly readLedgerRecords: () => readonly LedgerRecord[];
}

/**
 * True when a ledger record RESETS the counts (F102-FR-033): a `core`
 * record of the kind `counters-reset`. A reset record carries no counters of
 * its own; the fold below zeroes every count at it.
 */
export function isAResetRecord(record: LedgerRecord): boolean {
  return record.ns === CORE_NAMESPACE && record.kind === RESET_RECORD_KIND;
}

/** One counter value as the ledger holds it, or nothing when it is absent. */
function counterValue(
  counters: Record<string, unknown> | undefined,
  name: CoreCounter,
): number | undefined {
  const value = counters?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The counts as they stand at the END of the ledger (F102-FR-032).
 *
 * The fold walks the records in ledger order. A `core` record of the kind
 * `counters-reset` zeroes every count; any later `core` record that carries
 * `counters` updates the counts it names with the values it holds — the
 * values as they stand AFTER that record (§B.13). Records of another
 * namespace, and `core` records without counters, change nothing. A count
 * the ledger never recorded stands at 0.
 *
 * Pure: it reads only its argument — no file, no clock, no state between
 * calls (F100-FR-012).
 */
export function coreCountersFromLedger(
  records: readonly LedgerRecord[],
): Readonly<Record<CoreCounter, number>> {
  let counts: Record<CoreCounter, number> = { ...resetCounts() };
  for (const record of records) {
    if (record.ns !== CORE_NAMESPACE) continue;
    if (isAResetRecord(record)) {
      counts = { ...resetCounts() };
      continue;
    }
    if (record.counters === undefined) continue;
    for (const name of CORE_COUNTERS) {
      const value = counterValue(record.counters, name);
      if (value !== undefined) counts[name] = value;
    }
  }
  return Object.freeze(counts);
}

/**
 * Read the counts through the port (F102-FR-032): every engine start calls
 * this with the kernel-backed reader of the ledger of the run it continues.
 */
export function readCoreCounters(reader: LedgerReader): Readonly<Record<CoreCounter, number>> {
  return coreCountersFromLedger(reader.readLedgerRecords());
}

/** The counts of a run that has none recorded yet: every count at zero. */
export function emptyCoreCounters(): Readonly<Record<CoreCounter, number>> {
  return resetCounts();
}

/* ------------------------------------------------------------------ *
 * T040 — the reset of `--reset-counts` through EP-04 (F102-FR-033).
 * ------------------------------------------------------------------ */

/**
 * F102-FR-033 — `--reset-counts` resets every count of F102-FR-032 AND those
 * of every loop layer. The loop layers are reached through EP-04
 * `specstride.loop-layer/1`: each layer holds its own namespace of the ledger
 * (annex B §B.13), and a reset record is appended in each one beside the one
 * of `core`. This constant names the extension point the reset goes through.
 */
export const LOOP_LAYER_POINT_OF_THE_RESET = LOOP_LAYER_POINT_ID;

/** The flag is accepted from the command line ONLY (F102-FR-033). */
export const RESET_FLAG_ACCEPTED_FROM = "command-line" as const;

/**
 * F102-FR-033 — the places the flag is NEVER read from. A flag read from any
 * of these would be replayed on every later start; the reset lives in
 * exactly one ledger record, so the ledger replays no flag.
 */
export const RESET_FLAG_NEVER_READ_FROM = Object.freeze([
  "environment",
  "project-configuration",
  "user-configuration",
  "launch-contract",
  "snapshot",
]) as readonly string[];

/**
 * F102-FR-033 — the reset never removes evidence, approval records or
 * archives: it touches only the counters.
 */
export const A_RESET_REMOVES_NO_EVIDENCE = true as const;

/**
 * The reset records of one `--reset-counts` launch: one `counters-reset`
 * record in `core` and one in the namespace of EVERY loop layer of the run
 * (F102-FR-033, EP-04). Pure: it builds the records, it appends nothing —
 * the engine that starts the launch appends them through the ledger.
 */
export function resetRecordsOfLaunch(input: {
  readonly runId: string;
  readonly engineStartId: string;
  readonly ts: string;
  readonly seq: number;
  readonly prev: string;
  readonly sig: string;
  /** The namespaces of the loop layers of the run (one reset each). */
  readonly loopLayerNamespaces: readonly string[];
}): readonly LedgerRecord[] {
  const namespaces = [CORE_NAMESPACE, ...input.loopLayerNamespaces];
  return Object.freeze(
    namespaces.map((ns, index) => ({
      schema: "specstride.ledger/1",
      seq: input.seq + index,
      prev: input.prev,
      sig: input.sig,
      ts: input.ts,
      runId: input.runId,
      engineStartId: input.engineStartId,
      ns,
      kind: RESET_RECORD_KIND,
    })) as LedgerRecord[],
  );
}

/* ------------------------------------------------------------------ *
 * T040 — the run-control events of a launch (F102-FR-036).
 * ------------------------------------------------------------------ */

/** The event type of a launch (annex X §X.6 row 73). */
export const EVENT_RUN_LAUNCHED = "run.launched" as const;
/** The event type of a reset (annex X §X.6 row 73). */
export const EVENT_COUNTERS_RESET = "counters.reset" as const;
/** The event type that closes an open `blocked` (T17, F102-FR-023). */
export const EVENT_UNBLOCKED = "unblocked" as const;

/**
 * F102-FR-036 — the `data` of `run.launched`: it MUST say whether counts
 * were carried and whether they were reset. Exactly one of the two is true.
 */
export type RunLaunchedData = {
  readonly reason: string;
  readonly countsCarried: boolean;
  readonly countsReset: boolean;
};

/** The `data` of `run.launched` for one launch (F102-FR-036). */
export function runLaunchedDataOf(input: {
  readonly reason: string;
  readonly resetCounts?: boolean | undefined;
}): RunLaunchedData {
  const countsReset = input.resetCounts === true;
  return Object.freeze({
    reason: input.reason,
    countsCarried: !countsReset,
    countsReset,
  });
}

/**
 * F102-FR-033, F102-FR-036 — the `data` of `counters.reset`: it MUST name
 * the counts reset (`which`), and the launch that asked for it (`by`).
 */
export type CountersResetData = {
  readonly which: readonly string[];
  readonly by: string;
};

/** The `data` of `counters.reset` for one reset (F102-FR-033, F102-FR-036). */
export function countersResetDataOf(input: {
  readonly by: string;
  readonly loopLayerNamespaces?: readonly string[] | undefined;
}): CountersResetData {
  return Object.freeze({
    which: Object.freeze([
      ...CORE_COUNTERS,
      ...(input.loopLayerNamespaces ?? []).map((ns) => `counters of the loop layer "${ns}"`),
    ]),
    by: input.by,
  });
}

/**
 * F102-FR-036 — the `data` of `unblocked`: it closes an open `blocked` when
 * `resume` leaves `blocked-on-human` (T17, F102-FR-023), with the fields
 * `by` (`operator`, as `causedBy` in F102-FR-004) and `latencyMs`.
 */
export type UnblockedData = {
  readonly by: string;
  readonly latencyMs: number;
};

/** The `by` of the `unblocked` a `resume` writes: the operator. */
export const UNBLOCKED_BY = "operator" as const;

/** The `data` of `unblocked` for one `resume` out of `blocked-on-human`. */
export function unblockedDataOf(input: {
  readonly by?: string | undefined;
  readonly latencyMs: number;
}): UnblockedData {
  return Object.freeze({
    by: input.by ?? UNBLOCKED_BY,
    latencyMs: input.latencyMs,
  });
}
