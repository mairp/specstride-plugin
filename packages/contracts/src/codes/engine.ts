/**
 * T085 — the exit codes of the engine (annex E, §E.4, "Engine";
 * F100-FR-151, F100-FR-152).
 *
 * The codes 0 to 6, and 70, with their meaning and their stop reasons, read
 * from the entry `Engine` of the key `engine` of `data/exit-codes.json` as a
 * closed set registered through T070, and the mapping from the result of the
 * pass loop to an engine code, applied only when phase evidence is absent.
 *
 * Row 6 of `data/closed-sets.json` gives no literals of its own: it refers to
 * this table, and registers through T070 from here (`engineExitCodeSet`).
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };
import { defineByReference, type SetByReference } from "../enums/index.ts";
import { isStopReason, type StopReason } from "./stop-reasons.ts";

/** The section of annex E that owns this table. */
export const ANNEX_SECTION = 'annex E, §E.4, "Engine"' as const;

type RawEngineRow = { Code: string; Meaning: string; "Stop reasons": string };
type RawTable = { process: string; rows: Record<string, string>[] };

const TABLES = (exitCodes as { engine: RawTable[] }).engine;

/** The entry of the key `engine` whose `process` cell is the one named. */
export function engineTable(process: string): RawTable {
  const table = TABLES.find((t) => t.process === process);
  if (table === undefined) {
    throw new Error(`the key \`engine\` of data/exit-codes.json holds no entry \`${process}\``);
  }
  return table;
}

const ENGINE_ROWS = engineTable("Engine").rows as unknown as RawEngineRow[];

/** The literals of the members a "Stop reasons" cell names. */
function stopReasonsOfCell(cell: string): readonly StopReason[] {
  return Object.freeze(
    [...cell.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1] ?? "")
      .filter((value): value is StopReason => isStopReason(value)),
  );
}

/** The exit codes of the engine, in the order of the annex (F100-FR-151). */
export const ENGINE_EXIT_CODES = [0, 1, 2, 3, 4, 5, 6, 70] as const;

/** An exit code of the engine (annex E, §E.4). */
export type EngineExitCode = (typeof ENGINE_EXIT_CODES)[number];

/** Row 6 of §X.6 — engine exit codes, registered through T070 from here. */
export const engineExitCodeSet: SetByReference<`${EngineExitCode}`> = defineByReference(
  6,
  ENGINE_EXIT_CODES.map((c) => String(c)) as unknown as readonly `${EngineExitCode}`[],
);

/** One row of the table "Engine" of §E.4. */
export type EngineExitRow = {
  /** The code the engine exits with. */
  readonly code: EngineExitCode;
  /** The cell "Meaning": every cause that maps to this code. */
  readonly meaning: string;
  /** The members of §E.3 the column "Stop reasons" names. */
  readonly stopReasons: readonly StopReason[];
  /** The cell "Stop reasons", verbatim. */
  readonly stopReasonsCell: string;
  /** True where the cell is "—": the terminal record holds null. */
  readonly noMember: boolean;
  /** True for a termination of a run: the seven codes 0 to 6. */
  readonly termination: boolean;
};

/** Every row of the table "Engine", in the order of the annex. */
export const engineExitRows: readonly EngineExitRow[] = Object.freeze(
  ENGINE_ROWS.map((row) =>
    Object.freeze({
      code: Number(row.Code) as EngineExitCode,
      meaning: row.Meaning,
      stopReasons: stopReasonsOfCell(row["Stop reasons"]),
      stopReasonsCell: row["Stop reasons"],
      noMember: row["Stop reasons"].trim() === "—",
      termination: Number(row.Code) <= 6,
    }),
  ),
);

const ROW = new Map(engineExitRows.map((r) => [r.code, r]));

/** The row of an engine exit code (F100-FR-151). */
export function engineExitRow(code: number): EngineExitRow | undefined {
  return ROW.get(code as EngineExitCode);
}

/** The members of §E.3 that a code carries (F100-FR-148, F100-FR-151). */
export function stopReasonsOf(code: number): readonly StopReason[] {
  return ROW.get(code as EngineExitCode)?.stopReasons ?? Object.freeze([]);
}

/** True when the number is one of the codes of the table (F100-FR-151). */
export function isEngineExitCode(code: number): code is EngineExitCode {
  return (ENGINE_EXIT_CODES as readonly number[]).includes(code);
}

/* ------------------------------------------------------------------ *
 * F100-FR-152 — the seven codes of a termination of a run.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-152 — the shared vocabulary of the Specstride baseline and Lisa:
 * done 0, internal 1, rejects 2, spec 3, budget 4, lock 5, stop 6. Seven
 * names and seven numbers.
 */
export const TERMINATION_VOCABULARY = Object.freeze([
  Object.freeze({ name: "done", code: 0 }),
  Object.freeze({ name: "internal", code: 1 }),
  Object.freeze({ name: "rejects", code: 2 }),
  Object.freeze({ name: "spec", code: 3 }),
  Object.freeze({ name: "budget", code: 4 }),
  Object.freeze({ name: "lock", code: 5 }),
  Object.freeze({ name: "stop", code: 6 }),
]);

/** The seven names of the vocabulary (F100-FR-152). */
export const TERMINATION_NAMES = Object.freeze(
  TERMINATION_VOCABULARY.map((v) => v.name),
) as readonly string[];

/** The seven numbers of the vocabulary (F100-FR-152). */
export const TERMINATION_CODES = Object.freeze(
  TERMINATION_VOCABULARY.map((v) => v.code),
) as readonly number[];

/** The name of a termination code, or `undefined` for 70 (F100-FR-152). */
export function terminationNameOf(code: number): string | undefined {
  return TERMINATION_VOCABULARY.find((v) => v.code === code)?.name;
}

/**
 * F100-FR-152 — code 70 is for an uncaught error of a command and is not a
 * termination of a run.
 */
export const UNCAUGHT_ERROR_CODE = 70 as const;
export const UNCAUGHT_ERROR_IS_A_TERMINATION = false as const;

/** True for one of the seven codes 0 to 6 (F100-FR-152). */
export function isTerminationCode(code: number): boolean {
  return (TERMINATION_CODES as readonly number[]).includes(code);
}

/* ------------------------------------------------------------------ *
 * F100-FR-151 — the mapping from the result of the pass loop.
 * ------------------------------------------------------------------ */

/**
 * The results of the pass loop the annex maps to an engine code. The cell of
 * code 4 names the results 4, 7, 8, 9 and 10; code 6 names the result 6;
 * code 1 names the proposer ending without phase evidence.
 */
export const PASS_LOOP_RESULT_TO_ENGINE_CODE: Readonly<Record<number, EngineExitCode>> =
  Object.freeze({
    0: 0,
    1: 1,
    3: 3,
    4: 4,
    6: 6,
    7: 4,
    8: 4,
    9: 4,
    10: 4,
  });

/**
 * F100-FR-151 — the mapping applies only when phase evidence is absent. With
 * phase evidence present, every result of the pass loop except 6 is ignored
 * (annex E §E.4, the note after the table "Engine").
 */
export const MAPPING_APPLIES_ONLY_WHEN_PHASE_EVIDENCE_IS_ABSENT = true as const;

/** The result of the pass loop as the engine reads it. */
export type PassLoopOutcome = {
  /** The `exit_code` of the result record of the pass loop. */
  readonly exitCode: number;
  /** Whether the pass wrote phase evidence. */
  readonly phaseEvidence: boolean;
};

/**
 * F100-FR-151 — the engine code for a result of the pass loop. Applied only
 * when phase evidence is absent; with evidence present every result except 6
 * is ignored, and the engine goes on to the phase gate (`undefined`).
 *
 * A result the table does not hold and that has no mapping ends the engine
 * with 1 and the stop reason `proposer_no_evidence` (§E.4, code 1).
 */
export function engineCodeFor(outcome: PassLoopOutcome): EngineExitCode | undefined {
  if (outcome.exitCode === 6) return 6;
  if (outcome.phaseEvidence) return undefined;
  const mapped = PASS_LOOP_RESULT_TO_ENGINE_CODE[outcome.exitCode];
  return mapped ?? 1;
}

/**
 * F100-FR-151 — every cause of a halt maps to exactly one code: no number
 * appears in two rows, and the rows cover the codes of the table.
 */
export function codeOfEveryHaltIsUnique(): boolean {
  const codes = engineExitRows.map((r) => r.code);
  return new Set(codes).size === codes.length;
}
