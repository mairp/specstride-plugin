/**
 * T033 — the three stops of the port and the polite-stop signal
 * (F125-FR-021; owner ruling on process signals, 2026-10-02).
 *
 * Every call of the harness adapter runs in a process group of its own
 * (`detached: true`), so a stop reaches the CLI and everything it spawned,
 * never the run. The three stops, in order of escalation:
 *
 *  - `polite`    — SIGINT: the harness ends its turn cleanly so the session
 *                  can be continued afterwards (F125-FR-014, unfinished turn);
 *  - `terminate` — SIGTERM: the process ends with exit code 143; that code
 *                  is the stop of the run, never a provider failure by
 *                  itself (F125-FR-031: no classifier row carries it);
 *  - `kill`      — SIGKILL: the last resort, when neither stop landed.
 *
 * Every function that signals a group refuses a pgid that is not an integer
 * above one (owner ruling 2026-10-02): pid 1 and a negative garbage value
 * are never signalled.
 */

/** The polite-stop signal of the harness adapter: the interrupt. */
export const POLITE_STOP_SIGNAL: NodeJS.Signals = "SIGINT";

/** The signal of the terminate stop. */
export const TERMINATE_SIGNAL: NodeJS.Signals = "SIGTERM";

/** The signal of the kill stop. */
export const KILL_SIGNAL: NodeJS.Signals = "SIGKILL";

/** The grace period the polite stop waits before the terminate stop, in ms. */
export const POLITE_GRACE_MS = 5_000;

/** The options that put every call into a process group of its own. */
export const PROCESS_GROUP_SPAWN_OPTIONS = Object.freeze({
  detached: true,
} as const);

/**
 * Validates a process-group id. Owner ruling 2026-10-02: every function
 * that signals a group refuses an id that is not an integer above one.
 */
export function pgidIsValid(pgid: number): boolean {
  return Number.isInteger(pgid) && pgid > 1;
}

/** The error a refused group signal carries. */
export class ProcessGroupRefusedError extends Error {
  constructor(pgid: number) {
    super(
      `refused to signal the process group ${pgid}: only an integer above one is a group id ` +
        "(owner ruling 2026-10-02)",
    );
    this.name = "ProcessGroupRefusedError";
  }
}

/** Sends one signal to the process group `-pgid`; injectable in tests. */
export type GroupSignaller = (pgid: number, signal: NodeJS.Signals) => void;

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  if (!pgidIsValid(pgid)) throw new ProcessGroupRefusedError(pgid);
  process.kill(-pgid, signal);
}

/** The stop kinds of the port (F125-FR-021): the closed set of the three. */
export const STOP_KINDS = ["polite", "terminate", "kill"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** The exit code a process ended with when the terminate stop reached it. */
export const TERMINATED_EXIT_CODE = 143;

/**
 * True when the exit of a call is a PROVIDER failure. Exit code 143 — the
 * terminate stop of the port — is the run's own stop and never a provider
 * failure by itself (F125-FR-021, F125-FR-031): the quota classifier never
 * sees it. A signal death other than the two stops of the port is unknown,
 * also not a provider fact.
 */
export function exitIsProviderFailure(exit: {
  readonly exitCode: number | null;
  readonly signalName?: string | null;
}): boolean {
  if (exit.exitCode === TERMINATED_EXIT_CODE) return false;
  if (exit.signalName === POLITE_STOP_SIGNAL || exit.signalName === TERMINATE_SIGNAL) return false;
  if (exit.signalName === KILL_SIGNAL) return false;
  return true;
}

/**
 * One of the three stops of the port, aimed at the call's process group.
 * Returns the signal that was sent, so the call record holds what happened.
 */
export function stopCall(
  pgid: number,
  kind: StopKind,
  options?: { readonly signal?: GroupSignaller },
): NodeJS.Signals {
  // The refusal comes before any sender runs, injected or not: every
  // function that signals a group refuses an unusable id.
  if (!pgidIsValid(pgid)) throw new ProcessGroupRefusedError(pgid);
  const send = options?.signal ?? signalGroup;
  const signal: NodeJS.Signals =
    kind === "polite" ? POLITE_STOP_SIGNAL : kind === "terminate" ? TERMINATE_SIGNAL : KILL_SIGNAL;
  send(pgid, signal);
  return signal;
}
