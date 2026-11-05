/**
 * T030 — the finalization: one invocation reconciled into the result, the
 * decision and the one `agent_result` event (F126-FR-034, F126-FR-035;
 * origins C-155 to C-163, C-058 B-0781 to B-0783, CQ-228).
 *
 * The finalization reads the invocation record (required), the producer
 * status and the provider terminal (both optional), reconciles the result,
 * writes it once, emits one `agent_result` and folds the result into the
 * breakers. Outside the compatibility projection the event goes through the
 * one event writer, which calls every open sink after the primary write, as
 * for every other event of the pass (CQ-228); in the as-is form the event
 * goes to the local event destination only, and an empty destination skips
 * it (B-2160).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import {
  AlreadyFinalizedError,
  buildResultRecord,
  writeJsonOnce,
  type ProducerFields,
  type ResultInput,
} from "./writers.ts";
import { identityFields, type InvocationIdentity } from "./identity.ts";
import {
  classifyKillReason,
  reconcileInvocation,
  type ProviderTerminalObservation,
} from "./reconcile.ts";
import {
  foldIntoBreakers,
  loadBreakerState,
  saveBreakerState,
  type BreakerFields,
} from "./breakers.ts";
import { artifactPath } from "./layout.ts";
import type { EventWriterPort, TapEvent } from "../stream/tap.ts";

/** The event type of the finalization (C-157, C-163). */
export const AGENT_RESULT_EVENT = "agent_result" as const;

/** The refusal of a result that has been finalized already (F126-FR-035). */
export class AlreadyFinalizedInvocationError extends Error {
  constructor() {
    super("invocation result has already been finalized");
    this.name = "AlreadyFinalizedInvocationError";
  }
}

/** The decision of the finalization (row 175; F126-FR-034). */
export type Decision = "cap_halt" | "halt" | "continue";

/** What one finalization run produced. */
export type FinalizeRun = {
  /** 0 whenever reconciliation completes; 1 when an input is missing. */
  readonly exitCode: number;
  /** The six output lines, in order (B-2159). */
  readonly lines: readonly string[];
  readonly decision: Decision;
  readonly reasonCode: string;
  readonly isError: boolean;
  readonly count: number;
  readonly killClass: string | null;
  readonly capCount: number;
  /** The result record, as written or as consumed; null when nothing ran. */
  readonly result: Readonly<Record<string, unknown>> | null;
  /** The events handed to the one event writer, in order. */
  readonly events: readonly TapEvent[];
  /** True where the record was missing and the pass is not counted (B-0781). */
  readonly skipped: boolean;
};

/** The inputs of one finalization run (F126-FR-034). */
export type FinalizeOptions = {
  /** The directory of the invocation (from `run:<runId>:current-pass`). */
  readonly dir: string;
  /** The local event destination of the as-is form; empty skips the event. */
  readonly eventsPath?: string | null | undefined;
  /** The breaker state file (C-160 B-2158). */
  readonly breakerStatePath: string;
  /** The limit of the consecutive-error breaker. */
  readonly limit: number;
  /** The kill reason handed in by the controller (B-0783). */
  readonly killReason?: string | null | undefined;
  /** The threshold of the hard-cap breaker (default 0). */
  readonly capLimit?: number | undefined;
  /**
   * The one event writer. Given, the `agent_result` goes through it and the
   * writer calls the open sinks after the primary write (CQ-228). In the
   * compatibility projection no writer is handed in and the event goes to
   * the local destination only (B-2160).
   */
  readonly writer?: EventWriterPort | undefined;
  /** True under the as-is form: the local destination only, never a sink. */
  readonly compatibilityProjection?: boolean | undefined;
  /** A cancellation the controller hands in; never set by the default run. */
  readonly cancelled?: boolean | undefined;
  /** Set only where a caller says the schema is unsupported. */
  readonly unsupportedSchema?: boolean | undefined;
};

/** Read a JSON object file, or null where it is missing or unreadable. */
function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The producer fields of the producer status file, or the zero fields. */
function producerOf(record: Record<string, unknown> | null): ProducerFields {
  const numberOf = (key: string): number | null =>
    typeof record?.[key] === "number" ? (record[key] as number) : null;
  return {
    producer_exit_code: numberOf("producer_exit_code"),
    producer_signal:
      typeof record?.["producer_signal"] === "string"
        ? (record["producer_signal"] as string)
        : null,
    parser_exit_code: numberOf("parser_exit_code"),
    timed_out: record?.["timed_out"] === true,
    launch_failed: record?.["launch_failed"] === true,
    duration_ms:
      typeof record?.["duration_ms"] === "number" ? (record["duration_ms"] as number) : 0,
  };
}

/** The provider terminal observation of the sidecar file, or null. */
function terminalOf(record: Record<string, unknown> | null): ProviderTerminalObservation | null {
  if (record === null) return null;
  const inner = record["provider_terminal"];
  if (inner === null || inner === undefined) return null;
  if (typeof inner !== "object" || Array.isArray(inner)) return null;
  const terminal = inner as Record<string, unknown>;
  return {
    status: terminal["status"] === "error" ? "error" : "success",
    reasonCode:
      typeof terminal["reason_code"] === "string"
        ? (terminal["reason_code"] as string)
        : typeof terminal["reasonCode"] === "string"
          ? (terminal["reasonCode"] as string)
          : null,
    reason: typeof terminal["reason"] === "string" ? (terminal["reason"] as string) : null,
    stopReason:
      typeof terminal["stop_reason"] === "string" ? (terminal["stop_reason"] as string) : null,
    extra: terminal,
  };
}

/**
 * The keys the `agent_result` event never carries: the schema and the eight
 * identity keys (B-2149, B-2165).
 */
const IDENTITY_KEYS = new Set([
  "schema",
  "runId",
  "feature",
  "role",
  "harness",
  "phase",
  "attempt",
  "iteration",
  "invocationId",
]);

/** The fields of the `agent_result` event, from the result record. */
export function buildAgentResultFields(
  result: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (IDENTITY_KEYS.has(key)) continue;
    fields[key] = value;
  }
  return fields;
}

/** The inputs of the reconciliation step, whole (F126-FR-033, FR-034). */
export type ReconcileAndWriteInput = {
  readonly identity: InvocationIdentity;
  readonly producer: ProducerFields;
  readonly providerTerminal: ProviderTerminalObservation | null;
  readonly malformedStream: boolean;
  readonly providerStatus: number | string | null;
  readonly killReason: string | null;
  readonly unsupportedSchema?: boolean | undefined;
  readonly cancelled?: boolean | undefined;
};

/**
 * The reconciliation step (F126-FR-035): reconcile and write the result
 * once. Called when a result already exists it refuses with
 * `invocation result has already been finalized` and writes nothing.
 */
export function reconcileAndWriteResult(
  dir: string,
  input: ReconcileAndWriteInput,
): Record<string, unknown> {
  if (existsSync(artifactPath(dir, "pass:result"))) {
    throw new AlreadyFinalizedInvocationError();
  }
  const record = buildResultRecordOf(input);
  try {
    writeJsonOnce(artifactPath(dir, "pass:result"), record);
  } catch (error) {
    if (error instanceof AlreadyFinalizedError) {
      throw new AlreadyFinalizedInvocationError();
    }
    throw error;
  }
  return record;
}

/** The result record of one reconciliation, with the kill fields added. */
function buildResultRecordOf(input: ReconcileAndWriteInput): Record<string, unknown> {
  const outcome = reconcileInvocation({
    producer: input.producer,
    providerTerminal: input.providerTerminal,
    malformedStream: input.malformedStream,
    unsupportedSchema: input.unsupportedSchema,
    cancelled: input.cancelled,
  });
  const recordInput: ResultInput = {
    identity: input.identity,
    status: outcome.status,
    reason_code: outcome.reason_code,
    reason: outcome.reason,
    provider_status: input.providerStatus,
    provider_stop_reason: outcome.provider_stop_reason,
    producer: input.producer,
    providerTerminal: input.providerTerminal?.extra ?? null,
  };
  const record = buildResultRecord(recordInput);
  const killClass = classifyKillReason(input.killReason);
  if (killClass !== null) {
    // A classifiable kill reason adds its fields to the result (B-2161).
    record["kill_class"] = killClass;
    record["kill_reason"] = (input.killReason as string).trim();
  }
  return record;
}

/** The decision, after the fold (B-2151 to B-2153). */
export function decideAfterFold(
  breakers: BreakerFields,
  limit: number,
  capLimit: number,
): Decision {
  if (capLimit > 0 && breakers.cap_count >= capLimit) return "cap_halt";
  if (limit > 0 && breakers.count >= limit) return "halt";
  return "continue";
}

/** The six output lines, in order (B-2159). */
export function sixLinesOf(run: {
  readonly decision: Decision;
  readonly reasonCode: string;
  readonly isError: boolean;
  readonly count: number;
  readonly killClass: string | null;
  readonly capCount: number;
}): readonly string[] {
  return [
    run.decision,
    run.reasonCode,
    run.isError ? "true" : "false",
    String(run.count),
    run.killClass ?? "",
    String(run.capCount),
  ];
}

/**
 * Finalize one invocation (F126-FR-034, F126-FR-035). It ends with exit
 * code 0 whenever reconciliation completes, whatever the decision, and with
 * exit code 1 when the invocation record or a required input is missing.
 */
export function finalizeInvocation(options: FinalizeOptions): FinalizeRun {
  const record = readJsonObject(artifactPath(options.dir, "pass:invocation"));
  if (record === null) {
    // No record: the finalization is skipped and no breaker counts it
    // (F126-FR-029, B-0781).
    return {
      exitCode: 1,
      lines: [],
      decision: "continue",
      reasonCode: "",
      isError: false,
      count: 0,
      killClass: null,
      capCount: 0,
      result: null,
      events: [],
      skipped: true,
    };
  }
  const identity: InvocationIdentity = {
    runId: String(record["runId"] ?? ""),
    feature: String(record["feature"] ?? ""),
    role: (record["role"] as InvocationIdentity["role"]) ?? "proposer",
    harness: String(record["harness"] ?? ""),
    phase: String(record["phase"] ?? ""),
    attempt: Number(record["attempt"] ?? 1),
    iteration: Number(record["iteration"] ?? 1),
    invocationId: String(record["invocationId"] ?? ""),
  };
  const producer = producerOf(readJsonObject(artifactPath(options.dir, "pass:producer-status")));
  const terminalRecord = readJsonObject(artifactPath(options.dir, "pass:provider-terminal"));
  const terminal = terminalOf(terminalRecord);
  const malformedStream = terminalRecord?.["malformed_stream"] === true;
  const providerStatus = (terminalRecord?.["provider_status"] ?? null) as number | string | null;
  const killReason = options.killReason ?? null;
  const killClass = classifyKillReason(killReason);

  const existing = readJsonObject(artifactPath(options.dir, "pass:result"));
  const events: TapEvent[] = [];
  let result: Readonly<Record<string, unknown>>;
  let emitEvent: boolean;
  if (existing !== null) {
    // Consumed as it is: no second reconciliation, no second event, but the
    // breaker still records it (B-2162).
    result = existing;
    emitEvent = false;
  } else {
    const written = buildResultRecordOf({
      identity,
      producer,
      providerTerminal: terminal,
      malformedStream,
      providerStatus,
      killReason,
      unsupportedSchema: options.unsupportedSchema,
      cancelled: options.cancelled,
    });
    try {
      writeJsonOnce(artifactPath(options.dir, "pass:result"), written);
      result = written;
      emitEvent = true;
    } catch (error) {
      if (!(error instanceof AlreadyFinalizedError)) throw error;
      // A concurrent finalization won: consume its result as it is, with
      // no second event (F126-FR-035).
      const raced = readJsonObject(artifactPath(options.dir, "pass:result"));
      if (raced === null) throw new AlreadyFinalizedInvocationError();
      result = raced;
      emitEvent = false;
    }
  }

  if (emitEvent) {
    emitAgentResult(options, result, identity, events);
  }
  const breakers = foldBreakers(options, result, identity, killClass);
  const decision = decideAfterFold(breakers, options.limit, options.capLimit ?? 0);
  const isError = result["is_error"] === true;
  const reasonCode = String(result["reason_code"] ?? "");
  return {
    exitCode: 0,
    lines: sixLinesOf({
      decision,
      reasonCode,
      isError,
      count: breakers.count,
      killClass: breakers.last_kill_class,
      capCount: breakers.cap_count,
    }),
    decision,
    reasonCode,
    isError,
    count: breakers.count,
    killClass: breakers.last_kill_class,
    capCount: breakers.cap_count,
    result,
    events,
    skipped: false,
  };
}

/** Fold one result into the breakers and rewrite the state file. */
function foldBreakers(
  options: FinalizeOptions,
  result: Readonly<Record<string, unknown>>,
  identity: InvocationIdentity,
  killClass: string | null,
): BreakerFields {
  const before = loadBreakerState(options.breakerStatePath);
  const after = foldIntoBreakers(before, {
    invocationId: identity.invocationId,
    isError: result["is_error"] === true,
    reasonCode: String(result["reason_code"] ?? ""),
    killClass:
      killClass ??
      (typeof result["kill_class"] === "string" ? (result["kill_class"] as string) : null),
  });
  saveBreakerState(options.breakerStatePath, after);
  return after;
}

/**
 * Emit the one `agent_result` (CQ-228). Outside the compatibility
 * projection the event goes through the one event writer, which calls every
 * open sink after the primary write. In the compatibility projection the
 * event goes to the local destination only, and an empty destination skips
 * it (B-2160); no sink is called from this process.
 */
function emitAgentResult(
  options: FinalizeOptions,
  result: Readonly<Record<string, unknown>>,
  identity: InvocationIdentity,
  events: TapEvent[],
): void {
  const fields = buildAgentResultFields(result);
  if (options.compatibilityProjection === true) {
    const destination = options.eventsPath ?? "";
    if (destination.length === 0) return; // an empty destination skips it
    const envelope = {
      ts: (Date.now() / 1000).toFixed(9),
      time: new Date().toISOString(),
      event: AGENT_RESULT_EVENT,
      ...identityFields(identity),
      sequence: 1,
      ...fields,
    };
    appendFileSync(destination, `${JSON.stringify(envelope)}\n`, "utf8");
    return;
  }
  const writer = options.writer;
  if (writer === undefined) return;
  const event: TapEvent = { type: AGENT_RESULT_EVENT, fields };
  events.push(event);
  writer.append(event);
}
