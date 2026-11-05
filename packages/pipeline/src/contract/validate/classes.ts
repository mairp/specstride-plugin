/**
 * T064 — the table of the error classes of validation and the class in the
 * `--json` form of `contract validate` and `contract render`
 * (F107-FR-040; CQ-194; annex X §X.6 row 274).
 *
 * The ten classes are the closed set `errorClassesOfTheValidationOfALaunchContract`
 * of `@specstride/contracts` (row 274), read BY REFERENCE — the members are
 * never copied by hand here (the closed-set rule of feature 100, F100-FR-208).
 * An unknown class fails the build.
 *
 * The table is the ONE place that maps what the validator reports — a composed
 * schema error, a post-schema rule problem, a supervision ceiling, a learning
 * binding rule, a staleness verdict, or the cannot-read refusal — onto exactly
 * one class. Every rule of the validator has a row (the static test
 * `tests/characterization/107/error-classes.test.ts` CT-107-18 holds the table
 * to this), and a report the table cannot classify throws, so a new rule that
 * arrives without a class breaks the build instead of passing silently.
 *
 * The default lines print no class: the class is data of the `--json` form
 * only (F107-FR-040).
 */
import { errorClassesOfTheValidationOfALaunchContract } from "@specstride/contracts/enums/all-sets";

/** The ten error classes of validation (annex X §X.6 row 274; CQ-194). */
export type ErrorClass = (typeof errorClassesOfTheValidationOfALaunchContract.members)[number];

/** The closed set, as data: the ten members, in the order of the annex. */
export const ERROR_CLASSES: readonly ErrorClass[] = Object.freeze([
  ...errorClassesOfTheValidationOfALaunchContract.members,
]);

/** The row of annex X §X.6 the set is read from. */
export const ERROR_CLASS_ROW = 274 as const;

/* ------------------------------------------------------------------ *
 * The table.
 * ------------------------------------------------------------------ */

/**
 * The class of each RULE GROUP of the post-schema rules (T033), the
 * supervision ceilings (T036) and the declarations (T054), before the
 * special cases below narrow it. Every group of `rules.ts`, `supervision.ts`
 * and `declarations.ts` appears exactly once; a group added there without a
 * row here is the build failure `unclassifiedProblem` raises.
 */
export const RULE_CLASS_TABLE: Readonly<Record<string, ErrorClass>> = Object.freeze({
  identity: "structure",
  roots: "structure",
  sources: "structure",
  stages: "structure",
  actions: "action",
  checks: "check",
  coverage: "structure",
  findings: "structure",
  supervision: "structure",
  declarations: "structure",
  staleness: "structure",
  "learning-binding": "learning",
  "composed-schema": "structure",
});

/** One classification input: what the validator reports about one place. */
export type ClassifiedReport = {
  /** The rule group: a key of `RULE_CLASS_TABLE`, or a rule of the port. */
  readonly rule: string;
  /** The path inside the launch contract. */
  readonly path: string;
  readonly message: string;
};

/** A composed schema error, as `compose.ts` reports it. */
export type ClassifiedComposedError = {
  readonly keyword: string;
  readonly path: string;
  readonly message: string;
  /** The property an `additionalProperties` refusal names, when there is one. */
  readonly property?: string | undefined;
};

/** One error as the `--json` form prints it: the class is the added member. */
export type ClassifiedError = {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
  readonly class: ErrorClass;
};

/* ------------------------------------------------------------------ *
 * The special cases, in the order they are applied.
 * ------------------------------------------------------------------ */

/**
 * The rows that narrow a rule group onto a more specific class. `match` is a
 * predicate over the report; the FIRST row that matches wins, and the table
 * below it (the rule group) is the fallback. Every row carries the row of the
 * requirement or the fixture family that pins it.
 */
const SPECIAL_CASES: readonly {
  readonly name: string;
  readonly class_: ErrorClass;
  readonly match: (report: ClassifiedReport) => boolean;
}[] = Object.freeze([
  // F107-FR-024, DV-055 — the old name `configuration.auto` is not accepted.
  {
    name: "configuration.auto",
    class_: "auto",
    match: (one) => one.path.startsWith("/configuration/auto"),
  },
  // The learning binding (port 2 of T007; FX-33/invalid-learning).
  {
    name: "configuration.learning",
    class_: "learning",
    match: (one) => one.path.startsWith("/configuration/learning"),
  },
  // F107-FR-015 — the verification-commands file an action passes
  // (FX-33/invalid-verification-commands).
  {
    name: "actions.verification-commands",
    class_: "verification-commands",
    match: (one) => one.rule === "actions" && one.path.includes("/verification-commands"),
  },
  // F107-FR-022 — the status readiness: only promotion writes `validated`
  // (FX-33/invalid-not-promoted, through the render).
  {
    name: "identity.status-validated",
    class_: "not-promoted",
    match: (one) => one.rule === "identity" && one.path === "/status",
  },
  // F107-FR-017 — the open blocker refuses promotion
  // (FX-33/invalid-open-blocker).
  {
    name: "findings.no-open-blocker",
    class_: "open-blocker",
    match: (one) => one.message.includes("is an open blocker"),
  },
  // F107-FR-017, last sentence — the unchecked prerequisite
  // (FX-33/invalid-unchecked-prerequisite).
  {
    name: "findings.no-unchecked-prerequisite",
    class_: "unchecked-prerequisite",
    match: (one) => one.message.includes("no precondition names it"),
  },
]);

/**
 * The class of one post-schema (or supervision, or declaration, or learning)
 * problem: the special cases first, then the rule group of the table, then —
 * for a rule the table does not hold — the build failure.
 */
export function classOfProblem(report: ClassifiedReport): ErrorClass {
  for (const special of SPECIAL_CASES) {
    if (special.match(report)) return special.class_;
  }
  const fromTable = RULE_CLASS_TABLE[report.rule];
  if (fromTable !== undefined) return fromTable;
  return unclassifiedProblem(report);
}

/**
 * The PROPERTY rows: the schema refuses an unknown member (the top level and
 * `configuration` are closed), and the member the baseline judged with its
 * own validator keeps that validator's class. Applied when the refusal names
 * the property at the top level or under `configuration`
 * (FX-33/invalid-action, invalid-check, invalid-auto, invalid-learning,
 * invalid-verification-commands).
 */
const PROPERTY_CASES: readonly {
  readonly class_: ErrorClass;
  readonly properties: readonly string[];
}[] = Object.freeze([
  { class_: "action", properties: ["action"] },
  { class_: "check", properties: ["check"] },
  { class_: "auto", properties: ["auto"] },
  { class_: "learning", properties: ["learning"] },
  { class_: "verification-commands", properties: ["verification_commands", "verification"] },
]);

/**
 * The class of one composed schema error: the places the schema refuses that
 * the baseline judged with its own validators get their own class, everything
 * else is `structure`.
 */
export function classOfComposedError(error: ClassifiedComposedError): ErrorClass {
  const at = error.path === "" || error.path === "/" || error.path === "/configuration";
  if (at && error.property !== undefined) {
    for (const one of PROPERTY_CASES) {
      if (one.properties.includes(error.property)) return one.class_;
    }
  }
  return classOfProblem({ rule: "composed-schema", path: error.path, message: error.message });
}

/** The class of the refusal of a file the validator cannot read at all. */
export const UNREADABLE_CLASS: ErrorClass = "unreadable";

/** The class of the render refusal: the contract was not promoted (or changed). */
export const NOT_PROMOTED_CLASS: ErrorClass = "not-promoted";

/** The schema field every `--json` form of the launch-contract commands carries. */
export const JSON_SCHEMA_FIELD = {
  validate: "specstride.contract-validate/1",
  render: "specstride.contract-render/1",
} as const;

/**
 * The `--json` errors of one validation outcome: every error names its class
 * (F107-FR-040), in the order the validator reported them.
 */
export function classifiedErrors(input: {
  readonly composedErrors: readonly ClassifiedComposedError[];
  readonly problems: readonly ClassifiedReport[];
}): ClassifiedError[] {
  return [
    ...input.composedErrors.map((one) => ({
      rule: "composed-schema",
      path: one.path,
      message: one.message,
      class: classOfComposedError(one),
    })),
    ...input.problems.map((one) => ({
      rule: one.rule,
      path: one.path,
      message: one.message,
      class: classOfProblem(one),
    })),
  ];
}

/** The build failure: a report the table holds no row for (assumption CQ-194). */
function unclassifiedProblem(report: ClassifiedReport): ErrorClass {
  throw new Error(
    `the validator reported a problem with no error class (annex X §X.6 row 274): ` +
      `rule ${report.rule} at ${report.path}: ${report.message}`,
  );
}
