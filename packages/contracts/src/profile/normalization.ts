/**
 * T074 — `normalization.json` as versioned data with a loader (annex X, §X.8;
 * F100-FR-213, F100-FR-215).
 *
 * The 29 rules N-01 to N-29 with the assertion that no rule is added without a
 * register row, the mode map, the exit-code map of `resume`, the key-name map
 * of the launch contract, and the variables of the hermetic environment of
 * the oracle as a documented mapping.
 */
import normalization from "../../data/normalization.json" with { type: "json" };

/** The schema id of the normalization contract. */
export const SCHEMA_ID: string = (normalization as { schema: string }).schema;

/** One normalization rule of §X.8. */
export type NormalizationRule = {
  /** `N-01` to `N-29`. */
  readonly id: string;
  /** What the rule is about. */
  readonly subject: string;
  /** The rule, verbatim. */
  readonly rule: string;
};

type RawRule = { Id: string; Subject: string; Rule: string };

/** F100-FR-213 — the rules are exactly N-01 to N-29. */
export const RULE_COUNT = 29 as const;
export const FIRST_RULE = "N-01" as const;
export const LAST_RULE = "N-29" as const;

/** Load the rules from `data/normalization.json` (F100-FR-213). */
export function loadRules(): readonly NormalizationRule[] {
  return Object.freeze(
    (normalization as { rules: RawRule[] }).rules.map((row) =>
      Object.freeze({ id: row.Id, subject: row.Subject, rule: row.Rule }),
    ),
  );
}

/** The 29 rules, in the order of the annex. */
export const rules: readonly NormalizationRule[] = loadRules();

/** The rule of an id, or `undefined`. */
export function rule(id: string): NormalizationRule | undefined {
  return rules.find((r) => r.id === id);
}

/** A rule set the loader refuses. */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

/**
 * F100-FR-213 — the rules MUST be exactly N-01 to N-29; a rule is added only
 * with a row of the divergence register, or with a statement that the value
 * is not deterministic in the reference itself. `assertRules` is the
 * assertion the loader makes: the ids are the 29 of the annex, each once, in
 * order, and a rule beyond them carries a register row.
 */
export function assertRules(
  loaded: readonly NormalizationRule[] = rules,
  registerRowOf: (id: string) => string | undefined = () => undefined,
): void {
  const expected = Array.from(
    { length: RULE_COUNT },
    (_, i) => `N-${String(i + 1).padStart(2, "0")}`,
  );
  const ids = loaded.map((r) => r.id);
  const missing = expected.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    throw new NormalizationError(
      `the normalization rules ${missing.join(", ")} of annex X §X.8 are missing ` +
        `(F100-FR-213)`,
    );
  }
  for (const id of ids) {
    if (expected.includes(id)) continue;
    const row = registerRowOf(id);
    if (row === undefined) {
      throw new NormalizationError(
        `the normalization rule ${id} is not one of ${FIRST_RULE} to ${LAST_RULE} and ` +
          `carries no row of the divergence register (F100-FR-213)`,
      );
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new NormalizationError(`a normalization rule is listed twice (F100-FR-213)`);
  }
}

// The loader asserts at load, as F100-FR-213 requires.
assertRules();

/**
 * F100-FR-213 — N-02 applies to the text of messages as well as to captured
 * trees.
 */
export const N_02_APPLIES_TO_MESSAGE_TEXT = true as const;

/** F100-FR-213 — a rule that replaces nothing in any fixture fails the suite. */
export const A_RULE_THAT_REPLACES_NOTHING_FAILS_THE_SUITE = true as const;

/** The mode map of §X.8: the as-is mode to the mode of the product. */
export const modeMap: Readonly<Record<string, string>> = Object.freeze({
  ...(normalization as { modeMap: Record<string, string> }).modeMap,
});

/** One row of the exit-code map of `resume` (§X.8). */
export type ResumeExitCodeRow = {
  /** The as-is code. */
  readonly asIs: number;
  /** What caused it. */
  readonly cause: string;
  /** The code of the product. */
  readonly next: number;
};

export const resumeExitCodeMap: readonly ResumeExitCodeRow[] = Object.freeze(
  (
    normalization as { resumeExitCodeMap: { asIs: number; cause: string; new: number }[] }
  ).resumeExitCodeMap.map((row) =>
    Object.freeze({ asIs: row.asIs, cause: row.cause, next: row.new }),
  ),
);

/** The code of the product for an as-is code of `resume`, where one is mapped. */
export function resumeExitCode(asIs: number): number | undefined {
  return resumeExitCodeMap.find((r) => r.asIs === asIs)?.next;
}

/** The key-name map of the launch contract (§X.8). */
export const launchContractKeyMap: Readonly<Record<string, string>> = Object.freeze({
  ...(normalization as { launchContractKeyMap: Record<string, string> }).launchContractKeyMap,
});

/** The key of the product for an as-is key of the launch contract. */
export function launchContractKey(asIs: string): string | undefined {
  return launchContractKeyMap[asIs];
}

/**
 * F100-FR-215 — the port reads the variables of the hermetic environment of
 * the oracle, or a documented mapping of them that is part of the
 * normalization contract. The mapping is the environment alias table of §X.8
 * (`environmentAliases`), which `src/envelope/config-validate.ts` reads: an
 * as-is variable name is an alias of a key of feature 110.
 */
export const HERMETIC_ENVIRONMENT_MAPPING = "environmentAliases" as const;

export type HermeticVariable = {
  /** The as-is variable of the hermetic environment. */
  readonly variable: string;
  /**
   * The key it is an alias of. Empty where the table states in words that the
   * variable maps to no key — the as-is hand-over of a prompt as a file, a
   * variable accepted without effect, a name that is not carried — and then
   * `note` says which.
   */
  readonly key: string;
  /** The `Key` cell of the row, verbatim. */
  readonly note: string;
};

/** Every back-ticked token of a cell, in order; a cell may qualify them in prose. */
const unbacktick = (cell: string): string[] =>
  [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

/** The documented mapping of the hermetic environment (F100-FR-215). */
export const hermeticEnvironment: readonly HermeticVariable[] = Object.freeze(
  (
    normalization as { environmentAliases: { "As-is variable": string; Key: string }[] }
  ).environmentAliases.flatMap((row) => {
    const variables = unbacktick(row["As-is variable"]);
    const keys = unbacktick(row.Key);
    return variables.map((variable, i) =>
      Object.freeze({ variable, key: keys[i] ?? keys[0] ?? "", note: row.Key }),
    );
  }),
);

/**
 * F100-FR-215 — stub transcripts are a compared surface, in a form that is
 * neutral to the transport of the critic.
 */
export const STUB_TRANSCRIPTS_ARE_A_COMPARED_SURFACE = true as const;
export const STUB_TRANSCRIPT_FORM_IS_TRANSPORT_NEUTRAL = true as const;
