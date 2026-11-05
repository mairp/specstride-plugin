/**
 * T052 of feature 118 — the long job (F118-FR-032, F118-FR-033, F118-FR-034,
 * F118-FR-035; fixture FX-16, parity test PT-118-FX16-long-job).
 *
 * A long job is managed only for the phase equal to the long-job phase and
 * only when the long-job command is not empty. Before every attempt the
 * runtime ensures the job and then runs the prestage step, in that order,
 * before the prompt is built; the status block is recomputed and the job
 * ensured again before every pass, not once per invocation.
 *
 * The state is per attempt and per run, as at the baseline:
 * `long-jobs/phase<N>-attempt<M>-<run-id>.{pid,log,done}` — the attempt
 * numbers restarted at 1 in every run of the baseline. A job with an ended
 * marker for this run's attempt is never touched or relaunched; the live job
 * of another run for the same phase and attempt is never raced with a second
 * instance; this run's dead process is marked ended and never restarted
 * within the attempt. The launching process never lets the long job hold the
 * workspace lock or the lease (F100-FR-064): the job is started in a process
 * session of its own through the `ProcessLauncher` port.
 */
import type { Ingress, ProcessList, SupervisionEvent } from "../ports.ts";
import { admitForWrite } from "../ingress.ts";
import {
  longJobLaunchLine,
  longJobEndedLine,
  longJobStartEvent,
  longJobEndedEvent,
} from "../events.ts";

/** The names of the three state files of one long job (as-is, F118-FR-034). */
export function longJobStatePaths(
  dir: string,
  phase: number,
  attempt: number,
  runId: string,
): { readonly pid: string; readonly log: string; readonly done: string } {
  const base = `${dir}/long-jobs/phase${phase}-attempt${attempt}-${runId}`;
  return { pid: `${base}.pid`, log: `${base}.log`, done: `${base}.done` };
}

/** The settings of a long job, resolved from the environment (F118-FR-034). */
export interface LongJobSettings {
  readonly phase: number | undefined;
  readonly cmd: string;
  readonly logPath: string | undefined;
}

/** Resolve `SPECSTRIDE_LONG_JOB_*`; the flags win over the variables. */
export function resolveLongJobSettings(
  environment: Readonly<Record<string, string | undefined>>,
  flags: { readonly longJobPhase?: number | undefined; readonly longJobCmd?: string | undefined },
): LongJobSettings {
  const cmd = flags.longJobCmd ?? environment["SPECSTRIDE_LONG_JOB_CMD"] ?? "";
  const phaseRaw =
    flags.longJobPhase !== undefined
      ? String(flags.longJobPhase)
      : environment["SPECSTRIDE_LONG_JOB_PHASE"];
  const phase = phaseRaw === undefined || phaseRaw === "" ? undefined : Number(phaseRaw);
  return {
    phase: phase !== undefined && Number.isInteger(phase) ? phase : undefined,
    cmd,
    logPath: environment["SPECSTRIDE_LONG_JOB_LOG"],
  };
}

/** The unprefixed names the pass loop reads (F118-FR-034, as-is). */
export const EXPORTED_NAMES = {
  phase: "LONG_JOB_PHASE",
  cmd: "LONG_JOB_CMD",
  log: "LONG_JOB_LOG",
} as const;

/** What the files of the long job hold, as the reader reports them. */
export interface LongJobFiles {
  /** The pid file of this run, when it exists. */
  readonly ownPid: number | undefined;
  /** The pid file of another run for the same phase and attempt, when it exists. */
  readonly otherRunPid: { readonly runId: string; readonly pid: number } | undefined;
  /** True when the ended marker of this run's attempt exists. */
  readonly endedMarker: boolean;
}

/** Whether a process id names a live process, decided over the process list. */
export function isAlive(processes: ProcessList, pid: number): boolean {
  return processes.tree(pid).some((p) => p.pid === pid);
}

/** The decision of `ensureLongJob` for one pass. */
export type LongJobEnsure =
  | {
      readonly kind: "launch";
      readonly pidPath: string;
      readonly logPath: string;
      readonly line: string;
      readonly event: SupervisionEvent;
    }
  | { readonly kind: "leave-running"; readonly logPath: string }
  | { readonly kind: "foreign-live"; readonly logPath: string }
  | { readonly kind: "mark-ended"; readonly line: string; readonly event: SupervisionEvent }
  | { readonly kind: "nothing-to-do" };

/**
 * Ensure the long job before one pass (F118-FR-032). `alive` decides the
 * liveness of a recorded pid; the launcher is used only for a fresh launch.
 */
export function ensureLongJob(input: {
  readonly phase: number;
  readonly attempt: number;
  readonly runId: string;
  readonly cmd: string;
  readonly cwd: string;
  readonly files: LongJobFiles;
  readonly alive: (pid: number) => boolean;
  /** The one ingress: the command is outside text (T077, F118-FR-044). */
  readonly ingress?: Ingress | undefined;
}): LongJobEnsure {
  if (input.cmd === "") return { kind: "nothing-to-do" };

  // The command of a long job came from outside the runtime: it enters the
  // launch line and the `long_job_start` event only after the one ingress.
  const cmd =
    input.ingress !== undefined
      ? admitForWrite(input.ingress, input.cmd, "tool-arguments").text
      : input.cmd;

  // A job with an ended marker for this run's attempt is never touched.
  if (input.files.endedMarker)
    return {
      kind: "leave-running",
      logPath: longJobStatePaths("", input.phase, input.attempt, input.runId).log,
    };

  // The live job of another run: no second instance; its log is the one the prompt points to.
  if (input.files.otherRunPid !== undefined && input.alive(input.files.otherRunPid.pid)) {
    const paths = longJobStatePaths("", input.phase, input.attempt, input.files.otherRunPid.runId);
    return { kind: "foreign-live", logPath: paths.log };
  }

  // This run's pid file names a LIVE process: the job runs, it is never
  // relaunched within the attempt, and the prompt keeps pointing at its log
  // (the job is ensured again before every pass, and every pass sees it).
  if (input.files.ownPid !== undefined && input.alive(input.files.ownPid)) {
    const paths = longJobStatePaths("", input.phase, input.attempt, input.runId);
    return { kind: "leave-running", logPath: paths.log };
  }

  // This run's pid file exists but the process is gone: mark ended, never restart.
  if (input.files.ownPid !== undefined && !input.alive(input.files.ownPid)) {
    const paths = longJobStatePaths("", input.phase, input.attempt, input.runId);
    return {
      kind: "mark-ended",
      line: longJobEndedLine(input.phase, input.attempt, input.files.ownPid, paths.log),
      event: longJobEndedEvent({ phase: input.phase, attempt: input.attempt, log: paths.log }),
    };
  }

  // Fresh launch, in the given working directory, own session (F118-FR-032).
  const paths = longJobStatePaths("", input.phase, input.attempt, input.runId);
  return {
    kind: "launch",
    pidPath: paths.pid,
    logPath: paths.log,
    line: longJobLaunchLine(input.phase, input.attempt, cmd),
    event: longJobStartEvent({ phase: input.phase, attempt: input.attempt, cmd, log: paths.log }),
  };
}

/** The status block of the prompt (F118-FR-033), byte-equal under `parity`. */
export function longJobPromptBlock(input: {
  readonly state: "done" | "running" | "launching";
  readonly secondsSoFar?: number | undefined;
  readonly logPath?: string | undefined;
}): string {
  const head =
    input.state === "done"
      ? "## Long-running verification job: DONE"
      : input.state === "running"
        ? `## Long-running verification job: STILL RUNNING (~${input.secondsSoFar ?? 0}s so far)`
        : "## Long-running verification job: launching now";
  const body =
    "Do not re-run or wait on this job. End the pass without evidence while it runs" +
    (input.logPath !== undefined ? `; its log is ${input.logPath}.` : ".");
  return [head, body].join("\n");
}
