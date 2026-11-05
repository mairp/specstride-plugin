/**
 * T019 — the stage graph (F123-FR-019).
 *
 * The graph is serial: every group holds exactly one stage, in the order of
 * the launch contract, so the resume predicate is defined over groups and a
 * relaunch always resumes from the one stage that stopped. No parallel unit
 * is declared here; feature 142 composes its own graph above this one.
 */
import type { Stage } from "./types.ts";

/** One group of the graph: the stages that run together. Serial: exactly one. */
export type StageGroup = {
  index: number;
  stages: [Stage];
};

/** The declared graph of a contract. */
export type StageGraph = {
  mode: "serial";
  groups: StageGroup[];
};

/** Declare the graph of the ordered stages: serial, groups of one stage. */
export function declareStageGraph(stages: readonly Stage[]): StageGraph {
  return {
    mode: "serial",
    groups: stages.map((stage, index) => ({ index, stages: [stage] })),
  };
}

/** The resume predicate over groups: the first group that is not complete. */
export function resumeGroup(
  graph: StageGraph,
  completedStageIds: ReadonlySet<string>,
): StageGroup | null {
  for (const group of graph.groups) {
    if (!group.stages.every((stage) => completedStageIds.has(stage.id))) return group;
  }
  return null;
}
