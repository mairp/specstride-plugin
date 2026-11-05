/**
 * T072 — the `parity` profile as data with a loader (annex X, §X.7;
 * F100-FR-210; F100-SC-006).
 *
 * The profile is data: one row per switch. Selecting the profile sets every
 * key of every row to its value of the column "Under `parity`" and does
 * nothing else. The values stand at the lowest rank of configuration, as the
 * default of each switch, so that a fixture can still set a key (CQ-157).
 */
import profileData from "../../data/parity-profile.json" with { type: "json" };

/** One row of the table of §X.7, as `data/parity-profile.json` holds it. */
export type ProfileRow = {
  /** A row is identified by its number (§X.7). */
  readonly number: number;
  /** The switch the row names. */
  readonly switch: string;
  /** The configuration keys of the row; a row may carry more than one. */
  readonly keys: readonly string[];
  /** The `Key` cell as the annex writes it, prose and all. */
  readonly keyNote: string;
  /** The default of the switch. */
  readonly default: string;
  /** The value under `parity`. */
  readonly parity: string;
  /** The feature that owns the switch. */
  readonly owner: string;
  /** The rows of the divergence register the switch answers to. */
  readonly registerRows: readonly string[];
};

type RawRow = {
  number: number;
  switch: string;
  key: string;
  keys: string[];
  keyNote: string;
  default: string;
  parity: string;
  owner: string;
  registerRows: string[];
};

/** The name of the profile this file ships (§X.7). */
export const PROFILE_NAME: string = (profileData as { profile: string }).profile;

/** The schema id of the profile (§X.7). */
export const SCHEMA_ID = "specstride.profile/1" as const;

/**
 * The literals of the column "Under `parity`" that are reserved (annex X §X.6
 * row 239): a row that carries one of them names no value of a key.
 */
export const RESERVED_LITERALS = ["off", "not used", "baseline", "as-is", "(fixture)"] as const;

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

/** Load the profile from `data/parity-profile.json` (F100-FR-210). */
export function loadProfile(): readonly ProfileRow[] {
  return Object.freeze(
    (profileData as { switches: RawRow[] }).switches.map((row) =>
      Object.freeze({
        number: row.number,
        switch: row.switch,
        keys: Object.freeze(row.keys.map(unbacktick).filter((k) => k !== "")),
        keyNote: row.keyNote,
        default: unbacktick(row.default),
        parity: unbacktick(row.parity),
        owner: row.owner,
        registerRows: Object.freeze([...row.registerRows]),
      }),
    ),
  );
}

/** Every row of the table of §X.7, in the order of the annex. */
export const profileRows: readonly ProfileRow[] = loadProfile();

/** The row of a number, or `undefined` where the profile holds none. */
export function profileRow(number: number): ProfileRow | undefined {
  return profileRows.find((r) => r.number === number);
}

/** Every row that owns a configuration key. */
export function rowsWithKeys(): readonly ProfileRow[] {
  return Object.freeze(profileRows.filter((r) => r.keys.length > 0));
}

/** The row that owns a configuration key, or `undefined`. */
export function rowOfKey(key: string): ProfileRow | undefined {
  return profileRows.find((r) => r.keys.includes(key));
}

/** A configuration as `applyProfile` reads and writes it. */
export type Configuration = Record<string, unknown>;

/** One key the profile set, with the row it came from. */
export type AppliedKey = {
  readonly key: string;
  readonly value: string;
  readonly row: number;
};

/** What `applyProfile` did. */
export type ProfileApplication = {
  /** The configuration with every key of every row set to its `parity` value. */
  readonly config: Configuration;
  /** The keys the profile set. */
  readonly applied: readonly AppliedKey[];
  /** The rows that name no key: they are read by the feature that owns them. */
  readonly rowsWithoutKeys: readonly number[];
};

/**
 * F100-FR-210 — selecting the profile sets every key of every row to its
 * value under `parity` and does nothing else.
 */
export function applyProfile(
  config: Configuration = {},
  rows: readonly ProfileRow[] = profileRows,
): ProfileApplication {
  const out: Configuration = { ...config };
  const applied: AppliedKey[] = [];
  const without: number[] = [];
  for (const row of rows) {
    if (row.keys.length === 0) {
      without.push(row.number);
      continue;
    }
    for (const key of row.keys) {
      out[key] = row.parity;
      applied.push({ key, value: row.parity, row: row.number });
    }
  }
  return Object.freeze({
    config: out,
    applied: Object.freeze(applied),
    rowsWithoutKeys: Object.freeze(without),
  });
}

/**
 * F100-FR-211 — the second suite of the oracle is the profile `parity` with
 * row 1 set to `micro` and nothing else changed.
 */
export const SECOND_SUITE_ROW = 1 as const;
export const SECOND_SUITE_VALUE = "micro" as const;

export function secondSuiteRows(): readonly ProfileRow[] {
  return Object.freeze(
    profileRows.map((row) =>
      row.number === SECOND_SUITE_ROW ? Object.freeze({ ...row, parity: SECOND_SUITE_VALUE }) : row,
    ),
  );
}

/** The second suite as a configuration (F100-FR-211). */
export function applySecondSuite(config: Configuration = {}): ProfileApplication {
  return applyProfile(config, secondSuiteRows());
}

/** The profile is selected by ordinary configuration (F100-FR-210). */
export const SELECTED_BY = "configuration" as const;
export const PROFILE_KEY = "profile" as const;
