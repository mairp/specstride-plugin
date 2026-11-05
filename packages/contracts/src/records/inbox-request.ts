/**
 * T046 — the type and the validator of inbox request (annex B, §B.11).
 *
 * Schema id `specstride.inbox/1`, logical name `inbox:stop`. The type is
 * generated from `schemas/inbox-request.schema.json` (T009); this module gives the
 * validator over it and the rules of F100-FR-065.
 */
import type { InboxRequest } from "./generated/inbox-request.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

export type { InboxRequest };

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.inbox/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "inbox:stop" as const;

/** The section of annex B that owns the field list. */
export const ANNEX_SECTION = "annex B, §B.11" as const;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of
 * §B.11 is required (F100-FR-048, F100-FR-049).
 */
export function readInboxRequest(value: unknown, logicalName: string = LOGICAL_NAME): InboxRequest {
  return readRecord<InboxRequest>(logicalName, value);
}

/** `readInboxRequest` that returns a result instead of throwing. */
export function tryReadInboxRequest(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: InboxRequest } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<InboxRequest>(logicalName, value);
}

/** True when the value validates against `specstride.inbox/1`. */
export function isInboxRequest(value: unknown): value is InboxRequest {
  return validate<InboxRequest>(SCHEMA_ID, value).ok;
}

/** The closed set of inbox request types (annex X §X.6 row 21; F100-FR-065). */
export const INBOX_REQUEST_TYPES = ["stop", "hold-relaunch", "host-event"] as const;
export type InboxRequestType = (typeof INBOX_REQUEST_TYPES)[number];

/** The three logical names of the inbox (§B.11). */
export const INBOX_NAMES = [
  "inbox:stop",
  "inbox:hold-relaunch",
  "inbox:host-events:<launchId>",
] as const;

/**
 * F100-FR-065 — an empty stop request means a clean stop with every default.
 * It is the one record of annex B that carries no field, `schema` included.
 */
export const EMPTY_STOP_REQUEST_CARRIES_NO_FIELD = true as const;

export type StopDefaults = {
  readonly now: boolean;
  readonly jobs: boolean;
  readonly causedBy: "operator";
};

export const STOP_DEFAULTS: StopDefaults = Object.freeze({
  now: false,
  jobs: false,
  causedBy: "operator" as const,
});

export function readStopRequest(value: unknown): StopDefaults {
  if (typeof value !== "object" || value === null || Object.keys(value).length === 0) {
    return STOP_DEFAULTS;
  }
  const r = value as Record<string, unknown>;
  return Object.freeze({
    now: r.now === true,
    jobs: r.jobs === true,
    causedBy: (r.causedBy as StopDefaults["causedBy"]) ?? "operator",
  });
}

/** A host event informs only: it never pauses, stops or relaunches a run. */
export const HOST_EVENT_INFORMS_ONLY = true as const;
