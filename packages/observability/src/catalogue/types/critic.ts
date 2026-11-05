/**
 * T025 — the `data` schemas of the types of F111-FR-011: the critic-class
 * call.
 *
 * *A critic-class call MUST be told by `critic.selected` (harness, model, why,
 * the result of the diversity test in the field `diversity`, a member of annex
 * X §X.6 row 183, and the critic-diversity warning in the field
 * `sameModelWarning`, which is true for the results `same-model` and
 * `unverified` and for no other) once at launch, `critic.started`, and
 * `critic.call` when it returns. `critic.call` MUST carry the form of the
 * `completion` level in force (`tool-less` or `read-only-tools`), the outcome,
 * the latency and the usage; where the critic-diversity rule was applied
 * before the call and the warning was raised, `critic.call` MUST also carry
 * the result of the test in `diversity` and the warning in
 * `sameModelWarning`, whether or not the line is silenced.
 * `verdict.recorded` MUST carry the verdict, whether the nonce matched, and
 * the MALFORMED streak. `verdict.adjudicated` MAY be appended later and MUST
 * refer to the verdict by `verdictId`. The nonce MUST be in no event before
 * its call has returned; afterwards only its hash MUST be recorded.*
 *
 * THE WARNING IS DERIVED, NOT CHOSEN. `sameModelWarningFor` is the one place
 * that decides it, and the rule on both types calls it, so the field cannot
 * disagree with `diversity` in one event type and agree in another. The name
 * is `sameModelWarning`, which features 124 and 149 keep (research D-15, the
 * second-pass item C9); the first pass's `diversityWarning` is gone.
 *
 * THE NONCE IS NEVER A FIELD. There is no `nonce` in any row of the
 * catalogue — `verdict.recorded` says only whether it MATCHED. Where a hash
 * must be recorded, `nonceHash` is what records it, and the hash of a value is
 * not the value.
 */
import { createHash } from "node:crypto";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  refine,
  COUNT,
  CONTENT_REFERENCE_FIELD,
  FLAG,
  TEXT,
  type TypeRefinement,
} from "./refinement.ts";

/** The forms of the `completion` level: annex X §X.6 row 28. */
export const COMPLETION_FORMS: readonly string[] = Object.freeze([
  ...(closedSet(28)?.members ?? []),
]);

/** The results of the diversity test: annex X §X.6 row 183. */
export const DIVERSITY_RESULTS: readonly string[] = Object.freeze([
  ...(closedSet(183)?.members ?? []),
]);

/** The name of the warning field (research D-15; features 124 and 149 keep it). */
export const SAME_MODEL_WARNING_FIELD = "sameModelWarning" as const;

/** The two results for which the warning is true, AND FOR NO OTHER. */
export const WARNS_FOR = ["same-model", "unverified"] as const;

/** F111-FR-011: the nonce is in no event before its call has returned. */
export const NONCE_IS_IN_AN_EVENT_BEFORE_THE_CALL_RETURNS = false as const;

/** The one rule that decides the warning from the result (F111-FR-011). */
export function sameModelWarningFor(diversity: unknown): boolean {
  return typeof diversity === "string" && (WARNS_FOR as readonly string[]).includes(diversity);
}

/** The hash of a nonce: what may be recorded after the call has returned. */
export function nonceHash(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/**
 * The findings of a critic event against F111-FR-011: the warning that does
 * not follow the result of the diversity test.
 */
export function criticFindings(
  type: string,
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  if (!Object.hasOwn(data, "diversity") || !Object.hasOwn(data, SAME_MODEL_WARNING_FIELD)) {
    return Object.freeze([]);
  }
  const expected = sameModelWarningFor(data.diversity);
  if (data[SAME_MODEL_WARNING_FIELD] === expected) return Object.freeze([]);
  return Object.freeze([
    `${type}: \`${SAME_MODEL_WARNING_FIELD}\` is true for ${WARNS_FOR.join(" and ")} and for ` +
      `no other; the result is ${JSON.stringify(data.diversity)} and the warning reads ` +
      `${JSON.stringify(data[SAME_MODEL_WARNING_FIELD])}`,
  ]);
}

const warningRule = (type: string) => ({
  name: "the-warning-follows-the-result",
  check: (data: Readonly<Record<string, unknown>>) => criticFindings(type, data)[0] ?? null,
});

/** The refinements of F111-FR-011. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-011",
    type: "critic.selected",
    required: ["harness", "model", "why", "diversity", SAME_MODEL_WARNING_FIELD],
    fields: {
      harness: TEXT,
      model: TEXT,
      diversity: { enum: DIVERSITY_RESULTS },
      [SAME_MODEL_WARNING_FIELD]: FLAG,
    },
    rules: [warningRule("critic.selected")],
    note: "written once at launch",
  }),
  refine({
    requirement: "F111-FR-011",
    type: "critic.call",
    required: ["form", "outcome", "latencyMs", "usage"],
    fields: {
      promptRef: CONTENT_REFERENCE_FIELD,
      form: { enum: COMPLETION_FORMS },
      outcome: TEXT,
      latencyMs: COUNT,
      usage: { type: ["object", "null"] },
      diversity: { type: ["string", "null"], enum: DIVERSITY_RESULTS },
      [SAME_MODEL_WARNING_FIELD]: { type: ["boolean", "null"] },
    },
    rules: [warningRule("critic.call")],
    note: "the result and the warning ride here too, whether or not the line is silenced",
  }),
  refine({
    requirement: "F111-FR-011",
    type: "verdict.recorded",
    required: ["verdictId", "result", "nonceOk", "malformedStreak"],
    fields: {
      verdictId: TEXT,
      result: TEXT,
      nonceOk: FLAG,
      malformedStreak: COUNT,
    },
    note: "whether the nonce MATCHED; the nonce itself is in no event",
  }),
  refine({
    requirement: "F111-FR-011",
    type: "verdict.adjudicated",
    required: ["verdictId", "falseNegative"],
    fields: { verdictId: TEXT, falseNegative: FLAG },
    note: "may be appended later; it refers to the verdict by `verdictId`",
  }),
]);
