/**
 * T129 — DETACHED STAGED COMMANDS (F105-FR-035, items B-1127 and B-1070).
 *
 * A command staged before that is declared `detached` is started in a process
 * SESSION OF ITS OWN with its standard input closed, and it is NEVER KILLED AT
 * ITS DEADLINE: an expired deadline is REPORTED — the state
 * `deadline_exceeded` with the signal `DEADLINE` — and the process is left
 * running. That is the one case in this feature where a command has no exit
 * code and no time limit ended it.
 *
 * Four facts of the requirement are facts OF THIS MODULE, and each is a named
 * value so that a reader and a test can hold it:
 *
 *  1. **It is started by the process primitive of `@specstride/kernel`**
 *     (F100-FR-234), WHICH THE COMPOSITION ROOT HANDS IN AS AN ARGUMENT:
 *     `LaunchDetachedInput.process` is that primitive, typed from
 *     `@specstride/contracts/ep/kernel-services`. This module calls
 *     `startDetached` and nothing else, and it holds no primitive of its own.
 *  2. **It is NOT started through the check runner**, whose time limit ENDS a
 *     command — and a detached command must outlive its deadline
 *     (`research.md` D-17, assumption CQ-215). `STARTED_THROUGH_THE_CHECK_RUNNER`
 *     is `false`, and no call site of `../gate/run-command.ts` is reached from
 *     here.
 *  3. **`node:child_process` is NOT imported.** The import list of this file is
 *     the proof; `IMPORTS_NODE_CHILD_PROCESS` is the sentence.
 *  4. **The environment is the one a command of the check runner gets**, handed
 *     in by the composition root, taken from the check runner (feature 100,
 *     annex C §C.8; `packages/check-runner/src/command/environment.ts` computes
 *     it once for both callers). This feature BUILDS NONE:
 *     `BUILDS_ITS_OWN_ENVIRONMENT` is `false` and `LaunchDetachedInput`
 *     requires the environment as an argument.
 *
 * THE LOG IS WRITTEN BY THE PROCESS ITSELF. The engine OPENS the file under
 * `attempt:<N>:<k>:<n>:prestage` and gives it to the process AS ITS TWO OUTPUT
 * STREAMS — `stdoutFile` and `stderrFile` of the primitive are the same path —
 * because the process may outlive the engine that started it. The process gets
 * no other access to the control plane. Copies of an earlier start are removed
 * before the start (item B-1070).
 *
 * The process is entered in the process registry with the class `adoptable`
 * (F105-FR-035, F100-FR-063): `registryEntryOf` builds that entry and reads
 * the class from row 22 of annex X §X.6, whose owner is 122, never from a
 * literal of this file.
 */
import { rowOf } from "@specstride/contracts/enums";
import type {
  DetachedStatusRecord,
  ProcessPrimitive,
  StartedProcess,
} from "@specstride/contracts/ep/kernel-services";
import { DEADLINE_SIGNAL, DEADLINE_STATUS } from "../gate/run-command.ts";
import { rawLogIsReadThrough, writtenText, type CommandOutputIngress } from "../gate/ingress.ts";
import type { PlanCommand } from "../plan/record.ts";
import { reusePolicyOf, safeFileName, stageOf } from "./commands.ts";

/* ------------------------------------------------------------------ *
 * The four facts of F105-FR-035, as values.
 * ------------------------------------------------------------------ */

/** Who starts a detached staged command (F105-FR-035, F100-FR-234). */
export const STARTED_BY = "the process primitive of `@specstride/kernel`" as const;

/** The requirement of feature 100 that owns the primitive. */
export const PROCESS_PRIMITIVE_REQUIREMENT = "F100-FR-234" as const;

/** The operation of the primitive this module calls, and the only one. */
export const PRIMITIVE_OPERATION = "startDetached" as const;

/** The composition root hands the primitive in as an argument (F100-FR-234). */
export const PRIMITIVE_IS_HANDED_IN_BY = "the composition root" as const;

/**
 * F105-FR-035 — NOT through the check runner, whose time limit ends a command.
 * `research.md` D-17: a detached command is never ended at its deadline, so
 * the one call site of the check runner is not a path this module takes.
 */
export const STARTED_THROUGH_THE_CHECK_RUNNER = false as const;
export const THE_CHECK_RUNNERS_TIME_LIMIT = "ends a command" as const;

/** F105-FR-035 — this feature starts no process by any other way. */
export const STARTED_BY_ANY_OTHER_WAY = false as const;

/** F105-FR-035, `research.md` D-17 — `node:child_process` is not imported. */
export const IMPORTS_NODE_CHILD_PROCESS = false as const;

/** The module of the platform that is NOT imported here. */
export const THE_MODULE_NOT_IMPORTED = "node:child_process" as const;

/**
 * F105-FR-035 — the environment is the one A COMMAND OF THE CHECK RUNNER gets,
 * handed in by the composition root; this feature builds none.
 */
export const BUILDS_ITS_OWN_ENVIRONMENT = false as const;
export const ENVIRONMENT_COMES_FROM = "the check runner (feature 100, annex C §C.8)" as const;
export const ENVIRONMENT_IS_HANDED_IN_BY = "the composition root" as const;

/**
 * The environment of a command, as the composition root hands it in: the same
 * bytes `commandEnvironment` of the check runner gives a command of its own.
 */
export type CheckRunnerEnvironment = Readonly<Record<string, string>>;

/** F105-FR-035 — the log is written by the process itself. */
export const LOG_IS_WRITTEN_BY = "the process itself" as const;

/** What the engine does with the log file (F105-FR-035). */
export const ENGINE_OPENS_THE_LOG = true as const;

/** The two output streams of the process are that one file (F105-FR-035). */
export const LOG_IS_BOTH_OUTPUT_STREAMS = true as const;

/** Why the process writes its own log (F105-FR-035). */
export const WHY_THE_PROCESS_WRITES_IT =
  "the process may outlive the engine that started it" as const;

/** F105-FR-035 — the process gets no other access to the control plane. */
export const OTHER_ACCESS_TO_THE_CONTROL_PLANE = false as const;

/** F105-FR-035 — it is never killed at its deadline. */
export const KILLED_AT_ITS_DEADLINE = false as const;

/** The state of a command that passed its deadline (`../gate/run-command.ts`). */
export const DEADLINE_EXCEEDED_STATE: typeof DEADLINE_STATUS = DEADLINE_STATUS;

/** The signal such a command carries: `DEADLINE`, row 233 of annex X §X.6. */
export const DEADLINE_EXCEEDED_SIGNAL: typeof DEADLINE_SIGNAL = DEADLINE_SIGNAL;

/** The schema id of the process registry (annex B §B.10). */
export const PROCESS_REGISTRY_SCHEMA = "specstride.procs/1" as const;

/** The kind of the entry of the process registry (annex B §B.10, F100-FR-063). */
export const REGISTRY_KIND = "detached-job" as const;

/**
 * Row 22 of annex X §X.6 — the classes of the process registry, whose owner is
 * 122. The class of a detached staged command is READ from that row and never
 * typed here, so a change of the row cannot leave this feature behind.
 */
const ROW_22 = rowOf(22);

/** The class of the entry: `adoptable` (F105-FR-035, F100-FR-063). */
export const REGISTRY_CLASS: string = ROW_22?.literals[1] ?? "adoptable";

/** The class is `adoptable` and `adoptable` is a member of row 22. */
export const CLASS_IS_ADOPTABLE: boolean =
  REGISTRY_CLASS === "adoptable" && ROW_22?.literals.includes("adoptable") === true;

/* ------------------------------------------------------------------ *
 * The places of the log and the status record (item B-1070).
 * ------------------------------------------------------------------ */

/** The directory of the logs of detached commands, under the record's (B-1070). */
export const LOG_DIRECTORY = "prestage-logs" as const;

/** The as-is places of the two files of one detached command (item B-1070). */
export const AS_IS_PATHS = [
  "prestage-logs/<name>.log",
  "prestage-logs/<name>.status.json",
] as const;

/** The base name of the two files of one detached command (`:1739`). */
export function detachedBaseName(input: {
  readonly phase: number;
  readonly attempt: number;
  readonly command: Pick<PlanCommand, "id" | "declaredId">;
}): string {
  // The baseline's `command.get("declaredId") or command["id"]` (:1739): a
  // declared id that is absent, EMPTY OR NULL falls back to the command id. A
  // plan written by the baseline stores `null` there, so `undefined` alone
  // would name every file `…_null`.
  const declared = input.command.declaredId as string | null | undefined;
  const name =
    declared !== undefined && declared !== null && declared !== "" ? declared : input.command.id;
  return safeFileName(`${input.phase}-attempt-${input.attempt}-${name}`);
}

/** The two places of one detached command, under the record's directory. */
export function detachedPaths(input: {
  readonly directory: string;
  readonly phase: number;
  readonly attempt: number;
  readonly command: Pick<PlanCommand, "id" | "declaredId">;
}): { readonly logPath: string; readonly statusPath: string; readonly logDirectory: string } {
  const base = input.directory.replace(/\/+$/, "");
  const logDirectory = `${base}/${LOG_DIRECTORY}`;
  const name = detachedBaseName(input);
  return Object.freeze({
    logDirectory,
    logPath: `${logDirectory}/${name}.log`,
    statusPath: `${logDirectory}/${name}.status.json`,
  });
}

/* ------------------------------------------------------------------ *
 * The port of the two files. The engine opens them; this module says so.
 * ------------------------------------------------------------------ */

/**
 * What the engine does with the two files of a detached command. The LOG is
 * opened and handed to the process; the STATUS RECORD is written by the waiter
 * of the kernel and only READ here. The port is injected for the same reason
 * every other place of this feature is: the shape is this feature's and the
 * way a file is touched is the composition root's.
 */
export type DetachedFilePort = {
  /** Make the directory of the two files, as the engine does before a start. */
  makeDirectory(path: string): void;
  /** Remove a copy of an earlier start; absent is not an error (B-1070). */
  removeIfPresent(path: string): void;
  /** True where the file is there. */
  exists(path: string): boolean;
  /** The LAST bytes of the raw log, or `undefined` where there is none. */
  readTail(path: string, limit?: number): string | undefined;
  /** The status record the waiter of the kernel wrote, where it is there. */
  readStatus(path: string): DetachedStatusRecord | undefined;
};

/** The bytes of the raw log a reader takes, as the baseline cuts it (`:1720`). */
export const RAW_LOG_TAIL_BYTES = 64000 as const;

/* ------------------------------------------------------------------ *
 * The record of a detached command.
 * ------------------------------------------------------------------ */

/** The states a detached command may be in (`:1804`). */
export const DETACHED_STATES = ["running", DEADLINE_STATUS, "completed"] as const;
export type DetachedState = (typeof DETACHED_STATES)[number];

/** The signal a command that could not be started carries (row 233, owner 148). */
export const EXEC_ERROR_SIGNAL = "EXEC_ERROR" as const;

/** One record of a detached staged command (F105-FR-035). */
export type DetachedRecord = {
  readonly commandId: string;
  readonly declaredId: string | null;
  readonly source: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
  readonly detached: true;
  readonly state: DetachedState;
  readonly pid: number | null;
  readonly logPath: string;
  readonly statusPath: string;
  readonly deadlineSec: number;
  readonly deadlineEpoch: number;
  readonly startedAtEpoch: number;
  readonly finishedAtEpoch?: number | undefined;
  readonly stage?: string | undefined;
  readonly reusePolicy?: string | undefined;
  readonly cumulative?: boolean | undefined;
} & Readonly<Record<string, unknown>>;

/** What a start of a detached staged command is given. */
export type LaunchDetachedInput = {
  readonly command: PlanCommand;
  readonly phase: number;
  readonly attempt: number;
  /** The directory of the record of staged commands; absolute (B-1044). */
  readonly directory: string;
  /**
   * THE PROCESS PRIMITIVE OF `@specstride/kernel` (F100-FR-234), handed in by
   * the composition root. There is no other way this module starts a process.
   */
  readonly process: Pick<ProcessPrimitive, "startDetached">;
  /**
   * THE ENVIRONMENT A COMMAND OF THE CHECK RUNNER GETS (F105-FR-035), handed
   * in by the composition root and taken from the check runner. This feature
   * builds none.
   */
  readonly environment: CheckRunnerEnvironment;
  /** The two files of the command; the engine opens the log (F105-FR-035). */
  readonly files: DetachedFilePort;
  /** The one ingress every piece of output comes through (F105-FR-054). */
  readonly ingress: CommandOutputIngress;
  /** Whole seconds since the epoch, from the clock of the kernel. */
  readonly nowEpoch: number;
};

/**
 * START A DETACHED STAGED COMMAND (F105-FR-035).
 *
 * The order is the requirement's: the copies of an earlier start are removed,
 * the log is opened, the process is started by the primitive with that one
 * file as BOTH its output streams, and the record names the log, the status
 * record, the deadline and the pid. A start that failed is `completed` with
 * the signal `EXEC_ERROR` and never a false `running`.
 */
export async function launchDetached(input: LaunchDetachedInput): Promise<DetachedRecord> {
  const { command } = input;
  const places = detachedPaths({
    directory: input.directory,
    phase: input.phase,
    attempt: input.attempt,
    command,
  });
  input.files.makeDirectory(places.logDirectory);
  // Copies of an earlier start are removed BEFORE the start (F105-FR-035), so
  // that a reader can never take a finished earlier run for this one.
  input.files.removeIfPresent(places.logPath);
  input.files.removeIfPresent(places.statusPath);
  const environment = Object.freeze({ ...input.environment });
  let started: StartedProcess | undefined;
  let state: DetachedState = "running";
  let signal: string | null = null;
  let stderr = "";
  try {
    started = await input.process.startDetached({
      argv: Object.freeze([command.executable, ...command.args]),
      cwd: command.cwd,
      env: environment,
      // THE LOG IS THE TWO OUTPUT STREAMS OF THE PROCESS (F105-FR-035).
      stdoutFile: places.logPath,
      stderrFile: places.logPath,
      statusFile: places.statusPath,
    });
  } catch (error) {
    state = "completed";
    signal = EXEC_ERROR_SIGNAL;
    stderr = writtenText(
      rawLogIsReadThrough(input.ingress, error instanceof Error ? error.message : String(error)),
    );
  }
  return Object.freeze({
    commandId: command.id,
    declaredId: command.declaredId ?? null,
    source: command.source ?? "discovered",
    executable: command.executable,
    args: Object.freeze([...command.args]),
    env: environment,
    cwd: command.cwd,
    exitCode: null,
    signal,
    durationMs: 0,
    stdout: "",
    stderr,
    passed: false,
    detached: true as const,
    state,
    pid: started?.pid ?? null,
    logPath: places.logPath,
    statusPath: places.statusPath,
    deadlineSec: command.timeoutSec,
    deadlineEpoch: input.nowEpoch + command.timeoutSec,
    startedAtEpoch: input.nowEpoch,
    stage: stageOf(command),
    reusePolicy: reusePolicyOf(command),
    cumulative: command.cumulative ?? true,
  }) as DetachedRecord;
}

/** The text a record of an expired deadline carries (`:1835`). */
export function deadlineExceededNote(record: {
  readonly deadlineSec: number;
  readonly pid: number | null;
  readonly logPath: string;
}): string {
  return (
    `detached pre-stage exceeded its ${record.deadlineSec}s deadline; the job was LEFT RUNNING ` +
    `(pid ${record.pid}, log ${record.logPath}). Specstride never kills a job it launched on a ` +
    `deadline.`
  );
}

/**
 * ADOPT the outcome of a detached command, or REPORT its expired deadline
 * (F105-FR-035, `:1804`). It returns the record and whether it moved.
 *
 * A status record the waiter wrote wins over a deadline: a process that
 * finished late is `completed` with its real exit code, not
 * `deadline_exceeded`. A deadline that passed with no status record moves the
 * record to `deadline_exceeded` with the signal `DEADLINE` AND LEAVES THE
 * PROCESS RUNNING — nothing here signals anything.
 */
export function refreshDetachedRecord(input: {
  readonly record: DetachedRecord;
  readonly files: DetachedFilePort;
  readonly ingress: CommandOutputIngress;
  readonly nowEpoch: number;
}): { readonly record: DetachedRecord; readonly moved: boolean } {
  const { record } = input;
  if (record.state !== "running" && record.state !== DEADLINE_STATUS) {
    return Object.freeze({ record, moved: false });
  }
  const status =
    record.statusPath !== "" && input.files.exists(record.statusPath)
      ? input.files.readStatus(record.statusPath)
      : undefined;
  if (status !== undefined) {
    const tail = rawLogIsReadThrough(
      input.ingress,
      input.files.readTail(record.logPath, RAW_LOG_TAIL_BYTES) ?? "",
    );
    return Object.freeze({
      moved: true,
      record: Object.freeze({
        ...record,
        exitCode: status.exitCode,
        signal: status.signal,
        durationMs: Math.trunc(status.durationMs || 0),
        startedAtEpoch: record.startedAtEpoch,
        finishedAtEpoch: Math.trunc(status.endedAtMs / 1000),
        stdout: writtenText(tail),
        stderr: "",
        passed: status.exitCode === 0,
        state: "completed" as const,
      }) as DetachedRecord,
    });
  }
  if (record.state === DEADLINE_STATUS) return Object.freeze({ record, moved: false });
  if (input.nowEpoch <= record.deadlineEpoch) return Object.freeze({ record, moved: false });
  const tail = rawLogIsReadThrough(
    input.ingress,
    input.files.readTail(record.logPath, RAW_LOG_TAIL_BYTES) ?? "",
  );
  return Object.freeze({
    moved: true,
    record: Object.freeze({
      ...record,
      state: DEADLINE_STATUS,
      signal: DEADLINE_EXCEEDED_SIGNAL,
      passed: false,
      stdout: writtenText(tail),
      stderr: deadlineExceededNote(record),
    }) as DetachedRecord,
  });
}

/* ------------------------------------------------------------------ *
 * The entry of the process registry (F105-FR-035, F100-FR-063).
 * ------------------------------------------------------------------ */

/** What the composition root knows and this module does not. */
export type RegistryIdentity = {
  readonly procId: string;
  readonly runId: string;
  readonly engineStartId: string;
  readonly runTokenHash: string;
  readonly attemptId?: string | undefined;
  readonly jobId?: string | undefined;
  /** The start time of the process, as the registry records it. */
  readonly startTime: string;
  readonly startedAt?: string | undefined;
};

/**
 * The entry of the process registry of a detached staged command: the class is
 * `adoptable` (F105-FR-035) and it is READ from `classOfKind`, so a change of
 * F100-FR-063 cannot leave this feature behind.
 */
export function registryEntryOf(input: {
  readonly identity: RegistryIdentity;
  readonly started: Pick<StartedProcess, "pid" | "pgid">;
  readonly processSession?: number | undefined;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: PROCESS_REGISTRY_SCHEMA,
    procId: input.identity.procId,
    class: REGISTRY_CLASS,
    kind: REGISTRY_KIND,
    pid: input.started.pid,
    processGroup: input.started.pgid,
    // The primitive starts every process in a session of its own, so the
    // session is the group unless the caller read another (F100-FR-234).
    processSession: input.processSession ?? input.started.pgid,
    startTime: input.identity.startTime,
    runTokenHash: input.identity.runTokenHash,
    runId: input.identity.runId,
    engineStartId: input.identity.engineStartId,
    ...(input.identity.attemptId !== undefined ? { attemptId: input.identity.attemptId } : {}),
    ...(input.identity.jobId !== undefined ? { jobId: input.identity.jobId } : {}),
    ...(input.identity.startedAt !== undefined ? { startedAt: input.identity.startedAt } : {}),
  });
}
