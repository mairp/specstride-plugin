/**
 * T066 — the eight ranks of configuration as data and type, the resolution of
 * one key through the ranks with the rank recorded, and the place of a
 * tunable key on `resume` (annex X, §X.2; F100-FR-201).
 */
import ranksData from "../../data/config-ranks.json" with { type: "json" };
import closedSets from "../../data/closed-sets.json" with { type: "json" };

type RawRank = { Rank: string; Layer: string; Note: string };

/** One rank of the table of §X.2. */
export type ConfigRank = {
  /** 1 (highest) to 8 (lowest). */
  readonly rank: number;
  /** The layer the rank names, as an identifier. */
  readonly layer: RankLayer;
  /** The layer as the annex writes it. */
  readonly label: string;
  /** The note of the annex. */
  readonly note: string;
};

/** The eight layers, highest first (annex X, §X.2). */
export const RANK_LAYERS = [
  "launch-contract-pin",
  "flag",
  "run-snapshot",
  "environment",
  "project-configuration",
  "user-configuration",
  "learned-value",
  "default",
] as const;
export type RankLayer = (typeof RANK_LAYERS)[number];

const RAW = (ranksData as { ranks: RawRank[] }).ranks;

/** The eight ranks of §X.2, highest first. */
export const configRanks: readonly ConfigRank[] = Object.freeze(
  RAW.map((row, i) =>
    Object.freeze({
      rank: Number(row.Rank),
      layer: RANK_LAYERS[i] as RankLayer,
      label: row.Layer,
      note: row.Note,
    }),
  ),
);

/** The rank number of a layer (1 highest). */
export const rankOfLayer: Readonly<Record<RankLayer, number>> = Object.freeze(
  Object.fromEntries(configRanks.map((r) => [r.layer, r.rank])) as Record<RankLayer, number>,
);

/** The closed set of key classes of the run snapshot (row 76 of annex X §X.6). */
type RawSet = { number: number; name: string; literals: string[]; unknownValue: string };
const ROW_76 = (closedSets as { closedSets: RawSet[] }).closedSets.find((r) => r.number === 76);

export const KEY_CLASSES: readonly string[] = Object.freeze([...(ROW_76?.literals ?? [])]);
export type KeyClass = "pinned" | "tunable";
/** A key of the run snapshot without a class is read as `pinned` (row 76). */
export const KEY_CLASS_DEFAULT: KeyClass = "pinned";

/** One value offered at one rank. */
export type Offer = {
  readonly layer: RankLayer;
  readonly value: unknown;
};

/** The resolved value of one key, with the rank it came from (F100-FR-201). */
export type Resolved = {
  readonly key: string;
  readonly value: unknown;
  /** The layer the value came from. */
  readonly source: RankLayer;
  /** The rank number of that layer, as recorded in the run snapshot. */
  readonly rank: number;
  /** `pinned` or `tunable` (annex B, §B.12). */
  readonly class: KeyClass;
};

/** What the caller knows when it resolves a key. */
export type ResolveOptions = {
  /** `pinned` or `tunable`; a key without a class is read as `pinned`. */
  readonly class?: KeyClass | undefined;
  /** True on `resume`, where the run snapshot and a tunable key move. */
  readonly onResume?: boolean | undefined;
};

/**
 * The effective rank of a layer for one key (annex X, §X.2).
 *
 * On `resume` a key of the class `tunable` takes its snapshot value below the
 * environment — between rank 4 and rank 5 — and the run snapshot applies only
 * to keys of the class `pinned`. The run snapshot has the same rank at a
 * launch that continues a run as at `resume` (CQ-075).
 */
export function effectiveRank(layer: RankLayer, options: ResolveOptions = {}): number | undefined {
  const cls = options.class ?? KEY_CLASS_DEFAULT;
  if (layer !== "run-snapshot") return rankOfLayer[layer];
  if (cls === "pinned") return rankOfLayer["run-snapshot"];
  // A tunable key ranks below the environment (rank 4) and above project
  // configuration (rank 5).
  return 4.5;
}

/**
 * F100-FR-201 — configuration is resolved per key through the eight ranks,
 * and the resolved value of every key is recorded with the rank it came from.
 * The as-is file at the install root is not read: it is no layer of the table.
 */
export function resolveKey(
  key: string,
  offers: readonly Offer[],
  options: ResolveOptions = {},
): Resolved | undefined {
  const cls = options.class ?? KEY_CLASS_DEFAULT;
  let best: { offer: Offer; rank: number } | undefined;
  for (const offer of offers) {
    if (offer.value === undefined) continue;
    const rank = effectiveRank(offer.layer, options);
    if (rank === undefined) continue;
    if (best === undefined || rank < best.rank) best = { offer, rank };
  }
  if (best === undefined) return undefined;
  return Object.freeze({
    key,
    value: best.offer.value,
    source: best.offer.layer,
    rank: best.rank,
    class: cls,
  });
}

/** The as-is file at the install root is not read (F100-FR-201). */
export const INSTALL_ROOT_FILE_IS_READ = false as const;

/**
 * The auth tier of a role and of a harness (annex X, §X.2): the key of the
 * role wins where both are set.
 */
export function authTierKey(
  role: string | undefined,
  harnessId: string | undefined,
): string | undefined {
  if (role !== undefined) return `roles.${role}.tier`;
  if (harnessId !== undefined) return `harnesses.${harnessId}.authTier`;
  return undefined;
}
