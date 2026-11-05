/**
 * T005 — the budget rows of the view: the levels and the bound
 * (`contracts/run-view.md`; F129-FR-020, F129-FR-026).
 *
 * T073 (User Story 6, F129-FR-020) — the level of a row is the highest level
 * of the alerts of the ENGINE that are still in force for the row (the level
 * the `alert` signal last recorded); `over` is ADDED only when the fraction is
 * above 1 or the engine has reported that the cap was exceeded (the
 * `budget.exceeded` signal, which writes `over` directly). The read model
 * raises no alert of its own: the engine is the only source of alerts. A
 * notional cost (`costClass` `subscription`, mark `notional`) is never added
 * to a metered cost — the metered and notional sums are separate here, and the
 * row key already keeps them in separate rows.
 */
import { BUDGET_LEVELS, COLLECTION_BOUNDS } from "../model/view.ts";
import type { BudgetLevel, BudgetRow } from "../model/view.ts";

export { BUDGET_LEVELS };

/** The bound on the number of budget rows the view holds (F129-FR-026). */
export const BUDGET_BOUND = COLLECTION_BOUNDS.budgetRows;

/** The level a reader uses for a value of the set it does not know (row 245). */
export const BUDGET_LEVEL_WHEN_UNKNOWN: BudgetLevel = "unknown";

/** Rows in a stable order (scope, role, cost class), cut to the bound. */
export function orderBudget(rows: readonly BudgetRow[]): {
  readonly rows: readonly BudgetRow[];
  readonly omitted: number;
} {
  const key = (row: BudgetRow): string =>
    `${row.scope}\u0000${row.role ?? ""}\u0000${row.costClass ?? ""}`;
  const sorted = [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return Object.freeze({
    rows: Object.freeze(sorted.slice(0, BUDGET_BOUND)),
    omitted: Math.max(0, sorted.length - BUDGET_BOUND),
  });
}

/** The parts of a row the level derivation reads. */
export type LevelInput = {
  readonly level: BudgetLevel;
  readonly fraction: number | null;
};

/**
 * T073 (F129-FR-020) — the level of one row. It is the level the ENGINE's
 * alerts left on the row; `over` is added when the fraction is above 1. No
 * other level is derived here: the read model raises no alert of its own.
 */
export function levelOf(row: LevelInput): BudgetLevel {
  if (row.fraction !== null && row.fraction > 1) return "over";
  return row.level;
}

/**
 * T073 — the levels of every row, derived in place on copies. Called by the
 * derivation step (`reduce/index.ts`) after the fold, before the attention
 * items are raised from the rows.
 */
export function budgetLevelsOf<T extends LevelInput>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row, level: levelOf(row) }));
}

/** The parts of a row the spend sums read. */
export type SpendInput = { readonly notional: boolean; readonly spent: number | null };

/** The sum of the METERED spend: the spent of every row that is not notional. */
export function meteredSpendOf(rows: readonly SpendInput[]): number {
  return rows.reduce((total, row) => (row.notional ? total : total + (row.spent ?? 0)), 0);
}

/** The sum of the NOTIONAL spend: kept apart, never added to the metered sum. */
export function notionalSpendOf(rows: readonly SpendInput[]): number {
  return rows.reduce((total, row) => (row.notional ? total + (row.spent ?? 0) : total), 0);
}

/** Whether a row is a notional one: the cost class `subscription` (F129-FR-020). */
export function isNotionalCostClass(costClass: string | null): boolean {
  return costClass === "subscription";
}

/** The parts of a row the quota derivation reads, and the pause record's shape. */
export type QuotaInput = { readonly quota: string; readonly role: string | null };

/**
 * T073 (F129-FR-020) — the quota of every row: `ok` until the engine signals,
 * `signalled` from the `quota.signal` event (the `quota` signal sets it in the
 * fold), and `paused` where a pause record of the run rests on the row's role.
 * The reset time a pause record carries belongs to the item `quota-pause`
 * (`contracts/lane-and-attention.md`); the row itself holds the state only.
 */
export function quotaStatesOf<T extends QuotaInput>(
  rows: readonly T[],
  pause: Readonly<Record<string, unknown>> | null,
): T[] {
  if (pause === null) return [...rows];
  const role = typeof pause["role"] === "string" ? pause["role"] : null;
  if (role === null) return [...rows];
  return rows.map((row) => ({ ...row, quota: row.role === role ? "paused" : row.quota }));
}
