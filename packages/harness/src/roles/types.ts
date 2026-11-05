/**
 * T006 — the types of feature 124's role resolution: a candidate, an entry of
 * the role plan and the critic pick (`specs/124-harness-discovery-and-roles/
 * data-model.md`; F124-FR-021, F124-FR-023, F124-FR-024, F124-FR-027,
 * F124-FR-032, F124-FR-033, F124-FR-041).
 *
 * The names of the closed sets are the four rows of annex X §X.6 whose owner
 * is 124 (T004, `@specstride/contracts` closed sets `harness-roles.ts`); a
 * value outside a set takes the unknown-value branch of its row, never a
 * branch invented here.
 */
import type { ClosedSet } from "@specstride/contracts/enums";
import {
  reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver,
  resultsOfTheDiversityTest,
  sourcesOfTheProposer,
  stepsOfTheCriticOrder,
} from "@specstride/contracts/enums/all-sets";

/* ------------------------------------------------------------------ *
 * The members of the closed sets, as types.
 * ------------------------------------------------------------------ */

/** Row 180 — a step of the critic order. */
export type StepOfTheCriticOrder = (typeof stepsOfTheCriticOrder.members)[number];

/** Row 181 — the source of the proposer entry (F124-FR-024). */
export type SourceOfTheProposer = (typeof sourcesOfTheProposer.members)[number];

/** Row 182 — why a candidate does not qualify, or is passed over. */
export type ReasonNotQualifiedOrPassedOver =
  (typeof reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver.members)[number];

/** Row 183 — the result of the diversity test. */
export type DiversityResult = (typeof resultsOfTheDiversityTest.members)[number];

/** A closed set whose members this module types. */
export type ClosedSetOf<M extends string> = ClosedSet<M>;

/* ------------------------------------------------------------------ *
 * The candidate (an entry of the field `harnesses`, annex C §C.6).
 * ------------------------------------------------------------------ */

/** The states of a harness (annex C §C.2; the ranking table's key R2). */
export const HARNESS_STATES_OF_A_CANDIDATE = [
  "tested",
  "locally-verified",
  "declared",
  "detected",
] as const;
export type HarnessStateOfACandidate = (typeof HARNESS_STATES_OF_A_CANDIDATE)[number];

/** The two forms of the `completion` level (annex C §C.3). */
export const COMPLETION_FORMS_OF_A_CANDIDATE = ["tool-less", "read-only-tools"] as const;
export type CompletionFormOfACandidate = (typeof COMPLETION_FORMS_OF_A_CANDIDATE)[number];

/** The cost classes of an endpoint (row 34 of annex X §X.6). */
export const COST_CLASSES_OF_A_CANDIDATE = ["subscription", "metered", "local", "unknown"] as const;
export type CostClassOfACandidate = (typeof COST_CLASSES_OF_A_CANDIDATE)[number];

/** A value of the record with the provenance the registry holds for it. */
export type Valued<T> = { readonly value: T; readonly provenance: string };

/**
 * One candidate: an entry of the field `harnesses` of the resolved registry of
 * annex C §C.6, as the resolver reads it. The informational entries of the
 * field (`sources`, and every other entry that only describes how a value was
 * learned) are NOT carried: no informational entry of the field `harnesses`
 * appears in the plan (F124-FR-023).
 */
export type CriticCandidate = {
  /** The id of the harness in the registry. */
  readonly id: string;
  readonly state: HarnessStateOfACandidate;
  readonly origin: string;
  readonly version: string | null;
  readonly descriptorHash: string;
  readonly resolvedPath: string | null;
  /** `cli` or `endpoint` (annex C §C.4). */
  readonly kind: string;
  readonly completionForm: Valued<CompletionFormOfACandidate>;
  readonly costClass: Valued<CostClassOfACandidate>;
  /** The declared or measured window; null where the window is unknown. */
  readonly contextWindow: { readonly tokens: number; readonly source: string } | null;
  readonly memory: Valued<{ readonly native: boolean }>;
  /** The decision of the terms gate with the row it rests on. */
  readonly terms: {
    readonly decision: "allowed" | "refused" | "unknown";
    readonly row: string;
    readonly provenance: string;
  };
  readonly containmentCeiling: string;
  /** True where the consumer named this harness for the role. */
  readonly namedByTheConsumer: boolean;
};

/* ------------------------------------------------------------------ *
 * The role plan entry.
 * ------------------------------------------------------------------ */

/** What an entry of the plan is (F124-FR-033, F124-FR-041). */
export const KINDS_OF_A_PLAN_ENTRY = ["primary", "fallback", "runner-up"] as const;
export type KindOfAPlanEntry = (typeof KINDS_OF_A_PLAN_ENTRY)[number];

/**
 * One entry of the plan: the primary, a fallback the consumer opted into, or
 * a runner-up of an automatic critic pick. The fields of annex C §C.6, plus
 * the fields the data model adds (data-model.md, "Role plan entry").
 */
export type RolePlanEntry = {
  /** The id of the harness in the registry. */
  readonly harness: string;
  /** The model id, or null for the harness's own model (F124-FR-027). */
  readonly model: string | null;
  readonly modelTier: string;
  readonly authTier: number;
  readonly transport: string;
  /** The form of the `completion` level (annex C §C.3). */
  readonly form: CompletionFormOfACandidate;
  readonly containment: string;
  /** Where the proposer came from; a member of row 181 (F124-FR-024). */
  readonly source: SourceOfTheProposer;
  /** `primary`, `fallback` or `runner-up` (F124-FR-033, F124-FR-041). */
  readonly kind: KindOfAPlanEntry;
  /** True for a fallback: the terms gate is asked again when it is used. */
  readonly regate: boolean;
  /** The decision of the terms gate and the row it rests on (F124-FR-032). */
  readonly terms: { readonly decision: string; readonly row: string };
};

/** The plan: per phase, per role, the ordered list of entries. */
export type RolePlan = Readonly<Record<string, Readonly<Record<string, readonly RolePlanEntry[]>>>>;

/* ------------------------------------------------------------------ *
 * The critic pick (`criticPick` of the resolved registry).
 * ------------------------------------------------------------------ */

/** One runner-up of an automatic pick (data-model.md, D-7). */
export type CriticRunnerUp = {
  readonly harness: string;
  readonly model: string | null;
  readonly rank: number;
};

/** One pass-over: which candidate, why, and when the decision fell. */
export type CriticPassOver = {
  readonly harness: string;
  readonly reason: ReasonNotQualifiedOrPassedOver | string;
  readonly decidedAt: string;
};

/** One candidate that did not qualify: the first condition that failed. */
export type CriticNotQualified = {
  readonly harness: string;
  readonly reason: ReasonNotQualifiedOrPassedOver | string;
};

/** Which ranking table and which rule ids produced the decision. */
export type CriticPickTable = {
  readonly id: string;
  readonly version: string;
  readonly ruleIds: readonly string[];
};

/** The pick of the critic, as the resolved registry records it. */
export type CriticPick = {
  /** `configured`, `gateway`, `discovered`, `default-model-tier`. */
  readonly step: StepOfTheCriticOrder;
  /** Whether the pick was automatic. */
  readonly automatic: boolean;
  readonly harness: string;
  readonly model: string | null;
  readonly state: HarnessStateOfACandidate;
  readonly form: CompletionFormOfACandidate;
  /** The context window in tokens; null where it is unknown. */
  readonly window: number | null;
  readonly windowSource: string;
  /** The spending cap of a metered pick, or null (F124-FR-042). */
  readonly cap: number | null;
  /** `diverse`, `same-provider`, `same-model`, `unverified`. */
  readonly diversity: DiversityResult;
  /**
   * Whether the critic-diversity warning was raised: true for `same-model`
   * and `unverified`, false for the others. The field keeps its name, as the
   * event `critic.selected` of the catalogue carries it.
   */
  readonly sameModelWarning: boolean;
  readonly runnersUp: readonly CriticRunnerUp[];
  readonly notQualified: readonly CriticNotQualified[];
  readonly passedOver: readonly CriticPassOver[];
  readonly table: CriticPickTable;
};
