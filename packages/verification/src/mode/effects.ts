/**
 * T044 — the effect of each mode on a verdict (F105-FR-003).
 *
 * The requirement is five facts per mode, and it is written here as DATA — one
 * row per mode, every row with the same five fields — because the three modes
 * are a closed set and a reader must be able to put them side by side. A
 * caller asks `effectOf(mode)` and reads a field; nothing of the effect is
 * spelled a second time at a call site.
 *
 * The five fields:
 *
 *  - `planIsWritten` — `off`: no verification plan is written.
 *  - `obligationsReachAPrompt` — `off`: no verification obligation reaches a
 *    prompt and the critic receives no plan. `plan` and `required`: the
 *    verification obligations of the phase become criteria of the critic.
 *  - `gateExecutesCommands` — `off` and `plan`: the verification gate executes
 *    no command. `required`: it runs before the critic on every phase attempt.
 *  - `stagedCommandsStillRun` — `plan`: THE COMMANDS STAGED BEFORE STILL RUN
 *    before each phase attempt (F105-FR-034), for information only, as at the
 *    baseline. This is the one place the three rows are not monotone, so it is
 *    a field of its own rather than a reading of `gateExecutesCommands`.
 *  - `releaseVerificationRuns` — `required` only.
 *  - `gatesAreMarkedRequired` — ONLY the mode `required` marks the
 *    verification gates of the plan as required.
 *
 * In the modes `plan` and `off` the verdict is the critic's alone, which is
 * `verdictIsTheCriticsAlone`: the gate executes nothing that could reject.
 */
import { VERIFICATION_MODES, type VerificationMode } from "./closed-sets.ts";

/** What one mode does. Every mode has every field; none is optional. */
export type ModeEffect = {
  readonly mode: VerificationMode;
  /** Is a verification plan written at launch? */
  readonly planIsWritten: boolean;
  /** Do the verification obligations of a phase become criteria of the critic? */
  readonly obligationsReachAPrompt: boolean;
  /** Does the critic call carry the plan? */
  readonly criticReceivesThePlan: boolean;
  /** Does the verification gate execute a command? */
  readonly gateExecutesCommands: boolean;
  /** Do the commands staged before run before each phase attempt? */
  readonly stagedCommandsStillRun: boolean;
  /** Does release verification run at the end of the run? */
  readonly releaseVerificationRuns: boolean;
  /** Are the verification gates of the plan marked required? */
  readonly gatesAreMarkedRequired: boolean;
  /** Is the verdict the critic's alone? */
  readonly verdictIsTheCriticsAlone: boolean;
};

/**
 * The three rows of F105-FR-003. `required` is read as "as `plan`, and in
 * addition …", so its row is `plan`'s row with the three fields the sentence
 * adds — written that way so the two rows cannot drift apart.
 */
const PLAN_ROW = Object.freeze({
  planIsWritten: true,
  obligationsReachAPrompt: true,
  criticReceivesThePlan: true,
  gateExecutesCommands: false,
  stagedCommandsStillRun: true,
  releaseVerificationRuns: false,
  gatesAreMarkedRequired: false,
  verdictIsTheCriticsAlone: true,
});

/** The effect of each mode (F105-FR-003), by mode. */
export const MODE_EFFECTS: Readonly<Record<VerificationMode, ModeEffect>> = Object.freeze({
  off: Object.freeze({
    mode: "off" as const,
    planIsWritten: false,
    obligationsReachAPrompt: false,
    criticReceivesThePlan: false,
    gateExecutesCommands: false,
    stagedCommandsStillRun: false,
    releaseVerificationRuns: false,
    gatesAreMarkedRequired: false,
    verdictIsTheCriticsAlone: true,
  }),
  plan: Object.freeze({ mode: "plan" as const, ...PLAN_ROW }),
  required: Object.freeze({
    mode: "required" as const,
    ...PLAN_ROW,
    // "as `plan`, and in addition …"
    gateExecutesCommands: true,
    releaseVerificationRuns: true,
    gatesAreMarkedRequired: true,
    verdictIsTheCriticsAlone: false,
  }),
});

/** The effect of one mode. */
export function effectOf(mode: VerificationMode): ModeEffect {
  return MODE_EFFECTS[mode];
}

/** Every member of row 52 has a row of effects, and no other value has one. */
export const EVERY_MODE_HAS_AN_EFFECT: boolean =
  VERIFICATION_MODES.every((mode) => MODE_EFFECTS[mode] !== undefined) &&
  Object.keys(MODE_EFFECTS).length === VERIFICATION_MODES.length;

/**
 * F105-FR-003, last sentence — only the mode `required` marks the
 * verification gates of the plan as required. Read from the rows, so a changed
 * row changes the answer.
 */
export const ONLY_REQUIRED_MARKS_GATES_REQUIRED: boolean =
  VERIFICATION_MODES.filter((mode) => MODE_EFFECTS[mode].gatesAreMarkedRequired).join(",") ===
  "required";

/** True where the verification gate of this mode executes commands. */
export function gateExecutes(mode: VerificationMode): boolean {
  return MODE_EFFECTS[mode].gateExecutesCommands;
}

/**
 * The `required` field a plan's gates carry under this mode (F105-FR-018 holds
 * the rest of the gate; this is the one field the MODE decides).
 */
export function gateRequiredUnder(mode: VerificationMode): boolean {
  return MODE_EFFECTS[mode].gatesAreMarkedRequired;
}

/**
 * I2 of the inconsistency register — in the mode `plan` the verification gate
 * executes no command AND the commands staged before still run. The two facts
 * together are the reading the register fixed, so they are asserted together.
 */
export const PLAN_RUNS_STAGED_BUT_NOT_THE_GATE: boolean =
  !MODE_EFFECTS.plan.gateExecutesCommands && MODE_EFFECTS.plan.stagedCommandsStillRun;
