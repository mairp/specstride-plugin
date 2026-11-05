/**
 * T016 — the merge through the eight ranks (F110-FR-014, F110-FR-016).
 *
 * F110-FR-014: each key is resolved through the eight ranks of annex X §X.2,
 * highest first — contract pin, flag, run snapshot (on `resume` only),
 * environment, project file, user file, learned value, default. Between two
 * flags for one key the last wins. The default is the built-in value, the value
 * detected from the machine, or the value of the profile.
 *
 * F110-FR-016: a list replaces and never concatenates, with one exception:
 * entries of `harnesses` merge by id, and for one id the entry of highest
 * precedence wins in the order declared by the consumer, tested harness
 * adapter, bundled descriptor, detected.
 *
 * The ranks themselves are feature 100's contract (`@specstride/contracts`,
 * `envelope/config`): this module never restates them, it reads
 * `RANK_LAYERS` and `effectiveRank` and adds what feature 110 owns — which
 * offer of one rank wins, what a list does, and how the table of harnesses
 * merges.
 */
import {
  KEY_CLASS_DEFAULT,
  RANK_LAYERS,
  effectiveRank,
  rankOfLayer,
  type KeyClass,
  type RankLayer,
} from "@specstride/contracts/envelope/config";

import { catalogueEntry, matchCatalogueKey, CATALOGUE } from "../schema/catalogue.ts";
import { PROFILE_NAME, PROFILE_KEY, selectProfile } from "../schema/profile.ts";
import {
  derivedEnvironmentName,
  environmentNameOf,
  parseSetFlag,
  classifyKey,
} from "../schema/spelling.ts";
import { validateKeyValue } from "../schema/validate.ts";
import {
  ConfigValueError,
  UnknownKeyError,
  type KeyEntry,
  type LayerCode,
} from "../schema/types.ts";
import { aliasOffers, type AliasConflictError } from "./alias.ts";
import { type LoadedConfigFile } from "./files.ts";
import {
  filterProjectOffers,
  filterUserFileOnly,
  projectValuesOfFile,
  type ProjectFilterContext,
  type TrustOutcome,
} from "./trust.ts";

/**
 * Every reason the launch is refused over a configuration value: a type or
 * range error, an unknown key (F110-FR-001, F110-FR-002), or two environment
 * names that reach one key with differing values (F110-FR-020, T026).
 */
export type ConfigurationError = ConfigValueError | UnknownKeyError | AliasConflictError;

/** The eight ranks of annex X §X.2, highest first (F110-FR-014). */
export const EIGHT_RANKS: readonly RankLayer[] = RANK_LAYERS;

/** How many ranks a key is resolved through: eight (F110-FR-014). */
export const RANK_COUNT = 8 as const;

/** F110-FR-016, first sentence — a list replaces and never concatenates. */
export const LISTS_REPLACE = true as const;

/** F110-FR-016, second sentence — the one namespace that merges instead. */
export const THE_ONE_LIST_EXCEPTION = "harnesses" as const;

/** The rank layer that each `Layers` code of §K.1 stands for, for an offer. */
export const RANK_LAYER_OF_CODE: Readonly<Record<LayerCode, RankLayer>> = Object.freeze({
  C: "launch-contract-pin",
  F: "flag",
  E: "environment",
  P: "project-configuration",
  U: "user-configuration",
});

/** The `Layers` code of §K.1 that each rank layer stands for, where it has one. */
export const CODE_OF_RANK_LAYER: Readonly<Partial<Record<RankLayer, LayerCode>>> = Object.freeze({
  "launch-contract-pin": "C",
  flag: "F",
  environment: "E",
  "project-configuration": "P",
  "user-configuration": "U",
});

/**
 * The class of a key in the run snapshot, as the class the ranks need
 * (annex B §B.12, row 76 of annex X §X.6): `p` is `pinned`, `t` is `tunable`,
 * and a key without a class is read as `pinned`.
 */
export function keyClassOf(key: string): KeyClass {
  const entry = matchCatalogueKey(key)?.entry;
  if (entry === undefined) return KEY_CLASS_DEFAULT;
  if (entry.snapshot === "t") return "tunable";
  if (entry.snapshot === "p") return "pinned";
  return KEY_CLASS_DEFAULT;
}

/** One value offered for one key by one rank. */
export interface ConfigOffer {
  readonly key: string;
  /** The rank layer of annex X §X.2 that offers the value. */
  readonly layer: RankLayer;
  /** The value, already read into the type of the key. */
  readonly value: unknown;
  /**
   * Where inside the rank the value came from, for the ranks that have more
   * than one place: the path of the file, the name of the variable, the flag as
   * the consumer wrote it (F110-FR-024).
   */
  readonly place?: string | undefined;
  /** For a learned value, the id of its decision (F110-FR-015, F110-FR-024). */
  readonly decisionId?: string | undefined;
  /** For a default the profile supplied, the name of the profile (F110-FR-024). */
  readonly profile?: string | undefined;
  /**
   * The position of the offer among the offers of its own rank. Two flags for
   * one key are ordered by this, and the last wins (F110-FR-014). With none,
   * the position in the list of offers decides.
   */
  readonly order?: number | undefined;
}

/** One value a higher rank shadowed (F110-FR-024, F110-FR-026). */
export interface ShadowedValue {
  readonly layer: RankLayer;
  readonly rank: number;
  readonly value: unknown;
  readonly place?: string | undefined;
  readonly decisionId?: string | undefined;
  readonly profile?: string | undefined;
}

/** The effective value of one key, with the rank it came from and what it hid. */
export interface MergedValue {
  readonly key: string;
  readonly value: unknown;
  /** The rank layer the value came from. */
  readonly source: RankLayer;
  /** The rank number of that layer, as the run snapshot records it. */
  readonly rank: number;
  /** `pinned` or `tunable` (annex B §B.12). */
  readonly class: KeyClass;
  readonly place?: string | undefined;
  readonly decisionId?: string | undefined;
  readonly profile?: string | undefined;
  /** Every value a higher rank shadowed, by rank, highest first. */
  readonly shadowed: readonly ShadowedValue[];
}

/** What the caller knows while it merges. */
export interface MergeOptions {
  /** True on `resume`, where the run snapshot and a tunable key move. */
  readonly onResume?: boolean | undefined;
  /** The class of the key, where the caller knows it better than the catalogue. */
  readonly class?: KeyClass | undefined;
}

/** The rank number an offer stands at, or `undefined` where it stands at none. */
export function rankOfOffer(offer: ConfigOffer, options: MergeOptions = {}): number | undefined {
  const cls = options.class ?? keyClassOf(offer.key);
  return effectiveRank(offer.layer, { class: cls, onResume: options.onResume });
}

/**
 * F110-FR-014 — resolve one key through the eight ranks, highest first.
 *
 * An offer whose value is `undefined` is no offer. Of two offers at one rank the
 * last wins, which is what makes the last of two flags for one key win; `order`
 * fixes "last" where the caller does not pass the offers in order. A list value
 * is taken whole from the winning rank and is never concatenated with a lower
 * one (F110-FR-016, `LISTS_REPLACE`).
 */
export function mergeKey(
  key: string,
  offers: readonly ConfigOffer[],
  options: MergeOptions = {},
): MergedValue | undefined {
  const cls = options.class ?? keyClassOf(key);
  const ranked = offers
    .filter((o) => o.key === key && o.value !== undefined)
    .map((offer, index) => ({
      offer,
      rank: rankOfOffer(offer, { ...options, class: cls }),
      order: offer.order ?? index,
    }))
    .filter((r): r is { offer: ConfigOffer; rank: number; order: number } => r.rank !== undefined);
  if (ranked.length === 0) return undefined;
  // Highest rank first (1 is the highest); of two offers at one rank the last.
  const sorted = [...ranked].sort((a, b) =>
    a.rank === b.rank ? b.order - a.order : a.rank - b.rank,
  );
  const winner = sorted[0] as { offer: ConfigOffer; rank: number; order: number };
  const shadowed: ShadowedValue[] = sorted.slice(1).map((r) =>
    Object.freeze({
      layer: r.offer.layer,
      rank: r.rank,
      value: r.offer.value,
      ...(r.offer.place === undefined ? {} : { place: r.offer.place }),
      ...(r.offer.decisionId === undefined ? {} : { decisionId: r.offer.decisionId }),
      ...(r.offer.profile === undefined ? {} : { profile: r.offer.profile }),
    }),
  );
  return Object.freeze({
    key,
    value: winner.offer.value,
    source: winner.offer.layer,
    rank: winner.rank,
    class: cls,
    ...(winner.offer.place === undefined ? {} : { place: winner.offer.place }),
    ...(winner.offer.decisionId === undefined ? {} : { decisionId: winner.offer.decisionId }),
    ...(winner.offer.profile === undefined ? {} : { profile: winner.offer.profile }),
    shadowed: Object.freeze(shadowed),
  });
}

/** F110-FR-014 — resolve every key that any rank offers a value for. */
export function mergeConfiguration(
  offers: readonly ConfigOffer[],
  options: MergeOptions = {},
): ReadonlyMap<string, MergedValue> {
  const byKey = new Map<string, ConfigOffer[]>();
  offers.forEach((offer, index) => {
    const list = byKey.get(offer.key) ?? [];
    list.push(offer.order === undefined ? { ...offer, order: index } : offer);
    byKey.set(offer.key, list);
  });
  const out = new Map<string, MergedValue>();
  for (const [key, list] of byKey) {
    const merged = mergeKey(key, list, options);
    if (merged !== undefined) out.set(key, merged);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * F110-FR-016 — the one exception: `harnesses` merges by id.
 * ------------------------------------------------------------------ */

/**
 * The four origins of an entry of `harnesses`, highest precedence first
 * (F110-FR-016, second sentence).
 */
export const HARNESS_ENTRY_ORIGINS = [
  "consumer-declared",
  "tested-adapter",
  "bundled-descriptor",
  "detected",
] as const;
export type HarnessEntryOrigin = (typeof HARNESS_ENTRY_ORIGINS)[number];

/** The precedence of an origin: 0 is the highest (F110-FR-016). */
export function precedenceOfOrigin(origin: HarnessEntryOrigin): number {
  return HARNESS_ENTRY_ORIGINS.indexOf(origin);
}

/** One entry of `harnesses`, offered for one id by one origin. */
export interface HarnessEntryOffer {
  readonly id: string;
  readonly entry: Readonly<Record<string, unknown>>;
  readonly origin: HarnessEntryOrigin;
  /** The rank that carried the entry, where one did. */
  readonly layer?: RankLayer | undefined;
  readonly place?: string | undefined;
}

/** The entry of `harnesses` that won for one id, and the entries it hid. */
export interface MergedHarnessEntry {
  readonly id: string;
  readonly entry: Readonly<Record<string, unknown>>;
  readonly origin: HarnessEntryOrigin;
  readonly layer?: RankLayer | undefined;
  readonly place?: string | undefined;
  readonly shadowed: readonly HarnessEntryOffer[];
}

/**
 * F110-FR-016 — merge the entries of `harnesses` by id.
 *
 * The table does not replace: an id that only a lower place holds survives a
 * higher place that does not hold it. For one id the entry of highest
 * precedence wins, in the order of `HARNESS_ENTRY_ORIGINS`; two entries of one
 * origin are decided by the ranks, and then by the order they were offered in.
 */
export function mergeHarnessEntries(
  offers: readonly HarnessEntryOffer[],
): ReadonlyMap<string, MergedHarnessEntry> {
  const byId = new Map<string, { offer: HarnessEntryOffer; order: number }[]>();
  offers.forEach((offer, order) => {
    const list = byId.get(offer.id) ?? [];
    list.push({ offer, order });
    byId.set(offer.id, list);
  });
  const out = new Map<string, MergedHarnessEntry>();
  for (const [id, list] of byId) {
    const sorted = [...list].sort((a, b) => {
      const byOrigin = precedenceOfOrigin(a.offer.origin) - precedenceOfOrigin(b.offer.origin);
      if (byOrigin !== 0) return byOrigin;
      const rankA = a.offer.layer === undefined ? RANK_COUNT + 1 : rankOfLayer[a.offer.layer];
      const rankB = b.offer.layer === undefined ? RANK_COUNT + 1 : rankOfLayer[b.offer.layer];
      if (rankA !== rankB) return rankA - rankB;
      return b.order - a.order;
    });
    const winner = (sorted[0] as { offer: HarnessEntryOffer }).offer;
    out.set(
      id,
      Object.freeze({
        id,
        entry: winner.entry,
        origin: winner.origin,
        ...(winner.layer === undefined ? {} : { layer: winner.layer }),
        ...(winner.place === undefined ? {} : { place: winner.place }),
        shadowed: Object.freeze(sorted.slice(1).map((r) => r.offer)),
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The offers of each rank.
 * ------------------------------------------------------------------ */

/** A learned value and the id of the decision that set it (F110-FR-024). */
export interface LearnedValue {
  readonly value: unknown;
  readonly decisionId: string;
}

/** What the loader reads to build the offers of the eight ranks. */
export interface LayerSources {
  /** Rank 1 — the pins of the launch contract, by key. */
  readonly pins?: Readonly<Record<string, unknown>> | undefined;
  /** Rank 2 — the command line, in the order the consumer wrote it. */
  readonly argv?: readonly string[] | undefined;
  /** Rank 3 — the run snapshot of the run being continued, by key. */
  readonly snapshot?: Readonly<Record<string, unknown>> | undefined;
  /** True on `resume`, where the snapshot and a tunable key move. */
  readonly onResume?: boolean | undefined;
  /** Rank 4 — the environment, by variable name. */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  /** The alias table of §K.8, key to variable name; T026 supplies the whole table. */
  readonly aliases?: ReadonlyMap<string, string> | undefined;
  /**
   * T026 — read the environment through the whole alias table of §K.8 and
   * annex X §X.8 (`src/load/alias.ts`) instead of the derived names of §K.2
   * rule 3 with an optional `aliases` map. The table is what carries the
   * many-to-many rows, the order relations of the notes and the conflict
   * refusal of F110-FR-020.
   */
  readonly aliasTable?: boolean | undefined;
  /** Rank 5 — the project file, as the loader of T011 read it. */
  readonly project?: LoadedConfigFile | undefined;
  /** Rank 6 — the user file, as the loader of T011 read it. */
  readonly user?: LoadedConfigFile | undefined;
  /** Rank 7 — the learned values, by key. */
  readonly learned?: Readonly<Record<string, LearnedValue>> | undefined;
  /** The resolved `learning.mode`; a learned value applies only under `apply`. */
  readonly learningMode?: string | undefined;
  /** The paths the project file may narrow a declared scope against (F110-FR-019). */
  readonly declaredScopes?: Readonly<Record<string, readonly string[]>> | undefined;
}

/** One `--set` flag or short flag of §K.10, read into an offer. */
export interface FlagOffer extends ConfigOffer {
  readonly layer: "flag";
}

/** The short flags of the baseline, as §K.10 lists them (F110-FR-021). */
export const SHORT_FLAGS: readonly {
  readonly flag: string;
  readonly key: string;
  readonly takesAValue: boolean;
  /** The value the flag sets where it takes none. */
  readonly value?: unknown;
}[] = Object.freeze([
  Object.freeze({ flag: "--telemetry", key: "telemetry.enabled", takesAValue: false, value: true }),
  Object.freeze({ flag: "--loki-url", key: "telemetry.loki.url", takesAValue: true }),
  Object.freeze({ flag: "--otel", key: "telemetry.otel.enabled", takesAValue: false, value: true }),
  Object.freeze({ flag: "--otel-url", key: "telemetry.otel.url", takesAValue: true }),
]);

/**
 * F110-FR-021 — the offers of rank 2: every `--set <path>=<value>` of the
 * command line, and the short flags of §K.10 that the baseline has.
 *
 * `--set` reaches every key of the catalogue, including a key of the class
 * widening, and it is repeatable; the order of the offers is the order of the
 * command line, so `mergeKey` lets the last one win. `-j` is the one short flag
 * whose key depends on the other flags (the rule of §K.10, F128-FR-005), so it
 * is read after the two URL flags.
 */
export function flagOffers(argv: readonly string[]): {
  offers: readonly FlagOffer[];
  errors: readonly (ConfigValueError | UnknownKeyError)[];
} {
  const offers: FlagOffer[] = [];
  const errors: (ConfigValueError | UnknownKeyError)[] = [];
  let sawLokiUrl = false;
  let sawOtelUrl = false;
  let sawStreamJson = false;
  const push = (key: string, raw: unknown, place: string, fromText: boolean): void => {
    const verdict = validateKeyValue(key, raw, "F", { place, fromText });
    if (verdict.ok) {
      offers.push(
        Object.freeze({ key, layer: "flag", value: verdict.value, place, order: offers.length }),
      );
    } else {
      errors.push(verdict.error);
    }
  };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;
    if (argument === "--set" || argument.startsWith("--set=")) {
      const body = argument === "--set" ? (argv[i + 1] ?? "") : argument;
      if (argument === "--set") i += 1;
      const parsed = parseSetFlag(body);
      if (parsed === undefined) continue;
      push(parsed.key, parsed.rawValue, `--set ${body.replace(/^--set=?/, "")}`, true);
      continue;
    }
    const short = SHORT_FLAGS.find((s) => s.flag === argument || argument.startsWith(`${s.flag}=`));
    if (short !== undefined) {
      if (short.takesAValue) {
        const raw = argument.includes("=")
          ? argument.slice(argument.indexOf("=") + 1)
          : (argv[(i += 1)] ?? "");
        if (short.key === "telemetry.loki.url") sawLokiUrl = true;
        if (short.key === "telemetry.otel.url") sawOtelUrl = true;
        push(short.key, raw, argument, true);
      } else {
        push(short.key, short.value, argument, false);
      }
      continue;
    }
    if (argument === "-j" || argument === "--stream-json") sawStreamJson = true;
  }
  // §K.10, the rule of the telemetry flags (F128-FR-005): `-j` sets
  // `telemetry.enabled` unless a URL flag was given, and then each URL flag
  // decides its own key.
  if (sawStreamJson) {
    if (sawLokiUrl || sawOtelUrl) {
      push("telemetry.enabled", sawLokiUrl, "-j", false);
      push("telemetry.otel.enabled", sawOtelUrl, "-j", false);
    } else {
      push("telemetry.enabled", true, "-j", false);
    }
  }
  return { offers: Object.freeze(offers), errors: Object.freeze(errors) };
}

/** The key each environment name of the catalogue reaches (§K.2 rule 3, §K.8). */
export function environmentNameIndex(
  aliases: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const entry of CATALOGUE) {
    if (entry.isTemplate) continue;
    index.set(environmentNameOf(entry.key, aliases), entry.key);
  }
  return index;
}

/** The offers of rank 4, and every `SPECSTRIDE_` name that reaches no key. */
export function environmentOffers(
  environment: Readonly<Record<string, string | undefined>>,
  aliases: ReadonlyMap<string, string> = new Map(),
): {
  offers: readonly ConfigOffer[];
  errors: readonly (ConfigValueError | UnknownKeyError)[];
  /** The `SPECSTRIDE_` names that reach no key of the catalogue. */
  unknownNames: readonly string[];
} {
  const index = environmentNameIndex(aliases);
  const offers: ConfigOffer[] = [];
  const errors: (ConfigValueError | UnknownKeyError)[] = [];
  const unknownNames: string[] = [];
  for (const [name, text] of Object.entries(environment)) {
    if (text === undefined) continue;
    if (!name.startsWith("SPECSTRIDE_")) continue;
    const key = index.get(name);
    if (key === undefined) {
      unknownNames.push(name);
      continue;
    }
    const verdict = validateKeyValue(key, text, "E", { place: name, fromText: true });
    if (verdict.ok) {
      offers.push(Object.freeze({ key, layer: "environment", value: verdict.value, place: name }));
    } else {
      errors.push(verdict.error);
    }
  }
  return {
    offers: Object.freeze(offers),
    errors: Object.freeze(errors),
    unknownNames: Object.freeze(unknownNames),
  };
}

/** The offers of rank 8 that the catalogue itself states (F110-FR-014). */
export function defaultOffers(): readonly ConfigOffer[] {
  const offers: ConfigOffer[] = [];
  for (const entry of CATALOGUE) {
    if (entry.default.kind === "deferred") continue;
    offers.push(
      Object.freeze({
        key: entry.key,
        layer: "default",
        value: entry.default.value,
        place: "the built-in default of the catalogue",
      }),
    );
  }
  return Object.freeze(offers);
}

/**
 * The offers of rank 8 that the selected profile supplies (F110-FR-013,
 * F110-FR-014, third sentence: the default is the built-in value, the value
 * detected from the machine, or the value of the profile).
 */
export function profileOffers(profile: string | undefined): readonly ConfigOffer[] {
  if (profile === undefined) return Object.freeze([]);
  const selection = selectProfile(profile);
  const offers: ConfigOffer[] = [];
  for (const [key, offer] of selection.offers) {
    offers.push(
      Object.freeze({
        key,
        layer: "default",
        value: offer.value,
        place: `the profile \`${profile}\``,
        profile,
      }),
    );
  }
  return Object.freeze(offers);
}

/** The whole resolved configuration of a launch or of `config show`. */
export interface ResolvedConfiguration {
  /** Every key any rank gave a value, with its source and what it shadowed. */
  readonly values: ReadonlyMap<string, MergedValue>;
  /** Every value the launch is refused over (F110-FR-001, F110-FR-002). */
  readonly errors: readonly ConfigurationError[];
  /** What the trust filter did with each key of the project file (F110-FR-017). */
  readonly trust: readonly TrustOutcome[];
  /** The profile in force, where a rank selected one. */
  readonly profile: string | undefined;
  /** The `SPECSTRIDE_` names of the environment that reach no key. */
  readonly unknownEnvironmentNames: readonly string[];
  /**
   * T026 — the names a higher as-is name of the same key shadowed, and the
   * launch messages the alias table itself asks for. Empty where the caller
   * did not ask for the table.
   */
  readonly aliasReading?: ReturnType<typeof aliasOffers> | undefined;
}

/**
 * F110-FR-014 — resolve the whole configuration through the eight ranks.
 *
 * The order of the work is the order the requirements fix: the profile is
 * resolved first, because it supplies defaults at rank 8 (F110-FR-013); the
 * ranks other than the project file are merged next, because the trust filter
 * of F110-FR-018 compares a project value with "the value that the ranks below
 * the project file would give"; the accepted project values then join the merge.
 */
export function resolveConfiguration(sources: LayerSources = {}): ResolvedConfiguration {
  const errors: ConfigurationError[] = [];
  const offers: ConfigOffer[] = [];

  // Rank 1 — the pins of the launch contract.
  for (const [key, value] of Object.entries(sources.pins ?? {})) {
    const verdict = validateKeyValue(key, value, "C", { place: "the launch contract" });
    if (verdict.ok) {
      offers.push(
        Object.freeze({
          key,
          layer: "launch-contract-pin",
          value: verdict.value,
          place: "the launch contract",
        }),
      );
    } else {
      errors.push(verdict.error);
    }
  }

  // Rank 2 — the command line.
  const flags = flagOffers(sources.argv ?? []);
  errors.push(...flags.errors);

  // Rank 3 — the run snapshot. Its place in the ranks depends on the class of
  // the key, which `effectiveRank` of feature 100 decides (F110-FR-022).
  for (const [key, value] of Object.entries(sources.snapshot ?? {})) {
    offers.push(Object.freeze({ key, layer: "run-snapshot", value, place: "the run snapshot" }));
  }

  // Rank 4 — the environment. With `aliasTable` the whole table of §K.8 reads
  // it (T026, F110-FR-020); without it, the derived names of §K.2 rule 3 and
  // the optional key-to-name map the caller passed.
  const reading = sources.aliasTable === true ? aliasOffers(sources.environment ?? {}) : undefined;
  const env = reading ?? environmentOffers(sources.environment ?? {}, sources.aliases);
  errors.push(...env.errors);

  // Rank 6 — the user file.
  if (sources.user !== undefined) {
    for (const [key, value] of sources.user.values) {
      offers.push(
        Object.freeze({
          key,
          layer: "user-configuration",
          value,
          place: sources.user.path,
        }),
      );
    }
    errors.push(...sources.user.errors);
  }

  // Rank 7 — the learned values. F110-FR-015: a learned value applies only when
  // `learning.mode` resolves to `apply`; `phase.ts` owns the knobs it may touch.
  if (sources.learningMode === "apply") {
    for (const [key, learned] of Object.entries(sources.learned ?? {})) {
      offers.push(
        Object.freeze({
          key,
          layer: "learned-value",
          value: learned.value,
          place: `the decision \`${learned.decisionId}\``,
          decisionId: learned.decisionId,
        }),
      );
    }
  }

  // The profile, from the ranks that may select it (F110-FR-013: F E U). It is
  // resolved before the filters run, because the profile decides whether a
  // launch message is printed at all (row 19 of annex X §X.7).
  const profileMerge = mergeKey(PROFILE_KEY, [...offers, ...flags.offers, ...env.offers], {
    onResume: sources.onResume,
  });
  const profile =
    typeof profileMerge?.value === "string" &&
    profileMerge.value !== "" &&
    profileMerge.value !== "unset"
      ? profileMerge.value
      : undefined;

  // F110-FR-019, second sentence — a value of one of the five user-file-only
  // keys that comes from a flag or the environment is ignored, with one launch
  // message and one doctor warning. The filter runs over the two ranks before
  // their offers join the merge, so an ignored value shadows nothing.
  const userFileOnly: TrustOutcome[] = [];
  for (const offer of [...flags.offers, ...env.offers]) {
    const outcome = filterUserFileOnly(offer.key, offer.value, offer.place ?? offer.layer, profile);
    if (outcome.accepted) offers.push(offer);
    else userFileOnly.push(outcome);
  }

  // Rank 8 — the defaults: the built-in value of the catalogue, and the value of
  // the profile where one is selected. The profile is offered first, so that of
  // the two offers at rank 8 the profile's is the later and wins.
  offers.push(...defaultOffers());
  offers.push(...profileOffers(profile === PROFILE_NAME ? profile : undefined));

  // Rank 5 — the project file, through the trust filter (F110-FR-017 to
  // F110-FR-019). The filter needs the value the ranks below rank 5 would give.
  const withoutProject = mergeConfiguration(offers, { onResume: sources.onResume });
  const trust: TrustOutcome[] = [...userFileOnly];
  if (sources.project !== undefined) {
    const context: ProjectFilterContext = {
      path: sources.project.path,
      fromLowerRanks: (key: string): unknown => {
        const merged = withoutProject.get(key);
        if (merged === undefined) return undefined;
        return merged.rank > rankOfLayer["project-configuration"] ? merged.value : undefined;
      },
      ...(profile === undefined ? {} : { profile }),
      ...(sources.declaredScopes === undefined ? {} : { declaredScopes: sources.declaredScopes }),
    };
    const filtered = filterProjectOffers(projectValuesOfFile(sources.project), context);
    trust.push(...filtered.outcomes);
    errors.push(...filtered.errors);
    for (const outcome of filtered.outcomes) {
      if (!outcome.accepted) continue;
      offers.push(
        Object.freeze({
          key: outcome.key,
          layer: "project-configuration",
          value: outcome.value,
          place: sources.project.path,
        }),
      );
    }
    // A type, range or unknown-key error of the project file still refuses the
    // launch: the trust filter decides a key's layer, never its value.
    errors.push(
      ...sources.project.errors.filter(
        (error) => !(error instanceof ConfigValueError && error.reason === "layer-not-allowed"),
      ),
    );
  }

  return Object.freeze({
    values: mergeConfiguration(offers, { onResume: sources.onResume }),
    errors: Object.freeze(errors),
    trust: Object.freeze(trust),
    profile,
    unknownEnvironmentNames: env.unknownNames,
    ...(reading === undefined ? {} : { aliasReading: reading }),
  });
}

/** The catalogue entry of a key, for a caller that merged it. */
export function entryOf(key: string): KeyEntry | undefined {
  return catalogueEntry(key) ?? matchCatalogueKey(key)?.entry;
}

export { classifyKey, derivedEnvironmentName };
