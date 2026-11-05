/**
 * T002 of feature 101 — the type and the validator of the state of the tree
 * around an accelerated phase attempt
 * (`specs/101-gate-and-verdict/data-model.md`, "Accelerator snapshot").
 *
 * Schema id `specstride.accelerator-snapshot/1`, logical name
 * `attempt:<N>:<k>:<n>:accelerator-snapshot`. The type is generated from
 * `schemas/accelerator-snapshot.schema.json` (the `build` script of the
 * package); this module gives the validator over it and the derived field
 * `changedByPass`, which the acceleration note names.
 */
import type { AcceleratorSnapshot } from "./generated/accelerator-snapshot.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { AcceleratorSnapshot };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.accelerator-snapshot/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "attempt:<N>:<k>:<n>:accelerator-snapshot" as const;

/** The table that owns the field list. */
export const ANNEX_SECTION = 'feature 101, data-model.md, "Accelerator snapshot"' as const;

/** The two halves of the record: taken before the pass, and after it. */
export const HALVES = ["before", "after"] as const;
export type Half = (typeof HALVES)[number];

/** One half of the record, empty outside a repository. */
export type TreeState = {
  readonly changed: readonly { path: string; linesAdded: number; linesRemoved: number }[];
  readonly newFiles: readonly string[];
};

/** Read the record through its logical name (F100-FR-048, F100-FR-049). */
export function readAcceleratorSnapshot(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): AcceleratorSnapshot {
  return readRecord<AcceleratorSnapshot>(logicalName, value);
}

/** `readAcceleratorSnapshot` that returns a result instead of throwing. */
export function tryReadAcceleratorSnapshot(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: AcceleratorSnapshot } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<AcceleratorSnapshot>(logicalName, value);
}

/** True when the value validates against `specstride.accelerator-snapshot/1`. */
export function isAcceleratorSnapshot(value: unknown): value is AcceleratorSnapshot {
  return validate<AcceleratorSnapshot>(SCHEMA_ID, value).ok;
}

/** True where a half holds nothing: the state outside a repository. */
export function halfIsEmpty(half: TreeState): boolean {
  return half.changed.length === 0 && half.newFiles.length === 0;
}

/**
 * The files whose entry differs between `before` and `after`, sorted — the
 * value the field `changedByPass` carries, derived from the two halves so that
 * the writer and a reader agree on it.
 */
export function changedByPass(before: TreeState, after: TreeState): readonly string[] {
  const entry = (half: TreeState): Map<string, string> => {
    const out = new Map<string, string>();
    for (const file of half.changed) {
      out.set(file.path, `changed:${file.linesAdded}:${file.linesRemoved}`);
    }
    for (const path of half.newFiles) out.set(path, "new");
    return out;
  };
  const left = entry(before);
  const right = entry(after);
  const paths = new Set([...left.keys(), ...right.keys()]);
  const out: string[] = [];
  for (const path of paths) if (left.get(path) !== right.get(path)) out.push(path);
  return Object.freeze(out.sort());
}
