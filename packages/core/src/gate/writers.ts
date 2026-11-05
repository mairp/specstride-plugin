/**
 * T012 of feature 101 — the SINGLE writer of the records of the phase gate
 * (F101-FR-028).
 *
 * Every file this feature writes goes to a temporary name in the SAME
 * directory and is renamed into place, so that no reader ever sees a part of
 * such a file. The three steps belong to the atomic write of the kernel
 * (`@specstride/kernel`, T023 of feature 100, F100-FR-036: temporary name,
 * fsync, rename); this module does not repeat them and holds no file-system
 * module of its own. A core package writes through the service
 * `atomicWrite` of `KernelServices`, which the composition root hands it
 * (F100-FR-012, F100-FR-234).
 *
 * This module and `../approval/record.ts` are the only two writers of records
 * of the phase gate. The import-boundary rule
 * `tools/import-boundary/rules/gate-writers.json` (T005) keeps every package
 * of a loop layer away from both, so a loop layer can never write an approval.
 */
import { Buffer } from "node:buffer";
import type { AtomicWrite } from "@specstride/contracts/ep/kernel-services";
import { STEPS, temporaryNameFor } from "@specstride/kernel/atomic-write";
import { canonicalRecordText } from "@specstride/kernel/hasher";

/** The three steps of the atomic write, in order, as the kernel names them. */
export { STEPS as ATOMIC_WRITE_STEPS };

/** The name of the temporary file a write goes to first, as the kernel forms it. */
export { temporaryNameFor };

/** F101-FR-028 — a reader sees a part of a record of the phase gate. */
export const A_READER_SEES_A_PART_OF_A_RECORD = false as const;

/**
 * The eleven records F101-FR-028 names, in the order of the requirement. Every
 * one of them is written through this module or through `../approval/record.ts`
 * (the approval record and the approval key), and through nothing else.
 */
export const RECORDS_OF_THE_PHASE_GATE = [
  "approval record",
  "approval key",
  "record of a phase attempt",
  "verdict record",
  "feedback",
  "hint",
  "acceleration note",
  "accelerator snapshot",
  "recovery markers",
  "archived phase evidence",
  "the archive at approval",
  "terminal record",
] as const;

/** One of the records of the phase gate (F101-FR-028). */
export type RecordOfThePhaseGate = (typeof RECORDS_OF_THE_PHASE_GATE)[number];

/** The two writers of the feature; no third module writes such a record. */
export const WRITERS = [
  "packages/core/src/gate/writers.ts",
  "packages/core/src/approval/record.ts",
] as const;

/** What a write of this module reports back to its caller. */
export type WriteOutcome = {
  /** The path the record now stands at. */
  readonly path: string;
  /** Which record of F101-FR-028 was written. */
  readonly record: RecordOfThePhaseGate;
  /** How many bytes went to the file. */
  readonly bytes: number;
};

/**
 * A failed write of the verdict record or of the feedback gives a WARNING
 * only, and the result stays a rejection (F101-FR-012). This is the shape the
 * caller is handed in that case.
 */
export type WriteWarning = {
  readonly warned: true;
  readonly record: RecordOfThePhaseGate;
  readonly path: string;
  readonly message: string;
};

/** The writer of the records of the phase gate. */
export type GateWriter = {
  /** Write a text record (feedback, hint, acceleration note, archived evidence). */
  text(record: RecordOfThePhaseGate, path: string, body: string): WriteOutcome;
  /** Write a record as canonical JSON with a final line end. */
  json(record: RecordOfThePhaseGate, path: string, value: unknown): WriteOutcome;
  /**
   * Write a record whose failure is a warning and no halt: the verdict record
   * and the feedback (F101-FR-012). The result is the outcome, or the warning.
   */
  tolerant(record: RecordOfThePhaseGate, path: string, body: string): WriteOutcome | WriteWarning;
};

/** True when the result of `tolerant` is the warning and not an outcome. */
export function isWarning(result: WriteOutcome | WriteWarning): result is WriteWarning {
  return (result as WriteWarning).warned === true;
}

/** The records whose failed write is a warning only (F101-FR-012). */
export const RECORDS_WHOSE_FAILED_WRITE_IS_A_WARNING: readonly RecordOfThePhaseGate[] =
  Object.freeze(["verdict record", "feedback"]);

/**
 * F101-FR-028 — the single writer of the records of the phase gate, over the
 * atomic write of the kernel. The caller hands in the service; this module
 * opens nothing and renames nothing itself.
 *
 * The bytes are UTF-8 of the text. A record written as JSON goes through the
 * canonical form of the one hasher of the product, so that the bytes of a
 * record and the bytes its hash was taken over are the same text.
 */
export function gateWriter(atomicWrite: AtomicWrite): GateWriter {
  const write = (record: RecordOfThePhaseGate, path: string, body: string): WriteOutcome => {
    atomicWrite.write(path, body);
    return { path, record, bytes: Buffer.byteLength(body, "utf8") };
  };
  return {
    text(record, path, body) {
      return write(record, path, body);
    },
    json(record, path, value) {
      return write(record, path, `${canonicalRecordText(value)}\n`);
    },
    tolerant(record, path, body) {
      try {
        return write(record, path, body);
      } catch (error) {
        return {
          warned: true,
          record,
          path,
          message:
            `${record} could not be written to ${path}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
