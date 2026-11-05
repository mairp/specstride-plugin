/**
 * The state machine and the schema gate of the JSONL reader (T031; covers
 * F138-FR-023, F138-FR-025 and F138-FR-026).
 *
 * One reader serves the family of harnesses that share stream schema
 * version 3; what differs per harness is a row of the dialect table. The
 * reader checks the schema before it reads anything else: a record that is
 * not a session record, arriving while no accepted schema is in force, gives
 * one `absent_schema` diagnostic and is ignored; a session record with a
 * version the dialect does not accept gives `unsupported_schema`, the later
 * records are ignored without further diagnostics, and the stream ends with
 * the `unsupported_schema` terminal. The reader goes on after a bad input: a
 * line that does not parse, a value that is not an object and a record whose
 * type is outside the known set each give their diagnostic and the stream
 * continues. A type that begins with `tool` is handled as a tool record and
 * gives no diagnostic. The state machine is the baseline's, record by
 * record: message, tool, retry and end records, the held terminal, and the
 * usage, with the same display lines.
 */
import type { DialectRow } from "./dialect.ts";
import {
  LineCapGate,
  admitStreamLine,
  lineCapsOf,
  stdoutLines,
  type LineChannel,
} from "./framing.ts";
import {
  READER_CAPS,
  byteLength,
  cleanFields,
  displayLineForDiagnostic,
  displayLineForInit,
  displayLineForToolEnd,
  displayLineForToolStart,
  sanitizeText,
  type ReaderRedactor,
} from "./display.ts";
import {
  accumulateTextDelta,
  closeMessage,
  isAssistantish,
  messageIdOf,
  trackModelChange,
} from "./messages.ts";
import {
  generatedToolId,
  isEvidenceWrite,
  summarizeArguments,
  toolEndIsError,
  toolIdOf,
  type ToolState,
} from "./summarize.ts";
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_STATUSES,
  SUCCESS_STATUSES,
  agentEndErrorMessage,
  recordProviderError,
  recordProviderRetry,
  successTerminal,
} from "./terminal.ts";
import {
  UsageIncrements,
  mergeUsageAtEnd,
  sumUsage,
  usageNamesOf,
  type UsageState,
} from "./usage.ts";
import type {
  ErrorRecord,
  InitRecord,
  NormalizedRecord,
  TerminalRecord,
  TextRecord,
  ToolRecord,
  UsageRecord,
} from "./records.ts";

/** The known record types of the family (F138-FR-026). */
export const KNOWN_RECORD_TYPES: readonly string[] = Object.freeze([
  "session",
  "message_start",
  "message_update",
  "message_end",
  "turn_start",
  "turn_end",
  "agent_start",
  "agent_end",
  "auto_retry_start",
  "auto_retry_end",
  "error",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

const KNOWN = new Set<string>(KNOWN_RECORD_TYPES);

/** One event of the compatibility projection: an as-is event and its fields. */
export type AsIsEvent = {
  readonly name: string;
  readonly fields: Record<string, unknown>;
};

/** A diagnostic of the reader with every field of F138-FR-036. */
export type FullDiagnostic = {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly providerRecordType: string | null;
  readonly displayLine: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly originalBytes: number;
  readonly retainedBytes: number;
  readonly extras: Readonly<Record<string, unknown>>;
  readonly line: number;
};

/** Everything one read stream produced, once it finished. */
export type PrimeStreamResult = {
  readonly dialect: string;
  readonly schemaVersion: number | null;
  readonly events: readonly AsIsEvent[];
  readonly display: readonly string[];
  readonly records: readonly NormalizedRecord[];
  readonly diagnostics: readonly FullDiagnostic[];
  readonly terminal: Readonly<Record<string, unknown>> | null;
  readonly usage: Readonly<UsageState>;
  readonly turns: number;
  readonly evidenceTools: readonly string[];
  /** True where the pass was killed before the agent ended (F138-FR-040). */
  readonly incomplete: boolean;
  /** True where the stream ended without a terminal record (F138-FR-023). */
  readonly missingTerminal: boolean;
};

/** The options of one stream reader. */
export type PrimeReaderOptions = {
  /** The dialect row in force. */
  readonly row: DialectRow;
  /** The expected evidence path, absolute and resolved (F138-FR-030). */
  readonly expectedEvidence?: string | null | undefined;
  /**
   * The redactor the composition root hands in (feature 111 owns the
   * redaction, as the harness tap takes its port). Absent, the reader only
   * cuts to the caps and marks nothing as redacted.
   */
  readonly redactor?: ReaderRedactor | null | undefined;
};

/** A text block accumulated for one message and content index. */
type Block = { text: string; closed: boolean };

/**
 * The per-stream reader: a stream is read once, in order; `finish` runs
 * once; a second call is a no-op.
 */
export class PrimeStreamReader {
  private readonly row: DialectRow;
  private readonly caps: LineCapGate;
  private readonly redactor: ReaderRedactor | null;
  private readonly expectedEvidence: string | null;
  private readonly usageNames: ReturnType<typeof usageNamesOf>;

  private readonly events: AsIsEvent[] = [];
  private readonly display: string[] = [];
  private readonly records: NormalizedRecord[] = [];
  private readonly diagnostics: FullDiagnostic[] = [];
  private readonly messages = new Map<string, Map<number, Block>>();
  private readonly tools = new Map<string, ToolState>();
  private readonly evidenceTools = new Set<string>();
  private readonly increments: UsageIncrements;

  private usage: UsageState = {};
  private turns = 0;
  private toolOrdinal = 0;
  private schemaVersion: number | null = null;
  private sessionId: string | null = null;
  private cwd: string | null = null;
  private model: string | null = null;
  private provider: string | null = null;
  private heldTerminal: Record<string, unknown> | null = null;
  private terminalExposed = false;
  private schemaDiagnosed = false;
  private finished = false;
  private agentEnded = false;
  private exposedTerminal: Record<string, unknown> | null = null;
  private lineNumber = 0;

  constructor(options: PrimeReaderOptions) {
    this.row = options.row;
    this.caps = new LineCapGate(lineCapsOf(options.row));
    this.redactor = options.redactor ?? null;
    this.expectedEvidence = options.expectedEvidence ?? null;
    this.usageNames = usageNamesOf(options.row);
    this.increments = new UsageIncrements(options.row);
  }

  /* ---------------------------------------------------------------- *
   * Emission helpers.
   * ---------------------------------------------------------------- */

  private event(name: string, fields: Record<string, unknown>): void {
    this.events.push({ name, fields });
  }

  private diagnostic(
    code: string,
    severity: "error" | "warning",
    message: string,
    providerRecordType: string | null,
    extras: Record<string, unknown> = {},
  ): void {
    const safe = sanitizeText(message, READER_CAPS.diagnosticMessage, this.redactor);
    const fields = cleanFields({
      code,
      severity,
      message: safe.value,
      provider_record_type: providerRecordType,
      redacted: safe.redacted,
      truncated: safe.truncated,
      original_bytes: safe.originalBytes,
      retained_bytes: safe.retainedBytes,
      ...extras,
    });
    this.event("agent_diagnostic", fields);
    const displayLine = displayLineForDiagnostic(code, safe.value);
    this.display.push(displayLine);
    this.diagnostics.push({
      code,
      severity,
      message: safe.value,
      providerRecordType,
      displayLine,
      redacted: safe.redacted,
      truncated: safe.truncated,
      originalBytes: safe.originalBytes,
      retainedBytes: safe.retainedBytes,
      extras,
      line: this.lineNumber,
    });
    const errorRecord: ErrorRecord = {
      kind: "error",
      dialect: this.row.dialect,
      line: this.lineNumber,
      code,
      message: safe.value,
      retry:
        typeof extras["attempt"] === "number"
          ? { attempt: extras["attempt"] as number, of: -1 }
          : null,
      providerRecordType,
      extras,
      severity,
      redacted: safe.redacted,
      truncated: safe.truncated,
      originalBytes: safe.originalBytes,
      retainedBytes: safe.retainedBytes,
    };
    this.records.push(errorRecord);
  }

  private providerError(message: unknown, stopReason: unknown, providerRecordType: string): void {
    recordProviderError({
      message,
      stopReason,
      providerRecordType,
      usage: this.usage,
      turns: this.turns,
      row: this.row,
      redactor: this.redactor,
      emit: (diagnostic, fields, displayLine) => {
        this.event("agent_diagnostic", fields);
        this.display.push(displayLine);
        this.diagnostics.push({
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.message,
          providerRecordType: diagnostic.providerRecordType,
          displayLine,
          redacted: fields["redacted"] === true,
          truncated: fields["truncated"] === true,
          originalBytes: Number(fields["original_bytes"] ?? byteLength(diagnostic.message)),
          retainedBytes: Number(fields["retained_bytes"] ?? byteLength(diagnostic.message)),
          extras: diagnostic.extras,
          line: this.lineNumber,
        });
        this.records.push({
          kind: "error",
          dialect: this.row.dialect,
          line: this.lineNumber,
          code: diagnostic.code,
          message: diagnostic.message,
          retry: null,
          providerRecordType: diagnostic.providerRecordType,
          extras: diagnostic.extras,
          severity: diagnostic.severity,
        });
      },
      setTerminal: (terminal) => {
        this.heldTerminal = terminal;
      },
    });
  }

  private usageRecord(record: UsageRecord): void {
    this.records.push(record);
  }

  /* ---------------------------------------------------------------- *
   * The line loop (framing).
   * ---------------------------------------------------------------- */

  /** Feed one physical line of the harness's own standard output. */
  feed(line: string, channel: LineChannel = "stdout"): void {
    if (this.finished) return;
    this.lineNumber += 1;
    const admission = admitStreamLine(line, channel);
    if (!admission.admitted) return; // the output of a tool is never a record
    if (this.caps.admit(line, 0) === "line_too_long") {
      this.diagnostic(
        "malformed_json",
        "error",
        "Malformed Prime JSON: line over the size cap of the dialect row",
        null,
      );
      return;
    }
    const text = line.trim();
    if (text === "") return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      this.diagnostic("malformed_json", "error", `Malformed Prime JSON: ${String(error)}`, null);
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.diagnostic("malformed_json", "error", "Prime record is not a JSON object", null);
      return;
    }
    this.consume(value as Record<string, unknown>);
  }

  /** Feed a whole chunk of standard output, line by line, in order. */
  feedStdout(chunk: string): void {
    for (const line of stdoutLines(chunk)) this.feed(line);
  }

  /* ---------------------------------------------------------------- *
   * The schema gate and the record dispatch.
   * ---------------------------------------------------------------- */

  private consume(record: Record<string, unknown>): void {
    const type = record["type"];
    const recordType = typeof type === "string" ? type : null;
    if (recordType === "session") {
      this.consumeSession(record);
      return;
    }
    if (this.schemaVersion === null) {
      if (!this.schemaDiagnosed) {
        this.schemaDiagnosed = true;
        this.diagnostic(
          "absent_schema",
          "error",
          "Prime stream has no schema declaration",
          recordType,
        );
      }
      return;
    }
    if (this.schemaVersion !== 3) return; // unsupported: ignored, no more diagnostics

    if (recordType === "message_start") this.consumeMessageStart(record);
    else if (recordType === "message_update")
      accumulateTextDelta({ record, messages: this.messagesAsMaps() });
    else if (recordType === "message_end") this.consumeMessageEnd(record);
    else if (recordType === "turn_end") this.consumeTurnEnd(record);
    else if (recordType === "auto_retry_start") {
      recordProviderRetry({
        record,
        providerRecordType: "auto_retry_start",
        redactor: this.redactor,
        emit: (diagnostic, fields, displayLine) => {
          this.event("agent_diagnostic", fields);
          this.display.push(displayLine);
          this.diagnostics.push({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            providerRecordType: diagnostic.providerRecordType,
            displayLine,
            redacted: fields["redacted"] === true,
            truncated: fields["truncated"] === true,
            originalBytes: Number(fields["original_bytes"] ?? byteLength(diagnostic.message)),
            retainedBytes: Number(fields["retained_bytes"] ?? byteLength(diagnostic.message)),
            extras: diagnostic.extras,
            line: this.lineNumber,
          });
          this.records.push({
            kind: "error",
            dialect: this.row.dialect,
            line: this.lineNumber,
            code: diagnostic.code,
            message: diagnostic.message,
            retry:
              typeof diagnostic.extras["attempt"] === "number"
                ? { attempt: diagnostic.extras["attempt"] as number, of: -1 }
                : null,
            providerRecordType: diagnostic.providerRecordType,
            extras: diagnostic.extras,
            severity: diagnostic.severity,
          });
        },
      });
    } else if (recordType === "error") this.consumeErrorRecord(record);
    else if (recordType !== null && recordType.startsWith("tool")) {
      this.consumeToolRecord(recordType, record);
    } else if (recordType === "agent_end") this.consumeAgentEnd(record);
    else if (!KNOWN.has(recordType ?? "")) {
      this.diagnostic(
        "unknown_record",
        "warning",
        `Unknown Prime record type: ${recordType ?? "<absent>"}`,
        recordType,
      );
    }
  }

  private messageBlocks(): Map<string, Map<number, Block>> {
    return this.messages;
  }

  private messagesAsMaps(): Map<string, Map<number, Block>> {
    return this.messageBlocks();
  }

  private consumeSession(record: Record<string, unknown>): void {
    const version = record["version"] ?? record["schemaVersion"];
    this.schemaVersion = typeof version === "number" ? version : null;
    const id = record["id"] ?? record["sessionId"];
    this.sessionId = typeof id === "string" ? id : null;
    this.cwd = typeof record["cwd"] === "string" ? (record["cwd"] as string) : null;
    if (this.schemaVersion !== 3) {
      this.schemaDiagnosed = true;
      this.diagnostic(
        this.schemaVersion === null ? "absent_schema" : "unsupported_schema",
        "error",
        this.schemaVersion === null
          ? "Prime session omitted schema version"
          : `Unsupported Prime schema version ${this.schemaVersion}`,
        "session",
      );
      return;
    }
    const fields = cleanFields({
      schema_version: 3,
      session_id: this.sessionId,
      cwd: this.cwd,
      provider: record["provider"] ?? null,
      model: record["model"] ?? null,
    });
    this.event("agent_init", fields);
    this.display.push(displayLineForInit(this.row, this.sessionId));
    const init: InitRecord = {
      kind: "init",
      dialect: this.row.dialect,
      line: this.lineNumber,
      schemaVersion: 3,
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: typeof record["model"] === "string" ? (record["model"] as string) : null,
      provider: typeof record["provider"] === "string" ? (record["provider"] as string) : null,
    };
    this.records.push(init);
  }

  private consumeMessageStart(record: Record<string, unknown>): void {
    if (!isAssistantish(record)) return;
    const id = messageIdOf(record, this.messages.size);
    if (!this.messages.has(id)) this.messages.set(id, new Map());
    const tracked = trackModelChange({ record, model: this.model, provider: this.provider });
    if (!tracked.changed) return;
    this.model = tracked.model;
    this.provider = tracked.provider;
    this.event(
      "agent_init",
      cleanFields({
        schema_version: 3,
        session_id: this.sessionId,
        cwd: this.cwd,
        model: this.model,
        provider: this.provider,
        update: true,
      }),
    );
    const init: InitRecord = {
      kind: "init",
      dialect: this.row.dialect,
      line: this.lineNumber,
      schemaVersion: 3,
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      provider: this.provider,
      update: true,
    };
    this.records.push(init);
  }

  private consumeMessageEnd(record: Record<string, unknown>): void {
    if (!isAssistantish(record)) return;
    const message = (record["message"] ?? {}) as Record<string, unknown>;
    const id =
      typeof message["id"] === "string" && message["id"].length > 0
        ? (message["id"] as string)
        : typeof record["messageId"] === "string"
          ? (record["messageId"] as string)
          : "message-unknown";
    const closed = closeMessage({ record, messageId: id, messages: this.messages });
    for (const block of closed.blocks) {
      const safe = sanitizeText(block.text, READER_CAPS.text, this.redactor);
      this.event(
        "agent_text",
        cleanFields({
          message_key: block.messageKey,
          message_id: block.messageId,
          content_index: block.index,
          text: safe.value,
          final_fragment: true,
          redacted: safe.redacted,
          truncated: safe.truncated,
          original_bytes: safe.originalBytes,
          retained_bytes: safe.retainedBytes,
        }),
      );
      this.display.push(safe.value);
      const textRecord: TextRecord = {
        kind: "text",
        dialect: this.row.dialect,
        line: this.lineNumber,
        messageId: block.messageId,
        index: block.index,
        text: safe.value,
        messageKey: block.messageKey,
        finalFragment: true,
        redacted: safe.redacted,
        truncated: safe.truncated,
        originalBytes: safe.originalBytes,
        retainedBytes: safe.retainedBytes,
      };
      this.records.push(textRecord);
    }
    if (closed.providerError !== null) {
      this.providerError(
        closed.providerError.message,
        closed.providerError.stopReason,
        "message_end",
      );
    }
  }

  private consumeTurnEnd(record: Record<string, unknown>): void {
    this.turns += 1;
    sumUsage(this.usage, record["usage"], this.usageNames);
    const increment = this.increments.next(record["usage"], this.usageNames);
    this.usageRecord({
      kind: "usage",
      dialect: this.row.dialect,
      line: this.lineNumber,
      turns: this.turns,
      input: increment.input,
      output: increment.output,
      cacheRead: increment.cacheRead,
      cacheWrite: increment.cacheWrite,
      total: increment.total,
      cost: increment.cost,
      usageId: increment.usageId,
      final: false,
    });
  }

  private consumeErrorRecord(record: Record<string, unknown>): void {
    const error = record["error"];
    const message =
      (error !== null && typeof error === "object"
        ? (error as Record<string, unknown>)["message"]
        : typeof error === "string"
          ? error
          : undefined) ?? record["message"];
    this.providerError(message ?? DEFAULT_ERROR_MESSAGE, record["stopReason"], "error");
  }

  private consumeAgentEnd(record: Record<string, unknown>): void {
    this.agentEnded = true;
    mergeUsageAtEnd(this.usage, record["usage"], this.usageNames);
    this.abandonTools();
    const closing = this.increments.closing(record["usage"], this.usageNames);
    this.usageRecord({
      kind: "usage",
      dialect: this.row.dialect,
      line: this.lineNumber,
      turns: this.turns,
      input: closing.input,
      output: closing.output,
      cacheRead: closing.cacheRead,
      cacheWrite: closing.cacheWrite,
      total: closing.total,
      cost: closing.cost,
      usageId: closing.usageId,
      final: true,
    });
    const status = String(record["status"] ?? "").toLowerCase();
    const stop = record["stopReason"] ?? record["stop_reason"];
    const error = record["error"];
    if (ERROR_STATUSES.has(status) || stop === "error" || (error !== null && error !== undefined)) {
      this.providerError(agentEndErrorMessage(record) ?? DEFAULT_ERROR_MESSAGE, stop, "agent_end");
    } else if (SUCCESS_STATUSES.has(status)) {
      this.heldTerminal = successTerminal({
        stopReason: stop,
        model: this.model,
        usage: this.usage,
        turns: this.turns,
      });
    }
    if (this.heldTerminal !== null) {
      this.exposedTerminal = { ...this.heldTerminal };
      this.terminalExposed = true;
      this.emitTerminalRecord(this.exposedTerminal);
    }
  }

  private emitTerminalRecord(terminal: Record<string, unknown>): void {
    const status = terminal["status"] === "success" ? "success" : "error";
    const usageRecordFields = terminal["usage"] as Record<string, number> | undefined;
    const terminalRecord: TerminalRecord = {
      kind: "terminal",
      dialect: this.row.dialect,
      line: this.lineNumber,
      success: status === "success",
      reason: status === "error" ? String(terminal["reason"] ?? null) : null,
      status,
      reasonCode:
        typeof terminal["reason_code"] === "string"
          ? (terminal["reason_code"] as string)
          : undefined,
      stopReason: (terminal["stop_reason"] ?? null) as string | null,
      model: (terminal["model"] ?? null) as string | null,
      usage: usageRecordFields,
    };
    this.records.push(terminalRecord);
  }

  private consumeToolRecord(recordType: string, record: Record<string, unknown>): void {
    let id = toolIdOf(record);
    if (id === null) {
      this.toolOrdinal += 1;
      id = generatedToolId(this.row, this.toolOrdinal);
    }
    let state = this.tools.get(id);
    if (state === undefined) {
      state = {
        id,
        name: "?",
        arguments: "",
        argumentsText: "",
        started: false,
        ended: false,
      };
      this.tools.set(id, state);
    }
    const name =
      typeof record["toolName"] === "string"
        ? (record["toolName"] as string)
        : typeof record["tool_name"] === "string"
          ? (record["tool_name"] as string)
          : state.name;
    state.name = name;
    if (recordType === "toolcall_delta") {
      state.argumentsText += String(record["argumentsDelta"] ?? "");
    } else if (recordType === "toolcall_end") {
      if (record["arguments"] !== undefined && record["arguments"] !== null) {
        state.arguments = record["arguments"];
      }
    } else if (recordType === "tool_execution_start") {
      if (record["arguments"] !== undefined && record["arguments"] !== null) {
        state.arguments = record["arguments"];
      }
      state.started = true;
      const summary = summarizeArguments(state.arguments, this.redactor);
      this.event("agent_tool", {
        tool_id: id,
        tool: state.name,
        status: "start",
        targets: summary.targets,
        summary: summary.summary,
        redacted: summary.redacted,
        truncated: summary.truncated,
        original_bytes: summary.original_bytes,
        retained_bytes: summary.retained_bytes,
      });
      this.display.push(displayLineForToolStart(state.name, summary.summary));
      const toolRecord: ToolRecord = {
        kind: "tool",
        dialect: this.row.dialect,
        line: this.lineNumber,
        toolId: id,
        name: state.name,
        args: state.arguments,
        started: true,
        ended: false,
        status: "start",
        targets: summary.targets,
        summary: summary.summary,
        redacted: summary.redacted,
        truncated: summary.truncated,
        originalBytes: summary.original_bytes,
        retainedBytes: summary.retained_bytes,
      };
      this.records.push(toolRecord);
      if (
        isEvidenceWrite(state.arguments, this.expectedEvidence, this.cwd) &&
        this.expectedEvidence !== null
      ) {
        this.evidenceTools.add(id);
        this.event("evidence_writing", {
          tool_id: id,
          tool: state.name,
          target: this.expectedEvidence,
          match: "exact-expected-target",
        });
        toolRecord.evidencePath = this.expectedEvidence;
      }
    } else if (recordType === "tool_execution_update") {
      const raw = record["message"] ?? record["update"] ?? "";
      const safe = sanitizeText(raw, READER_CAPS.progress, this.redactor);
      if (safe.value) {
        this.event("agent_tool", {
          tool_id: id,
          tool: state.name,
          status: "progress",
          summary: safe.value,
          redacted: safe.redacted,
          truncated: safe.truncated,
          original_bytes: safe.originalBytes,
          retained_bytes: safe.retainedBytes,
        });
        this.records.push({
          kind: "tool",
          dialect: this.row.dialect,
          line: this.lineNumber,
          toolId: id,
          name: state.name,
          args: state.arguments,
          started: state.started,
          ended: false,
          status: "progress",
          summary: safe.value,
          redacted: safe.redacted,
          truncated: safe.truncated,
          originalBytes: safe.originalBytes,
          retainedBytes: safe.retainedBytes,
        });
      }
    } else if (recordType === "tool_execution_end") {
      state.ended = true;
      const isError = toolEndIsError(record);
      const raw = record["result"] ?? record["message"] ?? "";
      const safe = sanitizeText(raw, READER_CAPS.toolResult, this.redactor);
      const duration = record["durationMs"];
      this.event(
        "agent_tool",
        cleanFields({
          tool_id: id,
          tool: state.name,
          status: "end",
          is_error: isError,
          duration_ms: typeof duration === "number" ? duration : null,
          result_summary: safe.value,
          redacted: safe.redacted,
          truncated: safe.truncated,
          original_bytes: safe.originalBytes,
          retained_bytes: safe.retainedBytes,
        }),
      );
      this.display.push(displayLineForToolEnd(state.name, isError));
      this.records.push({
        kind: "tool",
        dialect: this.row.dialect,
        line: this.lineNumber,
        toolId: id,
        name: state.name,
        args: state.arguments,
        started: state.started,
        ended: true,
        status: "end",
        isError,
        durationMs: typeof duration === "number" ? duration : null,
        resultSummary: safe.value,
        redacted: safe.redacted,
        truncated: safe.truncated,
        originalBytes: safe.originalBytes,
        retainedBytes: safe.retainedBytes,
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * The end of the stream.
   * ---------------------------------------------------------------- */

  private abandonTools(): void {
    for (const state of this.tools.values()) {
      if (state.ended || !(state.started || state.argumentsText || state.arguments)) continue;
      state.ended = true;
      this.diagnostic(
        "abandoned_tool",
        "warning",
        `Prime stream ended before tool ${state.id} completed`,
        "tool_execution",
        { tool_id: state.id, tool: state.name },
      );
    }
  }

  /** End the stream; runs once; a second call changes nothing. */
  finish(): PrimeStreamResult {
    if (!this.finished) {
      this.finished = true;
      this.lineNumber = Math.max(this.lineNumber, 0);
      this.abandonTools();
      if (this.heldTerminal !== null && !this.terminalExposed) {
        this.exposedTerminal = { ...this.heldTerminal };
        this.terminalExposed = true;
        this.emitTerminalRecord(this.exposedTerminal);
      } else if (this.schemaVersion !== null && this.schemaVersion !== 3) {
        this.exposedTerminal = {
          status: "error",
          reason_code: "unsupported_schema",
          reason: `Unsupported Prime schema version ${this.schemaVersion}`,
        };
        this.emitTerminalRecord(this.exposedTerminal);
      }
    }
    return {
      dialect: this.row.dialect,
      schemaVersion: this.schemaVersion,
      events: this.events,
      display: this.display,
      records: this.records,
      diagnostics: this.diagnostics,
      terminal: this.exposedTerminal,
      usage: this.usage,
      turns: this.turns,
      evidenceTools: [...this.evidenceTools],
      incomplete: !this.agentEnded,
      missingTerminal: this.exposedTerminal === null,
    };
  }

  /** The result read so far, without ending the stream. */
  get partial(): PrimeStreamResult {
    return {
      dialect: this.row.dialect,
      schemaVersion: this.schemaVersion,
      events: this.events,
      display: this.display,
      records: this.records,
      diagnostics: this.diagnostics,
      terminal: this.exposedTerminal,
      usage: this.usage,
      turns: this.turns,
      evidenceTools: [...this.evidenceTools],
      incomplete: !this.agentEnded,
      missingTerminal: this.exposedTerminal === null,
    };
  }
}
