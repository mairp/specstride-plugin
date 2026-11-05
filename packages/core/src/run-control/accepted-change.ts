/**
 * T051 — the engine side of an accepted change of a source (F102-FR-020,
 * F102-FR-036; annex D §D.7; event catalogue annex X §X.1, row 73 of §X.6).
 *
 * The CLI wrote `acceptedChanges` and the new hashes into the run snapshot
 * before the engine started (F102-FR-019, `snapshot-writer.ts`); the engine
 * reads them and never writes the snapshot (annex B §B.12). This module is
 * what the engine does with them at the launch that accepted the change:
 *
 * 1. it emits the event `source.change_accepted`, ONE EVENT FOR EACH FILE
 *    accepted, with the file (`spec`, `plan` or `tasks`), its logical name,
 *    the old hash, the new hash and the time of the acceptance in `data` —
 *    and with NO text of the source, no count and no detail of how the
 *    change was accepted (F102-FR-020, F111-FR-051);
 * 2. it supplies the fact of annex D §D.7 — the member "an intended change
 *    of a source that was accepted" of the `facts` list of the fact block —
 *    to every critic of the run, for the rest of the run.
 *
 * WHO WRITES THE EVENT. The CLI writes no event (F102-FR-016): the event is
 * written by the process that becomes the writer of the event file for the
 * launch that accepted the change. The module therefore holds no file module
 * of Node.js and no path logic — the events go through the `EventAppender`
 * port, whose implementation in the edge packages is the kernel event sink,
 * exactly as the ledger is read through the `LedgerReader` port of
 * `counts.ts` (F100-FR-012).
 */
import { tryReadRunSnapshot } from "@specstride/contracts/records/run-snapshot";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-020", "F102-FR-036"] as const;

/** The import boundary this module holds (F100-FR-012). */
export const READS_NO_FILE_MODULE_OF_NODE = true as const;

/** The event type of an accepted change (annex X §X.6 row 73). */
export const EVENT_TYPE = "source.change_accepted" as const;

/**
 * F102-FR-020 — who writes the event: the process that becomes the writer
 * of the event file for the launch that accepted the change, never the CLI.
 */
export const EVENT_WRITTEN_BY = "the process that becomes the writer of the event file" as const;

/** F102-FR-016 — the CLI writes no event. */
export const THE_CLI_WRITES_NO_EVENT = true as const;

/** One event for EACH file accepted; never several files in one event. */
export const ONE_EVENT_FOR_EACH_FILE = true as const;

/** The three sources an acceptance can name (annex X §X.6 rows 50 and 135). */
export const ACCEPTED_SOURCES = ["spec", "plan", "tasks"] as const;
export type AcceptedSource = (typeof ACCEPTED_SOURCES)[number];

/** One accepted change, as `acceptedChanges` of the snapshot holds it. */
export type AcceptedChangeRecord = {
  readonly file: AcceptedSource;
  readonly changedRef: string;
  readonly oldHash: string;
  readonly newHash: string;
  readonly acceptedAt: string;
};

/**
 * F102-FR-020 — the `data` of one `source.change_accepted` event: exactly
 * the fields of F102-FR-020, and nothing about how the change was accepted.
 */
export type SourceChangeAcceptedData = {
  readonly file: AcceptedSource;
  readonly changedRef: string;
  readonly oldHash: string;
  readonly newHash: string;
  readonly acceptedAt: string;
};

/** The envelope of one event as the writer appends it. */
export type RunControlEvent = {
  readonly type: typeof EVENT_TYPE;
  readonly data: SourceChangeAcceptedData;
};

/**
 * The port the events go through: the process that becomes the writer of the
 * event file appends them to the event file of the run. Implemented over the
 * kernel event sink in the edge packages — never over `node:fs` here.
 */
export interface EventAppender {
  readonly append: (event: RunControlEvent) => void;
}

/** True when the value is one accepted-change entry of the snapshot. */
export function isAcceptedChangeRecord(value: unknown): value is AcceptedChangeRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (ACCEPTED_SOURCES as readonly string[]).includes(record.file as string) &&
    typeof record.changedRef === "string" &&
    typeof record.oldHash === "string" &&
    typeof record.newHash === "string" &&
    typeof record.acceptedAt === "string"
  );
}

/**
 * F102-FR-020 — read `acceptedChanges` of the run snapshot. The snapshot is
 * read through the validator of `specstride.snapshot/1` first; entries that
 * are not accepted-change records are dropped, so a hand-edited snapshot can
 * never put another shape into an event or a fact.
 *
 * Pure: it reads only its argument (F100-FR-012).
 */
export function readAcceptedChanges(snapshot: unknown): readonly AcceptedChangeRecord[] {
  const read = tryReadRunSnapshot(snapshot, "run:<runId>:snapshot");
  if (!read.ok) return [];
  const changes = (read.record as { acceptedChanges?: unknown[] }).acceptedChanges ?? [];
  return Object.freeze(changes.filter(isAcceptedChangeRecord));
}

/**
 * F102-FR-020 — the event data of ONE accepted change: the file, its logical
 * name, the old hash, the new hash and the time — and no text of the source.
 */
export function sourceChangeAcceptedDataOf(change: AcceptedChangeRecord): SourceChangeAcceptedData {
  return Object.freeze({
    file: change.file,
    changedRef: change.changedRef,
    oldHash: change.oldHash,
    newHash: change.newHash,
    acceptedAt: change.acceptedAt,
  });
}

/**
 * F102-FR-020 — ONE EVENT FOR EACH FILE accepted, in the order the snapshot
 * holds the entries. A count of the changes, the text of a source and any
 * detail of how the change was accepted are in NO field.
 */
export function sourceChangeAcceptedEventsOf(
  changes: readonly AcceptedChangeRecord[],
): readonly RunControlEvent[] {
  return Object.freeze(
    changes.map((change) =>
      Object.freeze({
        type: EVENT_TYPE,
        data: sourceChangeAcceptedDataOf(change),
      }),
    ),
  );
}

/**
 * F102-FR-020 — emit the events through the writer of the event file: the
 * caller is the process that becomes that writer for the launch that
 * accepted the change. Returns the number of events appended.
 */
export function emitSourceChangeAccepted(
  appender: EventAppender,
  changes: readonly AcceptedChangeRecord[],
): number {
  let count = 0;
  for (const event of sourceChangeAcceptedEventsOf(changes)) {
    appender.append(event);
    count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ *
 * The fact of annex D §D.7, for every critic of the run.
 * ------------------------------------------------------------------ */

/** The annex section that owns the fact block and its `facts` list. */
export const FACT_BLOCK_ANNEX = "annex D, §D.7" as const;

/**
 * F102-FR-020 — the member of the closed set of `facts` an accepted change
 * becomes, in the fact block every critic of the run receives.
 */
export const FACT_MEMBER = "an intended change of a source that was accepted" as const;

/**
 * F102-FR-020 — the fact for the critic: the member of the closed set, the
 * file, its logical name and the two hashes. NO count and NO detail of HOW
 * the change was accepted reaches the critic.
 */
export const THE_CRITIC_RECEIVES_NO_COUNT_AND_NO_HOW = true as const;

/** One fact of the `facts` list of the fact block (annex D §D.7). */
export type AcceptedChangeFact = {
  readonly fact: typeof FACT_MEMBER;
  readonly file: AcceptedSource;
  readonly changedRef: string;
  readonly oldHash: string;
  readonly newHash: string;
};

/**
 * F102-FR-020 — the fact of ONE accepted change, for the fact block.
 */
export function factOfAcceptedChange(change: AcceptedChangeRecord): AcceptedChangeFact {
  return Object.freeze({
    fact: FACT_MEMBER,
    file: change.file,
    changedRef: change.changedRef,
    oldHash: change.oldHash,
    newHash: change.newHash,
  });
}

/**
 * F102-FR-020 — the fact for EVERY critic of the run, for the rest of the
 * run: one fact per accepted change, in the order the snapshot holds them.
 */
export function factsForCritics(
  changes: readonly AcceptedChangeRecord[],
): readonly AcceptedChangeFact[] {
  return Object.freeze(changes.map(factOfAcceptedChange));
}
