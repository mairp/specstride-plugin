/**
 * T048 — the events and the log lines around the verification gate
 * (F105-FR-007).
 *
 * Around every run of the verification gate the engine emits events that the
 * COMPATIBILITY PROJECTION renders as four as-is events, each with its own
 * field list:
 *
 *  | rendered as                    | fields                           |
 *  |--------------------------------|----------------------------------|
 *  | `verification_start`           | `phase`, `attempt`, `plan`       |
 *  | `verification_passed`          | `phase`, `attempt`, `evidence`   |
 *  | `verification_failed`          | `phase`, `attempt`, `rc`, `evidence` |
 *  | `verification_release_passed`  | `evidence`                       |
 *
 * `rc` HOLDS THE CODE OF THE VERIFICATION GATE ITSELF (F105-FR-005): 10 for a
 * failed command, 3 for a gate that could not run — never the 10 of the phase
 * attempt's rejection, which is a different number that happens to be equal in
 * one of the two cases.
 *
 * The engine log holds the line
 * `----- verification: phase <N> attempt <M> (fixed argv) -----` BEFORE the
 * verification gate of a phase attempt (B-0222).
 *
 * THE COMPONENT THAT RUNS THE COMMANDS EMITS NONE OF THESE FOUR EVENTS
 * ITSELF (B-1135). That component is the check runner of feature 148, and the
 * fact is `EMITTED_BY` and `NOT_EMITTED_BY`: the engine emits them, around the
 * gate, and the runner emits nothing. `eventsOfARun` builds the whole sequence
 * of one run of the gate, so a caller cannot emit a subset in the wrong order
 * and cannot emit one from inside the runner.
 */

/** The four as-is events of F105-FR-007, in the order a run emits them. */
export const AS_IS_EVENTS = [
  "verification_start",
  "verification_passed",
  "verification_failed",
  "verification_release_passed",
] as const;
export type AsIsEvent = (typeof AS_IS_EVENTS)[number];

/** The fields of each as-is event, in the order F105-FR-007 names them. */
export const EVENT_FIELDS: Readonly<Record<AsIsEvent, readonly string[]>> = Object.freeze({
  verification_start: Object.freeze(["phase", "attempt", "plan"]),
  verification_passed: Object.freeze(["phase", "attempt", "evidence"]),
  verification_failed: Object.freeze(["phase", "attempt", "rc", "evidence"]),
  verification_release_passed: Object.freeze(["evidence"]),
});

/** Who emits these four events: the engine, around the gate. */
export const EMITTED_BY = "the engine" as const;

/** Who emits none of them: the component that runs the commands (B-1135). */
export const NOT_EMITTED_BY = "the component that runs the commands" as const;

/** The check runner emits none of the four events (B-1135). */
export const THE_RUNNER_EMITS_NONE: boolean = true;

/** The number of events the component that runs the commands emits: zero. */
export const EVENTS_FROM_THE_RUNNER = 0 as const;

/** The log line before the verification gate of a phase attempt (B-0222). */
export function gateLogLine(phase: number | "release", attempt: number): string {
  return `----- verification: phase ${phase} attempt ${attempt} (fixed argv) -----`;
}

/** The log line is written BEFORE the gate runs (F105-FR-007). */
export const LOG_LINE_IS_WRITTEN = "before the verification gate of a phase attempt" as const;

/** One event as the compatibility projection renders it. */
export type RenderedEvent = {
  /** The as-is name the projection renders. */
  readonly type: AsIsEvent;
  /** The fields, in the order F105-FR-007 names them. */
  readonly fields: Readonly<Record<string, string>>;
};

/** The event `verification_start`. */
export function verificationStart(input: {
  readonly phase: number | "release";
  readonly attempt: number;
  readonly plan: string;
}): RenderedEvent {
  return event("verification_start", {
    phase: String(input.phase),
    attempt: String(input.attempt),
    plan: input.plan,
  });
}

/** The event `verification_passed`. */
export function verificationPassed(input: {
  readonly phase: number | "release";
  readonly attempt: number;
  readonly evidence: string;
}): RenderedEvent {
  return event("verification_passed", {
    phase: String(input.phase),
    attempt: String(input.attempt),
    evidence: input.evidence,
  });
}

/**
 * The event `verification_failed`. `rc` is THE CODE OF THE VERIFICATION GATE
 * — 10 or 3 — and not the rejection's result code.
 */
export function verificationFailed(input: {
  readonly phase: number | "release";
  readonly attempt: number;
  /** The code of the verification gate itself (F105-FR-005, F105-FR-007). */
  readonly gateResultCode: number;
  readonly evidence: string;
}): RenderedEvent {
  return event("verification_failed", {
    phase: String(input.phase),
    attempt: String(input.attempt),
    rc: String(input.gateResultCode),
    evidence: input.evidence,
  });
}

/** The event `verification_release_passed`, after a passed release verification. */
export function verificationReleasePassed(input: { readonly evidence: string }): RenderedEvent {
  return event("verification_release_passed", { evidence: input.evidence });
}

function event(type: AsIsEvent, fields: Readonly<Record<string, string>>): RenderedEvent {
  const ordered: Record<string, string> = {};
  for (const name of EVENT_FIELDS[type]) {
    const value = fields[name];
    if (value !== undefined) ordered[name] = value;
  }
  return Object.freeze({ type, fields: Object.freeze(ordered) });
}

/** What one run of the gate emitted, and what it wrote to the engine log. */
export type RunAroundTheGate = {
  /** The line the engine log holds, before the gate. */
  readonly logLine: string;
  /** The events, in the order they were emitted. */
  readonly events: readonly RenderedEvent[];
};

/**
 * The whole sequence around ONE run of the verification gate of a phase
 * attempt: the log line, then `verification_start`, then exactly one of
 * `verification_passed` and `verification_failed`.
 */
export function eventsOfARun(input: {
  readonly phase: number | "release";
  readonly attempt: number;
  readonly plan: string;
  readonly evidence: string;
  /** The code of the verification gate: 0, 10 or 3. */
  readonly gateResultCode: number;
}): RunAroundTheGate {
  const events: RenderedEvent[] = [
    verificationStart({ phase: input.phase, attempt: input.attempt, plan: input.plan }),
  ];
  if (input.gateResultCode === 0) {
    events.push(
      verificationPassed({ phase: input.phase, attempt: input.attempt, evidence: input.evidence }),
    );
  } else {
    events.push(
      verificationFailed({
        phase: input.phase,
        attempt: input.attempt,
        gateResultCode: input.gateResultCode,
        evidence: input.evidence,
      }),
    );
  }
  return Object.freeze({
    logLine: gateLogLine(input.phase, input.attempt),
    events: Object.freeze(events),
  });
}

/**
 * A run of the gate emits `verification_start` and exactly one of the two
 * outcome events, and never both.
 */
export function oneOutcomeEvent(run: RunAroundTheGate): boolean {
  const outcomes = run.events.filter(
    (item) => item.type === "verification_passed" || item.type === "verification_failed",
  );
  return (
    run.events.length >= 1 && run.events[0]?.type === "verification_start" && outcomes.length === 1
  );
}
