/**
 * T004 of feature 101 — the table "Halts of the phase gate" as data, with its
 * validation AT LOAD (`specs/101-gate-and-verdict/contracts/gate-halts.json`,
 * copied to `data/gate-halts.json`; F101-FR-010, F101-FR-037).
 *
 * The one rule this module enforces is the one the task names: every STOP
 * REASON and every EXIT CODE the table holds is a member of a closed set of
 * feature 100 — row 3 of annex X §X.6 (`stopReasonSet`, the 15 literals of
 * annex E §E.3) and row 6 (`engineExitCodeSet`, the codes of annex E §E.4).
 * Because the data is read at load, a table that names a stop reason or an exit
 * code outside those sets fails the import, not some later run: `GATE_HALTS`
 * cannot be read without the validation having passed (F100-FR-021: an unknown
 * member of a closed set refuses the record, naming the set and the value).
 *
 * Two further agreements come free with the same reading and are checked here
 * too, because a row that disagreed with annex E would be worse than useless:
 * the exit code of a row equals the `engineExit` of its stop reason, and the
 * stop reason stands among the stop reasons §E.4 gives for that code. A row
 * without a stop reason (`stopReason: null`) carries an exit code that §E.4
 * gives no member, and `retryable` is false there (F100-FR-148).
 *
 * The module imports no `node:` module: the data comes through the JSON import
 * of the package, as every other data file of `contracts` does.
 */
import gateHaltsData from "../../data/gate-halts.json" with { type: "json" };
import { engineExitCodeSet, isEngineExitCode, stopReasonsOf } from "../codes/engine.ts";
import { engineExitOf, isStopReason, stopReasonSet } from "../codes/stop-reasons.ts";
import type { StopReason } from "../codes/stop-reasons.ts";
import type { EngineExitCode } from "../codes/engine.ts";

/** The schema id the data file carries. */
export const SCHEMA_ID = "specstride.gate-halts/1" as const;

/** The contract file the data is a byte-for-byte copy of. */
export const CONTRACT_FILE = "specs/101-gate-and-verdict/contracts/gate-halts.json" as const;

/** The copy in the package, which this module reads. */
export const DATA_FILE = "packages/contracts/data/gate-halts.json" as const;

/** Row 3 of annex X §X.6 — the closed set the stop reasons are read against. */
export const STOP_REASON_SET_ROW = 3 as const;

/** Row 6 of annex X §X.6 — the closed set the exit codes are read against. */
export const EXIT_CODE_SET_ROW = 6 as const;

/** One row of the table "Halts of the phase gate". */
export type GateHalt = {
  /** What ended the run; the name of the row. */
  readonly cause: string;
  /** The code the engine exits with; a member of row 6 of §X.6. */
  readonly exitCode: EngineExitCode;
  /** The stop reason, a member of row 3 of §X.6, or null where the exit has none. */
  readonly stopReason: StopReason | null;
  /** Whether this stop may be relaunched. */
  readonly retryable: boolean;
  /** The as-is fields the halt banner carries, where the row names them. */
  readonly asIsFields: readonly string[];
  /** Whether the last phase attempt is archived before the halt; null where the row says nothing. */
  readonly archivedBefore: boolean | null;
  /** The fixtures of feature 141 that end in this row. */
  readonly fixtures: readonly string[];
};

/** A row that names a stop reason or an exit code outside the closed sets. */
export class GateHaltsError extends Error {
  /** The row the fault is in, by its `cause`. */
  readonly cause_: string;
  /** The value that is no member, as text. */
  readonly value: string;
  /** The set it was read against. */
  readonly set: string;

  constructor(message: string, cause: string, value: string, set: string) {
    super(message);
    this.name = "GateHaltsError";
    this.cause_ = cause;
    this.value = value;
    this.set = set;
  }
}

type RawHalt = {
  cause?: unknown;
  exitCode?: unknown;
  stopReason?: unknown;
  retryable?: unknown;
  asIsFields?: unknown;
  archivedBefore?: unknown;
  fixtures?: unknown;
};

const asStrings = (value: unknown): readonly string[] =>
  Object.freeze(Array.isArray(value) ? value.map((v) => String(v)) : []);

/**
 * Read the table and validate it. Every stop reason is read against row 3 of
 * §X.6 and every exit code against row 6; a value outside its set throws
 * `GateHaltsError` with the row, the value and the set, in the words of the
 * unknown-value rule of that set.
 */
export function loadGateHalts(data: unknown = gateHaltsData): readonly GateHalt[] {
  const file = data as { schema?: unknown; halts?: unknown };
  if (file.schema !== SCHEMA_ID) {
    throw new GateHaltsError(
      `the table of halts carries the schema id "${String(file.schema)}"; ` +
        `the schema id of the table is "${SCHEMA_ID}"`,
      "—",
      String(file.schema),
      "schema id",
    );
  }
  if (!Array.isArray(file.halts)) {
    throw new GateHaltsError(
      "the table of halts holds the key `halts`, a list of rows",
      "—",
      typeof file.halts,
      "shape",
    );
  }
  const out: GateHalt[] = [];
  for (const raw of file.halts as RawHalt[]) {
    const cause = String(raw.cause);

    // The exit code: a member of row 6 of §X.6 (annex E, §E.4).
    const exitCode = raw.exitCode;
    if (typeof exitCode !== "number" || !isEngineExitCode(exitCode)) {
      throw new GateHaltsError(
        `the row "${cause}" of ${DATA_FILE} gives the exit code ` +
          `${JSON.stringify(exitCode)}; ` +
          engineExitCodeSet.onUnknown(String(exitCode)).message,
        cause,
        String(exitCode),
        engineExitCodeSet.name,
      );
    }

    // The stop reason: a member of row 3 of §X.6 (annex E, §E.3), or null.
    const stopReason = raw.stopReason;
    if (stopReason !== null && (typeof stopReason !== "string" || !isStopReason(stopReason))) {
      throw new GateHaltsError(
        `the row "${cause}" of ${DATA_FILE} gives the stop reason ` +
          `${JSON.stringify(stopReason)}; ` +
          stopReasonSet.onUnknown(String(stopReason)).message,
        cause,
        String(stopReason),
        stopReasonSet.name,
      );
    }

    // The two agreements with annex E that the same reading gives.
    if (stopReason !== null) {
      const ofTheAnnex = engineExitOf(stopReason);
      if (ofTheAnnex !== exitCode) {
        throw new GateHaltsError(
          `the row "${cause}" of ${DATA_FILE} pairs the stop reason ` +
            `\`${stopReason}\` with the exit code ${exitCode}; annex E §E.3 gives it ` +
            `the exit code ${String(ofTheAnnex)}`,
          cause,
          `${stopReason}:${exitCode}`,
          stopReasonSet.name,
        );
      }
      if (!stopReasonsOf(exitCode).includes(stopReason)) {
        throw new GateHaltsError(
          `the row "${cause}" of ${DATA_FILE} gives the exit code ${exitCode} the stop ` +
            `reason \`${stopReason}\`; annex E §E.4 gives that code the stop reasons ` +
            `${stopReasonsOf(exitCode).join(", ")}`,
          cause,
          `${exitCode}:${stopReason}`,
          engineExitCodeSet.name,
        );
      }
    } else if (raw.retryable !== false) {
      // F100-FR-148: on an exit without a member, `retryable` is false.
      throw new GateHaltsError(
        `the row "${cause}" of ${DATA_FILE} names no stop reason and gives ` +
          `\`retryable\` ${JSON.stringify(raw.retryable)}; on an exit without a member ` +
          `of §E.3, \`retryable\` is false (F100-FR-148)`,
        cause,
        String(raw.retryable),
        "retryable",
      );
    }

    out.push(
      Object.freeze({
        cause,
        exitCode,
        stopReason,
        retryable: raw.retryable === true,
        asIsFields: asStrings(raw.asIsFields),
        archivedBefore: typeof raw.archivedBefore === "boolean" ? raw.archivedBefore : null,
        fixtures: asStrings(raw.fixtures),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * Every row of the table, validated AT LOAD of this module. An import of
 * `GATE_HALTS` that returns means the validation passed.
 */
export const GATE_HALTS: readonly GateHalt[] = loadGateHalts();

/** The row of a cause, or `undefined` where the table holds none. */
export function gateHalt(cause: string): GateHalt | undefined {
  return GATE_HALTS.find((halt) => halt.cause === cause);
}

/** Every stop reason the table names, without null and without repeats. */
export function stopReasonsOfTheTable(): readonly StopReason[] {
  return Object.freeze([
    ...new Set(
      GATE_HALTS.map((halt) => halt.stopReason).filter((r): r is StopReason => r !== null),
    ),
  ]);
}

/** Every exit code the table names, without repeats, sorted. */
export function exitCodesOfTheTable(): readonly EngineExitCode[] {
  return Object.freeze([...new Set(GATE_HALTS.map((halt) => halt.exitCode))].sort((a, b) => a - b));
}

/** The rows that name a fixture of feature 141, by that fixture. */
export function haltsOfFixture(fixture: string): readonly GateHalt[] {
  return Object.freeze(GATE_HALTS.filter((halt) => halt.fixtures.includes(fixture)));
}
