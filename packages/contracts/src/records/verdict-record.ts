/**
 * T002 of feature 101 — the type and the validator of the verdict record
 * (`specs/101-gate-and-verdict/data-model.md`, "Verdict record").
 *
 * Schema id `specstride.verdict/1`, logical name `attempt:<N>:<k>:<n>:verdict`.
 * The type is generated from `schemas/verdict-record.schema.json` (the `build`
 * script of the package); this module gives the validator over it and the
 * validation the table states: exactly one `verdict`; `detail` present only
 * with MALFORMED; at least one entry in `calls`; the session id of no call
 * equals a session id of a pass of the phase attempt.
 */
import type { VerdictRecord } from "./generated/verdict-record.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";
import { detailsOfAMalformedVerdict } from "../enums/all-sets.ts";

export type { VerdictRecord };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.verdict/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "attempt:<N>:<k>:<n>:verdict" as const;

/** The table that owns the field list. */
export const ANNEX_SECTION = 'feature 101, data-model.md, "Verdict record"' as const;

/** The verdict that carries a `detail`: MALFORMED, and no other. */
export const VERDICT_WITH_A_DETAIL = "MALFORMED" as const;

/** Row 251 of annex X §X.6 — the details of a MALFORMED verdict. */
export const details = detailsOfAMalformedVerdict;

/** Read the record through its logical name (F100-FR-048, F100-FR-049). */
export function readVerdictRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): VerdictRecord {
  return readRecord<VerdictRecord>(logicalName, value);
}

/** `readVerdictRecord` that returns a result instead of throwing. */
export function tryReadVerdictRecord(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: VerdictRecord } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<VerdictRecord>(logicalName, value);
}

/** True when the value validates against `specstride.verdict/1`. */
export function isVerdictRecord(value: unknown): value is VerdictRecord {
  return validate<VerdictRecord>(SCHEMA_ID, value).ok;
}

/** What `verdictRecordIsConsistent` refused, in the words of the table. */
export type VerdictRecordFault =
  "detail-without-malformed" | "malformed-without-detail" | "no-call" | "session-of-a-pass";

/**
 * The validation of the table, as a list of what the record breaks. An empty
 * list means the record keeps every rule. `sessionIdsOfThePasses` is the set of
 * session ids of the passes of the phase attempt; the session id of no call may
 * be one of them.
 */
export function verdictRecordFaults(
  record: VerdictRecord,
  sessionIdsOfThePasses: readonly string[] = [],
): readonly VerdictRecordFault[] {
  const faults: VerdictRecordFault[] = [];
  const malformed = record.verdict === VERDICT_WITH_A_DETAIL;
  if (!malformed && record.detail !== undefined) faults.push("detail-without-malformed");
  if (malformed && record.detail === undefined) faults.push("malformed-without-detail");
  const calls = Array.isArray(record.calls) ? record.calls : [];
  if (calls.length === 0) faults.push("no-call");
  const ofAPass = new Set(sessionIdsOfThePasses);
  for (const call of calls) {
    const sessionId = (call as { sessionId?: unknown }).sessionId;
    if (typeof sessionId === "string" && ofAPass.has(sessionId)) {
      faults.push("session-of-a-pass");
      break;
    }
  }
  return Object.freeze(faults);
}

/** True when the record keeps every rule of the table. */
export function verdictRecordIsConsistent(
  record: VerdictRecord,
  sessionIdsOfThePasses: readonly string[] = [],
): boolean {
  return verdictRecordFaults(record, sessionIdsOfThePasses).length === 0;
}
