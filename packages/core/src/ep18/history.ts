/**
 * T005 — the read-only history of a phase (feature 149, data-model.md,
 * "History of a phase"; F149-FR-002).
 *
 * `next` of `specstride.attempt-planner/1` is a pure function of the history of
 * the phase attempts of a phase (annex E §E.1, "Guarantees of a planner"). This
 * module builds that history from the four places data-model.md names and hands
 * it over FROZEN, so that a planner cannot write through it:
 *
 * | Source | Logical name (annex B §B.5) |
 * |---|---|
 * | the records of the phase attempts | `attempt:<N>:<k>:<n>:record` |
 * | the verdict records | `attempt:<N>:<k>:<n>:verdict` |
 * | the recovery markers | `phase:<N>:recovery-markers` |
 * | the ledger | `run:<runId>:ledger` |
 *
 * The module reads NO file. A core package reaches files and processes through
 * the kernel and the ports of the edge packages only (F100-FR-012,
 * F100-FR-234), so the engine reads the four places and hands the records in.
 * The records of the phase attempts and the verdict records have no schema of
 * their own in Wave 1 — the first part of the split of 101 owns them — so the
 * input types below are structural and name only the fields the history reads.
 *
 * Two fields are facts the engine puts in and the history never works out:
 * `diagnosisMade` and `accelerationDue` belong to the owner of the recovery
 * cycle (data-model.md: "a planner does not work them out again").
 */
import {
  ATTEMPT_KINDS,
  ATTEMPT_KIND_WHEN_UNKNOWN,
  VERDICTS,
  VERDICT_WHEN_UNKNOWN,
  type AttemptHistory,
  type AttemptKind,
  type Verdict,
} from "@specstride/contracts/ep/critic-strategy";
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";

/* ------------------------------------------------------------------ *
 * The four sources, by logical name.
 * ------------------------------------------------------------------ */

/** The four places the history is built from, by logical name (annex B §B.5). */
export const HISTORY_SOURCES = [
  "attempt:<N>:<k>:<n>:record",
  "attempt:<N>:<k>:<n>:verdict",
  "phase:<N>:recovery-markers",
  "run:<runId>:ledger",
] as const;

/** The logical name of the ledger, whose namespace `core` holds the counts. */
export const LEDGER_LOGICAL_NAME = "run:<runId>:ledger" as const;

/** The namespace of the ledger the counts of the core live in (§B.13). */
export const CORE_NAMESPACE = "core" as const;

/**
 * The count of rejections by the critic, which this feature appends to the
 * counters of the ledger through the engine (data-model.md, "What the seams
 * read and return"). It is kept per phase (F149-FR-004).
 */
export const CRITIC_REJECTIONS_COUNTER = "criticRejections" as const;

/**
 * The three counts data-model.md names for the history: the reject count, the
 * MALFORMED streak and the rejections by the critic. A count the ledger does
 * not hold is 0, never absent, so a planner never reads `undefined`.
 */
export const HISTORY_COUNTERS = [
  "rejectCount",
  "malformedStreak",
  CRITIC_REJECTIONS_COUNTER,
] as const;

/**
 * True when the layout of annex B §B.5 holds every one of the four sources.
 * The check is a function and not a load-time assertion: a module of the core
 * refuses nothing at import time.
 */
export function historySourcesAreNamedByTheLayout(): boolean {
  return HISTORY_SOURCES.every((name) => holdsLogicalName(name));
}

/* ------------------------------------------------------------------ *
 * What the engine hands in.
 * ------------------------------------------------------------------ */

/**
 * One record of a phase attempt, `attempt:<N>:<k>:<n>:record` ("Kind, strategy,
 * session directive, outcome"). Only the fields the history reads are named.
 */
export type AttemptRecordOfTheHistory = {
  /** The ordinal of the engine start, `<k>` of the logical name. */
  readonly engineStartOrdinal: number;
  /** The ordinal of the phase attempt, `<n>` of the logical name. */
  readonly attemptOrdinal: number;
  /** The kind of the phase attempt; an unknown kind is read as `plain`. */
  readonly kind: string;
  /** The outcome of the phase attempt, as the record carries it. */
  readonly outcome: string;
  /** The model tier the phase attempt ran on, where the record carries it. */
  readonly modelTier?: string;
};

/**
 * One verdict record, `attempt:<N>:<k>:<n>:verdict`. Only the fields the
 * history reads are named; the nonce and its hash are never read here.
 */
export type VerdictRecordOfTheHistory = {
  readonly engineStartOrdinal: number;
  readonly attemptOrdinal: number;
  /** APPROVED, REJECTED or MALFORMED; an unknown verdict is MALFORMED (§E.1). */
  readonly verdict: string;
  /** The unmet criteria of the verdict, where it carries them. */
  readonly unmetCriteria?: readonly string[];
  /**
   * The signature of the unmet criteria, where the owner of the recovery cycle
   * computed one. It wins over the plain signature of `unmetCriteria`.
   */
  readonly unmetCriteriaSignature?: string;
};

/** The recovery markers, `phase:<N>:recovery-markers`. */
export type RecoveryMarkersOfTheHistory = {
  /** The signatures for which a diagnosis was made. */
  readonly diagnosed?: readonly string[];
  /** The signatures for which an acceleration was made. */
  readonly accelerated?: readonly string[];
};

/** One record of the ledger, `run:<runId>:ledger`, as the history reads it. */
export type LedgerRecordOfTheHistory = {
  /** Position in the ledger, from 1, without gaps (§B.13). */
  readonly seq: number;
  /** The namespace: `core` or the id of a loop layer. */
  readonly ns: string;
  /** The phase the record belongs to, where it carries one. */
  readonly phase?: number | string | undefined;
  /** The counts as they stand after this record. */
  readonly counters?: Readonly<Record<string, unknown>> | undefined;
};

/** Everything the engine hands in to build the history of one phase. */
export type PhaseHistorySources = {
  /** The phase number. */
  readonly phase: number;
  /** The records of the phase attempts of the phase. */
  readonly attemptRecords: readonly AttemptRecordOfTheHistory[];
  /** The verdict records of the phase attempts of the phase. */
  readonly verdictRecords: readonly VerdictRecordOfTheHistory[];
  /** The recovery markers of the phase, or none. */
  readonly recoveryMarkers?: RecoveryMarkersOfTheHistory | null | undefined;
  /** The ledger of the run; records of another namespace or phase are ignored. */
  readonly ledger: readonly LedgerRecordOfTheHistory[];
  /** The model tier of the role plan, which a phase attempt starts on. */
  readonly baseModelTier: string;
  /** Whether a hint of the phase exists. */
  readonly hintExists: boolean;
  /** Whether feedback of the phase exists. */
  readonly feedbackExists: boolean;
  /** A fact of the owner of the recovery cycle; never worked out here. */
  readonly diagnosisMade: boolean;
  /** A fact of the owner of the recovery cycle; never worked out here. */
  readonly accelerationDue: boolean;
};

/* ------------------------------------------------------------------ *
 * The history.
 * ------------------------------------------------------------------ */

/** One phase attempt of the history (data-model.md, field `attempts`). */
export type AttemptInHistory = {
  /** The ordinal of the engine start, `<k>`. */
  readonly engineStartOrdinal: number;
  /** The ordinal of the phase attempt, `<n>`; the list is in this order. */
  readonly attemptOrdinal: number;
  /** The kind, from the closed set of row 9 of annex X §X.6. */
  readonly kind: AttemptKind;
  /** The outcome of the phase attempt. */
  readonly outcome: string;
  /** The verdict, or none where the phase attempt has no verdict record. */
  readonly verdict: Verdict | null;
  /** The signature of the unmet criteria, or none. */
  readonly unmetCriteriaSignature: string | null;
  /** The model tier the phase attempt ran on. */
  readonly modelTier: string;
};

/** The recovery markers of the history (data-model.md, field `markers`). */
export type MarkersInHistory = {
  readonly diagnosed: readonly string[];
  readonly accelerated: readonly string[];
};

/**
 * The read-only history of a phase (data-model.md, "History of a phase"). Every
 * value of it is frozen, at every depth.
 */
export type PhaseHistory = {
  readonly phase: number;
  readonly attempts: readonly AttemptInHistory[];
  readonly counters: Readonly<Record<string, number>>;
  readonly markers: MarkersInHistory;
  readonly hintExists: boolean;
  readonly feedbackExists: boolean;
  readonly diagnosisMade: boolean;
  readonly accelerationDue: boolean;
  /** Whether the phase was bumped (data-model.md, "State of the bump of a phase"). */
  readonly bumped: boolean;
};

/* ------------------------------------------------------------------ *
 * Reading the values of the closed sets.
 * ------------------------------------------------------------------ */

/** Row 9 of annex X §X.6 — an unknown kind of phase attempt is `plain`. */
export function attemptKindOf(value: unknown): AttemptKind {
  return typeof value === "string" && (ATTEMPT_KINDS as readonly string[]).includes(value)
    ? (value as AttemptKind)
    : ATTEMPT_KIND_WHEN_UNKNOWN;
}

/** Row 8 of annex X §X.6 — an unknown verdict is MALFORMED (§E.1). */
export function verdictOf(value: unknown): Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value)
    ? (value as Verdict)
    : VERDICT_WHEN_UNKNOWN;
}

/**
 * The plain signature of a set of unmet criteria: the ids, de-duplicated,
 * sorted and joined with a comma. It is a pure function of the ids and makes no
 * hash. Where the owner of the recovery cycle computed its own signature, the
 * verdict record carries it in `unmetCriteriaSignature` and that one is used.
 */
export function signatureOfUnmetCriteria(unmetCriteria: readonly string[]): string {
  return [...new Set(unmetCriteria)].sort().join(",");
}

/* ------------------------------------------------------------------ *
 * Freezing, at every depth.
 * ------------------------------------------------------------------ */

/** Freeze a value and everything it holds. Cycles are visited once. */
export function freezeDeep<T>(value: T, seen: Set<unknown> = new Set()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) freezeDeep(inner, seen);
  return Object.freeze(value);
}

/**
 * True when the value and everything it holds are frozen. The test of the
 * purity of a planner reads the history through this, so that "read-only" is
 * observed and not merely declared.
 */
export function isReadOnlyDeeply(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every((inner) =>
    isReadOnlyDeeply(inner, seen),
  );
}

/* ------------------------------------------------------------------ *
 * Building it.
 * ------------------------------------------------------------------ */

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);

/** The phase of a ledger record, as a number where it carries one. */
function phaseOfLedgerRecord(record: LedgerRecordOfTheHistory): number | undefined {
  const phase = record.phase;
  if (isWholeNumber(phase)) return phase;
  if (typeof phase === "string" && /^\d+$/.test(phase)) return Number(phase);
  return undefined;
}

/**
 * The counts of the history: those of the newest record of the namespace `core`
 * that carries counters and that belongs to this phase, or carries no phase.
 * A record of a loop layer's namespace is never read — a loop layer changes no
 * count of the phase gate (F149-FR-007). Every count of `HISTORY_COUNTERS` is
 * present; a count the ledger does not hold is 0.
 */
export function countersOfThePhase(
  ledger: readonly LedgerRecordOfTheHistory[],
  phase: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of HISTORY_COUNTERS) out[name] = 0;
  const candidates = [...ledger]
    .filter((record) => record.ns === CORE_NAMESPACE && record.counters !== undefined)
    .filter((record) => {
      const of = phaseOfLedgerRecord(record);
      return of === undefined || of === phase;
    })
    .sort((a, b) => a.seq - b.seq);
  const newest = candidates[candidates.length - 1];
  if (newest !== undefined && newest.counters !== undefined) {
    for (const [name, value] of Object.entries(newest.counters)) {
      if (isWholeNumber(value)) out[name] = value;
    }
  }
  return out;
}

/** The key of a phase attempt: the two ordinals of its logical name. */
const keyOf = (engineStartOrdinal: number, attemptOrdinal: number): string =>
  `${engineStartOrdinal}:${attemptOrdinal}`;

/**
 * Build the read-only history of one phase. The result is frozen at every
 * depth, so a planner that is handed it can read it and nothing else
 * (F149-FR-002; annex E §E.1, "Guarantees of a planner").
 *
 * The phase attempts come out in the order of the ordinals — by the ordinal of
 * the engine start first, then by the ordinal of the phase attempt — so that a
 * planner that reads "the last phase attempt" reads the same one whatever order
 * the engine read the records in.
 */
export function buildPhaseHistory(sources: PhaseHistorySources): PhaseHistory {
  const verdicts = new Map<string, VerdictRecordOfTheHistory>();
  for (const record of sources.verdictRecords) {
    verdicts.set(keyOf(record.engineStartOrdinal, record.attemptOrdinal), record);
  }

  const attempts: AttemptInHistory[] = [...sources.attemptRecords]
    .sort((a, b) =>
      a.engineStartOrdinal !== b.engineStartOrdinal
        ? a.engineStartOrdinal - b.engineStartOrdinal
        : a.attemptOrdinal - b.attemptOrdinal,
    )
    .map((record) => {
      const verdictRecord = verdicts.get(keyOf(record.engineStartOrdinal, record.attemptOrdinal));
      let signature: string | null = null;
      if (verdictRecord !== undefined) {
        if (
          typeof verdictRecord.unmetCriteriaSignature === "string" &&
          verdictRecord.unmetCriteriaSignature.length > 0
        ) {
          signature = verdictRecord.unmetCriteriaSignature;
        } else if (
          verdictRecord.unmetCriteria !== undefined &&
          verdictRecord.unmetCriteria.length > 0
        ) {
          signature = signatureOfUnmetCriteria(verdictRecord.unmetCriteria);
        }
      }
      return {
        engineStartOrdinal: record.engineStartOrdinal,
        attemptOrdinal: record.attemptOrdinal,
        kind: attemptKindOf(record.kind),
        outcome: record.outcome,
        verdict: verdictRecord === undefined ? null : verdictOf(verdictRecord.verdict),
        unmetCriteriaSignature: signature,
        modelTier:
          typeof record.modelTier === "string" && record.modelTier.length > 0
            ? record.modelTier
            : sources.baseModelTier,
      };
    });

  const markers = sources.recoveryMarkers ?? null;
  const history: PhaseHistory = {
    phase: sources.phase,
    attempts,
    counters: countersOfThePhase(sources.ledger, sources.phase),
    markers: {
      diagnosed: [...(markers?.diagnosed ?? [])],
      accelerated: [...(markers?.accelerated ?? [])],
    },
    hintExists: sources.hintExists,
    feedbackExists: sources.feedbackExists,
    diagnosisMade: sources.diagnosisMade,
    accelerationDue: sources.accelerationDue,
    // "State of the bump of a phase": a phase is bumped once a phase attempt of
    // the kind `bumped` was made, and stays so until the phase is approved or
    // the counts are reset — both of which end this phase's history.
    bumped: attempts.some((attempt) => attempt.kind === "bumped"),
  };
  return freezeDeep(history);
}

/**
 * The history as the seam takes it: the input type of `next` of
 * `specstride.attempt-planner/1` (`@specstride/contracts/ep/critic-strategy`,
 * `AttemptHistory`). The projection carries the verdicts and the signatures of
 * the phase attempts that have one, the counts of the ledger and the two facts
 * the engine worked out. It is frozen like the history it comes from.
 */
export function attemptHistoryOf(history: PhaseHistory): AttemptHistory {
  return freezeDeep({
    verdicts: history.attempts
      .map((attempt) => attempt.verdict)
      .filter((verdict): verdict is Verdict => verdict !== null),
    unmetCriteriaSignatures: history.attempts
      .map((attempt) => attempt.unmetCriteriaSignature)
      .filter((signature): signature is string => signature !== null),
    countsFromTheLedger: { ...history.counters },
    diagnosisWasMadeForTheNewestSignature: history.diagnosisMade,
    anAcceleratedPhaseAttemptIsDue: history.accelerationDue,
  });
}

/** The newest signature of unmet criteria of the phase, or none. */
export function newestUnmetCriteriaSignature(history: PhaseHistory): string | null {
  for (let i = history.attempts.length - 1; i >= 0; i -= 1) {
    const signature = (history.attempts[i] as AttemptInHistory).unmetCriteriaSignature;
    if (signature !== null) return signature;
  }
  return null;
}
