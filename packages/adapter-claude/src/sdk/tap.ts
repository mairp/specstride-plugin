// @specstride/adapter-claude — src/sdk/tap.ts
//
// Extracted from Lisa at commit `363e6a3`
// (`packages/agents/src/claude-agent-sdk/tap.ts`) as source, unchanged in
// substance (F125-FR-040). The only structural change is the wire serializer:
// Lisa imported `serializeV1` and `EmitClock` from `@lisa/core`; here both are
// injected as narrow structural types so this file imports nothing outside the
// adapter. The kept behaviours:
//
//   - the initial message gives the model, the session id (via the pass state)
//     and the tool count;
//   - an assistant message gives its text blocks and its tool-use blocks with
//     a compact one-line target of at most 200 characters, taken from the
//     first present of a file path, a path, a command, a pattern, an address
//     or a notebook path, else the first names of the input;
//   - the final message gives the usage, the session id, the number of turns
//     and the error;
//   - any other message kind is ignored;
//   - a failure of the tap NEVER breaks the loop;
//   - a backend that ignores structured output falls back to raw output passed
//     through unchanged with no structured record (`tapRaw`).
//
// The tap holds no prompt and no reply in a structured record.

import { createHash } from "node:crypto";

/** Chars kept of an assistant text block in an `agent_text` event (baseline TEXT_MAX). */
const TEXT_MAX = 160;

/** The clock the v1 lines are stamped with (structural form of `EmitClock`). */
export interface EmitClock {
  hrNow(): number | string;
  isoLocalNow(): string;
}

/** Envelope context shared by every tap line (run/task/backend labels). */
export interface TapContext {
  runId?: string | undefined;
  task?: string | undefined;
  backend?: string | undefined;
}

/** One v1 wire record (structural form; the serializer turns it into bytes). */
export interface V1Event extends Record<string, unknown> {
  ts: number | string;
  time: string;
  event: string;
}

/** The byte serializer of the v1 wire, injected (Lisa's `serializeV1`). */
export type SerializeV1 = (ev: V1Event) => string;

/** The output of tapping one event: the v1 line(s) + a human echo. */
export interface TapOutput {
  /** Zero or more v1 `events.jsonl` lines; a tool call that targets the evidence file yields TWO. */
  v1Lines: string[];
  /** A compact, human-readable echo for `run.log` / stdout (never JSON). */
  human: string;
}

/** The typed events the tap maps (structural form of the harness's events). */
export type TapEvent =
  | {
      kind: "init";
      model: string | undefined;
      sessionId: string;
      tools: readonly string[];
      iteration: number | undefined;
    }
  | {
      kind: "text";
      text: string;
      iteration: number | undefined;
    }
  | {
      kind: "tool";
      name: string;
      detail: string | undefined;
      iteration: number | undefined;
    }
  | {
      kind: "result";
      subtype: "success" | "error";
      usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        cacheCreationTokens: number | null;
        costUsd: number | null;
      };
      sessionId?: string;
      numTurns?: number;
      isError: boolean;
      errorText?: string;
      failureKind?: string;
      convergenceFingerprint?: string;
      requestedModel?: string;
      actualModel?: string;
      iteration: number | undefined;
    };

/**
 * Python-style stringification so the v1 wire stays byte-identical to the
 * baseline emitter: a boolean serializes as `True`/`False` (Python
 * `str(bool)`); everything else is `String(v)`.
 */
function pyStr(v: unknown): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

/** Collapse to one line and clamp to `limit` chars (baseline `one_line`). */
export function oneLine(s: string, limit: number): string {
  const collapsed = s.split(/\s+/).filter(Boolean).join(" ");
  return collapsed.length <= limit ? collapsed : collapsed.slice(0, limit - 1) + "…";
}

/**
 * True when a tool call is writing a `GATE<N>-EVIDENCE.md` (incl. its `.tmp`)
 * — the artifact-delivery moment. Only Write/Edit/MultiEdit/NotebookEdit/Bash
 * qualify, and the target must name a gate evidence file.
 */
export function looksLikeEvidence(tool: string, detail: string | undefined): boolean {
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"].includes(tool)) return false;
  const hay = detail ?? "";
  return hay.includes("GATE") && hay.includes("-EVIDENCE.md");
}

/**
 * The harness event tap. One instance per proposer pass (it carries the
 * last-seen model and the once-only evidence-writing latch). `tap()` maps one
 * structured event onto the v1 wire + a human echo; `tapRaw()` is the
 * raw-output degradation path.
 */
export class HarnessTap {
  private modelSeen: string | undefined;
  private evidenceAnnounced = false;
  private readonly clock: EmitClock;
  private readonly ctx: TapContext;
  private readonly serialize: SerializeV1;

  constructor(
    clock: EmitClock,
    ctx: TapContext = {},
    serialize: SerializeV1 = (ev) => JSON.stringify(ev),
  ) {
    this.clock = clock;
    this.ctx = ctx;
    this.serialize = serialize;
  }

  /** Map one structured pass event onto the v1 wire + a human echo. */
  tap(ev: TapEvent): TapOutput {
    switch (ev.kind) {
      case "init": {
        this.modelSeen = ev.model ?? this.modelSeen;
        const tools = ev.tools?.length ?? 0;
        const v1 = this.emit("agent_init", ev.iteration, {
          model: this.modelSeen,
          session_id: ev.sessionId,
          tools,
        });
        return {
          v1Lines: [v1],
          human: `  · init model=${this.modelSeen ?? "?"} session=${ev.sessionId} tools=${tools}`,
        };
      }
      case "tool": {
        const target = ev.detail ?? "";
        const lines = [this.emit("agent_tool", ev.iteration, { tool: ev.name, target })];
        // The one-shot evidence-writing signal: fire the first time a mutating
        // tool touches a GATE<N>-EVIDENCE.md.
        if (!this.evidenceAnnounced && looksLikeEvidence(ev.name, ev.detail)) {
          this.evidenceAnnounced = true;
          lines.push(this.emit("evidence_writing", ev.iteration, { tool: ev.name, target }));
        }
        return {
          v1Lines: lines,
          human: target ? `  → ${ev.name} ${target}` : `  → ${ev.name}`,
        };
      }
      case "text": {
        const v1 = this.emit("agent_text", ev.iteration, { text: oneLine(ev.text, TEXT_MAX) });
        return { v1Lines: [v1], human: ev.text };
      }
      case "result": {
        const v1 = this.emit("agent_result", ev.iteration, {
          model: this.modelSeen,
          requested_model: ev.requestedModel,
          actual_model: ev.actualModel,
          session_id: ev.sessionId,
          is_error: ev.isError,
          subtype: ev.subtype,
          failure_kind: ev.failureKind,
          cost_usd: ev.usage.costUsd,
          num_turns: ev.numTurns,
          input_tokens: ev.usage.inputTokens,
          output_tokens: ev.usage.outputTokens,
          cache_read_tokens: ev.usage.cacheReadTokens,
          cache_creation_tokens: ev.usage.cacheCreationTokens,
        });
        const cost =
          ev.usage.costUsd !== null && Number.isFinite(ev.usage.costUsd) ? ev.usage.costUsd : 0;
        return {
          v1Lines: [v1],
          human:
            `  ${ev.isError ? "✗" : "✓"} result: ${ev.subtype}  ` +
            `cost=$${cost.toFixed(4)}  turns=${ev.numTurns ?? "?"}  ` +
            `out_tok=${ev.usage.outputTokens ?? "?"}`,
        };
      }
      default:
        // Any other kind is ignored: no structured record, no echo.
        return { v1Lines: [], human: "" };
    }
  }

  /**
   * The raw-output degradation path (F125-FR-040): a line a structure-less
   * backend emitted. It passes through verbatim as the human echo and
   * produces NO structured v1 record.
   */
  tapRaw(line: string): TapOutput {
    return { v1Lines: [], human: line };
  }

  /** Build one v1 line (baseline field order + `iter`). */
  private emit(
    event: string,
    iteration: number | undefined,
    fields: Record<string, unknown>,
  ): string {
    const ev: V1Event = {
      ts: this.clock.hrNow(),
      time: this.clock.isoLocalNow(),
      event,
    };
    if (this.ctx.runId !== undefined) ev.run_id = this.ctx.runId;
    if (this.ctx.task !== undefined) ev.task = this.ctx.task;
    if (this.ctx.backend !== undefined) ev.backend = this.ctx.backend;
    if (iteration !== undefined) ev["iter"] = String(iteration);
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      ev[k] = pyStr(v);
    }
    return this.serialize(ev);
  }
}

/** The terminal event `tapHarnessPass` returns. */
export type TerminalEvent = Extract<TapEvent, { kind: "result" }>;

/**
 * Drive a whole harness pass through the tap: consume the event stream, hand
 * every v1 line to `onV1`, echo the human line via `onHuman`, and return the
 * terminal event. Best-effort: a throwing tap or sink NEVER aborts the pass
 * (F125-FR-040).
 */
export async function tapHarnessPass(
  events: AsyncIterable<TapEvent>,
  tap: HarnessTap,
  sinks: { onV1?: (line: string) => void; onHuman?: (line: string) => void } = {},
): Promise<TerminalEvent | undefined> {
  let terminal: TerminalEvent | undefined;
  const behavior = createHash("sha256");
  for await (const ev of events) {
    if (ev.kind === "tool") {
      behavior.update(`tool:${ev.name}:${oneLine(String(ev.detail ?? ""), 240)}\n`);
    } else if (ev.kind === "text") {
      behavior.update(`text:${oneLine(String(ev.text), 2000)}\n`);
    } else if (ev.kind === "result") {
      behavior.update(`result:${ev.subtype}:${ev.failureKind ?? ""}:${ev.isError}\n`);
      terminal = ev as TerminalEvent;
    }
    let out: TapOutput;
    try {
      out = tap.tap(ev);
    } catch {
      continue; // a tap mapping error must never break the loop
    }
    for (const line of out.v1Lines) {
      try {
        sinks.onV1?.(line);
      } catch {
        // best-effort: a full disk / dead sink must not stall the run
      }
    }
    if (out.human) {
      try {
        sinks.onHuman?.(out.human);
      } catch {
        // best-effort
      }
    }
  }
  if (!terminal) return undefined;
  return {
    ...terminal,
    convergenceFingerprint: terminal.convergenceFingerprint ?? behavior.digest("hex"),
  };
}
