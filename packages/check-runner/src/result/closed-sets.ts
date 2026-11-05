/**
 * T008 — the closed sets of the check runner, with their unknown-value
 * branches (annex X §X.6, rows 53, 54, 233, 235 and 236; F100-FR-208,
 * F100-FR-209; F148-FR-003, F148-FR-004, F148-FR-009, F148-FR-012).
 *
 * Feature 100 owns the table of §X.6 and exports one set per row. This module
 * is the registration of the five rows feature 148 owns, in the form the
 * runner reads them: row 53 is three sets of its own, because the row carries
 * the conditions, the reasons of `tainted` and the reasons of `unchecked`
 * side by side; row 233 holds the two members the check runner may set, and
 * leaves `DEADLINE` with its owner, feature 105.
 *
 * Every set here carries a BRANCH FOR THE UNKNOWN VALUE: F100-FR-209 says a
 * reader without one fails, so `read` never throws and never guesses — it
 * returns the decision the column "unknown value" of the row states, and
 * `members` is checked against the row of the annex at load, so the set and
 * the table cannot drift.
 *
 * Two of the five rows state their unknown value as prose that names no
 * member — row 233 "The command counts as failed" and row 236 "The command
 * runs alone". The generic rule of feature 100 (`unknownValueRuleOf`) reads
 * such a cell as `refuse`, which is the safe fallback but not the decision of
 * the row; the branch of this feature carries the decision in the fields
 * `countsAsFailed` and `runsAlone`, and the outcome of feature 100 travels
 * beside it, so neither reading is lost.
 */
import {
  rowOf,
  unknownValueRuleOf,
  type ClosedSetRow,
  type UnknownValueOutcome,
} from "@specstride/contracts/enums";
import featureSets from "../../data/closed-sets.json" with { type: "json" };

/* ------------------------------------------------------------------ *
 * The members, as types and as tuples.
 * ------------------------------------------------------------------ */

/** Row 53 — the conditions of a result, each a field of its own (F148-FR-003). */
export const RESULT_CONDITIONS = [
  "tainted",
  "cached",
  "flaky",
  "interrupted",
  "unchecked",
] as const;
export type ResultCondition = (typeof RESULT_CONDITIONS)[number];

/** Row 53 — the reasons of `tainted` (F148-FR-006, F148-FR-010). */
export const TAINTED_REASONS = [
  "changed-during-check",
  "protected-set-changed",
  "pin-mismatch",
] as const;
export type TaintedReason = (typeof TAINTED_REASONS)[number];

/** Row 53 — the reasons of `unchecked` (F148-FR-003, F148-FR-009). */
export const UNCHECKED_REASONS = [
  "no-command",
  "slow",
  "budget",
  "flaky-excluded",
  "gate-not-executing",
  "partial",
  "unknown-condition",
] as const;
export type UncheckedReason = (typeof UNCHECKED_REASONS)[number];

/** Row 54 — the errors of the check runner (F148-FR-004). */
export const RUNNER_ERRORS = ["cannot-start", "timeout", "interrupted"] as const;
export type RunnerError = (typeof RUNNER_ERRORS)[number];

/**
 * Row 233 — the signals of a result that has no exit code, as the check
 * runner may set them. The row holds a third member, `DEADLINE`, whose owner
 * is feature 105; the check runner never sets it (F148-FR-004).
 */
export const RESULT_SIGNALS = ["TIMEOUT", "EXEC_ERROR"] as const;
export type ResultSignal = (typeof RESULT_SIGNALS)[number];

/** The member of row 233 that belongs to another feature, with its owner. */
export const SIGNAL_OF_ANOTHER_FEATURE = Object.freeze({
  member: "DEADLINE",
  owner: "105",
  reason: "the deadline of a phase attempt is set by feature 105, never by the check runner",
} as const);

/** Row 235 — the state of a run of steps (F148-FR-009). */
export const STEP_RUN_STATES = ["full", "partial"] as const;
export type StepRunState = (typeof STEP_RUN_STATES)[number];

/** Row 236 — the reasons of an admission to a batch (F148-FR-012). */
export const ADMISSION_REASONS = [
  "disjoint",
  "undeclared",
  "reads-written",
  "writes-overlap",
  "follows-writer",
  "exclusive",
  "steps",
  "demoted",
] as const;
export type AdmissionReason = (typeof ADMISSION_REASONS)[number];

/* ------------------------------------------------------------------ *
 * The branch for the unknown value.
 * ------------------------------------------------------------------ */

/**
 * What the runner does with a value outside one of its sets. The branch of a
 * set returns one of these, so that a caller reads a decision and not an
 * exception (F100-FR-209).
 */
export type UnknownBranch<M extends string> = {
  /** The member the value is read as, where the row names one. */
  readonly member: M | undefined;
  /** The condition the row puts on the result, where it puts one. */
  readonly condition?: ResultCondition | undefined;
  /** The reason the row puts beside the condition, where it puts one. */
  readonly reason?: string | undefined;
  /** True where the row says the value is carried through as text. */
  readonly shownAsText?: boolean | undefined;
  /** True where the row says the command counts as failed. */
  readonly countsAsFailed?: boolean | undefined;
  /** True where the row says the command runs alone. */
  readonly runsAlone?: boolean | undefined;
  /**
   * Where the value IS a member of the row of §X.6 but of another feature's
   * part of it, the feature that owns that member. Row 233 is the one such
   * row: `DEADLINE` is a member of the row and belongs to feature 105.
   */
  readonly ownedByAnotherFeature?: string | undefined;
  /** The outcome of the rule of §X.6, as feature 100 computes it. */
  readonly outcome: UnknownValueOutcome;
};

/** The branch of a set, as a function of the value that was read. */
export type UnknownValueBranch<M extends string> = (
  value: string,
  outcome: UnknownValueOutcome,
) => UnknownBranch<M>;

/* ------------------------------------------------------------------ *
 * A set of this feature.
 * ------------------------------------------------------------------ */

/** A closed set of the check runner: the row, the members and the branch. */
export type RunnerClosedSet<M extends string> = {
  /** The name this feature gives the set, as `data/closed-sets.json` writes it. */
  readonly name: string;
  /** The number of the row of annex X §X.6. */
  readonly number: number;
  /** The row of the annex, as feature 100 holds it. */
  readonly row: ClosedSetRow;
  /** The feature that owns the row. */
  readonly owner: string;
  /** The members, as a readonly tuple. */
  readonly members: readonly M[];
  /** The cell "unknown value" of the row, verbatim. */
  readonly unknownValue: string;
  /** True when the value is a member. */
  has(value: string): value is M;
  /** What a reader does with a value outside the set, per §X.6. */
  onUnknown(value: string): UnknownValueOutcome;
  /** The branch for the unknown value; it never throws (F100-FR-209). */
  branch(value: string): UnknownBranch<M>;
  /** The member, or `undefined` where the branch names none. */
  read(value: string): M | undefined;
};

/** A registration this module refuses. */
export class RunnerClosedSetError extends Error {
  readonly setName: string;
  constructor(setName: string, message: string) {
    super(message);
    this.name = "RunnerClosedSetError";
    this.setName = setName;
  }
}

type FeatureSetEntry = {
  row: number;
  name: string;
  members: string[];
  closedBy: string;
  unknown: string;
  note?: string;
};

const FEATURE_SETS: readonly FeatureSetEntry[] = Object.freeze(
  (featureSets as { sets: FeatureSetEntry[] }).sets,
);

const REGISTRY = new Map<string, RunnerClosedSet<string>>();

/**
 * Build a set of this feature from its row of §X.6 and its members, with the
 * branch for the unknown value, and register it under its name. The row must
 * exist, the row must be owned by feature 148, the members must all be
 * members of the row, and `data/closed-sets.json` must hold the same members
 * under the same name: a set that drifts from the annex is refused here and
 * not at the first check that reads it.
 */
function defineRunnerSet<const M extends readonly string[]>(
  number: number,
  name: string,
  members: M,
  branch: UnknownValueBranch<M[number]>,
): RunnerClosedSet<M[number]> {
  const row = rowOf(number);
  if (row === undefined) {
    throw new RunnerClosedSetError(
      name,
      `annex X §X.6 holds no row ${number}; the check runner registers only rows of the ` +
        `annex (F100-FR-208)`,
    );
  }
  if (!/\b148\b/.test(row.owner)) {
    throw new RunnerClosedSetError(
      name,
      `row ${number} ("${row.name}") of annex X §X.6 names ${row.owner} as its owner; ` +
        `feature 148 does not register a set of another feature (F100-FR-208)`,
    );
  }
  const notInTheRow = members.filter((m) => !row.literals.includes(m));
  if (notInTheRow.length > 0) {
    throw new RunnerClosedSetError(
      name,
      `the members ${notInTheRow.join(", ")} of "${name}" are not members of row ` +
        `${number} of annex X §X.6 (F100-FR-208)`,
    );
  }
  const declared = FEATURE_SETS.find((s) => s.row === number && s.name === name);
  if (declared === undefined) {
    throw new RunnerClosedSetError(
      name,
      `packages/check-runner/data/closed-sets.json holds no set "${name}" of row ${number}`,
    );
  }
  const drift = [
    ...declared.members.filter((m) => !(members as readonly string[]).includes(m)),
    ...members.filter((m) => !declared.members.includes(m)),
  ];
  if (drift.length > 0) {
    throw new RunnerClosedSetError(
      name,
      `the members of "${name}" differ from packages/check-runner/data/closed-sets.json: ` +
        `${drift.join(", ")}`,
    );
  }
  if (REGISTRY.has(name)) {
    throw new RunnerClosedSetError(name, `the set "${name}" is registered twice (F100-FR-208)`);
  }
  const rule = unknownValueRuleOf(row.unknownValue);
  const list = Object.freeze([...members]) as readonly M[number][];
  const onUnknown = (value: string): UnknownValueOutcome => rule(value, row.name);
  const set: RunnerClosedSet<M[number]> = Object.freeze({
    name,
    number: row.number,
    row,
    owner: row.owner,
    members: list,
    unknownValue: row.unknownValue,
    has(value: string): value is M[number] {
      return (list as readonly string[]).includes(value);
    },
    onUnknown,
    branch(value: string): UnknownBranch<M[number]> {
      return branch(value, onUnknown(value));
    },
    read(value: string): M[number] | undefined {
      if ((list as readonly string[]).includes(value)) return value as M[number];
      return branch(value, onUnknown(value)).member;
    },
  });
  REGISTRY.set(name, set as RunnerClosedSet<string>);
  return set;
}

/* ------------------------------------------------------------------ *
 * The five rows, each with its branch for the unknown value.
 * ------------------------------------------------------------------ */

/**
 * Row 53, the conditions. Unknown value: an unknown condition makes the
 * result `unchecked` with the reason `unknown-condition`.
 */
export const resultConditions = defineRunnerSet(
  53,
  "result-conditions",
  RESULT_CONDITIONS,
  (_value, outcome) => ({
    member: "unchecked",
    condition: "unchecked",
    reason: "unknown-condition",
    outcome,
  }),
);

/**
 * Row 53, the reasons of `tainted`. Unknown value: the result stays
 * `tainted` and the reason is shown as text.
 */
export const taintedReasons = defineRunnerSet(
  53,
  "tainted-reasons",
  TAINTED_REASONS,
  (value, outcome) => ({
    member: undefined,
    condition: "tainted",
    reason: value,
    shownAsText: true,
    outcome,
  }),
);

/**
 * Row 53, the reasons of `unchecked`. Unknown value: the result stays
 * `unchecked` and the reason is shown as text.
 */
export const uncheckedReasons = defineRunnerSet(
  53,
  "unchecked-reasons",
  UNCHECKED_REASONS,
  (value, outcome) => ({
    member: undefined,
    condition: "unchecked",
    reason: value,
    shownAsText: true,
    outcome,
  }),
);

/** Row 54, the errors of the runner. Unknown value: `cannot-start`. */
export const runnerErrors = defineRunnerSet(
  54,
  "runner-errors",
  RUNNER_ERRORS,
  (_value, outcome) => ({ member: "cannot-start", outcome }),
);

/**
 * Row 233, the signals of a result that has no exit code, with the two
 * members of the check runner. Unknown value: the command counts as failed.
 */
export const resultSignals = defineRunnerSet(
  233,
  "result-signals",
  RESULT_SIGNALS,
  (value, outcome) => ({
    member: undefined,
    countsAsFailed: true,
    // `DEADLINE` is a member of row 233, not of the two the check runner may
    // set; the branch names its owner rather than pretending the row is short.
    ownedByAnotherFeature:
      value === SIGNAL_OF_ANOTHER_FEATURE.member ? SIGNAL_OF_ANOTHER_FEATURE.owner : undefined,
    outcome,
  }),
);

/** Row 235, the state of a run of steps. Unknown value: `partial`. */
export const stepRunStates = defineRunnerSet(
  235,
  "step-run-state",
  STEP_RUN_STATES,
  (_value, outcome) => ({ member: "partial", outcome }),
);

/**
 * Row 236, the reasons of an admission to a batch. Unknown value: the command
 * runs alone, which is the reason `exclusive` of the same row.
 */
export const admissionReasons = defineRunnerSet(
  236,
  "admission-reasons",
  ADMISSION_REASONS,
  (_value, outcome) => ({ member: "exclusive", runsAlone: true, outcome }),
);

/* ------------------------------------------------------------------ *
 * The registry.
 * ------------------------------------------------------------------ */

/** The rows of annex X §X.6 this module registers, in the order of the annex. */
export const REGISTERED_ROWS: readonly number[] = Object.freeze([53, 54, 233, 235, 236]);

/** Every set this module registered, by the name of this feature's data file. */
export function registeredRunnerSets(): ReadonlyMap<string, RunnerClosedSet<string>> {
  return REGISTRY;
}

/** The set of a name, or `undefined`. */
export function runnerSet(name: string): RunnerClosedSet<string> | undefined {
  return REGISTRY.get(name);
}

/** The sets of one row of §X.6; row 53 carries three. */
export function runnerSetsOfRow(number: number): readonly RunnerClosedSet<string>[] {
  return Object.freeze([...REGISTRY.values()].filter((s) => s.number === number));
}

/**
 * The open set of this feature: the kinds of identity of the check runner.
 * It is open, so it is not registered as a closed set
 * (`data/closed-sets.json`, `openSets`).
 */
export const OPEN_SETS: readonly string[] = Object.freeze(
  (featureSets as { openSets: string[] }).openSets,
);
