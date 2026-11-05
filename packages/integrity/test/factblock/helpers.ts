// Shared helpers of the characterization tests CT-116-16 to CT-116-146
// (feature 116, phase 4, user story 2). The fact block is built from the
// control plane only, so every fixture here is a control-plane record: the
// "two histories" fixtures of tests/integrity/116/two-histories/.
import { readFileSync } from "node:fs";
import type { FactBlockInput } from "../../src/factblock/build.ts";

export const REPO_ROOT = new URL("../../../../", import.meta.url);

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, REPO_ROOT), "utf8")) as T;
}

export interface FixtureCommand {
  id: string;
  exit: number;
  conditions?: { tainted?: boolean; cached?: boolean; flaky?: boolean };
  observed?: [number, number];
}

export interface FixtureResult {
  schema?: string;
  unitId: string;
  ordinal: number;
  treeBefore: string;
  treeAfter: string;
  commands: FixtureCommand[];
}

export interface FixtureUnit {
  unitId: string;
  tasks: string[];
  current: FixtureResult;
}

export interface FixtureState {
  schema: string;
  note: string;
  taskOrder: string[];
  units: FixtureUnit[];
  phaseGate: { tree: string; protectedSet: string };
}

export interface FixtureHistory {
  schema: string;
  history: "a" | "b";
  note: string;
  declarationOrder: string[];
  checkResults: FixtureResult[];
}

export const finalState = (): FixtureState =>
  readJson("tests/integrity/116/two-histories/final-state.json");
export const historyOf = (name: "a" | "b"): FixtureHistory =>
  readJson(`tests/integrity/116/two-histories/history-${name}/check-results.json`);

export const MANIFEST_HASH = "manifest-hash-116-two-histories";
export const MANIFEST_COMMANDS = ["check:u1:tsc", "check:u2:node-test"];

function protectedFacts(): FactBlockInput["protectedFacts"] {
  return {
    changedSincePhaseEntry: ["src/parser.ts"],
    authorised: ["src/parser.ts"],
    changedSinceLaunchInApprovedPhases: [],
    suppressionMarkers: [{ path: "test/parser.test.ts", added: 1, removed: 0 }],
  };
}

function baseInput(state: FixtureState): FactBlockInput {
  return {
    manifestHash: MANIFEST_HASH,
    manifestCommands: MANIFEST_COMMANDS,
    treeFingerprint: state.phaseGate.tree,
    taskOrder: state.taskOrder,
    units: [],
    protectedFacts: protectedFacts(),
    integrityEvents: [],
    furtherFacts: [],
    excludedCommands: [],
    ledgerInvalidFrom: null,
  };
}

/** Control-plane input of the builder, from the one final state. */
export function inputFromFinalState(state: FixtureState): FactBlockInput {
  const input = baseInput(state);
  input.units = state.units.map((u) => ({
    unitId: u.unitId,
    tasks: u.tasks,
    results: [
      {
        ordinal: u.current.ordinal,
        seq: 1,
        treeAfter: u.current.treeAfter,
        commands: u.current.commands,
      },
    ],
  }));
  return input;
}

/**
 * Control-plane input built from one history's full list of check results,
 * the way the control plane holds them before the builder derives the final
 * state: per unit the builder keeps only the result on the phase-gate tree.
 */
export function inputFromHistory(name: "a" | "b"): FactBlockInput {
  const state = finalState();
  const history = historyOf(name);
  const input = baseInput(state);
  input.units = state.units.map((u) => ({
    unitId: u.unitId,
    tasks: u.tasks,
    results: history.checkResults
      .filter((r) => r.unitId === u.unitId)
      .map((r, i) => ({
        ordinal: r.ordinal,
        seq: i + 2,
        treeAfter: r.treeAfter,
        commands: r.commands,
      })),
  }));
  return input;
}
