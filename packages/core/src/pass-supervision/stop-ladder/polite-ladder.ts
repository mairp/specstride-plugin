/**
 * T069 of feature 118 — the polite stop ladder with the record of the steps
 * (F118-FR-009; DV-093; CT-118-1).
 *
 * With `carry.polite_stop` on (the default; off under the `parity` profile)
 * a proposer pass is ended in three steps through the operation `stop` of the
 * harness port: `polite` (an interrupt in the form the harness adapter
 * declares), a grace period (default 10 seconds, row 50 of annex X §X.7,
 * `carry.politeStopGraceSec`), then `terminate`, then the grace of 3 seconds,
 * then `kill`. The next step is taken ONLY when the pass is still alive after
 * the grace period. Every step, the grace period applied and the step that
 * ended the pass are recorded, so the kill record shows the interrupt, the
 * grace and the signal that ended the pass, in order (F118-SC-002). The
 * polite stop applies to proposer passes only; any other role falls back to
 * the parity ladder of `parity-ladder.ts`.
 *
 * The effect on the session of the harness (an interrupt ends the turn
 * cleanly and records the session) is a documented fact of the harness and is
 * treated as unverified (F118-FR-009; the paid probe of T002).
 */

import type { EventWriter, SignalSender, SignalRefusal, SignalTarget } from "../ports.ts";
import { passKilledEvent } from "../events.ts";

/** The polite stop switch (F100-FR-134): on by default. */
export const POLITE_STOP_SWITCH = "carry.polite_stop" as const;
export const POLITE_STOP_DEFAULT = true as const;

/** The polite stop is off under the `parity` profile (owner ruling DV-093). */
export const POLITE_STOP_OFF_UNDER_PARITY = true as const;

/** The polite stop applies to proposer passes only (F118-FR-009). */
export const POLITE_STOP_APPLIES_TO = Object.freeze(["proposer"] as const);

/** True when the polite stop may end a pass of this role. */
export function appliesToPassKind(role: string): boolean {
  return (POLITE_STOP_APPLIES_TO as readonly string[]).includes(role);
}

/** The grace between the interrupt and the termination, in seconds (row 50 of annex X §X.7). */
export const POLITE_STOP_GRACE_SEC_DEFAULT = 10;

/** The grace between the termination and the kill, in milliseconds (F118-FR-008, F118-FR-009). */
export const POLITE_TERMINATE_GRACE_MS = 3000;

/** One recorded step of the polite ladder. */
export interface PoliteLadderStep {
  /** Which step: the interrupt, a grace period, the termination or the kill. */
  readonly step: "polite" | "polite-grace" | "terminate" | "terminate-grace" | "kill";
  /** When the step was taken, in milliseconds since the epoch. */
  readonly atMs: number;
  /** The grace applied by this step, in milliseconds (a grace step only). */
  readonly graceMs?: number | undefined;
  /** True when the pass was already gone after this step. */
  readonly endedPass: boolean;
  /** Why a signal was not sent, when the identity check refused it. */
  readonly refused?: SignalRefusal | undefined;
}

/** What the polite ladder recorded for one ended pass (the record of the steps). */
export interface PoliteLadderResult {
  /** True: this run went through the polite stop. */
  readonly politeStop: true;
  readonly steps: readonly PoliteLadderStep[];
  /** True when the pass process was gone when the ladder finished. */
  readonly ended: boolean;
  /** The signal that ended the pass, when a signal did. */
  readonly endedBy?: "polite" | "terminate" | "kill" | undefined;
  /** The grace between the interrupt and the termination, in milliseconds. */
  readonly politeGraceMs: number;
  /** The grace between the termination and the kill, in milliseconds. */
  readonly terminateGraceMs: number;
}

/** The ports the polite ladder needs; every one handed in, nothing global. */
export interface PoliteLadderPorts {
  /** The current time, in milliseconds since the epoch. */
  nowMs(): number;
  /** The grace wait (the edge injects the real wait; tests inject a fake). */
  waitMs(ms: number): void;
  /** True when the pass process is still alive. */
  isAlive(): boolean;
  /** The signal sender — the operation `stop` of the harness port, through the kernel. */
  readonly signals: SignalSender;
  /** Writing the kill note (T029) — runs before the first signal. */
  writeKillNote(): void;
  /** The events of the run; the kill event carries the record of the steps. */
  readonly events?: EventWriter | undefined;
}

/** What the kill event of a polite stop carries about the steps (F118-FR-009). */
export interface PoliteLadderKillInput {
  readonly iter: number;
  readonly reason: string;
  readonly killClass: string;
  readonly elapsedMs: number;
  readonly steps: readonly PoliteLadderStep[];
  readonly endedBy: "polite" | "terminate" | "kill" | undefined;
}

/** The one-line summary of the steps for the `detail` of the kill event. */
export function politeStepsSummary(input: PoliteLadderKillInput): string {
  const chain = input.steps
    .filter((s) => s.step !== "polite-grace" && s.step !== "terminate-grace")
    .map((s) => s.step)
    .join(", ");
  const graces = input.steps
    .filter((s) => s.step === "polite-grace" || s.step === "terminate-grace")
    .map((s) => `${s.step} ${s.graceMs}ms`)
    .join(", ");
  const ended = input.endedBy === undefined ? "not ended" : `ended by ${input.endedBy}`;
  return `polite stop: ${chain}; graces: ${graces}; ${ended}`;
}

/**
 * Write the kill event of a polite stop: the same `pass_killed` event as any
 * watchdog kill, whose `detail` carries the record of the steps (the
 * interrupt, the graces and the signal that ended the pass, in order).
 */
export function writePoliteKillEvent(events: EventWriter, input: PoliteLadderKillInput): boolean {
  return events.write(
    passKilledEvent({
      iter: input.iter,
      reason: input.reason,
      class: input.killClass,
      elapsed: input.elapsedMs,
      detail: politeStepsSummary(input),
    }),
  );
}

/**
 * Run the polite stop ladder against one ended proposer pass
 * (F118-FR-009). The kill note is written first, so the work of the pass
 * and its session survive even if no signal can be sent; then the
 * interrupt, the grace, the termination, the grace of 3 seconds, and the
 * kill — each step taken only when the pass is still alive after the grace
 * before it. The target is checked against the registry by the signal
 * sender on every signal; a refusal is recorded instead of a signal.
 */
export function runPoliteLadder(
  ports: PoliteLadderPorts,
  target: SignalTarget,
  options: { readonly politeGraceMs?: number | undefined } = {},
): PoliteLadderResult {
  const steps: PoliteLadderStep[] = [];
  const politeGraceMs = options.politeGraceMs ?? POLITE_STOP_GRACE_SEC_DEFAULT * 1000;

  // 1. The kill note first, so the work of the pass survives the stop.
  ports.writeKillNote();

  // 2. The interrupt (the `polite` step, in the form the adapter declares).
  if (!ports.isAlive()) return result(ports, steps, politeGraceMs, undefined);
  const refusedPolite = ports.signals.signal(target, "polite");
  steps.push(afterSignal(ports, "polite", refusedPolite));

  // 3. The grace after the interrupt (row 50, default 10 s) is applied and
  //    recorded even when the interrupt already ended the pass, so the
  //    record shows the interrupt AND the grace period applied
  //    (F118-SC-002).
  ports.waitMs(politeGraceMs);
  steps.push(graceStep(ports, "polite-grace", politeGraceMs));
  if (!ports.isAlive()) return result(ports, steps, politeGraceMs, "polite");

  // 4. The termination — taken only when the pass is still alive after the
  //    grace period (F118-FR-009).
  const refusedTerminate = ports.signals.signal(target, "terminate");
  steps.push(afterSignal(ports, "terminate", refusedTerminate));
  if (!ports.isAlive()) return result(ports, steps, politeGraceMs, "terminate");

  // 5. The grace of 3 seconds, then the kill.
  ports.waitMs(POLITE_TERMINATE_GRACE_MS);
  steps.push(graceStep(ports, "terminate-grace", POLITE_TERMINATE_GRACE_MS));
  if (!ports.isAlive()) return result(ports, steps, politeGraceMs, "terminate");

  const refusedKill = ports.signals.signal(target, "kill");
  steps.push(afterSignal(ports, "kill", refusedKill));
  return result(ports, steps, politeGraceMs, ports.isAlive() ? undefined : "kill");
}

function graceStep(
  ports: PoliteLadderPorts,
  step: "polite-grace" | "terminate-grace",
  graceMs: number,
): PoliteLadderStep {
  return { step, atMs: ports.nowMs(), graceMs, endedPass: ports.isAlive() === false };
}

function afterSignal(
  ports: PoliteLadderPorts,
  step: "polite" | "terminate" | "kill",
  refused: SignalRefusal | undefined,
): PoliteLadderStep {
  return {
    step,
    atMs: ports.nowMs(),
    endedPass: ports.isAlive() === false,
    ...(refused !== undefined ? { refused } : {}),
  };
}

function result(
  ports: PoliteLadderPorts,
  steps: readonly PoliteLadderStep[],
  politeGraceMs: number,
  endedBy: "polite" | "terminate" | "kill" | undefined,
): PoliteLadderResult {
  return {
    politeStop: true,
    steps,
    ended: ports.isAlive() === false,
    ...(endedBy !== undefined ? { endedBy } : {}),
    politeGraceMs,
    terminateGraceMs: POLITE_TERMINATE_GRACE_MS,
  };
}
