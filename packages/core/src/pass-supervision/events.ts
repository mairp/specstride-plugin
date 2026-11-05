/**
 * T032 of feature 118 — the events of the pass (F118-FR-027, F118-FR-035;
 * C-008, C-053, C-021; B-0096, B-0543 to B-0546, B-0554 to B-0560, B-0349,
 * B-0350) and the log lines of the baseline (F118-FR-029, F118-FR-030;
 * C-012, C-021, C-057; B-0213, B-0219, B-0358, B-0646, B-0647, B-0655 to
 * B-0662).
 *
 * The as-is events are emitted with the fields of the baseline and each has
 * a row in the compatibility projection (F100-FR-199); the two long-job
 * events and their lines belong to F118-FR-035. The log lines that carry no
 * implementation name are byte for byte the lines of the baseline
 * (F118-FR-029); the lines that begin with the name of an implementation
 * file carry the logical component name in that place and are otherwise
 * equal (rule N-15, F118-FR-030). No new line is printed under the `parity`
 * profile (owner ruling 68).
 */

import type { Ingress, SupervisionEvent } from "./ports.ts";
import { admitArgv, admitForWrite } from "./ingress.ts";

function event(type: string, fields: Record<string, unknown>): SupervisionEvent {
  return { type, fields };
}

/** `proposer_cap` — the ceiling of the phase as it was resolved (F118-FR-027). */
export function proposerCapEvent(input: {
  phase: number;
  attempt: number;
  role: string;
  seconds: number;
  source: string;
  arm?: string | undefined;
  yieldPoll: number;
  yieldPollSource: string;
  yieldPollArm?: string | undefined;
  tamperBracket?: string | undefined;
}): SupervisionEvent {
  return event("proposer_cap", {
    phase: input.phase,
    attempt: input.attempt,
    role: input.role,
    seconds: input.seconds,
    source: input.source,
    ...(input.arm !== undefined ? { arm: input.arm } : {}),
    yield_poll: input.yieldPoll,
    yield_poll_source: input.yieldPollSource,
    ...(input.yieldPollArm !== undefined ? { yield_poll_arm: input.yieldPollArm } : {}),
    ...(input.tamperBracket !== undefined ? { tamper_bracket: input.tamperBracket } : {}),
  });
}

/**
 * `pass_killed` — one watchdog kill, with the same reason and class as the
 * note. The detail came from outside the runtime: when the ingress is handed
 * in it is admitted first (T077, F118-FR-044).
 */
export function passKilledEvent(
  input: {
    iter: number;
    reason: string;
    class: string;
    elapsed: number;
    detail?: string | undefined;
    checkpoint?: boolean | undefined;
  },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const detail =
    ingress !== undefined && input.detail !== undefined
      ? admitForWrite(ingress, input.detail, "tool-arguments").text
      : input.detail;
  return event("pass_killed", {
    iter: input.iter,
    reason: input.reason,
    class: input.class,
    elapsed: input.elapsed,
    ...(detail !== undefined ? { detail } : {}),
    ...(input.checkpoint !== undefined ? { checkpoint: input.checkpoint } : {}),
  });
}

/** `yield_invalid` — a refused artifact (`log` for a launch that never reported a pid). */
export function yieldInvalidEvent(input: {
  iter: number;
  reason: string;
  artifact: string;
  log?: string | undefined;
}): SupervisionEvent {
  return event("yield_invalid", {
    iter: input.iter,
    reason: input.reason,
    artifact: input.artifact,
    ...(input.log !== undefined ? { log: input.log } : {}),
  });
}

/**
 * `yield_job_start` — a job of a yield, launched or adopted. The argument
 * list came from outside the runtime: when the ingress is handed in every
 * element is admitted first (T077, F118-FR-044).
 */
export function yieldJobStartEvent(
  input: {
    iter: number;
    mode: "launch" | "adopt";
    pid: number;
    log: string;
    sid: number;
    argv?: readonly string[] | undefined;
  },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const argv =
    ingress !== undefined && input.argv !== undefined
      ? admitArgv(ingress, input.argv).argv
      : input.argv;
  return event("yield_job_start", {
    iter: input.iter,
    mode: input.mode,
    pid: input.pid,
    log: input.log,
    sid: input.sid,
    ...(argv !== undefined ? { argv: [...argv] } : {}),
  });
}

/** `yield_wait` — one tick of the wait on a yield. */
export function yieldWaitEvent(input: {
  iter: number;
  elapsed: number;
  predicateKind: string;
  yieldIndex: number;
}): SupervisionEvent {
  return event("yield_wait", {
    iter: input.iter,
    elapsed: input.elapsed,
    predicate_kind: input.predicateKind,
    yield_index: input.yieldIndex,
  });
}

/**
 * `pass_yield` — the pass ended with an accepted yield artifact. The `reason`
 * is the artifact's own free text: when the ingress is handed in it is
 * admitted first (T077, F118-FR-044).
 */
export function passYieldEvent(
  input: {
    iter: number;
    reason: string;
    predicateKind: string;
    deadlineSec: number;
    jobMode: string;
    jobLog: string;
    yieldIndex: number;
  },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const reason =
    ingress !== undefined ? admitForWrite(ingress, input.reason, "free-text").text : input.reason;
  return event("pass_yield", {
    iter: input.iter,
    reason,
    predicate_kind: input.predicateKind,
    deadline_sec: input.deadlineSec,
    job_mode: input.jobMode,
    job_log: input.jobLog,
    yield_index: input.yieldIndex,
  });
}

/** `yield_resume` — the wait ended and the pass is given back. */
export function yieldResumeEvent(input: {
  iter: number;
  waitedSec: number;
  jobRc: number | undefined;
  jobDurationSec: number | undefined;
  yieldIndex: number;
  predicateKind: string;
}): SupervisionEvent {
  return event("yield_resume", {
    iter: input.iter,
    waited_sec: input.waitedSec,
    ...(input.jobRc !== undefined ? { job_rc: input.jobRc } : {}),
    ...(input.jobDurationSec !== undefined ? { job_duration_sec: input.jobDurationSec } : {}),
    yield_index: input.yieldIndex,
    predicate_kind: input.predicateKind,
  });
}

/** `yield_timeout` — the deadline or the budget spent during the wait. */
export function yieldTimeoutEvent(input: {
  iter: number;
  reason: "deadline" | "wall_budget";
  waitedSec: number;
  deadlineSec: number;
  predicateKind: string;
  jobLog: string;
}): SupervisionEvent {
  return event("yield_timeout", {
    iter: input.iter,
    reason: input.reason,
    waited_sec: input.waitedSec,
    deadline_sec: input.deadlineSec,
    predicate_kind: input.predicateKind,
    job_log: input.jobLog,
  });
}

/** `iter_short_pass` — one more short pass in a row. */
export function iterShortPassEvent(input: {
  iter: number;
  elapsed: number;
  consec: number;
}): SupervisionEvent {
  return event("iter_short_pass", {
    iter: input.iter,
    elapsed: input.elapsed,
    consec: input.consec,
  });
}

/** `iter_cap` — one more consecutive kill at the ceiling. */
export function iterCapEvent(input: {
  iter: number;
  reason: string;
  elapsed: number;
  consec: number;
  max: number;
}): SupervisionEvent {
  return event("iter_cap", {
    iter: input.iter,
    reason: input.reason,
    elapsed: input.elapsed,
    consec: input.consec,
    max: input.max,
  });
}

/** `pass_cost_unknown` — emitted for a hard-cap kill: the severed stream reports no usage. */
export function passCostUnknownEvent(input: {
  iter: number;
  reason: string;
  elapsed: number;
}): SupervisionEvent {
  return event("pass_cost_unknown", {
    iter: input.iter,
    reason: input.reason,
    elapsed: input.elapsed,
  });
}

/**
 * `long_job_start` — a long job launched detached (F118-FR-035). The command
 * came from outside the runtime: when the ingress is handed in it is admitted
 * first (T077, F118-FR-044).
 */
export function longJobStartEvent(
  input: { phase: number; attempt: number; cmd: string; log: string },
  ingress?: Ingress | undefined,
): SupervisionEvent {
  const cmd =
    ingress !== undefined ? admitForWrite(ingress, input.cmd, "tool-arguments").text : input.cmd;
  return event("long_job_start", {
    phase: input.phase,
    attempt: input.attempt,
    cmd,
    log: input.log,
  });
}

/** `long_job_ended` — a long job no longer running (F118-FR-035). */
export function longJobEndedEvent(input: {
  phase: number;
  attempt: number;
  log: string;
}): SupervisionEvent {
  return event("long_job_ended", {
    phase: input.phase,
    attempt: input.attempt,
    log: input.log,
  });
}

/* ------------------------------------------------------------------ *
 * The log lines of the baseline (F118-FR-029, F118-FR-030)
 * ------------------------------------------------------------------ */

/** `      pass ceiling: <s>s (<source>); yield poll: <s>s (<source>)` (no component name). */
export function ceilingLine(input: {
  ceilingSec: number;
  ceilingSource: string;
  pollSec: number;
  pollSource: string;
}): string {
  return (
    `      pass ceiling: ${input.ceilingSec}s (${input.ceilingSource}); ` +
    `yield poll: ${input.pollSec}s (${input.pollSource})`
  );
}

/** `>>> proposer's yield budget is spent for phase <N> — halting (exit 4).` plus guidance. */
export function yieldBudgetSpentLines(phase: number, yieldJobsDir: string): string[] {
  return [
    `>>> proposer's yield budget is spent for phase ${phase} — halting (exit 4).`,
    `    Declare the long step as a verification command, or raise the per-phase ` +
      `ceiling with --proposer-timeout-phase. The yield jobs so far are in ${yieldJobsDir}.`,
  ];
}

/** `>>> proposer hit the pass ceiling repeatedly for phase <N> — halting (exit 4).` plus guidance. */
export function capExhaustedHaltingLines(phase: number): string[] {
  return [
    `>>> proposer hit the pass ceiling repeatedly for phase ${phase} — halting (exit 4).`,
    `    Prefer a long job or a phase split over a higher ceiling.`,
  ];
}

/**
 * `>>> long-job(phase <N> attempt <M>): launching detached — <cmd>` (F118-FR-035).
 * The command came from outside the runtime: when the ingress is handed in it
 * is admitted first (T077, F118-FR-044).
 */
export function longJobLaunchLine(
  phase: number,
  attempt: number,
  cmd: string,
  ingress?: Ingress | undefined,
): string {
  const admittedCmd =
    ingress !== undefined ? admitForWrite(ingress, cmd, "tool-arguments").text : cmd;
  return `>>> long-job(phase ${phase} attempt ${attempt}): launching detached — ${admittedCmd}`;
}

/** `>>> long-job(...): process <pid> no longer running — treating as ended, NOT auto-restarting. See <log>.` */
export function longJobEndedLine(phase: number, attempt: number, pid: number, log: string): string {
  return (
    `>>> long-job(phase ${phase} attempt ${attempt}): process ${pid} no longer running — ` +
    `treating as ended, NOT auto-restarting. See ${log}`
  );
}

/** `refusing the pass yield — <detail>` (the component name is the logical one, rule N-15). */
export function refuseYieldLine(detail: string): string {
  return `refusing the pass yield — ${detail}`;
}

/** `refusing the adopt yield — pid <n> is in this pass's own session (<sid>); ...` */
export function refuseAdoptYieldLine(pid: number, sessionId: number): string {
  return (
    `refusing the adopt yield — pid ${pid} is in this pass's own session (${sessionId}); ` +
    `the job would die with the pass. Start it with setsid, or use mode 'launch'.`
  );
}

/** `this attempt has already yielded <n> times — aborting (exit 9). ...` */
export function yieldBudgetAbortLine(count: number): string {
  return (
    `this attempt has already yielded ${count} times — aborting (exit 9). ` +
    `The yield budget of the attempt is spent; no further job is started.`
  );
}

/**
 * `pass <i> yielded — <reason>. Waiting on '<kind>' ...` The reason is the
 * artifact's own free text: when the ingress is handed in it is admitted
 * first (T077, F118-FR-044).
 */
export function passYieldLine(
  passIndex: number,
  reason: string,
  kind: string,
  deadlineSec: number,
  ingress?: Ingress | undefined,
): string {
  const admittedReason =
    ingress !== undefined ? admitForWrite(ingress, reason, "free-text").text : reason;
  return (
    `pass ${passIndex} yielded — ${admittedReason}. Waiting on '${kind}' with NO model session ` +
    `open (deadline ${deadlineSec}s).`
  );
}

/** `pass <i> hit the pass ceiling (<reason>, <n>s) — consecutive cap kills: <k>/<max>` */
export function capKillLine(
  passIndex: number,
  reason: string,
  elapsedSec: number,
  consec: number,
  max: number,
): string {
  return `pass ${passIndex} hit the pass ceiling (${reason}, ${elapsedSec}s) — consecutive cap kills: ${consec}/${max}`;
}

/** `<n> consecutive passes hit the pass ceiling — aborting (exit 10). ...` */
export function capExhaustedAbortLine(consec: number): string {
  return (
    `${consec} consecutive passes hit the pass ceiling — aborting (exit 10). ` +
    `Do NOT just raise the cap. Declare the long step as a yield, or pre-stage it as a ` +
    `verification command, or split the phase.`
  );
}
