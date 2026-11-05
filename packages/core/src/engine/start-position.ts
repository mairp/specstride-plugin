/**
 * T036 of feature 101 — the start position of a run (F101-FR-002).
 *
 * Three rules, and nothing else:
 *
 *  1. The engine DERIVES the phase at which a run starts from the records on
 *     disk: the FIRST phase of the specification that has no approval record
 *     that VERIFIES (F101-FR-031, `../approval/verify.ts`). It consults NO
 *     stored counter for the position (B-0271).
 *  2. An explicit start phase given by the consumer REPLACES the derived
 *     phase, WITHOUT validation against the specification or the approval
 *     records.
 *  3. From the start phase on, every phase runs in the order of the
 *     specification WITHOUT checking approval records, so a later phase that
 *     is already approved is run again, as at the baseline.
 *
 * The approvals are read through `VerifiedApprovalReader`, so the position can
 * never rest on a record that failed its bindings or on a bare marker
 * (threat T-02). Every failure the reader reports is handed back with the
 * position, because the caller emits the integrity events.
 */
import type { ApprovalIntegrityEvent, VerifiedApprovalReader } from "../approval/verify.ts";

/** F101-FR-002 — no stored counter is consulted for the position (B-0271). */
export const THE_POSITION_CONSULTS_A_STORED_COUNTER = false as const;

/** F101-FR-002 — the explicit start phase is NOT validated. */
export const AN_EXPLICIT_START_PHASE_IS_VALIDATED = false as const;

/**
 * F101-FR-002 — from the start phase on, approval records are NOT consulted,
 * so an already approved later phase is run again, as at the baseline.
 */
export const PHASES_AFTER_THE_START_ARE_CHECKED_FOR_APPROVAL = false as const;

/** Where a start phase came from. */
export const ORIGINS = ["derived", "given-by-the-consumer"] as const;
export type StartPositionOrigin = (typeof ORIGINS)[number];

/** What the engine hands in to work out where a run starts. */
export type StartPositionInputs = {
  /** The phase numbers of the specification, in its order. */
  readonly phases: readonly number[];
  /** The reader of approval records; every read goes through F101-FR-031. */
  readonly readApproval: VerifiedApprovalReader;
  /** The start phase the consumer gave, where one was given. */
  readonly startPhaseGivenByTheConsumer?: number | undefined;
};

/** Where a run starts, and what it runs from there. */
export type StartPosition = {
  /**
   * The phase the run starts at, or `undefined` on the path "every phase was
   * approved before" (F101-FR-003), which only the DERIVED position can take.
   */
  readonly startPhase: number | undefined;
  readonly origin: StartPositionOrigin;
  /** Every phase from the start phase on, in the order of the specification. */
  readonly phasesToRun: readonly number[];
  /** True where every phase of the specification was approved before. */
  readonly everyPhaseWasApprovedBefore: boolean;
  /** The phases whose approval record verified, as the derivation read them. */
  readonly approvedBefore: readonly number[];
  /** The integrity events the reads raised, in the order of the phases. */
  readonly integrityEvents: readonly ApprovalIntegrityEvent[];
};

/**
 * The first phase of the specification with no approval record that verifies,
 * and the integrity events the reads raised on the way. `undefined` means
 * every phase is approved.
 */
export function firstPhaseWithoutAVerifiedApproval(
  phases: readonly number[],
  readApproval: VerifiedApprovalReader,
): {
  readonly phase: number | undefined;
  readonly approvedBefore: readonly number[];
  readonly integrityEvents: readonly ApprovalIntegrityEvent[];
} {
  const approvedBefore: number[] = [];
  const integrityEvents: ApprovalIntegrityEvent[] = [];
  for (const phase of phases) {
    const read = readApproval(phase);
    if (read.approved) {
      approvedBefore.push(phase);
      continue;
    }
    // A record that fails, a missing record and a bare marker each raise an
    // integrity event that names the phase and what failed (F101-FR-031).
    integrityEvents.push(read.integrityEvent);
    return {
      phase,
      approvedBefore: Object.freeze([...approvedBefore]),
      integrityEvents: Object.freeze([...integrityEvents]),
    };
  }
  return {
    phase: undefined,
    approvedBefore: Object.freeze([...approvedBefore]),
    integrityEvents: Object.freeze([]),
  };
}

/**
 * F101-FR-002 — the start position of a run.
 *
 * The derivation runs in EVERY case, because its integrity events must be
 * emitted whether or not the consumer gave a start phase; the given phase then
 * replaces the derived one without validation.
 */
export function startPosition(inputs: StartPositionInputs): StartPosition {
  const derived = firstPhaseWithoutAVerifiedApproval(inputs.phases, inputs.readApproval);
  const given = inputs.startPhaseGivenByTheConsumer;
  const everyPhaseWasApprovedBefore = derived.phase === undefined;

  if (given !== undefined) {
    // No validation: a phase outside the specification is taken as it stands,
    // and `phasesToRun` is simply every phase of the specification from it on,
    // which is empty where the number lies past the last phase.
    return Object.freeze({
      startPhase: given,
      origin: "given-by-the-consumer" as const,
      phasesToRun: phasesFrom(inputs.phases, given),
      everyPhaseWasApprovedBefore: false,
      approvedBefore: derived.approvedBefore,
      integrityEvents: derived.integrityEvents,
    });
  }

  return Object.freeze({
    startPhase: derived.phase,
    origin: "derived" as const,
    phasesToRun:
      derived.phase === undefined ? Object.freeze([]) : phasesFrom(inputs.phases, derived.phase),
    everyPhaseWasApprovedBefore,
    approvedBefore: derived.approvedBefore,
    integrityEvents: derived.integrityEvents,
  });
}

/**
 * Every phase of the specification from `start` on, in the order of the
 * specification. Approval records are not consulted here at all: that is the
 * third rule of F101-FR-002.
 */
export function phasesFrom(phases: readonly number[], start: number): readonly number[] {
  return Object.freeze(phases.filter((phase) => phase >= start));
}

/* ==================================================================== *
 * T075 — the read sites of an approval (F101-FR-031, F101-FR-002).
 *
 * F101-FR-031 names FOUR places at which the engine reads whether a phase is
 * approved: "when it derives the start phase, at `resume`, at a relaunch, at
 * phase entry". Every one of them MUST go through the verification of T074.
 *
 * The four are gathered here as data, and the three that derive a position go
 * through the ONE function `startPositionAt`, so a new entry path cannot read
 * an approval any other way: there is no second derivation to add it to. The
 * fourth, phase entry, is in `./phase.ts`, which is the module that enters a
 * phase.
 * ==================================================================== */

/** F101-FR-031 — the four sites at which the engine reads an approval. */
export const APPROVAL_READ_SITES = ["start-position", "resume", "relaunch", "phase-entry"] as const;
export type ApprovalReadSite = (typeof APPROVAL_READ_SITES)[number];

/** F101-FR-031 — every one of them reads through the verification of T074. */
export const EVERY_READ_SITE_VERIFIES_THE_RECORD = true as const;

/** The site that is NOT here, and the module that owns it. */
export const THE_SITE_OF_PHASE_ENTRY_IS_IN = "./phase.ts" as const;

/** The three sites that derive a start position. */
export const SITES_THAT_DERIVE_A_POSITION = ["start-position", "resume", "relaunch"] as const;
export type SiteThatDerivesAPosition = (typeof SITES_THAT_DERIVE_A_POSITION)[number];

/**
 * The reason of the launch record of feature 100 annex B §B.7
 * (`specstride.launch/1`, field `reason`), which is what tells a first start,
 * a `resume` and a relaunch apart. The literals are that closed set; they are
 * declared here rather than imported, because the generated record type is
 * exported under no subpath of `@specstride/contracts`, and the test of T071
 * pins them against the schema so the two cannot drift.
 */
export const LAUNCH_REASONS = ["first", "resume", "relaunch", "manual"] as const;
export type LaunchReason = (typeof LAUNCH_REASONS)[number];

/**
 * Which read site a launch reason enters by. `first` and `manual` derive the
 * position as a fresh start does; `resume` and `relaunch` are their own sites,
 * because F101-FR-031 names them, and the records they read are the same ones.
 */
export const SITE_OF_A_LAUNCH_REASON: Readonly<Record<LaunchReason, SiteThatDerivesAPosition>> =
  Object.freeze({
    first: "start-position",
    resume: "resume",
    relaunch: "relaunch",
    manual: "start-position",
  });

/** The site a launch reason enters by; an unknown reason is a fresh start. */
export function siteOfTheLaunchReason(reason: string | undefined): SiteThatDerivesAPosition {
  if (reason !== undefined && (LAUNCH_REASONS as readonly string[]).includes(reason)) {
    return SITE_OF_A_LAUNCH_REASON[reason as LaunchReason];
  }
  return "start-position";
}

/** A start position with the read site that derived it. */
export type StartPositionAtASite = StartPosition & {
  /** Which of the three sites of F101-FR-031 this derivation is. */
  readonly site: SiteThatDerivesAPosition;
};

/**
 * F101-FR-002 and F101-FR-031 — the start position at ONE of the three sites
 * that derive it. `resume` and a relaunch read the SAME verified records as a
 * first start and derive the same position from them: nothing of the position
 * is stored, so there is nothing a resume could trust that a first start
 * could not (B-0271).
 *
 * The site is carried on the result so that the integrity events of a resume
 * can be told from those of a first start by a reader of the event stream,
 * without a second code path that could drift.
 */
export function startPositionAt(
  site: SiteThatDerivesAPosition,
  inputs: StartPositionInputs,
): StartPositionAtASite {
  return Object.freeze({ ...startPosition(inputs), site });
}
