/**
 * T087, T088, T094, T095 — the DERIVATION of the verification plan: the plan
 * record with its ids and its hashes (F105-FR-011), its binding to the source
 * hashes and the projection `tasks-v2` (F105-FR-012), its verification
 * obligations (F105-FR-014), its suites and gates (F105-FR-018), and the
 * refusal of an ambiguous plan in the mode `required` (F105-FR-019).
 *
 * It is written NEW on the canonical spec model (`research.md` D-1): the
 * phases, their titles and their criteria come from the model of EP-03 and
 * from no reading of a specification of this feature's own. It reads no file
 * by itself either — discovery, the verification-commands document and the
 * revision of the working tree arrive as values, so the derivation is a pure
 * function of what the sources gave it and a test can drive it without a tree.
 *
 * The field ORDER of the record below is immaterial to the hash — the
 * canonical record text sorts the keys — but the SET of fields is not: a field
 * the baseline omits when it holds its default must stay omitted, or the plan
 * hash moves and parity fails.
 */
import type { CanonicalSpecModel } from "@specstride/contracts/records/canonical-spec-model";
import type { Provenance } from "@specstride/contracts/ep/verification-source";
import { bundleIdOf, planContentHash, planIdOf } from "./hash.ts";
import {
  SPEC_PROJECTION,
  specProjectionHash,
  type CriterionNormalizer,
  type DeclaredCommandsBinding,
  type ProjectionPhaseInput,
} from "./projection.ts";
import { automationStatusOf, obligationsOf } from "./obligations.ts";
import { releaseSuiteAndGate, suitesAndGates } from "./suites.ts";
import { refuseAnAmbiguousPlan } from "./required.ts";
import {
  VerificationError,
  PLAN_KIND,
  PLAN_VERSION,
  type PlanCommand,
  type VerificationPlan,
} from "./record.ts";
import { validatePlan } from "./validate.ts";

/* ------------------------------------------------------------------ *
 * The provenance of a command, which travels BESIDE the plan.
 * ------------------------------------------------------------------ */

/**
 * Every command carries its provenance — the file and the line it was declared
 * on (F105-FR-015) — and the provenance is NOT a field of the plan record.
 *
 * It cannot be. `contentHash` is the hash of the whole plan but that one field
 * (F105-FR-011), and the fixtures compare it against the baseline's unchanged
 * (rule "Hash, same class" of the normalization contract). A field the
 * baseline does not write would move the hash of EVERY plan that has a
 * declared command, and every parity row of this feature would fail. So the
 * plan record holds the baseline's fields, and the provenance of every command
 * travels beside it as `DerivedPlan.provenance`, keyed by command id — which
 * is what the check manifest reads for its own required `provenance` field
 * (F105-FR-020; annex D §D.8).
 *
 * `steps` and `resource` are the other way round on purpose: CQ-216 lets the
 * document declare them, they have NO as-is equivalent, and they appear only
 * where a document declares them — so a plan that carries one is not a plan
 * the baseline could have written, and no parity row compares it.
 */
export const PROVENANCE_IS_A_FIELD_OF_THE_PLAN = false as const;

/** The fields of a command of the plan, as the baseline writes them. */
export const PLAN_COMMAND_FIELDS_OF_THE_BASELINE = [
  "id",
  "kind",
  "label",
  "executable",
  "args",
  "cwd",
  "timeoutSec",
  "source",
  "declaredId",
  "phase",
  "env",
  "stage",
  "reportPath",
  "reusePolicy",
  "detached",
  "cumulative",
] as const;

/** One command as the PLAN holds it: without its provenance. */
export function planCommandOf(command: PlanCommand): PlanCommand {
  const { provenance: _provenance, ...rest } = command;
  return rest as PlanCommand;
}

/** The provenance of every command that carries one, keyed by command id. */
export function provenanceIndex(commands: readonly PlanCommand[]): ReadonlyMap<string, Provenance> {
  const index = new Map<string, Provenance>();
  for (const command of commands) {
    if (command.provenance !== undefined) index.set(command.id, command.provenance);
  }
  return index;
}

/** The plan and the provenance of its commands (F105-FR-011, F105-FR-015). */
export type DerivedPlan = {
  readonly plan: VerificationPlan;
  /** The file and the line each command was declared on, by command id. */
  readonly provenance: ReadonlyMap<string, Provenance>;
};

/** The one assumption the derivation always adds (`lib/verification_plan.py`:1022). */
export const DERIVED_COMPANION_ASSUMPTION =
  "The verification plan is a derived companion artifact; it does not mutate the authoritative specification." as const;

/** The assumption a document with `"discovery": "none"` adds (`:757`). */
export function discoveryIsOffAssumption(documentPath: string): string {
  return (
    `Discovered commands are disabled by ${documentPath} ("discovery": "none"); ` +
    "the gates run only its declared commands."
  );
}

/** The assumption that replaces the no-test ambiguity (`:938`). */
export function declaredInsteadAssumption(input: {
  readonly workdir: string;
  readonly count: number;
  readonly documentPath: string;
}): string {
  return (
    `No test command was discovered below ${input.workdir}; the gates run the ` +
    `${input.count} declared command(s) from ${input.documentPath} instead.`
  );
}

/** The assumption every non-cumulative command is reported with (`:952`). */
export function nonCumulativeAssumption(declaredIds: readonly string[]): string {
  return (
    `Declared command(s) ${[...declaredIds].sort().join(", ")} are non-cumulative ` +
    "(cumulative: false): they gate at their own phase and at GATE-release only, and " +
    "later phase gates do not re-run them."
  );
}

/** The assumption every pre-staged command is reported with (`:966`). */
export function preStagedAssumption(declaredIds: readonly string[]): string {
  return (
    `Declared command(s) ${[...declaredIds].sort().join(", ")} are pre-staged: they run ` +
    "once per attempt before the proposer, and a PASSING pre-stage may satisfy the gate " +
    "at the same revision with a clean tree (the gate records where the result came from)."
  );
}

/** The refusal of a declared phase the specification does not define (`:774`). */
export function orphanPhasesMessage(input: {
  readonly orphans: readonly number[];
  readonly specPhases: readonly number[];
}): string {
  return (
    `verification commands name phase(s) ${input.orphans.join(", ")}, which the ` +
    `specification does not define (it has ${[...input.specPhases].sort((a, b) => a - b).join(", ")})`
  );
}

/** What discovery contributed, as the derivation reads it. */
export type DiscoveryInput = {
  readonly workdir: string;
  readonly fingerprint: string;
  readonly frameworks: readonly string[];
  readonly commands: readonly PlanCommand[];
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly string[];
};

/** What the verification-commands document contributed. */
export type DeclaredInput = {
  readonly path: string;
  readonly contentHash: string;
  readonly schemaVersion: unknown;
  readonly commands: readonly PlanCommand[];
  readonly discovery?: string | undefined;
};

/** What the derivation is given (F105-FR-011, F105-FR-012). */
export type CreatePlanInput = {
  /** The real, absolute place of the specification. */
  readonly specPath: string;
  /** The canonical spec model of EP-03, or its phases and its format. */
  readonly model:
    | Pick<CanonicalSpecModel, "format" | "phases">
    | {
        readonly format: string;
        readonly phases: readonly ProjectionPhaseInput[];
      };
  readonly discovery: DiscoveryInput;
  readonly declared?: DeclaredInput | undefined;
  /** True in the mode `required`: every gate's `required` flag follows it. */
  readonly required?: boolean | undefined;
  /** Further ambiguities the plan sources gave, the blockers among them. */
  readonly ambiguitiesFromSources?: readonly string[] | undefined;
  /**
   * How the text of a criterion is read (`TRIM_ONLY` by default): the
   * stripping of a checkbox belongs to the grammar owner, EP-03, and this
   * package holds no reader of it (F104-SC-001; see `./projection.ts`).
   */
  readonly criterionText?: CriterionNormalizer | undefined;
};

/** The as-is ambiguity of a project with no test command (F105-FR-017). */
export function noTestCommandAmbiguityOf(workdir: string): string {
  return (
    `No safe automated test command was discovered below ${workdir}; required ` +
    "verification cannot start until one is configured"
  );
}

/** The ambiguity that names the phases without a command (F105-FR-017). */
export function phasesWithoutCommandAmbiguityOf(phases: readonly number[]): string {
  return (
    `Phase(s) ${phases.join(", ")} have neither a discovered nor a declared verification ` +
    "command; their gates would execute nothing"
  );
}

/**
 * Derive the verification plan (F105-FR-011 to F105-FR-014, F105-FR-018,
 * F105-FR-019). The plan it returns is VALIDATED before it is returned, as the
 * baseline validates it (`lib/verification_plan.py`:1052), so a derivation
 * that produced an unloadable plan is a refusal and never a written file.
 */
export function createPlan(input: CreatePlanInput): VerificationPlan {
  const phases = input.model.phases as readonly ProjectionPhaseInput[];
  const workdir = input.discovery.workdir;
  let discovery = input.discovery;
  const extraAssumptions: string[] = [];

  // `"discovery": "none"` removes every discovered command (F105-FR-016). The
  // fingerprint, the frameworks and the assumptions stay on record; the
  // no-test ambiguity is re-asserted so the check below still names a phase
  // left without one.
  if (input.declared?.discovery === "none") {
    const ambiguities = [...discovery.ambiguities];
    const resolved = noTestCommandAmbiguityOf(workdir);
    if (!ambiguities.includes(resolved)) ambiguities.push(resolved);
    discovery = Object.freeze({
      ...discovery,
      commands: Object.freeze([]),
      ambiguities: Object.freeze(ambiguities),
      assumptions: Object.freeze([
        ...discovery.assumptions,
        discoveryIsOffAssumption(input.declared.path),
      ]),
    });
  }

  const declaredByPhase = new Map<number, PlanCommand[]>();
  if (input.declared !== undefined) {
    for (const command of input.declared.commands) {
      const phase = command.phase ?? 0;
      const list = declaredByPhase.get(phase) ?? [];
      list.push(command);
      declaredByPhase.set(phase, list);
    }
    const specPhases = new Set(phases.map((phase) => phase.number));
    const orphans = [...declaredByPhase.keys()]
      .filter((phase) => !specPhases.has(phase))
      .sort((a, b) => a - b);
    if (orphans.length > 0) {
      throw new VerificationError(orphanPhasesMessage({ orphans, specPhases: [...specPhases] }));
    }
  }

  const normalize = input.criterionText;
  const specHash = specProjectionHash({
    format: input.model.format,
    phases,
    ...(normalize !== undefined ? { criterionText: normalize } : {}),
  });
  const bundleId = bundleIdOf({
    specPath: input.specPath,
    format: input.model.format,
    specHash,
  });
  const obligations = obligationsOf({
    bundleId,
    phases,
    automationStatus: automationStatusOf(discovery.commands),
    ...(normalize !== undefined ? { criterionText: normalize } : {}),
  });

  const built = suitesAndGates({
    phases,
    obligations,
    discoveredCommands: discovery.commands,
    declaredByPhase,
    required: Boolean(input.required),
    ...(normalize !== undefined ? { criterionText: normalize } : {}),
  });

  const ambiguities = [...discovery.ambiguities, ...(input.ambiguitiesFromSources ?? [])];
  if (declaredByPhase.size > 0 && input.declared !== undefined) {
    // "no test command was discovered" stops being true the moment the caller
    // declares commands the gates will execute — but only when EVERY phase has
    // one. A phase with neither has an empty gate, and that is caught here and
    // not hours later at the gate.
    const uncovered = phases
      .filter((phase) => (declaredByPhase.get(phase.number) ?? []).length === 0)
      .map((phase) => phase.number)
      .sort((a, b) => a - b);
    const resolved = noTestCommandAmbiguityOf(workdir);
    const at = ambiguities.indexOf(resolved);
    if (at !== -1 && uncovered.length === 0) {
      ambiguities.splice(at, 1);
      extraAssumptions.push(
        declaredInsteadAssumption({
          workdir,
          count: input.declared.commands.length,
          documentPath: input.declared.path,
        }),
      );
    } else if (at !== -1) {
      ambiguities.push(phasesWithoutCommandAmbiguityOf(uncovered));
    }
    if (built.nonCumulative.length > 0) {
      extraAssumptions.push(
        nonCumulativeAssumption(
          built.nonCumulative.map((command) => command.declaredId ?? command.id),
        ),
      );
    }
    const preStaged = [...declaredByPhase.values()]
      .flat()
      .filter((command) => command.stage === "prestage" || command.stage === "both");
    if (preStaged.length > 0) {
      extraAssumptions.push(
        preStagedAssumption(preStaged.map((command) => command.declaredId ?? command.id)),
      );
    }
  }

  const allCommands: readonly PlanCommand[] = Object.freeze([
    ...discovery.commands,
    ...(input.declared?.commands ?? []),
  ]);
  const release = releaseSuiteAndGate({
    obligations,
    commands: allCommands,
    required: Boolean(input.required),
  });

  const declaredCommands: DeclaredCommandsBinding | undefined =
    input.declared === undefined
      ? undefined
      : Object.freeze({
          path: input.declared.path,
          contentHash: input.declared.contentHash,
          schemaVersion: input.declared.schemaVersion ?? null,
          count: input.declared.commands.length,
          phases: Object.freeze([...declaredByPhase.keys()].sort((a, b) => a - b)),
          ...(input.declared.discovery !== undefined
            ? { discovery: input.declared.discovery }
            : {}),
        });

  const withoutHash = {
    id: planIdOf({
      bundleId,
      specHash,
      fingerprint: discovery.fingerprint,
      declaredCommandsHash: input.declared?.contentHash,
    }),
    kind: PLAN_KIND,
    version: PLAN_VERSION,
    source: {
      bundleId,
      contentHash: specHash,
      projection: SPEC_PROJECTION,
      specPath: input.specPath,
    },
    project: {
      workdir,
      fingerprint: discovery.fingerprint,
      frameworks: [...discovery.frameworks],
    },
    obligations: obligations.map((one) => ({ ...one })),
    // Without the provenance, which travels beside the plan (see above).
    commands: allCommands.map((one) => planCommandOf(one)),
    suites: [...built.suites.map((one) => ({ ...one })), { ...release.suite }],
    gates: [...built.gates.map((one) => ({ ...one })), { ...release.gate }],
    assumptions: [...discovery.assumptions, ...extraAssumptions, DERIVED_COMPANION_ASSUMPTION],
    ambiguities,
    unsupportedCapabilities: [] as string[],
    ...(declaredCommands !== undefined ? { declaredCommands: { ...declaredCommands } } : {}),
  };

  const plan = { ...withoutHash, contentHash: planContentHash(withoutHash) };
  return validatePlan(plan) as VerificationPlan;
}

/**
 * Derive the plan AND make the check of the mode `required` (F105-FR-019):
 * what the preflight of F105-FR-004 calls, so an ambiguous plan is never
 * written in that mode. It returns the plan TOGETHER WITH the provenance of
 * its commands, because the check manifest needs both (F105-FR-015,
 * F105-FR-020).
 */
export function derivePlan(input: CreatePlanInput): DerivedPlan {
  const plan = refuseAnAmbiguousPlan({
    plan: createPlan(input),
    required: Boolean(input.required),
  });
  return Object.freeze({
    plan,
    provenance: provenanceIndex([...input.discovery.commands, ...(input.declared?.commands ?? [])]),
  });
}
