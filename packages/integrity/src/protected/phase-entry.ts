// T040 (F116-FR-012; IR-33) — the comparison of the tree at phase entry with
// the approved tree, behind its own switch, on by default, independent of the
// loop strategy. A difference is an integrity event of the kind
// `phase-entry-mismatch`, the differing protected paths are facts for the
// critic, and the run is NOT blocked.
export const PHASE_ENTRY_SWITCH_KEY = "integrity.phase_entry";
export const PHASE_ENTRY_SWITCH_DEFAULT = "on";

export type SwitchValue = "on" | "off";

/** The value of the switch, from the profile rows (row 32, DV-077). */
export function phaseEntrySwitch(overrides: Record<string, SwitchValue>): SwitchValue {
  return overrides[PHASE_ENTRY_SWITCH_KEY] ?? PHASE_ENTRY_SWITCH_DEFAULT;
}

export interface PhaseEntryOutcome {
  checked: boolean;
  event: { kind: "phase-entry-mismatch"; paths: string[] } | null;
  factsForCritic: { phaseEntryMismatch: string[] };
  blocked: false;
}

/** The comparison of the tree at phase entry with the approved tree. */
export function comparePhaseEntry(input: {
  overrides: Record<string, SwitchValue>;
  entryTree: string;
  approvedTree: string;
  changedPaths: string[];
}): PhaseEntryOutcome {
  if (phaseEntrySwitch(input.overrides) === "off") {
    return {
      checked: false,
      event: null,
      factsForCritic: { phaseEntryMismatch: [] },
      blocked: false,
    };
  }
  const differs = input.entryTree !== input.approvedTree;
  return {
    checked: true,
    event: differs ? { kind: "phase-entry-mismatch", paths: input.changedPaths } : null,
    factsForCritic: { phaseEntryMismatch: differs ? input.changedPaths : [] },
    blocked: false,
  };
}
