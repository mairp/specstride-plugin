/**
 * T042 — the three times of the handshake and the lease, and the ONE formula
 * for `validUntil` (F122-FR-005, F122-FR-008, F122-FR-014; CQ-138).
 *
 * This module exists so that the lease (`lease.ts`), the shipped lock provider
 * (`../lock/directory-lock.ts`) and the handshake of the CLI all read the same
 * three defaults and compute `validUntil` with the same function. It imports
 * nothing of this package, which is what lets the provider depend on it
 * without a cycle; the three defaults come from the configuration catalogue of
 * feature 110 and are not written out here.
 *
 * Why a module and not three constants in each place: §B.8 says `validUntil`
 * is *heartbeat plus grace*, and F122-FR-008 repeats it — *`validUntil`, which
 * is the time of the last heartbeat plus the grace*. Two modules that each
 * wrote that sum would eventually disagree, and a reader would then be shown
 * a lease that is at once valid and stale. There is one `validUntilOf`.
 */

import { catalogueEntry } from "@specstride/config";

/** The requirements these times carry. */
export const LEASE_TIMING_REQUIREMENTS = ["F122-FR-005", "F122-FR-008", "F122-FR-014"] as const;

/** The configuration keys of the three times (row 114; feature 110 owns the spelling). */
export const HANDSHAKE_LIMIT_KEY = "runtime.handshake.timeoutSec" as const;
export const HEARTBEAT_INTERVAL_KEY = "runtime.lease.heartbeatSec" as const;
export const GRACE_KEY = "runtime.lease.graceSec" as const;

/**
 * The defaults are NOT written out here. CQ-138 of `spec.md` settled them — *30
 * seconds, 10 seconds and 30 seconds, as starting values that configuration can
 * change* — and the catalogue of feature 110 is where a settled default lives
 * (`packages/config`, the `default` cell of each key). This module READS them,
 * so a change of the catalogue moves the product and a literal here could never
 * drift from it. `defaultSecondsOf` throws rather than fall back: a key the
 * catalogue does not hold is a bug in this module's spelling of it, and a quiet
 * fallback would hide it.
 */
export function defaultSecondsOf(key: string): number {
  const entry = catalogueEntry(key);
  if (entry === undefined) {
    throw new Error(
      `the configuration catalogue holds no key \`${key}\`; the three times of the lease and ` +
        `the handshake are ordinary configuration (row 114 of annex X §X.7)`,
    );
  }
  const given = entry.default;
  if (given.kind !== "value" || typeof given.value !== "number") {
    throw new Error(
      `the default of \`${key}\` in the catalogue is not a number of seconds: ` +
        `\`${String(given.text)}\``,
    );
  }
  return given.value;
}

export const HANDSHAKE_LIMIT_SECONDS: number = defaultSecondsOf(HANDSHAKE_LIMIT_KEY);
export const HEARTBEAT_EVERY_SECONDS: number = defaultSecondsOf(HEARTBEAT_INTERVAL_KEY);
export const GRACE_SECONDS: number = defaultSecondsOf(GRACE_KEY);

/** F122-FR-005, F122-FR-014 — all three are ordinary configuration. */
export const THE_TIMES_ARE_ORDINARY_CONFIGURATION = true as const;

/** The three times of one run, with the defaults filled in. */
export type LeaseTimes = {
  readonly handshakeLimitSeconds: number;
  readonly heartbeatEverySeconds: number;
  readonly graceSeconds: number;
};

/** The three times a caller gave, each falling back to its default. */
export function leaseTimes(given: Partial<LeaseTimes> | undefined = undefined): LeaseTimes {
  return Object.freeze({
    handshakeLimitSeconds: positive(given?.handshakeLimitSeconds, HANDSHAKE_LIMIT_SECONDS),
    heartbeatEverySeconds: positive(given?.heartbeatEverySeconds, HEARTBEAT_EVERY_SECONDS),
    graceSeconds: positive(given?.graceSeconds, GRACE_SECONDS),
  });
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * §B.8, F122-FR-008 — `validUntil` is the time of the last heartbeat plus the
 * grace, and nothing else. The interval of the heartbeat is NOT part of the
 * sum: it says how often the owner writes, and the grace is how long a reader
 * trusts the newest write.
 */
export function validUntilOf(heartbeatAt: string | Date, graceSeconds: number): string {
  const at = heartbeatAt instanceof Date ? heartbeatAt.getTime() : Date.parse(heartbeatAt);
  if (Number.isNaN(at)) {
    throw new Error(
      `\`validUntil\` cannot be computed: \`${String(heartbeatAt)}\` is not a time (annex B, §B.8)`,
    );
  }
  return new Date(at + graceSeconds * 1_000).toISOString();
}

/**
 * F122-FR-014 — *an old heartbeat with a live owner MUST NOT make the probe
 * report a dead owner.* This function answers the OTHER question, the one a
 * reader of a precomputed line asks: has the newest heartbeat passed its
 * grace? It is `stale`, never `dead`, and the constant below says so in the
 * type so that no caller can read one for the other.
 */
export const AN_OLD_HEARTBEAT_MEANS = "stale" as const;
export const AN_OLD_HEARTBEAT_MEANS_DEAD = false as const;

/** True where the newest heartbeat is older than the grace allows. */
export function heartbeatIsOld(heartbeatAt: string, graceSeconds: number, now: Date): boolean {
  const until = Date.parse(validUntilOf(heartbeatAt, graceSeconds));
  return now.getTime() > until;
}

/**
 * F122-FR-032 — *no wait of the runtime root MUST depend on a timer that ran
 * through a sleep of the machine.* A gap is a stretch of wall-clock time
 * longer than the interval between two heartbeats: the timer did not fire
 * when it should have, because the machine was not running.
 *
 * The margin is half an interval, so that ordinary jitter of a timer is not a
 * gap and a sleep of a whole interval always is.
 */
export function gapSinceTheHeartbeat(
  heartbeatAt: string,
  heartbeatEverySeconds: number,
  now: Date,
): boolean {
  const at = Date.parse(heartbeatAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > heartbeatEverySeconds * 1_500;
}

/**
 * F122-FR-032 — *MUST compute every remaining wait from the times recorded on
 * disk.* The remaining wait of something that started at a RECORDED time and
 * lasts `totalSeconds`: never read from a timer, and never negative.
 */
export function remainingWaitMsFrom(
  recordedStartAt: string,
  totalSeconds: number,
  now: Date,
): number {
  const started = Date.parse(recordedStartAt);
  if (Number.isNaN(started)) return 0;
  const left = started + totalSeconds * 1_000 - now.getTime();
  return left > 0 ? left : 0;
}

/** Where a wait is recomputed from: the disk, never a timer (F122-FR-032). */
export const A_WAIT_IS_COMPUTED_FROM = "the times recorded on disk" as const;
export const A_WAIT_IS_COMPUTED_FROM_A_TIMER = false as const;
