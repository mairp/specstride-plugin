/**
 * T090 — the exit codes of the runtime root and the pipeline entry (annex F,
 * §F.8; F100-FR-168, F100-FR-169).
 *
 * The codes 0, 2, 20 to 24 and 128+N, and the status of a stage child, read
 * from the key `runtimeRootAndPipelineEntry` of `data/exit-codes.json`, as
 * data and types, registered through T070 by way of row 7 of
 * `data/closed-sets.json` (the codes per command, T093).
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };

/** The section of annex F that owns this table. */
export const ANNEX_SECTION = "annex F, §F.8" as const;

type RawRow = { Code: string; Meaning: string };

const RAW = (exitCodes as { runtimeRootAndPipelineEntry: RawRow[] }).runtimeRootAndPipelineEntry;

/** The literal of the row that is a family and not a number (annex F, §F.8). */
export const SIGNAL_CODE_CELL = "128+N" as const;

/** The codes of the runtime root and the pipeline entry, as numbers. */
export const PIPELINE_EXIT_CODES = [0, 2, 20, 21, 22, 23, 24] as const;

/** An exit code of the runtime root or of the pipeline entry (annex F, §F.8). */
export type PipelineExitCode = (typeof PIPELINE_EXIT_CODES)[number];

/** One row of the table of §F.8. */
export type PipelineExitRow = {
  /** The cell "Code", verbatim: a number, or `128+N`. */
  readonly cell: string;
  /** The number, or `undefined` for the row `128+N`. */
  readonly code: PipelineExitCode | undefined;
  /** The cell "Meaning". */
  readonly meaning: string;
  /** True for the row `128+N`. */
  readonly signalFamily: boolean;
};

/** Every row of the table, in the order of the annex (F100-FR-168). */
export const pipelineExitRows: readonly PipelineExitRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      cell: row.Code,
      code: row.Code === SIGNAL_CODE_CELL ? undefined : (Number(row.Code) as PipelineExitCode),
      meaning: row.Meaning,
      signalFamily: row.Code === SIGNAL_CODE_CELL,
    }),
  ),
);

const ROW = new Map(
  pipelineExitRows.filter((r) => r.code !== undefined).map((r) => [r.code as number, r]),
);

/** The row of a code of §F.8 (F100-FR-168). */
export function pipelineExitRow(code: number): PipelineExitRow | undefined {
  return ROW.get(code);
}

/** True for one of the seven numbers of §F.8. */
export function isPipelineExitCode(code: number): code is PipelineExitCode {
  return (PIPELINE_EXIT_CODES as readonly number[]).includes(code);
}

/**
 * F100-FR-168 — each class of failure of the launcher maps to one distinct
 * code: 20 invalid, 21 preflight, 22 stage, 23 stale, 24 lock.
 */
export const FAILURE_CLASSES = Object.freeze({
  invalid: 20,
  preflight: 21,
  stage: 22,
  stale: 23,
  lock: 24,
} as const);

/** A class of failure of the launcher (F100-FR-168). */
export type FailureClass = keyof typeof FAILURE_CLASSES;

/** The code of a class of failure (F100-FR-168). */
export function codeOfFailureClass(failureClass: FailureClass): number {
  return FAILURE_CLASSES[failureClass];
}

/** The five codes of the classes of failure, each distinct (F100-FR-168). */
export const FAILURE_CLASS_CODES: readonly number[] = Object.freeze(Object.values(FAILURE_CLASSES));

/**
 * Annex F §F.8 — ended by the signal N (interrupt, termination, hang-up).
 * The three signals the annex names, with their numbers.
 */
export const SIGNALS = Object.freeze({ interrupt: 2, termination: 15, "hang-up": 1 } as const);

/** The exit code of a process ended by the signal N: 128 + N (§F.8). */
export function signalCode(n: number): number {
  return 128 + n;
}

/** The signal a code 128+N names, or `undefined` (§F.8). */
export function signalOf(code: number): number | undefined {
  return code > 128 && code < 256 ? code - 128 : undefined;
}

/* ------------------------------------------------------------------ *
 * The status of a stage child (annex F, §F.8).
 * ------------------------------------------------------------------ */

/**
 * Annex F §F.8 — the status of a stage child, kept in the record of the
 * stage: 124 on a timeout, 127 when the action cannot start.
 */
export const STAGE_CHILD_STATUS = Object.freeze({ timeout: 124, cannotStart: 127 } as const);

/** A status of a stage child kept in the record of the stage (§F.8). */
export type StageChildStatus = (typeof STAGE_CHILD_STATUS)[keyof typeof STAGE_CHILD_STATUS];

/** The status of a stage child, kept in the record of the stage (§F.8). */
export type StageChildRecord = {
  /** The status of the child: a number of §F.8, or the code it exited with. */
  readonly status: number;
  /** Where the status is kept. */
  readonly keptIn: "the record of the stage";
};

/** The record of a stage child's status (§F.8). */
export function stageChildStatus(status: number): StageChildRecord {
  return Object.freeze({ status, keptIn: "the record of the stage" as const });
}

/**
 * Annex F §F.8 — the 6 of a stage child becomes the pipeline code 22 with
 * the state `stopped` (the row of code 22, and the collisions table of §G.4).
 */
export const STAGE_CHILD_SIX_BECOMES = Object.freeze({
  childExitCode: 6,
  pipelineCode: 22,
  pipelineState: "stopped",
} as const);

/** The pipeline code for the exit code of a stage child (§F.8). */
export function pipelineCodeOfStageChild(childExitCode: number): number {
  return childExitCode === 0 ? 0 : FAILURE_CLASSES.stage;
}

/* ------------------------------------------------------------------ *
 * F100-FR-169 — the root that stays alive after a failed stage.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-169 — with `relaunch.owner: root` the runtime root stays alive
 * after a failed stage, so 22 is the code with which the root finally exits
 * when it does not relaunch, and the pipeline state and the digest show the
 * same values as with `supervise`.
 */
export const ROOT_THAT_DOES_NOT_RELAUNCH = Object.freeze({
  relaunchOwner: "root",
  staysAliveAfterAFailedStage: true,
  finalExitCodeWhenItDoesNotRelaunch: 22,
  pipelineStateAndDigestEqualThoseOf: "supervise",
} as const);

/**
 * F100-FR-169 — the code with which the root finally exits: 22 where a stage
 * failed and it does not relaunch, whatever the owner of relaunch.
 */
export function finalCodeOfTheRoot(input: {
  readonly aStageFailed: boolean;
  readonly relaunched: boolean;
}): number {
  return input.aStageFailed && !input.relaunched ? FAILURE_CLASSES.stage : 0;
}
