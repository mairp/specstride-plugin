/**
 * T010 — the `parity` profile of this feature (F110-FR-008, F110-FR-013).
 *
 * The profile is data: `data/profile-parity.json` holds one row per switch of
 * the schema, with the value the switch takes under `parity` or the reserved
 * literal that says the profile sets nothing for it. The generator
 * `tools/profile-parity-gen.ts` derives it from the catalogue.
 *
 * What this module adds is the rules the data must obey and the one thing
 * selecting the profile does:
 *
 * - F110-FR-008: every switch of the schema has a row; no row names a key that
 *   is not in the schema; the five reserved literals of closed set 239 are the
 *   only non-value entries.
 * - F110-FR-013: the profile is selected by the key `profile`, at flag,
 *   environment or user rank — never by a project file, which the catalogue
 *   enforces through the layers `F E U` of that key. Selecting `parity` supplies
 *   the value of every switch of the profile as the default of that switch, at
 *   the rank of the default (rank 8), and does nothing else, so an explicit
 *   setting at ranks 1 to 7 beats it (CQ-157).
 */
import { rankOfLayer, type Offer } from "@specstride/contracts/envelope/config";

import profileData from "../../data/profile-parity.json" with { type: "json" };
import { CATALOGUE, SWITCH_KEYS, catalogueEntry, matchCatalogueKey } from "./catalogue.ts";
import { RESERVED_PARITY_LITERALS, type ReservedLiteral } from "./types.ts";

/** The name of the profile this package ships. */
export const PROFILE_NAME = "parity";

/** The schema id of a profile file (annex X §X.7). */
export const PROFILE_SCHEMA_ID = "specstride.profile/1";

/** The key that selects a profile (F110-FR-013). */
export const PROFILE_KEY = "profile";

/** The rank the profile stands at: the rank of the default, 8 (CQ-157). */
export const PROFILE_RANK: number = rankOfLayer["default"];

/** One row of `data/profile-parity.json`. */
export interface ProfileParityRow {
  /** The configuration key of the switch. */
  readonly key: string;
  /** The rows of annex X §X.7 the key belongs to. */
  readonly annexRows: readonly number[];
  /** The column "Under `parity`" of those rows, as the annex writes it. */
  readonly annexParity: readonly string[];
  /** The cell "Under `parity`" of the catalogue, verbatim. */
  readonly cell: string;
  /** True where the profile supplies a value for the key. */
  readonly sets: boolean;
  /** The value, where `sets` is true. */
  readonly value?: unknown;
  /** The reserved literal, where `sets` is false. */
  readonly literal?: string;
  /** The cell "Default" of the catalogue, verbatim. */
  readonly default: string;
  /** The features that own the meaning of the key. */
  readonly owners: readonly string[];
}

type RawProfile = {
  schema: string;
  profile: string;
  switchCount: number;
  rows: ProfileParityRow[];
};

const RAW = profileData as RawProfile;

/** The schema id the shipped profile carries. */
export const SHIPPED_SCHEMA_ID: string = RAW.schema;

/** Every row of the shipped profile, in the order of the catalogue. */
export const PROFILE_ROWS: readonly ProfileParityRow[] = Object.freeze(
  RAW.rows.map((r) => Object.freeze({ ...r })),
);

/** The number of switches the profile holds a row for. */
export const PROFILE_SWITCH_COUNT: number = RAW.switchCount;

const BY_KEY: ReadonlyMap<string, ProfileParityRow> = new Map(PROFILE_ROWS.map((r) => [r.key, r]));

/** The row of a key, or `undefined` where the profile holds none. */
export function profileRowOfKey(key: string): ProfileParityRow | undefined {
  return BY_KEY.get(key);
}

/**
 * F110-FR-008 — a switch of the schema with no row in the profile. The static
 * test CT-110-107 fails when this is not empty.
 */
export function switchesWithoutARow(
  rows: readonly ProfileParityRow[] = PROFILE_ROWS,
  switchKeys: readonly string[] = SWITCH_KEYS,
): readonly string[] {
  const held = new Set(rows.map((r) => r.key));
  return Object.freeze(switchKeys.filter((k) => !held.has(k)));
}

/**
 * F110-FR-008 — a row of the profile that names a key the schema does not hold.
 * The static test CT-110-107 fails when this is not empty.
 */
export function rowsWithoutAKey(
  rows: readonly ProfileParityRow[] = PROFILE_ROWS,
): readonly string[] {
  return Object.freeze(
    rows.filter((r) => matchCatalogueKey(r.key) === undefined).map((r) => r.key),
  );
}

/**
 * F110-FR-008 — a row whose non-value entry is not one of the five reserved
 * literals of closed set 239. An unknown entry makes the profile invalid.
 */
export function rowsWithAnUnknownLiteral(
  rows: readonly ProfileParityRow[] = PROFILE_ROWS,
): readonly string[] {
  return Object.freeze(
    rows
      .filter((r) => !r.sets && !RESERVED_PARITY_LITERALS.includes(r.literal as ReservedLiteral))
      .map((r) => r.key),
  );
}

/** Every reserved literal the profile uses, with the keys that carry it. */
export function literalsInUse(): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const r of PROFILE_ROWS) {
    if (r.sets) continue;
    const list = out.get(r.literal ?? "") ?? [];
    list.push(r.key);
    out.set(r.literal ?? "", list);
  }
  return out;
}

/** Every key of the catalogue that is not a switch, and so needs no row. */
export function keysThatAreNotSwitches(): readonly string[] {
  return Object.freeze(CATALOGUE.filter((e) => e.parity.kind === "as-default").map((e) => e.key));
}

/** A profile the package does not ship (F110-FR-013). */
export class UnknownProfileError extends Error {
  readonly profile: string;
  constructor(profile: string) {
    super(
      `the profile \`${profile}\` is not a profile this product ships. ` +
        `The shipped profiles are \`${PROFILE_NAME}\``,
    );
    this.name = "UnknownProfileError";
    this.profile = profile;
  }
}

/** What selecting a profile supplies (F110-FR-013). */
export interface ProfileSelection {
  /** The profile that was selected. */
  readonly profile: string;
  /**
   * One offer per switch the profile supplies a value for, at the layer
   * `default` — rank 8 — so that every explicit setting beats it.
   */
  readonly offers: ReadonlyMap<string, Offer>;
  /**
   * The switches the profile leaves at their default, with the reserved literal
   * that says so. The profile supplies no value for these.
   */
  readonly leftAtDefault: ReadonlyMap<string, string>;
}

/**
 * F110-FR-013 — select a profile. Selecting `parity` supplies the value of every
 * switch of the profile as the default of that switch, at the rank of the
 * default, and does nothing else: no key outside `PROFILE_ROWS` is touched, and
 * no rank above 8 is written.
 */
export function selectProfile(profile: string): ProfileSelection {
  if (profile !== PROFILE_NAME) throw new UnknownProfileError(profile);
  const offers = new Map<string, Offer>();
  const leftAtDefault = new Map<string, string>();
  for (const row of PROFILE_ROWS) {
    if (row.sets) {
      offers.set(row.key, Object.freeze({ layer: "default", value: row.value }));
    } else {
      leftAtDefault.set(row.key, row.literal ?? "");
    }
  }
  return Object.freeze({ profile, offers, leftAtDefault });
}

/**
 * F110-FR-013, last sentence — the layers that may select a profile. The
 * catalogue gives `profile` the layers `F E U`, so a project file is refused for
 * it by the ordinary layer rule of F110-FR-001; this function names the rule
 * where a caller wants to ask before it reads a file.
 */
export function profileMayBeSelectedBy(layer: "F" | "E" | "P" | "U" | "C"): boolean {
  return catalogueEntry(PROFILE_KEY)?.layers.includes(layer) ?? false;
}
