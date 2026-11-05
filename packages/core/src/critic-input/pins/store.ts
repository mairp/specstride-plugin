// Feature 117 (T084) — the pin record `phase:<N>:verdict-pins` (F117-FR-032).
//
// The record of the verdict pins stands in the control plane under the
// logical name `phase:<N>:verdict-pins` (annex B §B.5; the layout table of
// feature 100 gives the physical path
// `<control>/features/<slug>/runs/<runId>/phases/<N>/verdict-pins.json`, the
// translation of the baseline's `verdict-pins.phase<N>.json` in the feature
// directory, behaviour B-1018). Its content is the baseline's record:
//
//  - `phase` — the phase number;
//  - `hash` — the backing hash of the priority files (see `hash.ts`);
//  - `confirmed` — the sorted criterion ids pinned CONFIRMED under that hash.
//
// The field `schema` is added by the rule of F100-FR-048 (every state record
// names its schema).
//
// The write is THE ATOMIC WRITE OF THE KERNEL (`atomicWriteJson`, F100-FR-036:
// temporary name in the same directory, fsync, rename — the translation of
// the baseline's `path + ".tmp"` plus `os.replace`, behaviour B-1019). The
// write is best-effort: an error of the write is SWALLOWED, exactly as at the
// baseline — the pins are an optimization, and a run must never fail because
// its pins could not be stored. `writeVerdictPins` reports whether the
// record stands afterwards.
//
// Reading goes through the file-reading port of `../ports.ts`; this module
// imports NO `node:fs`.
import { atomicWriteJson } from "@specstride/kernel/atomic-write";
import type { FileReadingPort } from "../ports.ts";

/** The schema id of the pin record (the rule of F100-FR-048). */
export const VERDICT_PINS_SCHEMA = "specstride.verdict-pins/1" as const;

/** The logical state name of the pin record (annex B §B.5). */
export function verdictPinsStateKey(phase: number): string {
  return `phase:${phase}:verdict-pins`;
}

/**
 * The physical path of the pin record, as the layout table of feature 100
 * holds it for `phase:<N>:verdict-pins`: `<phases root>/<N>/verdict-pins.json`.
 */
export function verdictPinsRecordPath(phasesRoot: string, phase: number): string {
  return `${phasesRoot}/${phase}/verdict-pins.json`;
}

/** The upper bound of one record read: a pin record never approaches it. */
export const VERDICT_PINS_READ_LIMIT = 1024 * 1024;

/** The pin record `specstride.verdict-pins/1` (data-model.md). */
export type VerdictPinsRecord = {
  readonly schema: typeof VERDICT_PINS_SCHEMA;
  readonly phase: number;
  /** The backing hash the pins are bound to. */
  readonly hash: string;
  /** The sorted criterion ids pinned CONFIRMED under that hash. */
  readonly confirmed: readonly string[];
};

/** The record the confirmed set makes. */
export function verdictPinsRecord(
  phase: number,
  hash: string,
  confirmed: readonly string[],
): VerdictPinsRecord {
  return { schema: VERDICT_PINS_SCHEMA, phase, hash, confirmed: [...confirmed].sort() };
}

/**
 * Write the pin record with the atomic write of the kernel, best-effort: an
 * error of the write is swallowed (the baseline's bare `except OSError`).
 * True when the record was written.
 */
export function writeVerdictPins(recordPath: string, record: VerdictPinsRecord): boolean {
  try {
    atomicWriteJson(recordPath, record, { createDirectory: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the pin record through the file-reading port, or `undefined` when it
 * cannot be read or is not a record of the right shape: the caller fails
 * SAFE toward re-verification, never toward stale approval.
 */
export function readVerdictPins(
  reader: FileReadingPort,
  recordPath: string,
): VerdictPinsRecord | undefined {
  const bytes = reader.read(recordPath, 0, VERDICT_PINS_READ_LIMIT);
  if (bytes === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf8", { fatal: false }).decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (
    record.schema !== VERDICT_PINS_SCHEMA ||
    typeof record.phase !== "number" ||
    typeof record.hash !== "string" ||
    !Array.isArray(record.confirmed) ||
    !record.confirmed.every((id) => typeof id === "string")
  ) {
    return undefined;
  }
  return {
    schema: VERDICT_PINS_SCHEMA,
    phase: record.phase,
    hash: record.hash,
    confirmed: record.confirmed as readonly string[],
  };
}
