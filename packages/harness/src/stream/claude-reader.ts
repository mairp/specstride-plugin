/**
 * T013 — the reader interface of the seam and the `claude` reader
 * (F126-FR-003, F126-FR-002).
 *
 * A reader consumes the lines of a stream and hands on the normalized
 * records. It is untrusted text: only the framing of the harness itself is
 * parsed (F126-FR-018), a line that is not JSON is a `malformed_json`
 * diagnostic, and nothing a stream carries is executed.
 */
import { diagnosticOf } from "./closed-sets.ts";
import {
  makeInitRecord,
  makeTextRecord,
  makeTerminalRecord,
  type NormalizedRecord,
  type TerminalRecord,
} from "./records.ts";
import { canonicalizeToolName, collapseTarget, cutToBytes, resolveToolTarget } from "./target.ts";

/** A reader of one stream, fed line by line. */
export interface StreamReader {
  /** Consume one line; the records it produced, in order. */
  push(line: string): readonly NormalizedRecord[];
  /** The stream ended; the records of the end (at most once, idempotent). */
  finish(): readonly NormalizedRecord[];
  /** Whether the reader saw a malformed line (F126-FR-016); optional. */
  readonly malformedStream?: boolean | undefined;
}

/** The text of an `agent_text` event: whitespace-collapsed, cut to 160 bytes. */
export function agentTextOf(raw: string): string {
  return cutToBytes(raw.replace(/\s+/g, " ").trim(), 160);
}

/** Parse one stream line as JSON; a fault is a `malformed_json` diagnostic. */
export function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    diagnosticOf("malformed_json", "a stream line held JSON that is not an object");
    return null;
  } catch (error) {
    diagnosticOf(
      "malformed_json",
      `a stream line was not JSON: ${(error as Error).message.slice(0, 120)}`,
    );
    return null;
  }
}

/** A non-empty string field of a record, else null. */
function stringAt(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A non-negative whole number field of a record, else null. */
function numberAt(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The `claude` reader: the recorded stream-json of Claude Code (F126-FR-003). */
export class ClaudeStreamReader implements StreamReader {
  private lastModel: string | null = null;
  private sessionId: string | null = null;
  private finished = false;

  push(line: string): readonly NormalizedRecord[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];
    const record = parseLine(trimmed);
    if (record === null) return [];
    const type = stringAt(record, "type");
    if (type === null) {
      diagnosticOf("unknown_record_kind", "a stream line named no record kind");
      return [];
    }
    switch (type) {
      case "system":
        return this.ofSystem(record);
      case "assistant":
        return this.ofAssistant(record);
      case "agent_text":
        return this.ofAgentText(record);
      case "result":
        return this.ofResult(record);
      default:
        // A record of another kind is dropped with a diagnostic (F126-FR-002).
        diagnosticOf("unknown_record_kind", `a stream record of kind '${type}' was dropped`);
        return [];
    }
  }

  finish(): readonly NormalizedRecord[] {
    // The claude stream carries its own result record; the reader
    // synthesizes nothing and finishing twice is a no-op (F126-FR-009).
    this.finished = true;
    return [];
  }

  private ofSystem(record: Readonly<Record<string, unknown>>): readonly NormalizedRecord[] {
    const subtype = stringAt(record, "subtype");
    if (subtype !== "init") return [];
    const tools = record["tools"];
    const sessionId = stringAt(record, "session_id");
    if (sessionId !== null) this.sessionId = sessionId;
    return [
      makeInitRecord({
        model: stringAt(record, "model"),
        tools: Array.isArray(tools)
          ? tools.filter((t): t is string => typeof t === "string")
          : null,
        toolCount: Array.isArray(tools) ? tools.length : null,
        sessionId,
      }),
    ];
  }

  private ofAssistant(record: Readonly<Record<string, unknown>>): readonly NormalizedRecord[] {
    const message = record["message"];
    if (message === null || typeof message !== "object" || Array.isArray(message)) return [];
    const body = message as Readonly<Record<string, unknown>>;
    const model = stringAt(body, "model");
    if (model !== null) this.lastModel = model;
    const content = body["content"];
    if (!Array.isArray(content)) return [];
    const out: NormalizedRecord[] = [];
    for (const block of content) {
      if (block === null || typeof block !== "object" || Array.isArray(block)) continue;
      const one = block as Readonly<Record<string, unknown>>;
      const blockType = stringAt(one, "type");
      if (blockType === "text") {
        const text = makeTextRecord(stringAt(one, "text") ?? "", this.sessionId);
        if (text !== null) out.push(text);
      } else if (blockType === "tool_use") {
        out.push(this.ofToolUse(one));
      }
    }
    return out;
  }

  private ofToolUse(block: Readonly<Record<string, unknown>>): NormalizedRecord {
    const rawName = stringAt(block, "name") ?? "";
    const name = canonicalizeToolName(rawName);
    const rawInput = block["input"];
    const input =
      rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? (rawInput as Readonly<Record<string, unknown>>)
        : {};
    const targets = Object.values(input)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((v) => collapseTarget(v));
    return {
      kind: "tool",
      name,
      target: resolveToolTarget(name, input),
      targets,
      toolId: stringAt(block, "id"),
      category: null,
      durationMs: null,
      input,
      sessionId: this.sessionId,
      synthesized: false,
    };
  }

  private ofAgentText(record: Readonly<Record<string, unknown>>): readonly NormalizedRecord[] {
    const text = stringAt(record, "text") ?? stringAt(record, "message") ?? "";
    const collapsed = agentTextOf(text);
    const textRecord = makeTextRecord(collapsed, this.sessionId);
    return textRecord === null ? [] : [textRecord];
  }

  private ofResult(record: Readonly<Record<string, unknown>>): readonly NormalizedRecord[] {
    const isError = record["is_error"] === true;
    const usageRaw = record["usage"];
    const usage =
      usageRaw !== null && typeof usageRaw === "object" && !Array.isArray(usageRaw)
        ? (usageRaw as Readonly<Record<string, unknown>>)
        : {};
    const cost = numberAt(record, "total_cost_usd");
    const terminal: TerminalRecord = makeTerminalRecord({
      status: isError ? "error" : "success",
      stopReason: stringAt(record, "subtype"),
      model: this.lastModel,
      durationMs: numberAt(record, "duration_ms"),
      numTurns: numberAt(record, "num_turns"),
      inputTokens: numberAt(usage, "input_tokens"),
      outputTokens: numberAt(usage, "output_tokens"),
      cost,
      // The cost of the claude stream is the harness's own estimate (F126-FR-003).
      costIsEstimate: cost !== null,
      reasonCode: isError ? "provider_error" : null,
      reason: isError ? (stringAt(record, "result") ?? "Provider reported an error") : null,
      sessionId: this.sessionId,
    });
    return [terminal];
  }
}
