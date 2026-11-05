/**
 * T128, part one — WHICH commands are staged before a phase attempt, and the
 * names and places of their record (F105-FR-034).
 *
 * The commands staged before a phase attempt are the commands OF THE PHASE
 * ITSELF with the stage `prestage` or `both`, in document order, and they are
 * NOT CUMULATIVE. That last word is the whole point of the mechanism: a
 * cumulative pre-stage would re-run every earlier phase's long measurement
 * before every later phase, which is the cost the stage exists to remove
 * (`lib/verification_plan.py` `prestage_commands`, :1698).
 *
 * The record of the step is `specstride-prestage-evidence`, version 1, under
 * the logical name `attempt:<N>:<k>:<n>:prestage`, whose as-is place is
 * `prestage-phase-<N>-attempt-<M>.json` (item B-1069). A directory given for
 * these records MUST BE ABSOLUTE (F105-FR-034, B-1044).
 */
import { DEFAULT_STAGE, PRESTAGE_STAGES, VerificationError } from "../plan/record.ts";
import type { PlanCommand, ReusePolicy, Stage } from "../plan/record.ts";
import { DEFAULT_REUSE_POLICY } from "../plan/record.ts";
import { VERIFICATION_MODES } from "../mode/closed-sets.ts";

/** The kind of the record of staged commands (F105-FR-034). */
export const PRESTAGE_KIND = "specstride-prestage-evidence" as const;

/** The version of that record (F105-FR-034). */
export const PRESTAGE_VERSION = 1 as const;

/** The logical name the record is written under (F105-FR-034, B-1069). */
export const PRESTAGE_RECORD_NAME = "attempt:<N>:<k>:<n>:prestage" as const;

/** The as-is name of the file of that logical name (item B-1069). */
export const PRESTAGE_PREFIX = "prestage-phase-" as const;

/** The as-is file name of one record, as `layout-old-side.json` gives it. */
export const PRESTAGE_AS_IS_PATH = "prestage-phase-<N>-attempt-<M>.json" as const;

/** The fields of the record, in the order F105-FR-034 names them. */
export const PRESTAGE_RECORD_FIELDS = [
  "planId",
  "planHash",
  "phase",
  "attempt",
  "sourceRevision",
  "startedAtEpoch",
  "finishedAtEpoch",
  "commands",
  "passed",
  "summary",
] as const;
export type PrestageRecordField = (typeof PRESTAGE_RECORD_FIELDS)[number];

/**
 * The modes in which the commands staged before run (F105-FR-034): `plan` and
 * `required`, never `off`. In `plan` they run FOR INFORMATION ONLY — the
 * verification gate executes no command there — and that is as-is behaviour
 * (F105-FR-003, item B-0375, inconsistency I2 of `spec.md`).
 */
export const MODES_THAT_STAGE = ["plan", "required"] as const;
export type ModeThatStages = (typeof MODES_THAT_STAGE)[number];

/** `off` is the one mode of row 52 that stages nothing (F105-FR-003). */
export const MODE_THAT_STAGES_NOTHING = "off" as const;

/** The three members of `MODES_THAT_STAGE` and `MODE_THAT_STAGES_NOTHING` are row 52. */
export const MODES_ARE_OF_ROW_52: boolean =
  [...MODES_THAT_STAGE, MODE_THAT_STAGES_NOTHING].every((mode) =>
    (VERIFICATION_MODES as readonly string[]).includes(mode),
  ) && VERIFICATION_MODES.length === MODES_THAT_STAGE.length + 1;

/** Whether the commands staged before run in a mode (F105-FR-034). */
export function stagesBeforeAPhaseAttempt(mode: string): boolean {
  return (MODES_THAT_STAGE as readonly string[]).includes(mode);
}

/** They run ONCE before each phase attempt (F105-FR-034). */
export const RUNS_ONCE_BEFORE_EACH_PHASE_ATTEMPT = true as const;

/** They are never cumulative (F105-FR-034, `lib/verification_plan.py`:1698). */
export const STAGED_COMMANDS_ARE_CUMULATIVE = false as const;

/** The two stages a staged command may carry (F105-FR-034). */
export const STAGES_THAT_STAGE: readonly Stage[] = Object.freeze([...PRESTAGE_STAGES]);

/** The stage whose result the verification gate MAY take over (F105-FR-033). */
export const STAGE_THAT_OFFERS_ITS_RESULT = "prestage" as const;

/**
 * The stage that is staged AND still executed by the verification gate: `both`
 * means what it says (F105-FR-033, `lib/verification_plan.py`:2320).
 */
export const STAGE_THAT_IS_STILL_EXECUTED = "both" as const;

/**
 * The stage of a command, with the default the plan omits (F105-FR-016). The
 * parameter is the WIDEST shape — a text or nothing — so that the verification
 * gate's own command type and the plan's both satisfy it; a value that is no
 * member of row 228 therefore reads as itself and matches no rule, which is
 * the fail-closed answer the reuse rules need.
 */
export function stageOf(command: { readonly stage?: string | undefined }): string {
  return command.stage ?? DEFAULT_STAGE;
}

/** The stage of a command of the PLAN, as the closed set of row 228. */
export function planStageOf(command: Pick<PlanCommand, "stage">): Stage {
  return command.stage ?? DEFAULT_STAGE;
}

/** The reuse policy of a command, with the default the plan omits. */
export function reusePolicyOf(command: { readonly reusePolicy?: string | undefined }): string {
  return command.reusePolicy ?? DEFAULT_REUSE_POLICY;
}

/** The reuse policy of a command of the PLAN, as the closed set of row 229. */
export function planReusePolicyOf(command: Pick<PlanCommand, "reusePolicy">): ReusePolicy {
  return command.reusePolicy ?? DEFAULT_REUSE_POLICY;
}

/**
 * THE COMMANDS STAGED BEFORE A PHASE ATTEMPT (F105-FR-034): the commands of
 * the phase ITSELF with the stage `prestage` or `both`, in document order.
 * Deliberately NOT cumulative — no command of an earlier phase joins this
 * list, whatever its `cumulative` says.
 */
export function prestageCommands(
  plan: { readonly commands: readonly PlanCommand[] },
  phase: number,
): readonly PlanCommand[] {
  return Object.freeze(
    plan.commands.filter(
      (command) =>
        command.phase === phase &&
        (STAGES_THAT_STAGE as readonly string[]).includes(stageOf(command)),
    ),
  );
}

/** The message of a directory for these records that is not absolute (B-1044). */
export function directoryMustBeAbsolute(value: string): string {
  return `--prestage-dir must be absolute: ${value}`;
}

/**
 * The directory of the records of staged commands, refused where it is not
 * absolute (F105-FR-034, B-1044). The default — the directory of the plan — is
 * `defaultPrestageDirectoryOf` of `../render/phase-context.ts`, which T101
 * wrote; this function is the CHECK a given value passes.
 */
export function prestageDirectory(value: string): string {
  if (!value.startsWith("/")) throw new VerificationError(directoryMustBeAbsolute(value));
  return value;
}

/** The as-is file name of the record of one phase attempt (B-1069). */
export function prestageFileName(phase: number, attempt: number): string {
  return `${PRESTAGE_PREFIX}${phase}-attempt-${attempt}.json`;
}

/** The place of the record of one phase attempt, under an absolute directory. */
export function prestagePath(directory: string, phase: number, attempt: number): string {
  const base = prestageDirectory(directory).replace(/\/+$/, "");
  return `${base === "" ? "" : base}/${prestageFileName(phase, attempt)}`;
}

/**
 * THE NUMBER OF THE PHASE ATTEMPT DEFAULTS TO THE ONE IN THE NAME OF THE
 * RESULT RECORD (F105-FR-033, B-1045): `…/verification/phase-7-attempt-2.json`
 * gives 2. An unparseable name gives `undefined`, and an unknown phase attempt
 * REFUSES reuse per phase attempt — fail closed, never guess
 * (`lib/verification_plan.py` `_attempt_from_path`, :2227).
 */
export function attemptFromPath(path: string | undefined): number | undefined {
  if (path === undefined || path === "") return undefined;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const match = /-attempt-(\d+)\b/.exec(base);
  return match === null ? undefined : Number.parseInt(match[1] as string, 10);
}

/** An unknown phase attempt refuses reuse per phase attempt (F105-FR-033). */
export const AN_UNKNOWN_ATTEMPT_REFUSES_PER_ATTEMPT_REUSE = true as const;

/** A name made safe for a file, as the baseline's `_safe_name` (:1388). */
export function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase();
}
