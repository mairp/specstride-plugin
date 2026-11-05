/**
 * T009 — the switches of the `parity` profile the check runner owns (annex X
 * §X.7; F100-FR-210, F100-FR-211, F100-FR-212; F148-FR-002, F148-FR-006,
 * F148-FR-008, F148-FR-009, F148-FR-010, F148-FR-011).
 *
 * Feature 100 owns the table of §X.7 and the registry of switches. This
 * module is the registration of the four rows feature 148 owns, each with its
 * value under `parity`:
 *
 * | Row | Key | Default | Under `parity` |
 * |---|---|---|---|
 * | 6 | `verification.step_runner` | off | off |
 * | 7 | `verification.parallelism` | 1 (ceiling 4) | 1 |
 * | 31 | `integrity.gate_fingerprint` | on | off |
 * | 125 | `verification.envAllowlist` | on | off: the environment of the process is passed |
 *
 * Two rows this feature READS are deliberately NOT registered here, because a
 * feature does not register a row of another feature (F100-FR-212): row 1
 * (`loop.strategy`, owner 115) and row 25 (`sandbox.level`, owner 109). They
 * are read from their owners; `READ_FROM_THEIR_OWNERS` names them with their
 * owner and the reason, and `registerCheckRunnerSwitches` refuses either of
 * them, so the rule cannot be broken by a later edit.
 *
 * The values are taken from the row of the annex at load, never typed twice:
 * `parityValueOf` reads the cell and `valueOfCell` turns it into the value the
 * runner uses, so this module and the table cannot drift.
 */
import {
  profileRow,
  rowOfKey,
  RESERVED_LITERALS,
  type ProfileRow,
} from "@specstride/contracts/profile/parity";
import {
  registerSwitch,
  registeredSwitch,
  type RegisteredSwitch,
} from "@specstride/contracts/profile/switches";
import {
  PARALLELISM_CEILING as EP05_PARALLELISM_CEILING,
  PARALLELISM_DEFAULT as EP05_PARALLELISM_DEFAULT,
  PARALLELISM_KEY as EP05_PARALLELISM_KEY,
  STEP_RUNNER_KEY as EP05_STEP_RUNNER_KEY,
} from "@specstride/contracts/ep/check-runner";
import parityRowsData from "../../data/parity-rows.json" with { type: "json" };

/* ------------------------------------------------------------------ *
 * The rows this feature registers, and the rows it only reads.
 * ------------------------------------------------------------------ */

/** The numbers of §X.7 this module registers, in the order of the annex. */
export const REGISTERED_SWITCH_ROWS: readonly number[] = Object.freeze([6, 7, 31, 125]);

/**
 * The keys this module registers, in the order of the annex. Rows 6 and 7
 * carry the keys EP-05 of feature 100 already names, so they are taken from
 * there and not written a second time: a key cannot drift from the interface.
 */
export const STEP_RUNNER_KEY: "verification.step_runner" = EP05_STEP_RUNNER_KEY;
export const PARALLELISM_KEY: "verification.parallelism" = EP05_PARALLELISM_KEY;
export const GATE_FINGERPRINT_KEY = "integrity.gate_fingerprint" as const;
export const ENV_ALLOWLIST_KEY = "verification.envAllowlist" as const;

/** The four keys, in the order of the annex. */
export const REGISTERED_SWITCH_KEYS = [
  STEP_RUNNER_KEY,
  PARALLELISM_KEY,
  GATE_FINGERPRINT_KEY,
  ENV_ALLOWLIST_KEY,
] as const;
export type CheckRunnerSwitchKey = (typeof REGISTERED_SWITCH_KEYS)[number];

/** A row of §X.7 this feature reads from the feature that owns it. */
export type ForeignRow = {
  /** The number of the row of annex X §X.7. */
  readonly number: number;
  /** The configuration key of the row. */
  readonly key: string;
  /** The feature that owns the row and registers it. */
  readonly owner: string;
  /** Why the check runner reads it. */
  readonly readFor: string;
};

/**
 * Rows 1 and 25: read from their owners, NOT registered here (F100-FR-212).
 * Row 1 is `loop.strategy`, owner 115; row 25 is `sandbox.level`, owner 109.
 */
export const READ_FROM_THEIR_OWNERS: readonly ForeignRow[] = Object.freeze([
  Object.freeze({
    number: 1,
    key: "loop.strategy",
    owner: "115",
    readFor:
      "the integrity rules of a check hold with the loop layer off, which row 1 selects " +
      "(F148-FR-010)",
  }),
  Object.freeze({
    number: 25,
    key: "sandbox.level",
    owner: "109",
    readFor:
      "the containment a command runs under, which the fingerprint bracket reads " +
      "(F148-FR-006)",
  }),
]);

/** The numbers of the rows read from their owners: 1 and 25. */
export const FOREIGN_ROWS: readonly number[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.map((r) => r.number),
);

/** The keys read from their owners: `loop.strategy` and `sandbox.level`. */
export const FOREIGN_KEYS: readonly string[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.map((r) => r.key),
);

/** The row of §X.7 read from its owner, or `undefined`. */
export function foreignRow(key: string): ForeignRow | undefined {
  return READ_FROM_THEIR_OWNERS.find((r) => r.key === key);
}

/* ------------------------------------------------------------------ *
 * The value a cell of the annex names.
 * ------------------------------------------------------------------ */

/** A registration or a read this module refuses. */
export class CheckRunnerSwitchError extends Error {
  readonly key: string;
  readonly reason: "no-row" | "not-ours" | "out-of-range" | "drift";
  constructor(key: string, reason: CheckRunnerSwitchError["reason"], message: string) {
    super(message);
    this.name = "CheckRunnerSwitchError";
    this.key = key;
    this.reason = reason;
  }
}

/**
 * The range of `verification.parallelism` (F148-FR-011). The ceiling is the
 * one EP-05 of feature 100 states, and the floor is its default, so this
 * module does not restate a bound of the interface.
 */
export const PARALLELISM_MIN: 1 = EP05_PARALLELISM_DEFAULT;
export const PARALLELISM_CEILING: 4 = EP05_PARALLELISM_CEILING;

/**
 * The value a cell of the column "Default" or "Under `parity`" names. A cell
 * is prose: `off` and `on` are the two states of a switch, a bare number is a
 * count, and a cell such as "off: the environment of the process is passed"
 * states the consequence after the value. `null` is a cell that names no
 * value of a key (annex X §X.6 row 239, `RESERVED_LITERALS`).
 */
export function valueOfCell(cell: string): boolean | number | string | null {
  const text = cell.trim();
  const head = (text.split(":")[0] ?? "").trim().toLowerCase();
  if (head === "off") return false;
  if (head === "on") return true;
  const count = /^(\d+)\b/.exec(head);
  if (count !== null) return Number(count[1]);
  if ((RESERVED_LITERALS as readonly string[]).includes(head)) return null;
  return text;
}

/**
 * The row of §X.7 of a key this feature registers. The row must exist, it must
 * name the key, and it must name feature 148 as its owner: a feature does not
 * register and does not read through its own registry a switch of another
 * feature (F100-FR-212). Rows 1 and 25 are refused here by design; they are
 * read from features 115 and 109.
 */
export function rowOfThisFeature(number: number, key: string): ProfileRow {
  const row = profileRow(number);
  if (row === undefined) {
    throw new CheckRunnerSwitchError(
      key,
      "no-row",
      `annex X §X.7 holds no row ${number}; the check runner registers only rows of the ` +
        `profile (F100-FR-211)`,
    );
  }
  if (!row.keys.includes(key)) {
    throw new CheckRunnerSwitchError(
      key,
      "drift",
      `row ${number} of annex X §X.7 names the keys ${row.keys.join(", ")}, not \`${key}\``,
    );
  }
  if (!/\b148\b/.test(row.owner)) {
    throw new CheckRunnerSwitchError(
      key,
      "not-ours",
      `row ${number} ("${row.switch}") of annex X §X.7 names ${row.owner} as its owner; ` +
        `feature 148 does not register a switch of another feature (F100-FR-212)`,
    );
  }
  return row;
}

/** The row of §X.7 of one of this feature's keys; it must be ours. */
function ourRowOfKey(key: CheckRunnerSwitchKey): ProfileRow {
  const row = rowOfKey(key);
  if (row === undefined) {
    throw new CheckRunnerSwitchError(
      key,
      "no-row",
      `annex X §X.7 holds no row for \`${key}\` (F100-FR-211)`,
    );
  }
  return rowOfThisFeature(row.number, key);
}

/** The value of a key under the `parity` profile, read from the annex. */
export function parityValueOf(key: CheckRunnerSwitchKey): boolean | number | string | null {
  return valueOfCell(ourRowOfKey(key).parity);
}

/** The default of a key, read from the annex. */
export function defaultValueOf(key: CheckRunnerSwitchKey): boolean | number | string | null {
  return valueOfCell(ourRowOfKey(key).default);
}

/**
 * F148-FR-011 — `verification.parallelism` is between 1 and 4. The ceiling is
 * in the "Default" cell of row 7; a configured value outside the range is
 * refused rather than silently clamped.
 */
export function checkParallelism(value: number): number {
  if (!Number.isInteger(value) || value < PARALLELISM_MIN || value > PARALLELISM_CEILING) {
    throw new CheckRunnerSwitchError(
      PARALLELISM_KEY,
      "out-of-range",
      `\`${PARALLELISM_KEY}\` is ${String(value)}; it is a whole number between ` +
        `${PARALLELISM_MIN} and ${PARALLELISM_CEILING} (F148-FR-011)`,
    );
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * The registration.
 * ------------------------------------------------------------------ */

type ParityRowEntry = {
  row: number;
  key: string;
  default?: unknown;
  underParity: unknown;
  register?: string;
  status: string;
  requirements: string[];
};

/** `data/parity-rows.json`: the rows of §X.7 this feature reads (T004). */
const DECLARED_ROWS: readonly ParityRowEntry[] = Object.freeze(
  (parityRowsData as { read: ParityRowEntry[] }).read,
);

/** The entry of `data/parity-rows.json` for a row, or `undefined`. */
export function declaredRow(number: number): ParityRowEntry | undefined {
  return DECLARED_ROWS.find((r) => r.row === number);
}

/** One switch of this feature, as it was registered. */
export type CheckRunnerSwitch = RegisteredSwitch & {
  /** The number of the row of annex X §X.7. */
  readonly number: number;
  /** The value under `parity`, as `valueOfCell` reads it. */
  readonly parityValue: boolean | number | string | null;
  /** The default, as `valueOfCell` reads it. */
  readonly defaultValue: boolean | number | string | null;
};

const REGISTERED = new Map<string, CheckRunnerSwitch>();

function define(number: number, key: CheckRunnerSwitchKey): CheckRunnerSwitch {
  const row = rowOfThisFeature(number, key);
  const declared = declaredRow(number);
  if (declared === undefined || declared.key !== key) {
    throw new CheckRunnerSwitchError(
      key,
      "drift",
      `packages/check-runner/data/parity-rows.json holds no row ${number} for \`${key}\``,
    );
  }
  const already = registeredSwitch(key);
  const entry =
    already ?? // the registry of feature 100 is one per process
    registerSwitch({
      key,
      // The owner cell of the annex, verbatim: row 31 names `148, 117`.
      owner: row.owner,
      default: row.default,
      parity: row.parity,
      registerRows: row.registerRows,
    });
  const ours: CheckRunnerSwitch = Object.freeze({
    ...entry,
    number: row.number,
    parityValue: valueOfCell(row.parity),
    defaultValue: valueOfCell(row.default),
  });
  REGISTERED.set(key, ours);
  return ours;
}

/**
 * Register the four switches of feature 148 with their values under `parity`
 * (F100-FR-212). It is called once at load; calling it again is a no-op, so a
 * test that resets the registry of feature 100 can register them afresh.
 *
 * Rows 1 (`loop.strategy`, owner 115) and 25 (`sandbox.level`, owner 109) are
 * NOT registered here: they are read from their owners.
 */
export function registerCheckRunnerSwitches(): readonly CheckRunnerSwitch[] {
  for (const foreign of READ_FROM_THEIR_OWNERS) {
    if ((REGISTERED_SWITCH_KEYS as readonly string[]).includes(foreign.key)) {
      throw new CheckRunnerSwitchError(
        foreign.key,
        "not-ours",
        `row ${foreign.number} (\`${foreign.key}\`) is owned by feature ${foreign.owner} and ` +
          `is read from its owner; feature 148 does not register it (F100-FR-212)`,
      );
    }
  }
  const stepRunner = define(6, STEP_RUNNER_KEY);
  const parallelism = define(7, PARALLELISM_KEY);
  const gateFingerprint = define(31, GATE_FINGERPRINT_KEY);
  const envAllowlist = define(125, ENV_ALLOWLIST_KEY);
  checkParallelism(parallelism.parityValue as number);
  return Object.freeze([stepRunner, parallelism, gateFingerprint, envAllowlist]);
}

/** The four switches of this feature, registered at load (F100-FR-212). */
export const checkRunnerSwitches: readonly CheckRunnerSwitch[] = registerCheckRunnerSwitches();

/** The registration of one key of this feature, or `undefined`. */
export function checkRunnerSwitch(key: string): CheckRunnerSwitch | undefined {
  return REGISTERED.get(key);
}

/**
 * The configuration under the `parity` profile for the keys of this feature:
 * the step runner off, the parallelism 1, the fingerprint bracket off and the
 * environment allow-list off (the environment of the process is passed).
 */
export function parityConfiguration(): Readonly<
  Record<CheckRunnerSwitchKey, boolean | number | string | null>
> {
  const out: Record<string, boolean | number | string | null> = {};
  for (const key of REGISTERED_SWITCH_KEYS) out[key] = parityValueOf(key);
  return Object.freeze(out) as Readonly<
    Record<CheckRunnerSwitchKey, boolean | number | string | null>
  >;
}
