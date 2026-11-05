/**
 * T083 of feature 101 — the recovery markers (F101-FR-021, F101-FR-024).
 *
 * The recovery cycle rests on TWO SIGNATURES kept per phase, and on nothing
 * else:
 *
 * | Marker | Written | Read by |
 * |---|---|---|
 * | `diagnosed` | AFTER every call of the diagnostician, whether the call succeeded or wrote a hint (B-0173) | the rule of the diagnostician (F101-FR-021) and the rule of an accelerated phase attempt (F101-FR-024) |
 * | `accelerated` | BEFORE the pass of an accelerated phase attempt starts (B-0179) | the rule of an accelerated phase attempt |
 *
 * Both are written at the moment the requirement names, and that moment is what
 * makes the cycle run at most once per signature:
 *
 *  - the diagnostician records the signature AFTER the call, so a call that
 *    failed still closes that signature and no second diagnosis follows it;
 *  - the accelerator records the signature BEFORE the pass, so an INTERRUPTED
 *    accelerated phase attempt is never repeated for the same signature.
 *
 * The record is `phase:<N>:recovery-markers` (`specstride.recovery-markers/1`,
 * `data-model.md`, "Recovery markers"), and it is removed at the approval of
 * the phase (B-0185), which step 2 of the order after an approval does
 * (`../post-approval/order.ts`). This module holds no I/O: the engine reads and
 * writes the record through the single writer of the phase gate
 * (`../gate/writers.ts`, F101-FR-028).
 *
 * The baseline kept the two signatures in two files, `gates/.diagnosed-phase<N>`
 * and `gates/.accelerated-phase<N>`; their names are held here for the
 * compatibility projection and are never the truth the engine reads.
 */
import {
  LOGICAL_NAME,
  MARKERS,
  SCHEMA_ID,
  signatureOf,
  type Marker,
  type RecoveryMarkers,
} from "@specstride/contracts/records/recovery-markers";

export { LOGICAL_NAME, MARKERS, SCHEMA_ID, signatureOf };
export type { Marker, RecoveryMarkers };

/** B-0185 — the markers of a phase are removed at the approval of the phase. */
export const REMOVED_AT_APPROVAL = true as const;

/** The as-is file names of the two markers (B-0173, B-0179). */
export const AS_IS_MARKER_FILES = Object.freeze({
  diagnosed: (phase: number): string => `gates/.diagnosed-phase${phase}`,
  accelerated: (phase: number): string => `gates/.accelerated-phase${phase}`,
});

/* ------------------------------------------------------------------ *
 * The record itself.
 * ------------------------------------------------------------------ */

/** The markers of a phase that has seen neither a diagnosis nor an acceleration. */
export function emptyMarkers(phase: number): RecoveryMarkers {
  return Object.freeze({
    schema: SCHEMA_ID,
    phase,
    diagnosed: null,
    accelerated: null,
  }) as RecoveryMarkers;
}

/** The markers of a phase, with the signatures a caller already holds. */
export function recoveryMarkers(
  phase: number,
  signatures: {
    readonly diagnosed?: string | null | undefined;
    readonly accelerated?: string | null | undefined;
  } = {},
): RecoveryMarkers {
  return Object.freeze({
    schema: SCHEMA_ID,
    phase,
    diagnosed: signatures.diagnosed ?? null,
    accelerated: signatures.accelerated ?? null,
  }) as RecoveryMarkers;
}

/**
 * B-0173 — the signature recorded as diagnosed, written AFTER every call of
 * the diagnostician. The earlier value is OVERWRITTEN, never appended to: one
 * signature stands as diagnosed per phase.
 */
export function markersAfterADiagnosis(
  markers: RecoveryMarkers,
  signature: string,
): RecoveryMarkers {
  return recoveryMarkers(markers.phase, {
    diagnosed: signature,
    accelerated: markers.accelerated,
  });
}

/** B-0179 — the signature recorded as accelerated, written BEFORE the pass. */
export function markersBeforeAnAcceleratedPhaseAttempt(
  markers: RecoveryMarkers,
  signature: string,
): RecoveryMarkers {
  return recoveryMarkers(markers.phase, {
    diagnosed: markers.diagnosed,
    accelerated: signature,
  });
}

/** F101-FR-021 — the signature is recorded whether or not the call wrote a hint. */
export const THE_SIGNATURE_IS_RECORDED_AFTER_A_FAILED_CALL = true as const;

/** F101-FR-024 — the signature is recorded BEFORE the pass of the attempt. */
export const THE_SIGNATURE_IS_RECORDED_BEFORE_THE_PASS = true as const;

/* ------------------------------------------------------------------ *
 * The two switches (B-0070, B-0072).
 * ------------------------------------------------------------------ */

/**
 * The as-is literal that means TRUE for both switches. Any OTHER literal
 * disables the step, which is the baseline's reading of both environment
 * variables (B-0070, B-0072) and what F101-FR-021 and F101-FR-024 state.
 */
export const AS_IS_LITERAL_THAT_MEANS_TRUE = "true" as const;

/** The as-is names of the two switches, for the compatibility projection. */
export const AS_IS_SWITCHES = Object.freeze({
  diagnostician: "SPECSTRIDE_DIAGNOSTICIAN",
  accelerator: "SPECSTRIDE_ACCELERATOR",
});

/** Both steps are ENABLED by default (F101-FR-021, F101-FR-024). */
export const DIAGNOSTICIAN_DEFAULT_ON = true as const;
export const ACCELERATOR_DEFAULT_ON = true as const;

/**
 * Whether a switch of the recovery cycle is on: the default where the consumer
 * set nothing, the literal that means true where it stands, and off for every
 * other literal.
 */
export function theSwitchIsOn(configured: string | undefined | null): boolean {
  if (configured === undefined || configured === null) return true;
  return configured === AS_IS_LITERAL_THAT_MEANS_TRUE;
}

/** F101-FR-021 — whether the diagnostician is enabled. */
export function theDiagnosticianIsEnabled(configured?: string | undefined | null): boolean {
  return theSwitchIsOn(configured);
}

/** F101-FR-024 — whether the accelerator is enabled. */
export function theAcceleratorIsEnabled(configured?: string | undefined | null): boolean {
  return theSwitchIsOn(configured);
}

/* ------------------------------------------------------------------ *
 * F101-FR-021 — when the diagnostician runs.
 * ------------------------------------------------------------------ */

/** The three conditions of F101-FR-021, in the order of the requirement. */
export const CONDITIONS_OF_A_DIAGNOSIS = Object.freeze([
  "the diagnostician is enabled",
  "feedback of the phase exists",
  "the signature of that feedback differs from the signature recorded as diagnosed",
]);

/** What the rule of the diagnostician is told (F101-FR-021). */
export type DiagnosisDueFacts = {
  /** Whether the diagnostician is enabled (the switch of B-0070). */
  readonly enabled: boolean;
  /** Whether feedback of the phase exists at all. */
  readonly feedbackExists: boolean;
  /** The signature of unmet criteria of that feedback. */
  readonly signature: string | undefined;
  /** The markers of the phase as they now stand. */
  readonly markers: RecoveryMarkers;
};

/**
 * F101-FR-021 — the diagnostician runs after a rejection only when it is
 * enabled, feedback of the phase exists, and the signature of that feedback
 * DIFFERS from the signature recorded for the phase as diagnosed (B-0282).
 *
 * An empty signature is no signature: feedback that gives none cannot open a
 * diagnosis, because there would be nothing to record and the next rejection
 * would open it again.
 */
export function aDiagnosisIsDue(facts: DiagnosisDueFacts): boolean {
  if (!facts.enabled) return false;
  if (!facts.feedbackExists) return false;
  const signature = facts.signature;
  if (signature === undefined || signature === "") return false;
  return signature !== signatureOf(facts.markers, "diagnosed");
}

/** F101-FR-021 — at most one call of the diagnostician per signature and phase. */
export const CALLS_PER_SIGNATURE_AND_PHASE = 1 as const;

/* ------------------------------------------------------------------ *
 * F101-FR-024 — when an accelerated phase attempt is due.
 * ------------------------------------------------------------------ */

/** The five conditions of F101-FR-024, in the order of the requirement. */
export const CONDITIONS_OF_AN_ACCELERATED_PHASE_ATTEMPT = Object.freeze([
  "the accelerator is enabled",
  "the phase attempt before it in this engine start was not accelerated",
  "a hint of the phase exists",
  "feedback of the phase exists",
  "the signature recorded as diagnosed is not empty and differs from the signature recorded as accelerated",
]);

/** What the rule of an accelerated phase attempt is told (F101-FR-024). */
export type AccelerationDueFacts = {
  /** Whether the accelerator is enabled (the switch of B-0072). */
  readonly enabled: boolean;
  /**
   * Whether the phase attempt BEFORE this one IN THIS ENGINE START was an
   * accelerated one. The memory is per engine start, as at the baseline
   * (B-0308): after a resume the first phase attempt may be an accelerated one
   * again, held back only by the marker.
   */
  readonly theAttemptBeforeWasAccelerated: boolean;
  /** Whether a hint of the phase exists. */
  readonly hintExists: boolean;
  /** Whether feedback of the phase exists. */
  readonly feedbackExists: boolean;
  readonly markers: RecoveryMarkers;
};

/**
 * F101-FR-024 — an accelerated phase attempt is due only when all five
 * conditions hold (B-0284).
 */
export function anAcceleratedPhaseAttemptIsDue(facts: AccelerationDueFacts): boolean {
  if (!facts.enabled) return false;
  if (facts.theAttemptBeforeWasAccelerated) return false;
  if (!facts.hintExists) return false;
  if (!facts.feedbackExists) return false;
  const diagnosed = signatureOf(facts.markers, "diagnosed");
  if (diagnosed === undefined || diagnosed === "") return false;
  return diagnosed !== signatureOf(facts.markers, "accelerated");
}

/** F101-FR-024 — at most one accelerated phase attempt per diagnosed signature. */
export const ACCELERATED_ATTEMPTS_PER_SIGNATURE = 1 as const;

/**
 * F101-FR-024 — the memory of WHAT THE PHASE ATTEMPT BEFORE WAS is kept as the
 * ledger keeps counts: per phase, in the ledger of the run, under the count
 * `kindOfThePhaseAttemptBefore` (`data-model.md`, "Counts of the phase gate").
 * It is therefore reset where the counts are reset and at the approval of the
 * phase, and it is NOT part of the markers: the markers hold signatures.
 */
export const THE_MEMORY_OF_THE_ATTEMPT_BEFORE_IS_KEPT = "as the ledger keeps counts" as const;

/** The name of that count in the ledger (namespace `core`). */
export const COUNT_OF_THE_ATTEMPT_BEFORE = "kindOfThePhaseAttemptBefore" as const;

/** The kind of a phase attempt that the rule of F101-FR-024 looks for. */
export const ACCELERATED_KIND = "accelerated" as const;

/** True when the kind the ledger holds for the phase attempt before is that one. */
export function theAttemptBeforeWasAccelerated(kind: string | undefined | null): boolean {
  return kind === ACCELERATED_KIND;
}
