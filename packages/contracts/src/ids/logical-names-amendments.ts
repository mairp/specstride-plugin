/**
 * T295 — the resolver entries of the sixteen logical names that the amendments
 * after the fan-out added to annex B §B.5 (F100-FR-229).
 *
 * This module is an extension of the resolver of T034
 * (`src/ids/logical-names.ts`), not a second resolver: every name here is a row
 * of the one table of §B.5, and `resolveAmended` resolves it through `resolve`
 * of T034. What this module adds is the three rules that the amendment states
 * for names of the group, which the table alone does not carry:
 *
 *  - the as-is event file is written once per engine start, under
 *    `run:<runId>:events-legacy:<k>`, and the bare name resolves to the file of
 *    the newest start (`EVENT_FILE_IS_WRITTEN_ONCE_PER_ENGINE_START`);
 *  - the consumer's comment is kept verbatim, after redaction, under
 *    `launch:<launchId>:comment`, and the launch record holds only its hash
 *    (`COMMENT_RULE`);
 *  - `workspace:current:status-line` is placed by the real path of the
 *    workspace only, so that a shell shim of a host finds it without starting
 *    the product (`STATUS_LINE_RULE`).
 *
 * The sixteen rows are rows 110 to 125 of the table as the amendments wrote it.
 * In the amended table of layout 1.2 they are rows 111 and 113 to 127: row 112,
 * `run:<runId>:engine-log:<k>`, is the later addition of T303 and sits between
 * them. `AMENDED_LOGICAL_NAMES` is the list in the order of the annex, and
 * `rowsOfTheAmendment()` asserts at load that the table holds every one.
 */
import {
  LOGICAL_NAMES,
  layoutVersion,
  holdsLogicalName,
  rowOf,
  resolve,
  resolveEngineStart,
  perStartNameOf,
  type LogicalNameRow,
  type NameParameters,
  type RootPaths,
  UnknownLogicalNameError,
} from "./logical-names.ts";

/** The section of annex B that owns the table. */
export const ANNEX_SECTION = "annex B, §B.5" as const;

/** The requirement that states the three rules of this group. */
export const REQUIREMENT = "F100-FR-229" as const;

/**
 * The sixteen logical names the amendments after the fan-out added to the
 * table of §B.5, in the order of the annex: rows 110 to 125 as the amendment
 * wrote them, from `run:<runId>:events-legacy:<k>` to
 * `workspace:current:status-line`.
 */
export const AMENDED_LOGICAL_NAMES = [
  "run:<runId>:events-legacy:<k>",
  "launch:<launchId>:comment",
  "attempt:<N>:<k>:<n>:withheld-paths",
  "attempt:<N>:<k>:<n>:hidden-files",
  "gate:<N>:proofs",
  "package:harness:<id>",
  "package:catalogue",
  "package:context-budget",
  "run:<runId>:spend",
  "run:<runId>:task-list",
  "reverse:<slug>:claims:<unit-key>",
  "reverse:<slug>:test-plan",
  "reverse:<slug>:scaffolds",
  "pass:<passId>:critic-patch",
  "feature:<slug>:learning:lock",
  "workspace:current:status-line",
] as const;

export type AmendedLogicalName = (typeof AMENDED_LOGICAL_NAMES)[number];

/** Sixteen names, as the amendment added (F100-FR-229). */
export const AMENDED_LOGICAL_NAME_COUNT = 16 as const;

/** A name of the amendment that the table of §B.5 does not hold. */
export class AmendmentNotInTheLayoutError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `the table of ${ANNEX_SECTION} (layout ${layoutVersion}) holds no row for ` +
        `${missing.join(", ")}; the sixteen names of the amendment are rows of the one ` +
        `table, not a second one (${REQUIREMENT})`,
    );
    this.name = "AmendmentNotInTheLayoutError";
  }
}

function assertEveryNameIsARow(): void {
  if (AMENDED_LOGICAL_NAMES.length !== AMENDED_LOGICAL_NAME_COUNT) {
    throw new AmendmentNotInTheLayoutError([
      `the list holds ${String(AMENDED_LOGICAL_NAMES.length)} names, not ` +
        `${String(AMENDED_LOGICAL_NAME_COUNT)}`,
    ]);
  }
  const missing = AMENDED_LOGICAL_NAMES.filter((n) => !holdsLogicalName(n));
  if (missing.length > 0) throw new AmendmentNotInTheLayoutError(missing);
}

assertEveryNameIsARow();

/** The row of §B.5 of every name of the amendment, in the order of the annex. */
export function rowsOfTheAmendment(): readonly LogicalNameRow[] {
  return Object.freeze(AMENDED_LOGICAL_NAMES.map((n) => rowOf(n)));
}

/** True when the name is one of the sixteen the amendment added. */
export function isAmendedLogicalName(logicalName: string): logicalName is AmendedLogicalName {
  return (AMENDED_LOGICAL_NAMES as readonly string[]).includes(logicalName);
}

/**
 * The index of a name of the amendment in the amended table of §B.5, counting
 * from 1. The two names the amendment cites by name are the ends of the group:
 * `run:<runId>:events-legacy:<k>` opens it and `workspace:current:status-line`
 * closes it.
 */
export function rowNumberOf(logicalName: AmendedLogicalName): number {
  return LOGICAL_NAMES.indexOf(logicalName) + 1;
}

/** The first and the last name of the group, as the amendment cites them. */
export const FIRST_AMENDED_NAME: AmendedLogicalName = "run:<runId>:events-legacy:<k>";
export const LAST_AMENDED_NAME: AmendedLogicalName = "workspace:current:status-line";

/**
 * Resolve a name of the amendment to a path, through the resolver of T034.
 * This is an extension of that resolver and refuses a name outside the group,
 * so that a caller cannot use it as a second table.
 */
export function resolveAmended(
  logicalName: AmendedLogicalName,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  if (!isAmendedLogicalName(logicalName)) throw new UnknownLogicalNameError(logicalName);
  return resolve(logicalName, parameters, roots);
}

/* ------------------------------------------------------------------ *
 * F100-FR-229, the first rule: the as-is event file.
 * ------------------------------------------------------------------ */

/** The per-start name of the as-is event file (F100-FR-229). */
export const EVENTS_LEGACY_PER_START: AmendedLogicalName = "run:<runId>:events-legacy:<k>";

/** The bare name, which resolves to the file of the newest engine start. */
export const EVENTS_LEGACY_BARE = "run:<runId>:events-legacy" as const;

/**
 * F100-FR-229 — the as-is event file is written once per engine start. There
 * is one file per start, with the ordinal `<k>` in its name, and no file that
 * spans two starts.
 */
export const EVENT_FILE_IS_WRITTEN_ONCE_PER_ENGINE_START = true as const;

/** The one writer of the as-is event file, from the table of §B.5. */
export function writerOfTheEventFile(): string {
  return rowOf(EVENTS_LEGACY_PER_START).writer;
}

/**
 * Resolve the as-is event file of one engine start. `<k>` is the ordinal of
 * the start; the bare name resolves to the file of the newest start, which is
 * what `resolveEngineStart` of T034 does.
 */
export function resolveEventsLegacy(
  engineStartOrdinal: number | string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  return resolve(EVENTS_LEGACY_PER_START, { ...parameters, "<k>": engineStartOrdinal }, roots);
}

/** The file of the newest engine start, through the bare name (F100-FR-229). */
export function resolveNewestEventsLegacy(
  newestEngineStartOrdinal: number | string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  return resolveEngineStart(EVENTS_LEGACY_BARE, newestEngineStartOrdinal, parameters, roots);
}

/** True when the bare name resolves through the per-start name of this group. */
export function bareNameResolvesThroughThePerStartName(): boolean {
  return perStartNameOf(EVENTS_LEGACY_BARE) === EVENTS_LEGACY_PER_START;
}

/* ------------------------------------------------------------------ *
 * F100-FR-229, the second rule: the consumer's comment.
 * ------------------------------------------------------------------ */

/** The logical name under which the comment is kept (F100-FR-229). */
export const COMMENT_NAME: AmendedLogicalName = "launch:<launchId>:comment";

/**
 * F100-FR-229 — the consumer's comment is kept verbatim, after redaction,
 * under `launch:<launchId>:comment`, and the launch record holds only its
 * hash. The comment itself is never a field of the launch record.
 */
export const COMMENT_RULE = Object.freeze({
  logicalName: COMMENT_NAME,
  /** Kept verbatim: no reflow, no truncation, no normalisation of the text. */
  keptVerbatim: true as const,
  /** Verbatim after redaction: the redactor of §X.4 runs before the write. */
  afterRedaction: true as const,
  /** The launch record holds the hash of the comment and nothing of its text. */
  launchRecordHolds: "hash" as const,
  launchRecordHoldsTheText: false as const,
});

/** F100-FR-229 — what the launch record holds of the comment: only its hash. */
export const LAUNCH_RECORD_HOLDS_ONLY_THE_HASH = true as const;

/** The field of the launch record that carries the hash of the comment. */
export const COMMENT_HASH_FIELD = "commentHash" as const;

/** Resolve the file of the comment of one launch. */
export function resolveComment(
  launchId: string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  return resolve(COMMENT_NAME, { ...parameters, "<launchId>": launchId }, roots);
}

/**
 * F100-FR-229 — what a writer of the launch record may carry of the comment.
 * A record that carries the text of the comment is refused: the text lives in
 * the file of `launch:<launchId>:comment` and the record holds its hash.
 */
export function launchRecordMayCarry(field: string): boolean {
  return field === COMMENT_HASH_FIELD;
}

/* ------------------------------------------------------------------ *
 * F100-FR-229, the third rule: the status line of the workspace.
 * ------------------------------------------------------------------ */

/** The name a shell shim of a host reads (F100-FR-229). */
export const STATUS_LINE_NAME: AmendedLogicalName = "workspace:current:status-line";

/** The name of the run it points at, from the table of §B.5. */
export const STATUS_LINE_TARGET = "run:<runId>:status-line" as const;

/**
 * F100-FR-229 — `workspace:current:status-line` is placed by the real path of
 * the workspace only. Its path carries no run id, no feature slug and no
 * launch id, so a shell shim of a host finds the precomputed status line
 * without starting the product and without knowing which run is current.
 */
export const STATUS_LINE_RULE = Object.freeze({
  logicalName: STATUS_LINE_NAME,
  /** The one thing its place depends on. */
  placedBy: "the real path of the workspace" as const,
  dependsOnTheRunId: false as const,
  dependsOnTheFeatureSlug: false as const,
  /** What it points at: the status line of the current run. */
  pointsAt: STATUS_LINE_TARGET,
  /** A shell shim finds it without starting the product. */
  foundWithoutStartingTheProduct: true as const,
});

/**
 * The parameters the path of `workspace:current:status-line` carries. The
 * amendment's rule is that the list is empty: the control root is placed by
 * the real path of the workspace (through the workspace id), and the path adds
 * nothing of a run to it.
 */
export function parametersOfTheStatusLine(): readonly string[] {
  return rowOf(STATUS_LINE_NAME).parameters;
}

/** True when the place of the status line depends on the workspace only. */
export function statusLineDependsOnTheWorkspaceOnly(): boolean {
  return parametersOfTheStatusLine().length === 0;
}

/** Resolve the status line of the workspace; it takes no parameter. */
export function resolveStatusLine(roots: RootPaths = {}): string {
  return resolve(STATUS_LINE_NAME, {}, roots);
}

/** The three rules of F100-FR-229, as one table for a reader of the annex. */
export const RULES_OF_THE_AMENDMENT = Object.freeze([
  Object.freeze({
    logicalName: EVENTS_LEGACY_PER_START,
    rule: "the as-is event file is written once per engine start",
  }),
  Object.freeze({
    logicalName: COMMENT_NAME,
    rule: "the comment is kept verbatim after redaction; the launch record holds only its hash",
  }),
  Object.freeze({
    logicalName: STATUS_LINE_NAME,
    rule: "placed by the real path of the workspace only",
  }),
]);
