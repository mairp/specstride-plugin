/**
 * T025 — the `data` schemas of the types of F111-FR-012: the decisions of the
 * owner's rulings.
 *
 * *`route.decided` MUST be written for every decision of the router,
 * including one that changes nothing, with the table id, the table version,
 * the decision point, the rule id, the signals read and the choice. A
 * model-tier bump MUST be recorded as `attempt.tier_bumped` and its skip as
 * `attempt.tier_bump_skipped` with the reason; an escalation that was skipped
 * MUST be recorded as `escalation.skipped` with the reason, a member of annex
 * X §X.6 row 140, whatever the reason of the skip is; when the quota of the
 * target had none left, the reason is `quota`. No routing decision MUST reach
 * a critic-class call through an event.*
 *
 * "INCLUDING ONE THAT CHANGES NOTHING" is why every field of `route.decided`
 * is required. A decision that changed nothing still read signals and still
 * matched a rule; if the writer could leave those out, the record of a
 * no-change decision would be indistinguishable from no decision at all, and
 * the audit of the router would have a hole exactly where it is least
 * expected.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE_BY_TYPE } from "../index.ts";
import { refine, COUNT_OR_NULL, TEXT, type TypeRefinement } from "./refinement.ts";

/** The fields that make up a routing decision (F111-FR-012). */
export const ROUTING_FIELDS = [
  "tableId",
  "tableVersion",
  "point",
  "ruleId",
  "signals",
  "choice",
] as const;

/** The skip reasons of an escalation: annex X §X.6 row 140. */
export const SKIP_REASONS: readonly string[] = Object.freeze([...(closedSet(140)?.members ?? [])]);

/** The reason when the quota of the target had none left (F111-FR-012). */
export const SKIP_REASON_FOR_NO_QUOTA = "quota" as const;

/** The types of a critic-class call. */
export const CRITIC_CLASS_TYPES = ["critic.selected", "critic.started", "critic.call"] as const;

/**
 * True where a type of a critic-class call carries a routing field in its
 * `data` — which F111-FR-012 forbids. It is read from the catalogue, so a
 * field that was added to a critic type would be caught here.
 */
export function routingReachesACriticCall(type: string): boolean {
  if (!(CRITIC_CLASS_TYPES as readonly string[]).includes(type)) return false;
  const fields = CATALOGUE_BY_TYPE.get(type)?.dataFields ?? [];
  return fields.some((field) => (ROUTING_FIELDS as readonly string[]).includes(field));
}

/** The refinements of F111-FR-012. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-012",
    type: "route.decided",
    required: [...ROUTING_FIELDS],
    fields: {
      tableId: TEXT,
      tableVersion: TEXT,
      point: TEXT,
      ruleId: TEXT,
      signals: { type: ["object", "array"] },
      choice: TEXT,
    },
    note: "written for every decision, including one that changes nothing",
  }),
  refine({
    requirement: "F111-FR-012",
    type: "attempt.tier_bumped",
    required: ["fromTier", "toTier"],
    fields: { fromTier: TEXT, toTier: TEXT, k: COUNT_OR_NULL, rejections: COUNT_OR_NULL },
  }),
  refine({
    requirement: "F111-FR-012",
    type: "attempt.tier_bump_skipped",
    required: ["reason"],
    fields: {},
  }),
  refine({
    requirement: "F111-FR-012",
    type: "escalation.skipped",
    required: ["reason"],
    fields: { reason: { enum: SKIP_REASONS } },
    note: `written for every skip; \`${SKIP_REASON_FOR_NO_QUOTA}\` where the target had no quota`,
  }),
]);
