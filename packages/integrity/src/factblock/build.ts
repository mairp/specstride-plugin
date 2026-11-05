// T054 (F116-FR-016, F116-FR-017, F116-FR-020) — the builder of the fact
// block as a PURE function of the final state of the control plane and the
// ledger. It imports nothing that reads a file of the workspace, takes no
// path and no clock, and never orders a row by the history that reached the
// state. The schema is `specstride.fact-block/1` (annex D §D.7 of feature
// 100); the content owner is this feature.
import { canonicalRecordText } from "@specstride/kernel";
import { NOTICE, taskRows, unnamedTasksOf } from "./tasks.ts";
import {
  type ProtectedFactsInput,
  type WorkspaceValue,
  furtherFactsShown,
  integrityOf,
  ledgerRowsBeforeInvalid,
  protectedFactsOf,
} from "./facts.ts";
import type { Freshness } from "../result/freshness.ts";

export const FACT_BLOCK_SCHEMA = "specstride.fact-block/1" as const;

/** Conditions of one command, as the control plane recorded them. */
export interface CommandInput {
  id: string;
  exit: number;
  tainted?: boolean;
  cached?: boolean;
  flaky?: readonly [number, number];
  observed?: readonly [number, number];
  conditions?: { tainted?: boolean; cached?: boolean };
  output?: unknown; // never shown (F116-FR-019); accepted, dropped here
}

/** One check result of a unit, as the ledger and the control plane hold it. */
export interface ResultInput {
  ordinal: number;
  seq: number;
  treeAfter: string;
  commands: readonly CommandInput[];
}

export interface UnitInput {
  unitId: string;
  tasks: readonly string[];
  results: readonly ResultInput[];
}

export interface ExcludedCommandInput {
  commandId: string;
  reason: string;
}

/** The final state the block is a pure function of. */
export interface FactBlockInput {
  manifestHash: string;
  manifestCommands: readonly string[];
  treeFingerprint: string;
  taskOrder: readonly string[];
  units: readonly UnitInput[];
  protectedFacts: ProtectedFactsInput;
  integrityEvents: readonly string[];
  furtherFacts: readonly string[];
  excludedCommands: readonly ExcludedCommandInput[];
  ledgerInvalidFrom: number | null;
}

export interface CommandRow {
  id: string;
  exit: number;
  tainted: boolean;
  cached: boolean;
  /** Both observed results of the flakiness check (F116-FR-017). */
  flaky: [number, number];
  freshness: Freshness;
}

export interface UnitRow {
  id: string;
  declaration: string;
  tasks: string[];
  commands: CommandRow[];
}

export interface FactBlock {
  schema: typeof FACT_BLOCK_SCHEMA;
  manifestHash: string;
  commands: string[];
  treeFingerprint: string;
  units: UnitRow[];
  unnamedTasks: string[];
  notice: typeof NOTICE;
  protected: {
    changedSincePhaseEntry: WorkspaceValue[];
    authorised: string[];
    changedSinceLaunch: WorkspaceValue[];
    suppressionMarkers: { path: WorkspaceValue; added: number; removed: number }[];
  };
  integrity: string[];
  facts: string[];
  excluded: ExcludedCommandInput[];
}

const at = (list: readonly string[], value: string): number => {
  const i = list.indexOf(value);
  return i === -1 ? list.length : i;
};

/** The current result of a unit: on the phase-gate tree, else the latest. */
function currentResult(unit: UnitInput, treeFingerprint: string): ResultInput | undefined {
  const onGate = unit.results.filter((r) => r.treeAfter === treeFingerprint);
  const pool = onGate.length > 0 ? onGate : unit.results;
  return [...pool].sort((a, b) => a.ordinal - b.ordinal).at(-1);
}

function commandRow(cmd: CommandInput, treeFingerprint: string, treeAfter: string): CommandRow {
  return {
    id: cmd.id,
    exit: cmd.exit,
    tainted: cmd.tainted ?? cmd.conditions?.tainted ?? false,
    cached: cmd.cached ?? cmd.conditions?.cached ?? false,
    flaky: [...(cmd.flaky ?? cmd.observed ?? [cmd.exit, cmd.exit])] as [number, number],
    freshness: treeAfter === treeFingerprint ? "current" : "superseded",
  };
}

/**
 * Build the fact block from the final state. Returns `null` when no unit of
 * work was declared in the phase attempt and no independent integrity rule
 * found a fact (F116-FR-016).
 */
export function buildFactBlock(state: FactBlockInput): FactBlock | null {
  const validUnits = state.units
    .map((unit) => ({
      unit,
      results: ledgerRowsBeforeInvalid(unit.results, state.ledgerInvalidFrom),
    }))
    .filter((kept) => kept.results.length > 0);

  const integrity = integrityOf(state.integrityEvents, state.ledgerInvalidFrom);
  const facts = furtherFactsShown(state.furtherFacts);
  if (state.units.length === 0 && integrity.length === 0 && facts.length === 0) return null;

  const units: UnitRow[] = validUnits.map(({ unit, results }) => {
    const current = currentResult({ ...unit, results }, state.treeFingerprint)!;
    return {
      id: taskRows(state.taskOrder, [{ tasks: unit.tasks }])[0]!.id,
      declaration: "the proposer's declaration",
      tasks: [...unit.tasks],
      commands: [...current.commands]
        .sort(
          (a, b) =>
            at(state.manifestCommands, a.id) - at(state.manifestCommands, b.id) ||
            a.id.localeCompare(b.id),
        )
        .map((c) => commandRow(c, state.treeFingerprint, current.treeAfter)),
    };
  });

  return {
    schema: FACT_BLOCK_SCHEMA,
    manifestHash: state.manifestHash,
    commands: [...state.manifestCommands],
    treeFingerprint: state.treeFingerprint,
    units,
    unnamedTasks: unnamedTasksOf(state.taskOrder, state.units),
    notice: NOTICE,
    protected: protectedFactsOf(state.protectedFacts),
    integrity,
    facts,
    excluded: state.excludedCommands.map((e) => ({ commandId: e.commandId, reason: e.reason })),
  };
}

/**
 * The block as bytes: the canonical record text of annex X §X.5 — sorted
 * keys, compact separators, no final line end. Two phase attempts with the
 * same final state render byte-identical blocks (F116-FR-020).
 */
export function renderFactBlock(state: FactBlockInput): string {
  const block = buildFactBlock(state);
  return block === null ? "" : canonicalRecordText(block);
}
