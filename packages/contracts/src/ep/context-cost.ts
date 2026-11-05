/**
 * T003 of `specs/113-host-claude-code/tasks.md` — the table of row 145 of
 * annex X §X.6, "Checks of the context-cost build", owner 113.
 *
 * The row of the annex gives no literals: it refers to another table of the
 * package, and registers by reference to that export (T250 to T256). This
 * module is that table. Its members are the seven checks of spec.md, section
 * "Closed sets", and they are held at load against
 * `data/closed-sets-113.json`, the data file feature 113 delivers into this
 * package through `specs/113-host-claude-code/contracts/deliver.json` (T299),
 * so the table and the specification cannot drift.
 *
 * Unknown value: the build fails. A check name outside the seven is not a
 * check of the context-cost build, and the build refuses rather than skip it
 * (F100-FR-209).
 */
import closedSets113 from "../../data/closed-sets-113.json" with { type: "json" };

/** The row of annex X §X.6 this table belongs to. */
export const CONTEXT_COST_ROW = 145 as const;
/** The feature that owns the row. */
export const CONTEXT_COST_OWNER = "113" as const;
/** The name of the set in the annex. */
export const CONTEXT_COST_SET_NAME = "Checks of the context-cost build" as const;
/** The name feature 113's own specification uses for the same set. */
export const CONTEXT_COST_SET_NAME_IN_SPEC = "Checks of the context-cost CI" as const;

/**
 * The seven checks of the context-cost build (spec.md, "Closed sets";
 * F113-FR-036, F113-FR-037). None of them calls a model: they are checks of
 * the per-change build, measured in bytes.
 */
export const CONTEXT_COST_CHECKS = [
  "static size",
  "reference closure",
  "golden output",
  "supervision cycle",
  "judgment payload",
  "host cross-check",
  "startup",
] as const;
export type ContextCostCheck = (typeof CONTEXT_COST_CHECKS)[number];

/** The count the specification pins: seven checks (spec.md; R17 Part 2; ruling 65). */
export const CONTEXT_COST_CHECK_COUNT = 7 as const;

/** The logical ids of the host skills and entries: row 144, owner 113. */
export const HOST_SKILL_AND_ENTRY_IDS = ["specstride-run", "specstride-reverse", "doctor"] as const;
export type HostSkillOrEntryId = (typeof HOST_SKILL_AND_ENTRY_IDS)[number];

type Row = {
  row: string;
  set: string;
  literals: string[];
  owner: string;
  closedBy: string;
  unknownValue: string;
};

/** The rows of `data/closed-sets-113.json`, the data file feature 113 delivers. */
export const closedSetRowsOf113: readonly Row[] = Object.freeze(
  (closedSets113 as { sets: Row[] }).sets.map((row) => Object.freeze({ ...row })),
);

/** The row of `data/closed-sets-113.json` with a number, or `undefined`. */
export function rowOf113(number: number): Row | undefined {
  return closedSetRowsOf113.find((r) => r.row === String(number));
}

/**
 * The table and the data file cannot drift: the members of each row of
 * `data/closed-sets-113.json` that this module holds a tuple for are compared
 * at LOAD, and a difference throws rather than let the package export a set
 * the specification does not name.
 */
function assertNoDrift(): void {
  const pairs: readonly [number, readonly string[]][] = [
    [CONTEXT_COST_ROW, CONTEXT_COST_CHECKS],
    [144, HOST_SKILL_AND_ENTRY_IDS],
  ];
  for (const [number, members] of pairs) {
    const row = rowOf113(number);
    if (row === undefined) {
      throw new Error(
        `data/closed-sets-113.json holds no row ${number}; the closed sets of feature 113 ` +
          `are delivered by specs/113-host-claude-code/contracts/deliver.json (T299)`,
      );
    }
    if (row.literals.join("\u0000") !== members.join("\u0000")) {
      throw new Error(
        `row ${number} ("${row.set}") of data/closed-sets-113.json holds the members ` +
          `[${row.literals.join(", ")}]; this module holds [${members.join(", ")}] ` +
          `(F100-FR-208, F100-FR-209)`,
      );
    }
  }
  if (CONTEXT_COST_CHECKS.length !== CONTEXT_COST_CHECK_COUNT) {
    throw new Error(
      `the context-cost build has ${CONTEXT_COST_CHECK_COUNT} checks; the table holds ` +
        `${CONTEXT_COST_CHECKS.length}`,
    );
  }
}

assertNoDrift();

/** True where the value is one of the seven checks. */
export function isContextCostCheck(value: string): value is ContextCostCheck {
  return (CONTEXT_COST_CHECKS as readonly string[]).includes(value);
}
