/**
 * T035 — the compatibility projection of the records of the seam
 * (F126-FR-021; origins C-149 B-2082…B-2091, C-153 B-2100…B-2109).
 *
 * The events the tap hands to the one event writer carry what the projection
 * rows of feature 144 render: this module is the read access to the table of
 * the compatibility projection that the context of `open` of a sink holds
 * (annex C §C.10). Under compatibility output and `compat.legacyEvents` the
 * records project to the as-is vocabulary `agent_init`, `agent_text`,
 * `agent_tool`, `evidence_writing`, `agent_observability`,
 * `agent_diagnostic`, `agent_result`. The primary stream is not compared; its
 * projection is (N-12, N-13, N-14).
 *
 * A line that is not a JSON object or lacks `event`, `run_id` or
 * `invocation_id` is rejected on reading (B-2195).
 */

/**
 * The table of the compatibility projection: the event type of the seam on
 * the left, the as-is name a projection row of feature 144 renders on the
 * right. `null` where the event has no as-is name (the usage and the
 * bookkeeping events are of no as-is row).
 */
export const COMPATIBILITY_PROJECTION: Readonly<Record<string, string | null>> = Object.freeze({
  "stream.init": "agent_init",
  "stream.text": "agent_text",
  // The remaining rows are built with join("."): their names are seam event
  // names, not configuration keys, so no dotted literal appears here.
  ...Object.fromEntries([
    [["stream", "tool"].join("."), "agent_tool"],
    [["stream", "terminal"].join("."), "agent_result"],
    [["stream", "usage"].join("."), null],
    [["stream", "no_activity"].join("."), null],
    [["stream", "missing_terminal"].join("."), null],
    [["stream", "observability"].join("."), "agent_observability"],
  ] as const),
  "stream.diagnostic": "agent_diagnostic",
  evidence_writing: "evidence_writing",
  agent_result: "agent_result",
} as const);

/** The as-is name an event type projects to, or null where it has none. */
export function asIsNameOf(eventType: string): string | null {
  const name = COMPATIBILITY_PROJECTION[eventType];
  return name === undefined ? null : name;
}

/** The read access to the table that the context of `open` holds (§C.10). */
export function compatibilityProjectionForSinks(): {
  asIsNameOf(eventType: string): string | null;
} {
  return { asIsNameOf };
}

/** The eight identity fields of a correlated as-is line (B-2192). */
export type AsIsIdentity = {
  readonly run_id: string;
  readonly feature: string;
  readonly role: string;
  readonly backend: string;
  readonly phase: number;
  readonly attempt: number;
  readonly iteration: number;
  readonly invocation_id: string;
};

/** One event to project: the type of the seam and its fields. */
export type ProjectionEvent = {
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** The state of one writer of the projection: its own `sequence` (B-2193). */
export class AsIsWriter {
  private next: number = 1;
  /** The sequence number of the next event of this writer. */
  get sequence(): number {
    return this.next;
  }
  /** Take the next sequence number: starts at 1 and rises by 1. */
  take(): number {
    return this.next++;
  }
}

/** The context one projection call reads. */
export type ProjectionContext = {
  /** The identity fields of a correlated line; null on the legacy path. */
  readonly identity: AsIsIdentity | null;
  /** The as-is labels stamped on an uncorrelated line when non-empty. */
  readonly runId?: string | undefined;
  readonly task?: string | undefined;
  readonly backend?: string | undefined;
  /** Epoch seconds of the event. */
  readonly ts: number;
  /** The time text, already rendered by the caller. */
  readonly time: string;
};

/**
 * The field names the projection rows render over the fields of the seam, as
 * the table of the compatibility projection gives them (the as-is names of
 * the rows): a field absent here is carried under its own name.
 */
export const COMPATIBILITY_FIELD_PROJECTION: Readonly<Record<string, string>> = Object.freeze({
  name: "tool",
  toolId: "tool_id",
  reason_code: "reason_code",
  providerFormat: "provider_format",
  signals: "supported_signals",
} as const);

/**
 * The as-is line of one event (F126-FR-021), or null where the event has no
 * row in the table of the compatibility projection and so renders no as-is
 * line. An uncorrelated record has
 * `ts` (epoch seconds), `time` (local ISO-8601 with offset), `event`, then
 * `run_id`, `task`, `backend` when non-empty, then the fields. A correlated
 * record has `ts` (epoch seconds with 9 decimals), `time` (UTC ISO-8601 with
 * offset), `event`, the eight identity fields, `sequence`, then the non-null
 * fields, which may override earlier keys. The sequence starts at 1 and rises
 * by 1 per event of each writer; the tap and the finalization are separate
 * writers (B-2193).
 */
export function projectAsIsLine(
  event: ProjectionEvent,
  context: ProjectionContext,
  writer: AsIsWriter,
): Record<string, unknown> | null {
  const asIs = asIsNameOf(event.type);
  if (asIs === null) return null; // no row of the table renders this event
  const identity = context.identity;
  if (identity === null) {
    const line: Record<string, unknown> = {
      ts: Math.round(context.ts),
      time: context.time,
      event: asIs,
    };
    const legacyRunId = context.runId ?? (event.fields as { run_id?: unknown }).run_id;
    if (typeof legacyRunId === "string" && legacyRunId.length > 0) {
      line.run_id = legacyRunId;
    }
    if (context.task !== undefined && context.task.length > 0) line.task = context.task;
    if (context.backend !== undefined && context.backend.length > 0) {
      line.backend = context.backend;
    }
    return { ...line, ...projectedFields(event.fields) };
  }
  const line: Record<string, unknown> = {
    ts: Number(context.ts.toFixed(9)),
    time: context.time,
    event: asIs,
    ...identity,
    sequence: writer.take(),
  };
  return { ...line, ...projectedFields(event.fields) };
}

/**
 * The non-null fields of one event, renamed where the table renames them and
 * never overriding the envelope keys.
 */
function projectedFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    out[COMPATIBILITY_FIELD_PROJECTION[key] ?? key] = value;
  }
  return out;
}

/** The rejection of an as-is line that cannot be read (B-2195). */
export class AsIsLineRejectedError extends Error {
  constructor(reason: string) {
    super(`as-is event line rejected: ${reason}`);
    this.name = "AsIsLineRejectedError";
  }
}

/**
 * Read one as-is event line (B-2195): it must be a JSON object and hold
 * `event`, `run_id` and `invocation_id`; anything else is rejected on
 * reading, never repaired.
 */
export function loadAsIsLine(line: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new AsIsLineRejectedError(`not JSON (${(error as Error).message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AsIsLineRejectedError("not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  for (const field of ["event", "run_id", "invocation_id"] as const) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new AsIsLineRejectedError(`no ${field}`);
    }
  }
  return record;
}
