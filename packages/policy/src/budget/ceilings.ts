/**
 * T009 — the evaluation of the ceilings of §Q.3 (F127-FR-024, F127-FR-025).
 *
 * A pure function over a ledger value and the ceilings a consumer configured.
 * No clock: `wallClock` is the one dimension measured per engine start
 * (F127-FR-026), so its elapsed time is handed in as a number — the engine
 * reads its clock port and this module stays testable on a fake clock.
 *
 * The five rules:
 *
 *  1. **dimensions** — `tokens`, `costUsd`, `wallClock`, `phaseAttempts`,
 *     `calls`: row 206 of annex X §X.6, the closed set this feature owns. A
 *     dimension outside the five is a CONFIGURATION ERROR, which is row 206's
 *     unknown-value rule;
 *  2. **scopes** — role: `tokens`, `costUsd`, `calls`; run: all five (§Q.3);
 *  3. **hard and soft** — `tokens` and `costUsd` are hard and count only
 *     records of billing mode `api`; `phaseAttempts` and `calls` are counts and
 *     always hard; those four are the CAPS OF SPEND and a reached one takes the
 *     path of F127-FR-034. `wallClock` is always enforced but is a ceiling of
 *     TIME and not a cap of spend: a trip takes the path of F127-FR-027 and
 *     never that of F127-FR-034 (CQ-192, item W-127-01). `softTokens` counts
 *     every observed token of the role and only raises alerts;
 *  4. **0 or non-finite is off** — a ceiling of 0, absent, not a number or not
 *     finite is OFF and never trips (F127-FR-024);
 *  5. **every exhausted ceiling is reported** — `evaluateCeilings` returns the
 *     whole list, not the first (F127-FR-024: "The evaluation of several
 *     ceilings MUST report every exhausted one").
 *
 * An active ceiling that is reached gives the event `budget.exceeded`, naming
 * which ceiling tripped and by how much, and leaves the run RESUMABLE: raising
 * the ceiling and running `resume` continues where it stopped (F127-FR-024).
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { callCount, hardTokens, observedTokens, realCostUsd, type SpendLedger } from "./ledger.ts";

/* ------------------------------------------------------------------ *
 * 1. Dimensions — row 206 of annex X §X.6.
 * ------------------------------------------------------------------ */

/** The five dimensions of §Q.3; row 206 of annex X §X.6. */
export const BUDGET_DIMENSIONS = [
  "tokens",
  "costUsd",
  "wallClock",
  "phaseAttempts",
  "calls",
] as const;
export type BudgetDimension = (typeof BUDGET_DIMENSIONS)[number];

/**
 * Row 206's unknown-value rule: a dimension outside the five is refused as a
 * CONFIGURATION ERROR — the key is not read as something else and is never
 * silently ignored.
 */
export const DIMENSION_WHEN_UNKNOWN = "configuration-error" as const;

/** Row 206 as the contracts package registers it. */
export const BUDGET_DIMENSION_SET = closedSet(206);

/** A ceiling whose dimension is outside row 206 (F127-FR-024, row 206). */
export class BudgetDimensionError extends Error {
  readonly dimension: string;
  constructor(dimension: string) {
    super(
      `the budget dimension ${JSON.stringify(dimension)} is not a member of the closed set ` +
        `"Budget dimensions" (annex X §X.6 row 206: ${BUDGET_DIMENSIONS.join(", ")}); the key ` +
        `is refused as a configuration error`,
    );
    this.name = "BudgetDimensionError";
    this.dimension = dimension;
  }
}

/** Read a dimension; one outside the five throws a configuration error. */
export function readDimension(value: string): BudgetDimension {
  if (!(BUDGET_DIMENSIONS as readonly string[]).includes(value)) {
    throw new BudgetDimensionError(value);
  }
  return value as BudgetDimension;
}

/* ------------------------------------------------------------------ *
 * 2. Scopes — §Q.3.
 * ------------------------------------------------------------------ */

/** The two scopes of §Q.3. */
export const BUDGET_SCOPES = ["role", "run"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/** The dimensions each scope may carry (§Q.3, the row "Scopes"). */
export const DIMENSIONS_BY_SCOPE: Readonly<Record<BudgetScope, readonly BudgetDimension[]>> =
  Object.freeze({
    role: Object.freeze(["tokens", "costUsd", "calls"] as const),
    run: Object.freeze([...BUDGET_DIMENSIONS]),
  });

/** True where the scope may carry the dimension (§Q.3). */
export function scopeCarries(scope: BudgetScope, dimension: BudgetDimension): boolean {
  return DIMENSIONS_BY_SCOPE[scope].includes(dimension);
}

/* ------------------------------------------------------------------ *
 * 3. Hard and soft — §Q.3, F127-FR-025.
 * ------------------------------------------------------------------ */

/**
 * The four CAPS OF SPEND (§Q.3, F127-FR-025): their counts live in the spend
 * ledger, survive a relaunch, and a reached one ends with the blocked reason
 * `budget-cap` (F127-FR-034).
 */
export const CAPS_OF_SPEND: readonly BudgetDimension[] = Object.freeze([
  "tokens",
  "costUsd",
  "phaseAttempts",
  "calls",
]);

/**
 * `wallClock` is always enforced and is EXEMPT from the caps of spend: it is a
 * ceiling of time, measured per engine start, and a trip takes the path of
 * F127-FR-027 — stop reason `wall_budget`, exit 4, `retryable: true` and no
 * blocked reason (CQ-192, item W-127-01).
 */
export const CEILING_OF_TIME: BudgetDimension = "wallClock";

/** The two hard dimensions that count only records of billing mode `api`. */
export const API_ONLY_DIMENSIONS: readonly BudgetDimension[] = Object.freeze(["tokens", "costUsd"]);

/** The soft budget of §Q.3: it counts every observed token and only alerts. */
export const SOFT_DIMENSION = "softTokens" as const;

/** How hard a ceiling is. */
export const CEILING_KINDS = ["hard", "soft", "time"] as const;
export type CeilingKind = (typeof CEILING_KINDS)[number];

/** The kind of a dimension (§Q.3, F127-FR-025). */
export function kindOf(dimension: BudgetDimension | typeof SOFT_DIMENSION): CeilingKind {
  if (dimension === SOFT_DIMENSION) return "soft";
  if (dimension === CEILING_OF_TIME) return "time";
  return "hard";
}

/* ------------------------------------------------------------------ *
 * 4. 0 or non-finite is off — F127-FR-024.
 * ------------------------------------------------------------------ */

/**
 * A ceiling of 0, absent, not a number or not finite is OFF (F127-FR-024,
 * §Q.3 the row "Off"). This is the one gate every evaluation passes through.
 */
export function isOff(limit: number | null | undefined): boolean {
  return (
    limit === null ||
    limit === undefined ||
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    limit === 0
  );
}

/** True where the ceiling is active: not off (F127-FR-024). */
export function isActive(limit: number | null | undefined): boolean {
  return !isOff(limit);
}

/* ------------------------------------------------------------------ *
 * The ceilings a consumer configured, and the evaluation.
 * ------------------------------------------------------------------ */

/** One configured ceiling (§Q.3, the row "Keys"). */
export type Ceiling = {
  readonly scope: BudgetScope;
  /** The role, where the scope is `role`. */
  readonly role?: string | undefined;
  readonly dimension: BudgetDimension | typeof SOFT_DIMENSION;
  /** The limit; 0, absent or not finite is off (F127-FR-024). */
  readonly limit: number | null | undefined;
};

/** The configuration key of a ceiling (§Q.3, rows 107 and 108 of annex X §X.7). */
export function keyOf(ceiling: Ceiling): string {
  if (ceiling.dimension === CEILING_OF_TIME) return "loop.maxWallMin";
  return ceiling.scope === "role"
    ? `budget.role.${ceiling.role ?? "<role>"}.${ceiling.dimension}`
    : `budget.run.${ceiling.dimension}`;
}

/** What the evaluation is measured against. */
export type UsageSnapshot = {
  readonly ledger: SpendLedger;
  /**
   * The whole minutes elapsed since THIS ENGINE START, less the time in a
   * pause (F127-FR-026, F127-FR-012). The engine computes it from its clock
   * port; this module reads no clock.
   */
  readonly wallClockMinutes?: number | undefined;
};

/** The reading of one ceiling. */
export type CeilingReading = {
  readonly ceiling: Ceiling;
  readonly key: string;
  readonly dimension: BudgetDimension | typeof SOFT_DIMENSION;
  readonly scope: BudgetScope;
  readonly role: string | null;
  readonly kind: CeilingKind;
  /** False where the ceiling is 0, absent or not finite (F127-FR-024). */
  readonly active: boolean;
  /** The limit, where the ceiling is active. */
  readonly limit: number | null;
  /** What the ledger (or the wall clock) gives; `null` is unknown. */
  readonly used: number | null;
  /** True where `used` has reached `limit`. */
  readonly exhausted: boolean;
  /** By how much `used` is past `limit`; 0 where it is not. */
  readonly over: number;
  /**
   * True where raising the ceiling and running `resume` continues where the
   * run stopped (F127-FR-024). Every ceiling of this feature is resumable.
   */
  readonly resumable: boolean;
  /** True where a trip takes the path of F127-FR-034 (the caps of spend). */
  readonly isCapOfSpend: boolean;
};

/** What `evaluateCeilings` answers. */
export type CeilingEvaluation = {
  /** Every ceiling that was handed in, active or not. */
  readonly readings: readonly CeilingReading[];
  /** EVERY exhausted ceiling, not the first (F127-FR-024). */
  readonly exhausted: readonly CeilingReading[];
  /** The exhausted caps of spend, which take the path of F127-FR-034. */
  readonly exhaustedCapsOfSpend: readonly CeilingReading[];
  /** The exhausted `wallClock`, which takes the path of F127-FR-027. */
  readonly wallClockTripped: CeilingReading | null;
  /** The exhausted soft budgets, which only raise alerts (F127-FR-025). */
  readonly exhaustedSoft: readonly CeilingReading[];
};

/**
 * What the ledger gives for a dimension at a scope. A hard dimension of tokens
 * or cost reads records of billing mode `api` ALONE; the soft budget reads
 * every observed token, including a record of billing mode `unknown`
 * (F127-FR-025).
 */
export function usedFor(
  dimension: BudgetDimension | typeof SOFT_DIMENSION,
  scope: BudgetScope,
  role: string | undefined,
  usage: UsageSnapshot,
): number | null {
  const of = scope === "role" ? role : undefined;
  switch (dimension) {
    case "tokens":
      return hardTokens(usage.ledger, of);
    case "costUsd":
      return realCostUsd(usage.ledger, of);
    case "calls":
      return callCount(usage.ledger, of);
    case "phaseAttempts":
      return usage.ledger.run.phaseAttempts;
    case CEILING_OF_TIME:
      return typeof usage.wallClockMinutes === "number" && Number.isFinite(usage.wallClockMinutes)
        ? usage.wallClockMinutes
        : null;
    case SOFT_DIMENSION:
      return observedTokens(usage.ledger, of);
    default:
      return null;
  }
}

/** Read one ceiling against the usage (F127-FR-024, F127-FR-025). */
export function readCeiling(ceiling: Ceiling, usage: UsageSnapshot): CeilingReading {
  if (ceiling.dimension !== SOFT_DIMENSION) readDimension(ceiling.dimension);
  const scope = ceiling.scope;
  const role = ceiling.scope === "role" ? (ceiling.role ?? null) : null;
  const active = isActive(ceiling.limit);
  const limit = active ? (ceiling.limit as number) : null;
  const used = usedFor(ceiling.dimension, scope, ceiling.role, usage);
  const kind = kindOf(ceiling.dimension);
  const exhausted = active && limit !== null && used !== null && used >= limit;
  return Object.freeze({
    ceiling,
    key: keyOf(ceiling),
    dimension: ceiling.dimension,
    scope,
    role,
    kind,
    active,
    limit,
    used,
    exhausted,
    over: exhausted && limit !== null && used !== null ? Math.max(0, used - limit) : 0,
    resumable: true,
    isCapOfSpend:
      ceiling.dimension !== SOFT_DIMENSION &&
      CAPS_OF_SPEND.includes(ceiling.dimension as BudgetDimension),
  });
}

/**
 * Evaluate the ceilings of §Q.3 at role and run scope (F127-FR-024).
 *
 * Reports EVERY exhausted ceiling. A ceiling whose scope may not carry its
 * dimension (§Q.3: a role has no `wallClock` and no `phaseAttempts`) is
 * refused as a configuration error, as row 206's unknown-value rule asks of a
 * key that cannot be read.
 */
export function evaluateCeilings(
  ceilings: readonly Ceiling[],
  usage: UsageSnapshot,
): CeilingEvaluation {
  const readings: CeilingReading[] = [];
  for (const ceiling of ceilings) {
    if (
      ceiling.dimension !== SOFT_DIMENSION &&
      !scopeCarries(ceiling.scope, ceiling.dimension as BudgetDimension)
    ) {
      throw new BudgetDimensionError(
        `${ceiling.dimension} at the scope ${ceiling.scope}; §Q.3 gives the scope ` +
          `${ceiling.scope} the dimensions ${DIMENSIONS_BY_SCOPE[ceiling.scope].join(", ")}`,
      );
    }
    readings.push(readCeiling(ceiling, usage));
  }
  const exhausted = readings.filter((reading) => reading.exhausted);
  return Object.freeze({
    readings: Object.freeze(readings),
    exhausted: Object.freeze(exhausted),
    exhaustedCapsOfSpend: Object.freeze(exhausted.filter((reading) => reading.isCapOfSpend)),
    wallClockTripped: exhausted.find((reading) => reading.dimension === CEILING_OF_TIME) ?? null,
    exhaustedSoft: Object.freeze(exhausted.filter((reading) => reading.kind === "soft")),
  });
}

/**
 * The payload of `budget.exceeded` for an exhausted ceiling: the fields
 * `dimension`, `limit`, `used`, `role` and `resumable` of the catalogue of
 * feature 111 (F127-FR-024, F127-FR-034).
 */
export function budgetExceededPayload(reading: CeilingReading): Readonly<Record<string, unknown>> {
  return Object.freeze({
    dimension: reading.dimension,
    limit: reading.limit,
    used: reading.used,
    role: reading.role,
    resumable: reading.resumable,
    over: reading.over,
    key: reading.key,
    scope: reading.scope,
  });
}

/**
 * §Q.4, the row "Budget level" — the level of a ceiling for readers is the
 * highest threshold reached: none, 50, 75, 90, or exceeded.
 */
export const BUDGET_LEVELS = ["none", "50", "75", "90", "exceeded"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

/** The thresholds of §Q.4, as percentages. */
export const ALERT_THRESHOLDS: readonly number[] = Object.freeze([50, 75, 90]);

/** The level of a ceiling for a reader (§Q.4, the row "Budget level"). */
export function budgetLevelOf(reading: CeilingReading): BudgetLevel {
  if (!reading.active || reading.limit === null || reading.used === null) return "none";
  if (reading.exhausted) return "exceeded";
  const percent = (reading.used / reading.limit) * 100;
  let level: BudgetLevel = "none";
  for (const threshold of ALERT_THRESHOLDS) {
    if (percent >= threshold) level = String(threshold) as BudgetLevel;
  }
  return level;
}
