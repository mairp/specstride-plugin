/**
 * T045 of feature 118 — the launch and the adopt modes of the job of a yield
 * (F118-FR-019; PT-118-C-058). The launching and the signals go through the
 * ports of `ports.ts`: the core starts no process itself.
 *
 * Launch: the runtime starts the job with the fixed argument list and no
 * shell, in a process session of its own that is not the pass's. A wrapper
 * records the job's process id and, when it ends, its exit code, each written
 * atomically. The runtime waits up to 10 seconds (100 checks at 0.1 second)
 * for the process id; without one the yield is refused with the literal of
 * the baseline.
 *
 * Adopt: the yield is refused when the process is not running or when it
 * shares the process session of the proposer, because it would die with the
 * pass.
 */
import type { LaunchRequest, ProcessLauncher, ProcessList, RegistryAccess } from "../ports.ts";

/** The literal the baseline writes when a launched job reports no pid. */
export const NEVER_REPORTED_PID = "the launched job never reported a pid";

/** The literal the baseline writes for an adopt of a dead or foreign-session process. */
export const ADOPT_NOT_RUNNING = "the process to adopt is not running";
export const ADOPT_OWN_SESSION = "the process to adopt shares the process session of the proposer";

/** How long the runtime waits for the pid of a launched job (F118-FR-019). */
export const PID_WAIT_CHECKS = 100;
export const PID_WAIT_INTERVAL_MS = 100;

/** A job the runtime launched or adopted, with its identity. */
export interface SupervisionJob {
  readonly pid: number;
  readonly groupId: number;
  readonly sessionId: number;
  readonly startedAtMs: number;
  readonly mode: "launch" | "adopt";
}

/** The decision of `launch` or `adopt`. */
export type LaunchAdoptOutcome =
  | { readonly ok: true; readonly job: SupervisionJob }
  | { readonly ok: false; readonly refusal: string };

/** The ports `startJob` needs; the polling of the pid file goes through `readPid`. */
export interface LaunchAdoptDeps {
  readonly launcher: ProcessLauncher;
  readonly processes: ProcessList;
  readonly registry: RegistryAccess;
  /** The logical name the job is registered under (`job:<jobId>`). */
  readonly logicalName: string;
  readonly runTokenHash: string;
  /**
   * Read the pid the wrapper has recorded so far, or `undefined` — the
   * caller advances the clock and sleeps; this module never waits on its own.
   */
  readPid(): number | undefined;
}

/**
 * Launch the job of a `launch` yield (F118-FR-019). Polls the recorded pid
 * `PID_WAIT_CHECKS` times with the caller advancing time between the calls
 * (`poll()` is called once per 0.1-second step by the caller).
 */
export function startLaunchedJob(
  request: LaunchRequest,
  deps: LaunchAdoptDeps,
  poll: () => void,
): LaunchAdoptOutcome {
  const launched = deps.launcher.launch(request);
  let reported: number | undefined = deps.readPid();
  for (let check = 1; check < PID_WAIT_CHECKS && reported === undefined; check += 1) {
    poll();
    reported = deps.readPid();
  }
  if (reported === undefined) return { ok: false, refusal: NEVER_REPORTED_PID };
  const job: SupervisionJob = {
    pid: launched.pid,
    groupId: launched.groupId,
    sessionId: launched.sessionId,
    startedAtMs: launched.startedAtMs,
    mode: "launch",
  };
  deps.registry.put({
    logicalName: deps.logicalName,
    identity: {
      pid: job.pid,
      groupId: job.groupId,
      sessionId: job.sessionId,
      startedAtMs: job.startedAtMs,
      runTokenHash: deps.runTokenHash,
    },
    registryClass: "job",
    survivesStop: true,
  });
  return { ok: true, job };
}

/**
 * Adopt the job of an `adopt` yield (F118-FR-019): refused when the process
 * is not running or shares the proposer's process session.
 */
export function adoptJob(
  pid: number,
  proposerSessionId: number,
  deps: LaunchAdoptDeps,
): LaunchAdoptOutcome {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, refusal: ADOPT_NOT_RUNNING };
  const tree = deps.processes.tree(pid);
  const target = tree.find((p) => p.pid === pid);
  if (target === undefined) return { ok: false, refusal: ADOPT_NOT_RUNNING };
  if (target.sessionId === proposerSessionId) return { ok: false, refusal: ADOPT_OWN_SESSION };
  const job: SupervisionJob = {
    pid: target.pid,
    groupId: target.groupId,
    sessionId: target.sessionId,
    startedAtMs: target.startedAtMs,
    mode: "adopt",
  };
  deps.registry.put({
    logicalName: deps.logicalName,
    identity: {
      pid: job.pid,
      groupId: job.groupId,
      sessionId: job.sessionId,
      startedAtMs: job.startedAtMs,
      runTokenHash: deps.runTokenHash,
    },
    registryClass: "job",
    survivesStop: true,
  });
  return { ok: true, job };
}
