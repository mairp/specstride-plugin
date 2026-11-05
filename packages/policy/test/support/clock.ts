/**
 * T003 — the fake clock and the fake sleep of the test frame of feature 127
 * (`plan.md`, **Testing**; *Time* of "Physical choices behind the
 * specification").
 *
 * Every module of this feature takes `now()` and `sleep(ms)` as ports
 * (`../../src/quota/ports.ts`), so a test of the pause, of `resumeAt`, of the
 * probe schedule and of the ceiling moves time by hand and waits for nothing.
 *
 * The fake clock keeps two readings apart, as `Clock` of annex A §A.3 asks:
 *
 *  - the wall reading (`nowMs`, `nowIso`), which a clock change moves —
 *    `jumpTo` and `jumpBy` are the clock change of F127-FR-015;
 *  - the monotonic reading (`monotonicMs`), which a clock change never moves,
 *    and which `advance` and the fake sleep move together with the wall
 *    reading.
 *
 * The fake sleep never waits: it adds the milliseconds to the clock it is
 * bound to and returns. So a pause of five hours is a test of microseconds,
 * and a test that forgot to inject the fake cannot pass by being slow.
 */
import type { Clock, Sleeper } from "../../src/quota/ports.ts";

/** The instant the fake clock starts at, unless a test gives another: 2026-01-01T00:00:00.000Z. */
export const DEFAULT_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/** The monotonic reading the fake clock starts at. A test never depends on it. */
export const DEFAULT_MONOTONIC_MS = 1_000;

/** One recorded call of the fake sleep. */
export type SleepCall = {
  /** The milliseconds the caller asked for, unchanged. */
  readonly askedMs: number;
  /** The milliseconds the clock moved: 0 for a negative or non-finite ask. */
  readonly sleptMs: number;
  /** The wall reading before the sleep. */
  readonly fromMs: number;
};

/** A fake clock with a fake sleep bound to it. */
export type FakeClock = Clock &
  Sleeper & {
    /** Move both readings forward by `ms`. A negative `ms` is refused. */
    advance(ms: number): void;
    /**
     * Set the wall reading, leaving the monotonic reading where it is: a clock
     * change. Takes milliseconds or an ISO timestamp, as `startMs` does.
     */
    jumpTo(ms: number | string): void;
    /** Move the wall reading by `ms`, leaving the monotonic reading: a clock change. */
    jumpBy(ms: number): void;
    /** Every call of `sleep`, in order. */
    readonly sleeps: readonly SleepCall[];
    /** The sum of the milliseconds the fake sleep moved the clock. */
    sleptMs(): number;
  };

/** How a test starts the fake clock. */
export type FakeClockOptions = {
  /** The first wall reading, in milliseconds since the epoch, or an ISO timestamp. */
  readonly startMs?: number | string;
  /** The first monotonic reading. */
  readonly monotonicMs?: number;
};

function asMs(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new TypeError(`not a timestamp: ${value}`);
  return parsed;
}

/**
 * A fake clock and the fake sleep bound to it. Both the clock and the sleeper
 * are the same object, so a test hands it to the `clock` port and to the
 * `sleep` port and sees one timeline.
 */
export function fakeClock(options: FakeClockOptions = {}): FakeClock {
  let wallMs = asMs(options.startMs ?? DEFAULT_START_MS);
  let monotonic = options.monotonicMs ?? DEFAULT_MONOTONIC_MS;
  const sleeps: SleepCall[] = [];

  return {
    nowMs: () => wallMs,
    nowIso: () => new Date(wallMs).toISOString(),
    monotonicMs: () => monotonic,

    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(`advance takes a finite number of milliseconds at or above 0: ${ms}`);
      }
      wallMs += ms;
      monotonic += ms;
    },

    jumpTo(ms: number | string): void {
      wallMs = asMs(ms);
    },

    jumpBy(ms: number): void {
      if (!Number.isFinite(ms)) throw new RangeError(`jumpBy takes a finite number: ${ms}`);
      wallMs += ms;
    },

    async sleep(ms: number): Promise<void> {
      const sleptMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
      sleeps.push({ askedMs: ms, sleptMs, fromMs: wallMs });
      wallMs += sleptMs;
      monotonic += sleptMs;
      await Promise.resolve();
    },

    sleeps,
    sleptMs: () => sleeps.reduce((total, call) => total + call.sleptMs, 0),
  };
}
