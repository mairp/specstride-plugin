/**
 * T036 — the type and the validator of workspace record (annex B, §B.6).
 *
 * Schema id `specstride.layout/1`, logical name `workspace:record`. The type is
 * generated from `schemas/workspace-record.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-059.
 */
import type { WorkspaceRecord } from "./generated/workspace-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { WorkspaceRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.layout/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "workspace:record" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.6" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.6 is required (F100-FR-048, F100-FR-049).
 */
export function readWorkspaceRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): WorkspaceRecord {
  return readRecord<WorkspaceRecord>(logicalName, value);
}

/** `readWorkspaceRecord` that returns a result instead of throwing. */
export function tryReadWorkspaceRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: WorkspaceRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<WorkspaceRecord>(logicalName, value);
}

/** True when the value validates against `specstride.layout/1`. */
export function isWorkspaceRecord(value: unknown): value is WorkspaceRecord {
  return validate<WorkspaceRecord>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-059 — a launch whose lock provider differs from the recorded one is
 * refused with a doctor finding.
 */
export function lockProviderMatches(
  record: WorkspaceRecord,
  lockProvider: { id: string; version: string },
): boolean {
  const recorded = record.lockProvider as { id?: string; version?: string } | undefined;
  return recorded !== undefined && recorded.id === lockProvider.id;
}

/**
 * F100-FR-059 — a launch in a workspace whose spec shows ticked phases that
 * have no approval record is refused, and the refusal names the three
 * commands of §B.19.
 */
export const COMMANDS_NAMED_ON_TICKED_PHASE_WITHOUT_APPROVAL = [
  "state export",
  "state import",
  "state adopt",
] as const;

export function refusalForTickedPhasesWithoutApproval(
  tickedPhases: readonly number[],
  approvedPhases: readonly number[],
): string | undefined {
  const missing = tickedPhases.filter((p) => !approvedPhases.includes(p));
  if (missing.length === 0) return undefined;
  return (
    `the spec shows phase ${missing.join(", ")} ticked with no approval record; ` +
    `use ${COMMANDS_NAMED_ON_TICKED_PHASE_WITHOUT_APPROVAL.join(", ")} (F100-FR-059)`
  );
}
