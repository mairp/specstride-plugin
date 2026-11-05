/**
 * The usage of the JSONL reader (T036; covers F138-FR-035 and F138-FR-040).
 *
 * Usage is read under both spellings the dialect row names; a negative,
 * boolean or non-numeric value is ignored. The usage of each turn end is
 * summed, and the usage of the end of the agent is merged as the maximum of
 * the running total and the value of the end. The total is derived as input
 * plus output when the provider gave none and either exists. The turn count
 * is reported under two names when it is above 0. Cost is reported under
 * `cost` and cache writes under `cache_write_tokens`, never under
 * `cost_usd` or `cache_creation_tokens` — a preserved defect of the
 * compatibility projection. Usage leaves the reader per turn as increments,
 * each with a unique usage id; the increment that closes the stream reduces
 * the end so the increments sum to the merged total; a value the stream does
 * not give is null and never zero.
 */
import type { DialectRow } from "./dialect.ts";

/** One numeric usage value of the stream, or null where none is given. */
export type UsageValue = number | null;

/** The typed usage the reader accumulates, keyed as the baseline keys it. */
export type UsageState = {
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  cache_read_tokens?: number | undefined;
  cache_write_tokens?: number | undefined;
  total_tokens?: number | undefined;
  cost?: number | undefined;
};

/** A numeric value the reader accepts; a boolean or a negative is refused. */
export function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0;
}

/** The first present value of the names the row gives, else null. */
function pick(usage: Record<string, unknown>, names: readonly string[]): UsageValue {
  for (const name of names) {
    const value = usage[name];
    if (value !== undefined && value !== null) {
      if (isUsableNumber(value)) return value;
      return null;
    }
  }
  return null;
}

/** The names under which the row reports each usage field. */
export type UsageNames = Readonly<
  Record<"input" | "output" | "cacheRead" | "cacheWrite" | "total" | "cost", readonly string[]>
>;

/** The usage names of a row, as data (F138-FR-035). */
export function usageNamesOf(row: DialectRow): UsageNames {
  const names = (row.usageNames ?? {}) as Record<string, unknown>;
  const list = (key: string, fallback: readonly string[]): readonly string[] => {
    const value = names[key];
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? (value as string[])
      : fallback;
  };
  return {
    input: list("input", ["inputTokens", "input_tokens"]),
    output: list("output", ["outputTokens", "output_tokens"]),
    cacheRead: list("cacheRead", ["cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens"]),
    cacheWrite: list("cacheWrite", [
      "cacheWriteTokens",
      "cache_write_tokens",
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
    ]),
    total: list("total", ["totalTokens", "total_tokens"]),
    cost: list("cost", ["cost", "totalCost"]),
  };
}

/** Read one usage record of the stream into the typed values, or null. */
export function readUsage(
  usage: unknown,
  names: UsageNames,
): Partial<Record<keyof UsageNames, UsageValue>> | null {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  return {
    input: pick(record, names.input),
    output: pick(record, names.output),
    cacheRead: pick(record, names.cacheRead),
    cacheWrite: pick(record, names.cacheWrite),
    total: pick(record, names.total),
    cost: pick(record, names.cost),
  };
}

/** Sum one usage record of a turn end into the running state (F138-FR-035). */
export function sumUsage(state: UsageState, usage: unknown, names: UsageNames): void {
  const read = readUsage(usage, names);
  if (read === null) return;
  for (const key of Object.keys(read) as (keyof UsageNames)[]) {
    const value = read[key];
    if (value === null || value === undefined) continue;
    const field = snakeFieldOf(key);
    state[field] = (state[field] ?? 0) + value;
  }
}

/** The snake_case state field a typed usage key accumulates into. */
function snakeFieldOf(key: keyof UsageNames): keyof UsageState {
  switch (key) {
    case "input":
      return "input_tokens";
    case "output":
      return "output_tokens";
    case "cacheRead":
      return "cache_read_tokens";
    case "cacheWrite":
      return "cache_write_tokens";
    case "total":
      return "total_tokens";
    case "cost":
      return "cost";
  }
}

/** Merge the usage of the end of the agent: the maximum, per field. */
export function mergeUsageAtEnd(state: UsageState, usage: unknown, names: UsageNames): void {
  const read = readUsage(usage, names);
  if (read === null) return;
  for (const key of Object.keys(read) as (keyof UsageNames)[]) {
    const value = read[key];
    if (value === null || value === undefined) continue;
    const field = snakeFieldOf(key);
    state[field] = Math.max(state[field] ?? 0, value);
  }
}

/** Derive the total as input plus output where the provider gave none. */
export function deriveTotal(state: UsageState): UsageState {
  if (
    state.total_tokens === undefined &&
    (state.input_tokens !== undefined || state.output_tokens !== undefined)
  ) {
    return {
      ...state,
      total_tokens: (state.input_tokens ?? 0) + (state.output_tokens ?? 0),
    };
  }
  return state;
}

/** The usage fields of a terminal or a diagnostic, as the baseline carries them. */
export function usageFields(state: UsageState, turns: number): Record<string, number> {
  const derived = deriveTotal(state);
  const fields: Record<string, number> = {};
  if (derived.input_tokens !== undefined) fields["input_tokens"] = derived.input_tokens;
  if (derived.output_tokens !== undefined) fields["output_tokens"] = derived.output_tokens;
  if (derived.cache_read_tokens !== undefined) {
    fields["cache_read_tokens"] = derived.cache_read_tokens;
  }
  if (derived.cache_write_tokens !== undefined) {
    fields["cache_write_tokens"] = derived.cache_write_tokens;
  }
  if (derived.total_tokens !== undefined) fields["total_tokens"] = derived.total_tokens;
  if (derived.cost !== undefined) fields["cost"] = derived.cost;
  if (turns > 0) {
    fields["num_turns"] = turns;
    fields["turns"] = turns;
  }
  return fields;
}

/** One increment of usage, with its unique usage id (F138-FR-040). */
export type UsageIncrement = {
  usageId: string;
  input: UsageValue;
  output: UsageValue;
  cacheRead: UsageValue;
  cacheWrite: UsageValue;
  total: UsageValue;
  cost: UsageValue;
  final: boolean;
};

/** The prefix of a generated usage id, read from the row's provider format. */
function usageIdPrefix(row: DialectRow): string {
  const family = row.providerFormat.split(/-v\d+$/)[0] || row.providerFormat;
  return `${family}-usage-`;
}

/** The maker of usage increments: unique ids, and the closing reduction. */
export class UsageIncrements {
  private readonly prefix: string;
  private count = 0;
  private readonly sums: Record<keyof UsageNames, number> = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
  };

  constructor(row: DialectRow) {
    this.prefix = usageIdPrefix(row);
  }

  /** Record the increment one turn end gives; each carries its own id. */
  next(usage: unknown, names: UsageNames): UsageIncrement {
    const read = readUsage(usage, names) ?? {};
    const inc: UsageIncrement = {
      usageId: `${this.prefix}${++this.count}`,
      input: read["input"] ?? null,
      output: read["output"] ?? null,
      cacheRead: read["cacheRead"] ?? null,
      cacheWrite: read["cacheWrite"] ?? null,
      total: read["total"] ?? null,
      cost: read["cost"] ?? null,
      final: false,
    };
    for (const key of Object.keys(this.sums) as (keyof UsageNames)[]) {
      const value = inc[key];
      if (value !== null) this.sums[key] += value;
    }
    return inc;
  }

  /**
   * The increment that closes the stream: the merged total of the end minus
   * the increments already given, so their sum equals the merged total; a
   * field the stream never gave stays null and never zero.
   */
  closing(usage: unknown, names: UsageNames): UsageIncrement {
    const read = readUsage(usage, names) ?? {};
    const reduce = (key: keyof UsageNames): UsageValue => {
      const end = read[key];
      if (end === null || end === undefined) return null;
      return end - this.sums[key];
    };
    return {
      usageId: `${this.prefix}${++this.count}`,
      input: reduce("input"),
      output: reduce("output"),
      cacheRead: reduce("cacheRead"),
      cacheWrite: reduce("cacheWrite"),
      total: reduce("total"),
      cost: reduce("cost"),
      final: true,
    };
  }

  /** The increments given so far, and whether any turn was recorded. */
  get countOf(): number {
    return this.count;
  }
}
