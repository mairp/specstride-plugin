/**
 * T033 — the types of the suite files, read back from the JSON on disk. The
 * files themselves are `evals/trigger-suites.json` and `evals/graders.json`
 * of this package (T027); the static check (`./static-check.ts`) takes the
 * parsed values.
 */

/** One trigger case of a suite file (data-model.md, "Trigger case"). */
export type TriggerCase = {
  readonly id: string;
  readonly kind: "positive" | "negative" | "cross-skill";
  readonly prompt: string;
  /** The expected skill, or null where no skill of this plugin may fire. */
  readonly expected: string | null;
  /** The confusable pair the case belongs to, where it is one. */
  readonly confusablePair?: string;
};

/** One suite file: the cases of one skill. */
export type TriggerSuiteFile = {
  readonly skill: string;
  readonly cases: readonly TriggerCase[];
};

/** One free grader: deterministic, reading recorded behaviour only. */
export type FreeGrader = {
  readonly kind: "free";
  readonly method: string;
  readonly reads: string;
  readonly passes: string;
  /** Always false (F113-FR-039): no grader uses a model judge. */
  readonly modelJudge: false;
};

/** The restriction of tools: no run of the suite can launch (F113-FR-038). */
export type ToolRestriction = {
  readonly allowedTools: readonly string[];
  readonly deniedTools?: readonly string[];
  readonly launchImpossible?: boolean;
  readonly reason?: string;
};

/** The graders file. */
export type FreeGraderFile = {
  readonly toolRestriction?: ToolRestriction;
  readonly graders?: Readonly<Record<string, FreeGrader>>;
};
