/**
 * T017 — the outcome of a stage: the read of the terminal record, the crash
 * fallback with a synthesized record, the reason rule, and the printed
 * `stop-reason=` of the compatibility projection (F123-FR-015).
 *
 * The terminal record `run:<runId>:terminal`, `specstride.terminal/1`, is
 * written by the engine; the root reads `retryable` and `blocked` from it.
 * When the engine died without writing one, the root synthesizes a record
 * with `retryable: false` and no blocked reason. The newest stop reason is
 * read for the whole pipeline of the stage, not from the offset before an
 * attempt.
 */
import { readFileSync } from "node:fs";

/** The fields of the terminal record this feature reads (annex B §B.15). */
export type TerminalRecord = {
  schema: string;
  run: string;
  /** The stop reason of the engine, e.g. `wall_budget`, `auth`, `None` when absent. */
  stop_reason: string | null;
  /** Whether the stop is retryable. */
  retryable: boolean;
  /** The blocked reason, when the run is blocked. */
  blocked: string | null;
};

/** The schema id of a terminal record. */
export const TERMINAL_SCHEMA_ID = "specstride.terminal/1" as const;

/**
 * Read the terminal record; anything unreadable — a missing file, a torn
 * write — reads as absent, and the caller applies the crash fallback.
 */
export function readTerminalRecord(path: string): TerminalRecord | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  return {
    schema: typeof record["schema"] === "string" ? record["schema"] : TERMINAL_SCHEMA_ID,
    run: typeof record["run"] === "string" ? record["run"] : "",
    stop_reason: typeof record["stop_reason"] === "string" ? record["stop_reason"] : null,
    retryable: record["retryable"] === true,
    blocked: typeof record["blocked"] === "string" ? record["blocked"] : null,
  };
}

/**
 * The crash fallback: the record the root synthesizes when the engine died
 * without writing a terminal record — `retryable: false` and no blocked
 * reason (data-model.md, terminal record).
 */
export function synthesizeCrashRecord(runId: string, _now: number): TerminalRecord {
  return {
    schema: TERMINAL_SCHEMA_ID,
    run: runId,
    stop_reason: "crash",
    retryable: false,
    blocked: null,
  };
}

/**
 * The reason rule of a retry (F123-FR-012): a failed attempt is retried only
 * when its exit code is in the declared list and, where a reason rule is
 * declared, the newest stop reason is one of the allowed reasons.
 */
export function retryAllowedUnderReasonRule(input: {
  rule: { allowed: readonly string[] } | undefined;
  stopReason: string | null;
}): boolean {
  if (input.rule === undefined) return true;
  return input.stopReason !== null && input.rule.allowed.includes(input.stopReason);
}

/**
 * The `stop-reason=` of the compatibility projection (§R.7): the reason as
 * the engine wrote it, or the literal `None` when it wrote none.
 */
export function stopReasonProjection(record: TerminalRecord | null): string {
  return record?.stop_reason ?? "None";
}
