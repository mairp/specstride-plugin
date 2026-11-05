/**
 * T067 — no log record and no Loki line carries content (F128-FR-039).
 *
 * F128-FR-039: *No log record and no Loki line MUST carry prompt or reply
 * content, whatever the capture setting is. A release MUST be blocked until
 * the pattern set of the redactor of annex X §X.4 (F100-FR-205) passes the
 * canary test of annex X §X.9 (F100-FR-219) on both sinks with capture on:
 * canaries of every class of the pattern set and a registered secret, planted
 * in the prompt, the reply, the tool arguments, the tool output, the phase
 * evidence, the output of a check and the consumer's comment, MUST not appear
 * in any payload at the stub sink, on any span or on any log line.*
 *
 * Content lives on SPANS and only on spans (F128-FR-038). The log record of
 * an event and the logfmt line of a Loki entry are built from the fields of
 * the event, and an event can carry a prompt or a reply field; the
 * enforcement is here, in one place, ahead of both encoders: the fields whose
 * name is a content name are dropped from the record, and the pairs whose key
 * is a content name are dropped from the line. The scan that CT-128-13 runs
 * over the finished payloads is the second, independent half of the
 * enforcement — this module is the half that keeps the content out in the
 * first place.
 */
import { INPUT_VALUE_ATTRIBUTE, OUTPUT_VALUE_ATTRIBUTE } from "../spans/attributes.ts";

/** The requirement, as a constant a reader can grep. */
export const NO_CONTENT_IN_LOG_RECORDS_OR_LOKI_LINES = true as const;

/**
 * The attribute names of F128-FR-038 that a log record or a Loki line never
 * carries, whatever the capture setting is.
 */
export const CONTENT_ATTRIBUTE_NAMES: readonly string[] = Object.freeze([
  INPUT_VALUE_ATTRIBUTE,
  OUTPUT_VALUE_ATTRIBUTE,
  "specstride.prompt.path",
  "specstride.prompt.sha256",
  "specstride.prompt.bytes",
  "specstride.reply.path",
  "specstride.reply.sha256",
  "specstride.reply.bytes",
]);

/**
 * The event field names that hold prompt or reply content. A record built
 * from the fields of an event drops these before it becomes a log record or
 * a Loki line, whatever the capture setting is.
 */
export const CONTENT_EVENT_FIELDS: readonly string[] = Object.freeze([
  "prompt",
  "reply",
  "prompt_text",
  "reply_text",
  "promptText",
  "replyText",
]);

/** True when a field name is a content name (attribute or event field). */
export function isAContentName(name: string): boolean {
  return CONTENT_ATTRIBUTE_NAMES.includes(name) || CONTENT_EVENT_FIELDS.includes(name);
}

/** A record without content fields (F128-FR-039). */
export function logRecordWithoutContent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isAContentName(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Split one logfmt line into its `key=value` pairs, honouring quoted values:
 * the same shape the one encoder of F128-FR-022 produces.
 */
export function splitLogfmtLine(line: string): readonly { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  let index = 0;
  while (index < line.length) {
    while (index < line.length && line[index] === " ") index += 1;
    if (index >= line.length) break;
    const equals = line.indexOf("=", index);
    if (equals < 0) break;
    const key = line.slice(index, equals);
    let cursor = equals + 1;
    let value = "";
    if (line[cursor] === '"') {
      cursor += 1;
      while (cursor < line.length) {
        if (line[cursor] === "\\" && cursor + 1 < line.length) {
          value += line[cursor] + line[cursor + 1];
          cursor += 2;
          continue;
        }
        if (line[cursor] === '"') {
          cursor += 1;
          break;
        }
        value += line[cursor];
        cursor += 1;
      }
    } else {
      const space = line.indexOf(" ", cursor);
      const end = space < 0 ? line.length : space;
      value = line.slice(cursor, end);
      cursor = end;
    }
    pairs.push({ key, value });
    index = cursor;
  }
  return pairs;
}

/** Re-render pairs as one logfmt line (quoted where the value needs it). */
function renderPairs(pairs: readonly { key: string; value: string }[]): string {
  return pairs
    .map(({ key, value }) =>
      /[\s"=]/.test(value) ? `${key}=${JSON.stringify(value)}` : `${key}=${value}`,
    )
    .join(" ");
}

/** A Loki line without its content pairs (F128-FR-039). */
export function lokiLineWithoutContent(line: string): string {
  const kept = splitLogfmtLine(line).filter(({ key }) => !isAContentName(key));
  return renderPairs(kept);
}

/**
 * Whether a finished text carries any of the given secret values: the scan
 * half of the enforcement (CT-128-13 searches payloads with it).
 */
export function textCarriesAny(text: string, values: readonly string[]): string | null {
  for (const value of values) {
    if (value !== "" && text.includes(value)) return value;
  }
  return null;
}
