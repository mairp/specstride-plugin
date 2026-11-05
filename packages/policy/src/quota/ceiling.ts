/**
 * T031 — the pause EPISODE and its ceiling (F127-FR-014).
 *
 * A pause may not last for ever. `pause.maxTotalMs` bounds it, with the
 * default of 24 hours, and the bound is on the EPISODE and not on one pause:
 *
 *  - an episode STARTS at the first pause of the role;
 *  - it ENDS when a model call of the role succeeds;
 *  - a resumed call that is LIMITED AGAIN continues the SAME episode, so the
 *    24 hours are not restarted (decision D-3 of `research.md`, CQ-129).
 *
 * The episode's start is kept in the spend ledger under `windows.episodeStart`
 * (`../budget/ledger.ts`), because the pause record is removed at every
 * resume and could not carry it across one.
 *
 * At the ceiling the engine emits `blocked` with the reason
 * `quota-wait-ceiling`, writes the terminal record with the stop reason
 * `paused_quota_ceiling`, the exit code 4 and `retryable: false`, releases the
 * lock and ends (transition T8). The three values come from feature 100's own
 * table of blocked reasons (annex E §E.2), read here and never restated.
 */
import {
  WHAT_A_BLOCKED_RUN_DOES,
  blockedReasonRow,
  engineExitOf,
  stopReasonOf,
} from "@specstride/contracts/state/blocked-reasons";
import type { EventWriter, PolicyEvent } from "./ports.ts";
import { type EmitOptions, blocked } from "./events.ts";
import type { PauseRecord } from "./pause.ts";

/* ------------------------------------------------------------------ *
 * The ceiling.
 * ------------------------------------------------------------------ */

/** `pause.maxTotalMs`, the ceiling of a pause episode; 24 hours by default. */
export const DEFAULT_MAX_TOTAL_MS = 24 * 60 * 60 * 1000;

/** The configuration key of the ceiling (row 39 of annex X §X.7). */
export const MAX_TOTAL_KEY = "pause.maxTotalMs" as const;

/** The blocked reason at the ceiling (annex E §E.2). */
export const CEILING_BLOCKED_REASON = "quota-wait-ceiling" as const;

/** The stop reason of the terminal record (annex E §E.3, member 15). */
export const CEILING_STOP_REASON = "paused_quota_ceiling" as const;

/** The transition of the run-state machine the ceiling performs. */
export const CEILING_TRANSITION = "T8" as const;

/** The state the run rests in at the ceiling. */
export const STATE_AT_THE_CEILING = "blocked-on-human" as const;

function finite(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * The episode.
 * ------------------------------------------------------------------ */

/** The pause episode of F127-FR-014. */
export type PauseEpisode = {
  /** When the episode began: the first pause of the role. */
  readonly startedAt: string;
  /** The same instant in milliseconds. */
  readonly startedAtMs: number;
  /** When the ceiling is reached: `startedAt` + `pause.maxTotalMs`. */
  readonly ceilingAt: string;
  readonly ceilingAtMs: number;
  /** The ceiling in force. */
  readonly maxTotalMs: number;
  /**
   * True where this episode was already running: a resumed call that is
   * limited again CONTINUES it, and the ceiling is not restarted.
   */
  readonly continued: boolean;
};

/**
 * Start the episode, or continue the one the ledger already holds
 * (F127-FR-014).
 *
 * `episodeStart` is the field of the ledger (`windows.episodeStart`). Where it
 * holds an instant, that instant stands and `continued` is true — this is the
 * whole of CQ-129: a resumed call that is limited again must not get another
 * 24 hours.
 */
export function startOrContinueEpisode(input: {
  /** `windows.episodeStart` of the ledger, or null at the first pause. */
  readonly episodeStart: string | null;
  /** The instant of this pause; the caller reads its clock port. */
  readonly nowMs: number;
  readonly maxTotalMs?: number | null | undefined;
}): PauseEpisode {
  const maxTotalMs = finite(input.maxTotalMs, DEFAULT_MAX_TOTAL_MS);
  const held = input.episodeStart === null ? Number.NaN : Date.parse(input.episodeStart);
  const continued = !Number.isNaN(held);
  const startedAtMs = continued ? held : input.nowMs;
  const ceilingAtMs = startedAtMs + maxTotalMs;
  return Object.freeze({
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    ceilingAt: new Date(ceilingAtMs).toISOString(),
    ceilingAtMs,
    maxTotalMs,
    continued,
  });
}

/**
 * The episode ENDS when a model call of the role succeeds (F127-FR-014): the
 * ledger's `windows.episodeStart` goes back to null, so the next pause starts
 * a fresh 24 hours.
 */
export function endEpisodeOnASuccess(): { readonly episodeStart: null } {
  return Object.freeze({ episodeStart: null });
}

/** `ceilingAt` for the pause record, from the episode (annex B §B.17). */
export function ceilingAtOf(episode: PauseEpisode): string {
  return episode.ceilingAt;
}

/** The milliseconds of the episode that are left, at `nowMs`; 0 at the ceiling. */
export function remainingCeilingMs(episode: PauseEpisode, nowMs: number): number {
  return Math.max(0, episode.ceilingAtMs - nowMs);
}

/** True where the ceiling of the episode has been reached (transition T8). */
export function ceilingReached(episode: PauseEpisode, nowMs: number): boolean {
  return nowMs >= episode.ceilingAtMs;
}

/** The same, from the `ceilingAt` of a pause record a run already wrote. */
export function ceilingReachedByRecord(record: PauseRecord, nowMs: number): boolean {
  const at = Date.parse(record.ceilingAt);
  return !Number.isNaN(at) && nowMs >= at;
}

/* ------------------------------------------------------------------ *
 * What happens at the ceiling.
 * ------------------------------------------------------------------ */

/** The terminal record values of the ceiling (annex E §E.2, F127-FR-014). */
export type CeilingTerminal = {
  readonly stopReason: typeof CEILING_STOP_REASON;
  readonly exitCode: number;
  /** False always: a stop that rests blocked on a human is not retryable. */
  readonly retryable: boolean;
  /** The blocked reason the terminal record carries with it. */
  readonly blockedReason: typeof CEILING_BLOCKED_REASON;
};

/** The three values of the row of §E.2, read from feature 100's own table. */
export function ceilingTerminal(): CeilingTerminal {
  const row = blockedReasonRow(CEILING_BLOCKED_REASON);
  if (row === undefined) {
    throw new Error(
      `${CEILING_BLOCKED_REASON} is not a blocked reason of annex E §E.2 (F127-FR-014)`,
    );
  }
  return Object.freeze({
    stopReason: CEILING_STOP_REASON,
    exitCode: row.engineExit,
    retryable: row.retryable,
    blockedReason: CEILING_BLOCKED_REASON,
  });
}

/** What `atTheCeiling` answers. */
export type CeilingOutcome = {
  readonly state: typeof STATE_AT_THE_CEILING;
  readonly transition: typeof CEILING_TRANSITION;
  /** The event `blocked` with the reason `quota-wait-ceiling`. */
  readonly event: PolicyEvent;
  /** What the consumer must do, in one line. */
  readonly needs: string;
  readonly terminal: CeilingTerminal;
  /** True: the lock is released and the run ends (annex E §E.2). */
  readonly releasesTheLock: boolean;
  readonly ends: boolean;
  /** False: neither relaunch classifier table relaunches it. */
  readonly relaunched: boolean;
  /** The episode that reached its ceiling. */
  readonly episode: PauseEpisode;
  readonly note: string;
};

/** The one line the consumer is told at the ceiling (F127-FR-014). */
export const CEILING_NEEDS: string =
  "the quota pause reached its ceiling: raise `pause.maxTotalMs`, or wait for the provider's " +
  "window and run `resume`";

/**
 * F127-FR-014 — the ceiling (transition T8).
 *
 * Emits `blocked` with the reason `quota-wait-ceiling`, gives the terminal
 * record values of §E.2 (`paused_quota_ceiling`, exit 4, `retryable: false`),
 * releases the lock and ends. Neither relaunch classifier table relaunches it:
 * the run rests in `blocked-on-human` until a person acts.
 */
export function atTheCeiling(
  eventWriter: EventWriter,
  input: {
    readonly episode: PauseEpisode;
    readonly role: string;
    readonly nowMs: number;
  },
  options: EmitOptions = {},
): CeilingOutcome {
  const terminal = ceilingTerminal();
  const event = blocked(
    eventWriter,
    { reason: CEILING_BLOCKED_REASON, needs: CEILING_NEEDS, role: input.role },
    options,
  );
  return Object.freeze({
    state: STATE_AT_THE_CEILING,
    transition: CEILING_TRANSITION,
    event,
    needs: CEILING_NEEDS,
    terminal,
    releasesTheLock: WHAT_A_BLOCKED_RUN_DOES.releasesTheLock,
    ends: WHAT_A_BLOCKED_RUN_DOES.ends,
    relaunched: WHAT_A_BLOCKED_RUN_DOES.relaunchedByEitherClassifierTable,
    episode: input.episode,
    note:
      `the pause episode of the role ${input.role} began at ${input.episode.startedAt} and ` +
      `reached its ceiling of ${input.episode.maxTotalMs} ms at ${input.episode.ceilingAt}; the ` +
      `run rests in ${STATE_AT_THE_CEILING} with the stop reason ${terminal.stopReason} and ` +
      `the exit code ${terminal.exitCode} (F127-FR-014)`,
  });
}

/** The stop reason of the ceiling as feature 100's table gives it, for a test. */
export const STOP_REASON_FROM_THE_TABLE = stopReasonOf(CEILING_BLOCKED_REASON);

/** The exit code of the ceiling as feature 100's table gives it, for a test. */
export const EXIT_CODE_FROM_THE_TABLE = engineExitOf(CEILING_BLOCKED_REASON);
