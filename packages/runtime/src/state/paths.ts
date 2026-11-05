/**
 * Where the state of ONE feature lies, resolved from the layout table of
 * feature 100 and never written out as a literal (annex B §B.5, F100-FR-053).
 *
 * The three state commands of F122-FR-033 to F122-FR-035 move, copy and verify
 * exactly the files the table puts under `<control>/features/<slug>/`:
 *
 *   | member    | logical name                           |
 *   |-----------|----------------------------------------|
 *   | approvals | `gate:<N>:approved`                    |
 *   | ledger    | `run:<runId>:ledger`                   |
 *   | learning  | `feature:<slug>:learning:decisions`, `feature:<slug>:learning:events` |
 *   | keys      | `feature:<slug>:approval-key`, `run:<runId>:ledger-key` |
 *
 * The feature DIRECTORY itself has no row of its own, so it is derived from
 * the approval-key row by taking its two parent directories — not written as
 * `<control>/features/<slug>`. Change the table and this follows.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";

/** The logical names this module resolves. */
export const APPROVAL_LOGICAL_NAME = "gate:<N>:approved" as const;
export const APPROVAL_KEY_LOGICAL_NAME = "feature:<slug>:approval-key" as const;
export const LEDGER_LOGICAL_NAME = "run:<runId>:ledger" as const;
export const LEDGER_KEY_LOGICAL_NAME = "run:<runId>:ledger-key" as const;
export const LEARNING_DECISIONS_LOGICAL_NAME = "feature:<slug>:learning:decisions" as const;
export const LEARNING_EVENTS_LOGICAL_NAME = "feature:<slug>:learning:events" as const;
export const RUN_RECORD_LOGICAL_NAME = "run:<runId>:record" as const;
export const RUN_LEASE_LOGICAL_NAME = "run:<runId>:lease" as const;

/** Which control plane, and which working tree it belongs to. */
export type StatePlace = {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
};

function rootsOf(place: StatePlace): Record<string, string> {
  return rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  }) as unknown as Record<string, string>;
}

/** Where the state of one feature lies. */
export type StatePaths = {
  readonly controlRoot: string;
  /** `<control>/features/<slug>/`, derived from the approval-key row. */
  readonly featureDirectory: string;
  readonly approvalsDirectory: string;
  readonly approvalKeyFile: string;
  readonly keysDirectory: string;
  readonly runsDirectory: string;
  readonly learningDirectory: string;
  readonly learningDecisionsFile: string;
  readonly learningEventsFile: string;
};

/** Resolve the places of one feature's state. */
export function statePathsOf(place: StatePlace, slug: string): StatePaths {
  const roots = rootsOf(place);
  const approvalKeyFile = resolve(APPROVAL_KEY_LOGICAL_NAME, { "<slug>": slug }, roots);
  // `<control>/features/<slug>/keys/approval.key` → the feature directory is
  // two levels up. Derived, not written as a template of its own.
  const keysDirectory = dirname(approvalKeyFile);
  const featureDirectory = dirname(keysDirectory);
  const oneApproval = resolve(APPROVAL_LOGICAL_NAME, { "<slug>": slug, "<N>": "0" }, roots);
  const decisions = resolve(LEARNING_DECISIONS_LOGICAL_NAME, { "<slug>": slug }, roots);
  const oneLedger = resolve(LEDGER_LOGICAL_NAME, { "<slug>": slug, "<runId>": "0" }, roots);
  return Object.freeze({
    controlRoot: place.controlRoot,
    featureDirectory,
    approvalsDirectory: dirname(oneApproval),
    approvalKeyFile,
    keysDirectory,
    runsDirectory: dirname(dirname(oneLedger)),
    learningDirectory: dirname(decisions),
    learningDecisionsFile: decisions,
    learningEventsFile: resolve(LEARNING_EVENTS_LOGICAL_NAME, { "<slug>": slug }, roots),
  });
}

/** The path of the approval record of one phase (`gate:<N>:approved`). */
export function approvalPathOf(place: StatePlace, slug: string, phase: number | string): string {
  return resolve(APPROVAL_LOGICAL_NAME, { "<slug>": slug, "<N>": String(phase) }, rootsOf(place));
}

/** The path of the ledger of one run (`run:<runId>:ledger`). */
export function ledgerPathOf(place: StatePlace, slug: string, runId: string): string {
  return resolve(LEDGER_LOGICAL_NAME, { "<slug>": slug, "<runId>": runId }, rootsOf(place));
}

/** The path of the ledger key of one run (`run:<runId>:ledger-key`). */
export function ledgerKeyPathOf(place: StatePlace, slug: string, runId: string): string {
  return resolve(LEDGER_KEY_LOGICAL_NAME, { "<slug>": slug, "<runId>": runId }, rootsOf(place));
}

/** The path of the lease of one run (`run:<runId>:lease`). */
export function runLeasePathOf(place: StatePlace, slug: string, runId: string): string {
  return resolve(RUN_LEASE_LOGICAL_NAME, { "<slug>": slug, "<runId>": runId }, rootsOf(place));
}

/** The file name of an approval record, from which the phase number is read. */
export const APPROVAL_FILE = /^phase-(\d+)\.json$/;

/**
 * The phase numbers for which an approval record FILE exists, in order. This
 * is a reading of names only: whether the record verifies is a separate
 * question, asked by `verifyApprovalsOf`.
 */
export function approvalFilesOf(
  place: StatePlace,
  slug: string,
): readonly {
  readonly phase: number;
  readonly path: string;
}[] {
  const paths = statePathsOf(place, slug);
  let names: readonly string[];
  try {
    names = readdirSync(paths.approvalsDirectory);
  } catch {
    return Object.freeze([]);
  }
  const out: { phase: number; path: string }[] = [];
  for (const name of names) {
    const match = APPROVAL_FILE.exec(name);
    if (match === null) continue;
    out.push({ phase: Number(match[1]), path: join(paths.approvalsDirectory, name) });
  }
  out.sort((a, b) => a.phase - b.phase);
  return Object.freeze(out.map((one) => Object.freeze(one)));
}

/** The run ids the control plane of the feature holds, in order. */
export function runIdsOf(place: StatePlace, slug: string): readonly string[] {
  const paths = statePathsOf(place, slug);
  let names: readonly string[];
  try {
    names = readdirSync(paths.runsDirectory);
  } catch {
    return Object.freeze([]);
  }
  const out = names.filter((name) => {
    try {
      return statSync(join(paths.runsDirectory, name)).isDirectory();
    } catch {
      return false;
    }
  });
  out.sort();
  return Object.freeze(out);
}
