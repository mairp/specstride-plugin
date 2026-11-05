/**
 * T037 of feature 101 — the loop over phases, the path "every phase approved
 * before" and the end of the run (F101-FR-001, F101-FR-003, F101-FR-018).
 *
 * The engine is the SINGLE DRIVER of the loop over phases and phase attempts
 * (F101-FR-001). Two ends exit 0, and both go through release verification
 * first:
 *
 * | Path | Requirement | The end event |
 * |---|---|---|
 * | every phase was approved BEFORE the run | F101-FR-003 | `all_approved`, WITHOUT the count of phases (B-0141) |
 * | every phase from the start phase on was approved IN this run | F101-FR-018 | `all_approved`, WITH the count of phases |
 *
 * On the first path neither the proposer nor the critic is called at all, and
 * the as-is line is "All phases already approved. Nothing to do." (B-0204). On
 * the second the as-is final line carries the count and the time (B-0232).
 *
 * When release verification FAILS, both paths exit 2 with the stop reason
 * `release_verification`. `all_approved` is the ONLY outcome the as-is end
 * event ever carries (F101-FR-018).
 */
import { allPhasesAlreadyApproved, done } from "../gate/lines.ts";
import type { PhaseOutcome } from "./phase.ts";
import type { StartPosition } from "./start-position.ts";

/** F101-FR-001 — the engine is the single driver of the loop. */
export const THE_ENGINE_IS_THE_SINGLE_DRIVER = true as const;

/** F101-FR-001 — the command `run` starts it in the FOREGROUND. */
export const THE_COMMAND_RUN_STARTS_IT_IN_THE_FOREGROUND = true as const;

/** F101-FR-018 — the one outcome of the as-is end event of the run. */
export const THE_ONLY_OUTCOME_OF_THE_END_EVENT = "all_approved" as const;

/** F101-FR-003 — on the already-approved path, neither role is called. */
export const ROLES_CALLED_ON_THE_ALREADY_APPROVED_PATH: readonly string[] = Object.freeze([]);

/** F101-FR-003 and F101-FR-018 — the halt of a failed release verification. */
export const RELEASE_VERIFICATION_EXIT_CODE = 2 as const;
export const RELEASE_VERIFICATION_STOP_REASON = "release_verification" as const;

/** The outcome of release verification, as the engine reads it. */
export type ReleaseVerificationOutcome = {
  /** False only where it RAN and FAILED. */
  readonly passed: boolean;
  /** True where the configuration did not require it (F101-FR-018). */
  readonly notRequired?: boolean;
  /** What is logged for it (F101-FR-003: "log its outcome"). */
  readonly summary: string;
};

/** The end event of the run, as the emitter receives it (B-0141, B-0155). */
export type RunEndEvent = {
  readonly outcome: typeof THE_ONLY_OUTCOME_OF_THE_END_EVENT;
  /** ABSENT on the already-approved path (B-0141). */
  readonly phases?: number;
};

/** What the run loop needs. */
export type RunLoopInputs = {
  readonly position: StartPosition;
  /** The count of phases the end event of F101-FR-018 carries. */
  readonly phaseCount: number;
  /**
   * The clock the as-is final line reads (B-0232). A thunk, read when the
   * line is written at the END of the run, so a long run does not stamp its
   * start — the line of F101-FR-018 is written once the run ends approved.
   */
  readonly time: () => string;
};

/** The ports and the sinks the run loop calls. */
export type RunLoopDependencies = {
  /** Release verification; it runs FIRST on both exit-0 paths. */
  readonly releaseVerification: () => Promise<ReleaseVerificationOutcome>;
  /** Run one phase, through `./phase.ts`. */
  readonly runOnePhase: (phase: number) => Promise<PhaseOutcome>;
  readonly emitRunEnd: (event: RunEndEvent) => void;
  readonly writeLine: (line: string) => void;
  /** Where the outcome of release verification is logged. */
  readonly logReleaseVerification: (summary: string) => void;
};

/** How the run ended. */
export type RunEnd =
  | {
      readonly ended: "all-approved";
      /** True where every phase was approved BEFORE this run (F101-FR-003). */
      readonly approvedBefore: boolean;
      readonly exitCode: 0;
      readonly event: RunEndEvent;
      readonly line: string;
      readonly phasesRun: readonly number[];
    }
  | {
      readonly ended: "halted";
      readonly exitCode: number;
      readonly stopReason: string;
      readonly phase?: number;
      readonly phasesRun: readonly number[];
    };

/**
 * F101-FR-001, F101-FR-003 and F101-FR-018 — the loop over the phases of a
 * run.
 *
 * The two exit-0 paths differ in exactly two observable ways: the as-is line
 * and whether the end event carries `phases`. Both are decided here so that
 * the difference cannot drift apart.
 */
export async function runLoop(inputs: RunLoopInputs, deps: RunLoopDependencies): Promise<RunEnd> {
  const phasesRun: number[] = [];

  // F101-FR-003 — every phase was approved before this run. Release
  // verification runs FIRST; neither the proposer nor the critic is called.
  if (inputs.position.everyPhaseWasApprovedBefore) {
    const release = await deps.releaseVerification();
    deps.logReleaseVerification(release.summary);
    if (!release.passed && release.notRequired !== true) {
      return Object.freeze({
        ended: "halted" as const,
        exitCode: RELEASE_VERIFICATION_EXIT_CODE,
        stopReason: RELEASE_VERIFICATION_STOP_REASON,
        phasesRun: Object.freeze([]),
      });
    }
    const line = allPhasesAlreadyApproved();
    deps.writeLine(line);
    // B-0141 — WITHOUT `phases`.
    const event: RunEndEvent = Object.freeze({
      outcome: THE_ONLY_OUTCOME_OF_THE_END_EVENT,
    });
    deps.emitRunEnd(event);
    return Object.freeze({
      ended: "all-approved" as const,
      approvedBefore: true,
      exitCode: 0 as const,
      event,
      line,
      phasesRun: Object.freeze([]),
    });
  }

  // The loop itself: every phase from the start phase on, in the order of the
  // specification (F101-FR-002, third rule).
  for (const phase of inputs.position.phasesToRun) {
    phasesRun.push(phase);
    const outcome = await deps.runOnePhase(phase);
    if (outcome.outcome === "halted") {
      return Object.freeze({
        ended: "halted" as const,
        exitCode: outcome.exitCode,
        stopReason: outcome.stopReason,
        phase,
        phasesRun: Object.freeze([...phasesRun]),
      });
    }
  }

  // F101-FR-018 — every phase from the start phase on was approved in this
  // run. Release verification runs, then the end event WITH the count.
  const release = await deps.releaseVerification();
  deps.logReleaseVerification(release.summary);
  if (!release.passed && release.notRequired !== true) {
    return Object.freeze({
      ended: "halted" as const,
      exitCode: RELEASE_VERIFICATION_EXIT_CODE,
      stopReason: RELEASE_VERIFICATION_STOP_REASON,
      phasesRun: Object.freeze([...phasesRun]),
    });
  }
  const event: RunEndEvent = Object.freeze({
    outcome: THE_ONLY_OUTCOME_OF_THE_END_EVENT,
    phases: inputs.phaseCount,
  });
  deps.emitRunEnd(event);
  const line = done(inputs.phaseCount, inputs.time());
  deps.writeLine(line);
  return Object.freeze({
    ended: "all-approved" as const,
    approvedBefore: false,
    exitCode: 0 as const,
    event,
    line,
    phasesRun: Object.freeze([...phasesRun]),
  });
}
