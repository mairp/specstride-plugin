/**
 * T004 — the three closed sets that feature 146 owns, gathered in one module
 * of the `contracts` package, each with its branch for an unknown value
 * (F146-FR-002, F146-FR-013, F146-FR-017; `specs/146-harness-discovery/
 * contracts/closed-sets.json`).
 *
 * The registration itself happens once, in the batch files (T250 to T256):
 * `../enums/sets-145-149.ts` registers row 34, row 178 and row 179 of annex
 * X §X.6. This module is the feature-owned view: it re-exports the three
 * sets and gives the reader of each one an explicit branch for a value
 * outside the set (F100-FR-209 — a reader without a branch fails).
 */
import {
  refuse,
  treatAs,
  rowOf,
  type ClosedSet,
  type UnknownValueOutcome,
  type UnknownValueRule,
} from "../enums/index.ts";

export {
  /** Row 34 — the four states of a harness; an unknown state reads as `detected`. */
  statesOfAHarness,
  /** Row 178 — the seven sources of discovery; an unknown source drops the candidate, with a doctor finding. */
  sourcesOfDiscovery,
  /** Row 179 — the five steps of the probe ladder; an unknown step is read as null. */
  stepsOfTheProbeLadder,
} from "../enums/sets-145-149.ts";

import {
  statesOfAHarness,
  sourcesOfDiscovery,
  stepsOfTheProbeLadder,
} from "../enums/sets-145-149.ts";

/** The rows of annex X §X.6 that feature 146 owns, each with its name. */
export const ROWS_OWNED_BY_146 = [34, 178, 179] as const;

/**
 * Branch for the states of a harness (F146-FR-017): a value outside the four
 * members is read as `detected`, the state of a harness that a source found
 * and nothing else has confirmed.
 */
export const stateOfAHarnessUnknown: UnknownValueRule = treatAs(
  "detected",
  "Unknown value: `detected`",
);

/**
 * Branch for the sources of discovery (F146-FR-002): a source outside the
 * seven members drops the candidate, and the drop is recorded as a doctor
 * finding — the candidate is never shown with an unnamed source.
 */
export const sourceOfDiscoveryUnknown: UnknownValueRule = refuse(
  "The candidate is dropped, with a doctor finding",
);

/**
 * Branch for the steps of the probe ladder (F146-FR-013): a step outside the
 * five members is read as null — a capability carries no ladder step, and no
 * record refuses.
 */
export const probeStepUnknown: UnknownValueRule = (value, setName) =>
  ({
    kind: "default",
    value,
    set: setName,
    treatedAs: undefined,
    message:
      `"${value}" is not a member of the closed set "${setName}"; read as null ` +
      `(The value is read as null)`,
    cell: "The value is read as null",
  }) satisfies UnknownValueOutcome;

/**
 * The branch a reader of a set uses, by the name of the set. An unknown set
 * name refuses — this module owns exactly the three sets of the feature.
 */
export function unknownBranchOf(set: ClosedSet): UnknownValueRule {
  switch (set.number) {
    case 34:
      return stateOfAHarnessUnknown;
    case 178:
      return sourceOfDiscoveryUnknown;
    case 179:
      return probeStepUnknown;
    default:
      return refuse(`not a closed set that feature 146 owns (rows 34, 178, 179)`);
  }
}

/**
 * Every row this module re-exports exists in the table of §X.6, is owned by
 * 146, carries an unknown-value rule, and holds exactly the members of
 * `specs/146-harness-discovery/contracts/closed-sets.json`. Checked at load.
 */
export function assertOwnedRowsAreRegistered(): void {
  const expected: ReadonlyArray<readonly [number, readonly string[]]> = [
    [34, ["tested", "locally-verified", "declared", "detected"]],
    [178, ["harness-adapter", "binary", "config-home", "host", "endpoint", "gateway", "declared"]],
    [179, ["presence", "version-help", "credential-presence", "metadata", "catalogue"]],
  ];
  for (const [number, members] of expected) {
    const row = rowOf(number);
    if (row === undefined) {
      throw new Error(`annex X §X.6 has no row ${number}; feature 146 owns it (T004)`);
    }
    if (!row.owner.includes("146")) {
      throw new Error(`row ${number} of annex X §X.6 is owned by ${row.owner}, not by 146`);
    }
    if (typeof row.unknownValue !== "string" || row.unknownValue.length === 0) {
      throw new Error(`row ${number} of annex X §X.6 has no unknown-value rule (F100-FR-209)`);
    }
    if (row.literals.join("\u0000") !== members.join("\u0000")) {
      throw new Error(
        `row ${number} of annex X §X.6 does not hold the members of closed-sets.json (T004)`,
      );
    }
  }
}

assertOwnedRowsAreRegistered();

/** The three sets of the feature, as the contract file lists them, in order. */
export const SETS_OF_FEATURE_146: readonly ClosedSet[] = [
  statesOfAHarness,
  sourcesOfDiscovery,
  stepsOfTheProbeLadder,
];
