/**
 * T268 — the blocked reasons (annex E, §E.2; F100-FR-144, F100-FR-145).
 *
 * A slice of T078. The six blocked reasons of §E.2 with their stop reason,
 * their engine exit code and `retryable`, read from the key `blockedReasons`
 * of `data/run-state-machine.json`; the shape of the event `blocked` (the
 * reason and what the run needs); the rule that a blocked run writes its
 * terminal record, releases the lock, ends and is never relaunched by either
 * relaunch classifier table; and the refusal on a changed source hash, all as
 * data.
 *
 * Row 4 of `data/closed-sets.json` gives no literals of its own: it refers to
 * this table, and registers through T070 from here (`blockedReasonSet`).
 */
import machine from "../../data/run-state-machine.json" with { type: "json" };
import { defineByReference, type SetByReference } from "../enums/index.ts";

/** The section of annex E that owns this table. */
export const ANNEX_SECTION = "annex E, §E.2" as const;

type RawBlockedReason = {
  "Blocked reason": string;
  When: string;
  "Stop reason": string;
  "Engine exit": string;
  "`retryable`": string;
};

const RAW = (machine as { blockedReasons: RawBlockedReason[] }).blockedReasons;

const bare = (cell: string): string => cell.replace(/`/g, "").trim();

/** The six blocked reasons of §E.2, in the order of the annex. */
export const BLOCKED_REASONS = [
  "declared-block",
  "quota-credit",
  "auth",
  "budget-cap",
  "quota-wait-ceiling",
  "source-changed",
] as const;

/** A member of the closed set of blocked reasons (annex E, §E.2). */
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

/** Row 4 of §X.6 — blocked reasons, registered through T070 from here. */
export const blockedReasonSet: SetByReference<BlockedReason> = defineByReference(
  4,
  BLOCKED_REASONS,
);

/** One row of the blocked-reasons table of §E.2. */
export type BlockedReasonRow = {
  /** The blocked reason. */
  readonly reason: BlockedReason;
  /** The cell "When". */
  readonly when: string;
  /** The stop reason of §E.3 the engine ends with. */
  readonly stopReason: string;
  /** The exit code of the engine. */
  readonly engineExit: number;
  /** The value of `retryable` in the terminal record: always false here. */
  readonly retryable: boolean;
  /** The cell "`retryable`", verbatim. */
  readonly retryableCell: string;
};

/** Every row of the table, in the order of the annex (F100-FR-144). */
export const blockedReasonRows: readonly BlockedReasonRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      reason: bare(row["Blocked reason"]) as BlockedReason,
      when: row.When,
      stopReason: bare(row["Stop reason"]),
      engineExit: Number(bare(row["Engine exit"])),
      retryable: /^yes$/i.test(bare(row["`retryable`"])),
      retryableCell: row["`retryable`"],
    }),
  ),
);

const ROW = new Map(blockedReasonRows.map((r) => [r.reason, r]));

/** The row of a blocked reason, or `undefined` where the table holds none. */
export function blockedReasonRow(reason: string): BlockedReasonRow | undefined {
  return ROW.get(reason as BlockedReason);
}

/** The stop reason a blocked reason ends with (F100-FR-144). */
export function stopReasonOf(reason: string): string | undefined {
  return ROW.get(reason as BlockedReason)?.stopReason;
}

/** The engine exit code of a blocked reason (F100-FR-144). */
export function engineExitOf(reason: string): number | undefined {
  return ROW.get(reason as BlockedReason)?.engineExit;
}

/** True when the value is one of the six blocked reasons. */
export function isBlockedReason(value: string): value is BlockedReason {
  return (BLOCKED_REASONS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * The event `blocked`.
 * ------------------------------------------------------------------ */

/** The name of the event a blocked run emits (annex E, §E.2). */
export const BLOCKED_EVENT = "blocked" as const;

/**
 * F100-FR-144 — the shape of the event `blocked`: the reason from the closed
 * set, and what the run needs of the consumer. `synthesized` is set only for
 * the event of a refused `resume` (F100-FR-145), which the CLI cannot write
 * itself.
 */
export type BlockedEvent = {
  /** The event name. */
  readonly event: typeof BLOCKED_EVENT;
  /** A member of the closed set of §E.2. */
  readonly reason: BlockedReason;
  /** What the run needs of the consumer before it can go on. */
  readonly needs: string;
  /** The stop reason the terminal record carries with it. */
  readonly stopReason: string;
  /** The exit code of the engine for it. */
  readonly engineExit: number;
  /** Set where the writer is not the process the reason happened in. */
  readonly synthesized?: boolean;
};

/** The event `blocked` for a reason, with the row's stop reason and code. */
export function blockedEvent(
  reason: BlockedReason,
  needs: string,
  synthesized = false,
): BlockedEvent {
  const row = ROW.get(reason);
  if (row === undefined) {
    throw new Error(`\`${reason}\` is not a blocked reason of ${ANNEX_SECTION} (F100-FR-144)`);
  }
  return Object.freeze({
    event: BLOCKED_EVENT,
    reason,
    needs,
    stopReason: row.stopReason,
    engineExit: row.engineExit,
    ...(synthesized ? { synthesized: true } : {}),
  });
}

/* ------------------------------------------------------------------ *
 * What a blocked run does, as data (F100-FR-144).
 * ------------------------------------------------------------------ */

/** The two relaunch classifier tables of the product (row 14 of §X.6). */
export const RELAUNCH_CLASSIFIER_TABLES = ["relaunch-observe", "relaunch-root"] as const;

/**
 * F100-FR-144 — a run that cannot go on without the consumer emits the event
 * `blocked`, writes the terminal record with the stop reason and the exit
 * code of the table, releases the lock and ends; and neither relaunch
 * classifier table relaunches it.
 */
export const WHAT_A_BLOCKED_RUN_DOES = {
  emitsTheEvent: BLOCKED_EVENT,
  writesTheTerminalRecord: true,
  releasesTheLock: true,
  ends: true,
  restsIn: "blocked-on-human",
  relaunchedByEitherClassifierTable: false,
  classifierTables: RELAUNCH_CLASSIFIER_TABLES,
  /** The refusal each classifier table records for a blocked run (row 14). */
  refusalOfTheClassifier: "blocked-on-human",
} as const;

/** F100-FR-144 — neither classifier table relaunches a blocked run. */
export function mayRelaunch(_reason: BlockedReason, _table: string): false {
  return false;
}

/* ------------------------------------------------------------------ *
 * The refusal on a changed source hash (F100-FR-145).
 * ------------------------------------------------------------------ */

/** The blocked reason of a changed source (annex E, §E.2). */
export const SOURCE_CHANGED = "source-changed" as const;

/** The three sources whose hash is compared (annex B; row 50 of §X.6). */
export const SOURCES_COMPARED = ["spec", "plan", "tasks"] as const;

/**
 * F100-FR-145 — when `resume`, or a `launch` that continues a run, finds a
 * changed source hash: the CLI refuses with exit 3 and names the file, the
 * refusal is recorded in the launch record as the transition T3, readers show
 * the run as `blocked-on-human` with the attention item `source-changed`, and
 * the event `blocked` for it is written by the next process that becomes the
 * writer of the event file, marked as synthesized.
 */
export const SOURCE_CHANGED_REFUSAL = {
  reason: SOURCE_CHANGED,
  exitCode: 3,
  namesTheFileThatChanged: true,
  recordedInTheLaunchRecordAs: "T3",
  launchRecordOutcome: "refused",
  launchRecordField: "refusalFile",
  readersShowTheState: "blocked-on-human",
  attentionItem: SOURCE_CHANGED,
  eventWrittenBy: "the next process that becomes the writer of the event file",
  eventIsMarkedSynthesized: true,
  stopReason: "critic_config",
} as const;

/** The refusal of one changed source file, as a reader shows it. */
export type SourceChangedRefusal = {
  readonly reason: typeof SOURCE_CHANGED;
  /** The file the CLI names in its refusal. */
  readonly file: string;
  /** The exit code of the command: 3. */
  readonly exitCode: 3;
  /** The transition recorded in the launch record: T3. */
  readonly transition: "T3";
  /** The outcome written in the launch record. */
  readonly outcome: "refused";
  /** The state readers show. */
  readonly state: "blocked-on-human";
  /** The attention item readers show. */
  readonly attentionItem: typeof SOURCE_CHANGED;
  /** The event `blocked`, written by the next writer and synthesized. */
  readonly event: BlockedEvent;
};

/** F100-FR-145 — the refusal for one changed source file, as data. */
export function sourceChangedRefusal(file: string): SourceChangedRefusal {
  return Object.freeze({
    reason: SOURCE_CHANGED,
    file,
    exitCode: 3,
    transition: "T3",
    outcome: "refused",
    state: "blocked-on-human",
    attentionItem: SOURCE_CHANGED,
    event: blockedEvent(SOURCE_CHANGED, `the file \`${file}\` changed since launch`, true),
  });
}
