/**
 * T036 — THE CLASSIFICATION OF THE STALENESS VERDICT, the one pure operation of
 * the canonical hasher that turns recorded hashes and hashes now into the four
 * states of a source and into `fresh` or `stale` (F104-FR-024, F104-FR-027;
 * annex X §X.5, row "Classification of the staleness verdict", F100-FR-207;
 * CQ-214).
 *
 * It lives HERE, in `@specstride/kernel`, and not in
 * `@specstride/spec-formats`, because `@specstride/core` and the loop layers
 * may import `@specstride/contracts` and `@specstride/kernel` alone. Features
 * 102 and 103 decide staleness and reach this one function; no feature
 * compares hashes itself, and EP-03 gains no operation for the verdict
 * (F104-FR-027; `EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT` of
 * `packages/spec-formats/src/model.ts`).
 *
 * Two properties of this module are the reason it is a module of its own, and
 * both are measurable on the file:
 *
 *  1. **It reads no file.** `STALENESS_READS_A_FILE` is `false` and the import
 *     list below holds `@specstride/contracts` only — no `node:fs`, no
 *     `node:crypto`, no path. Every input is a hash the caller already took.
 *     `packages/spec-formats/src/verdict.ts` does the reading, computes the
 *     hashes now through the hasher, calls this operation and builds the lines
 *     of F104-FR-025.
 *  2. **Its result does not depend on when it is asked** (F104-FR-027). There
 *     is no clock and no state here: the same recorded hashes and the same
 *     hashes now always give the same verdict, under every profile, and only
 *     the CHECK POINT — where the comparison is made — belongs to another
 *     owner (annex X §X.7, row 15).
 *
 * `index.ts` of this folder re-exports every name below, so the hasher stays
 * ONE module to its callers (`@specstride/kernel/hasher`) and the rules of the
 * classification stay in one file.
 */
import {
  type SourceReading,
  type SourceState,
  type StalenessClassification,
  type StalenessVerdict,
} from "@specstride/contracts/ep/hasher";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import type { ClosedSet } from "@specstride/contracts/enums";

/** The section of annex X that owns the table of operations. */
export const STALENESS_ANNEX_SECTION = "annex X, §X.5" as const;

/** The requirements of feature 104 whose rules this module holds. */
export const STALENESS_REQUIREMENTS = ["F104-FR-024", "F104-FR-027"] as const;

/**
 * This module reads no file: every operation is a pure function of the hashes
 * it is handed (F104-FR-024). The import list above is the proof.
 */
export const STALENESS_READS_A_FILE = false as const;

/**
 * The verdict is one function whose result does not depend on when it is asked
 * (F104-FR-027): no clock, no state, no check point of its own.
 */
export const STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED = false as const;

/**
 * The numbers of the closed sets of annex X §X.6 this module reads. The
 * members are NOT written out here: they are taken from the one table in
 * `@specstride/contracts`, so that the hasher and the table cannot drift
 * (F100-FR-208, F100-FR-209).
 */
export const CLOSED_SET_OF_THE_KINDS_OF_SOURCE = 97 as const;
export const CLOSED_SET_OF_THE_STATES_OF_A_SOURCE = 98 as const;
export const CLOSED_SET_OF_THE_NAMES_OF_THE_RUN_VERDICT = 50 as const;

/** The set of a row of §X.6, refused at load where the table holds no row. */
function setOfRow(number: number): ClosedSet {
  const set = closedSet(number);
  if (set === undefined) {
    throw new Error(
      `the canonical hasher reads the closed set ${number} of ${STALENESS_ANNEX_SECTION}, ` +
        `which \`@specstride/contracts\` does not hold`,
    );
  }
  return set;
}

/** The four states of a source: closed set 98 of annex X §X.6. */
export const STATES_OF_A_SOURCE = setOfRow(CLOSED_SET_OF_THE_STATES_OF_A_SOURCE).members;

/** The kinds of source of a specification: closed set 97. */
export const KINDS_OF_SOURCE = setOfRow(CLOSED_SET_OF_THE_KINDS_OF_SOURCE).members;

/**
 * The logical names of the staleness verdict of a RUN, in the order the
 * verdict names them: closed set 50 of annex X §X.6. A recorded source of a
 * run whose name lies outside this set gives a stale verdict (the row's
 * unknown-value rule, and F104-FR-024). The verdict over the sources of a
 * LAUNCH CONTRACT does not apply this rule: a contract records sources of any
 * kind of annex X §X.6 row 256, each identified by its index.
 */
const NAMES_OF_THE_RUN_VERDICT_SET = setOfRow(CLOSED_SET_OF_THE_NAMES_OF_THE_RUN_VERDICT);
export const NAMES_OF_THE_RUN_VERDICT = NAMES_OF_THE_RUN_VERDICT_SET.members;

/** The kind of source whose hash that ignores checkboxes is compared. */
export const KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH = "tasks" as const;

/** Which name rule the classification applies (F104-FR-024). */
export const NAME_RULES = ["run", "none"] as const;
export type NameRule = (typeof NAME_RULES)[number];

/** How the classification is asked for. */
export type ClassifyOptions = {
  /**
   * `run` applies the rule of closed set 50: a recorded name outside `spec`,
   * `plan` and `tasks` makes the verdict stale. `none`, the default, applies
   * no name rule and is the form the sources of a launch contract take.
   */
  readonly nameRule?: NameRule;
};

/** One source as the classification reports it, in the order recorded. */
export type ClassifiedSource = {
  /** The index of the source in the record, which a launch contract names by. */
  readonly index: number;
  readonly name: string;
  readonly path: string;
  readonly state: SourceState;
  /**
   * For a task list: whether the change is more than checkboxes. It is
   * `false` where the content hash differs but the hash that ignores
   * checkboxes is equal, and `true` for any other difference.
   */
  readonly moreThanTicks?: boolean;
  /** Set where the `run` name rule refused the recorded name (closed set 50). */
  readonly nameOutsideTheRunVerdict?: boolean;
};

/** A source carries a hash that ignores checkboxes only where it is a task list. */
function isATaskList(reading: SourceReading): boolean {
  return (
    reading.logicalName === KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH ||
    reading.recordedHashIgnoringCheckboxes !== undefined
  );
}

/**
 * The state of ONE source (F104-FR-024):
 *
 *  - `unreadable` where there is no hash now;
 *  - `unchanged` where the content hash is equal;
 *  - `ticks-only` where the content hash differs but the hash that ignores
 *    checkboxes is equal — a task list only;
 *  - `changed` for every other difference.
 */
function stateOf(reading: SourceReading): SourceState {
  if (reading.hashNow === undefined) return "unreadable";
  if (reading.hashNow === reading.recordedHash) return "unchanged";
  if (isATaskList(reading)) {
    const recorded = reading.recordedHashIgnoringCheckboxes;
    const now = reading.hashNowIgnoringCheckboxes;
    if (recorded !== undefined && now !== undefined && recorded === now) return "ticks-only";
  }
  return "changed";
}

/** A state that makes the verdict stale (F104-FR-024). */
function isStale(state: SourceState): boolean {
  return state === "changed" || state === "unreadable";
}

/**
 * The classification, source by source and in the order recorded
 * (F104-FR-024). This is the ordered form, which keeps the INDEX of each
 * source: the verdict over the sources of a launch contract names a source by
 * its index, and a contract may record two sources under one name.
 * `classifyStaleness` is this function projected onto the shape feature 100's
 * interface gives.
 *
 * It is a pure function of the recorded hashes and the hashes now, and reads
 * no file. Features 102, 103 and 104 reach the one classification here and do
 * not compare hashes themselves (F104-FR-027).
 */
export function classifySources(
  readings: readonly SourceReading[],
  options: ClassifyOptions = {},
): readonly ClassifiedSource[] {
  const nameRule = options.nameRule ?? "none";
  return Object.freeze(
    readings.map((reading, index) => {
      const outsideTheSet =
        nameRule === "run" && !NAMES_OF_THE_RUN_VERDICT_SET.has(reading.logicalName);
      const state = outsideTheSet ? "changed" : stateOf(reading);
      const classified: {
        index: number;
        name: string;
        path: string;
        state: SourceState;
        moreThanTicks?: boolean;
        nameOutsideTheRunVerdict?: boolean;
      } = {
        index,
        name: reading.logicalName,
        path: reading.repositoryPath,
        state,
      };
      if (isATaskList(reading)) classified.moreThanTicks = state === "changed";
      if (outsideTheSet) classified.nameOutsideTheRunVerdict = true;
      return Object.freeze(classified);
    }),
  );
}

/** The verdict over a set of classified sources: `fresh` or `stale`. */
export function verdictOf(sources: readonly ClassifiedSource[]): StalenessVerdict {
  return sources.some((s) => isStale(s.state)) ? "stale" : "fresh";
}

/**
 * The names of the sources that are `changed` or `unreadable`, in the order
 * recorded — the `changed[]` of `contracts/verdict.md`.
 */
export function changedNames(sources: readonly ClassifiedSource[]): readonly string[] {
  return Object.freeze(sources.filter((s) => isStale(s.state)).map((s) => s.name));
}

/**
 * The classification of the staleness verdict (annex X §X.5, row
 * "Classification of the staleness verdict"; F104-FR-024, F104-FR-027), in
 * the shape feature 100's interface gives: a state per logical name and one
 * verdict. A pure function that reads no file.
 *
 * Where two recorded sources share a logical name — which only a launch
 * contract does — this shape keeps the last of them, so a caller that names
 * sources by index uses `classifySources` instead.
 */
export function classifyStaleness(
  readings: readonly SourceReading[],
  options: ClassifyOptions = {},
): StalenessClassification {
  const sources = classifySources(readings, options);
  return Object.freeze({
    sources: Object.freeze(Object.fromEntries(sources.map((s) => [s.name, s.state]))),
    verdict: verdictOf(sources),
  });
}
