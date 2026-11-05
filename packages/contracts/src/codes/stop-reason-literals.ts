/**
 * T270 — the as-is literals of the stop reasons and the other closed families
 * (annex E, §E.3; F100-FR-149, F100-FR-150).
 *
 * A slice of T080. The as-is literal of every stop reason 1 to 14 for the
 * compatibility projection, read from the field `matchedByStringAtBaseline`
 * of each entry of `stopReasons` in `data/stop-reasons.json` together with
 * the literal itself; the rule of two lines where the engine and the pass
 * loop both write a reason; and the other closed families with their as-is
 * literals — the kill reasons of the watchdogs with their class (row 10 of
 * `data/closed-sets.json`), the stage reasons (row 11), the pipeline exit
 * reasons (row 12), the launch-check refusals (row 13), the relaunch refusals
 * and the approval `classified-transient` (row 14) — as sets registered
 * through T070.
 *
 * Rows 10, 11 and 12 give no literals of their own: they refer to this table,
 * and register through T070 from here. Rows 13 and 14 hold their literals in
 * the table of §X.6 itself and are imported, not registered again.
 */
import {
  defineByReference,
  registeredSets,
  rowOf,
  type ClosedSet,
  type SetByReference,
} from "../enums/index.ts";
import { STOP_REASONS, stopReasonRows, type StopReason } from "./stop-reasons.ts";

/** The section of annex E that owns this table. */
export const ANNEX_SECTION = "annex E, §E.3" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-149 — the as-is stop line of the compatibility projection.
 * ------------------------------------------------------------------ */

/**
 * The members whose as-is literal the projection keeps: 1 to 14. Member 15,
 * `paused_quota_ceiling`, is new and has no as-is literal.
 */
export const MEMBERS_WITH_AN_AS_IS_LITERAL = STOP_REASONS.slice(0, 14) as readonly StopReason[];

/** The one member the baseline does not know (annex E, §E.3, row 15). */
export const MEMBER_WITHOUT_AN_AS_IS_LITERAL = "paused_quota_ceiling" as const;

/** One row of the as-is projection of a stop reason. */
export type AsIsStopReason = {
  /** The number of the row of §E.3, 1 to 15. */
  readonly number: number;
  /** The member of the closed set. */
  readonly literal: StopReason;
  /**
   * The literal the as-is stop line carries. For 1 to 14 it is the member
   * itself: the product keeps the baseline's spelling. Null for 15.
   */
  readonly asIsLiteral: string | null;
  /** The cell "Matched by string at the baseline" of §E.3. */
  readonly matchedByStringAtBaseline: string;
  /** True where the baseline matches the reason by string. */
  readonly matchedByString: boolean;
  /** True where the engine and the pass loop both write a line for it. */
  readonly twoLines: boolean;
};

/**
 * F100-FR-149 — the as-is literal of every member. For 1 to 14 the as-is
 * literal is the member's own spelling: the projection keeps writing the
 * as-is stop line with it.
 */
export const asIsStopReasons: readonly AsIsStopReason[] = Object.freeze(
  stopReasonRows.map((row) =>
    Object.freeze({
      number: row.number,
      literal: row.literal,
      asIsLiteral: row.number <= 14 ? row.literal : null,
      matchedByStringAtBaseline: row.matchedByStringAtBaseline,
      matchedByString: /^yes$/i.test(row.matchedByStringAtBaseline.trim()),
      twoLines: row.writtenByTheEngine && row.writtenByThePassLoop,
    }),
  ),
);

const AS_IS = new Map(asIsStopReasons.map((r) => [r.literal, r]));

/** The as-is literal of a stop reason, or null for member 15 (F100-FR-149). */
export function asIsLiteralOf(literal: string): string | null | undefined {
  return AS_IS.get(literal as StopReason)?.asIsLiteral;
}

/** The members where the engine and the pass loop both write a reason. */
export const MEMBERS_WITH_TWO_LINES: readonly StopReason[] = Object.freeze(
  asIsStopReasons.filter((r) => r.twoLines).map((r) => r.literal),
);

/**
 * F100-FR-149 — the rule of two lines. Where the engine and the pass loop
 * both write a reason for one stop, the projection holds two lines with
 * different fields: the engine's line is the newer one, and the line of the
 * pass loop carries the as-is iteration field.
 */
export const TWO_LINE_RULE = {
  lines: 2,
  newerLineWrittenBy: "engine",
  olderLineWrittenBy: "pass loop",
  theLineOfThePassLoopCarries: "the as-is iteration field",
  fieldsDiffer: true,
} as const;

/** One line of the as-is projection of a stop. */
export type AsIsStopLine = {
  /** Who wrote the line. */
  readonly writtenBy: "engine" | "pass loop";
  /** The as-is literal of the reason. */
  readonly reason: string;
  /** True for the newer of the two lines. */
  readonly newer: boolean;
  /** Set on the line of the pass loop: the as-is iteration field. */
  readonly iterationField?: true;
};

/**
 * F100-FR-149 — the lines the projection holds for one stop: one line, or two
 * where the engine and the pass loop both write the reason.
 */
export function asIsStopLines(literal: string): readonly AsIsStopLine[] {
  const row = AS_IS.get(literal as StopReason);
  if (row === undefined || row.asIsLiteral === null) return Object.freeze([]);
  const reason = row.asIsLiteral;
  if (!row.twoLines) {
    const single = stopReasonRows.find((r) => r.literal === literal);
    const writtenBy = single?.writtenByTheEngine === true ? "engine" : "pass loop";
    return Object.freeze([
      Object.freeze({
        writtenBy,
        reason,
        newer: true,
        ...(writtenBy === "pass loop" ? { iterationField: true as const } : {}),
      }),
    ]);
  }
  return Object.freeze([
    Object.freeze({
      writtenBy: "pass loop" as const,
      reason,
      newer: false,
      iterationField: true as const,
    }),
    Object.freeze({ writtenBy: "engine" as const, reason, newer: true }),
  ]);
}

/**
 * F100-FR-149 — the only outcome literal of the as-is end line of a run.
 */
export const ALL_APPROVED = "all_approved" as const;

/** F100-FR-149 — there is exactly one outcome literal, and it is that one. */
export const AS_IS_END_LINE_OUTCOME_LITERALS = [ALL_APPROVED] as const;

/**
 * F100-FR-149 — the four literals that learning reads as arbitration signals
 * keep their meaning unchanged.
 */
export const ARBITRATION_LITERALS = [
  "max_rejects",
  "gate_oscillation",
  "critic_config",
  "proposer_no_progress",
] as const;

/** An arbitration literal (F100-FR-149). */
export type ArbitrationLiteral = (typeof ARBITRATION_LITERALS)[number];

/** True where the literal is one of the four arbitration signals. */
export function isArbitrationLiteral(value: string): value is ArbitrationLiteral {
  return (ARBITRATION_LITERALS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * F100-FR-150 — the closed families that are not stop reasons.
 * ------------------------------------------------------------------ */

/** The classes a kill reason of a watchdog carries (annex E, F100-FR-150). */
export const KILL_CLASSES = ["hang", "futility", "budget"] as const;
export type KillClass = (typeof KILL_CLASSES)[number];

/** The kill reasons of the watchdogs, with their class (F100-FR-150). */
export const KILL_REASONS = ["idle_timeout", "repeat_stall", "progress_stall", "hard_cap"] as const;
export type KillReason = (typeof KILL_REASONS)[number];

/** Row 10 of §X.6 — kill reasons, registered through T070 from here. */
export const killReasonSet: SetByReference<KillReason> = defineByReference(10, KILL_REASONS);

/** The class of every kill reason (annex E, F100-FR-150). */
export const KILL_REASON_CLASSES: Readonly<Record<KillReason, KillClass>> = Object.freeze({
  idle_timeout: "hang",
  repeat_stall: "futility",
  progress_stall: "futility",
  hard_cap: "budget",
});

/** The class of a kill reason; row 10's unknown value is `futility`. */
export function killClassOf(reason: string): KillClass {
  return KILL_REASON_CLASSES[reason as KillReason] ?? "futility";
}

/** The transient stage reasons (annex E, F100-FR-150). */
export const TRANSIENT_STAGE_REASONS = [
  "exit",
  "timeout",
  "recovery-deadline",
  "recovery-exhausted",
] as const;

/**
 * The deliberate stage reasons (annex E, F100-FR-150). `exec-error:` carries
 * a detail after the colon; the member is the prefix.
 */
export const DELIBERATE_STAGE_REASONS = [
  "postcondition",
  "stage-precondition",
  "setup-required",
  "interrupted",
  "existing-prerequisite",
  "completed",
  "exec-error:",
] as const;

/** Every stage reason, transient then deliberate (F100-FR-150). */
export const STAGE_REASONS = [...TRANSIENT_STAGE_REASONS, ...DELIBERATE_STAGE_REASONS] as const;
export type StageReason = (typeof STAGE_REASONS)[number];

/** Row 11 of §X.6 — stage reasons, registered through T070 from here. */
export const stageReasonSet: SetByReference<StageReason> = defineByReference(11, STAGE_REASONS);

/** True where the stage reason is transient; row 11's unknown value is not. */
export function stageReasonIsTransient(reason: string): boolean {
  return (TRANSIENT_STAGE_REASONS as readonly string[]).includes(reason);
}

/** The detail of `exec-error:<detail>`, where the reason carries one. */
export function execErrorDetail(reason: string): string | undefined {
  return reason.startsWith("exec-error:") ? reason.slice("exec-error:".length) : undefined;
}

/**
 * The pipeline exit reasons (annex E, F100-FR-150): `preflight`,
 * `all-stages-complete`, or a stage reason.
 */
export const PIPELINE_EXIT_REASONS = [
  "preflight",
  "all-stages-complete",
  ...STAGE_REASONS,
] as const;
export type PipelineExitReason = (typeof PIPELINE_EXIT_REASONS)[number];

/** Row 12 of §X.6 — pipeline exit reasons, registered through T070 here. */
export const pipelineExitReasonSet: SetByReference<PipelineExitReason> = defineByReference(
  12,
  PIPELINE_EXIT_REASONS,
);

/**
 * Row 13 of §X.6 — the refusals of the launch checks. The row holds its own
 * literals in the table of §X.6, so this table reads them from the row and
 * does not register the set a second time (F100-FR-150).
 */
export const LAUNCH_CHECK_REFUSALS: readonly string[] = Object.freeze([
  ...(rowOf(13)?.literals ?? []),
]);

/**
 * Row 14 of §X.6 — the relaunch refusals of both classifier tables and the
 * approval `classified-transient`, read from the row (F100-FR-150).
 */
export const RELAUNCH_REFUSALS: readonly string[] = Object.freeze([...(rowOf(14)?.literals ?? [])]);

/**
 * The set of a family, read from the one map of T070 at call time. Rows 10,
 * 11 and 12 register from this module; rows 13 and 14 register from the
 * batch file of their owner, feature 123.
 */
export function closedSetOfFamily(row: number): ClosedSet | undefined {
  return registeredSets().get(row);
}

/** The approval that row 14 names beside the refusals (F100-FR-150). */
export const APPROVAL_CLASSIFIED_TRANSIENT = "classified-transient" as const;

/**
 * F100-FR-150 — the closed families that are not stop reasons, each with the
 * row of §X.6 that lists it and the set that holds its as-is literals.
 */
export const OTHER_CLOSED_FAMILIES = Object.freeze([
  Object.freeze({
    row: 10,
    family: "Kill reasons of the watchdogs, with their class",
    members: killReasonSet.members as readonly string[],
    registeredHere: true,
  }),
  Object.freeze({
    row: 11,
    family: "Stage reasons, transient and deliberate",
    members: stageReasonSet.members as readonly string[],
    registeredHere: true,
  }),
  Object.freeze({
    row: 12,
    family: "Pipeline exit reasons",
    members: pipelineExitReasonSet.members as readonly string[],
    registeredHere: true,
  }),
  Object.freeze({
    row: 13,
    family: "Launch-check refusals",
    members: LAUNCH_CHECK_REFUSALS,
    registeredHere: false,
  }),
  Object.freeze({
    row: 14,
    family: "Relaunch refusals and the approval `classified-transient`",
    members: RELAUNCH_REFUSALS,
    registeredHere: false,
  }),
]);
