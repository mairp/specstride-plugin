/**
 * T056 / CT-131-35 — usage per turn for this adapter (F131-FR-035).
 *
 * The usage comes from the record that completes a turn, as increments, and
 * is accounted by the usage accountant of the stream seam: one
 * `usage.reported` per completed turn, a value the record does not carry is
 * null (never zero), a killed pass keeps the usage of the turns that
 * completed while the turn in flight stays unknown (`usage.unavailable`,
 * reason `killed`, last usage kept), and a cost under a login is labelled
 * `notional`. The usage of a call of form (b) comes from the usage field of
 * the reply where there is one, and is otherwise null. The cost is null
 * unless it is computed from prices with a date in the descriptor
 * (`data/descriptor.json`, `cost.criticPrices`).
 */
import {
  UsageAccountant,
  type UsageEvent,
  type UsageFacts,
} from "../../harness/src/stream/usage.ts";
import {
  loadStreamMapping,
  readCodexStream,
  type StreamMappingData,
  type StreamRead,
} from "./mapping.ts";

/** The auth tier a cost is accounted under: a login is notional, a key is metered. */
export type CostBasis = "notional" | "metered";

/** Prices with a date, as the descriptor carries them (`cost.criticPrices`). */
export type DatedPrices = {
  readonly currency: string;
  readonly input: number;
  readonly output: number;
  readonly asOf: string;
};

/** The per-turn usage facts of one stream, plus the stream read behind them. */
export type StreamUsage = {
  readonly read: StreamRead;
  readonly events: readonly UsageEvent[];
  readonly facts: UsageFacts;
};

/** Account the usage of one stream (F131-FR-035). */
export function usageOfStream(
  lines: readonly string[],
  options: {
    /** True where the pass runs under a login: a cost is notional. */
    readonly subscription?: boolean | undefined;
    /** True where the pass was killed before its terminal record. */
    readonly killed?: boolean | undefined;
    readonly mapping?: StreamMappingData | undefined;
  } = {},
): StreamUsage {
  const read = readCodexStream(lines, options.mapping ?? loadStreamMapping());
  const accountant = new UsageAccountant({
    usageSource: "stream",
    subscription: options.subscription ?? false,
  });
  const events: UsageEvent[] = [];
  for (const record of read.records) events.push(...accountant.push(record));
  if (options.killed === true) events.push(...accountant.kill());
  else events.push(...accountant.finish());
  return { read, events, facts: accountant.facts() };
}

/** The usage of one reply of form (b): from the reply's usage field, else null. */
export type DirectUsage = {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cost: number | null;
  readonly costBasis: CostBasis;
};

/** A whole non-negative number from the reply, else null — never zero. */
function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Read the usage of form (b) from the reply (F131-FR-035). */
export function usageOfDirectReply(
  usage: Readonly<Record<string, unknown>> | null | undefined,
  authTier: 1 | 2,
): DirectUsage {
  const basis: CostBasis = authTier === 1 ? "notional" : "metered";
  if (usage === null || usage === undefined || typeof usage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
      cost: null,
      costBasis: basis,
    };
  }
  return {
    inputTokens: nonNegative(usage["prompt_tokens"] ?? usage["input_tokens"]),
    outputTokens: nonNegative(usage["completion_tokens"] ?? usage["output_tokens"]),
    cacheReadTokens: nonNegative(
      usage["prompt_tokens_details"] &&
        typeof usage["prompt_tokens_details"] === "object" &&
        usage["prompt_tokens_details"] !== null
        ? (usage["prompt_tokens_details"] as Readonly<Record<string, unknown>>)["cached_tokens"]
        : null,
    ),
    reasoningTokens: nonNegative(
      usage["completion_tokens_details"] &&
        typeof usage["completion_tokens_details"] === "object" &&
        usage["completion_tokens_details"] !== null
        ? (usage["completion_tokens_details"] as Readonly<Record<string, unknown>>)[
            "reasoning_tokens"
          ]
        : null,
    ),
    cost: null, // computed only from dated prices below (F131-FR-035)
    costBasis: basis,
  };
}

/**
 * The cost of a usage, computed only from prices with a date (F131-FR-035):
 * null without prices; labelled `notional` under a login, `metered` under a
 * key. Prices are per million tokens, as the descriptor states them.
 */
export function computeCost(
  usage: { readonly inputTokens: number | null; readonly outputTokens: number | null },
  prices: DatedPrices | null,
  authTier: 1 | 2,
): { readonly cost: number | null; readonly costBasis: CostBasis } {
  const basis: CostBasis = authTier === 1 ? "notional" : "metered";
  if (prices === null || prices.asOf.length === 0) return { cost: null, costBasis: basis };
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    cost: (input * prices.input + output * prices.output) / 1_000_000,
    costBasis: basis,
  };
}
