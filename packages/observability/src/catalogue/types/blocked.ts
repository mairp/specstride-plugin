/**
 * T025 — the `data` schemas of the types of F111-FR-009: a run that needs a
 * human.
 *
 * *A run that needs a human MUST be told by `blocked`, with a reason of the
 * six of annex E §E.2, what is needed, and, for `source-changed`, which of
 * `spec`, `plan` or `tasks` changed and its logical name. `unblocked` MUST
 * carry who answered, in the field `by`, and `latencyMs`, the time from
 * `blocked` to the answer. `by` is no closed set: it is kept as text and is a
 * marked free-text field; an answer through `resume` writes `operator`.
 * `answerRef` MUST be null where no record of an answer exists. A `blocked`
 * written for a refused `resume` MUST be marked `synthesized`, and the
 * `run.launched` with the reason `resume` that follows MUST link to it through
 * `cause`.*
 *
 * `by` IS TEXT ON PURPOSE. Who answered is a person, and a person is not a
 * member of a closed set. The field is marked free text in the catalogue
 * instead, so it passes the redaction ingress and is capped — which is the
 * right treatment for a name someone typed, and the wrong one for an
 * identifier. The schema therefore gives it NO `enum`, and the test reads that
 * absence as the requirement.
 */
import { BLOCKED_REASONS, SOURCES_COMPARED } from "@specstride/contracts/state/blocked-reasons";
import { refine, COUNT, FLAG, TEXT_OR_NULL, type TypeRefinement } from "./refinement.ts";

/** The six reasons of annex E §E.2. */
export const BLOCKED_REASON_SET: readonly string[] = Object.freeze([...BLOCKED_REASONS]);

/** The reason for which the block names which source changed. */
export const BLOCKED_REASON_SOURCE_CHANGED = "source-changed" as const;

/** The three sources that are compared: `spec`, `plan`, `tasks`. */
export const CHANGED_SOURCES: readonly string[] = Object.freeze([...SOURCES_COMPARED]);

/** What an answer through `resume` writes in `by` (F111-FR-009). */
export const RESUME_ANSWERS_AS = "operator" as const;

/**
 * The findings of one `blocked` against F111-FR-009: a `source-changed` block
 * that does not say which source changed, or does not name it.
 */
export function blockedFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const findings: string[] = [];
  if (data.reason !== BLOCKED_REASON_SOURCE_CHANGED) return Object.freeze(findings);
  if (typeof data.changedSource !== "string") {
    findings.push(
      `a \`${BLOCKED_REASON_SOURCE_CHANGED}\` block says which of ` +
        `${CHANGED_SOURCES.join(", ")} changed, in \`changedSource\``,
    );
  }
  if (typeof data.changedRef !== "string") {
    findings.push(
      `a \`${BLOCKED_REASON_SOURCE_CHANGED}\` block names the source by its logical name, ` +
        `in \`changedRef\``,
    );
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-009. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-009",
    type: "blocked",
    required: ["reason", "needs"],
    fields: {
      reason: { enum: BLOCKED_REASON_SET },
      changedSource: { type: ["string", "null"], enum: CHANGED_SOURCES },
      changedRef: TEXT_OR_NULL,
      synthesized: FLAG,
    },
    rules: [
      {
        name: "source-changed-names-its-source",
        check: (data) => blockedFindings(data)[0] ?? null,
      },
    ],
  }),
  refine({
    requirement: "F111-FR-009",
    type: "unblocked",
    required: ["by", "latencyMs"],
    fields: {
      // No `enum`: `by` is text, and a marked free-text field of the catalogue.
      latencyMs: COUNT,
      answerRef: TEXT_OR_NULL,
    },
    note: `an answer through resume writes \`${RESUME_ANSWERS_AS}\`; answerRef is null where no record exists`,
  }),
]);
