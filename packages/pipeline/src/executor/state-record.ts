/**
 * T008 — the pipeline state record (F123-FR-007, F123-FR-009).
 *
 * `pipeline:<pipelineId>:state`, one record per pipeline (§R.4). It is
 * written atomically (temporary file in the same directory, then rename),
 * with the keys sorted, indent 2 and the times as whole seconds. Content
 * that cannot be read — a missing file, a torn write, a foreign encoding —
 * is read as the empty record, so that a damaged state never blocks a run.
 */
import { readFileSync } from "node:fs";
import { atomicWrite } from "@specstride/kernel";

/** The states of the pipeline state machine of §R.4. */
export const PIPELINE_STATES = [
  "preflight",
  "ready",
  "running",
  "completed",
  "failed",
  "stopped",
] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

/** The status of one stage inside the record (§R.4, stage entry). */
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** One stage entry of the record (data-model.md, stage entry). */
export type StageEntry = {
  status: StageStatus;
  started_at: number | null;
  finished_at: number | null;
  child_exit_code: number | null;
  reason: string | null;
  evidence: string | null;
};

/** The pipeline state record of §R.4. */
export type PipelineStateRecord = {
  pipeline: string;
  contract_hash: string;
  state: PipelineState;
  updated_at: number;
  stages: Record<string, StageEntry>;
  last_stage: string | null;
  exit_reason: string | null;
  superseded_contract_digest: string | null;
};

/** A whole second: the times of the record are truncated, never rounded (§R.4). */
export function wholeSeconds(epochSeconds: number): number {
  return Math.trunc(epochSeconds);
}

/** The empty record for a pipeline: no stage has run yet. */
export function emptyState(
  pipelineId: string,
  contractHash: string,
  now: number,
): PipelineStateRecord {
  return {
    pipeline: pipelineId,
    contract_hash: contractHash,
    state: "preflight",
    updated_at: wholeSeconds(now),
    stages: {},
    last_stage: null,
    exit_reason: null,
    superseded_contract_digest: null,
  };
}

/** The entry a stage starts with. */
export function freshStageEntry(_now: number): StageEntry {
  return {
    status: "pending",
    started_at: null,
    finished_at: null,
    child_exit_code: null,
    reason: null,
    evidence: null,
  };
}

/**
 * Read the record; content that cannot be read is read as empty
 * (F123-FR-007). `null` means "no record" and the caller starts from
 * `emptyState`.
 */
export function readState(path: string): PipelineStateRecord | null {
  let text: string;
  try {
    text = readFileSyncUtf8(path);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null; // a torn or foreign encoding reads as empty
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.pipeline !== "string" || typeof record.state !== "string") return null;
  return {
    pipeline: record.pipeline,
    contract_hash: typeof record.contract_hash === "string" ? record.contract_hash : "",
    state: record.state as PipelineState,
    updated_at: typeof record.updated_at === "number" ? record.updated_at : 0,
    stages:
      typeof record.stages === "object" && record.stages !== null
        ? (record.stages as Record<string, StageEntry>)
        : {},
    last_stage: typeof record.last_stage === "string" ? record.last_stage : null,
    exit_reason: typeof record.exit_reason === "string" ? record.exit_reason : null,
    superseded_contract_digest:
      typeof record.superseded_contract_digest === "string"
        ? record.superseded_contract_digest
        : null,
  };
}

/**
 * Write the record atomically (F123-FR-007): sorted keys, indent 2, whole
 * seconds, temporary file in the same directory, then rename.
 */
export function writeState(path: string, record: PipelineStateRecord): void {
  const normalized: PipelineStateRecord = {
    ...record,
    updated_at: wholeSeconds(record.updated_at),
    stages: Object.fromEntries(
      Object.entries(record.stages).map(([id, entry]) => [
        id,
        {
          ...entry,
          started_at: entry.started_at === null ? null : wholeSeconds(entry.started_at),
          finished_at: entry.finished_at === null ? null : wholeSeconds(entry.finished_at),
        },
      ]),
    ),
  };
  atomicWrite(path, new TextEncoder().encode(`${JSON.stringify(normalized, sortedKeys, 2)}\n`));
}

/** A replacer that visits object keys in sorted order. */
function sortedKeys(key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const entry of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    out[entry[0]] = entry[1];
  }
  return out;
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf8");
}
