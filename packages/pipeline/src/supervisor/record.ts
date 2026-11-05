/**
 * T047 — the supervision record (§R.9, F123-FR-040).
 *
 * `launch:<launchId>:supervision`, schema `specstride.supervision/1`. It is
 * written by the CLI only — one state file per writer — and always through
 * the atomic write of the kernel (Principle I). It holds the cadence state
 * (`interval`, `unchanged`, `signature`), `stopRequested` (signal and time),
 * and with `relaunch.owner: supervise` the relaunch budget and one entry per
 * relaunch. With `relaunch.owner: root` the record holds the cadence state
 * and the stop request only; the relaunch budget and the relaunch list are
 * read from the events `supervisor.relaunch` of the root.
 */
import { existsSync, readFileSync } from "node:fs";
import { atomicWrite } from "@specstride/kernel";

/** The schema id of the supervision record (feature 100, annex B §B.16). */
export const SUPERVISION_SCHEMA = "specstride.supervision/1" as const;

/** One entry per relaunch, the justification of the decision appended to the record. */
export type SupervisionRelaunch = {
  reason: string;
  detail: string;
  launcherExit: number | null;
  childExit: number | null;
  stage: string | null;
  stageReason: string | null;
  stopReason: string | null;
  time: number;
  pid: number | null;
  remaining: number;
};

/** The relaunch budget as the record holds it (`relaunch.owner: supervise` only). */
export type SupervisionBudget = {
  maximum: number;
  remaining: number;
  wallClockSeconds: number;
  deadlineSeconds: number;
  declaredPipelineSeconds: number | null;
  source: "declared" | "default";
};

/** The supervision record of §R.9. */
export type SupervisionRecord = {
  schema: typeof SUPERVISION_SCHEMA;
  pipeline: string;
  launchId: string;
  mode: string;
  launcher: string;
  argv: string[];
  cwd: string;
  runDir: string;
  statePath: string;
  launchLog: string;
  reportLog: string | null;
  stageCount: number | null;
  relaunchOwner: "root" | "supervise";
  cadence: { interval: number; unchanged: number; signature: string | null };
  stopRequested: { signal: string; time: number } | null;
  budget: SupervisionBudget | null;
  relaunches: SupervisionRelaunch[];
  firstLaunchedAt: number;
  pipelineLogOffset: number;
};

/** Sorted-key JSON: every record of the product is written with its keys sorted. */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The empty supervision record of one launch. */
export function emptySupervisionRecord(input: {
  pipeline: string;
  launchId: string;
  mode: string;
  launcher: string;
  argv: readonly string[];
  cwd: string;
  runDir: string;
  statePath: string;
  launchLog: string;
  reportLog?: string;
  stageCount?: number;
  relaunchOwner?: "root" | "supervise";
  firstLaunchedAt: number;
  pipelineLogOffset: number;
  budget?: SupervisionBudget | null;
}): SupervisionRecord {
  return {
    schema: SUPERVISION_SCHEMA,
    pipeline: input.pipeline,
    launchId: input.launchId,
    mode: input.mode,
    launcher: input.launcher,
    argv: [...input.argv],
    cwd: input.cwd,
    runDir: input.runDir,
    statePath: input.statePath,
    launchLog: input.launchLog,
    reportLog: input.reportLog ?? null,
    stageCount: input.stageCount ?? null,
    relaunchOwner: input.relaunchOwner ?? "supervise",
    cadence: { interval: 60, unchanged: 0, signature: null },
    stopRequested: null,
    budget: input.budget ?? null,
    relaunches: [],
    firstLaunchedAt: input.firstLaunchedAt,
    pipelineLogOffset: input.pipelineLogOffset,
  };
}

/**
 * Write the record: the CLI only, through the atomic write of the kernel
 * (Principle I), keys sorted, indent 2.
 */
export function writeSupervisionRecord(path: string, record: SupervisionRecord): void {
  atomicWrite(path, `${sortedJson(record)}\n`);
}

/** Read the record. Absent or unreadable content reads as `null`. */
export function readSupervisionRecord(path: string): SupervisionRecord | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SupervisionRecord;
    if (raw.schema !== SUPERVISION_SCHEMA) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Record the stop request before any signal goes out (F123-FR-034). */
export function recordStopRequest(
  path: string,
  record: SupervisionRecord,
  signal: string,
  now: number,
): SupervisionRecord {
  const updated: SupervisionRecord = {
    ...record,
    stopRequested: { signal, time: Math.trunc(now) },
  };
  writeSupervisionRecord(path, updated);
  return updated;
}

/** Append the justification of a relaunch and decrement the remaining count. */
export function appendRelaunch(
  path: string,
  record: SupervisionRecord,
  relaunch: SupervisionRelaunch,
): SupervisionRecord {
  const updated: SupervisionRecord = {
    ...record,
    budget: record.budget === null ? null : { ...record.budget, remaining: relaunch.remaining },
    relaunches: [...record.relaunches, relaunch],
  };
  writeSupervisionRecord(path, updated);
  return updated;
}

/** Reset the cadence state inside the record after a change or a relaunch. */
export function resetCadence(
  path: string,
  record: SupervisionRecord,
  signature: string | null,
): SupervisionRecord {
  const updated: SupervisionRecord = {
    ...record,
    cadence: { interval: 60, unchanged: 0, signature },
  };
  writeSupervisionRecord(path, updated);
  return updated;
}

/**
 * The as-is launch record the compatibility projection renders
 * (`pipeline:<pipelineId>:harness-run`), with the fields of the baseline.
 */
export function projectHarnessRun(record: SupervisionRecord): Record<string, unknown> {
  return {
    schema: "specstride.harness-run/1",
    pipeline: record.pipeline,
    mode: record.mode,
    launcher: record.launcher,
    argv: record.argv,
    cwd: record.cwd,
    cmdline_markers: [],
    flags: {},
    pid: null,
    pgid: null,
    launched_at: record.firstLaunchedAt,
    first_launched_at: record.firstLaunchedAt,
    launcher_log_offset: record.pipelineLogOffset,
    run_dir: record.runDir,
    state_path: record.statePath,
    launcher_log: record.launchLog,
    launch_log: record.launchLog,
    report_log: record.reportLog,
    stage_count: record.stageCount,
    relaunch_budget: record.budget ? `${record.budget.remaining}/${record.budget.maximum}` : "2/2",
    relaunches: record.relaunches.length,
    supervision: {
      interval: record.cadence.interval,
      unchanged: record.cadence.unchanged,
      signature: record.cadence.signature,
    },
    ...(record.stopRequested !== null ? { stop_requested: record.stopRequested } : {}),
  };
}
