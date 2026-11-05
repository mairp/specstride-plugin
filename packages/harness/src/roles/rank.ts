/**
 * T031 — the ranking of the qualified candidates of step 3 (F124-FR-040).
 *
 * The ranking is DATA: `packages/harness/data/ranking-table.json` (a copy of
 * the contract `ranking-table.json`, made by T003) holds the six comparison
 * keys in order, each with its rule id, its signal and the order of its
 * values. The comparison of two candidates is a decision point of the table
 * evaluator of the kernel (`@specstride/kernel`, decision D-5): from
 * the data a decision table is built whose point `compare` reads the
 * difference of the pair on the first key that decides and chooses `first`,
 * `second` or `next-key`. Every comparison is recorded with its rule id, the
 * table id and the table version (F100-FR-204).
 *
 * Pure: the load happens once, at module load; the sort compares and
 * mutates nothing but its own copy of the order.
 */
import { readFileSync } from "node:fs";
import {
  evaluateTable,
  TABLE_SCHEMA_ID,
  type Decision,
  type LoadedTable,
  type TableRow,
} from "@specstride/kernel";

/** The file the keys are read from (T003). */
const TABLE_URL = new URL("../../data/ranking-table.json", import.meta.url);

type RankingTable = {
  readonly schema: string;
  readonly id: string;
  readonly version: string;
  readonly keys: readonly {
    readonly ruleId: string;
    readonly signal: string | readonly string[];
    readonly order: readonly unknown[];
    readonly within?: Record<string, string>;
  }[];
  readonly default: { readonly ruleId: string; readonly choice: string };
};

function loadRankingTable(): RankingTable {
  const table = JSON.parse(readFileSync(TABLE_URL, "utf8")) as RankingTable;
  if (table.schema !== TABLE_SCHEMA_ID) {
    throw new Error(`ranking table ${table.id}: not a ${TABLE_SCHEMA_ID}`);
  }
  if (table.keys.length !== 6) {
    throw new Error(
      `ranking table ${table.id} (version ${table.version}): ` +
        `expected six comparison keys, found ${table.keys.length}`,
    );
  }
  return table;
}

export const RANKING_TABLE: RankingTable = loadRankingTable();

/** The id and the version every decision of the ranking carries. */
export const RANKING_TABLE_ID = RANKING_TABLE.id;
export const RANKING_TABLE_VERSION = RANKING_TABLE.version;
/** The rule ids of the six keys, in the order of the data. */
export const RANKING_RULE_IDS = RANKING_TABLE.keys.map((key) => key.ruleId);

/** The signals one candidate shows to the ranking. */
export type RankingSignal = {
  readonly harness: string;
  /** Key R1 — the form of the `completion` level. */
  readonly form: string;
  /** Key R2 — the state of the harness. */
  readonly state: string;
  /** Key R3 — the cost class. */
  readonly costClass: string;
  /** Key R3 — the rising price of output, read only within `metered`. */
  readonly outputPriceUsd?: number;
  /** Key R4 — whether a quota limit signal was seen. */
  readonly limitSignalSeen: boolean;
  /** Key R5 — the context window in tokens, or null when unknown. */
  readonly windowTokens: number | null;
  /** Key R6 — the model id of the candidate, or null for its own model. */
  readonly modelId: string | null;
};

/** The decision of one comparison, as the table evaluator records it. */
export type Comparison = Decision & { readonly first: string; readonly second: string };

/**
 * The decision table derived from the data: one point `compare` whose rows
 * carry the rule id of every key of the data, for the difference -1 (the
 * first stands before the second) and +1 (after it), and whose default row
 * is the default of the data (`R0-equal`, `next-key`).
 */
const DERIVED_TABLE: LoadedTable = (() => {
  const rows: TableRow[] = [];
  for (const key of RANKING_TABLE.keys) {
    // The rows of a key fire only for that key, so the rule id of the
    // decision names the key that decided (F124-FR-040).
    const forThisKey = (diff: number) => ({
      op: "and",
      of: [
        { op: "equal", signal: "key", value: key.ruleId },
        { op: "equal", signal: "diff", value: diff },
      ],
    });
    rows.push({ ruleId: key.ruleId, when: forThisKey(-1), choice: "first" });
    rows.push({ ruleId: key.ruleId, when: forThisKey(1), choice: "second" });
  }
  rows.push({ ruleId: RANKING_TABLE.default.ruleId, choice: RANKING_TABLE.default.choice });
  return {
    schema: TABLE_SCHEMA_ID,
    id: RANKING_TABLE.id,
    version: RANKING_TABLE.version,
    points: {
      compare: {
        signals: { diff: "number", key: "string" },
        choices: ["first", "second", RANKING_TABLE.default.choice],
      },
    },
    rows: { compare: rows },
  };
})();

/** The ordinal of a value in the order the data gives for one key. */
function ordinal(order: readonly unknown[], value: unknown): number {
  const index = order.findIndex((entry) =>
    Array.isArray(entry) ? (entry as readonly unknown[]).includes(value) : entry === value,
  );
  return index;
}

/**
 * The difference of two candidates on one key, from the order the data
 * gives: -1 when the first stands before the second, 1 when after, 0 when
 * the key does not decide. `within` orders the members of one class (key
 * R3: the rising price of output within `metered`).
 */
function differenceOn(
  key: RankingTable["keys"][number],
  a: RankingSignal,
  b: RankingSignal,
): -1 | 0 | 1 {
  const signal = key.signal;
  if (Array.isArray(signal)) {
    // Key R6 — the harness id and then the model id, in byte order.
    const left = [a.harness, a.modelId ?? ""];
    const right = [b.harness, b.modelId ?? ""];
    for (let i = 0; i < left.length; i++) {
      if (left[i]! < right[i]!) return -1;
      if (left[i]! > right[i]!) return 1;
    }
    return 0;
  }
  const name = signal as string;
  if (name === "limitSignalSeen") {
    // Key R4 — no limit signal seen before one seen (false first).
    const left = a.limitSignalSeen ? 1 : 0;
    const right = b.limitSignalSeen ? 1 : 0;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (name === "windowTokens") {
    // Key R5 — larger first; an unknown window stands after a known one.
    const left = a.windowTokens ?? -1;
    const right = b.windowTokens ?? -1;
    return left === right ? 0 : left > right ? -1 : 1;
  }
  if (name === "costClass") {
    // Key R3 — the group of the data first; within `metered`, the rising
    // price of output.
    const groupLeft = ordinal(key.order, a.costClass);
    const groupRight = ordinal(key.order, b.costClass);
    if (groupLeft !== groupRight) return groupLeft < groupRight ? -1 : 1;
    if (a.costClass === "metered" && b.costClass === "metered") {
      const priceLeft = a.outputPriceUsd;
      const priceRight = b.outputPriceUsd;
      if (priceLeft !== undefined && priceRight !== undefined && priceLeft !== priceRight) {
        return priceLeft < priceRight ? -1 : 1;
      }
    }
    return 0;
  }
  // Keys R1 (form) and R2 (state) — the order the data gives.
  const left = ordinal(key.order, (a as unknown as Record<string, unknown>)[name]);
  const right = ordinal(key.order, (b as unknown as Record<string, unknown>)[name]);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Compare two candidates: walk the keys of the data in order, stop at the
 * first difference, and let the table evaluator of the kernel decide. The
 * decision carries the rule id of the key that decided and the id and the
 * version of the table (F124-FR-040).
 */
export function compareCandidates(a: RankingSignal, b: RankingSignal): Comparison {
  for (const key of RANKING_TABLE.keys) {
    const diff = differenceOn(key, a, b);
    if (diff === 0) continue;
    const decision = evaluateTable(DERIVED_TABLE, "compare", { diff, key: key.ruleId });
    return { ...decision, first: a.harness, second: b.harness };
  }
  const decision = evaluateTable(DERIVED_TABLE, "compare", { diff: 0, key: "none" });
  return { ...decision, first: a.harness, second: b.harness };
}

/** The ranking: the ordered candidates and the decision of every comparison. */
export type Ranking = {
  readonly order: readonly RankingSignal[];
  readonly decisions: readonly Comparison[];
};

/**
 * Rank the candidates: a stable sort by pairwise comparison, every
 * comparison a decision of the table. Ties keep the order of the registry
 * (the default of the data, `R0-equal`).
 */
export function rankCandidates(signals: readonly RankingSignal[]): Ranking {
  const decisions: Comparison[] = [];
  const order = [...signals].sort((a, b) => {
    const comparison = compareCandidates(a, b);
    decisions.push(comparison);
    if (comparison.choice === "first") return -1;
    if (comparison.choice === "second") return 1;
    return 0;
  });
  return { order, decisions };
}

/**
 * The key that decided a pair, from its decision record: the rule id the
 * evaluator fired, or null for the default (`R0-equal`).
 */
export function decidingRuleId(comparison: Comparison): string | null {
  return comparison.choice === "next-key" ? null : comparison.ruleId;
}
