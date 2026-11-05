/**
 * T009 — the rows of the `parity` profile feature 105 reads and owns (annex X
 * §X.7; F100-FR-210, F100-FR-211, F100-FR-212; F105-FR-001, F105-FR-002,
 * F105-FR-020, F105-FR-021, F105-FR-033, F105-FR-037, F105-FR-042).
 *
 * Feature 100 owns the table of §X.7 and the registry of switches. This module
 * registers the rows feature 105 is named an owner of, and records the rows it
 * only reads, each with its value under `parity`:
 *
 * | Row | Key | Default | Under `parity` | Here |
 * |---|---|---|---|---|
 * | 1 | `loop.strategy` | `micro` | `classic` | read from feature 115 |
 * | 6 | `verification.step_runner` | off | off | READ ONLY, from feature 148 |
 * | 7 | `verification.parallelism` | 1 (ceiling 4) | 1 | READ ONLY, from feature 148 |
 * | 31 | `integrity.gate_fingerprint` | on | off | READ ONLY, from features 148, 117 |
 * | 15 | `staleness.check_points` | launch, resume and every pass start | critic start only | registered |
 * | 33 | `integrity.manifest_relaunch` | on | off | registered |
 * | 123 | `verification.mode` | `required` | as the fixture sets it | registered |
 * | 124 | `verification.testPlan`, `verification.commands`, `verification.generateTests` | see the row | as the fixture sets them | registered |
 * | 126 | `verification.summary.tailLines`, `verification.summary.tailErrLines` | 80; 40 | 80; 40 | registered |
 *
 * Rows 123, 124 and 126 are the three rows this feature OWNS, with six keys
 * between them (`spec.md`, "Rows this feature owns"). Rows 15 and 33 name
 * feature 105 in their owner cell too, so they are registered here as well.
 *
 * Rows 1, 6, 7 and 31 are owned by other features, so this module does NOT
 * register them (F100-FR-212): `READ_FROM_THEIR_OWNERS` names each with its
 * owner and the reason it is read, `readOnlySwitch` is the only way to read
 * one, and it carries no setter — a value of such a row never originates
 * here. Rows 6, 7 and 31 are read for ONE purpose only, the rule of
 * F105-FR-020 on when a check manifest file is written, and
 * `manifestIsWritten` is that rule and the only reader of the three.
 *
 * Every value is taken from the row of the annex at load, never typed twice:
 * `parityValueOf` reads the cell and `valueOfCell` turns it into the value
 * this package uses, so this module and the table cannot drift.
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
import parityProfileData from "@specstride/contracts/data/parity-profile.json" with { type: "json" };
import parityRowsData from "../../data/parity-rows.json" with { type: "json" };

/* ------------------------------------------------------------------ *
 * The keys.
 * ------------------------------------------------------------------ */

/** Row 15 — the check points of the staleness check (F105-FR-042). */
export const STALENESS_CHECK_POINTS_KEY = "staleness.check_points" as const;
/** Row 33 — the comparison of the check manifest on a relaunch (F105-FR-021). */
export const MANIFEST_RELAUNCH_KEY = "integrity.manifest_relaunch" as const;
/** Row 123 — the verification mode (F105-FR-001). */
export const VERIFICATION_MODE_KEY = "verification.mode" as const;
/** Row 124 — the place of the verification plan for people (F105-FR-002). */
export const TEST_PLAN_KEY = "verification.testPlan" as const;
/** Row 124 — the verification-commands document (F105-FR-002). */
export const COMMANDS_KEY = "verification.commands" as const;
/** Row 124 — the directory for test scaffolds (F105-FR-002). */
export const GENERATE_TESTS_KEY = "verification.generateTests" as const;
/** Row 126 — the lines of standard output in the failure summary (F105-FR-037). */
export const TAIL_LINES_KEY = "verification.summary.tailLines" as const;
/** Row 126 — the lines of standard error in the failure summary (F105-FR-037). */
export const TAIL_ERR_LINES_KEY = "verification.summary.tailErrLines" as const;

/** The numbers of §X.7 this module registers, in the order of the annex. */
export const REGISTERED_SWITCH_ROWS: readonly number[] = Object.freeze([15, 33, 123, 124, 126]);

/**
 * The eight keys this module registers, in the order of the annex. Rows 15
 * and 33 carry one key each; row 124 carries three and row 126 two, which is
 * why five rows hold eight keys.
 */
export const REGISTERED_SWITCH_KEYS = [
  STALENESS_CHECK_POINTS_KEY,
  MANIFEST_RELAUNCH_KEY,
  VERIFICATION_MODE_KEY,
  TEST_PLAN_KEY,
  COMMANDS_KEY,
  GENERATE_TESTS_KEY,
  TAIL_LINES_KEY,
  TAIL_ERR_LINES_KEY,
] as const;
export type VerificationSwitchKey = (typeof REGISTERED_SWITCH_KEYS)[number];

/**
 * The six keys of the rows 123, 124 and 126 — the rows `spec.md` lists under
 * "Rows this feature owns". They are the subset of `REGISTERED_SWITCH_KEYS`
 * this feature's own requirements name.
 */
export const OWNED_SWITCH_KEYS = [
  VERIFICATION_MODE_KEY,
  TEST_PLAN_KEY,
  COMMANDS_KEY,
  GENERATE_TESTS_KEY,
  TAIL_LINES_KEY,
  TAIL_ERR_LINES_KEY,
] as const;
export type OwnedSwitchKey = (typeof OWNED_SWITCH_KEYS)[number];

/** The numbers of the three rows this feature owns: 123, 124 and 126. */
export const OWNED_SWITCH_ROWS: readonly number[] = Object.freeze([123, 124, 126]);

/* ------------------------------------------------------------------ *
 * The rows read from their owners.
 * ------------------------------------------------------------------ */

/** A row of §X.7 this feature reads from the feature that owns it. */
export type ForeignRow = {
  /** The number of the row of annex X §X.7. */
  readonly number: number;
  /** The configuration key of the row. */
  readonly key: string;
  /** The feature that owns the row and registers it. */
  readonly owner: string;
  /** Why feature 105 reads it. */
  readonly readFor: string;
  /**
   * True where the row is read for the rule of F105-FR-020 only and for
   * nothing else — rows 6, 7 and 31. `spec.md` and
   * `specs/105-verification/contracts/README.md` call these three "read only".
   */
  readonly readOnlyForTheManifestRule: boolean;
};

/**
 * Rows 1, 6, 7 and 31: read from their owners, NOT registered here
 * (F100-FR-212). Row 1 is `loop.strategy`, owner 115; rows 6 and 7 are the
 * check runner's, owner 148; row 31 is owned by 148 and 117.
 */
export const READ_FROM_THEIR_OWNERS: readonly ForeignRow[] = Object.freeze([
  Object.freeze({
    number: 1,
    key: "loop.strategy",
    owner: "115",
    readFor:
      "a manifest file is written when the loop strategy is not `classic` (F105-FR-020), and " +
      "a staged result is never taken over while a loop layer is engaged (F105-FR-033)",
    readOnlyForTheManifestRule: false,
  }),
  Object.freeze({
    number: 6,
    key: "verification.step_runner",
    owner: "148",
    readFor: "read only: it decides whether a check manifest file is written (F105-FR-020)",
    readOnlyForTheManifestRule: true,
  }),
  Object.freeze({
    number: 7,
    key: "verification.parallelism",
    owner: "148",
    readFor: "read only: it decides whether a check manifest file is written (F105-FR-020)",
    readOnlyForTheManifestRule: true,
  }),
  Object.freeze({
    number: 31,
    key: "integrity.gate_fingerprint",
    owner: "148, 117",
    readFor: "read only: it decides whether a check manifest file is written (F105-FR-020)",
    readOnlyForTheManifestRule: true,
  }),
]);

/** The numbers of the rows read from their owners: 1, 6, 7 and 31. */
export const FOREIGN_ROWS: readonly number[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.map((r) => r.number),
);

/** The keys read from their owners. */
export const FOREIGN_KEYS: readonly string[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.map((r) => r.key),
);

/**
 * Rows 6, 7 and 31: the three switches this feature reads READ ONLY, for the
 * rule of F105-FR-020 on when a manifest file is written and for nothing else.
 */
export const READ_ONLY_ROWS: readonly number[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.filter((r) => r.readOnlyForTheManifestRule).map((r) => r.number),
);

/** The keys of rows 6, 7 and 31, in the order of the annex. */
export const READ_ONLY_KEYS: readonly string[] = Object.freeze(
  READ_FROM_THEIR_OWNERS.filter((r) => r.readOnlyForTheManifestRule).map((r) => r.key),
);

/** The row of §X.7 read from its owner, or `undefined`. */
export function foreignRow(key: string): ForeignRow | undefined {
  return READ_FROM_THEIR_OWNERS.find((r) => r.key === key);
}

/* ------------------------------------------------------------------ *
 * The value a cell of the annex names.
 * ------------------------------------------------------------------ */

/** A registration or a read this module refuses. */
export class VerificationSwitchError extends Error {
  readonly key: string;
  readonly reason: "no-row" | "not-ours" | "not-read-only" | "read-only" | "drift";
  constructor(key: string, reason: VerificationSwitchError["reason"], message: string) {
    super(message);
    this.name = "VerificationSwitchError";
    this.key = key;
    this.reason = reason;
  }
}

/**
 * The cells of a row as `data/parity-profile.json` of feature 100 writes
 * them, WITH the back-ticks. `loadProfile` of feature 100 strips every
 * back-tick, which is right for a key but loses the one anchor a cell such as
 * row 124's gives: "`testautomation/<slug>/generated`. The two places are
 * under the working directory …" is a value followed by a sentence about the
 * whole row. Reading the raw cell keeps the literal separable from the prose,
 * and it is the same file feature 100 reads, so the two cannot drift.
 */
export function rawCellsOf(
  number: number,
): { readonly default: string; readonly parity: string } | undefined {
  const row = (
    parityProfileData as { switches: { number: number; default: string; parity: string }[] }
  ).switches.find((r) => r.number === number);
  return row === undefined
    ? undefined
    : Object.freeze({ default: row.default, parity: row.parity });
}

/**
 * The value a cell of the column "Default" or "Under `parity`" names. A cell
 * is prose: `off` and `on` are the two states of a switch, a bare number is a
 * count, `80; 40` is the two counts of row 126 in the order of its keys, a
 * literal in back-ticks is a named value, and a cell such as "As the fixture
 * sets it" names no value at all and is carried as its own text.
 */
export function valueOfCell(cell: string): boolean | number | string | null {
  const text = cell.trim();
  const head = (text.split(":")[0] ?? "").trim().toLowerCase();
  if (head === "off") return false;
  if (head === "on") return true;
  const count = /^(\d+)\b/.exec(head);
  if (count !== null) return Number(count[1]);
  if ((RESERVED_LITERALS as readonly string[]).includes(head)) return null;
  // "As the fixture sets it" / "… sets them" of rows 123 and 124 names no
  // value: a reader takes it from the fixture, never from the table.
  if (/^as the fixture sets\b/i.test(text)) return null;
  // A cell that opens with a literal in back-ticks gives that literal; the
  // prose after it is the consequence, not part of the value.
  const named = /^`([^`]+)`/.exec(text);
  if (named !== null) return named[1] as string;
  return text;
}

/**
 * The value of ONE key of a row whose cell names a value per key, separated
 * by a semicolon in the order of `row.keys` — row 124 ("…; none; …") and row
 * 126 ("80; 40"). Where the cell names no value per key, the whole cell is
 * the value of every key of the row.
 */
export function valueOfCellForKey(row: ProfileRow, key: string, cell: string): unknown {
  const index = row.keys.indexOf(key);
  const parts = cell.split(";");
  if (index < 0 || row.keys.length < 2 || parts.length !== row.keys.length) {
    return valueOfCell(cell);
  }
  const part = (parts[index] ?? "").trim();
  // `none` of row 124 is the absence of a declared document, not the text.
  if (/^none$/i.test(part)) return null;
  return valueOfCell(part);
}

/**
 * The row of §X.7 of a key this feature registers. The row must exist, it
 * must name the key, and it must name feature 105 in its owner cell: a
 * feature does not register a switch of another feature (F100-FR-212). Rows
 * 1, 6, 7 and 31 are refused here by design; they are read from features 115,
 * 148 and 117 through `readOnlySwitch`.
 */
export function rowOfThisFeature(number: number, key: string): ProfileRow {
  const row = profileRow(number);
  if (row === undefined) {
    throw new VerificationSwitchError(
      key,
      "no-row",
      `annex X §X.7 holds no row ${number}; feature 105 registers only rows of the ` +
        `profile (F100-FR-211)`,
    );
  }
  if (!row.keys.includes(key)) {
    throw new VerificationSwitchError(
      key,
      "drift",
      `row ${number} of annex X §X.7 names the keys ${row.keys.join(", ")}, not \`${key}\``,
    );
  }
  if (!/\b105\b/.test(row.owner)) {
    throw new VerificationSwitchError(
      key,
      "not-ours",
      `row ${number} ("${row.switch}") of annex X §X.7 names ${row.owner} as its owner; ` +
        `feature 105 does not register a switch of another feature (F100-FR-212)`,
    );
  }
  return row;
}

/** The row of §X.7 of one of this feature's keys; it must be ours. */
function ourRowOfKey(key: VerificationSwitchKey): ProfileRow {
  const row = rowOfKey(key);
  if (row === undefined) {
    throw new VerificationSwitchError(
      key,
      "no-row",
      `annex X §X.7 holds no row for \`${key}\` (F100-FR-211)`,
    );
  }
  return rowOfThisFeature(row.number, key);
}

/** The value of one of this feature's keys under `parity`, read from the annex. */
export function parityValueOf(key: VerificationSwitchKey): unknown {
  const row = ourRowOfKey(key);
  return valueOfCellForKey(row, key, rawCellsOf(row.number)?.parity ?? row.parity);
}

/** The default of one of this feature's keys, read from the annex. */
export function defaultValueOf(key: VerificationSwitchKey): unknown {
  const row = ourRowOfKey(key);
  return valueOfCellForKey(row, key, rawCellsOf(row.number)?.default ?? row.default);
}

/* ------------------------------------------------------------------ *
 * Reading a switch of another feature.
 * ------------------------------------------------------------------ */

/** One of rows 1, 6, 7 and 31, as this feature reads it. */
export type ReadOnlySwitch = {
  /** The row of §X.7, as feature 100 holds it. */
  readonly row: ProfileRow;
  /** The row as this module records it, with its owner and its reason. */
  readonly foreign: ForeignRow;
  /** The value under `parity`, as `valueOfCell` reads it. */
  readonly parityValue: unknown;
  /** The default, as `valueOfCell` reads it. */
  readonly defaultValue: unknown;
};

/**
 * Read a row of §X.7 that another feature owns. There is NO setter beside it:
 * this feature reads rows 1, 6, 7 and 31 and never writes one (F100-FR-212).
 * A key this feature registers is refused here, so the two paths cannot be
 * confused.
 */
export function readOnlySwitch(key: string): ReadOnlySwitch {
  if ((REGISTERED_SWITCH_KEYS as readonly string[]).includes(key)) {
    throw new VerificationSwitchError(
      key,
      "not-read-only",
      `\`${key}\` is a switch feature 105 registers; it is read through ` +
        `verificationSwitch(), not as a switch of another feature`,
    );
  }
  const foreign = foreignRow(key);
  if (foreign === undefined) {
    throw new VerificationSwitchError(
      key,
      "not-ours",
      `feature 105 reads the rows ${FOREIGN_KEYS.join(", ")} of annex X §X.7 from their ` +
        `owners; \`${key}\` is not one of them`,
    );
  }
  const row = profileRow(foreign.number);
  if (row === undefined || !row.keys.includes(key)) {
    throw new VerificationSwitchError(
      key,
      "drift",
      `annex X §X.7 row ${foreign.number} no longer names \`${key}\` (F100-FR-211)`,
    );
  }
  if (!new RegExp(`\\b${foreign.owner.split(",")[0]?.trim() ?? ""}\\b`).test(row.owner)) {
    throw new VerificationSwitchError(
      key,
      "drift",
      `annex X §X.7 row ${foreign.number} names ${row.owner} as its owner, not ` +
        `${foreign.owner}`,
    );
  }
  const raw = rawCellsOf(row.number);
  return Object.freeze({
    row,
    foreign,
    parityValue: valueOfCellForKey(row, key, raw?.parity ?? row.parity),
    defaultValue: valueOfCellForKey(row, key, raw?.default ?? row.default),
  });
}

/**
 * A write to a switch of another feature. It always throws: this feature
 * reads rows 1, 6, 7 and 31 and sets none of them (F100-FR-212). The function
 * exists so the refusal has a name a test can call.
 */
export function writeReadOnlySwitch(key: string, _value: unknown): never {
  const foreign = foreignRow(key);
  throw new VerificationSwitchError(
    key,
    "read-only",
    foreign === undefined
      ? `\`${key}\` is not a switch feature 105 reads from another feature`
      : `\`${key}\` is row ${foreign.number} of annex X §X.7, owned by feature ` +
          `${foreign.owner}; feature 105 reads it and never sets it (F100-FR-212)`,
  );
}

/* ------------------------------------------------------------------ *
 * The rule of F105-FR-020 on when a manifest file is written.
 * ------------------------------------------------------------------ */

/** The state of the four rows the rule of F105-FR-020 reads. */
export type ManifestRuleInput = {
  /** Row 1, `loop.strategy`. */
  readonly loopStrategy: string;
  /** Row 6, `verification.step_runner`. */
  readonly stepRunner: boolean;
  /** Row 7, `verification.parallelism`. */
  readonly parallelism: number;
  /** Row 31, `integrity.gate_fingerprint`. */
  readonly gateFingerprint: boolean;
  /** Row 33, `integrity.manifest_relaunch`. */
  readonly manifestRelaunch: boolean;
};

/** Why a manifest file is written, or why it is not. */
export type ManifestRuleOutcome = {
  /** True when a manifest file is written. */
  readonly written: boolean;
  /** The rows of §X.7 that asked for it, in the order of the annex. */
  readonly because: readonly number[];
  /** The sentence a log line or a record carries. */
  readonly reason: string;
};

/**
 * The value of row 7 at which the switch counts as ON. Row 7 is a count, not
 * a state: 1 is the serial default, so more than one command at a time is
 * what asks for a manifest (`research.md` D-13).
 */
export const PARALLELISM_OFF = 1 as const;

/** The value of row 1 under the `parity` profile, read from the annex. */
export const PARITY_LOOP_STRATEGY: string = String(
  valueOfCell(rawCellsOf(1)?.parity ?? profileRow(1)?.parity ?? "`classic`"),
);

/**
 * F105-FR-020 — a check manifest file is written when the loop strategy is
 * not `classic`, or when one of the switches of rows 6, 7, 31 or 33 is on;
 * otherwise the verification gate takes its commands from the verification
 * plan, as at the baseline. Under the `parity` profile every one of the five
 * is at the value that writes NO file, which is what keeps DV-052 true
 * (`research.md` D-13).
 */
export function manifestIsWritten(input: ManifestRuleInput): ManifestRuleOutcome {
  const because: number[] = [];
  if (input.loopStrategy !== PARITY_LOOP_STRATEGY) because.push(1);
  if (input.stepRunner) because.push(6);
  if (input.parallelism > PARALLELISM_OFF) because.push(7);
  if (input.gateFingerprint) because.push(31);
  if (input.manifestRelaunch) because.push(33);
  if (because.length === 0) {
    return Object.freeze({
      written: false,
      because: Object.freeze([]),
      reason:
        "no manifest file: the loop strategy is `classic` and the switches of rows 6, 7, " +
        "31 and 33 of annex X §X.7 are off, so the verification gate takes its commands " +
        "from the verification plan as at the baseline (F105-FR-020)",
    });
  }
  return Object.freeze({
    written: true,
    because: Object.freeze([...because]),
    reason:
      `a manifest file is written: rows ${because.join(", ")} of annex X §X.7 ask for it ` +
      `(F105-FR-020)`,
  });
}

/**
 * The state of the five rows under the `parity` profile, read from the annex
 * — the input of `manifestIsWritten` for which no manifest file is written.
 */
export function parityManifestRuleInput(): ManifestRuleInput {
  return Object.freeze({
    loopStrategy: PARITY_LOOP_STRATEGY,
    stepRunner: readOnlySwitch("verification.step_runner").parityValue === true,
    parallelism: Number(readOnlySwitch("verification.parallelism").parityValue),
    gateFingerprint: readOnlySwitch("integrity.gate_fingerprint").parityValue === true,
    manifestRelaunch: parityValueOf(MANIFEST_RELAUNCH_KEY) === true,
  });
}

/* ------------------------------------------------------------------ *
 * The registration.
 * ------------------------------------------------------------------ */

type ParityRowEntry = {
  row: number;
  key: string;
  default?: unknown;
  underParity: unknown;
  readOnly?: string;
  register?: string | null;
  status?: string;
  requirements?: string[];
  requirement?: string;
};

/** `data/parity-rows.json`, `read`: the rows of §X.7 this feature reads (T004). */
const DECLARED_READ: readonly ParityRowEntry[] = Object.freeze(
  (parityRowsData as { read: ParityRowEntry[] }).read,
);

/** `data/parity-rows.json`, `owned`: the rows of §X.7 this feature owns (T004). */
const DECLARED_OWNED: readonly ParityRowEntry[] = Object.freeze(
  (parityRowsData as { owned: ParityRowEntry[] }).owned,
);

/** The entry of `data/parity-rows.json` for a row and a key, or `undefined`. */
export function declaredRow(number: number, key: string): ParityRowEntry | undefined {
  return (
    DECLARED_READ.find((r) => r.row === number && r.key === key) ??
    DECLARED_OWNED.find((r) => r.row === number && r.key === key)
  );
}

/** One switch of this feature, as it was registered. */
export type VerificationSwitch = RegisteredSwitch & {
  /** The number of the row of annex X §X.7. */
  readonly number: number;
  /** The value under `parity`, per key, as `valueOfCellForKey` reads it. */
  readonly parityValue: unknown;
  /** The default, per key, as `valueOfCellForKey` reads it. */
  readonly defaultValue: unknown;
  /** True for the six keys of the rows 123, 124 and 126. */
  readonly owned: boolean;
};

const REGISTERED = new Map<string, VerificationSwitch>();

function define(number: number, key: VerificationSwitchKey): VerificationSwitch {
  const row = rowOfThisFeature(number, key);
  const declared = declaredRow(number, key);
  if (declared === undefined) {
    throw new VerificationSwitchError(
      key,
      "drift",
      `packages/verification/data/parity-rows.json holds no row ${number} for \`${key}\``,
    );
  }
  const already = registeredSwitch(key); // the registry of feature 100 is one per process
  const entry =
    already ??
    registerSwitch({
      key,
      // The owner cell of the annex, verbatim: row 15 names `102, 103, 105`.
      owner: row.owner,
      default: row.default,
      parity: row.parity,
      registerRows: row.registerRows,
    });
  const raw = rawCellsOf(row.number);
  const ours: VerificationSwitch = Object.freeze({
    ...entry,
    number: row.number,
    parityValue: valueOfCellForKey(row, key, raw?.parity ?? row.parity),
    defaultValue: valueOfCellForKey(row, key, raw?.default ?? row.default),
    owned: (OWNED_SWITCH_KEYS as readonly string[]).includes(key),
  });
  REGISTERED.set(key, ours);
  return ours;
}

/**
 * Register the switches of feature 105 with their values under `parity`
 * (F100-FR-212): rows 15 and 33, and the six keys of the rows 123, 124 and
 * 126. It is called once at load; calling it again re-reads the annex, so a
 * test that resets the registry of feature 100 can register them afresh.
 *
 * Rows 1 (`loop.strategy`, owner 115), 6 and 7 (owner 148) and 31 (owner
 * 148, 117) are NOT registered here: they are read from their owners, and the
 * loop refuses any of them before a single switch is defined, so a later edit
 * that moved one into `REGISTERED_SWITCH_KEYS` fails at load.
 */
export function registerVerificationSwitches(): readonly VerificationSwitch[] {
  for (const foreign of READ_FROM_THEIR_OWNERS) {
    if ((REGISTERED_SWITCH_KEYS as readonly string[]).includes(foreign.key)) {
      throw new VerificationSwitchError(
        foreign.key,
        "not-ours",
        `row ${foreign.number} (\`${foreign.key}\`) is owned by feature ${foreign.owner} and ` +
          `is read from its owner; feature 105 does not register it (F100-FR-212)`,
      );
    }
  }
  return Object.freeze([
    define(15, STALENESS_CHECK_POINTS_KEY),
    define(33, MANIFEST_RELAUNCH_KEY),
    define(123, VERIFICATION_MODE_KEY),
    define(124, TEST_PLAN_KEY),
    define(124, COMMANDS_KEY),
    define(124, GENERATE_TESTS_KEY),
    define(126, TAIL_LINES_KEY),
    define(126, TAIL_ERR_LINES_KEY),
  ]);
}

/** The switches of this feature, registered at load (F100-FR-212). */
export const verificationSwitches: readonly VerificationSwitch[] = registerVerificationSwitches();

/** The registration of one key of this feature, or `undefined`. */
export function verificationSwitch(key: string): VerificationSwitch | undefined {
  return REGISTERED.get(key);
}

/** The registrations of one row of this feature; rows 124 and 126 carry several. */
export function verificationSwitchesOfRow(number: number): readonly VerificationSwitch[] {
  return Object.freeze([...REGISTERED.values()].filter((s) => s.number === number));
}

/**
 * The configuration under the `parity` profile for the six keys of the rows
 * 123, 124 and 126: the mode, the three places and the two line counts of the
 * failure summary. Rows 123 and 124 say "As the fixture sets it", which names
 * no value, so their entries are `null` — a reader takes them from the
 * fixture and never from this table.
 */
export function parityConfiguration(): Readonly<Record<OwnedSwitchKey, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of OWNED_SWITCH_KEYS) out[key] = parityValueOf(key);
  return Object.freeze(out) as Readonly<Record<OwnedSwitchKey, unknown>>;
}
