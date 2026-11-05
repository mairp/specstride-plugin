/**
 * T003 — the rule table of the model-tier bump as a frozen constant
 * (F149-FR-003 to F149-FR-006; annex X §X.3, F100-FR-204).
 *
 * The table is the one of `specs/149-attempt-planner-and-seams/contracts/bump-table.json`.
 * It lives here and not in `packages/contracts/data/`, which the sync script of
 * feature 100 clean-copies from feature 100's own contracts
 * (`contracts/README.md` of this feature).
 *
 * It has the one decision point `attempt-tier`, which belongs to the attempt
 * planner and not to the router (F100-FR-204, last sentence), with the choice
 * set "Outcomes of the bump rule" (row 253 of annex X §X.6). The reason of a
 * skipped bump is derived from the rule that fired, not from a field of the
 * table: `TB-04` gives `ladder-top`, `TB-05` gives `critic-model`, `TB-06`
 * gives `quota-exhausted` (`contracts/README.md`).
 *
 * ## The form of a predicate
 *
 * The contract file writes a leaf predicate as one pair, `{"<op>": [<operands>]}`.
 * The load check of the table evaluator of the kernel — the check T003 requires
 * this constant to pass — reads the leaf form of annex X §X.3 that feature 100
 * implements in `packages/kernel/src/table/load.ts`: `{op, signal, value}` for
 * the six leaf operators and `{op, of}` for `and`, `or` and `not`. Where the
 * spec and feature 100 differ, feature 100 stands (`contracts/README.md` of
 * this feature), so the constant carries the leaf form of feature 100: the
 * first operand of the contract file is the `signal`, the second is the
 * `value`. The translation is total and reversible on this table, and
 * `tests/characterization/149/bump-table-load.test.ts` asserts equality with
 * the contract file in both directions.
 *
 * One consequence is recorded here rather than left silent. The row
 * `TB-02-below-k` compares two declared signals, `criticRejections` and `k`;
 * the leaf form of §X.3 compares a signal with a literal. The constant keeps
 * the operand the contract file gives, so `value` holds the signal name `"k"`,
 * and the planner of T025 binds that operand to the value of `k` in the vector
 * of signals before it evaluates the table. Until T025 does so the row decides
 * nothing; no other row of the table reads two signals.
 */

/** A leaf or a combinator of a predicate, in the leaf form of annex X §X.3. */
export type BumpPredicate = {
  readonly op: string;
  readonly signal?: string;
  readonly value?: unknown;
  readonly of?: readonly BumpPredicate[];
};

/** One row of the table: the rule id, the predicate (absent in the default row), the choice. */
export type BumpTableRow = {
  readonly ruleId: string;
  readonly when?: BumpPredicate;
  readonly choice: string;
};

/** The table, in the shape `specstride.table/1` gives (annex X §X.3). */
export type BumpTable = {
  readonly schema: string;
  readonly id: string;
  readonly version: string;
  readonly points: {
    readonly "attempt-tier": {
      readonly signals: Readonly<Record<string, string>>;
      readonly choices: readonly string[];
    };
  };
  readonly rows: {
    readonly "attempt-tier": readonly BumpTableRow[];
  };
};

/** The id of the table, recorded with every decision (F100-FR-204). */
export const BUMP_TABLE_ID = "attempt-planner.tier-bump" as const;

/** The version of the table, recorded with every decision (F100-FR-204). */
export const BUMP_TABLE_VERSION = "1.0.0" as const;

/** The one decision point of the table (F100-FR-204). */
export const BUMP_TABLE_POINT = "attempt-tier" as const;

/** Freeze a value and everything it holds, so that no reader can change the table. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * The rule table of the model-tier bump, frozen through and through.
 *
 * Equal to `specs/149-attempt-planner-and-seams/contracts/bump-table.json`,
 * with the leaf form of annex X §X.3 that the load check of the kernel reads
 * (see the head of this module).
 */
export const BUMP_TABLE: BumpTable = deepFreeze({
  schema: "specstride.table/1",
  id: BUMP_TABLE_ID,
  version: BUMP_TABLE_VERSION,
  points: {
    "attempt-tier": {
      signals: {
        optionOn: "boolean",
        criticRejections: "integer",
        k: "integer",
        alreadyBumped: "boolean",
        hasHigherTier: "boolean",
        targetIsCriticModel: "boolean",
        targetQuotaExhausted: "boolean",
      },
      choices: ["bump", "skip", "none"],
    },
  },
  rows: {
    "attempt-tier": [
      {
        ruleId: "TB-01-option-off",
        when: { op: "equal", signal: "optionOn", value: false },
        choice: "none",
      },
      {
        ruleId: "TB-02-below-k",
        when: { op: "less", signal: "criticRejections", value: "k" },
        choice: "none",
      },
      {
        ruleId: "TB-03-already-bumped",
        when: { op: "equal", signal: "alreadyBumped", value: true },
        choice: "none",
      },
      {
        ruleId: "TB-04-ladder-top",
        when: { op: "equal", signal: "hasHigherTier", value: false },
        choice: "skip",
      },
      {
        ruleId: "TB-05-critic-model",
        when: { op: "equal", signal: "targetIsCriticModel", value: true },
        choice: "skip",
      },
      {
        ruleId: "TB-06-quota-exhausted",
        when: { op: "equal", signal: "targetQuotaExhausted", value: true },
        choice: "skip",
      },
      { ruleId: "TB-07-bump", when: { op: "present", signal: "criticRejections" }, choice: "bump" },
      { ruleId: "TB-00-default", choice: "none" },
    ],
  },
} satisfies BumpTable);

/**
 * The rule id of each reason of a skipped bump (row 254 of annex X §X.6). The
 * table form of feature 100 has no field for the reason, and none is added:
 * the reason is derived from the rule that fired (`contracts/README.md`).
 */
export const SKIP_REASON_OF_RULE: Readonly<
  Record<string, "ladder-top" | "critic-model" | "quota-exhausted">
> = Object.freeze({
  "TB-04-ladder-top": "ladder-top",
  "TB-05-critic-model": "critic-model",
  "TB-06-quota-exhausted": "quota-exhausted",
});
