// T056 (F116-FR-021) — the protected-set facts, the integrity kinds from the
// closed set, the further facts from their closed set, the rows before an
// invalid ledger record, and the marking of values that originate in the
// workspace. Pure functions of control-plane records.
import type { MarkerCount } from "../protected/markers.ts";

/** Row 65 of annex X §X.6: the integrity kinds that reach the critic. */
export const INTEGRITY_KINDS: readonly string[] = Object.freeze([
  "ledger-invalid",
  "manifest-mismatch",
  "pin-mismatch",
  "changed-during-check",
  "phase-entry-mismatch",
  "toolchain-config-changed",
  "advisory-marker-removed",
  "tree-changed-outside-pass",
  "protected-change-not-applied",
]);

/** Row 66 of annex X §X.6: the further facts of the fact block. */
export const FURTHER_FACTS: readonly string[] = Object.freeze([
  "manifest-rederived",
  "result-of-stopped-job",
  "evidence-predates-tree",
  "source-change-accepted",
  "task-list-changed",
]);

/** A value that originates in the workspace, marked for the prompt assembler. */
export interface WorkspaceValue {
  value: string;
  origin: "workspace";
}

/** Strip control characters: the marking half of the data boundary (IR-44). */
export function stripControl(text: string): string {
  return [...text]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

/** The one marking point for a value that originates in the workspace. */
export function markWorkspaceValue(value: string): WorkspaceValue {
  return { value: stripControl(value), origin: "workspace" };
}

export interface ProtectedFactsInput {
  changedSincePhaseEntry: readonly string[];
  authorised: readonly string[];
  changedSinceLaunchInApprovedPhases: readonly string[];
  suppressionMarkers: readonly MarkerCount[];
}

export interface ProtectedFacts {
  changedSincePhaseEntry: WorkspaceValue[];
  authorised: string[];
  changedSinceLaunch: WorkspaceValue[];
  suppressionMarkers: { path: WorkspaceValue; added: number; removed: number }[];
}

/** The protected-set facts of the block, workspace values marked. */
export function protectedFactsOf(input: ProtectedFactsInput): ProtectedFacts {
  return {
    changedSincePhaseEntry: input.changedSincePhaseEntry.map(markWorkspaceValue),
    authorised: [...input.authorised],
    changedSinceLaunch: input.changedSinceLaunchInApprovedPhases.map(markWorkspaceValue),
    suppressionMarkers: input.suppressionMarkers.map((m) => ({
      path: markWorkspaceValue(m.path),
      added: m.added,
      removed: m.removed,
    })),
  };
}

/** Kinds shown to the critic: members of the closed set only, no counts. */
export function integrityKindsShown(events: readonly string[]): string[] {
  return INTEGRITY_KINDS.filter((kind) => events.includes(kind));
}

/** Further facts shown to the critic: members of their closed set only. */
export function furtherFactsShown(facts: readonly string[]): string[] {
  return FURTHER_FACTS.filter((fact) => facts.includes(fact));
}

/**
 * The rows of the ledger before the first invalid record stay (F116-FR-021).
 * A result recorded at or after `invalidFrom` gives no row; the kind
 * `ledger-invalid` tells the critic that inner results are unavailable after
 * them.
 */
export function ledgerRowsBeforeInvalid<T extends { seq: number }>(
  rows: readonly T[],
  ledgerInvalidFrom: number | null,
): T[] {
  if (ledgerInvalidFrom === null) return [...rows];
  return rows.filter((row) => row.seq < ledgerInvalidFrom);
}

/** The integrity kinds of the block, ledger invalidity included. */
export function integrityOf(events: readonly string[], ledgerInvalidFrom: number | null): string[] {
  const kinds = integrityKindsShown(events);
  if (ledgerInvalidFrom !== null && !kinds.includes("ledger-invalid")) {
    return INTEGRITY_KINDS.filter((k) => k === "ledger-invalid" || kinds.includes(k));
  }
  return kinds;
}
