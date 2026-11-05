/**
 * T048 — the supervisor lines of both modes, the report log, and the
 * next-action texts (F123-FR-038, F123-FR-039).
 *
 * In compatibility output the supervisor prints the `[MOL-*]` lines of §R.8
 * byte for byte. In default output it prints the `[SPECSTRIDE-*` lines of
 * the table "Default output" of §R.8: one line per change, nothing for an
 * unchanged state, no text that came from a run. The four lines that carried
 * the labels of other owners before 2026-09-30 carry labels of their own,
 * starting with `[SPECSTRIDE-SUPERVISE-`. Every printed line is appended
 * once to the report log; a write failure is ignored.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutputMode } from "../output/lines.ts";
import { loadLines } from "../output/load-data.ts";

/** The data file of §R.8 ("Default output" and the byte limits). */
const VERBS_DATA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "supervise-verbs.json",
);

/** One row of the "Default output" table. */
export type DefaultLineRow = { line: string; keys: string; printed: string };

type VerbsData = {
  schema: string;
  verbs: unknown[];
  defaultLines: DefaultLineRow[];
  limitsBytes: Record<string, number>;
};
let cachedVerbs: VerbsData | undefined;

/** The rows of the "Default output" table of §R.8, from the data file. */
export function supervisorLineTable(): readonly DefaultLineRow[] {
  if (cachedVerbs === undefined) {
    cachedVerbs = JSON.parse(readVerbs()) as VerbsData;
  }
  return cachedVerbs.defaultLines;
}

/** The byte limits of default output (F123-FR-041, F123-SC-002). */
export function outputBudget(): {
  cycle: number;
  unchangedCycle: number;
  terminalDigest: number;
  run: number;
} {
  if (cachedVerbs === undefined) {
    cachedVerbs = JSON.parse(readVerbs()) as VerbsData;
  }
  const limits = cachedVerbs.limitsBytes as {
    cycle: number;
    unchangedCycle: number;
    terminalDigest: number;
    run: number;
  };
  return limits;
}

function readVerbs(): string {
  return readFileSync(VERBS_DATA_PATH, "utf8");
}

/** A value quoted as in JSON, unless said otherwise (§R.8). */
export function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

/** The Python repr of a stop reason: single quotes, or `None` (§R.8). */
export function pythonRepr(value: string | null): string {
  if (value === null) return "None";
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** The output mode the lines are formatted for. */
export type SuperviseMode = OutputMode;

/** The next-action texts of the digest (§R.8). */
export const NEXT_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  completed: "none; the pipeline completed and its evidence is in the run directory",
  failed: "operator: read the stage's evidence, then regenerate or relaunch by hand",
  stopped: "none; the stop was intentional and is never relaunched automatically",
  "unknown-terminal":
    "operator: the launcher died without writing a terminal state; read the harness launch log before treating anything as done",
  "lock-conflict": "attach to the launcher that already owns the run directory",
  "supervision-expired":
    "operator: the run is still going past the declared supervision ceiling; reattach or stop it",
});

/** The next action of a terminal reading, in the order §R.8 fixes. */
export function nextActionOf(input: {
  status: string;
  relaunched?: { readonly detail: string };
  refusedRelaunch?: { readonly reason: string; readonly detail: string };
}): string {
  if (input.relaunched !== undefined) return `relaunch: ${input.relaunched.detail}`;
  if (input.refusedRelaunch !== undefined) {
    return `no relaunch (${input.refusedRelaunch.reason}): ${input.refusedRelaunch.detail}`;
  }
  return NEXT_ACTIONS[input.status] ?? "none";
}

/** One supervisor line, ready for the stream and the report log. */
export type SupervisorLine = { readonly label: string; readonly body: string };

function line(label: string, body: string): SupervisorLine {
  return { label, body: `${label} ${body}` };
}

/** `[MOL-MODE]` / `[SPECSTRIDE-MODE]`. */
export function modeLine(input: {
  mode: string;
  source: string;
  evidence?: string;
  flags: readonly string[];
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line("[SPECSTRIDE-MODE]", `mode=${input.mode} source=${input.source}`);
  }
  const evidence = input.evidence ?? "";
  return line(
    "[MOL-MODE]",
    `mode=${input.mode} source=${input.source} evidence=${jsonValue(evidence)} flags=${jsonValue(input.flags)}`,
  );
}

/** `[MOL-LAUNCHER]` / `[SPECSTRIDE-LAUNCHER]`. */
export function launcherLine(input: {
  launcher: string;
  source: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line("[SPECSTRIDE-LAUNCHER]", `launcher=${input.launcher}`);
  }
  return line("[MOL-LAUNCHER]", `launcher=${input.launcher} source=${input.source}`);
}

/** `[MOL-GATE]` for one check, and the decision line. */
export function gateCheckLine(input: {
  name: string;
  status: string;
  reason?: string;
  detail?: string;
}): SupervisorLine {
  let body = `check=${input.name} status=${input.status}`;
  if (input.reason !== undefined) body += ` reason=${input.reason}`;
  if (input.detail !== undefined) body += ` detail=${jsonValue(input.detail)}`;
  return line("[MOL-GATE]", body);
}

/** The gate decision line in both modes; the passing checks are not listed in default output. */
export function gateDecisionLine(input: {
  decision: string;
  reason?: string;
  detail?: string;
  next?: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    let body = `decision=${input.decision}`;
    if (input.reason !== undefined) body += ` reason=${input.reason}`;
    if (input.next !== undefined) body += ` next=${jsonValue(input.next)}`;
    return line("[SPECSTRIDE-GATE]", body);
  }
  let body = `decision=${input.decision}`;
  if (input.reason !== undefined) body += ` reason=${input.reason}`;
  if (input.detail !== undefined) body += ` detail=${jsonValue(input.detail)}`;
  if (input.next !== undefined) body += ` next=${jsonValue(input.next)}`;
  return line("[MOL-GATE]", body);
}

/** `[MOL-LAUNCH]` / `[SPECSTRIDE-SUPERVISE-LAUNCH]`. */
export function launchLine(input: {
  pipeline: string;
  mode: string;
  launcher: string;
  runDir: string;
  stages: number;
  flags: readonly string[];
  budgetRemaining: number;
  budgetMaximum: number;
  budgetSource: string;
  pid: number;
  pgid: number;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line(
      "[SPECSTRIDE-SUPERVISE-LAUNCH]",
      `pipeline=${input.pipeline} state=launched stages=${input.stages} relaunch=${input.budgetRemaining}/${input.budgetMaximum} stop=kill -TERM -${input.pgid}`,
    );
  }
  return line(
    "[MOL-LAUNCH]",
    `pipeline=${input.pipeline} mode=${input.mode} launcher=${input.launcher} run-dir=${input.runDir} stages=${input.stages} flags=${jsonValue(input.flags)} relaunch-budget=${input.budgetRemaining}/${input.budgetMaximum} (${input.budgetSource}) wall-clock-ceiling=0s pid=${input.pid} stop="kill -TERM -${input.pgid}"`,
  );
}

/** `[MOL-STATE]` / `[SPECSTRIDE-SUPERVISE-STATE]`, printed when the signature changed. */
export function stateLine(input: {
  pipeline: string;
  stageIndex: number | null;
  stageCount: number | null;
  stageId: string | null;
  status: string;
  stageElapsedSeconds: number | null;
  totalElapsedSeconds: number | null;
  detail?: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line(
      "[SPECSTRIDE-SUPERVISE-STATE]",
      `pipeline=${input.pipeline} stage=${input.stageIndex ?? 0}/${input.stageCount ?? 0} id=${input.stageId ?? "none"} state=${input.status}`,
    );
  }
  const stage =
    input.stageIndex !== null && input.stageCount !== null
      ? `${input.stageIndex}/${input.stageCount}`
      : "none";
  const elapsed = (value: number | null) => (value === null ? "-" : `${value}s`);
  let body = `pipeline=${input.pipeline} stage=${stage} id=${input.stageId ?? "none"} state=${input.status} stage-elapsed=${elapsed(input.stageElapsedSeconds)} total-elapsed=${elapsed(input.totalElapsedSeconds)}`;
  if (input.detail !== undefined) body += ` detail=${jsonValue(input.detail)}`;
  return line("[MOL-STATE]", body);
}

/** `[MOL-HOLD]` — every unchanged reading; no equivalent in default output. */
export function holdLine(input: {
  pipeline: string;
  unchanged: number;
  stageIndex: number | null;
  stageCount: number | null;
  stageId: string | null;
  status: string;
  totalElapsedSeconds: number | null;
}): SupervisorLine {
  const stage =
    input.stageIndex !== null && input.stageCount !== null
      ? `${input.stageIndex}/${input.stageCount}`
      : "none";
  return line(
    "[MOL-HOLD]",
    `pipeline=${input.pipeline} unchanged=${input.unchanged} stage=${stage} id=${input.stageId ?? "none"} state=${input.status} total-elapsed=${input.totalElapsedSeconds ?? "-"}`,
  );
}

/** `[MOL-RELAUNCH]` / `[SPECSTRIDE-RELAUNCH]`; `stop-reason` is a Python repr. */
export function relaunchLine(input: {
  pipeline: string;
  attempt: number;
  maximum: number;
  reason: string;
  launcherExit: number | null;
  childExit: number | null;
  stage: string | null;
  stopReason: string | null;
  budgetRemaining: number;
  detail: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line(
      "[SPECSTRIDE-RELAUNCH]",
      `pipeline=${input.pipeline} attempt=${input.attempt}/${input.maximum} reason=${input.reason} stage=${input.stage ?? "none"}`,
    );
  }
  return line(
    "[MOL-RELAUNCH]",
    `pipeline=${input.pipeline} attempt=${input.attempt}/${input.maximum} reason=${input.reason} exit=${input.launcherExit ?? "unknown"} child-exit=${input.childExit ?? "None"} stage=${input.stage ?? "none"} stop-reason=${pythonRepr(input.stopReason)} budget-remaining=${input.budgetRemaining} detail=${jsonValue(input.detail)}`,
  );
}

/** `[MOL-REFUSE]` / `[SPECSTRIDE-REFUSE]`. */
export function refuseLine(input: {
  action: string;
  reason: string;
  detail?: string;
  next?: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    let body = `action=${input.action} reason=${input.reason}`;
    if (input.next !== undefined) body += ` next=${jsonValue(input.next)}`;
    return line("[SPECSTRIDE-REFUSE]", body);
  }
  let body = `action=${input.action} reason=${input.reason} detail=${jsonValue(input.detail ?? "")}`;
  if (input.next !== undefined) body += ` next=${jsonValue(input.next)}`;
  return line("[MOL-REFUSE]", body);
}

/** `[MOL-ANOMALY]` / `[SPECSTRIDE-ANOMALY]`, per anomaly. */
export function anomalyLine(input: {
  pipeline: string;
  detail: string;
  launchLogTail?: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line(
      "[SPECSTRIDE-ANOMALY]",
      `pipeline=${input.pipeline} detail=${jsonValue(input.detail)}`,
    );
  }
  let body = `pipeline=${input.pipeline} detail=${jsonValue(input.detail)}`;
  if (input.launchLogTail !== undefined) body += ` launch-log=${jsonValue(input.launchLogTail)}`;
  return line("[MOL-ANOMALY]", body);
}

/** `[MOL-NEXT]` / `[SPECSTRIDE-NEXT]`. */
export function nextLine(input: {
  pollSeconds?: number;
  next?: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.pollSeconds !== undefined) {
    const body = `poll-in=${input.pollSeconds}s`;
    return input.output === "default" ? line("[SPECSTRIDE-NEXT]", body) : line("[MOL-NEXT]", body);
  }
  const body = `next=${jsonValue(input.next ?? "none")}`;
  return input.output === "default" ? line("[SPECSTRIDE-NEXT]", body) : line("[MOL-NEXT]", body);
}

/** `[MOL-STOP]` / `[SPECSTRIDE-SUPERVISE-STOP]`. */
export function stopLine(input: {
  pipeline: string;
  sent: boolean;
  detail: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line("[SPECSTRIDE-SUPERVISE-STOP]", `pipeline=${input.pipeline} sent=${input.sent}`);
  }
  return line(
    "[MOL-STOP]",
    `pipeline=${input.pipeline} sent=${input.sent} detail=${jsonValue(input.detail)}`,
  );
}

/** `[MOL-DIGEST]` / `[SPECSTRIDE-SUPERVISE-DIGEST]`, once, when the run is terminal. */
export function superviseDigestLine(input: {
  pipeline: string;
  state: string;
  exit: number | null;
  childExit: number | null;
  lastStage: string | null;
  evidence: string;
  statePath: string;
  next: string;
  output: SuperviseMode;
}): SupervisorLine {
  if (input.output === "default") {
    return line(
      "[SPECSTRIDE-SUPERVISE-DIGEST]",
      `pipeline=${input.pipeline} state=${input.state} exit=${input.exit ?? "unknown"} last-stage=${input.lastStage ?? "none"} next=${jsonValue(input.next)}`,
    );
  }
  return line(
    "[MOL-DIGEST]",
    `pipeline=${input.pipeline} state=${input.state} exit=${input.exit ?? "unknown"} child-exit=${input.childExit ?? "None"} last-stage=${input.lastStage ?? "none"} evidence=${input.evidence} state-path=${input.statePath} next=${jsonValue(input.next)}`,
  );
}

/**
 * Append one line to the report log, once, as soon as the pipeline run is
 * known. A write failure is ignored (F123-FR-038).
 */
export function appendReportLog(reportLogPath: string | undefined, text: string): void {
  if (reportLogPath === undefined) return;
  try {
    appendFileSync(reportLogPath, `${text}\n`);
  } catch {
    /* the report log never breaks supervision */
  }
}

/**
 * T086 — the four labels of `supervise` (F123-FR-039), read from the line
 * table `data/lines.json`: the lines that carried the labels of other
 * owners before 2026-09-30 carry labels of their own. No verb of
 * `supervise` prints `[SPECSTRIDE-LAUNCH]`, `[SPECSTRIDE-STOP]`,
 * `[SPECSTRIDE-STATE]` or `[SPECSTRIDE-DIGEST]`; `[SPECSTRIDE-DIGEST]` is
 * printed by the runtime (F123-FR-043), with the keys of annex G §G.3.
 */
export const SUPERVISE_LABELS = [
  "[SPECSTRIDE-SUPERVISE-LAUNCH]",
  "[SPECSTRIDE-SUPERVISE-STATE]",
  "[SPECSTRIDE-SUPERVISE-STOP]",
  "[SPECSTRIDE-SUPERVISE-DIGEST]",
] as const;

/** The labels of `supervise` as the line table of the package holds them. */
export function superviseLabelsOfLineTable(): readonly string[] {
  return (loadLines().superviseLabels ?? []).map((row) => row.line);
}

/** True when a label belongs to `supervise` and to no other owner. */
export function isSuperviseLabel(label: string): boolean {
  return (SUPERVISE_LABELS as readonly string[]).includes(label);
}

/** The labels no verb of `supervise` prints: other owners own them. */
export const LABELS_OWNED_ELSEWHERE = [
  "[SPECSTRIDE-LAUNCH]",
  "[SPECSTRIDE-STOP]",
  "[SPECSTRIDE-STATE]",
  "[SPECSTRIDE-DIGEST]",
] as const;
