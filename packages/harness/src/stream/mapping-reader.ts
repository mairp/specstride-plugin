/**
 * T013 — the mapping reader: a stream format given as data only
 * (F126-FR-007).
 *
 * The descriptor fields `stream.mapping` (the selector of the record kind and
 * the field paths), the usage block, the tolerate list and the dialect row of the mapping
 * are data; this one generic reader interprets them and a new format needs no
 * code and no change of a core file. A mapping MUST reach only the six
 * normalized records — the reader keeps to the kinds of row 38 and drops
 * anything else with a diagnostic.
 *
 * The mapping is read as follows. Every path is a dotted path into the
 * document the framing handed over. `fields` maps `<kind>` (with an optional
 * `.field` tail) to a path: the record of that kind exists where its primary
 * path resolves to a non-null value, and the `.field` tails fill the fields
 * of the record. `usage` maps the field names of the cost record to paths.
 * A named path in `tolerate` that resolves to nothing is not a fault. The
 * `selector` names the path that must resolve for the document to count.
 */

/** The mapping of one format, exactly as the descriptor data carries it. */
export type StreamMapping = {
  /** Path that must resolve to a non-null value for the document to count. */
  readonly selector?: string | undefined;
  /** `<kind>[.field]` → dotted path into the document. */
  readonly fields?: Readonly<Record<string, string>> | undefined;
  /** Field of the cost record → dotted path (F126-FR-007, the usage block). */
  readonly usage?: Readonly<Record<string, string>> | undefined;
  /** Codes whose absence is not a fault (the tolerate list). */
  readonly tolerate?: readonly string[] | undefined;
  /** The row of the dialect table the format reads (the dialect row). */
  readonly dialect?: string | undefined;
};

import { diagnosticOf } from "./closed-sets.ts";
import {
  makeInitRecord,
  makeTerminalRecord,
  type NormalizedRecord,
  type UsageRecord,
} from "./records.ts";
import type { StreamReader } from "./claude-reader.ts";
import { canonicalizeToolName, resolveToolTarget } from "./target.ts";

/**
 * Resolve one dotted path against a document; null where it reaches nothing.
 * A segment that is a whole number indexes an array: the published stream
 * formats nest values in lists, such as the choices of the OpenAI framing.
 */
export function resolvePath(document: unknown, path: string): unknown {
  let current: unknown = document;
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)] ?? null;
      continue;
    }
    if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Readonly<Record<string, unknown>>)[segment] ?? null;
  }
  return current;
}

/** The value as text, or null. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The value as a whole number, or null. */
function numberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read one document through the mapping; the records it reaches, in order. */
export function readThroughMapping(
  mapping: StreamMapping,
  document: Readonly<Record<string, unknown>>,
  eventName: string | null = null,
): readonly NormalizedRecord[] {
  void eventName;
  if (mapping.selector !== undefined && resolvePath(document, mapping.selector) === null) {
    return [];
  }
  const kinds = new Set<string>();
  const tails = new Map<string, Map<string, unknown>>();
  for (const [key, path] of Object.entries(mapping.fields ?? {})) {
    const [head, ...rest] = key.split(".");
    if (!["init", "text", "tool", "usage", "error", "terminal"].includes(head)) {
      // A mapping reaches only the six normalized records (F126-FR-007).
      diagnosticOf("unknown_record_kind", `the mapping names the kind '${head}', outside row 38`);
      continue;
    }
    const value = resolvePath(document, path);
    if (rest.length === 0) {
      if (value !== null) kinds.add(head);
    } else if (value !== null) {
      const perKind = tails.get(head) ?? new Map<string, unknown>();
      perKind.set(rest.join("."), value);
      tails.set(head, perKind);
    }
  }

  const out: NormalizedRecord[] = [];
  if (kinds.has("init") || tails.has("init")) {
    const fields = tails.get("init") ?? new Map<string, unknown>();
    out.push(
      makeInitRecord({
        model: textOf(fields.get("model") ?? null),
        sessionId: textOf(fields.get("sessionId") ?? null),
      }),
    );
  }
  if (kinds.has("text")) {
    const value = textOf(
      resolvePath(document, mapping.fields?.["text"] ?? "") ??
        resolvePath(document, mapping.fields?.["text.text"] ?? ""),
    );
    if (value !== null)
      out.push({ kind: "text", text: value, sessionId: null, synthesized: false });
  }
  if (kinds.has("tool") || tails.has("tool")) {
    const fields = tails.get("tool") ?? new Map<string, unknown>();
    const name = canonicalizeToolName(textOf(fields.get("name") ?? null) ?? "");
    const input =
      fields.get("input") !== undefined && typeof fields.get("input") === "object"
        ? (fields.get("input") as Readonly<Record<string, unknown>>)
        : {};
    out.push({
      kind: "tool",
      name,
      target: resolveToolTarget(name, input),
      targets: [],
      toolId: textOf(fields.get("id") ?? null),
      category: textOf(fields.get("category") ?? null),
      durationMs: numberOr(fields.get("durationMs") ?? null),
      input,
      sessionId: null,
      synthesized: false,
    });
  }
  if (kinds.has("usage") || mapping.usage !== undefined) {
    const usage = usageThrough(mapping.usage ?? {}, document);
    if (usage !== null) out.push(usage);
  }
  if (kinds.has("error") || tails.has("error")) {
    const fields = tails.get("error") ?? new Map<string, unknown>();
    const message = textOf(fields.get("message") ?? null);
    const rawCode = fields.get("code") ?? null;
    const code =
      textOf(rawCode) ??
      (typeof rawCode === "number" && Number.isFinite(rawCode) ? String(rawCode) : null);
    if (message !== null || code !== null) {
      out.push({
        kind: "error",
        code: code ?? "adapter_error",
        message: message ?? "",
        sessionId: null,
        synthesized: false,
      });
    }
  }
  if (kinds.has("terminal") || tails.has("terminal")) {
    const fields = tails.get("terminal") ?? new Map<string, unknown>();
    out.push(
      makeTerminalRecord({
        status:
          (textOf(fields.get("status") ?? null) ?? "success") === "error" ? "error" : "success",
        stopReason: textOf(fields.get("stopReason") ?? null),
        model: textOf(fields.get("model") ?? null),
        durationMs: numberOr(fields.get("durationMs") ?? null),
        numTurns: numberOr(fields.get("numTurns") ?? null),
        reasonCode: textOf(fields.get("reasonCode") ?? null),
        reason: textOf(fields.get("reason") ?? null),
      }),
    );
  }
  return out;
}

/** The cost record of one document, through the usage paths of the mapping. */
function usageThrough(
  usage: Readonly<Record<string, string>>,
  document: Readonly<Record<string, unknown>>,
): UsageRecord | null {
  const at = (field: string): unknown =>
    usage[field] !== undefined ? resolvePath(document, usage[field]) : null;
  const inputTokens = numberOr(at("inputTokens"));
  const outputTokens = numberOr(at("outputTokens"));
  const cost = numberOr(at("cost"));
  const usageId = textOf(at("usageId"));
  if (inputTokens === null && outputTokens === null && cost === null && usageId === null) {
    return null;
  }
  return {
    kind: "usage",
    inputTokens,
    outputTokens,
    cacheReadTokens: numberOr(at("cacheReadTokens")),
    cacheWriteTokens: numberOr(at("cacheWriteTokens")),
    reasoningTokens: numberOr(at("reasoningTokens")),
    cost,
    scope: textOf(at("scope")),
    cumulative: at("cumulative") === true,
    usageId,
    sessionId: null,
    synthesized: false,
  };
}

/** The mapping reader: every line is one JSON document of the format. */
export class MappingReader implements StreamReader {
  private readonly mapping: StreamMapping;

  constructor(mapping: StreamMapping) {
    this.mapping = mapping;
  }

  push(line: string): readonly NormalizedRecord[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        diagnosticOf("malformed_json", "a stream line held JSON that is not an object");
        return [];
      }
      return readThroughMapping(this.mapping, value as Readonly<Record<string, unknown>>);
    } catch {
      if (!this.mapping.tolerate?.includes("malformed_json")) {
        diagnosticOf("malformed_json", "a stream line was not JSON");
      }
      return [];
    }
  }

  finish(): readonly NormalizedRecord[] {
    return [];
  }
}
