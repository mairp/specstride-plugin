/**
 * T025 — the `data` schema of the types of F111-FR-006: usage.
 *
 * *Usage MUST be counted for every model call. `usage.reported` MUST be
 * written as each call completes, not only at the terminal record of a pass. A
 * record MUST carry a `usageId` (a replay is deduplicated by it), a `scope`, a
 * `cumulative` flag, the counts of input, output, cache-read, cache-write and
 * reasoning tokens (null when the harness did not report), `costUsd` or null,
 * `costSource`, `billing` (`api`, `subscription`, `unknown`), and the harness,
 * provider, model and role. An adapter MUST convert a cumulative report to an
 * increment. A reader MUST sum increments only. Cost under a subscription MUST
 * be labelled notional. A killed pass MUST end with `usageComplete` false and
 * the last partial usage, or with `usage.unavailable` naming the reason; a
 * harness that reports nothing MUST give `usage.unavailable` with the reason
 * `harness-does-not-report` for each pass.*
 *
 * The harness, the provider, the model and the role are ENVELOPE fields (annex
 * X §X.1), so they are not `data` fields here and are not repeated.
 *
 * A COUNT IS NULL, NOT ZERO, WHERE THE HARNESS DID NOT REPORT. Zero is a fact
 * ("no cache was read"); null is the absence of a fact ("nobody said"). A
 * reader that sums them must treat the two differently, which is why they are
 * different values and the schema admits both.
 */
import {
  refine,
  COUNT_OR_NULL,
  FLAG,
  NUMBER_OR_NULL,
  TEXT,
  type TypeRefinement,
} from "./refinement.ts";

export const USAGE_REPORTED = "usage.reported" as const;
export const USAGE_UNAVAILABLE = "usage.unavailable" as const;

/** The five counts of F111-FR-006, in the order the requirement names them. */
export const COUNT_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

/** The three billing kinds F111-FR-006 names. */
export const BILLINGS = ["api", "subscription", "unknown"] as const;

/** The billing under which a cost is an estimate and not a charge. */
export const SUBSCRIPTION = "subscription" as const;

/** The label a cost under a subscription carries (F111-FR-006). */
export const NOTIONAL = "notional" as const;

/** The reason a harness that reports nothing gives, for each pass. */
export const HARNESS_DOES_NOT_REPORT = "harness-does-not-report" as const;

/** One usage record, as far as this module reads it. */
export type UsageRecord = Readonly<Record<string, unknown>> & {
  readonly usageId?: string;
  readonly cumulative?: boolean;
  readonly billing?: string;
  readonly costSource?: string;
  readonly costUsd?: number | null;
};

const countFields = Object.fromEntries(COUNT_FIELDS.map((field) => [field, COUNT_OR_NULL]));

/**
 * The findings of one usage record against the cross-field rules of
 * F111-FR-006. An empty list means the record keeps them.
 */
export function usageFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const findings: string[] = [];
  if (data.billing === SUBSCRIPTION && data.costUsd !== null && data.costUsd !== undefined) {
    if (data.costSource !== NOTIONAL) {
      findings.push(
        `cost under a subscription is labelled notional: \`costSource\` reads ` +
          `${JSON.stringify(data.costSource)}`,
      );
    }
  }
  return Object.freeze(findings);
}

/** True where the cost of the record is notional and not a charge. */
export function isNotional(data: Readonly<Record<string, unknown>>): boolean {
  return data.billing === SUBSCRIPTION || data.costSource === NOTIONAL;
}

/** The counts of a usage record, as numbers or null. */
export type UsageCounts = Record<CountField, number | null> & { readonly cumulative: boolean };

function countOf(record: Readonly<Record<string, unknown>>, field: CountField): number | null {
  const value = record[field];
  return typeof value === "number" ? value : null;
}

/**
 * An adapter converts a CUMULATIVE report to an increment (F111-FR-006): the
 * increment is the difference from the previous cumulative report of the same
 * scope. A report that is already an increment passes through. A count the
 * harness did not report stays null, because a difference of nothing is
 * nothing and not zero.
 */
export function toIncrement(
  previous: Readonly<Record<string, unknown>> | null,
  current: Readonly<Record<string, unknown>>,
): UsageCounts & Readonly<Record<string, unknown>> {
  const counts: Record<string, number | null> = {};
  const cumulative = current.cumulative === true;
  for (const field of COUNT_FIELDS) {
    const now = countOf(current, field);
    if (!cumulative || now === null) {
      counts[field] = now;
      continue;
    }
    const before = previous === null ? 0 : (countOf(previous, field) ?? 0);
    counts[field] = now - before;
  }
  return Object.freeze({ ...current, ...counts, cumulative: false }) as UsageCounts &
    Readonly<Record<string, unknown>>;
}

/**
 * A reader sums INCREMENTS ONLY (F111-FR-006). A record whose `cumulative`
 * flag is true is skipped: adding it would count the increments that made it
 * up a second time.
 */
export function sumOfIncrements(
  records: readonly Readonly<Record<string, unknown>>[],
): Record<CountField, number> {
  const total = Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])) as Record<
    CountField,
    number
  >;
  for (const record of records) {
    if (record.cumulative === true) continue;
    for (const field of COUNT_FIELDS) {
      const value = countOf(record, field);
      if (value !== null) total[field] += value;
    }
  }
  return total;
}

/** A replay is deduplicated by `usageId` (F111-FR-006): the first wins. */
export function dedupeByUsageId<T extends Readonly<Record<string, unknown>>>(
  records: readonly T[],
): readonly T[] {
  const seen = new Set<unknown>();
  const kept: T[] = [];
  for (const record of records) {
    const id = record.usageId;
    if (id !== undefined && seen.has(id)) continue;
    if (id !== undefined) seen.add(id);
    kept.push(record);
  }
  return Object.freeze(kept);
}

/** The refinements of F111-FR-006. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-006",
    type: USAGE_REPORTED,
    required: [
      "usageId",
      "scope",
      "cumulative",
      ...COUNT_FIELDS,
      "costUsd",
      "costSource",
      "billing",
    ],
    fields: {
      usageId: TEXT,
      scope: TEXT,
      cumulative: FLAG,
      ...countFields,
      costUsd: NUMBER_OR_NULL,
      costSource: TEXT,
      billing: { enum: BILLINGS },
    },
    rules: [
      {
        name: "subscription-cost-is-notional",
        check: (data) => usageFindings(data)[0] ?? null,
      },
    ],
    note: "the harness, the provider, the model and the role are envelope fields",
  }),
  refine({
    requirement: "F111-FR-006",
    type: USAGE_UNAVAILABLE,
    required: ["reason", "scope"],
    fields: {
      scope: TEXT,
    },
    note: `a harness that reports nothing gives the reason \`${HARNESS_DOES_NOT_REPORT}\` per pass`,
  }),
]);
