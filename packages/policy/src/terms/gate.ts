/**
 * Feature 147 — the gate call (plan.md Constraints; F147-FR-005,
 * F147-FR-006, F147-FR-009).
 *
 * Role resolution and the fallback switch reach the terms gate through the
 * interface of EP-11 (`@specstride/contracts/ep/terms`); the gate call is
 * the one place that, around the pure `evaluate`:
 *
 *  - records every decision with its rule id and the version of the table
 *    (F147-FR-004) at the point of evaluation — at launch, at role
 *    resolution and at every switch to a fallback (F147-FR-005);
 *  - emits the event `terms.override_used` of the catalogue of feature 111
 *    (F111-FR-051) for each launch and each switch that relies on an entry
 *    of `distribution.termsOverride` (F147-FR-009);
 *  - refuses a plan whose primary entry is refused, and marks every
 *    fallback entry the gate does not allow as skipped with the reason
 *    `terms-refused` — the event `fallback.skipped` itself is emitted by the
 *    owner of the fallback switch, feature 127.
 *
 * Nothing here reads a comment, a flag, a mode, a project key or a launch
 * contract: there is no input by which a consumer could bypass the gate
 * (F147-FR-006; F147-SC-001).
 */
import type { Audience, AuthTier, TermsDecision, TermsQuery } from "@specstride/contracts/ep/terms";
import type { TermsGateDecision } from "./table.ts";

/** The points at which the terms gate MUST be evaluated (F147-FR-005). */
export const EVALUATION_POINTS = ["launch", "role-resolution", "fallback-switch"] as const;
export type EvaluationPoint = (typeof EVALUATION_POINTS)[number];

/** The event of the catalogue of feature 111 (F111-FR-051). */
export type TermsOverrideUsedEvent = {
  readonly type: "terms.override_used";
  readonly provider: string;
  readonly authTier: AuthTier;
  readonly audience: Audience;
};

/** The event the owner of the fallback switch (feature 127) emits. */
export type FallbackSkippedEvent = {
  readonly type: "fallback.skipped";
  readonly reason: "terms-refused";
  readonly provider: string;
  readonly authTier: AuthTier;
  readonly audience: Audience;
};

/** Where the gate call records decisions and emits events (annex X §X.4). */
export type GateSink = {
  /** Record one decision with the point it was evaluated at (F147-FR-005). */
  readonly record: (decision: TermsGateDecision, point: EvaluationPoint) => void;
  /** Emit one event of the catalogue of feature 111. */
  readonly emit: (event: TermsOverrideUsedEvent | FallbackSkippedEvent) => void;
};

/** A sink that records nowhere: for the callers that only evaluate. */
export const NULL_SINK: GateSink = Object.freeze({
  record: () => {},
  emit: () => {},
});

/**
 * The gate call for one entry, at one point of evaluation: evaluate, record
 * the decision, and — where the decision relied on an entry of
 * `distribution.termsOverride` — emit `terms.override_used` (F147-FR-009).
 */
export function gate(
  evaluate: (query: TermsQuery) => TermsGateDecision,
  query: TermsQuery,
  point: EvaluationPoint,
  sink: GateSink = NULL_SINK,
): TermsGateDecision {
  const decision = evaluate(query);
  sink.record(decision, point);
  if (decision.overrideUsed) {
    sink.emit({
      type: "terms.override_used",
      provider: query.provider,
      authTier: query.authTier,
      audience: query.audience,
    });
  }
  return decision;
}

/** One entry of a role plan (annex C §C.6), as the gate sees it. */
export type PlanEntry = {
  readonly provider: string;
  readonly authTier: AuthTier;
  readonly audience: Audience;
  /** The acknowledgements in force, from `distribution.termsOverride` only. */
  readonly acknowledgements?: readonly string[];
};

function queryOf(entry: PlanEntry): TermsQuery {
  return {
    provider: entry.provider,
    authTier: entry.authTier,
    audience: entry.audience,
    acknowledgements: entry.acknowledgements ?? [],
  };
}

/** The result of the gate at launch (F147-FR-005). */
export type LaunchDecision = {
  /** True where the primary entry is refused: the launch is refused. */
  readonly refused: boolean;
  readonly primary: TermsGateDecision;
  /** The fallback entries the gate does not allow (F147-FR-005). */
  readonly skipped: readonly {
    readonly index: number;
    readonly reason: "terms-refused";
    readonly decision: TermsDecision;
  }[];
  /** The fallback entries the gate allows, in order. */
  readonly allowed: readonly { readonly index: number; readonly decision: TermsDecision }[];
};

/**
 * The gate at launch: the primary entry is checked, then every entry of the
 * fallback list (F147-FR-005). A refused primary refuses the launch; a
 * refused fallback entry is skipped with the reason `terms-refused` — never
 * silently: the caller (feature 127) emits `fallback.skipped` per skipped
 * entry, which this function reports.
 */
export function gateLaunch(
  evaluate: (query: TermsQuery) => TermsGateDecision,
  primary: PlanEntry,
  fallbacks: readonly PlanEntry[],
  sink: GateSink = NULL_SINK,
): LaunchDecision {
  const primaryDecision = gate(evaluate, queryOf(primary), "launch", sink);
  const skipped: { index: number; reason: "terms-refused"; decision: TermsGateDecision }[] = [];
  const allowed: { index: number; decision: TermsGateDecision }[] = [];
  fallbacks.forEach((entry, index) => {
    const decision = gate(evaluate, queryOf(entry), "fallback-switch", sink);
    if (decision.decision === "refused") {
      // Never silently: the skipped entry is reported to the caller, which
      // is the owner of the fallback switch (feature 127) and emits
      // `fallback.skipped` (reason `terms-refused`) itself.
      skipped.push(Object.freeze({ index, reason: "terms-refused" as const, decision }));
    } else {
      allowed.push(Object.freeze({ index, decision }));
    }
  });
  return Object.freeze({
    refused: primaryDecision.decision === "refused",
    primary: primaryDecision,
    skipped: Object.freeze(skipped),
    allowed: Object.freeze(allowed),
  });
}

/**
 * The gate at role resolution: each entry of the role plan is checked again
 * at the moment it is used (F147-FR-005); a `refused` decision refuses the
 * entry.
 */
export function gateEntry(
  evaluate: (query: TermsQuery) => TermsGateDecision,
  entry: PlanEntry,
  sink: GateSink = NULL_SINK,
): TermsGateDecision {
  return gate(evaluate, queryOf(entry), "role-resolution", sink);
}
