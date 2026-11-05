/**
 * T064 of feature 118 — the new events and the resource declaration
 * (F118-FR-042; CT-118-8; contract `supervision-events.md`).
 *
 * The events `job.started`, `job.step`, `job.first_failure`, `job.ended`
 * (with `msAfterFirstFailure`) and `resource.wait` (with `resource`,
 * `holder` and `ms`) are emitted in the envelope `specstride.event/1`; they
 * are primary-stream events that project to nothing. Their type names belong
 * to the catalogue of feature 111 and are requested from it, not invented
 * here; this module declares the field shape the contract fixes.
 *
 * Free-text fields (`job.started` command and argument list, the step of
 * `job.first_failure`) hold text from outside the runtime: the caller admits
 * them through the one ingress before this module sees them (F118-FR-044).
 *
 * A job MAY declare an exclusive `resource` that it needs (CQ-057,
 * `job.resource`); when a check or a job waits on a declared resource,
 * `resource.wait` is emitted, and the doctor is told which resources a job
 * declared, so that it can name the ones it cannot check.
 */

import type { Ingress, SupervisionEvent } from "../ports.ts";
import { admitForWrite } from "../ingress.ts";

/** The five event types of F118-FR-042, in the order the contract lists them. */
export const JOB_EVENT_TYPES = [
  "job.started",
  "job.step",
  "job.first_failure",
  "job.ended",
  "resource.wait",
] as const;

export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

function event(type: JobEventType, fields: Record<string, unknown>): SupervisionEvent {
  return { type, fields };
}

/**
 * `job.started` — a job the runtime launched or adopted, with its command.
 * The command and the argument list are outside text: when the ingress is
 * handed in every element is admitted first (T077, F118-FR-044).
 */
export function jobStartedEvent(
  input: {
    job: string;
    mode: "launch" | "adopt";
    pid: number;
    /** The command and the argument list; outside text. */
    command?: readonly string[] | undefined;
  },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const command =
    ingress !== undefined && input.command !== undefined
      ? input.command.map((part) => admitForWrite(ingress, part, "tool-arguments").text)
      : input.command;
  return event("job.started", {
    job: input.job,
    mode: input.mode,
    pid: input.pid,
    ...(command !== undefined ? { command: [...command] } : {}),
  });
}

/** `job.step` — one step or cycle of a job that reports steps, timestamped. */
export function jobStepEvent(input: { job: string; step: string; atMs: number }): SupervisionEvent {
  return event("job.step", { job: input.job, step: input.step, at: input.atMs });
}

/** `job.first_failure` — the predicate matched, with the step that matched. */
export function jobFirstFailureEvent(
  input: { job: string; step: string },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const step =
    ingress !== undefined ? admitForWrite(ingress, input.step, "check-output").text : input.step;
  return event("job.first_failure", { job: input.job, step });
}

/** `job.ended` — the job ended, with the time since the first failure. */
export function jobEndedEvent(input: {
  job: string;
  stopped: boolean;
  msAfterFirstFailure: number;
}): SupervisionEvent {
  return event("job.ended", {
    job: input.job,
    stopped: input.stopped,
    msAfterFirstFailure: input.msAfterFirstFailure,
  });
}

/** `resource.wait` — a check or a job waits on a declared exclusive resource. */
export function resourceWaitEvent(input: {
  resource: string;
  holder: string;
  ms: number;
}): SupervisionEvent {
  return event("resource.wait", {
    resource: input.resource,
    holder: input.holder,
    ms: input.ms,
  });
}

/* ------------------------------------------------------------------ *
 * The declaration of an exclusive resource (CQ-057, `job.resource`)
 * ------------------------------------------------------------------ */

/**
 * The declaration of an exclusive resource and the doctor input that names
 * the declared resources (T070) live in `resources.ts`; this module
 * re-exports them so that the events and the declaration stay one surface.
 */

export {
  type JobResourceDeclaration,
  jobsOfResource,
  resourcesForTheDoctor,
  waitsOnADeclaredResource,
} from "./resources.ts";
