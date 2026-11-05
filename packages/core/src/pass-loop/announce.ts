/**
 * T019 of feature 103 — the ANNOUNCEMENTS of the pass loop as COMPATIBILITY
 * OUTPUT (F103-FR-004, with the two evidence announcements of F103-FR-005 and
 * F103-FR-006).
 *
 * Every announcement is two things that are kept apart here on purpose:
 *
 *  1. a LINE, printed on standard error, byte for byte as the baseline printed
 *    it, with the LOGICAL component prefix where the baseline named a script;
 *  2. an EVENT, which the COMPATIBILITY PROJECTION renders under an as-is name
 *    with as-is fields. The pass loop emits the catalogued type of feature 111
 *    (`packages/observability/data/event-catalogue.tsv`) and NEVER the as-is
 *    name; the projection does the renaming
 *    (`packages/observability/data/projection/projection-table.tsv`). The rows
 *    below carry both halves so that the pairing stands in one place.
 *
 * | As-is name | Catalogued type | As-is fields | Requirement |
 * |---|---|---|---|
 * | `proposer_start` | `attempt.started` | `phase`, `attempt`, `backend` | F103-FR-004 |
 * | `iter_start` | `pass.started` | `iter`, `max_iter` | F103-FR-004 |
 * | `iter_done` | `pass.ended` | `iter`, `evidence=missing` | F103-FR-004 |
 * | `evidence_present` | `evidence.present` | `file`, `iters` | F103-FR-006 |
 * | `evidence_written` | `evidence.written` | `file`, `iters` | F103-FR-005 |
 *
 * ## Who prints which line
 *
 * The line `----- proposer: phase <N> attempt <M>/<MAX_REJECTS> (<harness>) -----`
 * is printed by the ENGINE, before every phase attempt of the proposer, and
 * the per-pass line by the PASS LOOP. Both are here because they are one
 * table of bytes and the oracle compares one thing; `WRITER_OF` says which
 * side writes each.
 *
 * ## No new line under the `parity` profile
 *
 * F103-FR-004 ends with it: no NEW line is printed under the `parity` profile.
 * `AS_IS_LINE_IDS` is therefore the whole of what this module may print, and
 * `hasAnAsIsEquivalent` is the check a caller makes before printing anything
 * that is not in it.
 *
 * ## The variants this module does not hold
 *
 * `iter_done` has variants for a YIELD (`yielded=true`, `waited_sec`) and for
 * a PLUGIN RESTART (`plugin_restart=true`). Both belong to the features that
 * own them — the watchdog-and-yield feature and the harness adapter of the dsh
 * plugin protocol — and `ITER_DONE_VARIANTS_ARE_OWNED_BY` names them rather
 * than inventing their fields here. The variant this module holds is the one
 * F103-FR-004 gives the pass loop: a pass that ended with no phase evidence
 * and no other end.
 */

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-004", "F103-FR-005", "F103-FR-006"] as const;

/** F103-FR-004 — the lines are compatibility output, byte for byte. */
export const BYTE_FOR_BYTE = true as const;

/** The stream every line of this module is printed on. */
export const STREAM = "stderr" as const;

/** F103-FR-004 — no NEW line is printed under the `parity` profile. */
export const PRINTS_A_NEW_LINE_UNDER_PARITY = false as const;

/**
 * The LOGICAL component prefix of a line of the pass loop. The baseline named
 * its script; the port keeps the bytes, so the prefix stays `proposer.sh:`
 * and is a logical name and not a file that exists.
 */
export const LOGICAL_PREFIX = "proposer.sh:" as const;

/** The catalogue the types below are taken from (feature 111). */
export const EVENT_CATALOGUE_FILE = "packages/observability/data/event-catalogue.tsv" as const;

/** The projection table that renames a type to its as-is name (feature 111). */
export const PROJECTION_TABLE_FILE =
  "packages/observability/data/projection/projection-table.tsv" as const;

/* ------------------------------------------------------------------ *
 * The rows: an as-is name, a catalogued type, the as-is fields.
 * ------------------------------------------------------------------ */

/** Which side of the product prints a line or emits an event. */
export const WRITERS = ["engine", "pass-loop"] as const;
export type AnnouncementWriter = (typeof WRITERS)[number];

/** One announcement, with both of its halves. */
export type AnnouncementRow = {
  /** The name the compatibility projection renders. */
  readonly asIsName: string;
  /** The type of the event catalogue the pass loop actually emits. */
  readonly catalogueType: string;
  /** The condition of the projection row, where its type has more than one. */
  readonly condition?: string;
  /** The as-is fields of the projected event, in the order of the table. */
  readonly asIsFields: readonly string[];
  /** Which side writes it. */
  readonly writer: AnnouncementWriter;
  /** The requirement that fixes it. */
  readonly requirement: string;
};

/** F103-FR-004 — the announcement before every phase attempt of the proposer. */
export const PROPOSER_START: AnnouncementRow = Object.freeze({
  asIsName: "proposer_start",
  catalogueType: "attempt.started",
  condition: "kind other",
  asIsFields: Object.freeze(["phase", "attempt", "backend"]),
  writer: "engine",
  requirement: "F103-FR-004",
});

/** F103-FR-004 — the announcement before every pass. */
export const ITER_START: AnnouncementRow = Object.freeze({
  asIsName: "iter_start",
  catalogueType: "pass.started",
  asIsFields: Object.freeze(["iter", "max_iter"]),
  writer: "pass-loop",
  requirement: "F103-FR-004",
});

/** F103-FR-004 — the announcement after a pass that ended with no phase evidence. */
export const ITER_DONE: AnnouncementRow = Object.freeze({
  asIsName: "iter_done",
  catalogueType: "pass.ended",
  condition: "endCause evidence, completed or yield",
  asIsFields: Object.freeze(["iter", "evidence"]),
  writer: "pass-loop",
  requirement: "F103-FR-004",
});

/** F103-FR-006 — the announcement of phase evidence found before any pass. */
export const EVIDENCE_PRESENT: AnnouncementRow = Object.freeze({
  asIsName: "evidence_present",
  catalogueType: "evidence.present",
  asIsFields: Object.freeze(["file", "iters"]),
  writer: "pass-loop",
  requirement: "F103-FR-006",
});

/** F103-FR-005 — the announcement of phase evidence that appeared after a pass. */
export const EVIDENCE_WRITTEN: AnnouncementRow = Object.freeze({
  asIsName: "evidence_written",
  catalogueType: "evidence.written",
  asIsFields: Object.freeze(["file", "iters"]),
  writer: "pass-loop",
  requirement: "F103-FR-005",
});

/** The five announcements of this module, in the order of the table. */
export const ANNOUNCEMENTS: readonly AnnouncementRow[] = Object.freeze([
  PROPOSER_START,
  ITER_START,
  ITER_DONE,
  EVIDENCE_PRESENT,
  EVIDENCE_WRITTEN,
]);

/** The row of an as-is name, or `undefined`. */
export function announcementOf(asIsName: string): AnnouncementRow | undefined {
  return ANNOUNCEMENTS.find((row) => row.asIsName === asIsName);
}

/** Which side writes an announcement. */
export const WRITER_OF: Readonly<Record<string, AnnouncementWriter>> = Object.freeze(
  Object.fromEntries(ANNOUNCEMENTS.map((row) => [row.asIsName, row.writer])),
);

/**
 * F103-FR-004 — the variants of `iter_done` this module does NOT hold, and
 * the feature that owns each.
 */
export const ITER_DONE_VARIANTS_ARE_OWNED_BY = Object.freeze({
  yield: "the feature that owns the watchdogs and the yield",
  pluginRestart: "the harness adapter of the dsh plugin protocol",
});

/* ------------------------------------------------------------------ *
 * The lines.
 * ------------------------------------------------------------------ */

/** The ids of the lines this module may print; the whole of it under `parity`. */
export const AS_IS_LINE_IDS = [
  "proposer-attempt-banner",
  "proposer-pass-banner",
  "evidence-already-exists",
  "evidence-appeared",
] as const;
export type AsIsLineId = (typeof AS_IS_LINE_IDS)[number];

/** True when a line id has an as-is equivalent and may therefore be printed. */
export function hasAnAsIsEquivalent(id: string): id is AsIsLineId {
  return (AS_IS_LINE_IDS as readonly string[]).includes(id);
}

/**
 * F103-FR-004 — `----- proposer: phase <N> attempt <M>/<MAX_REJECTS> (<harness>) -----`.
 * Printed by the ENGINE before every phase attempt of the proposer.
 */
export function proposerAttemptBanner(
  phase: number,
  attempt: number,
  maxRejects: number,
  harness: string,
): string {
  return `----- proposer: phase ${phase} attempt ${attempt}/${maxRejects} (${harness}) -----`;
}

/**
 * F103-FR-004 — `----- proposer pass <i>/<max>  <ISO time> -----`. Printed by
 * the PASS LOOP before every pass. Two blanks before the time, as at the
 * baseline; the time is compared through rule N-04 of the oracle and is
 * written here as it is handed in.
 */
export function proposerPassBanner(pass: number, max: number, isoTime: string): string {
  return `----- proposer pass ${pass}/${max}  ${isoTime} -----`;
}

/**
 * F103-FR-006 — `proposer.sh: evidence already exists (<path>); nothing to do.`
 */
export function evidenceAlreadyExists(path: string): string {
  return `${LOGICAL_PREFIX} evidence already exists (${path}); nothing to do.`;
}

/** F103-FR-005 — `proposer.sh: evidence appeared after pass <i> (<path>).` */
export function evidenceAppeared(pass: number, path: string): string {
  return `${LOGICAL_PREFIX} evidence appeared after pass ${pass} (${path}).`;
}

/* ------------------------------------------------------------------ *
 * The events, as the projection will render them.
 * ------------------------------------------------------------------ */

/** The as-is fields of a projected announcement, as values. */
export type AsIsFields = Readonly<Record<string, string | number | boolean>>;

/** An announcement ready to emit: the catalogued type and the as-is fields. */
export type Announcement = {
  readonly catalogueType: string;
  readonly asIsName: string;
  readonly asIsFields: AsIsFields;
};

const announcement = (row: AnnouncementRow, fields: AsIsFields): Announcement =>
  Object.freeze({
    catalogueType: row.catalogueType,
    asIsName: row.asIsName,
    asIsFields: Object.freeze({ ...fields }),
  });

/** F103-FR-004 — `proposer_start` with `phase`, `attempt` and `backend`. */
export function proposerStartEvent(phase: number, attempt: number, backend: string): Announcement {
  return announcement(PROPOSER_START, { phase, attempt, backend });
}

/** F103-FR-004 — `iter_start` with `iter` and `max_iter`. */
export function iterStartEvent(iter: number, maxIter: number): Announcement {
  return announcement(ITER_START, { iter, max_iter: maxIter });
}

/**
 * F103-FR-004 — `iter_done` with `iter` and `evidence=missing`, for a pass
 * that ended with no phase evidence and no other end. The value of `evidence`
 * is the literal `missing`, which is why it is pinned here and not passed in.
 */
export const EVIDENCE_MISSING = "missing" as const;

/** F103-FR-004 — `iter_done` with `iter` and `evidence=missing`. */
export function iterDoneEvent(iter: number): Announcement {
  return announcement(ITER_DONE, { iter, evidence: EVIDENCE_MISSING });
}

/**
 * F103-FR-006 — `evidence_present` with `file` (the BASE NAME) and `iters` set
 * to 0. The base name and not the path: the path goes in the line, the base
 * name in the event.
 */
export function evidencePresentEvent(baseName: string): Announcement {
  return announcement(EVIDENCE_PRESENT, { file: baseName, iters: 0 });
}

/** F103-FR-005 — `evidence_written` with `file` (the base name) and `iters`. */
export function evidenceWrittenEvent(baseName: string, iters: number): Announcement {
  return announcement(EVIDENCE_WRITTEN, { file: baseName, iters });
}
