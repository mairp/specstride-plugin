/**
 * T065 of feature 101 — the reject count, the MALFORMED streak and the ORDER
 * AFTER A REJECTION (F101-FR-014, F101-FR-015, F101-FR-017).
 *
 * This is the handler the loop over phase attempts asks after every rejection
 * (`../engine/phase.ts`, `afterARejection`). It owns every count and every
 * limit of the phase gate, and it acts in exactly the order F101-FR-017 fixes:
 *
 * | Place | Step | Requirement |
 * |---|---|---|
 * | 1 | the MALFORMED limit | F101-FR-015 |
 * | 2 | the diagnostician | F101-FR-017, F101-FR-020 |
 * | 3 | the oscillation halt | F101-FR-016 |
 * | 4 | the reject limit | F101-FR-014 |
 * | 5 | the archive, and the next phase attempt, whose KIND the attempt planner gives | F101-FR-027, feature 100 annex E §E.1 |
 *
 * The order is not a convenience: it decides which of two halts a phase that
 * is both oscillating and at its reject limit ends with, and it is why the
 * diagnostician never runs on the phase attempt that trips the MALFORMED limit
 * (B-0332) while it DOES run on the last phase attempt before a halt by the
 * reject limit or by oscillation.
 *
 * ## Counts
 *
 * The counts live in the LEDGER, in the namespace `core` of feature 100 annex
 * B §B.13, and they continue across a resume and a relaunch (F100-FR-069).
 * This module reads them and writes them THROUGH THE ENGINE: `LedgerCounts` is
 * the port, the composition root implements it over the ledger, and nothing
 * here keeps a count of its own between calls. That is what makes a reject
 * limit reached across a resume reach it at the same phase attempt as a reject
 * limit reached in one run.
 *
 * ## The kind of the next phase attempt
 *
 * The kind is never decided here. It comes from the operation `next` of the
 * attempt planner of feature 100 annex E §E.1, which this module CALLS with
 * the history of the phase; a planner changes no count and produces no exit
 * code (F149-FR-002), so calling it after the limits is safe in either order
 * and is placed where the requirement puts it: last.
 */
import type {
  AttemptHistory,
  AttemptKind,
  AttemptPlanner,
  Verdict,
} from "@specstride/contracts/ep/critic-strategy";
import { CORE_NAMESPACE, LEDGER_LOGICAL_NAME } from "../ep18/history.ts";
import { criticMalformedEvent, rejectEvent } from "./events.ts";
import { criticNoUsableVerdict, phaseRejected } from "./lines.ts";
import { haltOf, type Halt } from "./halts.ts";
import {
  checkForOscillation,
  OSCILLATION_THRESHOLD_DEFAULT,
  type FeedbackRecordOfThePhase,
  type OscillationOutcome,
} from "./oscillation.ts";
import type { TaskIdSource } from "./feedback.ts";

/** F101-FR-014 — the default of the reject limit (B-0039). */
export const REJECT_LIMIT_DEFAULT = 3 as const;

/** F101-FR-015 — the default of the MALFORMED limit (B-0048). */
export const MALFORMED_LIMIT_DEFAULT = 3 as const;

/** F101-FR-015 — the value of the MALFORMED limit that switches it off. */
export const MALFORMED_LIMIT_OFF = 0 as const;

/** F101-FR-014 and F101-FR-015 — both limits come from configuration. */
export const LIMITS_COME_FROM_CONFIGURATION = true as const;

/** F101-FR-014 — at most as many phase attempts as the limit are judged per phase (B-0310). */
export function phaseAttemptsJudgedAtMost(rejectLimit: number): number {
  return rejectLimit;
}

/** F101-FR-017 — the order after a rejection, in the words of the requirement. */
export const ORDER_AFTER_A_REJECTION = [
  "the MALFORMED limit",
  "the diagnostician",
  "the oscillation halt",
  "the reject limit",
  "the archive and the next phase attempt",
] as const;
export type StepAfterARejection = (typeof ORDER_AFTER_A_REJECTION)[number];

/**
 * F101-FR-017 — the feedback the engine wrote after a failed verification gate
 * is feedback LIKE ANY OTHER: it gives a signature, the diagnostician may run
 * on it, and it is a record of the oscillation window (B-0332, B-0105).
 */
export const FEEDBACK_OF_THE_VERIFICATION_GATE_IS_FEEDBACK_LIKE_ANY_OTHER = true as const;

/** F101-FR-017 — the diagnostician never runs on the phase attempt that trips the MALFORMED limit. */
export const THE_DIAGNOSTICIAN_RUNS_ON_THE_PHASE_ATTEMPT_THAT_TRIPS_THE_MALFORMED_LIMIT =
  false as const;

/** The operation of the seam this module calls for the kind (annex E §E.1). */
export const OPERATION_OF_THE_ATTEMPT_PLANNER = "next" as const;

/* ------------------------------------------------------------------ *
 * What one rejection was.
 * ------------------------------------------------------------------ */

/**
 * F101-FR-014 — the three things that are a rejection of a phase attempt: a
 * verdict REJECTED, a verdict MALFORMED, and a failed verification gate. All
 * three emit the as-is rejection event and write the as-is line of the
 * rejection (B-0105).
 */
export const KINDS_OF_A_REJECTION = ["rejected", "malformed", "gate-failed"] as const;
export type KindOfARejection = (typeof KINDS_OF_A_REJECTION)[number];

/**
 * B-0328 and F101-FR-015 — a failed verification gate leaves NO verdict, so it
 * sets the MALFORMED streak to 0 like any other result that is not MALFORMED.
 */
export const A_FAILED_VERIFICATION_GATE_SETS_THE_MALFORMED_STREAK_TO_ZERO = true as const;

/* ------------------------------------------------------------------ *
 * The counts, in the ledger.
 * ------------------------------------------------------------------ */

/** The logical name of the ledger the counts live in (annex B §B.5, §B.13). */
export const LEDGER = LEDGER_LOGICAL_NAME;

/** The namespace of the ledger the counts of the engine live in (§B.13). */
export const LEDGER_NAMESPACE = CORE_NAMESPACE;

/**
 * The three counters of the ledger this module reads and writes
 * (F100-FR-069). They are named here and not imported, because the module of
 * feature 100 that lists every counter of the namespace is published under no
 * subpath of `@specstride/contracts`; `../ep18/history.ts` names the two it
 * reads the same way, so the core holds one convention and not two.
 */
export const COUNTERS_OF_THE_PHASE_GATE = [
  "rejectCount",
  "phaseAttemptOrdinal",
  "malformedStreak",
] as const;
export type CounterOfThePhaseGate = (typeof COUNTERS_OF_THE_PHASE_GATE)[number];

/** True when the name is one of the three counters this module writes. */
export function isACounterOfTheLedger(name: string): boolean {
  return (COUNTERS_OF_THE_PHASE_GATE as readonly string[]).includes(name);
}

/** F100-FR-069 — the counts continue across a resume and a relaunch. */
export const COUNTS_CONTINUE_ACROSS_A_RESUME = true as const;

/** The counts of one phase, as the ledger holds them. */
export type Counts = {
  /** How many phase attempts of the phase were rejected. */
  readonly rejectCount: number;
  /** The ordinal of the newest phase attempt of the phase. */
  readonly phaseAttemptOrdinal: number;
  /** How many verdicts in a row were MALFORMED. */
  readonly malformedStreak: number;
};

/** The counts of a phase no phase attempt of which was rejected yet. */
export const NO_COUNTS: Counts = Object.freeze({
  rejectCount: 0,
  phaseAttemptOrdinal: 0,
  malformedStreak: 0,
});

/**
 * The port through which the counts are read and written. The engine
 * implements it over the LEDGER; this module keeps no count between calls, so
 * a resume and a relaunch read the same counts the run before wrote
 * (F100-FR-069).
 */
export type LedgerCounts = {
  /** The counts of the phase, as the ledger holds them now. */
  read(): Counts;
  /** Write the counts of the phase back to the ledger. */
  write(counts: Counts): void;
};

/**
 * F101-FR-014 and F101-FR-015 — the counts after one rejection: the reject
 * count rises by one, the ordinal of the newest phase attempt is this one, and
 * the MALFORMED streak rises by one for a MALFORMED verdict and is set to 0 for
 * every other result, a failed verification gate included.
 *
 * The streak rises only WHILE THE LIMIT IS ON (F101-FR-015): with the limit at
 * 0 the streak stays 0, and a MALFORMED verdict is an ordinary rejection.
 */
export function countsAfterARejection(inputs: {
  readonly before: Counts;
  readonly ordinal: number;
  readonly kind: KindOfARejection;
  readonly malformedLimit: number;
}): Counts {
  const limitIsOn = inputs.malformedLimit > MALFORMED_LIMIT_OFF;
  const streak = !limitIsOn
    ? 0
    : inputs.kind === "malformed"
      ? inputs.before.malformedStreak + 1
      : 0;
  return Object.freeze({
    rejectCount: inputs.before.rejectCount + 1,
    phaseAttemptOrdinal: inputs.ordinal,
    malformedStreak: streak,
  });
}

/** F101-FR-015 — true when the MALFORMED limit is on. */
export function theMalformedLimitIsOn(limit: number): boolean {
  return limit > MALFORMED_LIMIT_OFF;
}

/** F101-FR-015 — true when the streak has REACHED the limit. */
export function theMalformedLimitIsReached(streak: number, limit: number): boolean {
  return theMalformedLimitIsOn(limit) && streak >= limit;
}

/** F101-FR-014 — true when the count of phase attempts has REACHED the reject limit. */
export function theRejectLimitIsReached(ordinal: number, limit: number): boolean {
  return ordinal >= limit;
}

/* ------------------------------------------------------------------ *
 * The decision.
 * ------------------------------------------------------------------ */

/** What the diagnostician did at place 2 of the order, where it ran at all. */
export type DiagnosisAtPlaceTwo = {
  /** Whether a diagnosis was due for this rejection. */
  readonly due: boolean;
  /** Whether it actually ran; false where it was due and the call failed. */
  readonly ran: boolean;
  /** The message of a failure of the call; a failure is never a halt. */
  readonly failed?: string | undefined;
};

/** What the handler decided: the next phase attempt, or a halt. */
export type AfterARejectionOutcome =
  | {
      readonly go: "next-attempt";
      /** The counts as they now stand in the ledger. */
      readonly counts: Counts;
      /** The steps that ran, in order: the proof of F101-FR-017. */
      readonly stepsRun: readonly StepAfterARejection[];
      readonly diagnosis: DiagnosisAtPlaceTwo;
      /** F101-FR-014 — the phase attempt is archived before the next one starts. */
      readonly archive: true;
      /** The ordinal of the next phase attempt. */
      readonly nextOrdinal: number;
      /** The kind the attempt planner gave for it (annex E §E.1). */
      readonly kindOfTheNextPhaseAttempt: AttemptKind;
      /** The as-is event and line of the rejection (B-0105, B-0227). */
      readonly rejection: RejectionRecord;
      readonly oscillation: OscillationOutcome;
    }
  | {
      readonly go: "halt";
      readonly counts: Counts;
      readonly stepsRun: readonly StepAfterARejection[];
      readonly diagnosis: DiagnosisAtPlaceTwo;
      /** The halt, read from the table of halts (F101-FR-037). */
      readonly halt: Halt;
      readonly exitCode: number;
      readonly stopReason: string;
      /** The as-is fields of the stop line, with their values. */
      readonly stopFields: Readonly<Record<string, unknown>>;
      /** Whether the phase attempt is archived BEFORE the halt (the table). */
      readonly archiveBeforeTheHalt: boolean;
      /** True for the halt of the reject limit, which prints the banner. */
      readonly printTheHaltBanner: boolean;
      readonly rejection: RejectionRecord;
      readonly oscillation: OscillationOutcome | undefined;
    };

/** The as-is event and line every rejection writes (F101-FR-014). */
export type RejectionRecord = {
  /** The as-is event `reject`, with its two fields (B-0105). */
  readonly event: { readonly phase: number; readonly attempt: number };
  /** The as-is line of the rejection, with the ordinal and the limit (B-0227). */
  readonly line: string;
  /** The as-is event of a MALFORMED verdict, where the limit is on (B-0106). */
  readonly malformedEvent?: {
    readonly phase: number;
    readonly attempt: number;
    readonly streak: number;
    readonly limit: number;
  };
  /** The as-is line of a MALFORMED verdict, where the limit is on (B-0228). */
  readonly malformedLine?: string;
};

/** What the handler is handed about one rejection. */
export type AfterARejectionInputs = {
  readonly phase: number;
  /** The ordinal of the phase attempt that was just rejected. */
  readonly ordinal: number;
  readonly kind: KindOfARejection;
  /** The reject limit; 3 by default (F101-FR-014). */
  readonly rejectLimit?: number | undefined;
  /** The MALFORMED limit; 3 by default, 0 off (F101-FR-015). */
  readonly malformedLimit?: number | undefined;
  /** The threshold of oscillation; 2 by default (F101-FR-016). */
  readonly oscillationThreshold?: number | undefined;
  /**
   * Every feedback record of the phase, the archived ones and the live one
   * together — the feedback of a failed verification gate included
   * (F101-FR-017).
   */
  readonly feedbackRecords: readonly FeedbackRecordOfThePhase[];
  /** The ordinal of the first phase attempt since the counts were last reset. */
  readonly sinceTheCountsWereReset?: number | undefined;
  /** The ids of the one grammar owner, for the criteria of the window. */
  readonly taskIds?: TaskIdSource | undefined;
  /** The verdicts of the phase attempts of the phase so far, in order. */
  readonly verdicts?: readonly Verdict[] | undefined;
  /** The signatures of unmet criteria of the phase attempts, in order. */
  readonly signatures?: readonly string[] | undefined;
  /** The two facts of the recovery cycle the seam is handed (annex E §E.1). */
  readonly diagnosisWasMadeForTheNewestSignature?: boolean | undefined;
  readonly anAcceleratedPhaseAttemptIsDue?: boolean | undefined;
};

/** What the handler calls. */
export type AfterARejectionDependencies = {
  /** The counts, read from and written to the ledger through the engine. */
  readonly counts: LedgerCounts;
  /** The attempt planner of annex E §E.1; its operation `next` gives the kind. */
  readonly attemptPlanner: AttemptPlanner;
  /** Whether a diagnosis is due for this rejection (the recovery cycle). */
  readonly aDiagnosisIsDue?: ((facts: DiagnosisFacts) => boolean) | undefined;
  /** Run the diagnostician. A failure is recorded and is never a halt. */
  readonly runTheDiagnostician?: ((facts: DiagnosisFacts) => void | Promise<void>) | undefined;
  /** Emit the as-is event of the rejection (B-0105). */
  readonly emitReject?: ((event: RejectionRecord["event"]) => void) | undefined;
  /** Emit the as-is event of a MALFORMED verdict (B-0106). */
  readonly emitMalformed?:
    ((event: NonNullable<RejectionRecord["malformedEvent"]>) => void) | undefined;
  /** Write a line of the engine log. */
  readonly writeLine?: ((line: string) => void) | undefined;
  /**
   * F101-FR-024 — the two FACTS of the recovery cycle, which the engine hands
   * to the attempt planner. They are worked out by the owner of the recovery
   * cycle (`../recovery/accelerator.ts`, T085) and can only be worked out AT
   * PLACE 5: the first of them depends on the diagnostician of place 2 having
   * run, and the second on the marker that the diagnosis just wrote. So the
   * engine hands in a reader, which is called once, after the diagnosis and
   * before the planner. Where a caller gave the facts in the inputs, those
   * stand; where neither is given, the fall-back is what place 2 did.
   */
  readonly factsOfTheRecoveryCycle?:
    | ((diagnosis: DiagnosisAtPlaceTwo) => {
        readonly diagnosisWasMadeForTheNewestSignature: boolean;
        readonly anAcceleratedPhaseAttemptIsDue: boolean;
      })
    | undefined;
};

/** What the rule of the diagnostician is told about this rejection. */
export type DiagnosisFacts = {
  readonly phase: number;
  readonly ordinal: number;
  readonly kind: KindOfARejection;
  readonly rejectLimit: number;
  /** True where the MALFORMED limit tripped: the diagnostician never runs then. */
  readonly theMalformedLimitTripped: boolean;
  /** True where this is the last phase attempt before a halt by a limit. */
  readonly theLastPhaseAttemptBeforeAHalt: boolean;
  /** The newest signature of unmet criteria, where one exists. */
  readonly signature?: string | undefined;
};

/**
 * F101-FR-014, F101-FR-015 and F101-FR-017 — handle ONE rejection.
 *
 * The counts are raised and written to the ledger FIRST, because every step
 * that follows reads them: the MALFORMED limit reads the streak, the reject
 * limit reads the count of phase attempts, and the stop line of either carries
 * them. Then the five steps of the order run, and the function returns at the
 * first one that halts.
 */
export async function afterARejection(
  inputs: AfterARejectionInputs,
  deps: AfterARejectionDependencies,
): Promise<AfterARejectionOutcome> {
  const rejectLimit = inputs.rejectLimit ?? REJECT_LIMIT_DEFAULT;
  const malformedLimit = inputs.malformedLimit ?? MALFORMED_LIMIT_DEFAULT;

  /* The counts: read from the ledger, raised, written back. */
  const before = deps.counts.read();
  const counts = countsAfterARejection({
    before,
    ordinal: inputs.ordinal,
    kind: inputs.kind,
    malformedLimit,
  });
  deps.counts.write(counts);

  /* F101-FR-014 — every rejection emits the as-is event and writes the line. */
  const rejection = rejectionRecordOf({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    kind: inputs.kind,
    rejectLimit,
    malformedLimit,
    streak: counts.malformedStreak,
  });
  deps.emitReject?.(rejection.event);
  deps.writeLine?.(rejection.line);
  if (rejection.malformedEvent !== undefined) {
    deps.emitMalformed?.(rejection.malformedEvent);
    if (rejection.malformedLine !== undefined) deps.writeLine?.(rejection.malformedLine);
  }

  const stepsRun: StepAfterARejection[] = [];

  /* --- place 1: the MALFORMED limit (F101-FR-015) -------------------- */
  stepsRun.push(ORDER_AFTER_A_REJECTION[0]);
  const malformedLimitTripped = theMalformedLimitIsReached(counts.malformedStreak, malformedLimit);
  if (malformedLimitTripped) {
    const halt = haltOf("malformed-limit");
    return Object.freeze({
      go: "halt" as const,
      counts,
      stepsRun: Object.freeze([...stepsRun]),
      diagnosis: Object.freeze({ due: false, ran: false }),
      halt,
      exitCode: halt.exitCode,
      stopReason: halt.stopReason as string,
      stopFields: Object.freeze({
        phase: inputs.phase,
        attempts: counts.phaseAttemptOrdinal,
        streak: counts.malformedStreak,
      }),
      archiveBeforeTheHalt: halt.archivedBefore === true,
      printTheHaltBanner: false,
      rejection,
      oscillation: undefined,
    });
  }

  /* --- place 2: the diagnostician (F101-FR-017) ---------------------- */
  stepsRun.push(ORDER_AFTER_A_REJECTION[1]);
  const facts: DiagnosisFacts = Object.freeze({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    kind: inputs.kind,
    rejectLimit,
    theMalformedLimitTripped: false,
    theLastPhaseAttemptBeforeAHalt: theRejectLimitIsReached(inputs.ordinal, rejectLimit),
    ...(inputs.signatures === undefined
      ? {}
      : { signature: inputs.signatures[inputs.signatures.length - 1] }),
  });
  const diagnosis = await runTheDiagnosticianAtPlaceTwo(facts, deps);

  /* --- place 3: the oscillation halt (F101-FR-016) ------------------- */
  stepsRun.push(ORDER_AFTER_A_REJECTION[2]);
  const oscillation = checkForOscillation({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    records: inputs.feedbackRecords,
    ...(inputs.sinceTheCountsWereReset === undefined
      ? {}
      : { sinceTheCountsWereReset: inputs.sinceTheCountsWereReset }),
    threshold: inputs.oscillationThreshold ?? OSCILLATION_THRESHOLD_DEFAULT,
    ...(inputs.taskIds === undefined ? {} : { taskIds: inputs.taskIds }),
  });
  if (oscillation.halts) {
    const halt = haltOf("oscillation");
    return Object.freeze({
      go: "halt" as const,
      counts,
      stepsRun: Object.freeze([...stepsRun]),
      diagnosis,
      halt,
      exitCode: halt.exitCode,
      stopReason: halt.stopReason as string,
      stopFields: Object.freeze({
        phase: inputs.phase,
        attempts: counts.phaseAttemptOrdinal,
      }),
      archiveBeforeTheHalt: halt.archivedBefore === true,
      printTheHaltBanner: false,
      rejection,
      oscillation,
    });
  }

  /* --- place 4: the reject limit (F101-FR-014) ----------------------- */
  stepsRun.push(ORDER_AFTER_A_REJECTION[3]);
  if (theRejectLimitIsReached(inputs.ordinal, rejectLimit)) {
    const halt = haltOf("reject-limit");
    return Object.freeze({
      go: "halt" as const,
      counts,
      stepsRun: Object.freeze([...stepsRun]),
      diagnosis,
      halt,
      exitCode: halt.exitCode,
      stopReason: halt.stopReason as string,
      stopFields: Object.freeze({
        phase: inputs.phase,
        attempts: counts.phaseAttemptOrdinal,
      }),
      // B-0336 — the last phase attempt of this halt is NOT archived.
      archiveBeforeTheHalt: halt.archivedBefore === true,
      printTheHaltBanner: true,
      rejection,
      oscillation,
    });
  }

  /* --- place 5: the archive, and the next phase attempt -------------- */
  stepsRun.push(ORDER_AFTER_A_REJECTION[4]);
  // F101-FR-024 — the two facts of the recovery cycle, read once, here.
  const factsOfTheRecoveryCycle = deps.factsOfTheRecoveryCycle?.(diagnosis);
  const history: AttemptHistory = Object.freeze({
    verdicts: Object.freeze([...(inputs.verdicts ?? [])]),
    unmetCriteriaSignatures: Object.freeze([...(inputs.signatures ?? [])]),
    countsFromTheLedger: Object.freeze({ ...counts }),
    diagnosisWasMadeForTheNewestSignature:
      inputs.diagnosisWasMadeForTheNewestSignature ??
      factsOfTheRecoveryCycle?.diagnosisWasMadeForTheNewestSignature ??
      diagnosis.ran,
    anAcceleratedPhaseAttemptIsDue:
      inputs.anAcceleratedPhaseAttemptIsDue ??
      factsOfTheRecoveryCycle?.anAcceleratedPhaseAttemptIsDue ??
      false,
  });
  const kindOfTheNextPhaseAttempt = deps.attemptPlanner.next(history);

  return Object.freeze({
    go: "next-attempt" as const,
    counts,
    stepsRun: Object.freeze([...stepsRun]),
    diagnosis,
    archive: true as const,
    nextOrdinal: inputs.ordinal + 1,
    kindOfTheNextPhaseAttempt,
    rejection,
    oscillation,
  });
}

/**
 * Place 2 of the order: the diagnostician. It is due when the rule of the
 * recovery cycle says so, and a failure of the call is RECORDED and never a
 * halt (F101-FR-020: "a proof that fails gives a warning, no call and no
 * hint"; F101-FR-017 for the place).
 */
async function runTheDiagnosticianAtPlaceTwo(
  facts: DiagnosisFacts,
  deps: AfterARejectionDependencies,
): Promise<DiagnosisAtPlaceTwo> {
  const due = deps.aDiagnosisIsDue?.(facts) ?? false;
  if (!due || deps.runTheDiagnostician === undefined) {
    return Object.freeze({ due, ran: false });
  }
  try {
    await deps.runTheDiagnostician(facts);
    return Object.freeze({ due: true, ran: true });
  } catch (error) {
    return Object.freeze({
      due: true,
      ran: false,
      failed: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * F101-FR-014 and F101-FR-015 — the as-is event and line of one rejection, and
 * the as-is event and line of a MALFORMED verdict where the limit is on.
 */
export function rejectionRecordOf(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly kind: KindOfARejection;
  readonly rejectLimit: number;
  readonly malformedLimit: number;
  readonly streak: number;
}): RejectionRecord {
  const base = {
    event: rejectEvent(inputs.phase, inputs.ordinal),
    line: phaseRejected(inputs.phase, inputs.ordinal, inputs.rejectLimit),
  };
  if (inputs.kind !== "malformed" || !theMalformedLimitIsOn(inputs.malformedLimit)) {
    return Object.freeze(base);
  }
  return Object.freeze({
    ...base,
    malformedEvent: criticMalformedEvent(
      inputs.phase,
      inputs.ordinal,
      inputs.streak,
      inputs.malformedLimit,
    ),
    malformedLine: criticNoUsableVerdict(inputs.streak, inputs.malformedLimit),
  });
}
