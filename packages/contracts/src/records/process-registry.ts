/**
 * T044 — the type and the validator of process registry (annex B, §B.10).
 *
 * Schema id `specstride.procs/1`, logical name `run:<runId>:procs`. The type is
 * generated from `schemas/process-registry.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-063 and F100-FR-064.
 */
import type { ProcessRegistry } from "./generated/process-registry.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { ProcessRegistry };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.procs/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:procs" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.10" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.10 is required (F100-FR-048, F100-FR-049).
 */
export function readProcessRegistry(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): ProcessRegistry {
  return readRecord<ProcessRegistry>(logicalName, value);
}

/** `readProcessRegistry` that returns a result instead of throwing. */
export function tryReadProcessRegistry(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: ProcessRegistry } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<ProcessRegistry>(logicalName, value);
}

/** True when the value validates against `specstride.procs/1`. */
export function isProcessRegistry(value: unknown): value is ProcessRegistry {
  return validate<ProcessRegistry>(SCHEMA_ID, value).ok;
}

/** The closed set of classes of the process registry (annex X §X.6 row 22). */
export const PROCESS_CLASSES = ["owned", "adoptable"] as const;
export type ProcessClass = (typeof PROCESS_CLASSES)[number];

/** The seven kinds of process of §B.10. */
export const PROCESS_KINDS = [
  "engine",
  "stage-child",
  "harness-pass",
  "critic-call",
  "check",
  "detached-job",
  "worker-pass",
] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];

/**
 * F100-FR-063 — processes of a pass, of a critic-class call, of a check, of a
 * stage and of a worker are `owned`. The detached job of an accepted yield
 * and a long verification job are `adoptable`, with the kind
 * `detached-job`; no process of a worker is ever `adoptable`.
 */
export function classOfKind(kind: ProcessKind): ProcessClass {
  return kind === "detached-job" ? "adoptable" : "owned";
}

export function classIsAllowed(kind: ProcessKind, cls: ProcessClass): boolean {
  if (kind === "worker-pass") return cls === "owned";
  return cls === classOfKind(kind);
}

/**
 * F100-FR-064 — a stop and `stop --now` end `owned` processes only, and
 * only after pid, start time and run token all match.
 */
export function mayBeSignalled(
  entry: ProcessRegistry,
  observed: { pid: number; startTime: string; runTokenHash: string },
): boolean {
  return (
    entry.class === "owned" &&
    Number(entry.pid) === observed.pid &&
    String(entry.startTime) === observed.startTime &&
    String(entry.runTokenHash) === observed.runTokenHash
  );
}

/** An `adoptable` process survives a stop and is adopted by the next start. */
export function survivesStop(entry: ProcessRegistry): boolean {
  return entry.class === "adoptable";
}

/** An `adoptable` process never makes the lock provider report this (F100-FR-064). */
export const ADOPTABLE_NEVER_REPORTS = "owner-dead-group-alive" as const;
