/**
 * T045 — the derivation before the first phase attempt, and the preflight
 * error (F105-FR-004).
 *
 * Unless the mode is `off`, the verification plan is derived BEFORE THE FIRST
 * PHASE ATTEMPT, from the working directory, the spec in its detected or
 * forced format, and the commands document where one is given; the scaffold
 * directory is passed WHENEVER IT IS SET. When the derivation fails, the start
 * ends with the exit code 3 and the message
 * `verification preflight failed (see <log>)`, where THE LOG IS NAMED BY
 * LOGICAL NAME IN DEFAULT OUTPUT, and the output of the derivation goes to the
 * engine log only.
 *
 * The derivation itself is the planner (F105-FR-011 and the requirements after
 * it, a later phase). This module owns WHEN it runs, WHAT it is given, WHERE
 * its output goes and WHAT the failure says — and it takes the derivation as
 * an injected function, so the step is provable before the planner exists and
 * stays provable when it is replaced.
 */
import { CONFIGURATION_ERROR_CODE, type VerificationMode } from "./closed-sets.ts";
import { MESSAGE_COMPONENT } from "./modes.ts";

/** The logical name of the engine log, which default output names (annex B §B.5). */
export const ENGINE_LOG_NAME = "run:<runId>:engine-log" as const;

/**
 * The step runs BEFORE the first phase attempt. The name is the point of the
 * run it is placed at, and `preflightRunsBeforeTheFirstPhaseAttempt` is the
 * fact a caller asserts.
 */
export const BEFORE_THE_FIRST_PHASE_ATTEMPT = "before-the-first-phase-attempt" as const;
export const PREFLIGHT_RUNS_AT = BEFORE_THE_FIRST_PHASE_ATTEMPT;

/** The output of the derivation goes to the engine log ONLY (F105-FR-004). */
export const DERIVATION_OUTPUT_GOES_TO = ENGINE_LOG_NAME;
export const DERIVATION_OUTPUT_REACHES_DEFAULT_OUTPUT = false as const;

/** The text of the preflight message after the component name (B-0122). */
export function preflightFailedText(log: string = ENGINE_LOG_NAME): string {
  return `verification preflight failed (see ${log})`;
}

/** The whole preflight message, with its component prefix. */
export function preflightFailedMessage(
  log: string = ENGINE_LOG_NAME,
  component: string = MESSAGE_COMPONENT,
): string {
  return `${component}: ${preflightFailedText(log)}`;
}

/** What the derivation is given (F105-FR-004). */
export type DerivationInput = {
  /** The working directory. */
  readonly workdir: string;
  /** The spec, by path. */
  readonly specs: string;
  /** Its detected or forced format. */
  readonly format: string;
  /** Whether the format was forced by the caller or detected. */
  readonly formatWasForced: boolean;
  /** The commands document, where one is given. */
  readonly commandsDocument?: string | undefined;
  /** The scaffold directory, passed WHENEVER IT IS SET. */
  readonly generateTests?: string | undefined;
  /** The place of the plan for people. */
  readonly testPlan?: string | undefined;
  /** True where the gates of the plan are marked required (the mode `required`). */
  readonly required: boolean;
};

/** What the derivation gives back. */
export type DerivationOutcome = {
  /** True where it produced a plan. */
  readonly ok: boolean;
  /** Everything it printed. It goes to the engine log only. */
  readonly output: string;
};

/** The injected derivation: the planner, or a stand-in in a test. */
export type Derivation = (input: DerivationInput) => DerivationOutcome | Promise<DerivationOutcome>;

/** Where the output of the derivation was written. */
export type LogSink = (text: string) => void;

/** What the preflight step is given. */
export type PreflightInput = {
  readonly mode: VerificationMode;
  readonly derivation: Derivation;
  readonly input: Omit<DerivationInput, "required">;
  /** The engine log. Absent: the output is kept on the outcome and written by the caller. */
  readonly log?: LogSink | undefined;
  /** The logical name the message gives in default output. */
  readonly logName?: string | undefined;
  readonly component?: string | undefined;
};

/** The outcome of the preflight step. */
export type PreflightOutcome =
  | {
      readonly ok: true;
      /** True where the derivation ran; false where the mode is `off`. */
      readonly derived: boolean;
      /** What the derivation was given, or `undefined` where it did not run. */
      readonly given: DerivationInput | undefined;
      /** What it printed. It reached the engine log and nothing else. */
      readonly output: string;
    }
  | {
      readonly ok: false;
      readonly exitCode: typeof CONFIGURATION_ERROR_CODE;
      /** The message, with its component prefix and the LOGICAL name of the log. */
      readonly message: string;
      readonly given: DerivationInput;
      /** What the derivation printed. It reached the engine log and nothing else. */
      readonly output: string;
    };

/**
 * Run the derivation unless the mode is `off`. The scaffold directory is
 * passed whenever it is set; a failed derivation ends the start with the exit
 * code 3 and the as-is message, whose log is named BY LOGICAL NAME.
 */
export async function runPreflight(given: PreflightInput): Promise<PreflightOutcome> {
  if (given.mode === "off") {
    return Object.freeze({ ok: true as const, derived: false, given: undefined, output: "" });
  }
  const input: DerivationInput = Object.freeze({
    ...given.input,
    required: given.mode === "required",
  });
  let outcome: DerivationOutcome;
  try {
    outcome = await given.derivation(input);
  } catch (error) {
    // A derivation that throws is a derivation that failed; the text of the
    // error is output of the derivation and goes to the engine log only.
    outcome = Object.freeze({ ok: false, output: messageOf(error) });
  }
  given.log?.(outcome.output);
  if (!outcome.ok) {
    return Object.freeze({
      ok: false as const,
      exitCode: CONFIGURATION_ERROR_CODE,
      message: preflightFailedMessage(given.logName ?? ENGINE_LOG_NAME, given.component),
      given: input,
      output: outcome.output,
    });
  }
  return Object.freeze({
    ok: true as const,
    derived: true,
    given: input,
    output: outcome.output,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The names of what the derivation is given, in the order F105-FR-004 names
 * them and the baseline builds them: the working directory, the spec, its
 * format, the place of the plan for people, the place of the plan record,
 * then `--required` only in the mode `required` (B-1146) and
 * `--generate-tests` WHENEVER the directory is set.
 */
export const DERIVATION_ARGUMENT_NAMES = [
  "--workdir",
  "--specs",
  "--format",
  "--output",
  "--json-output",
  "--required",
  "--generate-tests",
  "--verification-commands",
] as const;

/** The sub-command of the derivation. */
export const DERIVATION_SUB_COMMAND = "create" as const;

/**
 * The argument list of the derivation, in the baseline's own order. It is
 * built here and not at a call site, so that WHAT the derivation is given is
 * one readable list and the two conditional arguments cannot drift.
 */
export function derivationArguments(input: {
  readonly mode: VerificationMode;
  readonly workdir: string;
  readonly specs: string;
  readonly format: string;
  readonly testPlan: string | undefined;
  /** Where the plan record is written. */
  readonly planRecord: string;
  readonly generateTests?: string | undefined;
  readonly commandsDocument?: string | undefined;
}): readonly string[] {
  if (input.mode === "off") return Object.freeze([]);
  const args: string[] = [
    DERIVATION_SUB_COMMAND,
    "--workdir",
    input.workdir,
    "--specs",
    input.specs,
    "--format",
    input.format,
    "--output",
    input.testPlan ?? "",
    "--json-output",
    input.planRecord,
  ];
  // `--required` ONLY in the mode `required` (B-1146).
  if (input.mode === "required") args.push("--required");
  // `--generate-tests` WHENEVER the directory is set (F105-FR-004).
  if (input.generateTests !== undefined && input.generateTests !== "") {
    args.push("--generate-tests", input.generateTests);
  }
  if (input.commandsDocument !== undefined && input.commandsDocument !== "") {
    args.push("--verification-commands", input.commandsDocument);
  }
  return Object.freeze(args);
}

/** The scaffold directory is passed whenever it is set (F105-FR-004). */
export function scaffoldIsPassed(input: Omit<DerivationInput, "required">): boolean {
  return input.generateTests !== undefined && input.generateTests !== "";
}
