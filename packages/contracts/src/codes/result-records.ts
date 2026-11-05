/**
 * T271 — the result records of the engine's inner boundaries and the two
 * start modes (annex E, §E.4; F100-FR-153, F100-FR-154).
 *
 * A slice of T085. The result records of the pass loop, the critic call, the
 * verification gate and the internal helpers as types carrying the
 * `exit_code` numbers of their tables, read from the entries other than
 * `Engine` of the key `engine` of `data/exit-codes.json`; the two start modes
 * `standalone` and `child` with what each does (row 19 of
 * `data/closed-sets.json`); and the engine executable, resolved at launch and
 * pinned by path and hash in the launch record from a configuration key whose
 * default is the product's own entry, all as data.
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };
import { engineStartModes } from "../enums/sets-100-104.ts";

/** The section of annex E that owns these tables. */
export const ANNEX_SECTION = "annex E, §E.4" as const;

type RawTable = { process: string; rows: Record<string, string>[] };

const TABLES = (exitCodes as { engine: RawTable[] }).engine;

/** The `process` cell of every entry of the key `engine`, in annex order. */
export const ENGINE_TABLE_NAMES: readonly string[] = Object.freeze(TABLES.map((t) => t.process));

/** The four entries other than `Engine`: the tables this module owns. */
export const RESULT_RECORD_TABLES = [
  "Pass loop (result record; not a process)",
  "Critic call (result record; not a process)",
  "Verification gate (result record inside the engine; a process as the public command `verify`)",
  "Internal helpers (result records)",
] as const;

/** A name of one of the four tables of result records. */
export type ResultRecordTable = (typeof RESULT_RECORD_TABLES)[number];

function rowsOf(process: string): readonly Record<string, string>[] {
  const table = TABLES.find((t) => t.process === process);
  if (table === undefined) {
    throw new Error(`the key \`engine\` of data/exit-codes.json holds no entry \`${process}\``);
  }
  return Object.freeze(table.rows.map((row) => Object.freeze({ ...row })));
}

const bare = (cell: string): string => cell.replace(/`/g, "").trim();

/** Every whole number an `exit_code` cell names; "128+N" holds none. */
function numbersOf(cell: string): readonly number[] {
  return Object.freeze([...cell.matchAll(/\d+/g)].map((m) => Number(m[0])));
}

/* ------------------------------------------------------------------ *
 * The pass loop.
 * ------------------------------------------------------------------ */

/** One row of the table "Pass loop" of §E.4. */
export type PassLoopRow = {
  /** The cell "`exit_code`", verbatim: "0", "130, 143", "124 (status of a pass)". */
  readonly cell: string;
  /** The numbers the cell names. */
  readonly codes: readonly number[];
  /** The cell "Meaning". */
  readonly meaning: string;
  /** True where the cell marks the number a status of one pass, not a result. */
  readonly statusOfAPass: boolean;
};

/** Every row of the table "Pass loop", in the order of the annex. */
export const passLoopRows: readonly PassLoopRow[] = Object.freeze(
  rowsOf(RESULT_RECORD_TABLES[0]).map((row) =>
    Object.freeze({
      cell: row["`exit_code`"] ?? "",
      codes: numbersOf(row["`exit_code`"] ?? ""),
      meaning: row.Meaning ?? "",
      statusOfAPass: /status of a pass/i.test(row["`exit_code`"] ?? ""),
    }),
  ),
);

/**
 * F100-FR-153 — the result record of the pass loop. Its `exit_code` carries
 * the numbers of the table of §E.4.
 */
export type PassLoopResultRecord = {
  /** A number of the table "Pass loop" of §E.4. */
  readonly exit_code: number;
  /** Set on the result 3: the field `blocked` holds `source-changed`. */
  readonly blocked?: string;
};

/** The values the result record of the pass loop may carry. */
export const PASS_LOOP_EXIT_CODES: readonly number[] = Object.freeze(
  passLoopRows.filter((r) => !r.statusOfAPass).flatMap((r) => [...r.codes]),
);

/** The two numbers the table keeps as a status of one pass, not a result. */
export const PASS_STATUS_CODES: readonly number[] = Object.freeze(
  passLoopRows.filter((r) => r.statusOfAPass).flatMap((r) => [...r.codes]),
);

/**
 * The result 3 of the pass loop for a stop before a pass because a source
 * changed: the field `blocked` is set to `source-changed` (§E.4).
 */
export const PASS_LOOP_SOURCE_CHANGED: PassLoopResultRecord = Object.freeze({
  exit_code: 3,
  blocked: "source-changed",
});

/* ------------------------------------------------------------------ *
 * The critic call.
 * ------------------------------------------------------------------ */

/** One row of the table "Critic call" of §E.4. */
export type CriticCallRow = {
  readonly exitCode: number;
  /** The cell "`result`" without its back-ticks. */
  readonly result: string;
  /** The members the cell names: "`rejected` or `malformed`" names two. */
  readonly results: readonly string[];
  readonly meaning: string;
};

/** Every row of the table "Critic call", in the order of the annex. */
export const criticCallRows: readonly CriticCallRow[] = Object.freeze(
  rowsOf(RESULT_RECORD_TABLES[1]).map((row) =>
    Object.freeze({
      exitCode: Number(bare(row["`exit_code`"] ?? "")),
      result: bare(row["`result`"] ?? ""),
      results: Object.freeze(
        [...(row["`result`"] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ""),
      ),
      meaning: row.Meaning ?? "",
    }),
  ),
);

/** F100-FR-153 — the result record of a call of the critic. */
export type CriticCallResultRecord = {
  /** A number of the table "Critic call" of §E.4. */
  readonly exit_code: number;
  /** The member of the column "`result`" for that number. */
  readonly result: string;
};

/** The `result` of a code of the critic call, or `undefined`. */
export function criticResultOf(code: number): readonly string[] | undefined {
  return criticCallRows.find((r) => r.exitCode === code)?.results;
}

/* ------------------------------------------------------------------ *
 * The verification gate.
 * ------------------------------------------------------------------ */

/** One row of the table "Verification gate" of §E.4. */
export type VerificationGateRow = { readonly exitCode: number; readonly meaning: string };

/** Every row of the table "Verification gate", in the order of the annex. */
export const verificationGateRows: readonly VerificationGateRow[] = Object.freeze(
  rowsOf(RESULT_RECORD_TABLES[2]).map((row) =>
    Object.freeze({
      exitCode: Number(bare(row["`exit_code`"] ?? "")),
      meaning: row.Meaning ?? "",
    }),
  ),
);

/**
 * F100-FR-153 — the result record of the verification gate inside the engine.
 * The same numbers are the exit codes of the public command `verify`.
 */
export type VerificationGateResultRecord = {
  /** A number of the table "Verification gate" of §E.4. */
  readonly exit_code: number;
};

/** The codes of the verification gate (§E.4). */
export const VERIFICATION_GATE_EXIT_CODES: readonly number[] = Object.freeze(
  verificationGateRows.map((r) => r.exitCode),
);

/** §E.4 — the failure summary of verification: 0, and 2 on wrong usage. */
export const VERIFICATION_FAILURE_SUMMARY_CODES = [0, 2] as const;

/* ------------------------------------------------------------------ *
 * The internal helpers.
 * ------------------------------------------------------------------ */

/** One row of the table "Internal helpers" of §E.4. */
export type InternalHelperRow = {
  /** The cell "Component". */
  readonly component: string;
  /** The cell "Values kept in its result record", verbatim. */
  readonly cell: string;
  /** The numbers the cell names. */
  readonly codes: readonly number[];
  /** True for the helpers that never break the loop: 0 on every path. */
  readonly neverBreaksTheLoop: boolean;
};

/** Every row of the table "Internal helpers", in the order of the annex. */
export const internalHelperRows: readonly InternalHelperRow[] = Object.freeze(
  rowsOf(RESULT_RECORD_TABLES[3]).map((row) => {
    const cell = row["Values kept in its result record"] ?? "";
    return Object.freeze({
      component: row.Component ?? "",
      cell,
      codes: numbersOf(cell),
      neverBreaksTheLoop: /never break the loop/i.test(cell),
    });
  }),
);

/** F100-FR-153 — the result record of an internal helper. */
export type InternalHelperResultRecord = {
  /** A number of the row of its component in §E.4. */
  readonly exit_code: number;
};

/** The values the result record of a component may carry (§E.4). */
export function internalHelperCodes(component: string): readonly number[] | undefined {
  return internalHelperRows.find((r) => r.component === component)?.codes;
}

/**
 * F100-FR-153 — where the baseline prints such a number, compatibility
 * output prints the same number: a result record's `exit_code` is not
 * renumbered.
 */
export const COMPATIBILITY_PRINTS_THE_SAME_NUMBER = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-154 — the two start modes.
 * ------------------------------------------------------------------ */

/** Row 19 of §X.6 — the two start modes of the engine. */
export const START_MODES = ["standalone", "child"] as const;

/** A start mode of the engine (annex E, §E.4). */
export type StartMode = (typeof START_MODES)[number];

/** Row 19 of §X.6 as the table of §X.6 holds it (T250). */
export const startModeSet = engineStartModes;

/** What one start mode does (F100-FR-154). */
export type StartModeFacts = {
  readonly mode: StartMode;
  /** Whether the engine takes the workspace lock itself. */
  readonly takesTheWorkspaceLock: boolean;
  /** Whether it writes the lease. */
  readonly writesTheLease: boolean;
  /** Whether it writes the run record. */
  readonly writesTheRunRecord: boolean;
  /** Whether it owns the transitions the table of §E.2 gives to the root. */
  readonly ownsTheTransitionsOfTheRoot: boolean;
  /** Whether it verifies the lease handed down by the root. */
  readonly verifiesTheLeaseHandedDown: boolean;
};

/**
 * F100-FR-154 — in `standalone` the engine takes the workspace lock, writes
 * the lease and the run record, and owns the transitions of the root. In
 * `child` it verifies the lease handed down by the root and never takes a
 * lock.
 */
export const START_MODE_FACTS: Readonly<Record<StartMode, StartModeFacts>> = Object.freeze({
  standalone: Object.freeze({
    mode: "standalone",
    takesTheWorkspaceLock: true,
    writesTheLease: true,
    writesTheRunRecord: true,
    ownsTheTransitionsOfTheRoot: true,
    verifiesTheLeaseHandedDown: false,
  }),
  child: Object.freeze({
    mode: "child",
    takesTheWorkspaceLock: false,
    writesTheLease: false,
    writesTheRunRecord: false,
    ownsTheTransitionsOfTheRoot: false,
    verifiesTheLeaseHandedDown: true,
  }),
});

/** The facts of a start mode (F100-FR-154). */
export function startModeFacts(mode: string): StartModeFacts | undefined {
  return START_MODE_FACTS[mode as StartMode];
}

/**
 * F100-FR-154 — the engine exits 5 when the workspace lock is held, and only
 * in start mode `standalone`: in `child` it never takes a lock (§E.4, code 5).
 */
export const LOCK_HELD_EXIT_IS_STANDALONE_ONLY = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-154 — the executable of the engine.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-154 — the executable of the engine is resolved at launch and pinned
 * by path and hash in the launch record, from a configuration key whose
 * default is the product's own entry. The key is row 41 of the parity profile
 * (annex X §X.7); the field of the launch record is `engineExecutable`
 * (annex B §B.7).
 */
export const ENGINE_EXECUTABLE = {
  configurationKey: "engine.executable",
  configurationDefault: "the product's own entry",
  resolvedAt: "launch",
  pinnedBy: ["path", "hash"],
  pinnedIn: "launch record",
  launchRecordField: "engineExecutable",
  logicalNameOfTheRecord: "launch:<launchId>:record",
} as const;

/** The pin of the executable, as the launch record carries it. */
export type EngineExecutablePin = {
  /** The resolved path of the executable. */
  readonly path: string;
  /** Its hash, as the canonical hasher gives it (annex X §X.5). */
  readonly hash: string;
};

/** True when the launch record pins the executable by path and by hash. */
export function pinsTheExecutable(value: unknown): value is EngineExecutablePin {
  if (typeof value !== "object" || value === null) return false;
  const pin = value as Record<string, unknown>;
  return typeof pin.path === "string" && typeof pin.hash === "string";
}
