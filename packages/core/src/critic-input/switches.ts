// Feature 117 (T008) — the seven switches the feature owns, registered
// through the config interface of feature 100 (annex X §X.2: a package that
// owns a switch of §X.7 registers it in the registry of
// `@specstride/contracts/profile/switches`, with its default and its value
// under the `parity` profile; F100-FR-210, F100-FR-211, F100-FR-212).
//
// The rows are 52 to 58 of annex X §X.7, as `data/parity-rows.json`
// (specs/117-critic-grounding-and-prompt/contracts/parity-rows.json, copied
// by T003) records them, status confirmed. Every key below is CONFIRMED in
// the key list of feature 110 (specs/110-config-and-terms/spec.md, the table
// of configuration keys, rows `roles.critic.grounding` to
// `roles.critic.debug` and `prompt.critic.overWindow`,
// `prompt.critic.block_set`): a key here and a key there cannot drift, and
// the unit test `packages/core/test/critic-input/switches.test.ts` holds the
// two against each other.
//
// | Row | Key | Default | Under `parity` | As-is alias |
// |---|---|---|---|---|
// | 52 | `roles.critic.grounding` | true | true, unless the fixture sets it | the flag `--grounding`, default from `SPECSTRIDE_CRITIC_GROUNDING` |
// | 53 | `roles.critic.groundingMaxFiles` | 80 | 80 | `SPECSTRIDE_GROUNDING_MAX_FILES` |
// | 54 | `roles.critic.anchorMaxBytes` | 49152 | 49152 | `SPECSTRIDE_ANCHOR_MAX_BYTES_CEIL` |
// | 55 | `roles.critic.contextTokens` | the window of the model | not set unless the fixture sets it; the as-is fallback of the harness applies (row 28) | `SPECSTRIDE_CRITIC_CONTEXT_TOKENS` |
// | 56 | `roles.critic.debug` | false | false, unless the fixture sets it | the flag `--debug` |
// | 57 | `prompt.critic.overWindow` | `refuse` | `send` | none: at the baseline the prompt is always sent (DV-099) |
// | 58 | `prompt.critic.block_set` | `current` | `as-is` | none: at the baseline there is one block set (DV-100) |
import { rowOfKey, type ProfileRow } from "@specstride/contracts/profile/parity";
import {
  registerSwitch,
  registeredSwitch,
  type RegisteredSwitch,
} from "@specstride/contracts/profile/switches";
import parityRowsData from "./data/parity-rows.json" with { type: "json" };

/** A registration this module refuses. */
export class CriticSwitchError extends Error {
  readonly key: string;
  readonly reason: "no-row" | "not-ours" | "not-confirmed" | "drift";
  constructor(key: string, reason: CriticSwitchError["reason"], message: string) {
    super(message);
    this.name = "CriticSwitchError";
    this.key = key;
    this.reason = reason;
  }
}

type DeclaredRow = {
  row: number;
  annex: string;
  status: string;
  key: string;
  default: string | number;
  parity: string | number;
  register: string;
};

/** `data/parity-rows.json`: the seven rows this feature declares (T003). */
const DECLARED_ROWS: readonly DeclaredRow[] = Object.freeze(
  parityRowsData as readonly DeclaredRow[],
);

/** The numbers of §X.7 this module registers: rows 52 to 58. */
export const CRITIC_SWITCH_ROWS: readonly number[] = Object.freeze(DECLARED_ROWS.map((r) => r.row));

/** The owner the annex names for every row of this feature. */
export const CRITIC_SWITCH_OWNER = "117" as const;

/** The seven keys, in the order of the annex. */
export const GROUNDING_SWITCH_KEY = "roles.critic.grounding" as const;
export const GROUNDING_MAX_FILES_KEY = "roles.critic.groundingMaxFiles" as const;
export const ANCHOR_MAX_BYTES_KEY = "roles.critic.anchorMaxBytes" as const;
export const CONTEXT_TOKENS_KEY = "roles.critic.contextTokens" as const;
export const DEBUG_KEY = "roles.critic.debug" as const;
export const OVER_WINDOW_KEY = "prompt.critic.overWindow" as const;
export const BLOCK_SET_KEY = "prompt.critic.block_set" as const;

export const CRITIC_SWITCH_KEYS = [
  GROUNDING_SWITCH_KEY,
  GROUNDING_MAX_FILES_KEY,
  ANCHOR_MAX_BYTES_KEY,
  CONTEXT_TOKENS_KEY,
  DEBUG_KEY,
  OVER_WINDOW_KEY,
  BLOCK_SET_KEY,
] as const;
export type CriticSwitchKey = (typeof CRITIC_SWITCH_KEYS)[number];

/** The as-is aliases: where the same knob stood at the baseline `9cab15d`. */
export type AsIsAlias = {
  /** The environment variable of the baseline, where there was one. */
  readonly env?: string | undefined;
  /** The command-line flag of the baseline, where there was one. */
  readonly flag?: string | undefined;
  /** Why there is no alias, where there is none. */
  readonly noneBecause?: string | undefined;
};

/** The as-is alias of every switch, taken from `lib/critic.py` at `9cab15d`. */
export const AS_IS_ALIASES: Readonly<Record<CriticSwitchKey, AsIsAlias>> = Object.freeze({
  [GROUNDING_SWITCH_KEY]: Object.freeze({
    env: "SPECSTRIDE_CRITIC_GROUNDING",
    flag: "--grounding",
  }),
  [GROUNDING_MAX_FILES_KEY]: Object.freeze({ env: "SPECSTRIDE_GROUNDING_MAX_FILES" }),
  [ANCHOR_MAX_BYTES_KEY]: Object.freeze({ env: "SPECSTRIDE_ANCHOR_MAX_BYTES_CEIL" }),
  [CONTEXT_TOKENS_KEY]: Object.freeze({ env: "SPECSTRIDE_CRITIC_CONTEXT_TOKENS" }),
  [DEBUG_KEY]: Object.freeze({ flag: "--debug" }),
  [OVER_WINDOW_KEY]: Object.freeze({
    noneBecause:
      "at the baseline a prompt still over the window was sent as it is; there was no " +
      "switch (DV-099, research D-6)",
  }),
  [BLOCK_SET_KEY]: Object.freeze({
    noneBecause:
      "at the baseline the critic prompt had one block set; the data boundary, the fact " +
      "block and the as-is block set are new (DV-100, research D-7)",
  }),
});

/** The as-is alias of a key. */
export function asIsAliasOf(key: CriticSwitchKey): AsIsAlias {
  return AS_IS_ALIASES[key];
}

/* ------------------------------------------------------------------ *
 * The row of the annex behind each key.
 * ------------------------------------------------------------------ */

/**
 * The row of §X.7 of one of this feature's keys. It must exist, it must name
 * the key, it must name feature 117 as its owner, and the declared row of
 * `data/parity-rows.json` must carry the key too with the status
 * `confirmed` (F100-FR-211, F100-FR-212).
 */
export function rowOfThisFeature(key: CriticSwitchKey): ProfileRow {
  const row = rowOfKey(key);
  if (row === undefined) {
    throw new CriticSwitchError(
      key,
      "no-row",
      `annex X §X.7 holds no row for \`${key}\` (F100-FR-211)`,
    );
  }
  if (!row.keys.includes(key)) {
    throw new CriticSwitchError(
      key,
      "drift",
      `row ${row.number} of annex X §X.7 does not name \`${key}\` among its keys`,
    );
  }
  if (row.owner !== CRITIC_SWITCH_OWNER) {
    throw new CriticSwitchError(
      key,
      "not-ours",
      `row ${row.number} of annex X §X.7 names ${row.owner} as its owner; feature 117 ` +
        `does not register a switch of another feature (F100-FR-212)`,
    );
  }
  const declared = DECLARED_ROWS.find((r) => r.row === row.number);
  if (declared === undefined || declared.key !== key) {
    throw new CriticSwitchError(
      key,
      "drift",
      `data/parity-rows.json does not declare row ${row.number} as \`${key}\``,
    );
  }
  if (declared.status !== "confirmed") {
    throw new CriticSwitchError(
      key,
      "not-confirmed",
      `row ${row.number} of annex X §X.7 has the status "${declared.status}", not ` +
        `"confirmed", in data/parity-rows.json`,
    );
  }
  return row;
}

/** The head of a cell of the annex, before the prose that states a consequence. */
function cellHead(cell: string): string {
  return cell.replace(/`/g, "").trim().split(",")[0]?.trim() ?? "";
}

/** The default of a key, read from the annex row. */
export function defaultValueOf(key: CriticSwitchKey): boolean | number | string | undefined {
  const row = rowOfThisFeature(key);
  switch (row.number) {
    case 52:
      return cellHead(row.default) === "true";
    case 53:
    case 54: {
      const n = Number(cellHead(row.default));
      if (!Number.isInteger(n)) {
        throw new CriticSwitchError(key, "drift", `row ${row.number} has a non-integer default`);
      }
      return n;
    }
    case 55:
      // "The window of the model": there is no consumer default; the window
      // of the harness or of the model applies.
      return undefined;
    case 56:
      return cellHead(row.default) === "true";
    case 57:
    case 58:
      return cellHead(row.default);
    default:
      throw new CriticSwitchError(key, "no-row", `row ${row.number} is not one of this feature's`);
  }
}

/** The value of a key under the `parity` profile, read from the annex row. */
export function parityValueOf(key: CriticSwitchKey): boolean | number | string | undefined {
  const row = rowOfThisFeature(key);
  switch (row.number) {
    case 52:
    case 56:
      return cellHead(row.parity) === "true";
    case 53:
    case 54:
      return Number(cellHead(row.parity));
    case 55:
      // "Not set unless the fixture sets it": unset, like the default.
      return undefined;
    case 57:
    case 58:
      return cellHead(row.parity);
    default:
      throw new CriticSwitchError(key, "no-row", `row ${row.number} is not one of this feature's`);
  }
}

/* ------------------------------------------------------------------ *
 * The registration, made at load (F100-FR-212).
 * ------------------------------------------------------------------ */

/** Register the seven switches of feature 117. Idempotent to the registry. */
export function registerCriticInputSwitches(): readonly RegisteredSwitch[] {
  const registered: RegisteredSwitch[] = [];
  for (const key of CRITIC_SWITCH_KEYS) {
    const existing = registeredSwitch(key);
    if (existing !== undefined) {
      registered.push(existing);
      continue;
    }
    const row = rowOfThisFeature(key);
    registered.push(
      registerSwitch({
        key,
        owner: CRITIC_SWITCH_OWNER,
        default: defaultValueOf(key),
        parity: parityValueOf(key),
        registerRows: row.registerRows,
      }),
    );
  }
  return Object.freeze(registered);
}

/** The seven switches, registered at load. */
export const criticSwitches: readonly RegisteredSwitch[] = registerCriticInputSwitches();

/* ------------------------------------------------------------------ *
 * Reading the switches the as-is way.
 * ------------------------------------------------------------------ */

/** The values that switch the grounding pass ON through the as-is alias (F117-FR-001). */
export const GROUNDING_TRUTHY_VALUES: readonly string[] = Object.freeze(["1", "true", "yes", "on"]);

/**
 * F117-FR-001 — through the as-is alias of the grounding switch only the
 * values `1`, `true`, `yes` and `on`, in any letter case, switch it on;
 * every other value switches it off WITHOUT A MESSAGE. This is the as-is
 * test of `lib/critic.py` at `9cab15d`, line 2575:
 * `str(args.grounding).lower() in ("1", "true", "yes", "on")`.
 */
export function groundingSwitchValue(raw: string): boolean {
  return GROUNDING_TRUTHY_VALUES.includes(raw.toLowerCase());
}

/** A cap that is not a whole number fails the critic call (F117-FR-002). */
export class CriticCapError extends Error {
  readonly key: CriticSwitchKey;
  readonly value: unknown;
  constructor(key: CriticSwitchKey, value: unknown) {
    const label = key === GROUNDING_MAX_FILES_KEY ? "cap of presence lines" : "ceiling per file";
    super(
      `\`${key}\` (${label}) is ${typeof value === "string" ? JSON.stringify(value) : String(value)}; ` +
        `it must be a whole number. The critic call fails before any verdict, as at the ` +
        `baseline, which reads both caps when the critic starts (F117-FR-002; B-0808, B-0809)`,
    );
    this.name = "CriticCapError";
    this.key = key;
    this.value = value;
  }
}

/**
 * F117-FR-002 — a value of the cap of presence lines or of the ceiling per
 * file that is not a whole number MUST make the critic call fail before any
 * verdict, as at the baseline, which reads both with `int(...)` when the
 * critic starts. A whole number in a string is accepted, as `int(...)`
 * accepts the string the environment gives.
 */
export function wholeNumberCap(
  key: typeof GROUNDING_MAX_FILES_KEY | typeof ANCHOR_MAX_BYTES_KEY,
  value: unknown,
): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    parsed = Number(value.trim());
  } else {
    throw new CriticCapError(key, value);
  }
  if (!Number.isInteger(parsed)) throw new CriticCapError(key, value);
  return parsed;
}

/** The context window the consumer set: the tokens, or the warning that ignores the value. */
export type ContextWindowSetting = {
  /** The window in tokens, or undefined when none applies. */
  readonly tokens: number | undefined;
  /** The warning, when a set value was not a whole number and was ignored. */
  readonly warning: string | undefined;
};

/**
 * F117-FR-002 — a value of the context window that is not a whole number
 * MUST be ignored WITH A WARNING, as at the baseline (`lib/critic.py`
 * `9cab15d`, lines 186 to 191: `warn("SPECSTRIDE_CRITIC_CONTEXT_TOKENS=%r is
 * not an integer; ignoring")`). A set window wins over the window of the
 * harness, for every harness (row 55; DV-106, DV-111).
 */
export function contextWindowTokens(value: unknown): ContextWindowSetting {
  if (value === undefined || value === null || value === "") {
    return { tokens: undefined, warning: undefined };
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(parsed)) {
    return {
      tokens: undefined,
      warning: `SPECSTRIDE_CRITIC_CONTEXT_TOKENS='${String(value)}' is not an integer; ignoring`,
    };
  }
  return { tokens: parsed, warning: undefined };
}
