/**
 * T061 of feature 118 — the stop of a launched job on a first failure
 * (F118-FR-039; CT-118-5).
 *
 * When the `first_failure` predicate is satisfied the wait ends. The job is
 * stopped ONLY when the runtime launched it (mode `launch`) AND the yield
 * declared `on_first_failure` as `stop` (the default). A job in mode `adopt`
 * may be the operator's, and a stop in the middle of a lab job can leave the
 * lab in a state that trips the next run: it is never signalled, whatever
 * the action. With `continue-and-notify` the job always runs on.
 *
 * The stop is a signal to the PROCESS GROUP of the job, with a grace period
 * (default 10 seconds, row 51 of annex X §X.7, `verification.failfastGraceSec`)
 * between the termination and the kill, and is sent only when the process
 * id, the start time and the run token of the registry entry all match —
 * the `SignalSender` port refuses, and the refusal is recorded instead of
 * signalling (F100-FR-064). The stop and its outcome are events
 * (`job.first_failure`, then `job.ended`; F118-FR-042).
 */

import type { EventWriter, RegistryAccess, SignalSender, SignalRefusal } from "../ports.ts";
import { firstFailureAction, FAILFAST_GRACE_SEC_DEFAULT } from "./switches.ts";
import { jobFirstFailureEvent, jobEndedEvent } from "./events.ts";

/** The recorded steps of one stop. */
export interface JobStopStep {
  readonly step: "first-failure" | "terminate" | "grace" | "kill";
  /** When the step was taken, in milliseconds since the epoch. */
  readonly atMs: number;
  /** True when the job was already gone after this step. */
  readonly endedJob: boolean;
  /** Why a signal was not sent, when the identity check refused it. */
  readonly refused?: SignalRefusal | undefined;
}

/** Why no stop was attempted at all. */
export type JobStopSkip =
  "adopt-mode-is-never-stopped" | "continue-and-notify-never-stops" | "no-registry-entry";

/** How the stop ended. */
export type JobStopOutcome =
  "ended-by-terminate" | "ended-by-kill" | "survived-the-ladder" | "not-stopped";

/** What the stop recorded. */
export interface JobStopResult {
  /** True when the runtime attempted the stop (launched job, action `stop`). */
  readonly attempted: boolean;
  /** True when the job process was gone when the stop finished. */
  readonly stopped: boolean;
  readonly skip?: JobStopSkip | undefined;
  readonly outcome: JobStopOutcome;
  readonly graceMs: number;
  readonly steps: readonly JobStopStep[];
}

/** The job the stop is asked about, as the wait knows it. */
export interface JobUnderWait {
  /** `launch` (the runtime started it) or `adopt` (the operator's). */
  readonly mode: "launch" | "adopt";
  /** The process id of the job, when one is known. */
  readonly pid: number | undefined;
  /** The logical name of the job in the process registry. */
  readonly logicalName: string;
}

/** The ports the stop needs; every one handed in, nothing global. */
export interface StopJobPorts {
  /** The current time, in milliseconds since the epoch. */
  nowMs(): number;
  /** The grace wait (the edge injects the real wait; tests inject a fake). */
  waitMs(ms: number): void;
  /** True when the job process is still alive. */
  isAlive(pid: number): boolean;
  readonly signals: SignalSender;
  readonly registry: RegistryAccess;
  readonly events: EventWriter;
  /** The grace between the termination and the kill, in ms; default 10 s. */
  readonly graceMs?: number | undefined;
}

/**
 * Stop the job of a satisfied `first_failure` predicate (F118-FR-039).
 * Emits `job.first_failure` and `job.ended`; records every step.
 */
export function stopJob(
  job: JobUnderWait,
  declaredAction: string | undefined,
  ports: StopJobPorts,
): JobStopResult {
  const steps: JobStopStep[] = [];
  const graceMs = ports.graceMs ?? FAILFAST_GRACE_SEC_DEFAULT * 1000;

  // 1. Only a launched job that declared `stop` is ever stopped.
  const action = firstFailureAction({ declared: declaredAction });
  if (job.mode === "adopt") {
    return skipped("adopt-mode-is-never-stopped", graceMs, steps);
  }
  if (action !== "stop") {
    return skipped("continue-and-notify-never-stops", graceMs, steps);
  }
  const entry = job.pid === undefined ? undefined : ports.registry.get(job.logicalName);
  if (entry === undefined || entry.identity.pid !== job.pid) {
    return skipped("no-registry-entry", graceMs, steps);
  }

  // 2. The event of the first failure, with the step (F118-FR-042).
  const firstFailureAtMs = ports.nowMs();
  ports.events.write(jobFirstFailureEvent({ job: job.logicalName, step: "first_failure" }));
  steps.push({ step: "first-failure", atMs: firstFailureAtMs, endedJob: !ports.isAlive(job.pid) });

  const target = {
    pid: entry.identity.pid,
    startedAtMs: entry.identity.startedAtMs,
    runTokenHash: entry.identity.runTokenHash,
  };

  // 3. The termination to the process group of the job. The port refuses a
  //    pid whose start time or run token no longer matches (F100-FR-064).
  if (!ports.isAlive(job.pid))
    return finish(
      ports,
      job.logicalName,
      true,
      "ended-by-terminate",
      graceMs,
      steps,
      firstFailureAtMs,
    );
  const refusedTerminate = ports.signals.signal(target, "terminate");
  steps.push(stepAfter(ports, job.pid, "terminate", refusedTerminate));
  if (!ports.isAlive(job.pid))
    return finish(
      ports,
      job.logicalName,
      true,
      "ended-by-terminate",
      graceMs,
      steps,
      firstFailureAtMs,
    );

  // 4. The grace, then the kill.
  ports.waitMs(graceMs);
  steps.push({ step: "grace", atMs: ports.nowMs(), endedJob: !ports.isAlive(job.pid) });
  if (!ports.isAlive(job.pid))
    return finish(
      ports,
      job.logicalName,
      true,
      "ended-by-terminate",
      graceMs,
      steps,
      firstFailureAtMs,
    );
  const refusedKill = ports.signals.signal(target, "kill");
  steps.push(stepAfter(ports, job.pid, "kill", refusedKill));
  const stopped = !ports.isAlive(job.pid);
  return finish(
    ports,
    job.logicalName,
    stopped,
    stopped ? "ended-by-kill" : "survived-the-ladder",
    graceMs,
    steps,
    firstFailureAtMs,
  );
}

function skipped(skip: JobStopSkip, graceMs: number, steps: readonly JobStopStep[]): JobStopResult {
  return { attempted: false, stopped: false, skip, outcome: "not-stopped", graceMs, steps };
}

function finish(
  ports: StopJobPorts,
  jobName: string,
  stopped: boolean,
  outcome: JobStopOutcome,
  graceMs: number,
  steps: readonly JobStopStep[],
  firstFailureAtMs: number,
): JobStopResult {
  // The stop and its outcome are events: `job.ended` carries the time the
  // job ran on after the first failure (F118-FR-039, F118-FR-042).
  ports.events.write(
    jobEndedEvent({
      job: jobName,
      stopped,
      msAfterFirstFailure: Math.max(0, ports.nowMs() - firstFailureAtMs),
    }),
  );
  return { attempted: true, stopped, outcome, graceMs, steps };
}

function stepAfter(
  ports: StopJobPorts,
  pid: number,
  step: "terminate" | "kill",
  refused: SignalRefusal | undefined,
): JobStopStep {
  return {
    step,
    atMs: ports.nowMs(),
    endedJob: !ports.isAlive(pid),
    ...(refused !== undefined ? { refused } : {}),
  };
}
