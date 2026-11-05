/**
 * T029 — the resume time, the probe schedule and the resume (F127-FR-013).
 *
 * `resumeAt` = `resetsAt` + `pause.marginMs` + a random jitter of 0 to
 * `pause.jitterMs`. The margin exists because a provider's reset time is the
 * instant the window reopens and not the instant it is ready; the jitter
 * exists so that many runs that were limited together do not all call back in
 * the same millisecond.
 *
 * With `resetsAt` NULL there is nothing to add a margin to, so the pause
 * PROBES on the schedule of §Q.2: after 5, 15, 30 and 60 minutes, and then
 * every 60 minutes (`pause.probeScheduleMs`, with the last entry repeated).
 * `resumeAt` is then the time of the next probe.
 *
 * At the resume the engine emits `run.resumed`, REMOVES the pause record and
 * gives the pass back; the next pass runs IN THE SAME PHASE ATTEMPT, in a
 * fresh session or a continued one where the harness supports it.
 *
 * The module reads no clock and draws no random number of its own: both are
 * ports (`./ports.ts`), which is what makes CT-127-15 a fake-clock test to the
 * millisecond.
 */
import type { Clock, EventWriter, PauseStore, PolicyEvent, RandomSource } from "./ports.ts";
import { type EmitOptions, type PairState, runResumed } from "./events.ts";
import { PAUSE_STATE, type PauseRecord } from "./pause.ts";
import type { PausedTime } from "./clocks.ts";

/* ------------------------------------------------------------------ *
 * The timing, with the defaults of row 111 of the `parity` profile.
 * ------------------------------------------------------------------ */

/** The timing of a pause (`pause.*`, row 111 of annex X §X.7). */
export type PauseTiming = {
  /** `pause.marginMs`; 60000 (60 seconds) by default (F127-FR-013). */
  readonly marginMs: number;
  /** `pause.jitterMs`; 30000 (30 seconds) by default (F127-FR-013). */
  readonly jitterMs: number;
  /** `pause.probeScheduleMs`; the last entry repeats (§Q.2). */
  readonly probeScheduleMs: readonly number[];
};

/** The defaults of row 111: 60000; 30000; 5, 15, 30 and 60 minutes. */
export const DEFAULT_PAUSE_TIMING: PauseTiming = Object.freeze({
  marginMs: 60_000,
  jitterMs: 30_000,
  probeScheduleMs: Object.freeze([300_000, 900_000, 1_800_000, 3_600_000]),
});

/** The transition of the run-state machine the resume performs. */
export const RESUME_TRANSITION = "T7" as const;

/** The state the run returns to. */
export const STATE_AFTER_A_RESUME = "running" as const;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function timingOf(timing: Partial<PauseTiming> | undefined): PauseTiming {
  const schedule =
    timing?.probeScheduleMs !== undefined && timing.probeScheduleMs.length > 0
      ? Object.freeze([...timing.probeScheduleMs])
      : DEFAULT_PAUSE_TIMING.probeScheduleMs;
  return Object.freeze({
    marginMs: finite(timing?.marginMs, DEFAULT_PAUSE_TIMING.marginMs),
    jitterMs: finite(timing?.jitterMs, DEFAULT_PAUSE_TIMING.jitterMs),
    probeScheduleMs: schedule,
  });
}

/* ------------------------------------------------------------------ *
 * The probe schedule of §Q.2.
 * ------------------------------------------------------------------ */

/**
 * The delay of the probe at `probeIndex`, from the start of the pause. The
 * LAST entry of the schedule repeats, which is §Q.2's "and then every 60
 * minutes": index 0 is 5 minutes, 1 is 15, 2 is 30, 3 is 60, and 4, 5, … are
 * 60 minutes apart.
 */
export function probeDelayMs(probeIndex: number, timing?: Partial<PauseTiming>): number {
  const schedule = timingOf(timing).probeScheduleMs;
  const index = Number.isFinite(probeIndex) && probeIndex > 0 ? Math.floor(probeIndex) : 0;
  if (index < schedule.length) return schedule[index];
  const last = schedule[schedule.length - 1];
  return schedule[schedule.length - 1] + last * (index - (schedule.length - 1));
}

/** The instant of the probe at `probeIndex`, measured from `sinceMs`. */
export function probeAtMs(
  sinceMs: number,
  probeIndex: number,
  timing?: Partial<PauseTiming>,
): number {
  return sinceMs + probeDelayMs(probeIndex, timing);
}

/** The first `count` probe instants of a pause that began at `sinceMs`. */
export function probeSchedule(
  sinceMs: number,
  count: number,
  timing?: Partial<PauseTiming>,
): readonly number[] {
  const out: number[] = [];
  for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
    out.push(probeAtMs(sinceMs, index, timing));
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ *
 * The resume time.
 * ------------------------------------------------------------------ */

/** Where `resumeAt` came from. */
export const RESUME_SOURCES = ["reset-plus-margin", "next-probe"] as const;
export type ResumeSource = (typeof RESUME_SOURCES)[number];

/** The resume time and how it was built (F127-FR-013). */
export type ResumeTime = {
  /** The instant the run tries again, in milliseconds since the epoch. */
  readonly resumeAtMs: number;
  /** The same instant as a timestamp, for the pause record. */
  readonly resumeAt: string;
  readonly source: ResumeSource;
  /** The margin that was added (0 for a probe-driven resume). */
  readonly marginMs: number;
  /** The jitter that was drawn, 0 to `pause.jitterMs`. */
  readonly jitterMs: number;
  /** The fraction the random port gave, for a test that fixes it. */
  readonly jitterFraction: number;
  /** The probe index this resume time belongs to. */
  readonly probeIndex: number;
};

/** What `resumeTimeFor` is handed. */
export type ResumeTimeInput = {
  /** The reset time of the classification, or null (§Q.2). */
  readonly resetsAt: string | null;
  /** The start of the pause, in milliseconds; the caller reads its clock. */
  readonly sinceMs: number;
  /** The probe index, where `resetsAt` is null; 0 at the first probe. */
  readonly probeIndex?: number | undefined;
};

/**
 * F127-FR-013 — the resume time.
 *
 * With a KNOWN reset time: `resetsAt` + `pause.marginMs` + a jitter of 0 to
 * `pause.jitterMs`. With an UNKNOWN reset time: the instant of the next probe
 * of §Q.2's schedule, with no margin — the schedule is the margin.
 *
 * The jitter is drawn from the random port and reported, so a test that fixes
 * the port can assert `resumeAt` to the millisecond.
 */
export function resumeTimeFor(
  input: ResumeTimeInput,
  random: RandomSource,
  timing?: Partial<PauseTiming>,
): ResumeTime {
  const resolved = timingOf(timing);
  const probeIndex =
    Number.isFinite(input.probeIndex ?? 0) && (input.probeIndex ?? 0) > 0
      ? Math.floor(input.probeIndex as number)
      : 0;
  const fraction = random.fraction();
  const resetMs = input.resetsAt === null ? Number.NaN : Date.parse(input.resetsAt);

  if (Number.isNaN(resetMs)) {
    const at = probeAtMs(input.sinceMs, probeIndex, resolved);
    return Object.freeze({
      resumeAtMs: at,
      resumeAt: new Date(at).toISOString(),
      source: "next-probe" as ResumeSource,
      marginMs: 0,
      jitterMs: 0,
      jitterFraction: fraction,
      probeIndex,
    });
  }

  const jitter = Math.floor(fraction * resolved.jitterMs);
  const at = resetMs + resolved.marginMs + jitter;
  return Object.freeze({
    resumeAtMs: at,
    resumeAt: new Date(at).toISOString(),
    source: "reset-plus-margin" as ResumeSource,
    marginMs: resolved.marginMs,
    jitterMs: jitter,
    jitterFraction: fraction,
    probeIndex,
  });
}

/** True where the resume time of the record has been reached (transition T7). */
export function isResumeDue(record: PauseRecord, nowMs: number): boolean {
  if (record.resumeAt === null) return false;
  const at = Date.parse(record.resumeAt);
  return !Number.isNaN(at) && nowMs >= at;
}

/* ------------------------------------------------------------------ *
 * The resume itself.
 * ------------------------------------------------------------------ */

/** Why the run resumed (F127-FR-013: `resumeAt` reached, or a probe succeeded). */
export const RESUMED_BY = ["resume-time", "probe-succeeded"] as const;
export type ResumedBy = (typeof RESUMED_BY)[number];

/** How the next pass's session is started, where the harness has a choice. */
export const SESSION_AFTER_A_RESUME = ["fresh", "continued"] as const;
export type SessionAfterAResume = (typeof SESSION_AFTER_A_RESUME)[number];

/** What `resume` answers. */
export type ResumeResult = {
  readonly state: typeof STATE_AFTER_A_RESUME;
  readonly transition: typeof RESUME_TRANSITION;
  readonly resumedBy: ResumedBy;
  /** The event `run.resumed`, which closes the pair of F127-FR-040. */
  readonly event: PolicyEvent;
  readonly pair: PairState;
  /** True: the pause record was removed (F127-FR-013). */
  readonly recordRemoved: boolean;
  /** The path the record was removed from. */
  readonly recordPath: string;
  /** The milliseconds of this pause, which `run.resumed` carries. */
  readonly pausedMs: number;
  /** The paused time after the pause, on the attempt and on the run. */
  readonly pausedTime: PausedTime;
  /** True: the pass is given back (F127-FR-013). */
  readonly passGivenBack: true;
  /** The phase attempt the next pass runs in: the SAME one. */
  readonly attemptId: string;
  /** Whether the next pass starts a fresh session or continues one. */
  readonly session: SessionAfterAResume;
  readonly note: string;
};

/** The ports the resume needs. */
export type ResumePorts = {
  readonly clock: Clock;
  readonly fileWriter: PauseStore;
  readonly eventWriter: EventWriter;
};

/** What `resume` is handed. */
export type ResumeInput = {
  readonly record: PauseRecord;
  readonly recordPath: string;
  readonly resumedBy: ResumedBy;
  /** The milliseconds this pause lasted, from `closePause` of `./clocks.ts`. */
  readonly pausedMs: number;
  /** The paused time before this pause closed. */
  readonly pausedTime: PausedTime;
  /** `continued` where the harness supports continuing the session. */
  readonly session?: SessionAfterAResume | undefined;
};

/**
 * F127-FR-013 — the resume (transition T7).
 *
 * Emits `run.resumed` with `pausedMs`, removes the pause record and gives the
 * pass back. The next pass runs in the SAME phase attempt — the attempt never
 * closed, because F127-FR-010 kept it open.
 */
export function resume(
  ports: ResumePorts,
  input: ResumeInput,
  pair: PairState,
  options: EmitOptions = {},
): ResumeResult {
  const closed = runResumed(
    ports.eventWriter,
    pair,
    {
      pausedMs: input.pausedMs,
      role: input.record.role,
      resumedBy: input.resumedBy,
    },
    options,
  );
  ports.fileWriter.remove(input.recordPath);
  const pausedTime = Object.freeze({
    attemptPausedMs: input.pausedTime.attemptPausedMs,
    runPausedMs: input.pausedTime.runPausedMs,
  });
  return Object.freeze({
    state: STATE_AFTER_A_RESUME,
    transition: RESUME_TRANSITION,
    resumedBy: input.resumedBy,
    event: closed.event,
    pair: closed.pair,
    recordRemoved: !ports.fileWriter.exists(input.recordPath),
    recordPath: input.recordPath,
    pausedMs: input.pausedMs,
    pausedTime,
    passGivenBack: true as const,
    attemptId: input.record.attemptId,
    session: input.session ?? "fresh",
    note:
      `the run left ${PAUSE_STATE} because ${input.resumedBy === "resume-time" ? "the resume time was reached" : "a probe succeeded"}; ` +
      `the pause record was removed, the pass is given back and the next pass runs in the same ` +
      `phase attempt ${input.record.attemptId} (F127-FR-013)`,
  });
}
