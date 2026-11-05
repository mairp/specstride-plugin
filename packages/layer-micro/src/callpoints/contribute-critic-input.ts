/**
 * T048 — the call point `contributeCriticInput` (F115-FR-002, F115-FR-012;
 * annex D §D.1 row 6 and §D.7).
 *
 * The layer declares the builder of the fact block as a service of its
 * registration (see `register.ts`, `DECLARED_SERVICES`); the engine offers
 * the builder, and this point hands it the rows. The layer gives the builder
 * exactly three things: the units of work of the phase attempt, the check
 * results the runtime observed, and the task list as read at launch
 * (`run:<runId>:task-list`, F115-FR-012) — and returns the rows the builder
 * gives back, nothing else. The layer never writes the fact block itself:
 * the writer is the engine (annex D §D.7, Writer).
 *
 * Annex D §D.7 — the rows name, per unit of work, its id, the tasks it
 * named headed as the proposer's declaration, and per command the exit
 * result with each condition in separate fields (`tainted`, `flaky` with
 * both observed results, `superseded` or `current`, `cached`). Never in the
 * block, and so never in a row this layer returns: counts, order, times,
 * output of a command, earlier results, fingerprint values per row, model
 * tiers, sessions, routing decisions, whether a result came from the
 * closing check, and anything about groups or workers. The note of a
 * checkpoint never reaches a critic-class call (F115-FR-009, T-23): the row
 * type below has no note field, and the layer drops it before it builds.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import type { CheckResult } from "../unit/outcome.ts";

/** The service the layer declares and the engine offers (annex D §D.1). */
export const FACT_BLOCK_BUILDER_SERVICE = "fact-block-builder" as const;

/** One unit of work of the phase attempt, as the layer holds it. */
export type DeclaredUnit = {
  readonly unitId: string;
  /** The tasks the proposer declared, in the order of the declaration. */
  readonly tasks: readonly string[];
  /** The outcome of the check on the unit (kept, repair, unresolved, unchecked). */
  readonly outcome: string;
};

/**
 * One row of the fact block for one unit of work (annex D §D.7, field
 * `units`): the id, the tasks headed as the proposer's declaration, and per
 * command the exit result and each condition in separate fields. No note,
 * no count, no time, no output, no fingerprint value.
 */
export type FactBlockRow = {
  readonly unitId: string;
  /** Headed as the proposer's declaration. */
  readonly declaredTasks: readonly string[];
  readonly outcome: string;
  readonly commands: readonly {
    readonly id: string;
    readonly exit: number;
    readonly conditions: readonly string[];
  }[];
};

/**
 * The builder of the fact block, as the engine offers it: it receives the
 * units, the check results and the task list as read at launch, and returns
 * the rows of the block. The engine, not the layer, writes the record.
 */
export type FactBlockBuilder = {
  readonly build: (input: {
    readonly units: readonly DeclaredUnit[];
    readonly checkResults: Readonly<Record<string, readonly CheckResult[]>>;
    readonly taskListAtLaunch: {
      readonly phase: number;
      readonly taskIds: readonly string[];
      readonly hash: string;
    };
    /** The further fact `task-list-changed`, when the comparison found one (F115-FR-012). */
    readonly facts?: readonly string[];
  }) => readonly FactBlockRow[];
};

/** The input of one `contributeCriticInput` call. */
export type ContributeCriticInput = {
  readonly builder: FactBlockBuilder;
  readonly units: readonly DeclaredUnit[];
  /** Per unit id, the results the runtime observed, in manifest order. */
  readonly checkResults: Readonly<Record<string, readonly CheckResult[]>>;
  readonly taskListAtLaunch: {
    readonly phase: number;
    readonly taskIds: readonly string[];
    readonly hash: string;
  };
  /** Further facts for the block; `task-list-changed` arrives here. */
  readonly facts?: readonly string[];
};

/** What the layer returns: the rows of the fact block, and nothing else. */
export type ContributeCriticOutput = {
  readonly rows: readonly FactBlockRow[];
};

/**
 * F115-FR-002, F115-FR-012 — give the builder of the fact block the units,
 * the check results and the task list as read at launch, and return the
 * rows it gives. The note of a checkpoint is dropped here and never
 * reaches a critic-class call.
 */
export function contributeCriticInput(input: ContributeCriticInput): ContributeCriticOutput {
  const rows = input.builder.build({
    units: input.units,
    checkResults: input.checkResults,
    taskListAtLaunch: input.taskListAtLaunch,
    ...(input.facts === undefined ? {} : { facts: input.facts }),
  });
  return { rows };
}
