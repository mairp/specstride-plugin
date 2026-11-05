/**
 * T044 of feature 101 — the order of the steps after an approval
 * (F101-FR-033; B-0326).
 *
 * After an approval the engine acts in THIS order and no other:
 *
 *  1. set aside the feedback, the hint and the acceleration note that are left
 *     of the phase, replacing those of an earlier approval of the phase, so
 *     that none of them reaches a later phase;
 *  2. remove the recovery markers of the phase;
 *  3. emit the as-is event that the phase is done and write the as-is line of
 *     the approval with the ordinal;
 *  4. tick the tasks (`./tick.ts`);
 *  5. let learning observe and evaluate the phase;
 *  6. make the approval commit (`./commit.ts`).
 *
 * The APPROVED PHASE EVIDENCE stays where the proposer delivered it. Ticked
 * tasks are therefore part of the approval commit, because ticking is step 4
 * and the commit is step 6 (B-0326).
 *
 * Where the engine ended AFTER the approval record was written and BEFORE
 * these steps were done, the next engine start treats the phase as approved
 * and does NOT run the steps again, as at the baseline: the steps are driven
 * by the approval of THIS run, never by the presence of an approval record.
 */
import { phaseApproved } from "../gate/lines.ts";
import {
  approvalCommit,
  type CommitInputs,
  type CommitDependencies,
  type CommitOutcome,
} from "./commit.ts";
import { tickTheTasks, type TickInputs, type TickOutcome } from "./tick.ts";

/** F101-FR-033 — the six steps, in their order. The list is the contract. */
export const ORDER_AFTER_AN_APPROVAL = Object.freeze([
  "set aside the feedback, the hint and the acceleration note",
  "remove the recovery markers of the phase",
  "emit the as-is event that the phase is done and write the as-is line",
  "tick the tasks",
  "let learning observe and evaluate the phase",
  "make the approval commit",
]);

/** F101-FR-033 — the approved phase evidence stays where the proposer put it. */
export const THE_APPROVED_PHASE_EVIDENCE_IS_MOVED = false as const;

/** F101-FR-033 — ticked tasks are part of the approval commit. */
export const TICKED_TASKS_ARE_PART_OF_THE_APPROVAL_COMMIT = true as const;

/** F101-FR-033 — the steps are never run twice for one approval. */
export const THE_STEPS_RUN_AGAIN_AT_THE_NEXT_START = false as const;

/** The three records set aside in step 1 (`phase:<N>:approved-archive`). */
export const RECORDS_SET_ASIDE = Object.freeze(["feedback", "hint", "acceleration note"]);

/** The ports and the sinks the steps call. */
export type PostApprovalDependencies = {
  /**
   * Step 1 — set the three records aside under `phase:<N>:approved-archive`,
   * REPLACING what an earlier approval of the same phase left there. It
   * returns the names it moved, which may be empty.
   */
  readonly setAside: (phase: number) => readonly string[];
  /** Step 2 — remove the recovery markers of the phase. */
  readonly removeRecoveryMarkers: (phase: number) => void;
  /** Step 3 — the as-is event that the phase is done (B-0102). */
  readonly emitPhaseDone: (event: {
    readonly phase: number;
    readonly attempt: number;
    readonly title: string;
  }) => void;
  /** Step 3 — the as-is line of the approval, with the ordinal (B-0224). */
  readonly writeLine: (line: string) => void;
  /** Step 4 — ticking (`./tick.ts`). */
  readonly tick: Omit<TickInputs, "phase">;
  /** Step 4 — the as-is event of a tick that worked (B-0103). */
  readonly emitTasksTicked: (event: { readonly phase: number; readonly count: number }) => void;
  /** Step 4 — the as-is warning of a tick that failed. */
  readonly warn: (line: string) => void;
  /**
   * Step 5 — learning observes and evaluates the phase. A failure is logged
   * and never undoes the approval (B-0325), so the caller's function must not
   * throw; this module guards it all the same.
   */
  readonly learning?: {
    readonly observe: (phase: number) => void;
    readonly evaluate: (phase: number) => void;
  };
  /** Step 5 — the line a failed observe or evaluate writes (B-0325). */
  readonly logLearningFailure?: (line: string) => void;
  /** Step 6 — the approval commit (`./commit.ts`). */
  readonly commit: Omit<CommitInputs, "phase" | "title">;
  readonly commitPorts: CommitDependencies;
  /** Step 6 — the as-is event of a commit that worked (B-0088). */
  readonly emitGitCheckpoint: (event: { readonly phase: number }) => void;
};

/** What the steps after an approval report back. */
export type PostApprovalOutcome = {
  /** The steps that ran, in the order they ran: the proof of F101-FR-033. */
  readonly stepsRun: readonly string[];
  readonly setAside: readonly string[];
  readonly tick: TickOutcome;
  readonly commit: CommitOutcome;
  readonly learningFailed: boolean;
};

/** B-0325 — the as-is line of a failed observe or evaluate of learning. */
export function learningFailureLine(what: string): string {
  return `#   (learning: ${what} failed — continuing; the run is unaffected)`;
}

/**
 * F101-FR-033 — run the steps after an approval, in their order. The caller
 * has already written the approval record (T043); this is everything that
 * follows it.
 */
export function stepsAfterAnApproval(
  inputs: {
    readonly phase: number;
    readonly ordinal: number;
    readonly title: string;
  },
  deps: PostApprovalDependencies,
): PostApprovalOutcome {
  const stepsRun: string[] = [];

  // 1 — set aside the feedback, the hint and the acceleration note.
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[0] as string);
  const setAside = deps.setAside(inputs.phase);

  // 2 — remove the recovery markers of the phase.
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[1] as string);
  deps.removeRecoveryMarkers(inputs.phase);

  // 3 — the as-is event that the phase is done, and the as-is line.
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[2] as string);
  deps.emitPhaseDone({ phase: inputs.phase, attempt: inputs.ordinal, title: inputs.title });
  deps.writeLine(phaseApproved(inputs.phase, inputs.ordinal));

  // 4 — tick the tasks.
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[3] as string);
  const tick = tickTheTasks({ ...deps.tick, phase: inputs.phase });
  if (tick.ran && tick.ticked) {
    deps.writeLine(tick.line);
    deps.emitTasksTicked(tick.event);
  } else if (tick.ran && !tick.ticked) {
    deps.warn(tick.line);
  }

  // 5 — learning observes and evaluates. A failure is logged and the approval
  // stands (B-0325).
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[4] as string);
  let learningFailed = false;
  if (deps.learning !== undefined) {
    for (const [what, call] of [
      ["observe", deps.learning.observe],
      ["evaluate", deps.learning.evaluate],
    ] as const) {
      try {
        call(inputs.phase);
      } catch {
        learningFailed = true;
        deps.logLearningFailure?.(learningFailureLine(what));
      }
    }
  }

  // 6 — the approval commit. Ticking has already happened, so the ticked
  // checkboxes are part of this commit.
  stepsRun.push(ORDER_AFTER_AN_APPROVAL[5] as string);
  const commit = approvalCommit(
    { ...deps.commit, phase: inputs.phase, title: inputs.title },
    deps.commitPorts,
  );
  if (commit.committed) {
    deps.writeLine(commit.line);
    deps.emitGitCheckpoint(commit.event);
  }

  return Object.freeze({
    stepsRun: Object.freeze(stepsRun),
    setAside,
    tick,
    commit,
    learningFailed,
  });
}
