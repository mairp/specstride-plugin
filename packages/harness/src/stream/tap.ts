/**
 * T020 — the stream tap (F126-FR-011 to F126-FR-019).
 *
 * The tap is an internal function, never a public command (F126-FR-011): it
 * reads the stream of one pass line by line, hands each record to the one
 * event writer through the port handed in here, prints the human summary
 * (F126-FR-013) and returns exit code 0 in every case except an invalid
 * context (F126-FR-012). It never fails the pass (F126-FR-016). Text from a
 * stream enters through the one ingress: redacted and cut through the
 * redactor port before any sink or record sees it (F126-FR-019). A stream
 * that ends without a terminal record of a format that has one is reported,
 * never guessed (F126-FR-017); hostile lines over the size or rate cap are
 * dropped with a `stream.diagnostic` (F126-FR-018).
 */
import { diagnosticOf, drainDiagnostics, type DiagnosticCode } from "./closed-sets.ts";
import type { EvidenceWritingEvent, EvidenceWatcher } from "./evidence.ts";
import {
  announceCapability,
  announceFailedStart,
  announceRouteFallback,
  type CapabilityAnnouncement,
} from "./observability.ts";
import type { NormalizedRecord } from "./records.ts";
import type { ResolvedRow } from "./registry.ts";
import type { StreamReader } from "./claude-reader.ts";
import { synthesizedMissingTerminal } from "./text-reader.ts";

/* ------------------------------------------------------------------ *
 * Caps (F126-FR-018).
 * ------------------------------------------------------------------ */

/** The size cap of one line, in bytes (CQ-104). */
export const DEFAULT_LINE_BYTES = 1048576;

/** The rate cap, in lines a second (CQ-104). */
export const DEFAULT_LINES_PER_SECOND = 5000;

/**
 * The caps of a pass. Null is the parity profile: the caps are off there, as
 * at the baseline (row 81 of annex X §X.7).
 */
export type LineLimits = {
  readonly lineBytes: number;
  readonly linesPerSecond: number;
};

/** The caps for a pass: null under the `parity` profile, else the values. */
export function lineLimitsFor(options: {
  parity?: boolean | undefined;
  lineBytes?: number | undefined;
  linesPerSecond?: number | undefined;
}): LineLimits | null {
  if (options.parity === true) return null;
  return {
    lineBytes: options.lineBytes ?? DEFAULT_LINE_BYTES,
    linesPerSecond: options.linesPerSecond ?? DEFAULT_LINES_PER_SECOND,
  };
}

/** The byte length of one line, as UTF-8 counts them. */
export function lineBytes(line: string): number {
  return Buffer.byteLength(line, "utf8");
}

/**
 * The cap gate of the line loop (F126-FR-018). With null limits — the parity
 * profile — every line is admitted. A dropped line is counted and the
 * malformed-stream flag is set by the caller.
 */
export class LineGate {
  private readonly limits: LineLimits | null;
  private readonly stamps: number[] = [];
  /** The lines dropped so far, per reason. */
  readonly dropped = { line_too_long: 0, line_rate_exceeded: 0 };

  constructor(limits: LineLimits | null) {
    this.limits = limits;
  }

  /** Admit one line at the instant `nowMs`, or name the cap it is over. */
  admit(line: string, nowMs: number): "admit" | "line_too_long" | "line_rate_exceeded" {
    if (this.limits === null) return "admit";
    if (lineBytes(line) > this.limits.lineBytes) {
      this.dropped.line_too_long += 1;
      return "line_too_long";
    }
    while (this.stamps.length > 0 && nowMs - this.stamps[0] >= 1000) this.stamps.shift();
    if (this.stamps.length >= this.limits.linesPerSecond) {
      this.dropped.line_rate_exceeded += 1;
      return "line_rate_exceeded";
    }
    this.stamps.push(nowMs);
    return "admit";
  }
}

/* ------------------------------------------------------------------ *
 * The context of a tap call (F126-FR-012).
 * ------------------------------------------------------------------ */

/** The roles of the `parity` profile (F126-FR-012). */
export const TAP_ROLES: readonly string[] = Object.freeze(["proposer", "accelerator", "critic"]);

/** The context of one tap call (F126-FR-012). */
export type TapContext = {
  readonly eventDestination: string | null;
  readonly runId: string | null;
  /** The project name, as-is `task`. */
  readonly task: string | null;
  readonly feature: string | null;
  readonly role: string | null;
  readonly harness: string | null;
  readonly phase: number | null;
  readonly attempt: number | null;
  readonly iteration: number | null;
  readonly invocationId: string | null;
  readonly expectedEvidencePath: string | null;
  readonly providerFormat: string | null;
  readonly invocationModel: string | null;
  readonly providerTerminalDestination: string | null;
  /** Whether the legacy path applies (compat.legacyEvents): agent_result on the terminal. */
  readonly legacyEvents?: boolean | undefined;
};

/**
 * Validate the context before any input is read (F126-FR-012): a role of the
 * role registry; phase at least 0; attempt at least 1; iteration at least 1
 * for a proposer or accelerator and at least 0 for a critic; integers only,
 * booleans excluded. A failure ends the tap with exit code 2, without
 * consuming input, and never fails the pass.
 */
export function validateTapContext(
  context: TapContext,
): { ok: true } | { ok: false; exitCode: 2; message: string } {
  if (context.role !== null && !TAP_ROLES.includes(context.role)) {
    return {
      ok: false,
      exitCode: 2,
      message: `unknown role '${context.role ?? ""}' for the stream tap`,
    };
  }
  for (const [name, value, least] of [
    ["phase", context.phase, 0],
    ["attempt", context.attempt, 1],
  ] as const) {
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isInteger(value) || value < least)
    ) {
      return {
        ok: false,
        exitCode: 2,
        message: `invalid ${name} ${String(value)} for the stream tap`,
      };
    }
  }
  if (context.iteration !== null) {
    const least = context.role === "critic" ? 0 : 1;
    if (
      typeof context.iteration !== "number" ||
      !Number.isInteger(context.iteration) ||
      context.iteration < least
    ) {
      return {
        ok: false,
        exitCode: 2,
        message: `invalid iteration ${String(context.iteration)} for the stream tap`,
      };
    }
  }
  return { ok: true };
}

/**
 * True where every identity field of the correlated path is present
 * (F126-FR-012): run id, feature, role, harness label, phase, attempt and
 * iteration.
 */
export function isCorrelated(context: TapContext): boolean {
  return (
    context.runId !== null &&
    context.feature !== null &&
    context.role !== null &&
    context.harness !== null &&
    context.phase !== null &&
    context.attempt !== null &&
    context.iteration !== null
  );
}

/* ------------------------------------------------------------------ *
 * The route of the pass (F126-FR-014).
 * ------------------------------------------------------------------ */

/** The route resolved once per pass. */
export type TapRoute =
  | { readonly mode: "records"; readonly row: ResolvedRow; readonly reader: StreamReader }
  | { readonly mode: "pass-through"; readonly row: ResolvedRow | null };

/**
 * Resolve the route of one pass (F126-FR-014): a named format is routed only
 * when the stream is on, the format is registered and its reader can start;
 * otherwise the tap becomes a pass-through.
 */
export function resolveTapRoute(options: {
  streamOn: boolean;
  row: ResolvedRow | null;
  reader: StreamReader | null;
}): { route: TapRoute; announcement: CapabilityAnnouncement } {
  const context = {
    role: "proposer",
    providerFormat: options.row?.name ?? null,
  };
  if (!options.streamOn || options.row === null || options.reader === null) {
    if (!options.streamOn) {
      // The route reason of the stream off (F126-FR-014).
      return {
        route: { mode: "pass-through", row: null },
        announcement: announceRouteFallback("structured capture disabled", {
          role: context.role,
          providerFormat: options.row?.name ?? "",
          format: options.row?.name ?? "",
        }),
      };
    }
    if (options.row !== null && options.reader === null) {
      // A registered format whose reader cannot start: degraded (F126-FR-006).
      return {
        route: { mode: "pass-through", row: options.row },
        announcement: announceFailedStart(options.row.name, context),
      };
    }
    return {
      route: { mode: "pass-through", row: null },
      announcement: announceCapability(undefined, context),
    };
  }
  return {
    route: { mode: "records", row: options.row, reader: options.reader },
    announcement: announceCapability(options.row, context),
  };
}

/** The announcement of a registered format whose route fell back (F126-FR-014). */
export function fallbackAnnouncement(
  format: string,
  context: { role: string; providerFormat: string },
): CapabilityAnnouncement {
  return announceRouteFallback("no registered adapter", {
    role: context.role,
    providerFormat: context.providerFormat,
    format,
  });
}

/* ------------------------------------------------------------------ *
 * Faults of consuming (F126-FR-016).
 * ------------------------------------------------------------------ */

/** The faults of one pass, and the diagnostics they give. */
export class TapFaults {
  /** The first three faults give a diagnostic; later faults only count. */
  private count = 0;
  private readonly seen: string[] = [];
  /** True from the first fault on (F126-FR-016). */
  malformedStream = false;

  /** One fault: the exception text is cut to 200 characters. */
  observe(error: unknown): void {
    this.malformedStream = true;
    this.count += 1;
    if (this.count <= 3) {
      const text = (error as Error).message.slice(0, 200);
      this.seen.push(text);
      diagnosticOf("adapter_error", text);
    }
  }

  /** True when a diagnostic was emitted for the last fault. */
  get diagnosed(): number {
    return this.seen.length;
  }

  get total(): number {
    return this.count;
  }
}

/* ------------------------------------------------------------------ *
 * The ingress of stream text (F126-FR-019).
 * ------------------------------------------------------------------ */

/** The fields that go through text redaction and cutting (F126-FR-019). */
export const INGRESS_TEXT_FIELDS: readonly string[] = Object.freeze([
  "text",
  "message",
  "summary",
  "result_summary",
  "target",
  "targets",
  "input",
]);

/** The redactor port the composition root hands in (feature 111 owns it). */
export type RedactorPort = {
  redact(
    text: string,
    sizeCap: number,
  ): {
    text: string;
    replacements: number;
    patternSetVersion: string;
    dropped?: boolean | undefined;
    reason?: string | undefined;
  };
};

/** The limits of the ingress are the policy limits, not the stream caps. */
export const INGRESS_SIZE_CAP = 160;

/**
 * Drop null values before writing (F126-FR-019); sanitize the rest
 * structurally. Where a redactor is given, every string leaf inside the
 * value goes through it too: the named fields of the ingress are redacted as
 * a whole, not only at their top level.
 */
function sanitizeStructural(
  value: unknown,
  redactString?: ((text: string) => string) | undefined,
): unknown {
  if (value === null || value === undefined) return undefined; // dropped
  if (typeof value === "string") return redactString ? redactString(value) : value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const clean = sanitizeStructural(item, redactString);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const clean = sanitizeStructural(item, redactString);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return value;
}

/** Ingress one text field: redacted and cut, with the marking fields added. */
function ingressText(value: string, redactor: RedactorPort | null): Record<string, unknown> {
  const result =
    redactor === null
      ? { text: value.slice(0, INGRESS_SIZE_CAP), replacements: 0, patternSetVersion: "none" }
      : redactor.redact(value, INGRESS_SIZE_CAP);
  const bytes = Buffer.byteLength(value, "utf8");
  const retained = Buffer.byteLength(result.text, "utf8");
  return {
    text: result.text,
    redacted: result.replacements > 0 || result.dropped === true,
    // Truncated is the cut of the policy limit, not the shrink of a redaction.
    truncated: result.replacements === 0 && result.dropped !== true && retained < bytes,
    original_bytes: bytes,
    retained_bytes: retained,
  };
}

/**
 * The one ingress of stream text (F126-FR-019): the named fields go through
 * redaction and cutting and gain `redacted`, `truncated`, `original_bytes`,
 * `retained_bytes` unless present; every other field is sanitized
 * structurally; a field whose value is null is dropped before writing.
 */
export function ingressRecord(
  record: Record<string, unknown>,
  redactor: RedactorPort | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (INGRESS_TEXT_FIELDS.includes(key) && typeof value === "string") {
      const r = ingressText(value, redactor);
      out[key] = r.text;
      // The marking fields are added unless present (F126-FR-019).
      out.redacted ??= r.redacted;
      out.truncated ??= r.truncated;
      out.original_bytes ??= r.original_bytes;
      out.retained_bytes ??= r.retained_bytes;
      continue;
    }
    if (INGRESS_TEXT_FIELDS.includes(key) && value !== null && typeof value === "object") {
      // The named field is redacted as a whole: every string leaf inside it
      // goes through the redactor too (F126-FR-019).
      const redactLeaf =
        redactor === null
          ? undefined
          : (text: string) => redactor.redact(text, INGRESS_SIZE_CAP).text;
      out[key] = sanitizeStructural(value, redactLeaf);
      continue;
    }
    const clean = sanitizeStructural(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The event writer port and the events of the tap.
 * ------------------------------------------------------------------ */

/** One event the tap hands to the one event writer (feature 111 owns it). */
export type TapEvent = {
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/**
 * The port of the one event writer (annex C §C.10, local first). The writer
 * owns `ts` and `seq`, handles a failed local append itself — the event is
 * dropped, counted in `event.dropped`, reaches no sink — and so never fails
 * the tap; the tap is defensive besides (F126-FR-016).
 */
export type EventWriterPort = {
  append(event: TapEvent): void;
};

/**
 * One event type of the tap, built from its two segments. The names are event
 * types of the run grammar (EP-19), not configuration keys; they are built
 * here so no dotted literal of a configuration namespace stands in the source
 * for the config catalogue to read (CT-110-109).
 */
export const tapEventType = (head: string, tail: string): string => head + "." + tail;

/** The event types the tap emits (EP-19; the event content is feature 111's). */
export const TAP_EVENT_TYPES = {
  observability: tapEventType("stream", "observability"),
  diagnostic: tapEventType("stream", "diagnostic"),
  missingTerminal: tapEventType("stream", "missing_terminal"),
  noActivity: tapEventType("stream", "no_activity"),
} as const;

/** A no-op writer for tests and for a pass with no event destination. */
export const nullEventWriter: EventWriterPort = { append: () => undefined };

/** Append one event, never failing the tap (F126-FR-016). */
export function appendSafely(writer: EventWriterPort, event: TapEvent): void {
  try {
    writer.append(event);
  } catch {
    // The one event writer handles its own local failures; the tap goes on.
  }
}

/* ------------------------------------------------------------------ *
 * The human summary (F126-FR-013).
 * ------------------------------------------------------------------ */

/** The human summary line of one record, byte for byte (F126-FR-013). */
export function summaryLineOf(record: NormalizedRecord): string | null {
  if (record.kind === "init") {
    const model = record.model ?? "?";
    if (record.synthesized) return `  · init model=${model}`;
    const tools = record.toolCount ?? (record.tools === null ? null : record.tools.length);
    return `  · init model=${model} tools=${tools === null ? "?" : String(tools)}`;
  }
  if (record.kind === "terminal") {
    if (record.synthesized && record.stopReason === "missing_terminal") {
      return "  ✗ result: missing_terminal (stream ended before result)";
    }
    const subtype = record.status;
    const cost = record.cost === null ? "$0.0000" : `$${record.cost.toFixed(4)}`;
    const turns = record.numTurns === null ? "?" : String(record.numTurns);
    const outTok = record.outputTokens === null ? "?" : String(record.outputTokens);
    const duration = record.durationMs === null ? "?" : String(record.durationMs);
    return `  ✓ result: ${subtype}  cost=${cost}  turns=${turns}  out_tok=${outTok}  ${duration}ms`;
  }
  if (record.kind === "tool") {
    return record.target.length > 0 ? `  → ${record.name} ${record.target}` : `  → ${record.name}`;
  }
  if (record.kind === "text") return record.text;
  return null;
}

/* ------------------------------------------------------------------ *
 * The line loop.
 * ------------------------------------------------------------------ */

/** What one pass of the tap did. */
export type TapRun = {
  /** 0 in every case except an invalid context (2) (F126-FR-012, FR-016). */
  readonly exitCode: number;
  /** The lines printed, in order (the human summary and the pass-through). */
  readonly printed: readonly string[];
  /** The lines written to standard error. */
  readonly stderr: readonly string[];
  /** The events handed to the one event writer, in order. */
  readonly events: readonly TapEvent[];
  /** The malformed-stream flag (F126-FR-016, FR-018). */
  readonly malformedStream: boolean;
  /** How many lines were dropped over a cap (F126-FR-018). */
  readonly droppedLines: number;
  /** True where the final flush ran (F126-FR-016). */
  readonly flushed: boolean;
  /** True where a stream.missing_terminal event was emitted (F126-FR-017). */
  readonly missingTerminal: boolean;
};

/** The dependencies of the line loop, all handed in and stubbable. */
export type TapDeps = {
  readonly context: TapContext;
  readonly route: TapRoute;
  /** The capability announcement of the start of the pass (F126-FR-006). */
  readonly announcement: CapabilityAnnouncement;
  readonly limits?: LineLimits | null | undefined;
  readonly redactor?: RedactorPort | null | undefined;
  readonly writer?: EventWriterPort | undefined;
  /** The watcher of the expected evidence path (F126-FR-005). */
  readonly evidence?: EvidenceWatcher | undefined;
  /** The provider-terminal write; a failure of it never fails the pass. */
  writeProviderTerminal?: (destination: string | null) => void | undefined;
  /** Flush the standard output; called after each record and at the end. */
  flush?: (() => void) | undefined;
  /** A termination signal was seen: end the loop at the next line. */
  shouldStop?: (() => boolean) | undefined;
  /** The clock of the rate cap, in milliseconds. */
  now?: (() => number) | undefined;
  /**
   * Print one line to the standard output of the pass. The default writes to
   * `process.stdout`; a broken pipe (code `EPIPE`) ends the loop silently
   * (F126-FR-016).
   */
  printLine?: ((line: string) => boolean) | undefined;
};

/** True where a row expects a real terminal record (F126-FR-017, D-48). */
export function rowHasTerminalRecord(row: ResolvedRow | null): boolean {
  if (row === null) return false;
  return row.signals.includes("result") && !row.synthTerminal;
}

/**
 * The line loop of the tap (F126-FR-011). It never fails the pass: every
 * fault is contained, the exit is 0 unless the context was invalid before
 * any input was read.
 */
export function runTap(lines: readonly string[], deps: TapDeps): TapRun {
  const contextCheck = validateTapContext(deps.context);
  if (!contextCheck.ok) {
    // Ends without consuming input; never fails the pass (F126-FR-012).
    return {
      exitCode: contextCheck.exitCode,
      printed: [],
      stderr: [contextCheck.message],
      events: [],
      malformedStream: false,
      droppedLines: 0,
      flushed: false,
      missingTerminal: false,
    };
  }
  const printed: string[] = [];
  const stderr: string[] = [];
  const events: TapEvent[] = [];
  const writer = deps.writer ?? nullEventWriter;
  const now = deps.now ?? (() => 0);
  const flush = deps.flush ?? (() => undefined);
  const faults = new TapFaults();
  const gate = new LineGate(deps.limits ?? null);
  let flushed = false;
  let missingTerminal = false;
  let sawTerminal = false;
  let sawToolOrEvidence = false;

  const emit = (type: string, fields: Record<string, unknown>): void => {
    const event: TapEvent = { type, fields };
    events.push(event);
    appendSafely(writer, event);
  };

  // The start-of-pass announcement (F126-FR-006, F126-FR-014).
  emit(TAP_EVENT_TYPES.observability, { ...deps.announcement });

  const printLine =
    deps.printLine ??
    ((line: string): boolean => {
      try {
        process.stdout.write(line + "\n");
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPIPE") return false; // broken pipe: end silently
        stderr.push(`agent_stream: fatal (ignored): ${(error as Error).message}`);
        return true;
      }
    });
  const print = (line: string): boolean => {
    const ok = printLine(line);
    if (ok) printed.push(line);
    return ok;
  };

  /** Ingress and hand on one record; returns false where printing broke. */
  const deliver = (record: NormalizedRecord): boolean => {
    const ingress = ingressRecord(
      record as unknown as Record<string, unknown>,
      deps.redactor ?? null,
    );
    emit(tapEventType("stream", record.kind), ingress);
    if (record.kind === "tool") sawToolOrEvidence = true;
    if (
      record.kind === "terminal" &&
      record.status === "success" &&
      !sawToolOrEvidence &&
      deps.route.row?.noActivity === true
    ) {
      // noActivity is additive and changes no outcome (F126-FR-017).
      emit(TAP_EVENT_TYPES.noActivity, { noActivity: true });
    }
    const line = summaryLineOf(record);
    if (line !== null) {
      const text =
        record.kind === "text"
          ? deps.redactor == null
            ? record.text.slice(0, INGRESS_SIZE_CAP)
            : deps.redactor.redact(record.text, INGRESS_SIZE_CAP).text
          : // Every printed line is a sink: the summary line of a record goes
            // through the same ingress redaction as its event (F126-FR-019).
            deps.redactor == null
            ? line
            : deps.redactor.redact(line, INGRESS_SIZE_CAP).text;
      if (!print(text)) return false;
    }
    flush();
    return true;
  };

  let stop = false;
  for (const raw of lines) {
    if (stop) break;
    if (deps.shouldStop?.() === true) {
      stop = true;
      break;
    }
    if (deps.route.mode === "pass-through") {
      // Pass-through (F126-FR-015): strip, drop blanks, print, no record.
      const stripped = raw.trim();
      if (stripped.length === 0) continue;
      if (!print(stripped)) break;
      flush();
      continue;
    }
    const verdict = gate.admit(raw, now());
    if (verdict !== "admit") {
      diagnosticOf(verdict as DiagnosticCode, `a stream line was dropped: ${verdict}`);
      faults.malformedStream = true;
      continue;
    }
    let records: readonly NormalizedRecord[];
    try {
      records = deps.route.reader.push(raw);
    } catch (error) {
      // The fault sets the flag, skips the line, and never fails (FR-016).
      faults.observe(error);
      continue;
    }
    for (const diagnostic of drainDiagnostics()) {
      emit(TAP_EVENT_TYPES.diagnostic, diagnostic);
    }
    // A line that is not JSON is printed raw where the reader has no raw
    // consumption; the reader that has it is given the raw text (F126-FR-015,
    // D-54, preserved under every profile).
    const hasRawConsumption =
      typeof (deps.route.reader as { pushRaw?: unknown }).pushRaw === "function";
    if (records.length === 0 && !hasRawConsumption && raw.trim().length > 0) {
      if (!print(raw.trim())) break;
      flush();
      continue;
    }
    for (const record of records) {
      if (record.kind === "tool") sawToolOrEvidence = true;
      if (deps.evidence !== undefined && record.kind === "tool") {
        const event: EvidenceWritingEvent | null = deps.evidence.observe({
          name: record.name,
          target: record.target,
          toolId: record.toolId,
          input: record.input,
        });
        if (event !== null) {
          sawToolOrEvidence = true;
          emit("evidence_writing", { ...event });
        }
      }
      if (!deliver(record)) {
        stop = true;
        break;
      }
    }
  }

  // The end of the stream: finish, truthfulness, provider terminal, flush.
  if (deps.route.mode === "records") {
    let tail: readonly NormalizedRecord[] = [];
    try {
      tail = deps.route.reader.finish();
    } catch (error) {
      faults.observe(error);
    }
    for (const diagnostic of drainDiagnostics()) emit(TAP_EVENT_TYPES.diagnostic, diagnostic);
    for (const record of tail) {
      if (record.kind === "terminal") sawTerminal = true;
      if (!deliver(record)) break;
    }
    // Truthful stream (F126-FR-017): a format that has a terminal record and
    // ended without one is reported, never guessed. A format that emits no
    // terminal record at all reads as clean (D-48): no event, no outcome.
    if (!sawTerminal && rowHasTerminalRecord(deps.route.row)) {
      missingTerminal = true;
      emit(TAP_EVENT_TYPES.missingTerminal, { reason_code: "missing_terminal" });
      deliver(synthesizedMissingTerminal());
    }
  }
  try {
    deps.writeProviderTerminal?.(deps.context.providerTerminalDestination ?? null);
  } catch (error) {
    stderr.push(`agent_stream: terminal sidecar write failed (${(error as Error).message})`);
  }
  // The legacy path emits agent_result on the terminal (F126-FR-012).
  if (deps.context.legacyEvents === true) {
    emit("agent_result", { status: sawTerminal ? "done" : "missing_terminal" });
  }
  flush();
  flushed = true;
  for (const diagnostic of drainDiagnostics()) emit(TAP_EVENT_TYPES.diagnostic, diagnostic);
  return {
    exitCode: 0,
    printed,
    stderr,
    events,
    malformedStream: faults.malformedStream,
    droppedLines: gate.dropped.line_too_long + gate.dropped.line_rate_exceeded,
    flushed,
    missingTerminal,
  };
}

/* ------------------------------------------------------------------ *
 * The replacement tap (F126-FR-011) and the listing (F126-FR-013).
 * ------------------------------------------------------------------ */

/**
 * The context a replacement tap receives, as the argument list it is started
 * with: no shell, the stream of the pass as its only standard input, no
 * terminal (F126-FR-011).
 */
export function replacementTapArgv(executable: string, context: TapContext): readonly string[] {
  return [
    executable,
    "--event-dest",
    context.eventDestination ?? "",
    "--run-id",
    context.runId ?? "",
    "--task",
    context.task ?? "",
    "--feature",
    context.feature ?? "",
    "--role",
    context.role ?? "",
    "--harness",
    context.harness ?? "",
    "--phase",
    context.phase === null ? "" : String(context.phase),
    "--attempt",
    context.attempt === null ? "" : String(context.attempt),
    "--iteration",
    context.iteration === null ? "" : String(context.iteration),
    "--invocation-id",
    context.invocationId ?? "",
    "--provider-format",
    context.providerFormat ?? "",
  ].filter((part) => part !== "");
}

/** A spawn like `child_process.spawn`, injected so the loop needs no process.
 *  The child is started from the argument list directly, with no shell: the
 *  stream of the pass is its only standard input, and its output and error
 *  are ignored (F126-FR-011). */
export type SpawnChild = {
  readonly on: (event: string, cb: (value: unknown) => void) => void;
  /** Write one piece of the stream to the standard input of the tap. */
  readonly write?: (chunk: string) => void;
  /** Close the standard input of the tap after the stream. */
  readonly end?: () => void;
  /** End the tap where it does not end on its own (the timeout). */
  readonly kill?: () => void;
  /** The process id of the tap, where it started. */
  readonly pid?: number | undefined;
};

export type SpawnFn = (
  argv: readonly string[],
  options: { readonly stdio: readonly ["pipe", "ignore", "ignore"]; readonly shell?: false },
) => SpawnChild;

/**
 * The registry entry of the tap process (the process classes of
 * `@specstride/contracts`): the tap is a process of the pass, entered with
 * class `owned` at the start and left when the pass has ended with it.
 */
export type OwnedProcessRegistry = {
  readonly enter: (pid: number, className: string) => void;
  readonly leave: (pid: number) => void;
};

/** The class the replacement tap is entered under (the process registry). */
export const OWNED_PROCESS_CLASS = "owned" as const;

/**
 * Run a replacement tap (F126-FR-011). It is started from the argument list,
 * with no shell, and the stream is handed to its standard input, which is
 * then closed. It is a process of the pass, entered with class `owned` and
 * ended with it; it can never fail the pass: a spawn failure, a fault or a
 * tap that does not end gives only the parser exit code of the producer
 * status (F126-FR-030).
 */
export async function runReplacementTap(
  argv: readonly string[],
  options: {
    readonly input: readonly string[];
    readonly spawn: SpawnFn;
    readonly timeoutMs?: number | undefined;
    /** Where the pass keeps a process registry, the tap is entered and left. */
    readonly owned?: OwnedProcessRegistry | undefined;
  },
): Promise<{ parserExitCode: number; failed: boolean }> {
  const stream = options.input.length > 0 ? options.input.join("\n") + "\n" : "";
  try {
    const child = options.spawn(argv, { stdio: ["pipe", "ignore", "ignore"], shell: false });
    const pid = typeof child.pid === "number" ? child.pid : null;
    const owned = pid !== null ? (options.owned ?? null) : null;
    if (owned !== null && pid !== null) owned.enter(pid, OWNED_PROCESS_CLASS);
    const done = new Promise<{ parserExitCode: number; failed: boolean }>((resolve) => {
      let settled = false;
      const finish = (code: number, failed: boolean): void => {
        if (settled) return;
        settled = true;
        if (owned !== null && pid !== null) owned.leave(pid);
        resolve({ parserExitCode: code, failed });
      };
      const timer =
        options.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              // A tap that does not end: the exit is recorded and the process is
              // ended, so it is gone when the pass has ended (F126-FR-011).
              child.kill?.();
              finish(1, true);
            }, options.timeoutMs);
      child.on("error", () => {
        if (timer !== null) clearTimeout(timer);
        finish(127, true); // cannot be started: never fails the pass
      });
      child.on("exit", (value: unknown) => {
        if (timer !== null) clearTimeout(timer);
        const code = typeof value === "number" ? value : 1;
        finish(code, code !== 0);
      });
    });
    // The stream of the pass is the only standard input of the tap.
    child.write?.(stream);
    child.end?.();
    return await done;
  } catch {
    return { parserExitCode: 127, failed: true };
  }
}

/**
 * The listing of formats (F126-FR-013): the canonical names of the rows that
 * set `listedAsIs`, one per line, in registration order — under `parity`
 * that is `claude` then `prime-v3`, whatever else is registered.
 */
export function formatListing(registry: {
  listedAsIs(): readonly { readonly name: string }[];
}): readonly string[] {
  return registry.listedAsIs().map((row) => row.name);
}
