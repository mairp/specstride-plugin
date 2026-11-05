/**
 * Feature 147 — the terms gate as a table (F147-FR-004; EP-11
 * `specstride.terms/1`, annex C §C.12; plan.md Constraints).
 *
 * `evaluate(provider, authTier, audience, acknowledgements)` is a PURE table
 * evaluated by the table evaluator of annex X §X.3 (`evaluateTable` of
 * `@specstride/kernel`): no I/O, no clock, no network call, no model. The
 * table is built from the rows of the data file (F147-FR-003) and carries a
 * default row for the decision point, so exactly one row fires for every
 * vector of signals. Every decision is recorded with its rule id and the
 * version of the table (F100-FR-204).
 *
 * Semantics of the four statuses (spec.md, Clarifications):
 *  - `allowed`       -> decision `allowed`;
 *  - `conditional`   -> `allowed` only through an acknowledgement
 *                       (`provider:tier` in the acknowledgements), else
 *                       `refused`; the conditions travel in the explanation;
 *  - `personal-only` -> off by default; an acknowledgement is the opt-in of
 *                       `distribution.termsOverride` (F147-FR-009): the
 *                       decision is `allowed-with-warning`, the warning marks
 *                       the path "personal use only", and `overrideUsed` is
 *                       true so the gate records the event
 *                       `terms.override_used`;
 *  - `refused` (and any status outside the closed set, F147-FR-003)
 *                    -> `refused`.
 *
 * No row (unknown terms, F147-FR-008): auth tiers 1 and 2 are
 * `allowed-with-warning` — never a default and never an automatic pick — and
 * auth tier 3 is refused (`noRowOutcome` of the contract, F100-FR-108).
 */
import { evaluateTable, loadTable, TABLE_SCHEMA_ID } from "@specstride/kernel";
import type { LoadedTable, Predicate, TableRow } from "@specstride/kernel";
import {
  AUDIENCES,
  AUTH_TIERS,
  POINT_ID,
  STATUSES,
  STATUS_WHEN_UNKNOWN,
  noRowOutcome,
} from "@specstride/contracts/ep/terms";
import type {
  AuthTier,
  Audience,
  TermsDecision,
  TermsQuery,
  TermsRow,
  TermsStatus,
} from "@specstride/contracts/ep/terms";
import { loadTermsData, shippedTermsData } from "./loader.ts";
import type { TermsData } from "./loader.ts";

/** The id of the terms table, recorded with every decision (F147-FR-004). */
export const TERMS_TABLE_ID = "terms-gate-default" as const;

/** The version of the terms table, recorded with every decision (F147-FR-004). */
export const TERMS_TABLE_VERSION = "1" as const;

/** The one decision point of the terms table. */
export const TERMS_POINT = "terms" as const;

/**
 * The transport `sdk-in-process` is auth tier 2 with API keys only
 * (F147-FR-012); a subscription login is reachable only through the
 * `claude` subprocess.
 */
export const SDK_TRANSPORT_TIER: AuthTier = 2;
export const SDK_TRANSPORT = "sdk-in-process" as const;
export const SUBPROCESS_TRANSPORT = "subprocess" as const;

/**
 * The audiences, auth tiers and statuses of the closed sets of annex X
 * §X.6 rows 40 to 42, re-exported for the tests of this feature.
 */
export { AUDIENCES, AUTH_TIERS, STATUSES, STATUS_WHEN_UNKNOWN, POINT_ID };

/** The decision of `evaluate`, with the rule id and the table version (F147-FR-004). */
export type TermsGateDecision = TermsDecision & {
  /** The rule id of the row of the table that fired (F100-FR-204). */
  readonly ruleId: string;
  /** The id of the table, `terms-gate-default`. */
  readonly tableId: string;
  /** The version of the table, `1`. */
  readonly tableVersion: string;
  /**
   * True where the decision relied on an entry of
   * `distribution.termsOverride` (plan.md Constraints); the gate call turns
   * this into the event `terms.override_used` (F111-FR-051).
   */
  readonly overrideUsed: boolean;
};

function predicate(p: string, t: number, a: string, ack: boolean | null): Predicate {
  const of: Predicate[] = [
    { op: "equal", signal: "provider", value: p },
    { op: "equal", signal: "authTier", value: t },
    { op: "equal", signal: "audience", value: a },
  ];
  if (ack !== null) of.push({ op: "equal", signal: "acknowledged", value: ack });
  return of.length === 1 ? of[0] : { op: "and", of };
}

/**
 * The table rows of one terms row (F147-FR-003): the status decides the
 * choices, the acknowledgement decides between them.
 */
function tableRowsOf(row: TermsRow): TableRow[] {
  const id = `terms:${row.provider}:${row.authTier}:${row.audience}`;
  const status: TermsStatus = (STATUSES as readonly string[]).includes(row.status)
    ? row.status
    : STATUS_WHEN_UNKNOWN;
  if (status === "allowed") {
    return [
      {
        ruleId: `${id}:allowed`,
        when: predicate(row.provider, row.authTier, row.audience, null),
        choice: "allowed",
      },
    ];
  }
  if (status === "conditional") {
    return [
      {
        ruleId: `${id}:conditional-ack`,
        when: predicate(row.provider, row.authTier, row.audience, true),
        choice: "allowed",
      },
      {
        ruleId: `${id}:conditional`,
        when: predicate(row.provider, row.authTier, row.audience, false),
        choice: "refused",
      },
    ];
  }
  if (status === "personal-only") {
    return [
      {
        ruleId: `${id}:opt-in`,
        when: predicate(row.provider, row.authTier, row.audience, true),
        choice: "allowed-with-warning",
      },
      {
        ruleId: `${id}:personal-only`,
        when: predicate(row.provider, row.authTier, row.audience, false),
        choice: "refused",
      },
    ];
  }
  return [
    {
      ruleId: `${id}:refused`,
      when: predicate(row.provider, row.authTier, row.audience, null),
      choice: "refused",
    },
  ];
}

/**
 * Build the rule table of annex X §X.3 from the rows of a terms data file.
 * The first row refuses auth tier 3 whenever no `allowed` row exists
 * (F147-FR-001); the default row is the unknown-terms outcome (F147-FR-008).
 */
export function buildTermsTable(data: TermsData = shippedData()): LoadedTable {
  const rows: TableRow[] = [
    // F147-FR-001: a request for auth tier 3 is refused; the list of tier 3
    // rows that are `allowed` is empty at release (F147-SC-003), so this row
    // refuses tier 3 for every provider. A tier 3 `allowed` row in a
    // replacement file must not open the path either, which the tests of
    // CT-147-101 prove for the shipped file and the loader refuses above.
    {
      ruleId: "terms:tier3-no-allowed-row",
      when: { op: "equal", signal: "authTier", value: 3 },
      choice: "refused",
    },
  ];
  for (const row of data.rows) rows.push(...tableRowsOf(row));
  // The default row: no row matched — the terms are unknown (F147-FR-008).
  rows.push({ ruleId: "terms:no-row", choice: "allowed-with-warning" });
  return loadTable({
    schema: TABLE_SCHEMA_ID,
    id: TERMS_TABLE_ID,
    version: TERMS_TABLE_VERSION,
    points: {
      [TERMS_POINT]: {
        signals: {
          provider:
            "text: the provider in use (a front harness reads the row of its provider, F147-FR-007)",
          authTier: "whole number, 1, 2 or 3 (annex X §X.6 row 40)",
          audience: "text: personal or distributed (annex X §X.6 row 41)",
          acknowledged: "truth value: an entry `provider:tier` of distribution.termsOverride",
        },
        choices: ["allowed", "refused", "allowed-with-warning"],
      },
    },
    rows: { [TERMS_POINT]: rows },
  });
}

/** True where the acknowledgements hold the entry `provider:tier`. */
function acknowledgedOf(query: TermsQuery): boolean {
  return query.acknowledgements.includes(`${query.provider}:${query.authTier}`);
}

/** The terms row a query lands on, or null for unknown terms. */
export function rowFor(query: TermsQuery, data: TermsData): TermsRow | null {
  return (
    data.rows.find(
      (r) =>
        r.provider === query.provider &&
        r.authTier === query.authTier &&
        r.audience === query.audience,
    ) ?? null
  );
}

/**
 * F147-FR-004 — the terms gate: one pure function over the table. Pure: it
 * reads only its arguments; it opens no file, reads no clock and calls no
 * network (plan.md Constraints). The data comes from the caller (the loader
 * or the composition root), never from this function.
 */
export function makeEvaluate(data: TermsData): (query: TermsQuery) => TermsGateDecision {
  const table = buildTermsTable(data);
  return (query: TermsQuery): TermsGateDecision => {
    const row = rowFor(query, data);
    const fired = evaluateTable(table, TERMS_POINT, {
      provider: query.provider,
      authTier: query.authTier,
      audience: query.audience,
      acknowledged: row === null ? false : acknowledgedOf(query),
    });
    const choice = fired.choice as TermsDecision["decision"];
    if (row === null) {
      // Unknown terms (F147-FR-008; `noRowOutcome` of the contract).
      const fallback = noRowOutcome(query.authTier);
      return Object.freeze({
        ...fallback,
        ruleId: fired.ruleId,
        tableId: fired.tableId,
        tableVersion: fired.tableVersion,
        overrideUsed: false,
      });
    }
    const isOptIn = fired.ruleId.endsWith(":opt-in");
    const isConditionalAck = fired.ruleId.endsWith(":conditional-ack");
    const explanation =
      row.status === "conditional"
        ? `${row.quotedSentence} (conditional: the conditions of the row apply)`
        : row.quotedSentence;
    return Object.freeze({
      decision: choice,
      row,
      explanation: isOptIn
        ? `${explanation} — acknowledged for personal use only under distribution.termsOverride`
        : explanation,
      ...(isOptIn
        ? {
            warning:
              "personal use only: this path is off by default for the distributed audience and runs because of an acknowledgement in distribution.termsOverride",
          }
        : {}),
      ruleId: fired.ruleId,
      tableId: fired.tableId,
      tableVersion: fired.tableVersion,
      overrideUsed: isOptIn || isConditionalAck,
    });
  };
}

/**
 * F147-FR-010 — the auth tier of a role that no key names. For `personal`,
 * tier 1 where the tier 1 row allows it (`allowed` or `conditional`), else
 * tier 2; for `distributed`, tier 2 (F147-FR-009). A provider with no row
 * gives NO default (F147-FR-008): the function returns null and the caller
 * may not pick the harness automatically.
 */
export function defaultTier(
  provider: string,
  audience: Audience,
  data: TermsData = shippedData(),
): 1 | 2 | null {
  // A provider with no row at all is UNKNOWN TERMS (F147-FR-008): no
  // default, so the caller may not pick the harness automatically.
  const known = data.rows.some((r) => r.provider === provider);
  if (!known) return null;
  if (audience === "distributed") return 2;
  const row = data.rows.find(
    (r) => r.provider === provider && r.authTier === 1 && r.audience === "personal",
  );
  if (row === undefined) return 2;
  return row.status === "allowed" || row.status === "conditional" ? 1 : 2;
}

/**
 * F147-FR-009 — a harness with no Tier 2 credential in the distributed
 * audience is refused with the reason and what to configure.
 */
export function refusalWithoutTier2Credential(
  provider: string,
  audience: Audience,
  hasTier2Credential: boolean,
  data: TermsData = shippedData(),
): { refused: boolean; reason: string; configure: string } {
  if (hasTier2Credential || audience !== "distributed") {
    return { refused: false, reason: "", configure: "" };
  }
  const tier1 = data.rows.find(
    (r) => r.provider === provider && r.authTier === 1 && r.audience === "distributed",
  );
  if (tier1 === undefined || tier1.status !== "personal-only") {
    return { refused: false, reason: "", configure: "" };
  }
  return Object.freeze({
    refused: true,
    reason: `the provider ${provider} allows its subscription login for personal use only (row ${tier1.status}); the distributed audience needs a Tier 2 credential`,
    configure: `set roles.<role>.credential to a Tier 2 API key for ${provider}, or set distribution.audience to personal in the user file`,
  });
}

/** The shipped data, loaded and validated once (F147-FR-011). */
let SHIPPED: TermsData | undefined;
export function shippedData(): TermsData {
  if (SHIPPED === undefined) SHIPPED = loadTermsData(shippedTermsData());
  return SHIPPED;
}

/** The `evaluate` over the shipped data, built once (EP-11, the one operation). */
let EVALUATE_SHIPPED: ((query: TermsQuery) => TermsGateDecision) | undefined;
export const evaluate: (query: TermsQuery) => TermsGateDecision = (query) => {
  if (EVALUATE_SHIPPED === undefined) EVALUATE_SHIPPED = makeEvaluate(shippedData());
  return EVALUATE_SHIPPED(query);
};

/** Guard for the callers that build a query from untrusted input. */
export function asAudience(value: string): Audience {
  if (!(AUDIENCES as readonly string[]).includes(value)) {
    throw new TypeError(
      `unknown audience "${value}"; the audiences are ${AUDIENCES.join(" and ")}`,
    );
  }
  return value as Audience;
}

export function asAuthTier(value: number): AuthTier {
  if (!(AUTH_TIERS as readonly number[]).includes(value)) {
    throw new TypeError(
      `unknown auth tier ${value}; tier 3 is never a valid value of a key (F147-FR-001)`,
    );
  }
  return value as AuthTier;
}
