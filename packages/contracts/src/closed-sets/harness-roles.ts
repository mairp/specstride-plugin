/**
 * T004 — the four closed sets that feature 124 owns, gathered in one module
 * of the `contracts` package (annex X §X.6, rows 180 to 183; the contract
 * `specs/124-harness-discovery-and-roles/contracts/closed-sets.json`).
 *
 * The registration itself happens once, in the batch file
 * `../enums/sets-120-125.ts`: a second `defineClosedSet` with the same
 * number would refuse at load. This module is the feature-owned view: it
 * re-exports every row whose owner names 124, with the branch each set
 * takes for an unknown value (F100-FR-209), so a reader of the role plan,
 * the critic pick or the diversity test never meets an unknown value
 * without a branch.
 */
import { rowOf, type ClosedSet } from "../enums/index.ts";

export {
  /** Row 180 — steps of the critic order; an unknown step refuses the record. */
  stepsOfTheCriticOrder,
  /** Row 181 — sources of the proposer; an unknown source refuses the record. */
  sourcesOfTheProposer,
  /**
   * Row 182 — reasons why a critic candidate does not qualify or is passed
   * over; an unknown reason is shown as text and the candidate does not
   * qualify.
   */
  reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver,
  /**
   * Row 183 — results of the diversity test; an unknown result is read as
   * `unverified`, with the warning.
   */
  resultsOfTheDiversityTest,
} from "../enums/sets-120-125.ts";

/** The numbers of annex X §X.6 whose owner names 124, each with its name. */
export const ROWS_OWNED_BY_124 = [180, 181, 182, 183] as const;

/**
 * Every row this module names exists in the table of §X.6, is owned by 124,
 * and carries an unknown-value rule — the branch the reader of each set
 * takes. Checked at load.
 */
function assertOwnedRowsAreRegistered(): void {
  for (const number of ROWS_OWNED_BY_124) {
    const row = rowOf(number);
    if (row === undefined) {
      throw new Error(`annex X §X.6 has no row ${number}; feature 124 owns it (F100-FR-209)`);
    }
    if (!row.owner.includes("124")) {
      throw new Error(`row ${number} of annex X §X.6 is owned by ${row.owner}, not by 124`);
    }
    if (typeof row.unknownValue !== "string" || row.unknownValue.length === 0) {
      throw new Error(`row ${number} of annex X §X.6 has no unknown-value rule (F100-FR-209)`);
    }
  }
}

assertOwnedRowsAreRegistered();

/**
 * The branch of each set for an unknown value, as a reader applies it
 * (F100-FR-209). `stepsOfTheCriticOrder` and `sourcesOfTheProposer` refuse
 * the record; the reasons set shows the value as text and does not qualify
 * the candidate; the diversity set reads the value as `unverified`, with
 * the warning.
 */
export function readWithUnknownBranch<M extends string>(
  set: ClosedSet<M>,
  value: string,
): { readonly member: M | null; readonly refused: boolean; readonly message: string } {
  if (set.has(value)) return { member: value, refused: false, message: "" };
  const outcome = set.onUnknown(value);
  return {
    member: null,
    refused: outcome.kind === "refuse",
    message: outcome.message,
  };
}
