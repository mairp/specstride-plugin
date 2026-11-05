/**
 * T016 — the exit codes, the final state and the signal handling
 * (F123-FR-013, F123-FR-014).
 *
 * The pipeline entry exits with exactly the codes of §R.1, each class of
 * failure with one distinct code: usage 2, invalid contract 20, preflight 21,
 * failed stage 22, stale sources 23, held lock 24. A stage whose child exited
 * 6 ends the pipeline with 22 and the state `stopped`, and is never
 * relaunched. The exit reason of a complete run is `all-stages-complete`.
 * The runtime root writes the transitions of the run-state machine that
 * annex E §E.2 gives it, and no other.
 *
 * Signals (F123-FR-014): the entry records the signal it received, ends the
 * current stage with the reason `interrupted`, writes the final state
 * `stopped` with the exit reason `signal:<name>`, and exits with the code
 * 130 for SIGINT and 143 for SIGTERM.
 */
import type { PipelineStateRecord } from "./state-record.ts";
import { writeState } from "./state-record.ts";

/** The exit codes of §R.1, each class of failure with one distinct code. */
export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  invalidContract: 20,
  preflight: 21,
  stageFailed: 22,
  staleSources: 23,
  lockHeld: 24,
  sigint: 130,
  sigterm: 143,
} as const;
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** The exit code for an end state (F123-FR-013). */
export function exitCodeForState(state: PipelineStateRecord["state"]): number {
  switch (state) {
    case "completed":
      return EXIT_CODES.ok;
    case "stopped":
      return EXIT_CODES.stageFailed;
    case "failed":
      return EXIT_CODES.stageFailed;
    case "preflight":
    case "ready":
    case "running":
      // A non-terminal state never becomes an exit code of the entry.
      return EXIT_CODES.stageFailed;
    default:
      return EXIT_CODES.stageFailed;
  }
}

/** Whether a child exit 6 stops the run and is never relaunched (F123-FR-013). */
export function childExitStopsPipeline(code: number | null): boolean {
  return code === 6;
}

/** The signals the entry handles, with the code each ends the run with. */
export const SIGNAL_EXIT_CODES: Readonly<Record<string, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/** The exit reason of a run ended by a signal (F123-FR-014). */
export function signalExitReason(signal: string): string {
  return `signal:${signal}`;
}

/**
 * The installation of the signal handling (F123-FR-014): the first signal
 * ends the current stage with the reason `interrupted`, writes the final
 * state `stopped`, and exits with the code of the signal. The handler is
 * injected so the test can call it; the real entry installs it on
 * `process`.
 */
export function installSignalHandlers(input: {
  onSignal: (signal: string) => void;
  signals?: readonly string[];
}): void {
  for (const signal of input.signals ?? Object.keys(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => input.onSignal(signal));
  }
}

/** The final write of a run ended by a signal. */
export function writeInterruptedState(
  statePath: string,
  state: PipelineStateRecord,
  signal: string,
  now: number,
): PipelineStateRecord {
  const final: PipelineStateRecord = {
    ...state,
    state: "stopped",
    exit_reason: signalExitReason(signal),
    updated_at: now,
  };
  writeState(statePath, final);
  return final;
}
