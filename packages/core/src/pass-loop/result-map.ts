/**
 * The ONE TABLE from a result of the pass loop to the engine's exit and its
 * stop reason (F103-FR-019).
 *
 * The engine maps the result by this table and by nothing else, and ONLY WHEN
 * PHASE EVIDENCE IS ABSENT. With phase evidence present every result except 6
 * is ignored (F103-FR-005): from the moment phase evidence exists no limit and
 * no breaker of the pass loop stops the run.
 *
 * ## The order of the two tables
 *
 * A result that carries the field `blocked` is mapped by the table of BLOCKED
 * REASONS of annex E §E.2 BEFORE the code table is consulted. The code table
 * applies only to a result without that field. This is the rule a reader is
 * most likely to get backwards, which is why `mapResult` tests `blocked`
 * first and `BLOCKED_IS_CONSULTED_FIRST` records it.
 *
 * The two blocked reasons the pass loop can report are `source-changed`
 * (F103-FR-021, which ends the engine with exit 3 and the stop reason
 * `critic_config`) and `declared-block` (F103-FR-018, exit 4 and
 * `proposer_no_progress`). Every other blocked reason of §E.2 is reported by
 * the engine and not by the loop.
 *
 * ## The result 4 writes no stop line of its own
 *
 * Defect D-45 is preserved: on the pass limit the loop prints its line but
 * writes NO stop line, and the engine writes `run_stop` with the reason
 * `proposer_max_iter`. `LOOP_WRITES_A_STOP_LINE` holds which results the loop
 * writes a stop line for, so that a caller does not write two or none.
 */

/** The requirement this module carries out. */
export const REQUIREMENT = "F103-FR-019" as const;

/** The design file the table is taken from. */
export const TABLE_FILE = "specs/103-proposer-pass/contracts/result-map.json" as const;

/** F103-FR-019 — the mapping applies ONLY when phase evidence is absent. */
export const APPLIES_ONLY_WHEN_EVIDENCE_IS_ABSENT = true as const;

/** F103-FR-005 — with phase evidence present every result except 6 is ignored. */
export const RESULT_EXAMINED_WITH_EVIDENCE_PRESENT = 6 as const;

/** F103-FR-019 — a result with the field `blocked` is mapped by §E.2 FIRST. */
export const BLOCKED_IS_CONSULTED_FIRST = true as const;

/** One row of the code table. */
export type CodeRow = {
  /** The result of the pass loop. */
  readonly result: number;
  /** The exit code of the engine. */
  readonly engineExit: number;
  /** The stop reason of annex E §E.3 the engine writes. */
  readonly stopReason: string;
  /** Whether the pass LOOP writes a stop line of its own for this result. */
  readonly loopWritesStopLine: boolean;
};

/**
 * F103-FR-019 — the code table, in the order the requirement lists it: the
 * results 4, 7, 8, 9 and 10 end the engine with exit 4 and their stop reasons
 * in that order, and the result 6 ends it with exit 6.
 */
export const CODE_ROWS: readonly CodeRow[] = Object.freeze([
  Object.freeze({
    result: 4,
    engineExit: 4,
    stopReason: "proposer_max_iter",
    // Defect D-45, preserved: the loop writes no stop line of its own.
    loopWritesStopLine: false,
  }),
  Object.freeze({
    result: 7,
    engineExit: 4,
    stopReason: "proposer_consecutive_errors",
    loopWritesStopLine: true,
  }),
  Object.freeze({
    result: 8,
    engineExit: 4,
    stopReason: "proposer_no_progress",
    loopWritesStopLine: true,
  }),
  Object.freeze({
    result: 9,
    engineExit: 4,
    stopReason: "proposer_yield_budget",
    loopWritesStopLine: true,
  }),
  Object.freeze({
    result: 10,
    engineExit: 4,
    stopReason: "proposer_cap_exhausted",
    loopWritesStopLine: true,
  }),
  Object.freeze({ result: 6, engineExit: 6, stopReason: "stop_flag", loopWritesStopLine: false }),
]);

/** The defect of the baseline the result 4 preserves (F103-FR-011). */
export const PRESERVED_DEFECT = "D-45" as const;

/** Which results the pass LOOP writes a stop line of its own for. */
export const LOOP_WRITES_A_STOP_LINE: Readonly<Record<number, boolean>> = Object.freeze(
  Object.fromEntries(CODE_ROWS.map((row) => [row.result, row.loopWritesStopLine])),
);

/**
 * F103-FR-019 — every OTHER result without phase evidence, 0, 1 and 3
 * included, ends the engine with exit 1, the stop reason
 * `proposer_no_evidence`, the field `rc` and the line below.
 */
export const OTHER_RESULT = Object.freeze({
  engineExit: 1,
  stopReason: "proposer_no_evidence",
  field: "rc",
});

/** F103-FR-019 — the line of a result that has no row of the code table. */
export function noEvidenceLine(rc: number, phase: number): string {
  return `>>> proposer exited (${rc}) without writing evidence for phase ${phase} — internal error.`;
}

/** One row of the table of blocked reasons the pass loop can report (§E.2). */
export type BlockedRow = {
  readonly blocked: "declared-block" | "source-changed";
  readonly engineExit: number;
  readonly stopReason: string;
  readonly retryable: boolean;
  readonly state: string;
};

/**
 * F103-FR-018 and F103-FR-021 — the two blocked reasons the pass loop can
 * report. Every other reason of §E.2 is the engine's.
 */
export const BLOCKED_ROWS: readonly BlockedRow[] = Object.freeze([
  Object.freeze({
    blocked: "declared-block" as const,
    engineExit: 4,
    stopReason: "proposer_no_progress",
    retryable: false,
    state: "blocked-on-human",
  }),
  Object.freeze({
    blocked: "source-changed" as const,
    engineExit: 3,
    stopReason: "critic_config",
    retryable: false,
    state: "blocked-on-human",
  }),
]);

/** The result of the pass loop, as far as the mapping reads it. */
export type ResultToMap = {
  readonly exit_code: number;
  readonly blocked?: { readonly reason: string; readonly file?: string } | undefined;
};

/** What the engine does with a result of the pass loop. */
export type EngineOutcome = {
  readonly engineExit: number;
  readonly stopReason: string;
  /** Whether the pass loop already wrote a stop line of its own. */
  readonly loopWroteStopLine: boolean;
  /** Set where the mapping went through the table of blocked reasons. */
  readonly blockedReason?: string;
  /** The state the run rests in, for a blocked result. */
  readonly state?: string;
  /** `retryable` of the terminal record, for a blocked result. */
  readonly retryable?: boolean;
  /** The field `rc`, for a result with no row of the code table. */
  readonly rc?: number;
  /** The file that changed, for `source-changed`. */
  readonly file?: string;
};

const CODE = new Map(CODE_ROWS.map((row) => [row.result, row]));
const BLOCKED = new Map(BLOCKED_ROWS.map((row) => [row.blocked, row]));

/**
 * F103-FR-019 — the mapping. `evidencePresent` is a parameter and not an
 * assumption: with phase evidence present the engine examines no result of the
 * pass loop other than 6, and `mapResult` returns `undefined` to say so.
 */
export function mapResult(result: ResultToMap, evidencePresent = false): EngineOutcome | undefined {
  if (evidencePresent && result.exit_code !== RESULT_EXAMINED_WITH_EVIDENCE_PRESENT) {
    return undefined;
  }
  const blockedReason = result.blocked?.reason;
  if (blockedReason !== undefined) {
    const row = BLOCKED.get(blockedReason as BlockedRow["blocked"]);
    if (row !== undefined) {
      return Object.freeze({
        engineExit: row.engineExit,
        stopReason: row.stopReason,
        loopWroteStopLine: LOOP_WRITES_A_STOP_LINE[result.exit_code] ?? false,
        blockedReason: row.blocked,
        state: row.state,
        retryable: row.retryable,
        ...(result.blocked?.file !== undefined ? { file: result.blocked.file } : {}),
      });
    }
  }
  const row = CODE.get(result.exit_code);
  if (row !== undefined) {
    return Object.freeze({
      engineExit: row.engineExit,
      stopReason: row.stopReason,
      loopWroteStopLine: row.loopWritesStopLine,
    });
  }
  return Object.freeze({
    engineExit: OTHER_RESULT.engineExit,
    stopReason: OTHER_RESULT.stopReason,
    loopWroteStopLine: false,
    rc: result.exit_code,
  });
}
