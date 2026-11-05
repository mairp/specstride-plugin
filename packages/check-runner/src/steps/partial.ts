/**
 * T058 — the `partial` run of steps (F148-FR-009).
 *
 * A **run of steps** is ONE EXECUTION of the steps of ONE command. It is never
 * the logical run (`spec.md`, W-X-06), and
 * `RUN_OF_STEPS_IS_NEVER_THE_LOGICAL_RUN` says so as data beside the two
 * members of row 235 of annex X §X.6.
 *
 * Four rules of F148-FR-009 are code here, not prose:
 *
 *  1. **A run of steps that started from a step other than the first is
 *     `partial`.** `stateOfARunOfSteps` is the one reader of that rule; it
 *     takes the 1-based position the run started from and nothing else, so a
 *     run cannot be called `full` by any other means. The two members come
 *     from `../result/closed-sets.ts`, whose row 235 has `partial` as its
 *     unknown value — an unreadable state is read as `partial`, the state that
 *     never satisfies the gate.
 *  2. **A `partial` run carries `unchecked` with the reason `partial`.**
 *     `markPartial` sets it through `withCondition`, so the exit result is
 *     copied across untouched (F148-FR-003): the steps that ran still report
 *     what they observed, and only the STATEMENT of a pass is withheld.
 *  3. **A `partial` run never satisfies the verification gate and is never
 *     stated as a pass.** `satisfiesTheVerificationGate` is the reader, and it
 *     refuses a `partial` run even where every step that ran passed and the
 *     exit code is 0 — which is exactly acceptance scenario 2 of user story 5.
 *  4. **The run of steps that serves the verification gate starts at the first
 *     step**, apart from results of commands staged before, which the OWNER OF
 *     THE VERIFICATION GATE takes over and records under
 *     `attempt:<N>:<k>:<n>:prestage` (feature 100, annex B §B.5).
 *     `refuseAPartialRunAtTheGate` is that rule, and `prestageLogicalName`
 *     builds the one logical name the exception names. This feature records
 *     nothing under it: it is named here so the exception is not mistaken for
 *     a licence to hand the gate a resumed run.
 */
import { stepRunStates, type StepRunState, type UncheckedReason } from "../result/closed-sets.ts";
import { statedAsPass, withCondition, type RunnerResult, type StepRun } from "../result/result.ts";
import type { StepOutcome } from "./step-runner.ts";

/**
 * Row 235 of annex X §X.6 — the two states of a run of steps. The members and
 * the set itself live in `../result/closed-sets.ts` (T008) and are not
 * re-exported here: one export of a closed set per package.
 */
export const STEP_RUN_STATE_ROW = 235 as const;

/** `spec.md`, W-X-06 — a run of steps is one execution, never the logical run. */
export const RUN_OF_STEPS_IS_NEVER_THE_LOGICAL_RUN = true as const;

/** What a run of steps is, in the words of the specification. */
export const WHAT_A_RUN_OF_STEPS_IS =
  "one execution of the steps of one command; it is never the logical run";

/** The state of a run that started at the first step. */
export const FULL: StepRunState = "full";

/** The state of a run that did not start at the first step. */
export const PARTIAL: StepRunState = "partial";

/** F148-FR-003, F148-FR-009 — the reason `partial` carries on `unchecked`. */
export const PARTIAL_REASON: UncheckedReason = "partial";

/** F148-FR-009 — a `partial` run of steps never satisfies the verification gate. */
export const PARTIAL_SATISFIES_THE_GATE = false as const;

/** F148-FR-009 — a `partial` run of steps is never stated as a pass. */
export const PARTIAL_IS_EVER_STATED_AS_A_PASS = false as const;

/** The 1-based position of the first step: the only start a `full` run has. */
export const THE_FIRST_STEP = 1 as const;

/**
 * F148-FR-009 — the state of a run of steps, from the 1-based position it
 * started at. A run that started at step 1 is `full`; a run that started
 * anywhere else is `partial`. A position that is not a whole number at or
 * above 1 is read through the unknown-value branch of row 235, which gives
 * `partial`.
 */
export function stateOfARunOfSteps(startedAtPosition: number): StepRunState {
  if (!Number.isInteger(startedAtPosition) || startedAtPosition < THE_FIRST_STEP) {
    return stepRunStates.branch(String(startedAtPosition)).member ?? PARTIAL;
  }
  return startedAtPosition === THE_FIRST_STEP ? FULL : PARTIAL;
}

/**
 * One execution of the steps of one command, as it is recorded INSIDE the
 * result record of its command (F148-FR-008; feature 100, annex D §D.8, field
 * `entries[].steps`). `startedAt` is the id of the step the run started from,
 * which is the field `StepRun` of `../result/result.ts` names.
 */
export type RunOfSteps = StepRun & {
  readonly state: StepRunState;
  readonly steps: readonly StepOutcome[];
  /** The 1-based position the run started at. */
  readonly startedAtPosition: number;
  /** The id of the failed required step the run stopped at, or null. */
  readonly stoppedAt: string | null;
  /** How many steps this execution ran. */
  readonly ran: number;
  /** Steps after the stop, which this execution did not run. */
  readonly notRun: number;
  /** Steps before the start of this execution: why the run is `partial`. */
  readonly beforeTheStart: number;
  /** True where the run did not start at the first step. */
  readonly resumed: boolean;
};

/** F148-FR-008, F148-FR-009 — the record of one execution of the steps. */
export function runOfSteps(
  outcomes: readonly StepOutcome[],
  startedAtPosition: number,
): RunOfSteps {
  const state = stateOfARunOfSteps(startedAtPosition);
  const first = outcomes.find((step) => step.position === startedAtPosition);
  return Object.freeze({
    state,
    startedAt: first?.id ?? "",
    startedAtPosition,
    steps: Object.freeze([...outcomes]),
    stoppedAt: outcomes.find((step) => step.stoppedTheRun)?.id ?? null,
    ran: outcomes.filter((step) => step.ran).length,
    notRun: outcomes.filter((step) => step.state === "not-run").length,
    beforeTheStart: outcomes.filter((step) => step.state === "before-the-start").length,
    resumed: state === PARTIAL,
  });
}

/** True where the run of steps did not start at the first step. */
export function isPartial(run: RunOfSteps | StepRun | null): boolean {
  return run !== null && run.state === PARTIAL;
}

/**
 * F148-FR-003, F148-FR-009 — a `partial` run of steps carries `unchecked`
 * with the reason `partial`. The exit result is copied across untouched:
 * `withCondition` refuses a caller that names an exit-result field, so what
 * the steps observed stands beside the condition and is not replaced by it.
 */
export function markPartial(result: RunnerResult): RunnerResult {
  return withCondition(result, "unchecked", PARTIAL_REASON);
}

/**
 * F148-FR-009 — does the result satisfy the verification gate? A `partial` run
 * of steps NEVER does, whatever its exit result: the condition `unchecked`
 * with the reason `partial` forbids the statement of a pass, and this reader
 * checks the run of steps itself as well, so a result whose condition was
 * stripped is still refused.
 */
export function satisfiesTheVerificationGate(result: RunnerResult): boolean {
  if (isPartial(result.steps)) return PARTIAL_SATISFIES_THE_GATE;
  return statedAsPass(result);
}

/** Why a result does not satisfy the gate, or null where it does. */
export function whyItDoesNotSatisfyTheGate(result: RunnerResult): string | null {
  if (isPartial(result.steps)) {
    return `the run of steps is \`${PARTIAL}\`: it started at step ${String(
      (result.steps as RunOfSteps).startedAtPosition,
    )} and not at step ${String(THE_FIRST_STEP)} (F148-FR-009)`;
  }
  if (statedAsPass(result)) return null;
  if (!result.passed) return "the exit result of the command is not a pass";
  return `the result carries a condition that forbids a pass (\`${result.reason ?? ""}\`)`;
}

/* ------------------------------------------------------------------ *
 * The run that serves the verification gate, and its one exception.
 * ------------------------------------------------------------------ */

/** F148-FR-009 — the run of steps that serves the verification gate starts at step 1. */
export const GATE_RUN_STARTS_AT_THE_FIRST_STEP = true as const;

/**
 * The one exception of F148-FR-009: results of commands STAGED BEFORE, which
 * the owner of the verification gate takes over and records under this
 * logical name (feature 100, annex B §B.5). The check runner records nothing
 * under it.
 */
export const PRESTAGE_LOGICAL_NAME = "attempt:<N>:<k>:<n>:prestage" as const;
export const PRESTAGE_IS_RECORDED_BY = "the owner of the verification gate (feature 105)";
export const PRESTAGE_IS_RECORDED_BY_THIS_FEATURE = false as const;

/** The logical name of annex B §B.5 for one attempt, phase and command. */
export function prestageLogicalName(attempt: number, phase: number, command: number): string {
  return `attempt:${String(attempt)}:${String(phase)}:${String(command)}:prestage`;
}

/** Raised where a run of steps that serves the verification gate is `partial`. */
export class PartialRunAtTheGateError extends Error {
  readonly commandId: string;
  readonly startedAtPosition: number;
  constructor(commandId: string, startedAtPosition: number) {
    super(
      `the run of steps of \`${commandId}\` started at step ${String(startedAtPosition)}; the ` +
        `run of steps that serves the verification gate starts at the first step, and a ` +
        `\`${PARTIAL}\` run never satisfies the gate (F148-FR-009). The one exception is a ` +
        `result of a command staged before, which ${PRESTAGE_IS_RECORDED_BY} takes over and ` +
        `records under \`${PRESTAGE_LOGICAL_NAME}\``,
    );
    this.name = "PartialRunAtTheGateError";
    this.commandId = commandId;
    this.startedAtPosition = startedAtPosition;
  }
}

/**
 * F148-FR-009 — the rule for a caller that means to serve the verification
 * gate with a run of steps: it starts at the first step. A `partial` run is
 * refused here rather than silently counted, so the gate cannot be given one
 * by accident.
 */
export function refuseAPartialRunAtTheGate(result: RunnerResult): void {
  const run = result.steps;
  if (run === null) return;
  if (isPartial(run)) {
    throw new PartialRunAtTheGateError(
      result.commandId,
      (run as RunOfSteps).startedAtPosition ?? 0,
    );
  }
}
