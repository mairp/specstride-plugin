/**
 * T302 — the interface through which the engine calls finalization
 * (annex A, §A.4, F100-FR-237; annex X §X.6 row 175).
 *
 * The calls of the engine into the invocation code of feature 126 are a plain
 * function interface of the `contracts` package at layer L2, which the
 * composition root hands to the engine. It is NO extension point in Wave 1:
 * there is one implementation, in `@specstride/harness` (feature 126), and the
 * caller is the pass loop (feature 103, F103-FR-013).
 *
 * The three operations:
 *
 *  - `reconcile` — the observations of one invocation into a result;
 *  - `finalize`  — one invocation into the result, its event and a decision of
 *                  the closed set of row 175 of annex X §X.6;
 *  - `sweepRetention` — the invocations of a run.
 *
 * `finalize` takes the invocation identity, the breaker state, the limit, an
 * optional kill reason and an optional cap limit, and returns the decision,
 * the reason code, `is_error`, the count of consecutive errors, the kill class
 * and the cap count (F126-FR-034).
 */
import { finalizationDecisions } from "../enums/sets-126-129.ts";
import { killClassesReadByLearning } from "../enums/sets-105-109.ts";

/** This interface is no extension point in Wave 1 (F100-FR-237). */
export const FINALIZATION_IS_AN_EXTENSION_POINT = false as const;

/** The layer of the `contracts` package at which the interface sits (annex A §A.2). */
export const FINALIZATION_LAYER = "L2" as const;

/** The package that implements it, and the package that calls it (F100-FR-237). */
export const FINALIZATION_IMPLEMENTATION = "@specstride/harness" as const;
export const FINALIZATION_CALLER = "the pass loop (feature 103, F103-FR-013)" as const;

/** The composition root hands the interface to the engine (F100-FR-237). */
export const HANDED_TO_THE_ENGINE_BY = "the composition root" as const;

/**
 * The decisions of row 175 of annex X §X.6: `cap_halt`, `halt`, `continue`.
 * An unknown value is read as `continue`.
 */
export const FINALIZATION_DECISIONS = finalizationDecisions.members;
export type FinalizationDecision = (typeof FINALIZATION_DECISIONS)[number];

/** The closed set of the decisions, for a reader that needs its unknown rule. */
export const finalizationDecisionSet = finalizationDecisions;

/** The kill classes of row 280 of annex X §X.6, which `finalize` may return. */
export type KillClass = (typeof killClassesReadByLearning.members)[number];

/** Which invocation the call is about. */
export type InvocationIdentity = {
  /** The run the invocation belongs to. */
  readonly runId: string;
  /** The pass the invocation belongs to. */
  readonly passId: string;
  /** The invocation itself. */
  readonly invocationId: string;
};

/** The state of the breaker that `finalize` reads (F126-FR-034). */
export type BreakerState = {
  /** How many errors have followed one another so far. */
  readonly consecutiveErrors: number;
  /** True while the breaker is open. */
  readonly open: boolean;
};

/** The limit `finalize` is given: how many consecutive errors it allows. */
export type FinalizationLimit = {
  /** The count at which the breaker halts the run. */
  readonly consecutiveErrorLimit: number;
};

/** One observation of an invocation, as `reconcile` receives them. */
export type InvocationObservation = {
  /** Where the observation came from: the stream, the exit, the harness. */
  readonly source: string;
  /** The moment of the observation, as the event envelope writes it. */
  readonly at: string;
  /** The values the observation carries; no content (annex B, §B.4). */
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
};

/** The result of one invocation, as `reconcile` forms it. */
export type InvocationResult = {
  readonly invocation: InvocationIdentity;
  /** True where the invocation ended in an error. */
  readonly isError: boolean;
  /** The reason code of the result; empty where there is none. */
  readonly reasonCode: string;
  /** The exit code of the harness call, or null where it did not run. */
  readonly exitCode: number | null;
  /** The observations the result was reconciled from, in the order received. */
  readonly observations: readonly InvocationObservation[];
};

/** The event `finalize` writes beside the result. */
export type FinalizationEvent = {
  /** The event name of the envelope of annex X §X.1. */
  readonly event: string;
  readonly invocation: InvocationIdentity;
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
};

/** What `finalize` returns (F126-FR-034). */
export type FinalizationOutcome = {
  /** The decision, of the closed set of row 175. */
  readonly decision: FinalizationDecision;
  /** The reason code of the decision. */
  readonly reasonCode: string;
  /** Whether the invocation is an error. */
  readonly is_error: boolean;
  /** How many errors have now followed one another. */
  readonly consecutiveErrors: number;
  /** The kill class, where a kill reason was given; else null. */
  readonly killClass: KillClass | "unknown" | null;
  /** How many times the cap has been reached. */
  readonly capCount: number;
  /** The result of the invocation. */
  readonly result: InvocationResult;
  /** The event to emit. */
  readonly event: FinalizationEvent;
};

/** What `sweepRetention` returns. */
export type RetentionSweepOutcome = {
  /** How many invocations of the run were swept. */
  readonly swept: number;
  /** How many were kept. */
  readonly kept: number;
};

/**
 * `reconcile` — the observations of one invocation into a result
 * (F100-FR-237). A plain function type: no extension point, no registry.
 */
export type Reconcile = (
  invocation: InvocationIdentity,
  observations: readonly InvocationObservation[],
) => InvocationResult;

/**
 * `finalize` — one invocation into the result, its event and a decision of the
 * closed set of row 175 (F100-FR-237, F126-FR-034). It takes the invocation
 * identity, the breaker state, the limit, an OPTIONAL kill reason and an
 * OPTIONAL cap limit.
 */
export type Finalize = (
  invocation: InvocationIdentity,
  breaker: BreakerState,
  limit: FinalizationLimit,
  killReason?: string | undefined,
  capLimit?: number | undefined,
) => FinalizationOutcome;

/** `sweepRetention` — the invocations of a run (F100-FR-237). */
export type SweepRetention = (runId: string) => RetentionSweepOutcome;

/**
 * The three operations as one interface, which the composition root hands to
 * the engine (F100-FR-237).
 */
export type Finalization = {
  readonly reconcile: Reconcile;
  readonly finalize: Finalize;
  readonly sweepRetention: SweepRetention;
};

/** The names of the three operations, in the order F100-FR-237 gives them. */
export const FINALIZATION_OPERATIONS = ["reconcile", "finalize", "sweepRetention"] as const;
export type FinalizationOperation = (typeof FINALIZATION_OPERATIONS)[number];

/** What `finalize` is given, in the order F100-FR-237 names them. */
export const FINALIZE_INPUTS = [
  "the invocation identity",
  "the breaker state",
  "the limit",
  "an optional kill reason",
  "an optional cap limit",
] as const;

/** What `finalize` returns, in the order F100-FR-237 names them. */
export const FINALIZE_OUTPUTS = [
  "the decision",
  "the reason code",
  "is_error",
  "the count of consecutive errors",
  "the kill class",
  "the cap count",
] as const;
