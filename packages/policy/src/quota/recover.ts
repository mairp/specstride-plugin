/**
 * T033 — the wake, the crash and the reboot paths, and the stop request read
 * during a pause (F127-FR-015, F127-FR-016).
 *
 * **F127-FR-015.** A pause holds while the runtime lives. After a WAKE of the
 * machine the remaining wait is computed from `resumeAt` and `ceilingAt` OF
 * THE RECORD and never from a timer alone — a timer that slept through four
 * hours of suspend would fire four hours late, and a monotonic clock that
 * stopped would never fire at all. After a CRASH of the runtime or a REBOOT
 * nothing relaunches by itself: `resume` finds the pause record and enters the
 * pause again with the remaining wait computed the same way. And a pause gives
 * NEITHER RELAUNCH CLASSIFIER TABLE anything to classify: there is no exit to
 * classify, because the engine did not exit.
 *
 * **F127-FR-016.** A stop request is honoured during a pause AT LEAST ONCE A
 * MINUTE: the wait is cut into ticks of at most 60 seconds, the inbox is read
 * at every tick, and a request takes the run to `stopping` and then `stopped`
 * (transitions T13 and T14). A pause never delays a stop by more than one
 * tick.
 *
 * The wait runs through the `sleep` port, so a five-hour pause with 300 ticks
 * is a test of microseconds on the fake clock of
 * `packages/policy/test/support/`.
 */
import type { Clock, PauseStore, Sleeper } from "./ports.ts";
import { type PauseRecord, readPauseRecord, PAUSE_STATE } from "./pause.ts";

/* ------------------------------------------------------------------ *
 * F127-FR-015 — the remaining wait, from the record.
 * ------------------------------------------------------------------ */

/**
 * F127-FR-015 — the remaining wait is NEVER computed from a timer. The
 * constant is the requirement as data, and `remainingWaitMs` is the one way
 * this feature computes it.
 */
export const REMAINING_WAIT_COMES_FROM_A_TIMER = false as const;

/** The two instants of the record the wait is computed from (annex B §B.17). */
export const INSTANTS_OF_THE_RECORD = Object.freeze(["resumeAt", "ceilingAt"] as const);

/** What `remainingWait` answers. */
export type RemainingWait = {
  /** The milliseconds until the run tries again, or 0 where it is due now. */
  readonly untilResumeMs: number;
  /** The milliseconds until the ceiling, or 0 where it has been reached. */
  readonly untilCeilingMs: number;
  /** The milliseconds to wait: the smaller of the two. */
  readonly waitMs: number;
  /** True where `resumeAt` has been reached (transition T7). */
  readonly resumeDue: boolean;
  /** True where `ceilingAt` has been reached (transition T8). */
  readonly ceilingReached: boolean;
  /** What the engine does now. */
  readonly action: RecoveryAction;
};

/** What the engine does with a pause record it has just read. */
export const RECOVERY_ACTIONS = ["wait", "resume", "ceiling"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

function instant(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * F127-FR-015 — the remaining wait, computed from `resumeAt` and `ceilingAt`
 * of the record and from the clock reading now.
 *
 * A clock that JUMPED (a wake of the machine, a correction by NTP) changes the
 * answer and nothing else: the two instants are absolute, so the wait after a
 * four-hour suspend is simply shorter, and a jump past `ceilingAt` reports the
 * ceiling. This is why a timer is forbidden here.
 */
export function remainingWait(record: PauseRecord, nowMs: number): RemainingWait {
  const resumeAtMs = instant(record.resumeAt);
  const ceilingAtMs = instant(record.ceilingAt);
  const untilResumeMs =
    resumeAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, resumeAtMs - nowMs);
  const untilCeilingMs =
    ceilingAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, ceilingAtMs - nowMs);
  const ceilingReached = ceilingAtMs !== null && nowMs >= ceilingAtMs;
  const resumeDue = resumeAtMs !== null && nowMs >= resumeAtMs;
  const waitMs = Math.min(untilResumeMs, untilCeilingMs);
  const action: RecoveryAction = ceilingReached ? "ceiling" : resumeDue ? "resume" : "wait";
  return Object.freeze({
    untilResumeMs,
    untilCeilingMs,
    waitMs,
    resumeDue,
    ceilingReached,
    action,
  });
}

/** The milliseconds to wait, the short form of `remainingWait`. */
export function remainingWaitMs(record: PauseRecord, nowMs: number): number {
  const wait = remainingWait(record, nowMs);
  return Number.isFinite(wait.waitMs) ? wait.waitMs : 0;
}

/* ------------------------------------------------------------------ *
 * The three paths: a wake, a crash, a reboot.
 * ------------------------------------------------------------------ */

/** The three paths F127-FR-015 names. */
export const RECOVERY_PATHS = ["wake", "crash", "reboot"] as const;
export type RecoveryPath = (typeof RECOVERY_PATHS)[number];

/**
 * F127-FR-015 — after a crash of the runtime or a reboot, NOTHING relaunches
 * by itself, and a pause gives neither relaunch classifier table anything to
 * classify.
 */
export const AFTER_A_CRASH_OR_A_REBOOT = Object.freeze({
  relaunchesByItself: false,
  /** The two tables of row 14 of annex X §X.6. */
  relaunchClassifierTables: Object.freeze(["relaunch-observe", "relaunch-root"] as const),
  /** A pause is not an exit, so neither table has an exit to classify. */
  givesTheClassifierTablesSomethingToClassify: false,
  /** The consumer's own command brings the run back. */
  broughtBackBy: "resume",
});

/** What `onWake` and `onResume` answer. */
export type Recovery = {
  readonly path: RecoveryPath;
  /** The record that was found, or null where the run was not paused. */
  readonly record: PauseRecord | null;
  /** The state the run is in after the recovery. */
  readonly state: typeof PAUSE_STATE | "running" | "blocked-on-human" | null;
  readonly wait: RemainingWait | null;
  /** True where the pause was entered again (F127-FR-015). */
  readonly pauseEnteredAgain: boolean;
  readonly note: string;
};

/**
 * F127-FR-015 — a wake of the machine. The engine is still alive and still
 * holds the record; it recomputes the remaining wait from the record.
 */
export function onWake(record: PauseRecord, clock: Clock): Recovery {
  const wait = remainingWait(record, clock.nowMs());
  return Object.freeze({
    path: "wake" as RecoveryPath,
    record,
    state:
      wait.action === "ceiling"
        ? ("blocked-on-human" as const)
        : wait.action === "resume"
          ? ("running" as const)
          : PAUSE_STATE,
    wait,
    pauseEnteredAgain: wait.action === "wait",
    note:
      `after the wake the remaining wait was computed from resumeAt and ceilingAt of the ` +
      `record and not from a timer: ${wait.waitMs} ms, action ${wait.action} (F127-FR-015)`,
  });
}

/**
 * F127-FR-015 — `resume` after a crash of the runtime or a reboot. The command
 * finds the pause record and enters the pause again, with the remaining wait
 * computed the same way. Where no record is there, there is no pause to enter.
 */
export function resumeAfterACrash(
  store: PauseStore,
  recordPath: string,
  clock: Clock,
  path: RecoveryPath = "crash",
): Recovery {
  const record = readPauseRecord(store, recordPath);
  if (record === null) {
    return Object.freeze({
      path,
      record: null,
      state: null,
      wait: null,
      pauseEnteredAgain: false,
      note:
        `\`resume\` found no pause record at ${recordPath}: the run was not paused, so there ` +
        `is no pause to enter again (F127-FR-015)`,
    });
  }
  const wait = remainingWait(record, clock.nowMs());
  return Object.freeze({
    path,
    record,
    state:
      wait.action === "ceiling"
        ? ("blocked-on-human" as const)
        : wait.action === "resume"
          ? ("running" as const)
          : PAUSE_STATE,
    wait,
    pauseEnteredAgain: wait.action === "wait",
    note:
      `\`resume\` found the pause record of the run ${record.runId} and entered the pause ` +
      `again; the remaining wait was computed from resumeAt and ceilingAt of the record: ` +
      `${wait.waitMs} ms, action ${wait.action} (F127-FR-015)`,
  });
}

/* ------------------------------------------------------------------ *
 * F127-FR-016 — the stop request read during a pause.
 * ------------------------------------------------------------------ */

/** F127-FR-016 — a stop request is honoured at least once a minute. */
export const STOP_POLL_MS = 60_000;

/** The transitions a stop during a pause performs (annex E §E.1). */
export const STOP_TRANSITIONS = Object.freeze(["T13", "T14"] as const);

/** The two states a stop passes through (F127-FR-016). */
export const STOP_STATES = Object.freeze(["stopping", "stopped"] as const);

/** The exit code of an engine that stopped on a request (transition T14). */
export const STOP_EXIT_CODE = 6;

/** The stop reason of a stop on a request (annex E §E.3). */
export const STOP_REASON = "stop_flag" as const;

/** The inbox the pause reads at every tick (annex B §B.5). */
export type StopInbox = {
  /** True where a stop request is in the inbox now. */
  stopRequested(): boolean;
};

/** How the pause is waited through. */
export type WaitOptions = {
  /** The tick of the stop poll; `STOP_POLL_MS` by default (F127-FR-016). */
  readonly stopPollMs?: number | undefined;
  /** A bound on the ticks, so a test of a broken clock cannot spin for ever. */
  readonly maxTicks?: number | undefined;
};

/** Why the wait ended. */
export const WAIT_OUTCOMES = ["resume", "ceiling", "stopped"] as const;
export type WaitOutcome = (typeof WAIT_OUTCOMES)[number];

/** What `waitThroughThePause` answers. */
export type WaitResult = {
  readonly outcome: WaitOutcome;
  /** How many ticks the wait took. */
  readonly ticks: number;
  /** The milliseconds actually waited, as the sleep port moved the clock. */
  readonly waitedMs: number;
  /** The tick the stop request was read at, where one was; else null. */
  readonly stopReadAtTick: number | null;
  /** The milliseconds between the stop request and the stop; one tick at most. */
  readonly stopDelayedByMs: number | null;
  /** The states a stop passed through, in order; empty where none happened. */
  readonly states: readonly string[];
  /** The exit code of the engine, where the wait ended in a stop. */
  readonly exitCode: number | null;
  readonly stopReason: string | null;
  readonly note: string;
};

/**
 * Wait through a pause, reading the stop inbox at least once a minute
 * (F127-FR-016), and recomputing the remaining wait from the record at every
 * tick (F127-FR-015).
 *
 * The wait ends in one of three ways: the resume time was reached, the ceiling
 * was reached, or a stop request was read. A stop is never delayed by more
 * than one tick, which the result reports as `stopDelayedByMs`.
 */
export async function waitThroughThePause(
  ports: { readonly clock: Clock; readonly sleep: Sleeper },
  record: PauseRecord,
  inbox: StopInbox,
  options: WaitOptions = {},
): Promise<WaitResult> {
  const tickMs =
    typeof options.stopPollMs === "number" &&
    Number.isFinite(options.stopPollMs) &&
    options.stopPollMs > 0
      ? options.stopPollMs
      : STOP_POLL_MS;
  const maxTicks =
    typeof options.maxTicks === "number" && options.maxTicks > 0
      ? Math.floor(options.maxTicks)
      : 100_000;

  const startedAtMs = ports.clock.nowMs();
  let ticks = 0;

  for (;;) {
    // F127-FR-016 — the inbox is read FIRST, so a request that arrived while
    // the previous tick slept is honoured before another tick is spent.
    if (inbox.stopRequested()) {
      const waitedMs = Math.max(0, ports.clock.nowMs() - startedAtMs);
      return Object.freeze({
        outcome: "stopped" as WaitOutcome,
        ticks,
        waitedMs,
        stopReadAtTick: ticks,
        stopDelayedByMs: Math.min(tickMs, waitedMs),
        states: STOP_STATES,
        exitCode: STOP_EXIT_CODE,
        stopReason: STOP_REASON,
        note:
          `a stop request was read at tick ${ticks} of the pause, within ${tickMs} ms of its ` +
          `arrival; the run passes to ${STOP_STATES.join(" and then ")} ` +
          `(${STOP_TRANSITIONS.join(", ")}) and the engine exits ${STOP_EXIT_CODE}; a pause ` +
          `never delays a stop (F127-FR-016)`,
      });
    }

    const wait = remainingWait(record, ports.clock.nowMs());
    if (wait.action !== "wait") {
      const waitedMs = Math.max(0, ports.clock.nowMs() - startedAtMs);
      return Object.freeze({
        outcome: wait.action === "ceiling" ? ("ceiling" as WaitOutcome) : ("resume" as WaitOutcome),
        ticks,
        waitedMs,
        stopReadAtTick: null,
        stopDelayedByMs: null,
        states: Object.freeze([]),
        exitCode: null,
        stopReason: null,
        note:
          `the wait ended after ${ticks} ticks of at most ${tickMs} ms because ` +
          `${wait.action === "ceiling" ? "the ceiling was reached" : "the resume time was reached"}; ` +
          `the remaining wait was recomputed from the record at every tick (F127-FR-015)`,
      });
    }

    if (ticks >= maxTicks) {
      const waitedMs = Math.max(0, ports.clock.nowMs() - startedAtMs);
      return Object.freeze({
        outcome: "ceiling" as WaitOutcome,
        ticks,
        waitedMs,
        stopReadAtTick: null,
        stopDelayedByMs: null,
        states: Object.freeze([]),
        exitCode: null,
        stopReason: null,
        note:
          `the wait was cut after ${maxTicks} ticks, the bound the caller set; the record's ` +
          `instants did not come due, which is a clock that does not move`,
      });
    }

    await ports.sleep.sleep(Math.min(tickMs, wait.waitMs));
    ticks += 1;
  }
}

/** How many ticks a wait of `waitMs` takes, for a test of the poll interval. */
export function ticksFor(waitMs: number, stopPollMs: number = STOP_POLL_MS): number {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
  return Math.ceil(waitMs / stopPollMs);
}
