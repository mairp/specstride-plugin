/**
 * T006 — the closed sets that feature 123 owns, gathered in one module of the
 * `contracts` package (annex X §X.6, the rows whose owner names 123;
 * F100-FR-208, F100-FR-209).
 *
 * The registration itself happens once, in the batch files of T250 to T256
 * (`../enums/sets-120-125.ts` and `../codes/stop-reason-literals.ts`): a
 * second `defineClosedSet` with the same number would refuse at load. This
 * module is the feature-owned view the static test of F100-FR-209 reads: it
 * re-exports every row of §X.6 that names 123, so that the test finds a
 * branch (an unknown-value rule) for every unknown value of every set this
 * feature owns, including row 101 for the refusals of `resolve` and row 279,
 * the set "Hold refusals" (`no-live-run`), proposed as row 279 in
 * `analyze-report.md`, "Proposed upstream fixes".
 */
import { rowOf, type ClosedSet } from "../enums/index.ts";

export {
  /** Row 11 — stage reasons, transient and deliberate (by reference to annex E). */
  stageReasonSet,
} from "../codes/stop-reason-literals.ts";
export {
  /** Row 12 — pipeline exit reasons. */
  pipelineStatesStatesOfOneStage,
  /** Row 13 — launch-check refusals; the unknown value reads as `Refusal`. */
  launchCheckRefusals,
  /** Row 14 — relaunch refusals of both tables; the unknown value reads as `Refusal`. */
  relaunchRefusals,
  /** Row 15 — digest states; the unknown value reads as the outcome `unknown-terminal`. */
  digestStates,
  /** Row 16 — the supervision outcomes of annex G F100-FR-184. */
  observationStatusesOfSupervision,
  /** Row 18 — the kinds of run request; the unknown value refuses the launch. */
  kindsOfRunRequest,
  /** Row 20 — `relaunch.owner`; the unknown value is a configuration error. */
  relaunchOwner,
  /** Row 25 — stage kinds and precondition checks; an open registry, so the launch contract is invalid. */
  stageKindsPreconditionChecks,
  /** Row 101 — the refusals of `resolve`; the unknown value reads as `Refusal`. */
  resolveRefusals,
  /** Row 102 to 110 — states, decisions, statuses, timings, colour modes, the two tables. */
  launchDecisionsLaunchChecksStatusesOfALaunchCheck,
  relaunchDecisions,
  classesOfAStageReason,
  asIsModesOfALaunchBySuperviseSourcesOfAModeSourcesOfALauncher,
  timingsAndResultsOfAPreconditionCheck,
  colourModesOfThePipelineEntry,
  relaunchClassifierTables,
  /** Row 111 — the verbs of `supervise`. */
  verbsOfSupervise,
  /** Row 279 — the set "Hold refusals" (`no-live-run`); the unknown value reads as `Refusal`. */
  holdRefusals,
} from "../enums/sets-120-125.ts";

/** The numbers of annex X §X.6 whose owner names 123, each with its name. */
export const ROWS_OWNED_BY_123 = [
  11, 12, 13, 14, 15, 16, 18, 20, 25, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 279,
] as const;

/**
 * Every row this module re-exports exists in the table of §X.6, is owned by
 * 123, and carries an unknown-value rule — the branch the static test of
 * F100-FR-209 finds for every unknown value. Checked at load.
 */
export function assertOwnedRowsAreRegistered(): void {
  for (const number of ROWS_OWNED_BY_123) {
    const row = rowOf(number);
    if (row === undefined) {
      throw new Error(`annex X §X.6 has no row ${number}; feature 123 owns it (F100-FR-209)`);
    }
    if (!row.owner.includes("123")) {
      throw new Error(`row ${number} of annex X §X.6 is owned by ${row.owner}, not by 123`);
    }
    if (typeof row.unknownValue !== "string" || row.unknownValue.length === 0) {
      throw new Error(`row ${number} of annex X §X.6 has no unknown-value rule (F100-FR-209)`);
    }
  }
}

assertOwnedRowsAreRegistered();

/** The exported members, typed as closed sets for the static test. */
export type OwnedClosedSets = Readonly<Record<string, ClosedSet>>;
