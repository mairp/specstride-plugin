/**
 * T028 of feature 118 — the stop ladder of the `parity` profile: kill by
 * termination, 3 seconds, kill (F118-FR-008; C-058; B-0705; row 51 grace at
 * the polite stop is off under `parity`).
 *
 * When a pass is ended and `carry.polite_stop` is off, the runtime writes
 * the kill note FIRST, then sends a termination to the pass, waits 3
 * seconds, and sends a kill. A signal is sent only when the process id, the
 * start time and the run token of the registry entry all match (annex
 * B §B.10; F100-FR-064) — the `SignalSender` port refuses, and the ladder
 * records the refusal instead of signalling. Every step is recorded in the
 * kill record, and the pass is ended when its process is gone.
 *
 * The polite stop (`carry.polite_stop`, on by default, off under `parity`)
 * is the three-step ladder of F118-FR-009 and lives in the edge that owns
 * the harness port; this module is the ladder the parity fixtures compare.
 */

import type { SignalSender, SignalTarget, SignalRefusal } from "../ports.ts";

/** The grace between the termination and the kill, in milliseconds (F118-FR-008). */
export const PARITY_TERMINATE_GRACE_MS = 3000;

/** One recorded step of the ladder. */
export interface LadderStep {
  /** Which step: the kill note, the termination or the kill. */
  readonly step: "kill-note" | "terminate" | "kill";
  /** When the step was taken (milliseconds since the epoch). */
  readonly atMs: number;
  /** True when the pass was already gone after this step. */
  readonly endedPass: boolean;
  /** Why a signal was not sent, when the identity check refused it. */
  readonly refused?: SignalRefusal | undefined;
}

/** What the ladder recorded for one ended pass. */
export interface LadderResult {
  readonly steps: readonly LadderStep[];
  /** True when the pass process was gone when the ladder finished. */
  readonly ended: boolean;
  /** The signal that ended the pass, when a signal did. */
  readonly endedBy?: "terminate" | "kill" | undefined;
}

/** The collaborators the ladder needs (all handed in; nothing global). */
export interface ParityLadderPorts {
  /** The current time, in milliseconds since the epoch. */
  nowMs(): number;
  /** Sleep for the grace period (the edge injects the real wait; tests a fake). */
  waitMs(ms: number): void;
  /** True when the pass process is still alive. */
  isAlive(): boolean;
  /** The signal sender (the process primitive of feature 122). */
  signals: SignalSender;
  /** Writing the kill note (T029) — runs before the first signal. */
  writeKillNote(): void;
}

/**
 * Run the parity ladder against one ended pass. The kill note is written
 * first; then the termination, the 3-second grace, and the kill. The target
 * is checked against the registry by the signal sender on every signal.
 */
export function runParityLadder(ports: ParityLadderPorts, target: SignalTarget): LadderResult {
  const steps: LadderStep[] = [];

  // 1. The kill note first (F118-FR-008), so the work of the pass and its
  //    session survive even if no signal can be sent.
  ports.writeKillNote();
  steps.push({ step: "kill-note", atMs: ports.nowMs(), endedPass: ports.isAlive() === false });

  // 2. The termination.
  if (!ports.isAlive()) return { steps, ended: true, endedBy: undefined };
  const refusedTerminate = ports.signals.signal(target, "terminate");
  steps.push(recordAfter(ports, "terminate", refusedTerminate));
  if (ports.isAlive() === false) return { steps, ended: true, endedBy: "terminate" };

  // 3. The grace of 3 seconds, then the kill.
  ports.waitMs(PARITY_TERMINATE_GRACE_MS);
  if (!ports.isAlive()) return { steps, ended: true, endedBy: "terminate" };
  const refusedKill = ports.signals.signal(target, "kill");
  steps.push(recordAfter(ports, "kill", refusedKill));
  return { steps, ended: ports.isAlive() === false, endedBy: ports.isAlive() ? undefined : "kill" };
}

function recordAfter(
  ports: ParityLadderPorts,
  step: "terminate" | "kill",
  refused: SignalRefusal | undefined,
): LadderStep {
  return {
    step,
    atMs: ports.nowMs(),
    endedPass: ports.isAlive() === false,
    ...(refused !== undefined ? { refused } : {}),
  };
}
