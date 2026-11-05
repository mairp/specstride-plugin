/**
 * T044 — the assembly of a shipped event (F128-FR-023).
 *
 * F128-FR-023: *A shipped event MUST be assembled from the fields of the
 * event, and MUST have the low-cardinality identity `task` and `backend` as
 * labels (as-is form). `run_id` and `iter` MUST be fields and never labels,
 * and when they are given in addition to the fields of the event they MUST be
 * appended after them, the last value winning. Fields given as explicit pairs
 * MUST override the fields of a JSON object; a bare key MUST mean the value
 * true; a JSON object that cannot be read MUST be ignored; the keys `event`
 * and `time` MUST never be fields. An event with no name MUST ship nothing
 * and give one warning. The event `api_request` MUST have the fields
 * `run_id`, `iter`, `model`, `is_error`, `subtype`, `cost_usd`, `duration_ms`,
 * `duration_api_ms`, `num_turns`, `input_tokens`, `output_tokens`,
 * `cache_read_tokens`, `cache_creation_tokens`, and `result_preview` only
 * while content capture is on, and the event `tool_use` MUST have `run_id`,
 * `iter`, `tool` and `model`. The event `gate` MUST carry the field
 * `result`.*
 *
 * The module RETURNS the assembled fields and the logfmt line; it prints
 * nothing. The warning for an event with no name is the text of F128-FR-025
 * (`event mode needs --event NAME`), imported from the warnings module.
 */
import { encodeLogfmt } from "./logfmt.ts";
import { EVENT_MODE_NEEDS_NAME } from "../delivery/warnings.ts";

/** The keys that are never fields of a shipped event (F128-FR-023). */
export const KEYS_NEVER_FIELDS: readonly string[] = Object.freeze(["event", "time"]);

/** The fields of the event `api_request`, in order (F128-FR-023). */
export const API_REQUEST_FIELDS: readonly string[] = Object.freeze([
  "run_id",
  "iter",
  "model",
  "is_error",
  "subtype",
  "cost_usd",
  "duration_ms",
  "duration_api_ms",
  "num_turns",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
]);

/** The content field of `api_request`, shipped only while capture is on. */
export const RESULT_PREVIEW_FIELD = "result_preview" as const;

/** The fields of the event `tool_use` (F128-FR-023). */
export const TOOL_USE_FIELDS: readonly string[] = Object.freeze([
  "run_id",
  "iter",
  "tool",
  "model",
]);

/** The field the event `gate` must carry (F128-FR-023). */
export const GATE_RESULT_FIELD = "result" as const;

/** The identity fields that are never labels and are appended last. */
export const RUN_IDENTITY_FIELDS: readonly string[] = Object.freeze(["run_id", "iter"]);

/**
 * Parse explicit pairs (`key=value`, or a bare `key` meaning `true`) over the
 * fields of one JSON object. A pair overrides the object's field of the same
 * key; a JSON object that cannot be read is IGNORED, never thrown; the keys
 * `event` and `time` are dropped from both sources.
 */
export function parseShippedFields(
  pairs: readonly string[],
  jsonObjectJson?: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  // The JSON object first: the explicit pairs are applied over it.
  if (jsonObjectJson !== undefined && jsonObjectJson !== "") {
    try {
      const parsed: unknown = JSON.parse(jsonObjectJson);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.getPrototypeOf(parsed) === Object.prototype
      ) {
        Object.assign(fields, parsed as Record<string, unknown>);
      }
    } catch {
      // A JSON object that cannot be read is ignored (F128-FR-023).
    }
  }
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      fields[pair] = true; // a bare key means the value true
      continue;
    }
    fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return dropNeverFields(fields);
}

/** Drop the keys `event` and `time` from a field map (F128-FR-023). */
export function dropNeverFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (KEYS_NEVER_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Append `run_id` and `iter` AFTER the fields of the event, the last value
 * winning. They are fields, never labels (F128-FR-021, F128-FR-023).
 */
export function appendRunIdentity(
  fields: Record<string, unknown>,
  runId?: string,
  iter?: string | number,
): Record<string, unknown> {
  const out = { ...fields };
  if (runId !== undefined) out["run_id"] = runId;
  if (iter !== undefined) out["iter"] = iter;
  return out;
}

/** The input of `assembleShippedEvent`. */
export type ShippedEventInput = {
  /** The name the event ships under; `undefined` ships nothing. */
  readonly name?: string | null;
  /** The fields of the event, already assembled. */
  readonly fields?: Record<string, unknown>;
  /** Explicit pairs (as-is mode), applied over `jsonObjectJson`. */
  readonly pairs?: readonly string[];
  /** The JSON object whose fields the pairs override. */
  readonly jsonObjectJson?: string;
  /** The run id, appended last when given. */
  readonly runId?: string;
  /** The iteration, appended last when given. */
  readonly iter?: string | number;
  /** Whether content capture is on (`result_preview` ships only while it is). */
  readonly contentCapture?: boolean;
};

/** What `assembleShippedEvent` returns. */
export type ShippedEvent = {
  /** The name the event ships under; `null` when nothing ships. */
  readonly name: string | null;
  /** The assembled fields; empty when nothing ships. */
  readonly fields: Record<string, unknown>;
  /** The logfmt line — the body of the Loki entry and the OTLP log record. */
  readonly line: string;
  /** The one warning when nothing ships (the event had no name); else null. */
  readonly warning: string | null;
};

/**
 * Assemble one shipped event (F128-FR-023). An event with no name ships
 * NOTHING and gives ONE warning; `api_request` and `tool_use` are projected
 * onto their field lists (`result_preview` only while capture is on); `gate`
 * carries `result`; everything else keeps the fields it was given.
 */
export function assembleShippedEvent(input: ShippedEventInput): ShippedEvent {
  try {
    const name = typeof input.name === "string" && input.name !== "" ? input.name : null;
    if (name === null) {
      return {
        name: null,
        fields: {},
        line: "",
        warning: EVENT_MODE_NEEDS_NAME,
      };
    }
    const parsed =
      input.pairs || input.jsonObjectJson !== undefined
        ? parseShippedFields(input.pairs ?? [], input.jsonObjectJson)
        : dropNeverFields({ ...(input.fields ?? {}) });
    const withIdentity = appendRunIdentity(parsed, input.runId, input.iter);
    const fields = projectFields(name, withIdentity, input.contentCapture === true);
    return { name, fields, line: encodeLogfmt(fields), warning: null };
  } catch {
    // Best-effort: a malformed input ships nothing and never throws.
    return { name: null, fields: {}, line: "", warning: EVENT_MODE_NEEDS_NAME };
  }
}

/**
 * Project the fields of the two stream metric events onto the lists of the
 * requirement, keep `result` on `gate`, and leave every other event as it is.
 */
export function projectFields(
  name: string,
  fields: Record<string, unknown>,
  contentCapture: boolean,
): Record<string, unknown> {
  if (name === "api_request") {
    return pickFields(fields, [
      ...API_REQUEST_FIELDS,
      ...(contentCapture ? [RESULT_PREVIEW_FIELD] : []),
    ]);
  }
  if (name === "tool_use") return pickFields(fields, TOOL_USE_FIELDS);
  if (name === "gate") return pickFields(fields, [GATE_RESULT_FIELD]);
  return { ...fields };
}

/** Keep only the named keys, in the named order, when the source holds them. */
function pickFields(
  fields: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}
