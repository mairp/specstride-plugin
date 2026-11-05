/**
 * T164 — the type and the validator of the withheld paths from
 * `schemas/withheld-paths.schema.json` (annex C, §C.4; F100-FR-089).
 *
 * Schema id `specstride.withheld-paths/1`, logical name
 * `attempt:<N>:<k>:<n>:withheld-paths`: one record per critic-class call of
 * the second form of §C.3. The engine writes it; the harness adapter of the
 * critic and the call record read it.
 */
import type { WithheldPaths as Generated } from "./generated/withheld-paths.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.withheld-paths/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "attempt:<N>:<k>:<n>:withheld-paths" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.4" as const;

/** The content owner of §C.4. */
export const CONTENT_OWNER = "117" as const;

/**
 * F100-FR-089 — the five locations the list holds. They are the logical names
 * of annex B §B.5 whose real paths the sandbox must deny for reading.
 */
export const DENIED_LOCATIONS = [
  "workspace-part",
  "control-plane",
  "event-stream",
  "worker-root",
  "tree-store",
] as const;
export type DeniedLocation = (typeof DENIED_LOCATIONS)[number];

/** F100-FR-089 — the list holds the five locations of §C.4, no fewer. */
export const DENIED_LOCATION_COUNT = 5 as const;

/** One entry of `deny`: the logical root and the real path. */
export type DenyEntry = {
  readonly root: DeniedLocation | (string & {});
  readonly realPath: string;
};

/** The three files of the proposer that are moved out of the working tree. */
export const MOVED_FILES = ["notebook", "handoff", "outbox"] as const;
export type MovedFile = (typeof MOVED_FILES)[number];

/** One entry of `moved`: which file, where it was, and where it is kept. */
export type MovedEntry = {
  readonly file: MovedFile | (string & {});
  readonly from: string;
  readonly keptAt: string;
};

/** The withheld paths of one critic-class call of the second form (annex C, §C.4). */
export type WithheldPaths = Omit<Generated, "deny" | "moved"> & {
  readonly deny: readonly DenyEntry[];
  readonly moved: readonly MovedEntry[];
};

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §C.4 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readWithheldPaths(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): WithheldPaths {
  return readRecord<WithheldPaths>(logicalName, value);
}

/** `readWithheldPaths` that returns a result instead of throwing. */
export function tryReadWithheldPaths(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: WithheldPaths } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<WithheldPaths>(logicalName, value);
}

/** True when the value validates against `specstride.withheld-paths/1`. */
export function isWithheldPaths(value: unknown): value is WithheldPaths {
  return validate<WithheldPaths>(SCHEMA_ID, value).ok;
}

/** The locations of §C.4 that a list of `deny` entries does not hold. */
export function missingLocations(record: WithheldPaths): readonly DeniedLocation[] {
  const held = new Set(record.deny.map((entry) => entry.root));
  return Object.freeze(DENIED_LOCATIONS.filter((location) => !held.has(location)));
}

/** F100-FR-089 — the list holds the five locations of §C.4. */
export function holdsTheFiveLocations(record: WithheldPaths): boolean {
  return missingLocations(record).length === 0;
}

/* ------------------------------------------------------------------ *
 * F100-FR-089 — the confirmation, and what happens without it.
 * ------------------------------------------------------------------ */

/** F100-FR-089 — the harness adapter confirms the denial before the call. */
export const CONFIRMATION_IS_MADE_BEFORE_THE_CALL = true as const;

/** The failure a configured critic is refused with, without the confirmation. */
export const FAILURE_WITHOUT_THE_CONFIRMATION = "critic_not_toolless" as const;

/** What a critic that the consumer configured and one picked automatically do. */
export const WITHOUT_CONFIRMATION = Object.freeze({
  configured: Object.freeze({
    outcome: "refused" as const,
    failure: FAILURE_WITHOUT_THE_CONFIRMATION,
  }),
  automaticallyPicked: Object.freeze({
    outcome: "passed-over" as const,
    /** The next candidate of the critic order of §C.6. */
    takes: "the next candidate of the critic order" as const,
    announced: true as const,
    recorded: true as const,
  }),
});

/**
 * F100-FR-089 — without the confirmation the second form is not used: a
 * configured critic is refused with `critic_not_toolless`, and an
 * automatically picked one is passed over for the next candidate of the
 * critic order, announced and recorded.
 */
export function outcomeWithoutConfirmation(
  pick: "configured" | "automaticallyPicked",
): (typeof WITHOUT_CONFIRMATION)[keyof typeof WITHOUT_CONFIRMATION] {
  return WITHOUT_CONFIRMATION[pick];
}

/** True when the record allows the second form of §C.3 to be used. */
export function secondFormMayBeUsed(record: WithheldPaths): boolean {
  return record.confirmed === true && holdsTheFiveLocations(record);
}

/**
 * The status of §C.4: the check that the read-only sandbox of the first
 * harness of this form denies reads of the paths of the list is unverified
 * until a capture of that harness shows it.
 */
export const STATUS = "unverified" as const;
