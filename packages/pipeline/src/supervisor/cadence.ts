/**
 * T045 — the supervision cadence (F123-FR-035).
 *
 * Supervision polls no more often than every 60 seconds by default,
 * multiplies the interval by 1.5 after each reading that shows no change,
 * caps it at 600 seconds, and returns to the base interval on a change or
 * when the detail starts with `RECOVER`. The state of the cadence is
 * persisted after every non-terminal reading and cleared at a terminal one,
 * so that separate `observe` wake-ups agree with a continuous `watch`. When
 * the next interval would pass the deadline, supervision expires.
 */
import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "@specstride/kernel";

/** The base poll interval, in seconds. */
export const BASE_POLL_SECONDS = 60 as const;
/** The multiplier applied after each unchanged reading. */
export const POLL_MULTIPLIER = 1.5 as const;
/** The cap of the poll interval, in seconds. */
export const MAX_POLL_SECONDS = 600 as const;
/** The default of `--poll-seconds`, `--max-poll-seconds`. */
export const DEFAULT_MAX_POLL_SECONDS = 600 as const;

/** The reason supervision expires with. */
export const SUPERVISION_EXPIRED_REASON = "supervision-expired" as const;
/** The exit code of an expired supervision. */
export const SUPERVISION_EXPIRED_EXIT = 5 as const;

/** The persisted cadence state of a supervision. */
export type CadenceState = {
  /** The current interval, in seconds. */
  interval: number;
  /** The number of consecutive unchanged readings. */
  unchanged: number;
  /** The signature of the last reading, when one was taken. */
  signature: string | null;
};

/** The fresh cadence: the base interval, nothing unchanged, no signature. */
export function initialCadence(): CadenceState {
  return { interval: BASE_POLL_SECONDS, unchanged: 0, signature: null };
}

/**
 * The cadence after one reading (F123-FR-035). A change, or a detail that
 * starts with `RECOVER`, returns the cadence to the base interval; an
 * unchanged reading multiplies it by 1.5 and caps it at 600 seconds.
 */
export function nextCadence(state: CadenceState, changed: boolean, detail?: string): CadenceState {
  if (changed || (detail !== undefined && detail.startsWith("RECOVER"))) {
    return { interval: BASE_POLL_SECONDS, unchanged: 0, signature: state.signature };
  }
  const interval = Math.min(state.interval * POLL_MULTIPLIER, MAX_POLL_SECONDS);
  return { interval, unchanged: state.unchanged + 1, signature: state.signature };
}

/** Clamp an interval to the flag bounds: at least the base, at most the cap. */
export function clampInterval(requested: number): number {
  return Math.min(Math.max(requested, BASE_POLL_SECONDS), MAX_POLL_SECONDS);
}

/**
 * Whether the next wait would pass the deadline: expiry is decided before
 * the wait, so that supervision never sleeps past its ceiling.
 */
export function cadenceExpired(input: {
  nowSeconds: number;
  deadlineSeconds: number;
  intervalSeconds: number;
}): boolean {
  return input.nowSeconds + input.intervalSeconds > input.deadlineSeconds;
}

/** The outcome of an expired supervision: the refusal, a digest and exit 5; the run is left running. */
export type SupervisionExpired = {
  readonly expired: true;
  readonly reason: typeof SUPERVISION_EXPIRED_REASON;
  readonly exit: typeof SUPERVISION_EXPIRED_EXIT;
};

/** The expiry decision of one reading, given the persisted state and the clock. */
export function expiryOfReading(input: {
  nowSeconds: number;
  deadlineSeconds: number;
  cadence: CadenceState;
}): SupervisionExpired | { expired: false } {
  if (
    cadenceExpired({
      nowSeconds: input.nowSeconds,
      deadlineSeconds: input.deadlineSeconds,
      intervalSeconds: input.cadence.interval,
    })
  ) {
    return { expired: true, reason: SUPERVISION_EXPIRED_REASON, exit: SUPERVISION_EXPIRED_EXIT };
  }
  return { expired: false };
}

/** The default of `--max-wait-seconds`: the supervision ceiling of the launch contract. */
export function defaultMaxWaitSeconds(ceilingSeconds: number | undefined): number {
  return ceilingSeconds ?? Number.POSITIVE_INFINITY;
}

/**
 * Persist the cadence state after a non-terminal reading (Principle I: the
 * state is on disk, in the same atomic write the kernel gives every record).
 */
export function saveCadence(path: string, state: CadenceState): void {
  atomicWriteJson(path, { schema: "specstride.cadence/1", ...state });
}

/**
 * Read the persisted cadence state. Absent or unreadable content reads as
 * the fresh cadence, so a damaged state never blocks supervision.
 */
export function loadCadence(path: string): CadenceState {
  if (!existsSync(path)) return initialCadence();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      interval?: unknown;
      unchanged?: unknown;
      signature?: unknown;
    };
    if (typeof raw.interval !== "number" || typeof raw.unchanged !== "number")
      return initialCadence();
    return {
      interval: raw.interval,
      unchanged: raw.unchanged,
      signature: typeof raw.signature === "string" ? raw.signature : null,
    };
  } catch {
    return initialCadence();
  }
}

/** Clear the persisted state at a terminal reading. */
export function clearCadence(path: string): void {
  saveCadence(path, initialCadence());
}
