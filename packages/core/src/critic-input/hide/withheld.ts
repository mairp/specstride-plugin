// Feature 117 (T078) — the record of the withheld paths of annex C §C.4
// (F117-FR-042).
//
// For every call of a critic of the form `read-only-tools` the runtime writes
// the record `specstride.withheld-paths/1` (feature 100, annex C §C.4) under
// the logical name `attempt:<N>:<k>:<n>:withheld-paths` (annex B §B.5):
//
//  - `deny` — the REAL paths of the five denied locations: the workspace
//    part, the control plane, the event stream, the worker root and the tree
//    store, resolved at the time of the call through the file-reading port;
//  - `moved` — the three files of F117-FR-040, filled from the hidden-files
//    record of `hide.ts`;
//  - `confirmed` — whether the harness adapter confirmed the read denial.
//    The CONFIRMATION belongs to the harness adapter (the capture is a task
//    of feature 131); this module only takes it and records it.
//
// The record is written with the atomic write of the kernel. WITHOUT the
// confirmation the form MUST NOT be used — `formIsUsed` is the one gate, and
// the caller holds it before it prepares any call of the second form.
import { atomicWriteJson } from "@specstride/kernel/atomic-write";
import type { FileReadingPort } from "../ports.ts";
import type { HiddenFileEntry } from "./hide.ts";

/** The schema id of the withheld-paths record (annex C §C.4). */
export const WITHHELD_PATHS_SCHEMA = "specstride.withheld-paths/1" as const;

/** The logical state name of the record (annex B §B.5). */
export function withheldPathsStateKey(phase: number, call: number, index: number): string {
  return `attempt:${phase}:${call}:${index}:withheld-paths`;
}

/** The five denied locations of F117-FR-042, in the order the record lists them. */
export const WITHHELD_ROOT_NAMES = [
  "workspace",
  "control-plane",
  "event-stream",
  "worker-root",
  "tree-store",
] as const;
export type WithheldRootName = (typeof WITHHELD_ROOT_NAMES)[number];

/** One entry of `deny`: the logical location and its real path at the time of the call. */
export type WithheldDenyEntry = {
  readonly root: WithheldRootName;
  readonly path: string;
};

/** One entry of `moved`: one of the three files of the hidden-files record. */
export type WithheldMovedEntry = {
  readonly logicalName: HiddenFileEntry["logicalName"];
  readonly from: string;
  readonly keptAt: string;
};

/** The record `specstride.withheld-paths/1`. */
export type WithheldPathsRecord = {
  readonly schema: typeof WITHHELD_PATHS_SCHEMA;
  readonly deny: readonly WithheldDenyEntry[];
  readonly moved: readonly WithheldMovedEntry[];
  readonly confirmed: boolean;
};

/** What the writer of the record is given. */
export type WithheldPathsInput = {
  /** The absolute path of the record, under its logical name. */
  readonly recordPath: string;
  /** The five logical locations, as the run holds them (logical roots, not yet real paths). */
  readonly roots: Readonly<Record<WithheldRootName, string>>;
  /** The three files of the hidden-files record (only the ones that existed). */
  readonly moved: readonly WithheldMovedEntry[];
  /** The confirmation of the harness adapter (feature 131 captures it). */
  readonly confirmed: boolean;
  /** The file-reading port: the real path of every location, at the time of the call. */
  readonly reader: FileReadingPort;
};

/**
 * Whether the second form is used at all: WITHOUT the confirmation of the
 * harness adapter the form is not used (F117-FR-042). The caller holds this
 * gate before it prepares the call; the record is still written, with
 * `confirmed: false`, so the run shows why the form was not used.
 */
export function formIsUsed(confirmed: boolean): boolean {
  return confirmed === true;
}

/**
 * Write the withheld-paths record for one call (F117-FR-042): the real paths
 * of the five denied locations are resolved AT THE TIME OF THE CALL, through
 * the file-reading port, and the record is written with the atomic write of
 * the kernel.
 */
export function writeWithheldPathsRecord(input: WithheldPathsInput): WithheldPathsRecord {
  const deny: WithheldDenyEntry[] = WITHHELD_ROOT_NAMES.map((root) => ({
    root,
    path: input.reader.realpath(input.roots[root]) ?? input.roots[root],
  }));
  const record: WithheldPathsRecord = {
    schema: WITHHELD_PATHS_SCHEMA,
    deny,
    moved: input.moved.map((entry) => ({ ...entry })),
    confirmed: input.confirmed === true,
  };
  atomicWriteJson(input.recordPath, record, { createDirectory: true });
  return record;
}
