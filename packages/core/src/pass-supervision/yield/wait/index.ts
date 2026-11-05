/**
 * T046 of feature 118 — the wait loop of a yield and its four outcomes
 * (F118-FR-020, F118-FR-022; PT-118-C-055, PT-118-C-013).
 *
 * On every tick, in this order: the stop request, the predicate, the deadline
 * of the yield, the wall-clock budget of the run; and then sleep for the poll
 * interval. The outcomes are the closed set of row 112: `satisfied`,
 * `timeout`, `stop`, `wall_budget`. A stop request during the wait ends the
 * run with the stop reason `stop_flag` and the fields `iter`, `yield=true`,
 * `job_pid` and `job_log`, and the job is left running. A deadline gives the
 * reason `deadline` in the event `yield_timeout`, and a spent budget the
 * reason `wall_budget`; each ends the run with the stop reason
 * `proposer_yield_timeout` (field `iter`).
 *
 * The loop never sleeps by itself: the caller advances its clock and calls
 * `step` again, so that the tests run on a fake clock and no real time is
 * spent in any suite.
 */
import type { EventWriter } from "../../ports.ts";
import { evaluatePredicate, type PredicateDeps } from "../predicates/index.ts";

/** The four outcomes of a wait (row 112 of annex X §X.6). */
export const WAIT_OUTCOMES = ["satisfied", "timeout", "stop", "wall_budget"] as const;
export type WaitOutcome = (typeof WAIT_OUTCOMES)[number];

/** The stop reasons F118-FR-020 binds. */
export const STOP_REASON_YIELD_TIMEOUT = "proposer_yield_timeout";

/** One state of the wait between two steps. */
export interface WaitState {
  readonly startedAtMs: number;
  readonly deadlineSec: number;
  /** The kind of `resume_when` the artifact declared. */
  readonly predicateKind: string;
  /** The working directory of the job (the `command` predicate runs there). */
  readonly cwd: string;
  /** The path and the pattern the predicate reads, when the kind needs them. */
  readonly predicatePath?: string | undefined;
  readonly predicatePattern?: string | undefined;
  /** The poll interval of this phase attempt, in ms (F118-FR-015). */
  readonly pollIntervalMs: number;
  readonly jobPid: number | undefined;
  readonly jobLog: string | undefined;
  readonly adopted: boolean;
}

/** The decision after one step of the loop. */
export type WaitStep =
  | { readonly done: false; readonly sleptMs: number }
  | {
      readonly done: true;
      readonly outcome: WaitOutcome;
      /** The reason inside the event `yield_timeout` (absent when satisfied or stopped). */
      readonly timeoutReason?: "deadline" | "wall_budget";
      readonly stopRequest?: {
        readonly stopReason: "stop_flag";
        readonly iter: number;
        readonly yield: true;
        readonly jobPid: number | undefined;
        readonly jobLog: string | undefined;
      };
    };

/** The world one step of the loop reads. */
export interface WaitDeps extends PredicateDeps {
  readonly clock: { nowMs(): number };
  readonly events: EventWriter;
  /** The stop request of the run, when one is pending (the inbox of feature 100). */
  readonly stopRequested: () => boolean;
  /** The start time of the run, in ms; `undefined` skips the budget check. */
  readonly runStartedAtMs: number | undefined;
  /** The wall-clock budget of the run, in whole minutes; `undefined` skips the check. */
  readonly wallBudgetMin: number | undefined;
  readonly iter: number;
  /** The poll interval, in ms of fake time, the loop sleeps between steps. */
  readonly pollIntervalMs: number;
  /** Advance the fake clock by `ms` (the edge would sleep instead). */
  readonly advanceTime: (ms: number) => void;
}

/** One step of the wait loop, in the order of F118-FR-020. */
export function waitStep(state: WaitState, deps: WaitDeps): WaitStep {
  const nowMs = deps.clock.nowMs();

  // 1. The stop request: first of all the checks, and the job is left running.
  if (deps.stopRequested()) {
    return {
      done: true,
      outcome: "stop",
      stopRequest: {
        stopReason: "stop_flag",
        iter: deps.iter,
        yield: true,
        jobPid: state.jobPid,
        jobLog: state.jobLog,
      },
    };
  }

  // 2. The predicate. An unsatisfiable predicate ends the wait as `timeout`
  //    (fail closed, F118-FR-018).
  const result = evaluatePredicate(
    {
      kind: state.predicateKind,
      nowMs,
      jobPid: state.jobPid,
      cwd: state.cwd,
      ...(state.predicatePath !== undefined ? { path: state.predicatePath } : {}),
      ...(state.predicatePattern !== undefined ? { pattern: state.predicatePattern } : {}),
    },
    deps,
  );
  if (result === 0) {
    return { done: true, outcome: "satisfied" };
  }
  if (result === 2) {
    deps.events.write({ type: "yield_timeout", fields: { reason: "deadline" } });
    return { done: true, outcome: "timeout", timeoutReason: "deadline" };
  }

  // 3. The deadline of the yield.
  if (nowMs - state.startedAtMs >= state.deadlineSec * 1000) {
    deps.events.write({ type: "yield_timeout", fields: { reason: "deadline" } });
    return { done: true, outcome: "timeout", timeoutReason: "deadline" };
  }

  // 4. The wall-clock budget of the run; skipped when either is unknown.
  if (deps.runStartedAtMs !== undefined && deps.wallBudgetMin !== undefined) {
    if (nowMs - deps.runStartedAtMs >= deps.wallBudgetMin * 60 * 1000) {
      deps.events.write({ type: "yield_timeout", fields: { reason: "wall_budget" } });
      return { done: true, outcome: "wall_budget", timeoutReason: "wall_budget" };
    }
  }

  return { done: false, sleptMs: deps.pollIntervalMs };
}

/** Run the whole loop to an outcome, polling every `pollIntervalMs` of fake time. */
export function runWait(state: WaitState, deps: WaitDeps): Extract<WaitStep, { done: true }> {
  for (;;) {
    const step = waitStep(state, deps);
    if (step.done) return step;
    deps.advanceTime(step.sleptMs);
  }
}

/** The job the first-failure predicate stopped ends the wait as `satisfied`. */
export function stoppedByRuntimeMark(): "stopped-by-runtime" {
  return "stopped-by-runtime";
}
