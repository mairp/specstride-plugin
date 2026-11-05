/**
 * T094 — the suites and the verification gates of the plan (F105-FR-018), and
 * the two refusals a gate with no command that can run gives.
 *
 * Every phase gets `SUITE-phase-<N>` and `GATE-phase-<N>`; the release gets
 * `SUITE-release` and `GATE-release`. The obligations and the suites of a
 * verification gate are CUMULATIVE over the phases 1 to N, and `cumulative` is
 * false only for the first phase. A command declared `cumulative: false` is
 * excluded from the verification gate of every OTHER phase and still runs at
 * its own phase and at release verification — the suite stays shared, so the
 * exclusion is a list on the gate and is applied at selection.
 */
import {
  TRIM_ONLY,
  criterionText,
  type CriterionNormalizer,
  type ProjectionPhaseInput,
} from "./projection.ts";
import { holdsABuildWord } from "./obligations.ts";
import type { PlanCommand, PlanGate, PlanObligation, PlanSuite } from "./record.ts";

/** The id of the suite of a phase (F105-FR-018). */
export function suiteIdOf(phase: number): string {
  return `SUITE-phase-${phase}`;
}
/** The id of the verification gate of a phase (F105-FR-018). */
export function gateIdOf(phase: number): string {
  return `GATE-phase-${phase}`;
}
/** The id of the suite of release verification (F105-FR-018). */
export const RELEASE_SUITE_ID = "SUITE-release" as const;
/** The id of the gate of release verification (F105-FR-018). */
export const RELEASE_GATE_ID = "GATE-release" as const;

/** The name of the suite of a phase (`lib/verification_plan.py`:890). */
export function suiteNameOf(phase: number): string {
  return `Phase ${phase} focused and cumulative verification`;
}
/** The name of the suite of release verification (`:1004`). */
export const RELEASE_SUITE_NAME = "Complete release verification" as const;

/** The id of the gate a phase that has none fails with (F105-FR-018). */
export function missingGateIdOf(phase: number | "release"): string {
  return `missing-${phase}-gate`;
}
/** The summary a phase without a verification gate fails with (F105-FR-018). */
export function missingGateSummary(phase: number | "release"): string {
  return `No verification gate exists for ${phase}`;
}
/** The summary a REQUIRED gate with no command that can run fails with. */
export function requiredGateWithoutCommandsSummary(gateId: string): string {
  return `Required gate ${gateId} has no safe executable verification commands`;
}
/** The summary a gate that is NOT required and has none PASSES with (`:2158`). */
export function advisoryGateWithoutCommandsSummary(gateId: string): string {
  return `Advisory gate ${gateId} has no automated commands`;
}

/** A phase without a verification gate gives an EMPTY phase context (F105-FR-018). */
export const PHASE_CONTEXT_OF_A_PHASE_WITHOUT_A_GATE = "" as const;

/** The whole text of a phase the build-word rule searches (`:874`). */
export function phaseText(
  phase: ProjectionPhaseInput,
  normalize: CriterionNormalizer = TRIM_ONLY,
): string {
  return [
    phase.title ?? "",
    ...(phase.criteria ?? []).map((one) => criterionText(one, normalize)),
  ].join("\n");
}

/** What the suites and gates are built from. */
export type SuitesAndGatesInput = {
  readonly phases: readonly ProjectionPhaseInput[];
  readonly obligations: readonly PlanObligation[];
  /** The commands discovery found, in the order the plan holds them. */
  readonly discoveredCommands: readonly PlanCommand[];
  /** The declared commands of each phase, in the order of the document. */
  readonly declaredByPhase: ReadonlyMap<number, readonly PlanCommand[]>;
  /** True in the mode `required`: the `required` flag of every gate follows it. */
  readonly required: boolean;
  /** How the text of a criterion is read; `TRIM_ONLY` by default. */
  readonly criterionText?: CriterionNormalizer | undefined;
};

/** The suites and the gates of a plan (F105-FR-018). */
export type SuitesAndGates = {
  readonly suites: readonly PlanSuite[];
  readonly gates: readonly PlanGate[];
  /** Every declared command with `cumulative: false`, for the assumptions. */
  readonly nonCumulative: readonly PlanCommand[];
};

/**
 * The suites and the gates (F105-FR-018, `lib/verification_plan.py`:846 to
 * :916, and the release pair at :1004 and :1013).
 *
 * The suite of a phase holds every DISCOVERED TEST command; the discovered
 * BUILD command joins it only when the title or the criteria of the phase hold
 * a word of the as-is list of build words (F105-FR-017). The declared commands
 * of the phase come AFTER the discovered ones, in the order of the document
 * (F105-FR-016).
 */
export function suitesAndGates(input: SuitesAndGatesInput): SuitesAndGates {
  const testRefs = input.discoveredCommands
    .filter((command) => command.kind === "test")
    .map((command) => command.id);
  const buildRefs = input.discoveredCommands
    .filter((command) => command.kind === "build")
    .map((command) => command.id);
  const nonCumulative = [...input.declaredByPhase.values()]
    .flat()
    .filter((command) => command.cumulative === false);

  const suites: PlanSuite[] = [];
  const gates: PlanGate[] = [];
  const cumulativeObligations: string[] = [];
  const suiteIds: string[] = [];

  input.phases.forEach((phase, index) => {
    const phaseRefs = input.obligations
      .filter((obligation) => obligation.phase === phase.number)
      .map((obligation) => obligation.id);
    cumulativeObligations.push(...phaseRefs);
    const suiteId = suiteIdOf(phase.number);
    suiteIds.push(suiteId);
    const commandRefs = [...testRefs];
    if (
      buildRefs.length > 0 &&
      holdsABuildWord(phaseText(phase, input.criterionText ?? TRIM_ONLY))
    ) {
      for (const ref of buildRefs) if (!commandRefs.includes(ref)) commandRefs.push(ref);
    }
    for (const command of input.declaredByPhase.get(phase.number) ?? []) {
      if (!commandRefs.includes(command.id)) commandRefs.push(command.id);
    }
    suites.push(
      Object.freeze({
        id: suiteId,
        name: suiteNameOf(phase.number),
        scope: "phase" as const,
        phase: phase.number,
        obligationRefs: Object.freeze([...phaseRefs]),
        commandRefs: Object.freeze(commandRefs),
      }),
    );
    const excluded = nonCumulative
      .filter((command) => command.phase !== phase.number)
      .map((command) => command.id)
      .sort();
    gates.push(
      Object.freeze({
        id: gateIdOf(phase.number),
        scope: "phase" as const,
        phase: phase.number,
        obligationRefs: Object.freeze([...cumulativeObligations]),
        suiteRefs: Object.freeze([...suiteIds]),
        // `cumulative` is false only for the FIRST phase (F105-FR-018).
        cumulative: index > 0,
        required: Boolean(input.required),
        ...(excluded.length > 0 ? { excludedCommandRefs: Object.freeze(excluded) } : {}),
      }),
    );
  });

  return Object.freeze({
    suites: Object.freeze(suites),
    gates: Object.freeze(gates),
    nonCumulative: Object.freeze(nonCumulative),
  });
}

/** The suite and the gate of release verification (F105-FR-018). */
export function releaseSuiteAndGate(input: {
  readonly obligations: readonly PlanObligation[];
  readonly commands: readonly PlanCommand[];
  readonly required: boolean;
}): { readonly suite: PlanSuite; readonly gate: PlanGate } {
  const allRefs = input.obligations.map((obligation) => obligation.id);
  return Object.freeze({
    suite: Object.freeze({
      id: RELEASE_SUITE_ID,
      name: RELEASE_SUITE_NAME,
      scope: "release" as const,
      obligationRefs: Object.freeze([...allRefs]),
      commandRefs: Object.freeze(input.commands.map((command) => command.id)),
    }),
    gate: Object.freeze({
      id: RELEASE_GATE_ID,
      scope: "release" as const,
      obligationRefs: Object.freeze([...allRefs]),
      suiteRefs: Object.freeze([RELEASE_SUITE_ID]),
      cumulative: true,
      required: Boolean(input.required),
    }),
  });
}

/**
 * The commands a verification gate selects, from the PLAN: the commands of
 * every suite the gate names, in order, each once, LESS the ones it excludes
 * (`lib/verification_plan.py`:2135). The derivation of the manifest selects
 * the same commands from the manifests of those phases (F105-FR-020).
 */
export function commandIdsOfGate(input: {
  readonly gate: PlanGate;
  readonly suites: readonly PlanSuite[];
}): readonly string[] {
  const bySuite = new Map(input.suites.map((suite) => [suite.id, suite]));
  const excluded = new Set(input.gate.excludedCommandRefs ?? []);
  const ids: string[] = [];
  for (const suiteId of input.gate.suiteRefs) {
    for (const commandId of bySuite.get(suiteId)?.commandRefs ?? []) {
      if (!ids.includes(commandId) && !excluded.has(commandId)) ids.push(commandId);
    }
  }
  return Object.freeze(ids);
}

/** The verification gate of a phase, or of the release, or `undefined`. */
export function gateOfThePlan(
  gates: readonly PlanGate[],
  phase: number | "release",
): PlanGate | undefined {
  return phase === "release"
    ? gates.find((gate) => gate.scope === "release")
    : gates.find((gate) => gate.scope === "phase" && gate.phase === phase);
}
