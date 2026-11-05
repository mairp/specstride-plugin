/**
 * T038 of feature 101 — phase entry and the loop over phase attempts
 * (F101-FR-004).
 *
 * At the start of EVERY phase the engine
 *
 *  - emits the start event of the phase, with the phase number, the title, the
 *    count of phases and the hash of the phase shape or the empty text
 *    (B-0093), and
 *  - writes the as-is line of the phase start (B-0208).
 *
 * If phase evidence AND feedback of the phase are BOTH present — which is what
 * a halted rejection leaves behind (F101-FR-014) — the engine sets the PHASE
 * EVIDENCE aside before the proposer runs, under the as-is label of a resume,
 * `resume-<as-is run id>` (B-0307), and LEAVES THE FEEDBACK in place for the
 * prompt of the repair. Feedback alone, or phase evidence alone, sets nothing
 * aside: both must stand.
 *
 * T075 adds the FOURTH read site of F101-FR-031 to this module. Phase entry
 * READS WHETHER THE PHASE BEFORE IS APPROVED, through the verification of T074
 * and never through a bare existence check, for two reasons:
 *
 *  - the fingerprint of the tree that the approval record of the phase before
 *    binds is what the comparison at phase entry needs (F100-FR-136,
 *    F149-FR-008), and a record that does not verify binds nothing;
 *  - a record that fails, a missing record and a bare marker each raise an
 *    integrity event that names the phase and what failed (F101-FR-031).
 *
 * The read at phase entry NEVER decides whether the phase runs: F101-FR-002's
 * third rule has the engine run every phase from the start phase on without
 * checking approval records, and F101-FR-031 states that the fingerprint of
 * the tree never makes a record fail. So nothing here can block, and the first
 * phase of a run has no phase before it and reads nothing at all.
 *
 * The loop over phase attempts is here as well. What happens AFTER a rejection
 * — the MALFORMED limit, the diagnostician, the oscillation halt, the reject
 * limit, the archive and the kind of the next phase attempt — is F101-FR-017
 * and belongs to user story 2 (T065 to T068), so this loop asks a handler for
 * the decision and never decides itself.
 */
import { phaseStart } from "../gate/lines.ts";
import type { ApprovalFailure } from "@specstride/contracts/enums/gate";
import type { ApprovalIntegrityEvent, VerifiedApprovalReader } from "../approval/verify.ts";

/** B-0307 — the as-is label under which leftover phase evidence is set aside. */
export function resumeLabel(asIsRunId: string): string {
  return `resume-${asIsRunId}`;
}

/**
 * B-0307 — the directory of the archive of that label, as the baseline names
 * it: `attempts/phase<N>/attempt<label>/`.
 */
export function resumeArchiveDirectory(phase: number, asIsRunId: string): string {
  return `attempts/phase${phase}/attempt${resumeLabel(asIsRunId)}`;
}

/** B-0292 — the suffix an archive takes when its directory already exists. */
export function collisionSuffix(asIsRunId: string): string {
  return `-${asIsRunId}`;
}

/** F101-FR-004 — leftover phase evidence is set aside only when BOTH stand. */
export function leftoverPhaseEvidenceIsSetAside(inputs: {
  readonly phaseEvidenceExists: boolean;
  readonly feedbackExists: boolean;
}): boolean {
  return inputs.phaseEvidenceExists && inputs.feedbackExists;
}

/** F101-FR-004 — the feedback is left in place for the prompt of the repair. */
export const THE_FEEDBACK_IS_SET_ASIDE_AT_PHASE_ENTRY = false as const;

/** F101-FR-004 — and the phase evidence is set aside BEFORE the proposer runs. */
export const THE_EVIDENCE_IS_SET_ASIDE_BEFORE_THE_PROPOSER_RUNS = true as const;

/** The fields of the start event of a phase (B-0093). */
export const FIELDS_OF_THE_PHASE_START_EVENT = Object.freeze(["phase", "title", "total", "shape"]);

/** The start event of a phase, as the emitter receives it. */
export type PhaseStartEvent = {
  readonly phase: number;
  readonly title: string;
  /** The count of phases of the specification. */
  readonly total: number;
  /** The hash of the phase shape, or the empty text where none is known. */
  readonly shape: string;
};

/** What phase entry needs. */
export type PhaseEntryInputs = {
  readonly phase: number;
  readonly title: string;
  readonly total: number;
  /** The hash of the phase shape, or the empty text (B-0093). */
  readonly shape?: string | undefined;
  /** The time the as-is line of the phase start carries (B-0208). */
  readonly time: string;
  readonly phaseEvidenceExists: boolean;
  readonly feedbackExists: boolean;
  /** The as-is run id, which names the label of the archive (B-0307). */
  readonly asIsRunId: string;
  /**
   * The phase BEFORE this one in the order of the specification, or
   * `undefined` for the first phase of a run, which has none (the
   * specification, "Edge cases"). Its approval record is what phase entry
   * reads (F101-FR-031).
   */
  readonly phaseBefore?: number | undefined;
};

/** The ports phase entry calls. */
export type PhaseEntryDependencies = {
  readonly emitPhaseStart: (event: PhaseStartEvent) => void;
  readonly writeLine: (line: string) => void;
  /**
   * Set the phase evidence aside under the given label. It is the archive of a
   * phase attempt (F101-FR-027) with the label of a resume instead of an
   * ordinal, so the engine's one writer does it.
   */
  readonly setEvidenceAside: (phase: number, label: string) => void;
  /**
   * F101-FR-031 — the reader of approval records, which VERIFIES every one it
   * reads (T074, `../approval/verify.ts`). Phase entry is one of the four read
   * sites the requirement names, so the dependency is required and not
   * optional: there is no way to enter a phase without it.
   */
  readonly readApproval: VerifiedApprovalReader;
  /** Where the integrity event of an approval that failed is emitted. */
  readonly emitIntegrityEvent: (event: ApprovalIntegrityEvent) => void;
};

/** What phase entry reports back. */
export type PhaseEntryOutcome = {
  readonly event: PhaseStartEvent;
  readonly line: string;
  /** The label under which leftover phase evidence was set aside, or absent. */
  readonly setAsideUnder?: string;
  /** False where nothing was left over, which is the ordinary case. */
  readonly evidenceWasSetAside: boolean;
  /** F101-FR-031 — what the read of the approval of the phase before found. */
  readonly approvalOfThePhaseBefore: ApprovalAtPhaseEntry;
};

/**
 * F101-FR-031 — what the read of an approval at phase entry found.
 *
 * `treeFingerprint` is the one thing phase entry wants from the record, and it
 * is present only when the record VERIFIED: the comparison of F100-FR-136
 * compares against a fingerprint that a verified record binds, never against
 * one taken from a record that failed its bindings.
 */
export type ApprovalAtPhaseEntry = {
  /** The phase that starts. */
  readonly phase: number;
  /** The phase whose approval was read, or `undefined` for the first phase. */
  readonly phaseBefore: number | undefined;
  /** False where nothing was read, which is the first phase of a run. */
  readonly read: boolean;
  /** True only where the record of the phase before VERIFIED. */
  readonly verified: boolean;
  /** The fingerprint the verified record binds, for the comparison of F100-FR-136. */
  readonly treeFingerprint: string | undefined;
  /** What failed, where the read found a record that does not verify. */
  readonly failed: ApprovalFailure | undefined;
  /** The integrity event the read raised, where it raised one. */
  readonly integrityEvent: ApprovalIntegrityEvent | undefined;
};

/** F101-FR-031 — the read at phase entry can never block a phase. */
export const THE_READ_AT_PHASE_ENTRY_BLOCKS = false as const;

/** F101-FR-031 — the read site this module owns. */
export const READ_SITE = "phase-entry" as const;

/**
 * F101-FR-031 — read whether the phase BEFORE is approved, at phase entry,
 * through the verification of T074. The first phase of a run reads nothing.
 */
export function approvalAtPhaseEntry(
  phase: number,
  phaseBefore: number | undefined,
  readApproval: VerifiedApprovalReader,
): ApprovalAtPhaseEntry {
  if (phaseBefore === undefined) {
    return Object.freeze({
      phase,
      phaseBefore: undefined,
      read: false,
      verified: false,
      treeFingerprint: undefined,
      failed: undefined,
      integrityEvent: undefined,
    });
  }
  const read = readApproval(phaseBefore);
  if (read.approved) {
    return Object.freeze({
      phase,
      phaseBefore,
      read: true,
      verified: true,
      treeFingerprint: read.record.treeFingerprint,
      failed: undefined,
      integrityEvent: undefined,
    });
  }
  return Object.freeze({
    phase,
    phaseBefore,
    read: true,
    verified: false,
    treeFingerprint: undefined,
    failed: read.failed,
    integrityEvent: read.integrityEvent,
  });
}

/** F101-FR-004 — enter a phase. */
export function enterPhase(
  inputs: PhaseEntryInputs,
  deps: PhaseEntryDependencies,
): PhaseEntryOutcome {
  const event: PhaseStartEvent = Object.freeze({
    phase: inputs.phase,
    title: inputs.title,
    total: inputs.total,
    shape: inputs.shape ?? "",
  });
  deps.emitPhaseStart(event);
  const line = phaseStart(inputs.phase, inputs.title, inputs.time);
  deps.writeLine(line);

  // F101-FR-031 — the fourth read site. It runs on EVERY phase entry, before
  // anything of the phase happens, and its integrity event is emitted at once;
  // it never decides whether the phase runs.
  const approvalOfThePhaseBefore = approvalAtPhaseEntry(
    inputs.phase,
    inputs.phaseBefore,
    deps.readApproval,
  );
  if (approvalOfThePhaseBefore.integrityEvent !== undefined) {
    deps.emitIntegrityEvent(approvalOfThePhaseBefore.integrityEvent);
  }

  if (
    leftoverPhaseEvidenceIsSetAside({
      phaseEvidenceExists: inputs.phaseEvidenceExists,
      feedbackExists: inputs.feedbackExists,
    })
  ) {
    const label = resumeLabel(inputs.asIsRunId);
    deps.setEvidenceAside(inputs.phase, label);
    return Object.freeze({
      event,
      line,
      setAsideUnder: label,
      evidenceWasSetAside: true,
      approvalOfThePhaseBefore,
    });
  }
  return Object.freeze({
    event,
    line,
    evidenceWasSetAside: false,
    approvalOfThePhaseBefore,
  });
}

/* ------------------------------------------------------------------ *
 * F101-FR-011 — the read of the approval record the engine JUST WROTE.
 * ------------------------------------------------------------------ */

/**
 * F101-FR-011 — "A phase MUST count as approved only when the verdict of the
 * critic strategy is APPROVED and the approval record of the phase was written
 * and verifies. An APPROVED verdict without such a record MUST be handled as a
 * rejection."
 *
 * So an APPROVED verdict is not the end of a phase attempt: the engine READS
 * THE RECORD BACK, through the same verification of T074 that every other read
 * site uses (T075), and an approval whose record is missing or does not verify
 * becomes the outcome `rejected`. That closes the gap a forged or half-written
 * record would otherwise leave: the only way to the outcome `approved` is a
 * record that verifies.
 *
 * The outcome is `rejected` and not a halt, because F101-FR-011 names the
 * handling of a rejection, which is where the limits of F101-FR-017 then
 * apply.
 */
export const AN_APPROVED_VERDICT_WITHOUT_A_VERIFYING_RECORD_IS: AttemptOutcome = "rejected";

/** What the read-back of F101-FR-011 found. */
export type ApprovalAfterTheRecordWasWritten = {
  readonly outcome: Extract<AttemptOutcome, "approved" | "rejected">;
  /** What failed, where the record the engine wrote does not verify. */
  readonly failed: ApprovalFailure | undefined;
  readonly integrityEvent: ApprovalIntegrityEvent | undefined;
};

/**
 * F101-FR-011 — the outcome of a phase attempt whose verdict was APPROVED,
 * decided by reading the approval record back through the verification.
 */
export function outcomeOfAnApprovedVerdict(
  phase: number,
  readApproval: VerifiedApprovalReader,
): ApprovalAfterTheRecordWasWritten {
  const read = readApproval(phase);
  if (read.approved) {
    return Object.freeze({
      outcome: "approved" as const,
      failed: undefined,
      integrityEvent: undefined,
    });
  }
  return Object.freeze({
    outcome: AN_APPROVED_VERDICT_WITHOUT_A_VERIFYING_RECORD_IS as "rejected",
    failed: read.failed,
    integrityEvent: read.integrityEvent,
  });
}

/* ------------------------------------------------------------------ *
 * The loop over phase attempts.
 * ------------------------------------------------------------------ */

/** What one phase attempt ended as (`data-model.md`, field `outcome`). */
export const ATTEMPT_OUTCOMES = [
  "approved",
  "rejected",
  "malformed",
  "gate-failed",
  "config-error",
  "no-verdict",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/**
 * F101-FR-010 and F101-FR-041 — the two ends of a phase attempt that are NO
 * outcome of the record of a phase attempt, because nothing was scored and
 * therefore NO COUNT CHANGES:
 *
 *  - a configuration error of the critic, found BEFORE the call was made: the
 *    run halts with exit 3 and `critic_config` (F101-FR-010), and the missing
 *    credential of the critic under the switch takes the same path (T111);
 *  - a failed critic-class call that the quota classifier classes as
 *    `quota_credit` or as `auth`: the run rests blocked on the consumer and
 *    ends with the stop reason and the exit code of the table of blocked
 *    reasons (F101-FR-041);
 *  - the OWNER OF THE LEASE is lost at a boundary of the phase gate: the
 *    engine runs no phase gate and writes no approval record, and ends with
 *    exit 6 and `stop_flag` (F101-FR-040, F100-FR-147).
 *
 * On either end the loop ends AT ONCE and the handler of the order after a
 * rejection is never asked, which is what keeps the counts untouched.
 */
export type AttemptEndedTheRun = {
  readonly endsTheRun: true;
  /** Which of the three ends it is. */
  readonly because: "config-error" | "blocked" | "owner-lost";
  /** The blocked reason of the closed set, where the end is a blocked path. */
  readonly reason?: string | undefined;
  readonly exitCode: number;
  readonly stopReason: string;
};

/** F101-FR-010, F101-FR-040 and F101-FR-041 — no such end changes a count. */
export const AN_END_THAT_IS_NO_OUTCOME_CHANGES_A_COUNT = false as const;

/** How one phase attempt ended: an outcome of its record, or one of the two ends. */
export type AttemptEnd = AttemptOutcome | AttemptEndedTheRun;

/** True when the phase attempt ended the run without being scored. */
export function attemptEndedTheRun(end: AttemptEnd): end is AttemptEndedTheRun {
  return typeof end !== "string" && end.endsTheRun === true;
}

/** What the handler of a rejection decides (F101-FR-017, user story 2). */
export type AfterARejection =
  | { readonly go: "next-attempt" }
  | { readonly go: "halt"; readonly exitCode: number; readonly stopReason: string };

/** What the loop over phase attempts reports back. */
export type PhaseOutcome =
  | { readonly outcome: "approved"; readonly ordinal: number }
  | {
      readonly outcome: "halted";
      readonly ordinal: number;
      readonly exitCode: number;
      readonly stopReason: string;
    };

/**
 * F101-FR-004 — the loop over the phase attempts of one phase. It runs the
 * phase attempt, and on anything but an approval it asks the handler of
 * F101-FR-017 what to do; the handler owns every limit and every count.
 *
 * `ordinal` starts at 1 and rises by one per phase attempt, as at the
 * baseline. At most as many phase attempts as the reject limit allows are
 * judged per phase (B-0310), which is the handler's rule and not this loop's:
 * the loop ends when the handler says `halt`.
 */
export async function runPhaseAttempts(
  inputs: { readonly phase: number; readonly firstOrdinal?: number },
  deps: {
    readonly runOneAttempt: (ordinal: number) => Promise<AttemptEnd>;
    readonly afterARejection: (
      ordinal: number,
      outcome: AttemptOutcome,
    ) => Promise<AfterARejection> | AfterARejection;
  },
): Promise<PhaseOutcome> {
  let ordinal = inputs.firstOrdinal ?? 1;
  for (;;) {
    const outcome = await deps.runOneAttempt(ordinal);
    if (attemptEndedTheRun(outcome)) {
      // F101-FR-010 and F101-FR-041 — nothing is scored: the handler of the
      // order after a rejection is not asked, and no count changes.
      return Object.freeze({
        outcome: "halted" as const,
        ordinal,
        exitCode: outcome.exitCode,
        stopReason: outcome.stopReason,
      });
    }
    if (outcome === "approved") {
      return Object.freeze({ outcome: "approved" as const, ordinal });
    }
    const decision = await deps.afterARejection(ordinal, outcome);
    if (decision.go === "halt") {
      return Object.freeze({
        outcome: "halted" as const,
        ordinal,
        exitCode: decision.exitCode,
        stopReason: decision.stopReason,
      });
    }
    ordinal += 1;
  }
}
