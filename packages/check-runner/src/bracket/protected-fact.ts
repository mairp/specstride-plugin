/**
 * T028 — the protected-set fact of the fact block, and the rule that NO COUNT
 * OF TESTS is contributed to it (F148-FR-006).
 *
 * Two of the five claims of F148-FR-006 live here:
 *
 *  - **The fact is contributed to the fact block.** When files of the protected
 *    set were changed without authority, the verification gate still runs and
 *    the FACT reaches the critic through the field `protected` of
 *    `specstride.fact-block/1` (annex D §D.7): "paths of the protected set
 *    changed since phase entry, and which were authorised from the text of the
 *    task at launch; protected paths changed since launch in phases already
 *    approved; suppression markers added and removed, per file". Approval stays
 *    possible and the run does not halt — which is feature 100's own statement
 *    (F100-FR-136), read here from `ON_AN_UNAUTHORISED_PROTECTED_CHANGE` rather
 *    than restated.
 *  - **No count of tests.** Ruling 53: counts of tests are NOT given to the
 *    critic in Wave 1. `holdsNoCountOfTests` is the reader of that rule and
 *    `contributeToTheFactBlock` refuses a contribution that breaks it, so the
 *    rule cannot be broken by a caller of this feature. The one count the block
 *    does show is of suppression markers, which §D.7 names.
 *
 * This feature CONTRIBUTES; it does not write the block. Feature 116 owns the
 * content of §D.7 and the engine writes it through the call point
 * `contributeCriticInput` of EP-04 (`records/fact-block.ts` of the contracts).
 */
import {
  COUNTS_SHOWN,
  COUNT_THAT_IS_SHOWN,
  NEVER_IN_THE_BLOCK,
  ON_AN_UNAUTHORISED_PROTECTED_CHANGE,
  TEST_COUNTS_SHOWN_IN_WAVE_1,
  mayBeInTheBlock,
} from "@specstride/contracts/records/fact-block";
import { underPathPrefix } from "./fingerprint.ts";

/** The field of `specstride.fact-block/1` this feature contributes to. */
export const FACT_BLOCK_FIELD = "protected" as const;

/** The section of annex D that owns the field list of the block. */
export const FACT_BLOCK_SECTION = "annex D, §D.7" as const;

/** Feature 100's statement that the run does not halt (F100-FR-136), read not restated. */
export { ON_AN_UNAUTHORISED_PROTECTED_CHANGE, NEVER_IN_THE_BLOCK, COUNTS_SHOWN };

/** F148-FR-006 — the gate still runs, and the run does not halt. */
export const GATE_STILL_RUNS: true = ON_AN_UNAUTHORISED_PROTECTED_CHANGE.verificationGateStillRuns;
export const APPROVAL_STAYS_POSSIBLE: true =
  ON_AN_UNAUTHORISED_PROTECTED_CHANGE.approvalStaysPossible;
export const THE_RUN_HALTS: false = ON_AN_UNAUTHORISED_PROTECTED_CHANGE.theRunHalts;

/* ------------------------------------------------------------------ *
 * Which changes were authorised.
 * ------------------------------------------------------------------ */

/**
 * F148-FR-006 — the paths changed since phase entry that NO authorisation
 * covers. Authorisation comes from the text of the task at launch and belongs
 * to feature 116 (F116-FR-010); this function only partitions by it, with the
 * prefix comparison at a path boundary of `research.md` D-3, so that an
 * authorisation of a directory covers the files in it.
 */
export function unauthorisedChanges(
  changedSincePhaseEntry: readonly string[],
  authorised: readonly string[],
): readonly string[] {
  return Object.freeze(
    [...changedSincePhaseEntry]
      .filter((path) => !authorised.some((grant) => underPathPrefix(path, grant)))
      .sort(),
  );
}

/** The paths changed since phase entry that an authorisation DOES cover. */
export function authorisedChanges(
  changedSincePhaseEntry: readonly string[],
  authorised: readonly string[],
): readonly string[] {
  return Object.freeze(
    [...changedSincePhaseEntry]
      .filter((path) => authorised.some((grant) => underPathPrefix(path, grant)))
      .sort(),
  );
}

/* ------------------------------------------------------------------ *
 * The fact itself.
 * ------------------------------------------------------------------ */

/** Suppression markers added and removed, per file (§D.7). The one count shown. */
export type SuppressionMarkers = Readonly<
  Record<string, { readonly added: number; readonly removed: number }>
>;

/** The value of the field `protected` of the fact block (§D.7). */
export type ProtectedSetFact = {
  readonly changedSincePhaseEntry: readonly string[];
  readonly authorisedFromTheTaskTextAtLaunch: readonly string[];
  readonly unauthorised: readonly string[];
  readonly changedSinceLaunchInApprovedPhases: readonly string[];
  readonly suppressionMarkers: SuppressionMarkers;
};

/** What the caller of this feature knows about the protected set of the phase. */
export type ProtectedSetFactInput = {
  readonly changedSincePhaseEntry?: readonly string[];
  readonly authorised?: readonly string[];
  readonly changedSinceLaunchInApprovedPhases?: readonly string[];
  readonly suppressionMarkers?: SuppressionMarkers;
};

/**
 * F148-FR-006 — the protected-set fact, in the shape the field `protected` of
 * §D.7 names. It holds PATHS and the one count §D.7 allows; it holds no exit
 * result, no output, no time and no count of tests.
 */
export function protectedSetFact(input: ProtectedSetFactInput = {}): ProtectedSetFact {
  const changed = input.changedSincePhaseEntry ?? [];
  const authorised = input.authorised ?? [];
  return Object.freeze({
    changedSincePhaseEntry: Object.freeze([...changed].sort()),
    authorisedFromTheTaskTextAtLaunch: authorisedChanges(changed, authorised),
    unauthorised: unauthorisedChanges(changed, authorised),
    changedSinceLaunchInApprovedPhases: Object.freeze(
      [...(input.changedSinceLaunchInApprovedPhases ?? [])].sort(),
    ),
    suppressionMarkers: Object.freeze({ ...(input.suppressionMarkers ?? {}) }),
  });
}

/** True where the fact says the protected set was changed without authority. */
export function factStatesAnUnauthorisedChange(fact: ProtectedSetFact): boolean {
  return fact.unauthorised.length > 0;
}

/* ------------------------------------------------------------------ *
 * No count of tests (ruling 53; F100-FR-135).
 * ------------------------------------------------------------------ */

/** F148-FR-006, ruling 53 — no count of tests is contributed. */
export const COUNT_OF_TESTS_IS_CONTRIBUTED = false as const;

/** Feature 100's own form of the same rule (F100-FR-135), read not restated. */
export { TEST_COUNTS_SHOWN_IN_WAVE_1, mayBeInTheBlock, COUNT_THAT_IS_SHOWN };

/**
 * The subjects whose COUNT would be a count of tests. A field is a count of
 * tests when its name names one of these and its value is a number: `tests`,
 * `testsPassed`, `failedAssertions`, `suiteCount` are all counts of tests;
 * `changedSincePhaseEntry` is a list of paths and no count at all.
 */
export const COUNT_OF_TESTS_SUBJECTS: readonly RegExp[] = Object.freeze([
  /\btests?\b/,
  /\bassertions?\b/,
  /\bsuites?\b/,
  /\bspecs?\b/,
  /\bcases?\b/,
  /\bchecks?\b/,
]);

/** A field name read as words, so `testsPassed` and `tests_passed` are one subject. */
export function wordsOf(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/**
 * F148-FR-006 — true where the field and its value are a COUNT of tests. The
 * count of suppression markers that §D.7 does show is never one, whatever it
 * is called.
 */
export function isACountOfTests(field: string, value: unknown): boolean {
  if (typeof value !== "number") return false;
  const words = wordsOf(field);
  if (COUNT_THAT_IS_SHOWN.test(words)) return false;
  return COUNT_OF_TESTS_SUBJECTS.some((pattern) => pattern.test(words));
}

/** One field of a contribution that is a count of tests, with its path in it. */
export type CountOfTests = { readonly at: string; readonly field: string; readonly value: number };

/**
 * Every count of tests a contribution holds, however deep. A list is walked by
 * index, so a count inside `units[0].commands[2]` is found too.
 */
export function countsOfTestsIn(value: unknown, at = ""): readonly CountOfTests[] {
  const found: CountOfTests[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${String(index)}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [field, child] of Object.entries(node as Record<string, unknown>)) {
      const here = path === "" ? field : `${path}.${field}`;
      if (isACountOfTests(field, child)) {
        found.push(Object.freeze({ at: here, field, value: child as number }));
        continue;
      }
      walk(child, here);
    }
  };
  walk(value, at);
  return Object.freeze(found);
}

/** F148-FR-006 — true where the contribution holds no count of tests. */
export function holdsNoCountOfTests(contribution: unknown): boolean {
  return countsOfTestsIn(contribution).length === 0;
}

/** Raised where a caller puts a count of tests into a contribution. */
export class CountOfTestsRefusedError extends Error {
  readonly counts: readonly CountOfTests[];
  constructor(counts: readonly CountOfTests[]) {
    super(
      `no count of tests is contributed to the fact block (F148-FR-006, ruling 53; ` +
        `F100-FR-135): ${counts.map((c) => `\`${c.at}\` = ${String(c.value)}`).join(", ")}`,
    );
    this.name = "CountOfTestsRefusedError";
    this.counts = Object.freeze([...counts]);
  }
}

/* ------------------------------------------------------------------ *
 * The contribution.
 * ------------------------------------------------------------------ */

/** What this feature contributes to the fact block of a phase attempt. */
export type FactContribution = {
  /** The field `protected` of §D.7. */
  readonly protected: ProtectedSetFact;
  /** The field `integrity` of §D.7: kinds, without counts. */
  readonly integrity: readonly string[];
  /** True where the contribution states a change without authority. */
  readonly unauthorisedChange: boolean;
  /** The gate ran, approval stays possible, and the run does not halt. */
  readonly gateStillRan: true;
  readonly approvalStaysPossible: true;
  readonly theRunHalts: false;
};

/**
 * F148-FR-006 — the contribution of this feature to the fact block: the
 * protected-set fact and the integrity kinds, with NO count of tests. A
 * contribution that holds one is refused rather than trimmed, so that the
 * caller learns of it instead of the critic silently losing a field.
 */
export function contributeToTheFactBlock(input: {
  readonly fact?: ProtectedSetFact;
  readonly protectedSet?: ProtectedSetFactInput;
  readonly integrity?: readonly string[];
}): FactContribution {
  const fact = input.fact ?? protectedSetFact(input.protectedSet ?? {});
  const contribution: FactContribution = Object.freeze({
    protected: fact,
    integrity: Object.freeze([...new Set(input.integrity ?? [])]),
    unauthorisedChange: factStatesAnUnauthorisedChange(fact),
    gateStillRan: GATE_STILL_RUNS,
    approvalStaysPossible: APPROVAL_STAYS_POSSIBLE,
    theRunHalts: THE_RUN_HALTS,
  });
  const counts = countsOfTestsIn(contribution);
  if (counts.length > 0) throw new CountOfTestsRefusedError(counts);
  return contribution;
}
