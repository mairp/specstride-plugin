/**
 * T025 — the hand-over of the flags and of the stream facts (F128-FR-006).
 *
 * F128-FR-006: *When the Loki sink is on, the engine MUST hand the pass loop
 * the flags `--stream-json` and `--loki-url <address>`. When the OTLP
 * exporter is on, it MUST hand `--stream-json` and `--otel-url <address>`.
 * With `--debug` it MUST hand `--debug`. Stream facts of a pass (one usage
 * fact per model result, one tool call per tool use) MUST reach every enabled
 * sink as events of the one event flow; the port MUST have no second pipeline
 * that pipes a stream to a shipper. When both sinks are on, both MUST receive
 * the same stream facts.*
 *
 * The flags are COMPUTED FROM THE RESOLVED CONFIGURATION, not parsed: the
 * engine asks this module what to hand the pass loop once it has resolved the
 * keys of feature 110 (proposal U1). The stream facts are ordinary events of
 * the catalogue (`stream.result`, `tool.call`) written into the ONE event
 * flow — the dispatcher the sinks are registered on — so no second pipeline
 * exists to pipe a stream to a shipper, and both sinks receive the same facts
 * because the dispatcher fans the same event out to every enabled sink
 * (EP-08, `specstride.event-sink/1`).
 */
import { MAJOR as EVENT_MAJOR, SCHEMA as EVENT_SCHEMA } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import type { ExportConfig } from "./config.ts";

/**
 * The flags the engine hands the pass loop for one resolved configuration
 * (F128-FR-006). `--stream-json` appears once, before the URL flags; a URL
 * flag is handed with the address the configuration resolved (its default
 * included, F128-FR-002). `--debug` is appended last, only when asked.
 */
export function passLoopFlags(
  config: ExportConfig,
  options: { readonly debug?: boolean } = {},
): string[] {
  const flags: string[] = [];
  if (config.loki.enabled || config.otel.enabled) flags.push("--stream-json");
  if (config.loki.enabled) flags.push("--loki-url", config.loki.url);
  if (config.otel.enabled) flags.push("--otel-url", config.otel.url);
  if (options.debug) flags.push("--debug");
  return flags;
}

/** The shared frame of a stream-fact event (the envelope, annex X §X.1). */
export type StreamFactFrame = {
  readonly seq: number;
  readonly ts: string;
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId: string;
  readonly phaseId: string;
};

function envelope(
  frame: StreamFactFrame,
  type: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    schema: EVENT_SCHEMA,
    v: EVENT_MAJOR,
    seq: frame.seq,
    ts: frame.ts,
    type,
    runId: frame.runId,
    launchId: frame.launchId,
    engineStartId: frame.engineStartId,
    phaseId: frame.phaseId,
    data,
  } as EventEnvelope;
}

/**
 * ONE usage fact per model result record of a stream (F128-FR-006): the event
 * `stream.result`, whose as-is name is `api_request` (F128-FR-009). The fields
 * are the ones the baseline put on the fact (`cost_usd`, `duration_ms`,
 * `is_error` — the reference capture `tests/parity/128/reference/`).
 */
export function usageFactEvent(
  frame: StreamFactFrame,
  result: {
    readonly costUsd?: number;
    readonly durationMs?: number;
    readonly isError?: boolean;
  },
): EventEnvelope {
  const data: Record<string, unknown> = {};
  if (result.costUsd !== undefined) data["cost_usd"] = result.costUsd;
  if (result.durationMs !== undefined) data["duration_ms"] = result.durationMs;
  if (result.isError !== undefined) data["is_error"] = result.isError;
  return envelope(frame, "stream.result", data);
}

/**
 * ONE tool call per tool use of a stream (F128-FR-006): the event `tool.call`,
 * whose as-is name is `tool_use` (F128-FR-009).
 */
export function toolCallFactEvent(
  frame: StreamFactFrame,
  call: { readonly tool: string; readonly toolId?: string; readonly target?: string },
): EventEnvelope {
  const data: Record<string, unknown> = { tool: call.tool };
  if (call.toolId !== undefined) data["toolId"] = call.toolId;
  if (call.target !== undefined) data["target"] = call.target;
  return envelope(frame, "tool.call", data);
}

/** The write half of the ONE event flow, as the dispatcher of EP-08 holds it. */
export type EventFlow = {
  write(event: EventEnvelope): Promise<void> | void;
};

/**
 * Hand a stream fact to the ONE event flow. There is no per-sink call here
 * and no second pipeline: the dispatcher the sinks are registered on fans the
 * event out to every enabled sink, so both sinks receive the same facts
 * (F128-FR-006; EP-08 `specstride.event-sink/1`).
 */
export async function handOverToFlow(flow: EventFlow, event: EventEnvelope): Promise<void> {
  await flow.write(event);
}
