/**
 * T008 — the closed sets of feature 105, with their unknown-value branches
 * (annex X §X.6, rows 52 and 228 to 234; F100-FR-208, F100-FR-209;
 * F105-FR-001, F105-FR-014, F105-FR-016, F105-FR-035, F105-FR-039).
 *
 * Feature 100 owns the table of §X.6. This module is the registration of the
 * eight rows feature 105 reads, in the form this package reads them:
 *
 * | Row | Set | Unknown value |
 * |---|---|---|
 * | 52 | verification modes | configuration error, exit 3 |
 * | 228 | stages of a declared command | the declaration is refused |
 * | 229 | reuse policies of a staged command | the declaration is refused |
 * | 230 | values of `discovery` | the document is refused |
 * | 231 | kinds and levels of a verification obligation | the plan is refused |
 * | 232 | values of `automationStatus` | the plan is refused |
 * | 233 | the member `DEADLINE` only | the command counts as failed |
 * | 234 | sub-commands of `verify` | exit 3 |
 *
 * Of row 233 this feature owns the member `DEADLINE` and nothing else: the
 * owner cell of the annex reads `148; \`DEADLINE\`: 105`, and `TIMEOUT` and
 * `EXEC_ERROR` are the check runner's (feature 148). `SIGNALS_OF_THE_CHECK_RUNNER`
 * names them with their owner, so the short set is a recorded division of one
 * row and not a set that drifted from the annex.
 *
 * Every set here carries a BRANCH FOR THE UNKNOWN VALUE: F100-FR-209 says a
 * reader without one fails, so `branch` and `read` never throw and never
 * guess — they return the decision the column "unknown value" of the row
 * states, and the members are checked against the row of the annex AND
 * against `packages/verification/data/closed-sets.json` at load, so neither
 * the code, the annex nor the contracts data can drift from the other two.
 *
 * Three of the eight rows state their unknown value as prose that names no
 * member: row 52 "Configuration error", row 233 "The command counts as
 * failed" and row 234 "Exit 3". The generic rule of feature 100
 * (`unknownValueRuleOf`) reads such a cell as `refuse`, which is safe but is
 * not the decision of the row; the branch of this feature carries the
 * decision in the fields `exitCode`, `configurationError`, `countsAsFailed`,
 * `declarationRefused`, `documentRefused` and `planRefused`, and the outcome
 * of feature 100 travels beside it, so neither reading is lost.
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

/** Row 52 — the three verification modes (F105-FR-001). */
export const VERIFICATION_MODES = ["required", "plan", "off"] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/**
 * Row 228 — the stages a declared verification command may name
 * (F105-FR-016). `pre` is a spelling of `prestage` and is STORED as
 * `prestage`; `normalizeStage` is that rule, and it is the only place the
 * spelling is folded.
 */
export const COMMAND_STAGES = ["gate", "pre", "prestage", "both"] as const;
export type CommandStage = (typeof COMMAND_STAGES)[number];

/** The stages as they are STORED: `pre` is never stored (F105-FR-016). */
export const STORED_COMMAND_STAGES = ["gate", "prestage", "both"] as const;
export type StoredCommandStage = (typeof STORED_COMMAND_STAGES)[number];

/** Row 229 — the reuse policies of a staged command (F105-FR-033). */
export const REUSE_POLICIES = ["per-attempt", "per-phase", "per-run"] as const;
export type ReusePolicy = (typeof REUSE_POLICIES)[number];

/** Row 230 — the values `discovery` of the verification-commands document may hold. */
export const DISCOVERY_VALUES = ["none"] as const;
export type DiscoveryValue = (typeof DISCOVERY_VALUES)[number];

/**
 * Row 231 — the kinds of a verification obligation with their levels
 * (F105-FR-014). The row pairs a kind with a level: `effect-witness` with
 * `integration`, `positive` with `contract`. `data/closed-sets.json` writes
 * each pair as one member with a slash, so the pair is the member here too,
 * and `OBLIGATION_KINDS` and `OBLIGATION_LEVELS` are its two halves.
 */
export const OBLIGATION_KIND_LEVELS = ["effect-witness/integration", "positive/contract"] as const;
export type ObligationKindLevel = (typeof OBLIGATION_KIND_LEVELS)[number];

/** Row 231 — the kinds, the first half of each pair. */
export const OBLIGATION_KINDS = ["effect-witness", "positive"] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

/** Row 231 — the levels, the second half of each pair. */
export const OBLIGATION_LEVELS = ["integration", "contract"] as const;
export type ObligationLevel = (typeof OBLIGATION_LEVELS)[number];

/** Row 232 — the values of `automationStatus` of an obligation (F105-FR-014). */
export const AUTOMATION_STATUS = ["planned", "manual"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUS)[number];

/**
 * Row 233 — the signal of a detached command staged before that has no exit
 * code (F105-FR-035). This feature owns `DEADLINE` and only `DEADLINE`: a
 * detached command is never killed at its deadline, so it is reported with
 * this signal instead of an exit code.
 */
export const STAGED_COMMAND_SIGNALS = ["DEADLINE"] as const;
export type StagedCommandSignal = (typeof STAGED_COMMAND_SIGNALS)[number];

/** The members of row 233 that belong to the check runner, with their owner. */
export const SIGNALS_OF_THE_CHECK_RUNNER = Object.freeze({
  members: Object.freeze(["TIMEOUT", "EXEC_ERROR"] as const),
  owner: "148",
  reason:
    "a time limit and a failure to start are the check runner's; a detached command staged " +
    "before is not ended at its time limit and carries `DEADLINE` instead (F105-FR-035)",
} as const);

/** Row 234 — the sub-commands of `verify` (F105-FR-039, ruling 26). */
export const VERIFY_SUB_COMMANDS = [
  "create",
  "validate",
  "slice",
  "scaffold",
  "run",
  "prestage",
  "prestage-report",
] as const;
export type VerifySubCommand = (typeof VERIFY_SUB_COMMANDS)[number];

/**
 * The exit code of an invalid configuration or argument (annex E §E.4, annex
 * G §G.4, code 3). Rows 52 and 234 name it in their unknown-value cell.
 */
export const CONFIGURATION_ERROR_CODE = 3 as const;

/* ------------------------------------------------------------------ *
 * The branch for the unknown value.
 * ------------------------------------------------------------------ */

/**
 * What this feature does with a value outside one of its sets. The branch of
 * a set returns one of these, so a caller reads a DECISION and not an
 * exception (F100-FR-209).
 */
export type UnknownBranch<M extends string> = {
  /** The member the value is read as, where the row names one. */
  readonly member: M | undefined;
  /** The exit code the row names, where it names one (rows 52 and 234). */
  readonly exitCode?: number | undefined;
  /** True where the row says the value is a configuration error (row 52). */
  readonly configurationError?: boolean | undefined;
  /** True where the row says the declaration is refused (rows 228, 229). */
  readonly declarationRefused?: boolean | undefined;
  /** True where the row says the document is refused (row 230). */
  readonly documentRefused?: boolean | undefined;
  /** True where the row says the plan is refused (rows 231, 232). */
  readonly planRefused?: boolean | undefined;
  /** True where the row says the command counts as failed (row 233). */
  readonly countsAsFailed?: boolean | undefined;
  /**
   * Where the value IS a member of the row of §X.6 but of another feature's
   * part of it, the feature that owns that member. Row 233 is the one such
   * row: `TIMEOUT` and `EXEC_ERROR` are members of the row and belong to 148.
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

/** A closed set of feature 105: the row, the members and the branch. */
export type VerificationClosedSet<M extends string> = {
  /** The name this feature gives the set, as `data/closed-sets.json` writes it. */
  readonly name: string;
  /** The number of the row of annex X §X.6. */
  readonly number: number;
  /** The row of the annex, as feature 100 holds it. */
  readonly row: ClosedSetRow;
  /** The feature that owns the row, as the owner cell reads. */
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
export class VerificationClosedSetError extends Error {
  readonly setName: string;
  constructor(setName: string, message: string) {
    super(message);
    this.name = "VerificationClosedSetError";
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

/** `packages/verification/data/closed-sets.json`, the contracts data of T004. */
const FEATURE_SETS: readonly FeatureSetEntry[] = Object.freeze(
  (featureSets as { sets: FeatureSetEntry[] }).sets,
);

/** The entry of `data/closed-sets.json` for a row and a name, or `undefined`. */
export function declaredSet(number: number, name: string): FeatureSetEntry | undefined {
  return FEATURE_SETS.find((s) => s.row === number && s.name === name);
}

const REGISTRY = new Map<string, VerificationClosedSet<string>>();

/**
 * The parts of a member that must each be a literal of the row. Row 231
 * writes a pair as `positive/contract`; every other set writes a member
 * whole, and a member without a slash is its own single part.
 */
function partsOf(member: string): readonly string[] {
  return member.split("/");
}

/**
 * Build a set of this feature from its row of §X.6 and its members, with the
 * branch for the unknown value, and register it under its name. The row must
 * exist, the row must name feature 105 in its owner cell, every part of every
 * member must be a literal of the row, and `data/closed-sets.json` must hold
 * the same members under the same name: a set that drifts from the annex or
 * from the contracts data is refused HERE, at load, and not at the first
 * command that reads it.
 */
function defineVerificationSet<const M extends readonly string[]>(
  number: number,
  name: string,
  members: M,
  branch: UnknownValueBranch<M[number]>,
): VerificationClosedSet<M[number]> {
  const row = rowOf(number);
  if (row === undefined) {
    throw new VerificationClosedSetError(
      name,
      `annex X §X.6 holds no row ${number}; feature 105 registers only rows of the ` +
        `annex (F100-FR-208)`,
    );
  }
  if (!/\b105\b/.test(row.owner)) {
    throw new VerificationClosedSetError(
      name,
      `row ${number} ("${row.name}") of annex X §X.6 names ${row.owner} as its owner; ` +
        `feature 105 does not register a set of another feature (F100-FR-208)`,
    );
  }
  const notInTheRow = members.filter((m) =>
    partsOf(m).some((part) => !row.literals.includes(part)),
  );
  if (notInTheRow.length > 0) {
    throw new VerificationClosedSetError(
      name,
      `the members ${notInTheRow.join(", ")} of "${name}" are not members of row ` +
        `${number} of annex X §X.6 (F100-FR-208)`,
    );
  }
  const declared = declaredSet(number, name);
  if (declared === undefined) {
    throw new VerificationClosedSetError(
      name,
      `packages/verification/data/closed-sets.json holds no set "${name}" of row ${number}`,
    );
  }
  const drift = [
    ...declared.members.filter((m) => !(members as readonly string[]).includes(m)),
    ...members.filter((m) => !declared.members.includes(m)),
  ];
  if (drift.length > 0) {
    throw new VerificationClosedSetError(
      name,
      `the members of "${name}" differ from packages/verification/data/closed-sets.json: ` +
        `${drift.join(", ")}`,
    );
  }
  if (REGISTRY.has(name)) {
    throw new VerificationClosedSetError(
      name,
      `the set "${name}" is registered twice (F100-FR-208)`,
    );
  }
  const rule = unknownValueRuleOf(row.unknownValue);
  const list = Object.freeze([...members]) as readonly M[number][];
  const onUnknown = (value: string): UnknownValueOutcome => rule(value, row.name);
  const set: VerificationClosedSet<M[number]> = Object.freeze({
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
  REGISTRY.set(name, set as VerificationClosedSet<string>);
  return set;
}

/* ------------------------------------------------------------------ *
 * The eight rows, each with its branch for the unknown value.
 * ------------------------------------------------------------------ */

/**
 * Row 52, the verification modes. Unknown value: a configuration error,
 * which the command answers with the exit code 3 (F105-FR-001). The branch
 * names no member: a mode that was not understood is never read as
 * `required`, `plan` or `off`, because any of the three would run a different
 * verification than the one that was asked for.
 */
export const verificationModes = defineVerificationSet(
  52,
  "verification-modes",
  VERIFICATION_MODES,
  (_value, outcome) => ({
    member: undefined,
    configurationError: true,
    exitCode: CONFIGURATION_ERROR_CODE,
    outcome,
  }),
);

/**
 * Row 228, the stages of a declared command. Unknown value: the declaration
 * is refused (F105-FR-016).
 */
export const commandStages = defineVerificationSet(
  228,
  "command-stages",
  COMMAND_STAGES,
  (_value, outcome) => ({ member: undefined, declarationRefused: true, outcome }),
);

/**
 * `pre` is a spelling of `prestage` and is stored as `prestage` (row 228 of
 * annex X §X.6; the baseline folds the two in `lib/verification_plan.py`).
 * A value outside the set is NOT folded: it is returned as `undefined`, and
 * the branch of `commandStages` refuses the declaration.
 */
export function normalizeStage(value: string): StoredCommandStage | undefined {
  if (!commandStages.has(value)) return undefined;
  return value === "pre" ? "prestage" : (value as StoredCommandStage);
}

/**
 * Row 229, the reuse policies of a staged command. Unknown value: the
 * declaration is refused (F105-FR-033).
 */
export const reusePolicies = defineVerificationSet(
  229,
  "reuse-policies",
  REUSE_POLICIES,
  (_value, outcome) => ({ member: undefined, declarationRefused: true, outcome }),
);

/**
 * Row 230, the values of `discovery` of the verification-commands document.
 * Unknown value: the document is refused.
 */
export const discoveryValues = defineVerificationSet(
  230,
  "discovery-values",
  DISCOVERY_VALUES,
  (_value, outcome) => ({ member: undefined, documentRefused: true, outcome }),
);

/**
 * Row 231, the kinds of a verification obligation with their levels. Unknown
 * value: the plan is refused (F105-FR-014).
 */
export const obligationKinds = defineVerificationSet(
  231,
  "obligation-kinds",
  OBLIGATION_KIND_LEVELS,
  (_value, outcome) => ({ member: undefined, planRefused: true, outcome }),
);

/**
 * The level that goes with a kind of row 231, or `undefined` where the kind
 * is not a member. The row pairs the two, so a kind never chooses its level.
 */
export function levelOfKind(kind: string): ObligationLevel | undefined {
  const pair = OBLIGATION_KIND_LEVELS.find((p) => partsOf(p)[0] === kind);
  return pair === undefined ? undefined : (partsOf(pair)[1] as ObligationLevel);
}

/**
 * Row 232, the values of `automationStatus`. Unknown value: the plan is
 * refused (F105-FR-014).
 */
export const automationStatus = defineVerificationSet(
  232,
  "automation-status",
  AUTOMATION_STATUS,
  (_value, outcome) => ({ member: undefined, planRefused: true, outcome }),
);

/**
 * Row 233, the signal of a detached command staged before that has no exit
 * code, with the one member feature 105 owns. Unknown value: the command
 * counts as failed (F105-FR-032, F105-FR-035). `TIMEOUT` and `EXEC_ERROR` are
 * members of the row and belong to feature 148; the branch names their owner
 * rather than pretending the row is one member long.
 */
export const stagedCommandSignals = defineVerificationSet(
  233,
  "staged-command-signals",
  STAGED_COMMAND_SIGNALS,
  (value, outcome) => ({
    member: undefined,
    countsAsFailed: true,
    ownedByAnotherFeature: (SIGNALS_OF_THE_CHECK_RUNNER.members as readonly string[]).includes(
      value,
    )
      ? SIGNALS_OF_THE_CHECK_RUNNER.owner
      : undefined,
    outcome,
  }),
);

/**
 * Row 234, the sub-commands of `verify`. Unknown value: exit 3
 * (F105-FR-039). The names are the baseline's (`research.md` D-14).
 */
export const verifySubCommands = defineVerificationSet(
  234,
  "verify-sub-commands",
  VERIFY_SUB_COMMANDS,
  (_value, outcome) => ({
    member: undefined,
    exitCode: CONFIGURATION_ERROR_CODE,
    outcome,
  }),
);

/* ------------------------------------------------------------------ *
 * The registry.
 * ------------------------------------------------------------------ */

/** The rows of annex X §X.6 this module registers, in the order of the annex. */
export const REGISTERED_ROWS: readonly number[] = Object.freeze([
  52, 228, 229, 230, 231, 232, 233, 234,
]);

/** Every set this module registered, by the name of this feature's data file. */
export function registeredVerificationSets(): ReadonlyMap<string, VerificationClosedSet<string>> {
  return REGISTRY;
}

/** The set of a name, or `undefined`. */
export function verificationSet(name: string): VerificationClosedSet<string> | undefined {
  return REGISTRY.get(name);
}

/** The sets of one row of §X.6; every row of this feature carries one. */
export function verificationSetsOfRow(number: number): readonly VerificationClosedSet<string>[] {
  return Object.freeze([...REGISTRY.values()].filter((s) => s.number === number));
}

/**
 * The open sets of this feature: the plan sources (an open registry, EP-07)
 * and the toolchains of discovery (open by data, `research.md` D-16). They are
 * open, so they are not registered as closed sets (`data/closed-sets.json`,
 * `openSets`).
 */
export const OPEN_SETS: readonly string[] = Object.freeze(
  (featureSets as { openSets: string[] }).openSets,
);
