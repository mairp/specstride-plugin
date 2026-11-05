/**
 * T003 of feature 101 — the three closed sets the specification of the phase
 * gate introduces, each with its unknown-value rule
 * (`specs/101-gate-and-verdict/spec.md`, "Closed sets"; annex X §X.6, rows
 * 251, 252 and 255; F100-FR-021, F100-FR-208).
 *
 * | Row | Set | Unknown value, as the cell of §X.6 writes it |
 * |---|---|---|
 * | 251 | Details of a MALFORMED verdict | Read as `call-failed`; the verdict stays MALFORMED |
 * | 252 | Cases of a diagnosis | `unknown` |
 * | 255 | What failed in an approval record | The record counts as not approved |
 *
 * The three rows live in `data/closed-sets.json` and register through T070 in
 * `src/enums/sets-100-104.ts`, the batch file of the owners 100 to 104; this
 * module reads them there, as `src/enums/critic-proof.ts` reads row 128 of its
 * batch. It registers nothing itself, so the assembly of T257 keeps holding
 * exactly the rows of the table.
 *
 * What this module adds to the batch file is the part a reader needs and the
 * table alone does not give: the member type of each set, a type guard, the
 * unknown-value rule as a function with the kind the cell asks for, and the
 * three facts of the spec that go with the sets — a detail stands only with
 * MALFORMED, a diagnosis that is not one of the two named cases is the case
 * `unknown`, and an approval record that fails any check counts as not
 * approved whatever the reason.
 */
import {
  casesOfADiagnosis,
  detailsOfAMalformedVerdict,
  whatFailedInAnApprovalRecord,
} from "./sets-100-104.ts";
import type { ClosedSet, UnknownValueOutcome, UnknownValueRule } from "./index.ts";

/** The section of annex X that owns the three rows. */
export const ANNEX_SECTION = "annex X, §X.6" as const;

/** The rows of §X.6 this module is about, in the order of the table. */
export const CLOSED_SET_ROWS = [251, 252, 255] as const;
export type ClosedSetRowNumber = (typeof CLOSED_SET_ROWS)[number];

/* ------------------------------------------------------------------ *
 * Row 251 — Details of a MALFORMED verdict.
 * ------------------------------------------------------------------ */

/** Row 251, as the closed set of §X.6 holds it, with its unknown-value rule. */
export const malformedDetails: ClosedSet<
  "nonce-mismatch" | "no-verdict-line" | "multiple-verdict-lines" | "call-failed"
> = detailsOfAMalformedVerdict;

/** The four details of row 251, in the order of the table. */
export const MALFORMED_DETAILS = malformedDetails.members;

/** A detail of a MALFORMED verdict (row 251). */
export type MalformedDetail = (typeof MALFORMED_DETAILS)[number];

/** True when the value is a detail of row 251. */
export function isMalformedDetail(value: string): value is MalformedDetail {
  return malformedDetails.has(value);
}

/**
 * The unknown-value rule of row 251: a detail outside the set is READ AS
 * `call-failed`, and the verdict stays MALFORMED. The kind is `default`, so a
 * reader branches on `treatedAs` and never refuses the record.
 */
export const DETAIL_WHEN_UNKNOWN = "call-failed" as const;

/** Row 251's rule as a function (`kind: "default"`, `treatedAs: call-failed`). */
export const detailOnUnknown: UnknownValueRule = (value) => malformedDetails.onUnknown(value);

/** The detail a reader uses for a value: the member itself, or `call-failed`. */
export function detailOrDefault(value: string): MalformedDetail {
  return isMalformedDetail(value) ? value : DETAIL_WHEN_UNKNOWN;
}

/** A MALFORMED verdict carries a detail; no other verdict does. */
export const DETAIL_STANDS_ONLY_WITH_MALFORMED = true as const;

/* ------------------------------------------------------------------ *
 * Row 252 — Cases of a diagnosis.
 * ------------------------------------------------------------------ */

/** Row 252, as the closed set of §X.6 holds it, with its unknown-value rule. */
export const diagnosisCases: ClosedSet<"grounding" | "real_gap" | "unknown"> = casesOfADiagnosis;

/** The three cases of row 252, in the order of the table. */
export const DIAGNOSIS_CASES = diagnosisCases.members;

/** A case of a diagnosis (row 252). */
export type DiagnosisCase = (typeof DIAGNOSIS_CASES)[number];

/** True when the value is a case of row 252. */
export function isDiagnosisCase(value: string): value is DiagnosisCase {
  return diagnosisCases.has(value);
}

/**
 * The unknown-value rule of row 252: a case outside the set is the case
 * `unknown`, which is itself a member of the set. The kind the cell gives is
 * `show-as-unknown`, with an attention item; no record is refused.
 */
export const CASE_WHEN_UNKNOWN = "unknown" as const;

/** Row 252's rule as a function (`kind: "show-as-unknown"`). */
export const diagnosisCaseOnUnknown: UnknownValueRule = (value) => diagnosisCases.onUnknown(value);

/** The case a reader uses for a value: the member itself, or `unknown`. */
export function diagnosisCaseOrDefault(value: string): DiagnosisCase {
  return isDiagnosisCase(value) ? value : CASE_WHEN_UNKNOWN;
}

/** The two cases that say something; the third is the fallback of the row. */
export const DIAGNOSIS_CASES_THAT_SAY_SOMETHING = ["grounding", "real_gap"] as const;

/* ------------------------------------------------------------------ *
 * Row 255 — What failed in an approval record.
 * ------------------------------------------------------------------ */

/** Row 255, as the closed set of §X.6 holds it, with its unknown-value rule. */
export const approvalFailures: ClosedSet<
  | "schema"
  | "signature"
  | "key-unknown"
  | "verdict"
  | "evidence-hash"
  | "verification-hash"
  | "missing"
  | "marker-only"
> = whatFailedInAnApprovalRecord;

/** The eight members of row 255, in the order of the table. */
export const APPROVAL_FAILURES = approvalFailures.members;

/** What failed in an approval record (row 255). */
export type ApprovalFailure = (typeof APPROVAL_FAILURES)[number];

/** True when the value is a member of row 255. */
export function isApprovalFailure(value: string): value is ApprovalFailure {
  return approvalFailures.has(value);
}

/**
 * The unknown-value rule of row 255: the record counts as NOT APPROVED. The
 * kind is `refuse`, so a reader never reads an unknown reason as a pass; the
 * safe failure is the same as for every member of the set.
 */
export const RECORD_COUNTS_AS_APPROVED_ON_AN_UNKNOWN_FAILURE = false as const;

/** Row 255's rule as a function (`kind: "refuse"`). */
export const approvalFailureOnUnknown: UnknownValueRule = (value) =>
  approvalFailures.onUnknown(value);

/**
 * Whether an approval record counts as approved, given what the verification
 * found. Nothing found means approved; a member of row 255 and a value outside
 * it alike mean not approved.
 */
export function approvalCountsAsApproved(failure: string | undefined): boolean {
  return failure === undefined;
}

/* ------------------------------------------------------------------ *
 * The three sets together.
 * ------------------------------------------------------------------ */

/** The three sets of this feature, keyed by the number of their row of §X.6. */
export const GATE_CLOSED_SETS: ReadonlyMap<ClosedSetRowNumber, ClosedSet> = Object.freeze(
  new Map<ClosedSetRowNumber, ClosedSet>([
    [251, malformedDetails],
    [252, diagnosisCases],
    [255, approvalFailures],
  ]),
);

/** The unknown-value outcome of one of the three sets, for any value. */
export function onUnknown(row: ClosedSetRowNumber, value: string): UnknownValueOutcome {
  const set = GATE_CLOSED_SETS.get(row);
  if (set === undefined) {
    throw new Error(`the row ${row} is none of the three closed sets of feature 101`);
  }
  return set.onUnknown(value);
}
