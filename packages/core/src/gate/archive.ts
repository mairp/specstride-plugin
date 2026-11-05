/**
 * T067 of feature 101 — the archive of a rejected phase attempt, with the
 * suffix rule (F101-FR-027).
 *
 * Archiving a phase attempt does four things, and the order of the first two
 * carries the requirement:
 *
 *  1. the PHASE EVIDENCE is MOVED out of the place where the proposer delivers
 *     it, so that stale phase evidence can never end the next pass loop;
 *  2. the FEEDBACK, the HINT, the ACCELERATION NOTE and the newest VERDICT
 *     RECORD of the phase attempt are kept WITH it — copied, not moved,
 *     because the first three must stay available to the next phase attempt
 *     (F101-FR-027, F101-FR-022, F101-FR-025);
 *  3. where the place of the archive already EXISTS, the as-is suffix rule
 *     applies and nothing is overwritten (B-0292);
 *  4. the as-is event of the archive is emitted, with the phase, the ordinal
 *     and the place (B-0090).
 *
 * The LAST phase attempt of a halt by the reject limit is NOT archived: its
 * phase evidence and its feedback stay in place and are set aside at the next
 * start of the phase under the label of a resume (F101-FR-014, B-0336,
 * B-0307). This module therefore never decides WHETHER to archive; the handler
 * of the order after a rejection does (`./limits.ts`).
 *
 * This module holds no file-system module of its own: it reaches the tree
 * through the port of `../approval/gate-tree.ts`, which the composition root
 * implements over the kernel (F100-FR-012, F100-FR-234).
 */
import type { GateTree } from "../approval/gate-tree.ts";

/** F101-FR-027 — the phase evidence is MOVED and not copied. */
export const THE_PHASE_EVIDENCE_IS_MOVED = true as const;

/**
 * F101-FR-027 — what is kept with the phase evidence, in the order of the
 * requirement.
 */
export const RECORDS_KEPT_WITH_THE_PHASE_EVIDENCE = [
  "feedback",
  "hint",
  "acceleration note",
  "verdict record",
] as const;
export type RecordKeptWithThePhaseEvidence = (typeof RECORDS_KEPT_WITH_THE_PHASE_EVIDENCE)[number];

/**
 * F101-FR-027 — the three that MUST stay available to the next phase attempt.
 * They are therefore copied into the archive and left at their own place; the
 * verdict record of the phase attempt is copied as well, so that the archive
 * holds the whole of what the phase attempt produced.
 */
export const RECORDS_THAT_STAY_AVAILABLE_TO_THE_NEXT_PHASE_ATTEMPT = [
  "feedback",
  "hint",
  "acceleration note",
] as const;

/** F101-FR-027 — nothing in an existing archive is overwritten (B-0292). */
export const AN_EXISTING_ARCHIVE_IS_OVERWRITTEN = false as const;

/** The as-is name of the event of the archive, and its fields (B-0090). */
export const AS_IS_EVENT_OF_THE_ARCHIVE = "attempt_archived" as const;
export const AS_IS_EVENT_FIELDS_OF_THE_ARCHIVE = ["phase", "attempt", "dir"] as const;

/* ------------------------------------------------------------------ *
 * The place of an archive, and the suffix rule.
 * ------------------------------------------------------------------ */

/** The segment that names the group of the archives of a phase (B-0176). */
export const ARCHIVE_GROUP = "attempts" as const;

/**
 * The LABEL of the archive of a phase attempt. It is the ordinal of the phase
 * attempt, and on a collision the ordinal with the as-is suffix (B-0292); the
 * label of leftover phase evidence set aside at phase entry is the as-is label
 * of a resume (B-0307, `../engine/phase.ts`).
 */
export function archiveLabel(ordinal: number): string {
  return String(ordinal);
}

/** B-0292 — the suffix an archive takes when its place already exists. */
export function archiveCollisionSuffix(asIsRunId: string): string {
  return `-${asIsRunId}`;
}

/**
 * The as-is place of the archive of one label, as the baseline names it and as
 * the as-is field `dir` of the event carries it (B-0176, B-0292): the group,
 * the phase and the label.
 */
export function attemptArchiveDirectory(phase: number, label: string): string {
  return `${ARCHIVE_GROUP}/phase${phase}/attempt${label}`;
}

/** The place of an archive, and whether the suffix rule had to be applied. */
export type ArchivePlace = {
  /** The label the archive went under: the ordinal, or the ordinal with the suffix. */
  readonly label: string;
  /** The as-is place, as the as-is field `dir` of the event carries it. */
  readonly asIsDirectory: string;
  /** True where the place of the ordinal stood and the suffix was applied. */
  readonly suffixApplied: boolean;
};

/**
 * F101-FR-027 and B-0292 — the place of the archive of a phase attempt. Where
 * the place of the ordinal already EXISTS, the as-is suffix rule applies: the
 * archive goes beside it under the as-is run id, and the history an earlier
 * run left is never overwritten.
 */
export function archivePlace(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly asIsRunId: string;
  /** True when the archive of that label already stands. */
  readonly archiveExists: (label: string) => boolean;
}): ArchivePlace {
  const plain = archiveLabel(inputs.ordinal);
  if (!inputs.archiveExists(plain)) {
    return Object.freeze({
      label: plain,
      asIsDirectory: attemptArchiveDirectory(inputs.phase, plain),
      suffixApplied: false,
    });
  }
  const label = `${plain}${archiveCollisionSuffix(inputs.asIsRunId)}`;
  return Object.freeze({
    label,
    asIsDirectory: attemptArchiveDirectory(inputs.phase, label),
    suffixApplied: true,
  });
}

/* ------------------------------------------------------------------ *
 * The archive itself.
 * ------------------------------------------------------------------ */

/** Where each record of the phase attempt stands now, as the caller knows it. */
export type RecordsOfThePhaseAttempt = {
  /** The place the proposer delivers the phase evidence at. */
  readonly phaseEvidence: string;
  /** The feedback of the phase attempt, where one was written. */
  readonly feedback?: string | undefined;
  /** The hint of the phase attempt, where a diagnosis wrote one. */
  readonly hint?: string | undefined;
  /** The acceleration note, where an accelerated phase attempt wrote one. */
  readonly accelerationNote?: string | undefined;
  /** The newest verdict record of the phase attempt, where a call was made. */
  readonly verdictRecord?: string | undefined;
};

/**
 * The place of each record INSIDE the archive, relative to its directory. The
 * archived phase evidence carries the logical name
 * `attempt:<N>:<k>:<n>:evidence` of feature 100 annex B §B.5, and the layout
 * of the consumer maps the directory; the names below are the tail of those
 * logical names, so an archive and the live records of a phase attempt agree.
 */
export const PLACE_INSIDE_THE_ARCHIVE = Object.freeze({
  "phase evidence": "gate/evidence.md",
  feedback: "feedback.md",
  hint: "hint.md",
  "acceleration note": "acceleration.md",
  "verdict record": "critic/verdict.json",
} as Readonly<Record<"phase evidence" | RecordKeptWithThePhaseEvidence, string>>);

/** The place of the archived phase evidence inside the archive. */
export const PHASE_EVIDENCE_FILE = PLACE_INSIDE_THE_ARCHIVE["phase evidence"];

/** What the archive of a phase attempt needs. */
export type ArchiveInputs = {
  readonly phase: number;
  readonly ordinal: number;
  /** The as-is run id, which names the suffix on a collision (B-0292). */
  readonly asIsRunId: string;
  /**
   * The DIRECTORY of the archive of a label, by the layout of the consumer. A
   * core package knows no path of the tree (F100-FR-012), so the composition
   * root maps the label of the archive to the place the layout gives it.
   */
  readonly directoryOfTheLabel: (label: string) => string;
  readonly records: RecordsOfThePhaseAttempt;
};

/** The operations of the tree the archive calls, and nothing more. */
export type ArchiveTree = Pick<GateTree, "join" | "makeDirectory" | "exists" | "move" | "copy">;

/** The as-is event of the archive, as the emitter receives it (B-0090). */
export type AttemptArchivedEvent = {
  readonly phase: number;
  readonly attempt: number;
  /** The as-is place of the archive, as the as-is field `dir` carries it. */
  readonly dir: string;
};

/** What the archive reports back. */
export type ArchiveOutcome = {
  /** The directory the archive went to, as the layout of the consumer gives it. */
  readonly directory: string;
  /** The label the archive went under: the ordinal, or the ordinal with the suffix. */
  readonly label: string;
  /** True where the place of the ordinal stood and the suffix rule applied. */
  readonly suffixApplied: boolean;
  /** The record that was MOVED, with its new place. */
  readonly moved: { readonly record: "phase evidence"; readonly to: string };
  /** Every record that was kept with it, in the order of the rule. */
  readonly kept: readonly {
    readonly record: RecordKeptWithThePhaseEvidence;
    readonly from: string;
    readonly to: string;
    /** False where the record already lay at its place inside the archive. */
    readonly copied: boolean;
  }[];
  /** The as-is event of the archive (B-0090). */
  readonly event: AttemptArchivedEvent;
};

/**
 * F101-FR-027 — archive one phase attempt.
 *
 * The phase evidence is moved FIRST, because that is the step the requirement
 * rests on: once it is gone from the place the proposer delivers it at, no
 * later pass loop can end on stale phase evidence. The records that are kept
 * with it are COPIED and left where they stand, so that the feedback, the hint
 * and the acceleration note stay available to the next phase attempt; a record
 * that already lies at its place inside the archive is left alone and is
 * reported with `copied: false`.
 *
 * A record the phase attempt does not have is skipped and is no error: a
 * rejected phase attempt that no diagnosis saw has no hint.
 */
export function archivePhaseAttempt(inputs: ArchiveInputs, tree: ArchiveTree): ArchiveOutcome {
  const place = archivePlace({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    asIsRunId: inputs.asIsRunId,
    archiveExists: (label) =>
      tree.exists(tree.join(inputs.directoryOfTheLabel(label), PHASE_EVIDENCE_FILE)),
  });
  const directory = inputs.directoryOfTheLabel(place.label);
  tree.makeDirectory(directory);

  // 1 — the phase evidence is MOVED out of the place the proposer delivers it.
  const evidenceTo = tree.join(directory, PHASE_EVIDENCE_FILE);
  tree.move(inputs.records.phaseEvidence, evidenceTo);

  // 2 — what is kept with it, in the order of the requirement.
  const kept: {
    record: RecordKeptWithThePhaseEvidence;
    from: string;
    to: string;
    copied: boolean;
  }[] = [];
  const sources: Readonly<Record<RecordKeptWithThePhaseEvidence, string | undefined>> = {
    feedback: inputs.records.feedback,
    hint: inputs.records.hint,
    "acceleration note": inputs.records.accelerationNote,
    "verdict record": inputs.records.verdictRecord,
  };
  for (const record of RECORDS_KEPT_WITH_THE_PHASE_EVIDENCE) {
    const from = sources[record];
    if (from === undefined || !tree.exists(from)) continue;
    const to = tree.join(directory, PLACE_INSIDE_THE_ARCHIVE[record]);
    if (to === from) {
      kept.push({ record, from, to, copied: false });
      continue;
    }
    tree.copy(from, to);
    kept.push({ record, from, to, copied: true });
  }

  return Object.freeze({
    directory,
    label: place.label,
    suffixApplied: place.suffixApplied,
    moved: Object.freeze({ record: "phase evidence" as const, to: evidenceTo }),
    kept: Object.freeze(kept.map((entry) => Object.freeze(entry))),
    event: Object.freeze({
      phase: inputs.phase,
      attempt: inputs.ordinal,
      dir: place.asIsDirectory,
    }),
  });
}
