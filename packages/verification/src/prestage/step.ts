/**
 * T128 — THE STEP OF COMMANDS STAGED BEFORE A PHASE ATTEMPT (F105-FR-034,
 * items B-0375, B-0359, B-0351, B-1080, B-1126, B-1069, B-1073, B-1076,
 * B-1056, B-1044, B-1042).
 *
 * In the modes `plan` and `required` the commands staged before run ONCE
 * BEFORE EACH PHASE ATTEMPT, before the proposer. In `plan` the verification
 * gate executes no command and they still run, FOR INFORMATION ONLY, as at the
 * baseline (F105-FR-003, inconsistency I2).
 *
 * A FAILURE NEVER HALTS THE RUN. The step's result code is 0 when every
 * command passed or none exists and 11 otherwise, and that code is information
 * for the pass: the verification gate is still the authority on whether the
 * phase attempt passes (`A_FAILURE_HALTS_THE_RUN`).
 *
 * The engine writes the log line
 * `----- prestage: phase <N> attempt <M> (rc <rc>) — <summary> -----` and an
 * event the compatibility projection renders as `prestage_done` with `phase`,
 * `attempt`, `rc` and `summary`. WITH AN EMPTY SUMMARY, OR ONE THAT STARTS
 * WITH `No pre-stage commands`, IT WRITES NEITHER — `writesNeither` is that
 * rule, and it is the baseline's own line
 * `[[ -z "$out" || "$out" == No\ pre-stage\ commands* ]] && return 0`
 * (`specstride-lib.sh`:590).
 *
 * `lib/verification_plan.py` `run_prestage` (:2242), `_prestage_summary`
 * (:1843) and the `prestage` sub-command (:2362) are the baseline.
 */
import { throughTheIngress, writtenText, type CommandOutputIngress } from "../gate/ingress.ts";
import type { CommandResult } from "../gate/run-command.ts";
import type { PlanCommand, SourceRevision, VerificationPlan } from "../plan/record.ts";
import {
  PRESTAGE_KIND,
  PRESTAGE_RECORD_FIELDS,
  PRESTAGE_RECORD_NAME,
  PRESTAGE_VERSION,
  prestageCommands,
  prestagePath,
  reusePolicyOf,
  stageOf,
} from "./commands.ts";
import {
  launchDetached,
  refreshDetachedRecord,
  type CheckRunnerEnvironment,
  type DetachedFilePort,
  type DetachedRecord,
} from "./detached.ts";
import { prestageDoneSummary, stagedSummary } from "./ingress.ts";

/* ------------------------------------------------------------------ *
 * The two printed lines (items B-1073 and B-1076).
 * ------------------------------------------------------------------ */

/** The line the step prints when there is at least one command (B-1073). */
export function stepLine(input: {
  readonly phase: number;
  readonly attempt: number;
  readonly commands: number;
  readonly passed: number;
  readonly running: number;
  readonly failed: number;
}): string {
  return (
    `Pre-stage phase ${input.phase} attempt ${input.attempt}: ${input.commands} command(s), ` +
    `${input.passed} passed, ${input.running} running, ${input.failed} failed`
  );
}

/** The line the step prints when the phase has no staged command (B-1076). */
export function noCommandsLine(phase: number): string {
  return `No pre-stage commands for phase ${phase}`;
}

/** The text the engine's rule tests a summary against (`specstride-lib.sh`:590). */
export const NO_COMMANDS_PREFIX = "No pre-stage commands" as const;

/* ------------------------------------------------------------------ *
 * The result code (item B-1056).
 * ------------------------------------------------------------------ */

/** The code of a step in which every command passed, or none exists. */
export const PRESTAGE_PASSED_CODE = 0 as const;

/** The code of a step in which a command staged before failed (F105-FR-039). */
export const PRESTAGE_FAILED_CODE = 11 as const;

/** The two codes of the step (B-1056). */
export const PRESTAGE_RESULT_CODES = [PRESTAGE_PASSED_CODE, PRESTAGE_FAILED_CODE] as const;
export type PrestageResultCode = (typeof PRESTAGE_RESULT_CODES)[number];

/** F105-FR-034 — a failure of the step NEVER halts the run. */
export const A_FAILURE_HALTS_THE_RUN = false as const;

/** What the code is for (F105-FR-034). */
export const THE_CODE_IS_FOR = "information only" as const;

/** Who remains the authority on the phase attempt (F105-FR-034). */
export const THE_AUTHORITY_IS = "the verification gate" as const;

/** The result code of a finished step (B-1056). */
export function prestageResultCode(document: {
  readonly commands: readonly Readonly<Record<string, unknown>>[];
  readonly passed: boolean;
}): PrestageResultCode {
  if (document.commands.length === 0) return PRESTAGE_PASSED_CODE;
  return document.passed ? PRESTAGE_PASSED_CODE : PRESTAGE_FAILED_CODE;
}

/* ------------------------------------------------------------------ *
 * The log line and the event (items B-0359 and B-0351).
 * ------------------------------------------------------------------ */

/** The log line the ENGINE writes after the step (B-0359, an as-is literal). */
export function prestageLogLine(input: {
  readonly phase: number;
  readonly attempt: number;
  readonly rc: number;
  readonly summary: string;
}): string {
  return `----- prestage: phase ${input.phase} attempt ${input.attempt} (rc ${input.rc}) — ${input.summary} -----`;
}

/** The as-is name the compatibility projection renders the event as (B-0351). */
export const PRESTAGE_EVENT = "prestage_done" as const;

/** The fields of that event, in the order F105-FR-034 names them (B-0351). */
export const PRESTAGE_EVENT_FIELDS = ["phase", "attempt", "rc", "summary"] as const;
export type PrestageEventField = (typeof PRESTAGE_EVENT_FIELDS)[number];

/** Who writes the log line and the event: the ENGINE, after the step. */
export const LINE_AND_EVENT_WRITTEN_BY = "the engine" as const;

/**
 * F105-FR-034 — WITH AN EMPTY SUMMARY, OR ONE THAT STARTS WITH
 * `No pre-stage commands`, THE ENGINE WRITES NEITHER the log line nor the
 * event (`specstride-lib.sh`:590).
 */
export function writesNeither(summary: string): boolean {
  return summary === "" || summary.startsWith(NO_COMMANDS_PREFIX);
}

/** One event as the compatibility projection renders it. */
export type PrestageDoneEvent = {
  readonly type: typeof PRESTAGE_EVENT;
  readonly fields: Readonly<Record<PrestageEventField, string>>;
};

/**
 * The event and the log line of one finished step, or NEITHER where the rule
 * of F105-FR-034 says so. ONE function answers both, so a caller cannot write
 * the line and leave the event out.
 */
export function prestageOutcomeLines(input: {
  readonly phase: number;
  readonly attempt: number;
  readonly rc: number;
  /** The summary, already through the ingress (F105-FR-054). */
  readonly summary: string;
}): {
  readonly logLine: string | undefined;
  readonly event: PrestageDoneEvent | undefined;
} {
  if (writesNeither(input.summary)) {
    return Object.freeze({ logLine: undefined, event: undefined });
  }
  return Object.freeze({
    logLine: prestageLogLine(input),
    event: Object.freeze({
      type: PRESTAGE_EVENT,
      fields: Object.freeze({
        phase: String(input.phase),
        attempt: String(input.attempt),
        rc: String(input.rc),
        summary: input.summary,
      }),
    }),
  });
}

/**
 * The last line of the output of the step, which the engine takes
 * (`out="${out##*$'\n'}"`, `specstride-lib.sh`:589). A step that printed
 * nothing gives the empty text, which makes `writesNeither` true.
 */
export function lastLineOf(output: string): string {
  const at = output.lastIndexOf("\n");
  return at < 0 ? output : output.slice(at + 1);
}

/* ------------------------------------------------------------------ *
 * The record (items B-1080 and B-1126).
 * ------------------------------------------------------------------ */

/** The record of the step (F105-FR-034). */
export type PrestageDocument = {
  readonly kind: typeof PRESTAGE_KIND;
  readonly version: typeof PRESTAGE_VERSION;
  readonly planId: string;
  readonly planHash: string;
  readonly phase: number;
  readonly attempt: number;
  readonly sourceRevision: SourceRevision | undefined;
  readonly startedAtEpoch: number;
  readonly finishedAtEpoch: number;
  readonly commands: readonly Readonly<Record<string, unknown>>[];
  readonly passed: boolean;
  readonly summary: string;
};

/** The summary of a record of staged commands (B-1073, `:1843`). */
export function prestageSummary(document: {
  readonly phase: number;
  readonly attempt: number;
  readonly commands: readonly Readonly<Record<string, unknown>>[];
}): string {
  const states = document.commands.map((entry) => (entry["state"] ?? "completed") as string);
  return stepLine({
    phase: document.phase,
    attempt: document.attempt,
    commands: document.commands.length,
    passed: document.commands.filter((entry) => entry["passed"] === true).length,
    running: states.filter((state) => state === "running").length,
    failed: document.commands.filter(
      (entry) => entry["passed"] !== true && (entry["state"] ?? "completed") !== "running",
    ).length,
  });
}

/** True where every command of the record passed (F105-FR-034). */
export function everyCommandPassed(
  commands: readonly Readonly<Record<string, unknown>>[],
): boolean {
  return commands.every((entry) => entry["passed"] === true);
}

/* ------------------------------------------------------------------ *
 * Running the step.
 * ------------------------------------------------------------------ */

/** The runner of one command staged before: the check runner of T010. */
export type StagedCommandRunner = (
  command: PlanCommand,
  index: number,
) => CommandResult | Promise<CommandResult>;

/** The reading of a declared report path (`:2278`). */
export type ReportPathPort = (absolutePath: string) => boolean;

/** What a run of the step is given. */
export type RunPrestageInput = {
  readonly plan: VerificationPlan;
  readonly phase: number;
  readonly attempt: number;
  /** The directory of the records; absolute (F105-FR-034, B-1044). */
  readonly directory: string;
  /** The runner of a command that is not detached. */
  readonly run: StagedCommandRunner;
  /** The one ingress every piece of output comes through (F105-FR-054). */
  readonly ingress: CommandOutputIngress;
  /** The revision the record records. */
  readonly sourceRevision?: SourceRevision | undefined;
  /** Whole seconds since the epoch, from the clock of the kernel. */
  readonly nowEpoch: () => number;
  /** The process primitive and the files, for a DETACHED command. */
  readonly detached?:
    | {
        readonly process: Parameters<typeof launchDetached>[0]["process"];
        readonly environment: CheckRunnerEnvironment;
        readonly files: DetachedFilePort;
      }
    | undefined;
  /** Whether a declared report path exists; absent reads none. */
  readonly reportExists?: ReportPathPort | undefined;
};

/** What a run of the step gives back. */
export type PrestageOutcome = {
  /** The record, or `undefined` where the phase has no staged command. */
  readonly document: PrestageDocument | undefined;
  /** The line the step printed: the summary, or the no-commands line. */
  readonly printed: string;
  /** The result code: 0 or 11 (B-1056). */
  readonly rc: PrestageResultCode;
  /** The place of the record, where one was built. */
  readonly path: string | undefined;
  /** The log line the engine writes, or `undefined` (B-0359). */
  readonly logLine: string | undefined;
  /** The event the engine writes, or `undefined` (B-0351). */
  readonly event: PrestageDoneEvent | undefined;
  /** True where the ingress dropped a text this step would have written. */
  readonly outputWasDropped: boolean;
};

/**
 * RUN THE COMMANDS STAGED BEFORE A PHASE ATTEMPT (F105-FR-034).
 *
 * A phase with no staged command prints `No pre-stage commands for phase <N>`,
 * builds NO record, ends with 0, and the engine then writes NEITHER its log
 * line nor its event. Every other phase runs its commands — the detached ones
 * through the process primitive of the kernel, the rest through the runner —
 * builds the record, and ends with 0 or 11.
 */
export async function runPrestage(input: RunPrestageInput): Promise<PrestageOutcome> {
  const selected = prestageCommands(input.plan, input.phase);
  if (selected.length === 0) {
    const printed = noCommandsLine(input.phase);
    return Object.freeze({
      document: undefined,
      printed,
      rc: PRESTAGE_PASSED_CODE,
      path: undefined,
      ...prestageOutcomeLines({
        phase: input.phase,
        attempt: input.attempt,
        rc: PRESTAGE_PASSED_CODE,
        summary: printed,
      }),
      outputWasDropped: false,
    });
  }
  const startedAtEpoch = input.nowEpoch();
  const workdir = input.plan.project.workdir;
  const commands: Readonly<Record<string, unknown>>[] = [];
  let dropped = false;
  for (const [index, command] of selected.entries()) {
    let entry: Readonly<Record<string, unknown>>;
    if (command.detached === true && input.detached !== undefined) {
      const record: DetachedRecord = await launchDetached({
        command,
        phase: input.phase,
        attempt: input.attempt,
        directory: input.directory,
        process: input.detached.process,
        environment: input.detached.environment,
        files: input.detached.files,
        ingress: input.ingress,
        nowEpoch: startedAtEpoch,
      });
      // A detached command that already ended — its status record is there —
      // is adopted at once, so a fast job is never left reported as running.
      entry = refreshDetachedRecord({
        record,
        files: input.detached.files,
        ingress: input.ingress,
        nowEpoch: input.nowEpoch(),
      }).record;
    } else {
      const result = await input.run(command, index);
      const stdout = throughTheIngress(input.ingress, result.stdout);
      const stderr = throughTheIngress(input.ingress, result.stderr);
      if (!stdout.present || !stderr.present) dropped = true;
      entry = Object.freeze({
        commandId: result.commandId,
        declaredId: command.declaredId ?? null,
        source: command.source ?? "discovered",
        executable: result.executable,
        args: Object.freeze([...result.args]),
        env: Object.freeze({ ...result.env }),
        cwd: result.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdout: writtenText(stdout),
        stderr: writtenText(stderr),
        passed: result.passed,
        state: "completed",
        startedAtEpoch,
      });
    }
    commands.push(stagingFieldsOf({ entry, command, workdir, reportExists: input.reportExists }));
  }
  const passed = everyCommandPassed(commands);
  const withoutSummary = {
    kind: PRESTAGE_KIND,
    version: PRESTAGE_VERSION,
    planId: input.plan.id,
    planHash: input.plan.contentHash,
    phase: input.phase,
    attempt: input.attempt,
    sourceRevision: input.sourceRevision,
    startedAtEpoch,
    finishedAtEpoch: input.nowEpoch(),
    commands: Object.freeze([...commands]),
    passed,
  };
  // The summary holds text of the step and goes through the ONE INGRESS, as
  // every surface of F105-FR-054 does.
  const summaryField = stagedSummary(input.ingress, prestageSummary(withoutSummary));
  if (!summaryField.present) dropped = true;
  const document: PrestageDocument = Object.freeze({
    ...withoutSummary,
    summary: writtenText(summaryField),
  });
  const rc = prestageResultCode(document);
  return Object.freeze({
    document,
    printed: document.summary,
    rc,
    path: prestagePath(input.directory, input.phase, input.attempt),
    ...prestageOutcomeLines({
      phase: input.phase,
      attempt: input.attempt,
      rc,
      // The engine's summary is the same text, through the ingress again at
      // the surface of the event (F105-FR-054).
      summary: prestageDoneSummary(input.ingress, document.summary),
    }),
    outputWasDropped: dropped,
  });
}

/**
 * The staging fields every entry of the record carries (`:2275`): the stage,
 * the reuse policy, whether the command is cumulative, and the declared report
 * path with whether it was written.
 */
export function stagingFieldsOf(input: {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly command: PlanCommand;
  readonly workdir: string;
  readonly reportExists?: ReportPathPort | undefined;
}): Readonly<Record<string, unknown>> {
  const report = input.command.reportPath;
  const base = {
    ...input.entry,
    state: input.entry["state"] ?? "completed",
    stage: stageOf(input.command),
    reusePolicy: reusePolicyOf(input.command),
    cumulative: input.command.cumulative ?? true,
  };
  if (report === undefined || report === null || report === "") return Object.freeze(base);
  const absolute = report.startsWith("/")
    ? report
    : `${input.workdir.replace(/\/+$/, "")}/${report}`;
  return Object.freeze({
    ...base,
    reportPath: report,
    reportAbsPath: absolute,
    reportExists: input.reportExists === undefined ? false : input.reportExists(absolute),
  });
}

/* ------------------------------------------------------------------ *
 * Writing the record (item B-1069).
 * ------------------------------------------------------------------ */

/** The logical name of the record, re-stated for the writer (B-1069). */
export const PRESTAGE_WRITER_RECORD_NAME: typeof PRESTAGE_RECORD_NAME = PRESTAGE_RECORD_NAME;

/** The fields of the record, re-stated for the writer (F105-FR-034). */
export const PRESTAGE_WRITER_RECORD_FIELDS: typeof PRESTAGE_RECORD_FIELDS = PRESTAGE_RECORD_FIELDS;

/**
 * F105-FR-034 — THE RECORD IS REPLACED ON A NEW RUN. That is the one place
 * this feature writes a record that is NOT write-once: a resumed run re-stages
 * the same phase attempt, and a detached job's entry is refreshed in place
 * when it finishes, so a write-once refusal would lose the refreshed state
 * (`lib/verification_plan.py` `_write_evidence(…, overwrite=True)`, :2201).
 */
export const REPLACED_ON_A_NEW_RUN = true as const;

/** The text of the record, as the baseline writes it: indented by two, sorted. */
export function recordText(document: PrestageDocument): string {
  return `${JSON.stringify(document, sortedKeys, 2)}\n`;
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return Object.fromEntries(entries);
}

/** How the record is written: the atomic write of `@specstride/kernel`. */
export type WriteRecord = (path: string, text: string) => void;

/**
 * Write the record of the step, REPLACING an earlier one of the same phase
 * attempt (F105-FR-034). The directory is refused where it is not absolute,
 * which `prestagePath` does.
 */
export function writePrestageRecord(input: {
  readonly document: PrestageDocument;
  readonly directory: string;
  readonly write: WriteRecord;
  /** An explicit place, which the sub-command `prestage` may name (`:2369`). */
  readonly path?: string | undefined;
}): { readonly path: string; readonly text: string } {
  const path =
    input.path ?? prestagePath(input.directory, input.document.phase, input.document.attempt);
  const text = recordText(input.document);
  input.write(path, text);
  return Object.freeze({ path, text });
}
