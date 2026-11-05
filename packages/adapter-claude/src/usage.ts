/**
 * T059 — the usage increments and the notional label of the Claude harness
 * adapter (F125-FR-032, CT-125-23).
 *
 * From `contracts/classifier-table.md`, "Usage" (F125-FR-032):
 *  - an assistant record's per-call usage is an increment per model call,
 *    as it completes;
 *  - the final record's per-model breakdown is preferred to the top-level
 *    usage, which covers the main loop only;
 *  - the final record's total cost is an estimate, cumulative for a
 *    continued session, so the delta per session id is recorded; notional
 *    at auth tier 1; null for a killed pass;
 *  - a messages call reports input, output and cache tokens, and no cost.
 *
 * Null when unknown; never zero for an unknown (the data model).
 */

/** One usage figure set, as the stream reports it. */
export type UsageFigures = {
  readonly input?: number | null;
  readonly output?: number | null;
  readonly cacheRead?: number | null;
  readonly cacheCreate?: number | null;
};

/** Why a cost figure is notional: the closed set of the label. */
export type NotionalReason = "auth-tier-1" | "no-price-data";

/** One usage increment, as the data model shapes it. */
export type UsageIncrement = {
  readonly sessionId: string;
  readonly model: string | null;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly cacheCreate: number | null;
  readonly costEstimate: number | null;
  readonly notional: boolean;
  readonly notionalReason: NotionalReason | null;
  /** False for a pass the caller killed before it completed. */
  readonly complete: boolean;
};

function figure(value: number | null | undefined): number | null {
  // Null when unknown; never zero for an unknown.
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * The increment of one completed model call, from an assistant record's
 * per-call usage (F125-FR-032). At auth tier 1 the cost is notional.
 */
export function usageIncrement(input: {
  readonly sessionId: string;
  readonly model?: string | null;
  readonly usage: UsageFigures;
  readonly authTier: 1 | 2;
  readonly costEstimate?: number | null;
}): UsageIncrement {
  const notional = input.authTier === 1;
  return {
    sessionId: input.sessionId,
    model: input.model ?? null,
    input: figure(input.usage.input),
    output: figure(input.usage.output),
    cacheRead: figure(input.usage.cacheRead),
    cacheCreate: figure(input.usage.cacheCreate),
    costEstimate: figure(input.costEstimate),
    notional,
    notionalReason: notional ? "auth-tier-1" : null,
    complete: true,
  };
}

/**
 * The increment of a pass the caller killed: the figures seen so far stand,
 * the cost is null (an estimate of an unfinished pass is not honest) and
 * `complete` is false.
 */
export function killedPassIncrement(input: {
  readonly sessionId: string;
  readonly model?: string | null;
  readonly usage?: UsageFigures | null;
  readonly authTier: 1 | 2;
}): UsageIncrement {
  const notional = input.authTier === 1;
  const usage = input.usage ?? {};
  return {
    sessionId: input.sessionId,
    model: input.model ?? null,
    input: figure(usage.input),
    output: figure(usage.output),
    cacheRead: figure(usage.cacheRead),
    cacheCreate: figure(usage.cacheCreate),
    costEstimate: null,
    notional,
    notionalReason: notional ? "auth-tier-1" : null,
    complete: false,
  };
}

/**
 * The usage of a FINAL record (F125-FR-032): the per-model breakdown is
 * preferred to the top-level usage, which covers the main loop only. The
 * total cost is cumulative for a continued session, so the delta against
 * the previously recorded cumulative total is what is recorded.
 */
export function finalRecordUsage(input: {
  readonly sessionId: string;
  readonly authTier: 1 | 2;
  readonly breakdown?: UsageFigures | null;
  readonly topLevelUsage?: UsageFigures | null;
  readonly totalCostUsd?: number | null;
  /** The cumulative cost recorded before this final record, or null. */
  readonly cumulativeBefore?: number | null;
}): UsageIncrement {
  // The per-model breakdown is preferred.
  const figures = input.breakdown ?? input.topLevelUsage ?? {};
  const total = figure(input.totalCostUsd);
  const before =
    typeof input.cumulativeBefore === "number" && Number.isFinite(input.cumulativeBefore)
      ? input.cumulativeBefore
      : null;
  const costEstimate = before === null ? total : total === null ? null : total - before;
  const notional = input.authTier === 1;
  return {
    sessionId: input.sessionId,
    model: null,
    input: figure(figures.input),
    output: figure(figures.output),
    cacheRead: figure(figures.cacheRead),
    cacheCreate: figure(figures.cacheCreate),
    costEstimate,
    notional,
    notionalReason: notional ? "auth-tier-1" : null,
    complete: true,
  };
}

/** The label carried by a notional cost (the "notional" marker). */
export function notionalLabel(increment: UsageIncrement): string | null {
  if (!increment.notional) return null;
  return `notional (${increment.notionalReason})`;
}

/**
 * The usage of a MESSAGES call (F125-FR-032): input, output and cache
 * tokens; the cost is null, the messages call reports none.
 */
export function messagesCallUsage(input: {
  readonly sessionId: string;
  readonly model?: string | null;
  readonly usage: UsageFigures;
}): UsageIncrement {
  return {
    sessionId: input.sessionId,
    model: input.model ?? null,
    input: figure(input.usage.input),
    output: figure(input.usage.output),
    cacheRead: figure(input.usage.cacheRead),
    cacheCreate: figure(input.usage.cacheCreate),
    costEstimate: null,
    notional: false,
    notionalReason: null,
    complete: true,
  };
}

/** Sums increments of one session, null-aware (never a guess of 0). */
export function totalTokens(
  increments: readonly UsageIncrement[],
  field: keyof UsageFigures,
): number | null {
  let sum = 0;
  let seen = false;
  for (const increment of increments) {
    const value = increment[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : null;
}
