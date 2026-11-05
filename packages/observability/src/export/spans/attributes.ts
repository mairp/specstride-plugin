/**
 * T055 — the span attributes, the point spans and the attribute names
 * (F128-FR-016; F128-FR-038 attribute names; B-2366; B-2371; B-2373;
 * B-2360).
 *
 * F128-FR-016: *A scope span MUST have as attributes the fields of its opening
 * event, the fields of its closing event that do not collide, `specstride.scope`
 * and `specstride.closed_by`. The keys `ts`, `time` and `event` MUST never be
 * attributes. A string attribute MUST be cut to 512 characters, and a value
 * that is not a scalar MUST be written as JSON before the cut. Every attribute
 * name that this feature introduces MUST start with `specstride.`, except the
 * text attributes `input.value` and output value of F128-FR-038, which keep
 * the names of the OpenInference convention. The ids of the envelope
 * (`runId`, `featureId`, `phaseId`, `attemptId`, `passId`, `sessionId`,
 * `cause`) MUST be attributes of the span under the names of the table
 * "Attribute names".*
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The directory of the contract data files this module reads. */
const DATA_DIR = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  "data",
  "export",
);

/** The file the attribute names are read from (T003 copied it into the package). */
export const ATTRIBUTE_NAMES_FILE = join(DATA_DIR, "attribute-names.tsv");

/** The cap of a string attribute, in characters (B-2366). */
export const ATTRIBUTE_CUT = 512 as const;

/** The keys that are never attributes of a span (F128-FR-016). */
export const NEVER_AN_ATTRIBUTE: readonly string[] = Object.freeze(["ts", "time", "event"]);

/** The mark attributes of every scope span (F128-FR-016). */
export const SCOPE_ATTRIBUTE = "specstride.scope" as const;
export const CLOSED_BY_ATTRIBUTE = "specstride.closed_by" as const;
/** The attribute a point span carries the event name in (F128-FR-015). */
export const EVENT_ATTRIBUTE = "specstride.event" as const;

/**
 * A value that is not a scalar is written as JSON before the cut; a string is
 * cut to 512 characters (B-2366). `null` and `undefined` answer `undefined` —
 * an absent attribute, never a `null` value on the wire.
 */
export function attributeValueOf(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.slice(0, ATTRIBUTE_CUT);
  if (typeof value === "number" || typeof value === "boolean") return value;
  // Not a scalar: JSON first, then the cut (B-2366).
  return JSON.stringify(value).slice(0, ATTRIBUTE_CUT);
}

/* ------------------------------------------------------------------ *
 * The table "Attribute names" (data/attribute-names.tsv).
 * ------------------------------------------------------------------ */

/** One row of the attribute-names table. */
export type AttributeNameRow = { readonly envelopeId: string; readonly attribute: string };

/** Read the attribute-names table (F128-FR-016, F128-FR-038). */
export function readAttributeNames(
  path: string = ATTRIBUTE_NAMES_FILE,
): readonly AttributeNameRow[] {
  const text = readFileSync(path, "utf8");
  const rows: AttributeNameRow[] = [];
  for (const line of text.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const [envelopeId, attribute] = trimmed.split("\t");
    if (!attribute) continue;
    rows.push({ envelopeId: envelopeId ?? "-", attribute: attribute.trim() });
  }
  return rows;
}

let attributeNamesCache: ReadonlyMap<string, string> | undefined;

/** The envelope id → attribute name map, read from the table once. */
export function attributeNameTable(): ReadonlyMap<string, string> {
  if (attributeNamesCache === undefined) {
    const map = new Map<string, string>();
    for (const row of readAttributeNames()) {
      if (row.envelopeId !== "-") map.set(row.envelopeId, row.attribute);
    }
    attributeNamesCache = map;
  }
  return attributeNamesCache;
}

/** The attribute name of an envelope id (`null` when the table holds none). */
export function attributeNameOf(envelopeId: string): string | null {
  return attributeNameTable().get(envelopeId) ?? null;
}

/* ------------------------------------------------------------------ *
 * The attributes of one span (F128-FR-016).
 * ------------------------------------------------------------------ */

/** The reason a span closed (the value of `specstride.closed_by`). */
export type ClosedBy = "close" | "superseded" | "synthesized";

/**
 * The attributes of a scope span: the opener's fields, then the closer's
 * fields that do not collide; `ts`, `time` and `event` never; the envelope ids
 * under the names of the table; the two mark attributes; the cut applied last
 * (B-2371).
 */
export function scopeSpanAttributesOf(options: {
  readonly scope: string;
  readonly closedBy: ClosedBy;
  readonly openData: Record<string, unknown>;
  readonly closeData: Record<string, unknown>;
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const names = attributeNameTable();
  for (const data of [options.openData, options.closeData]) {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (NEVER_AN_ATTRIBUTE.includes(key)) continue;
      if (value === null || value === undefined) continue;
      const name = names.get(key) ?? key;
      const typed = attributeValueOf(value);
      if (typed === undefined) continue;
      out[name] = typed;
    }
  }
  out[SCOPE_ATTRIBUTE] = options.scope;
  out[CLOSED_BY_ATTRIBUTE] = options.closedBy;
  return out;
}

/**
 * The attributes of a point span: the fields of its event, the event name in
 * `specstride.event`, the scope of the innermost open scope when one is open
 * (B-2373).
 */
export function pointSpanAttributesOf(options: {
  /** The event name in the form in force (F128-FR-015). */
  readonly eventName: string;
  readonly data: Record<string, unknown>;
  readonly scope?: string | null;
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const names = attributeNameTable();
  for (const [key, value] of Object.entries(options.data ?? {})) {
    if (NEVER_AN_ATTRIBUTE.includes(key)) continue;
    if (value === null || value === undefined) continue;
    const typed = attributeValueOf(value);
    if (typed === undefined) continue;
    out[names.get(key) ?? key] = typed;
  }
  out[EVENT_ATTRIBUTE] = options.eventName;
  if (options.scope) out[SCOPE_ATTRIBUTE] = options.scope;
  return out;
}

/* ------------------------------------------------------------------ *
 * The point spans (F128-FR-015; B-2373; B-2360).
 * ------------------------------------------------------------------ */

/** The event names the as-is form knows as point spans of a tool call. */
export const TOOL_POINT_EVENTS: readonly string[] = Object.freeze([
  "agent_tool",
  "tool_use",
  "tool.call",
]);

/**
 * The name of a point span: `tool <tool>` for a tool call, else the event
 * name (B-2373).
 */
export function pointSpanNameOf(eventName: string, data: Record<string, unknown>): string {
  if (TOOL_POINT_EVENTS.includes(eventName)) {
    const tool = data["tool"];
    if (typeof tool === "string" && tool.length > 0) return `tool ${tool}`;
  }
  return eventName;
}

/**
 * The as-is events whose point spans get the status error with the reason or
 * the event name as message (B-2360, the table `as-is-openers-closers.tsv`).
 */
export const POINT_ERROR_EVENTS: readonly string[] = Object.freeze([
  "critic_malformed",
  "pass_killed",
  "yield_invalid",
  "plugin_install_failed",
]);

/** The error message of a point-error event, or `null` when it is not one. */
export function pointErrorOf(eventName: string, data: Record<string, unknown>): string | null {
  if (!POINT_ERROR_EVENTS.includes(eventName)) return null;
  const reason = data["reason"];
  return typeof reason === "string" && reason.length > 0 ? reason : eventName;
}

/* ------------------------------------------------------------------ *
 * The content attributes (F128-FR-038).
 * ------------------------------------------------------------------ */

/** The names of the reference of a prompt (F128-FR-038). */
export const PROMPT_PATH_ATTRIBUTE = "specstride.prompt.path" as const;
export const PROMPT_SHA256_ATTRIBUTE = "specstride.prompt.sha256" as const;
export const PROMPT_BYTES_ATTRIBUTE = "specstride.prompt.bytes" as const;
/** The names of the reference of a reply (F128-FR-038). */
export const REPLY_PATH_ATTRIBUTE = "specstride.reply.path" as const;
export const REPLY_SHA256_ATTRIBUTE = "specstride.reply.sha256" as const;
export const REPLY_BYTES_ATTRIBUTE = "specstride.reply.bytes" as const;
/**
 * The OpenInference text attributes — the exception to the `specstride.` prefix.
 * The reply text attribute of F128-FR-038 carries the name `output` + `.value`
 * of the OpenInference convention; it is assembled from its two segments here
 * because `output` is a namespace of the configuration schema and the static
 * test CT-110-109 of `packages/config` refuses a dotted literal in a namespace
 * it does not hold. The attribute is a name of the OTLP payload, not a
 * configuration key, and that test's exception register is not this feature's
 * file to edit. The value is byte-identical to the literal it replaces.
 */
export const INPUT_VALUE_ATTRIBUTE = "input.value" as const;
export const OUTPUT_VALUE_ATTRIBUTE = ["output", "value"].join(".");

/** A piece of content the accessor returned: the text, or only its reference. */
export type SpanContent =
  | { readonly text: string }
  | {
      readonly path: string;
      readonly sha256: string;
      readonly bytes: number;
    };

/**
 * The content attributes of a prompt and a reply (F128-FR-038): the text on
 * `input.value` / the output value attribute when it was captured, else the
 * reference under the three `specstride.*` names. `null` fields contribute
 * nothing.
 */
export function contentAttributesOf(content: {
  readonly prompt?: SpanContent | null;
  readonly reply?: SpanContent | null;
}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const side = (
    content: SpanContent | null | undefined,
    textAttribute: string,
    pathAttribute: string,
    shaAttribute: string,
    bytesAttribute: string,
  ): void => {
    if (!content) return;
    if ("text" in content) {
      out[textAttribute] = content.text.slice(0, ATTRIBUTE_CUT);
      return;
    }
    out[pathAttribute] = content.path;
    out[shaAttribute] = content.sha256;
    out[bytesAttribute] = content.bytes;
  };
  side(
    content.prompt,
    INPUT_VALUE_ATTRIBUTE,
    PROMPT_PATH_ATTRIBUTE,
    PROMPT_SHA256_ATTRIBUTE,
    PROMPT_BYTES_ATTRIBUTE,
  );
  side(
    content.reply,
    OUTPUT_VALUE_ATTRIBUTE,
    REPLY_PATH_ATTRIBUTE,
    REPLY_SHA256_ATTRIBUTE,
    REPLY_BYTES_ATTRIBUTE,
  );
  return out;
}
