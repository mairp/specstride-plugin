/**
 * T118 — the interface types of EP-11, the terms-gate data, from
 * `contracts/extension-points/EP-11.terms.json` and annex C, §C.12
 * (F100-FR-108).
 *
 * `specstride.terms/1`. Data. A pure table with one function, evaluated by
 * the table evaluator of annex X §X.3.
 */
export const POINT_ID = "specstride.terms/1" as const;
export const EP = "EP-11" as const;
export const ANNEX_SECTION = "annex C, §C.12" as const;

/** F100-FR-108 — the one operation of the point. */
export const OPERATIONS = ["evaluate"] as const;
export type TermsOperation = (typeof OPERATIONS)[number];

/** The class of this point: data (annex A, §A.4, F100-FR-014). */
export const IS_DATA = true as const;

/** The auth tiers a row is about. */
export const AUTH_TIERS = [1, 2, 3] as const;
export type AuthTier = (typeof AUTH_TIERS)[number];

/** The two audiences of §C.12. */
export const AUDIENCES = ["personal", "distributed"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The statuses a row may carry (§C.12, Guarantees of an implementation). */
export const STATUSES = ["allowed", "conditional", "personal-only", "refused"] as const;
export type TermsStatus = (typeof STATUSES)[number];

/** Unknown-value rule of §C.12: an unknown status is read as `refused`. */
export const STATUS_WHEN_UNKNOWN: TermsStatus = "refused";

/** One row of the terms table (§C.12, Guarantees of an implementation). */
export type TermsRow = {
  readonly provider: string;
  readonly authTier: AuthTier;
  readonly audience: Audience;
  readonly status: TermsStatus;
  readonly source: string;
  /** The date on which the source was accessed. */
  readonly accessDate: string;
  readonly quotedSentence: string;
  readonly verifiedOn: string | null;
};

/** The input of `evaluate` (§C.12, Inputs). */
export type TermsQuery = {
  readonly provider: string;
  readonly authTier: AuthTier;
  readonly audience: Audience;
  readonly acknowledgements: readonly string[];
};

/** The decision and the row it rests on (§C.12, Outputs). */
export type TermsDecision = {
  readonly decision: "allowed" | "refused" | "allowed-with-warning";
  readonly row: TermsRow | null;
  readonly explanation: string;
  readonly warning?: string;
};

/** F100-FR-108 — the terms gate: one pure function over the table. */
export type TermsGate = {
  evaluate(query: TermsQuery): TermsDecision;
};

/** F100-FR-108 — auth tier 3 ships refused for every provider. */
export const AUTH_TIER_3_SHIPS = "refused" as const;

/** F100-FR-108 — auth tier 3 without an `allowed` row is refused with the explanation. */
export const AUTH_TIER_3_WITHOUT_AN_ALLOWED_ROW = "refused" as const;

/**
 * Unknown-value rule of §C.12: with no row, auth tiers 1 and 2 are allowed
 * with a warning, never as a default and never for an automatic pick.
 */
export function noRowOutcome(authTier: AuthTier): TermsDecision {
  if (authTier === 3) {
    return {
      decision: "refused",
      row: null,
      explanation:
        "auth tier 3 without an `allowed` row is refused; the terms data holds no row for it (F100-FR-108)",
    };
  }
  return {
    decision: "allowed-with-warning",
    row: null,
    explanation: "no row: the terms of this provider are unknown (annex C, §C.12)",
    warning:
      "unknown terms: allowed with a warning, never as a default and never for an automatic pick",
  };
}

/** Data older than this many days is a doctor warning (§C.12). */
export const STALE_AFTER_DAYS = 30 as const;

/** "Failure of an implementation" of §C.12, as data. */
export const FAILURE_PATH =
  "a data file that does not validate is ignored with a doctor finding, and the shipped file applies" as const;
export const FAILURE_PATHS: Readonly<Record<TermsOperation, string>> = Object.freeze({
  evaluate: FAILURE_PATH,
});

/** "Guarantees of the core" of §C.12: nothing bypasses the terms gate. */
export const NOTHING_BYPASSES_IT = ["comment", "flag", "mode", "project key"] as const;
/** A front harness is gated by the row of its back end. */
export const A_FRONT_HARNESS_IS_GATED_BY_ITS_BACK_END = true as const;
