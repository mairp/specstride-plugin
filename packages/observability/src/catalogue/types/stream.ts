/**
 * T025 — the `data` schemas of the types of F111-FR-014: a stream told
 * truthfully.
 *
 * *A stream MUST be told truthfully. `stream.missing_terminal` MUST be written
 * when a stream ends with no terminal record; a pass that exits successfully
 * and did nothing MUST end with the `endCause` `no_progress`; an unknown value
 * MUST be null. A violation of the framing of a stream (a record too long, too
 * fast, or tool output in the form of a stream record) MUST give
 * `stream.diagnostic` and MUST NOT give any other record.*
 *
 * "AND MUST NOT GIVE ANY OTHER RECORD" is the part that is easy to lose:
 * tool output that arrives shaped like a stream record is the oldest way for a
 * hostile stream to put words in the product's mouth. If the reader answered
 * it with a `stream.text` as well as a diagnostic, the forged line would be in
 * the stream as fact. `recordsForAFramingViolation` is that answer as one
 * list of exactly one name, so a caller cannot widen it by accident.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { refine, TEXT, type TypeRefinement } from "./refinement.ts";

/** The diagnostic codes of the reader: annex X §X.6 row 222. */
export const DIAGNOSTIC_CODES: readonly string[] = Object.freeze([
  ...(closedSet(222)?.members ?? []),
]);

/** The severities of a diagnostic: annex X §X.6 row 223. */
export const DIAGNOSTIC_SEVERITIES: readonly string[] = Object.freeze([
  ...(closedSet(223)?.members ?? []),
]);

/** The end cause of a pass that exited successfully and did nothing. */
export const NO_PROGRESS = "no_progress" as const;

/** The ONE record a framing violation gives (F111-FR-014). */
export const STREAM_DIAGNOSTIC = "stream.diagnostic" as const;

/** What a violation of the framing of a stream gives: this, and nothing else. */
export function recordsForAFramingViolation(): readonly string[] {
  return Object.freeze([STREAM_DIAGNOSTIC]);
}

/** What the rule of F111-FR-014 is asked about. */
export type StreamClaim = {
  readonly exitedSuccessfully?: boolean;
  readonly changedAnything?: boolean;
  readonly endCause?: string;
  /** Values the writer did not know: each must be present and null. */
  readonly unknownValues?: Readonly<Record<string, unknown>>;
};

/** The findings of a claim about a stream against F111-FR-014. */
export function streamFindings(claim: StreamClaim): readonly string[] {
  const findings: string[] = [];
  if (claim.exitedSuccessfully === true && claim.changedAnything === false) {
    if (claim.endCause !== NO_PROGRESS) {
      findings.push(
        `a pass that exits successfully and did nothing ends with the endCause ` +
          `\`${NO_PROGRESS}\`; it reads ${JSON.stringify(claim.endCause)}`,
      );
    }
  }
  for (const [field, value] of Object.entries(claim.unknownValues ?? {})) {
    if (value !== null) {
      findings.push(`an unknown value is null; \`${field}\` reads ${JSON.stringify(value)}`);
    }
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-014. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-014",
    type: "stream.missing_terminal",
    required: ["passId"],
    fields: { passId: TEXT },
    note: "written when a stream ends with no terminal record",
  }),
  refine({
    requirement: "F111-FR-014",
    type: STREAM_DIAGNOSTIC,
    required: ["code", "severity"],
    fields: {
      code: { enum: DIAGNOSTIC_CODES },
      severity: { enum: DIAGNOSTIC_SEVERITIES },
    },
    note: "a framing violation gives this record and no other",
  }),
  refine({
    requirement: "F111-FR-014",
    type: "stream.result",
    required: [],
    fields: {},
    note: "every value the harness did not report is null, never absent and never a guess",
  }),
]);
