/**
 * T005, T021 — the functions the read model may not do itself, handed in by
 * its caller (plan.md, Primary Dependencies).
 *
 * The table evaluator, the redaction patterns and the canonical hasher live in
 * `@specstride/kernel`; `@specstride/view` imports only `@specstride/contracts`
 * and no Node built-in module (`contracts/data/package-graph.json`). The ports
 * are therefore a SECOND parameter of `project` and never an input of
 * F129-FR-001: they carry no fact about the run.
 */
import type { Redactor } from "../text/index.ts";

export type { Redactor };

/** One row of a table of annex X §X.3, as the evaluator of the kernel reads it. */
export type TableRow = {
  readonly id: string;
  readonly when: (signals: Readonly<Record<string, unknown>>) => boolean;
  readonly choice: string;
  readonly isDefault?: boolean;
};

/** The one table evaluator of annex X §X.3: the first matching row fires. */
export type TableEvaluator = (
  rows: readonly TableRow[],
  signals: Readonly<Record<string, unknown>>,
) => { readonly id: string; readonly choice: string };

/** The canonical hasher of annex X §X.5, over the canonical text of a record. */
export type CanonicalHasher = (canonicalText: string) => string;

/** The ports of the read model. Every one of them has a pure fallback. */
export type ViewPorts = {
  /** The injected redaction function; absent means every free text is dropped. */
  readonly redactor?: Redactor | null;
  /** The injected table evaluator; absent means the built-in first-match rule. */
  readonly evaluateTable?: TableEvaluator;
  /** The injected canonical hasher; absent means the built-in pure hash. */
  readonly hash?: CanonicalHasher;
  /**
   * `status.staleEventSec` (feature 110, `contracts/config-keys.tsv` row 245):
   * the age of the newest event after which a run whose heartbeat is also late
   * is `stale`. Default 1800.
   */
  readonly staleEventSec?: number;
  /**
   * `status.timelineRows` (row 246): the rows of the timeline the view holds.
   * Default 20.
   */
  readonly timelineRows?: number;
};

/** The default of `status.staleEventSec` (feature 110, row 245). */
export const DEFAULT_STALE_EVENT_SEC = 1800 as const;
/** The default of `status.timelineRows` (feature 110, row 246). */
export const DEFAULT_TIMELINE_ROWS = 20 as const;

/** The built-in first-match evaluator used where the caller injects none. */
export const firstMatchEvaluator: TableEvaluator = (rows, signals) => {
  for (const row of rows) {
    if (row.isDefault === true) continue;
    if (row.when(signals)) return { id: row.id, choice: row.choice };
  }
  const fallback = rows.find((row) => row.isDefault === true) ?? rows[rows.length - 1];
  if (fallback === undefined) throw new Error("the table has no row");
  return { id: fallback.id, choice: fallback.choice };
};
