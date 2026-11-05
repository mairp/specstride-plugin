/**
 * T002 — the schema-validated readers of run control (feature 102).
 *
 * The CLI reads three records of annex B through the validators of
 * `@specstride/contracts`:
 *
 * - the stop request, `specstride.inbox/1`, type `stop`, logical name
 *   `inbox:stop` (annex B §B.11; contracts/stop-request.md);
 * - the run snapshot, `specstride.snapshot/1`, logical name
 *   `run:<runId>:snapshot` (annex B §B.12);
 * - the launch record, `specstride.launch/1`, logical name
 *   `launch:<launchId>:record` (annex B §B.7).
 *
 * Every reader refuses a missing field `schema`, an unknown schema id and a
 * major other than the one supported with the message of the annex — the
 * logical name, the major found, the major supported (F100-FR-048,
 * F100-FR-049). The one stated exception is the stop request: empty or
 * unreadable means a clean stop with the defaults (F102-FR-001;
 * contracts/stop-request.md), so `readStopRequestFromFile` reports `clean`
 * instead of a record for it.
 *
 * The module reads no clock: the time of a request stays in the record.
 */
import { readFileSync } from "node:fs";
import {
  SCHEMA_ID as INBOX_SCHEMA_ID,
  LOGICAL_NAME as STOP_LOGICAL_NAME,
  EMPTY_STOP_REQUEST_CARRIES_NO_FIELD,
  STOP_DEFAULTS,
  tryReadInboxRequest,
  type InboxRequest,
} from "@specstride/contracts/records/inbox-request";
import {
  SCHEMA_ID as SNAPSHOT_SCHEMA_ID,
  LOGICAL_NAME as SNAPSHOT_LOGICAL_NAME,
  tryReadRunSnapshot,
  type RunSnapshot,
} from "@specstride/contracts/records/run-snapshot";
import {
  SCHEMA_ID as LAUNCH_SCHEMA_ID,
  LOGICAL_NAME as LAUNCH_LOGICAL_NAME,
  tryReadLaunchRecord,
  type LaunchRecord,
} from "@specstride/contracts/records/launch-record";
import { RecordRefusedError } from "@specstride/contracts/records/validate";

export {
  INBOX_SCHEMA_ID,
  SNAPSHOT_SCHEMA_ID,
  LAUNCH_SCHEMA_ID,
  STOP_LOGICAL_NAME,
  SNAPSHOT_LOGICAL_NAME,
  LAUNCH_LOGICAL_NAME,
  EMPTY_STOP_REQUEST_CARRIES_NO_FIELD,
  STOP_DEFAULTS,
};

/** The request type the stop request carries (annex X §X.6 row 21). */
export const STOP_REQUEST_TYPE = "stop" as const;

/** The result of a schema-validated read: the record, or the refusal. */
export type RecordRead<T> =
  | { readonly ok: true; readonly record: T }
  | {
      readonly ok: false;
      readonly error: RecordRefusedError;
    };

/**
 * Read a value as the stop request `specstride.inbox/1` (§B.11). The request
 * must be of type `stop`: another member of the closed set of request types
 * is refused, because the logical name `inbox:stop` holds only that type
 * (F102-FR-001).
 */
export function readStopRequest(value: unknown): RecordRead<InboxRequest> {
  const result = tryReadInboxRequest(value, STOP_LOGICAL_NAME);
  if (!result.ok) return result;
  if (result.record.type !== STOP_REQUEST_TYPE) {
    return {
      ok: false,
      error: new RecordRefusedError({
        logicalName: STOP_LOGICAL_NAME,
        majorFound: String(result.record.type ?? ""),
        majorSupported: STOP_REQUEST_TYPE,
        reason: "invalid",
        message:
          `refused the record of the logical name "${STOP_LOGICAL_NAME}": ` +
          `the type found is ${String(result.record.type)}, ` +
          `the type supported is ${STOP_REQUEST_TYPE}`,
      }),
    };
  }
  return result;
}

/** Read a value as the run snapshot `specstride.snapshot/1` (§B.12). */
export function readRunSnapshot(value: unknown): RecordRead<RunSnapshot> {
  return tryReadRunSnapshot(value, SNAPSHOT_LOGICAL_NAME);
}

/** Read a value as the launch record `specstride.launch/1` (§B.7). */
export function readLaunchRecord(value: unknown): RecordRead<LaunchRecord> {
  return tryReadLaunchRecord(value, LAUNCH_LOGICAL_NAME);
}

/** Read the launch record of a workspace from its file (§B.7). */
export function readLaunchRecordFromFile(path: string): RecordRead<LaunchRecord> {
  return readLaunchRecord(JSON.parse(readFileSync(path, "utf8")));
}

/** What reading the stop request file found (contracts/stop-request.md). */
export type StopRequestRead =
  | { readonly clean: true; readonly now: false; readonly jobs: false }
  | { readonly clean: false; readonly request: InboxRequest };

/**
 * Read the stop request of a workspace from its file (F102-FR-001).
 *
 * A file that is absent, unreadable or empty — the empty request carries no
 * field at all, `schema` included (F100-FR-065) — is a clean stop with the
 * defaults: `now` and `jobs` false, `causedBy` `operator`. A file that is
 * present and readable is validated as `specstride.inbox/1`, type `stop`.
 */
export function readStopRequestFromFile(path: string): StopRequestRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { clean: true, now: false, jobs: false };
  }
  if (text.trim() === "") return { clean: true, now: false, jobs: false };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { clean: true, now: false, jobs: false };
  }
  if (typeof value !== "object" || value === null || Object.keys(value).length === 0) {
    return { clean: true, now: false, jobs: false };
  }
  const read = readStopRequest(value);
  if (!read.ok) return { clean: true, now: false, jobs: false };
  return { clean: false, request: read.record };
}
