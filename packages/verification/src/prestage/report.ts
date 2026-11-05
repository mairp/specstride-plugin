/**
 * T128, part three — THE BLOCK OF `prestage-report` (F105-FR-039), WHICH THE
 * PHASE CONTEXT OF T101 THEN ENDS WITH WHERE A RECORD EXISTS (F105-FR-025).
 *
 * The block says the operative thing to a proposer: these commands ALREADY
 * RAN, do not run them again, do not re-do the work they did, read their
 * output and cite the files they produced. For each command it gives its state
 * — passed or failed with its exit code and duration, still running, or past
 * its deadline and left running — its command line, its report path where one
 * is declared, and WHAT THE VERIFICATION GATE WILL DO WITH THE RESULT.
 *
 * It PRINTS NOTHING when no record exists for the phase or the record holds no
 * command (F105-FR-039), and `renderPrestageReport` then gives the empty text,
 * which is exactly what `renderPhaseContext` of `../render/phase-context.ts`
 * adds nothing for.
 *
 * The block is PRINTED WITHOUT ADDING A LINE END (F105-FR-039): its text ends
 * with one line end of its own and the caller adds none
 * (`NO_LINE_END_IS_ADDED`, the baseline's `print(…, end="")` at `:2377`).
 *
 * `lib/verification_plan.py` `prestage_report` (:2026) and `_format_duration`
 * (:2020) are the baseline.
 */
import { commandLine } from "../render/plan-for-people.ts";
import type { PlanCommand } from "../plan/record.ts";
import { DEADLINE_STATUS } from "../gate/run-command.ts";
import type { FoundDocument } from "./reuse.ts";
import { attemptOf, mostRecentFirst } from "./reuse.ts";

/** The heading of the block (F105-FR-039, an as-is literal). */
export function reportHeading(attempt: number | undefined): string {
  return `## Pre-staged verification for this phase (attempt ${attempt ?? "None"})`;
}

/** The as-is instruction not to run the commands again (F105-FR-039). */
export const DO_NOT_RE_RUN =
  "Specstride ran these declared commands ONCE, before this pass started. Do NOT " +
  "re-run them and do NOT re-do the work they already did: read their output " +
  "and cite the files they produced directly.";

/** The line that names the place of the record (F105-FR-039). */
export function evidenceLine(path: string): string {
  return `Pre-stage evidence: \`${path}\``;
}

/** What the verification gate will do with a PASSED result (F105-FR-039). */
export const GATE_WILL_REUSE =
  "- This phase's gate will REUSE this result instead of re-running " +
  "the command — but only at the same revision with a clean tree. If " +
  "you change the tree, the gate re-runs it.";

/** What it will do with a FAILED one (F105-FR-039). */
export const GATE_WILL_RUN_IT_AGAIN =
  "- It FAILED. The gate will run it again and fail again until the " +
  "CODE it points at is fixed; re-writing the evidence cannot clear it.";

/** F105-FR-039 — the block is printed without adding a line end. */
export const NO_LINE_END_IS_ADDED = true as const;

/** F105-FR-039 — nothing at all is printed where there is no record. */
export const NOTHING_WHERE_NO_RECORD_EXISTS = "" as const;

/** A duration in words, as the baseline formats it (`:2020`). */
export function formatDuration(milliseconds: number | undefined): string {
  const seconds = Math.trunc((milliseconds ?? 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.trunc(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The lines of ONE command of the block (F105-FR-039, `:2041`). */
export function reportLinesOfOneCommand(input: {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly command: PlanCommand | undefined;
}): readonly string[] {
  const { entry } = input;
  const state = (entry["state"] ?? "completed") as string;
  const declared = entry["declaredId"];
  const name =
    typeof declared === "string" && declared !== "" ? declared : String(entry["commandId"]);
  const lines: string[] = [];
  if (state === "running") {
    lines.push(`### ${name} — STILL RUNNING (detached, pid ${String(entry["pid"])})`);
    lines.push(`- Log: \`${String(entry["logPath"])}\``);
    lines.push(
      `- Deadline: ${String(entry["deadlineSec"])}s. It keeps running after this pass ends. ` +
        `Do NOT poll or sleep waiting on it and do NOT re-run it.`,
    );
  } else if (state === DEADLINE_STATUS) {
    lines.push(`### ${name} — DEADLINE EXCEEDED (still running)`);
    lines.push(`- Log: \`${String(entry["logPath"])}\``);
    lines.push(
      `- It passed its ${String(entry["deadlineSec"])}s deadline and was LEFT RUNNING ` +
        `(pid ${String(entry["pid"])}). Report that in PROGRESS.md; do not launch a second copy.`,
    );
  } else {
    const verdict = entry["passed"] === true ? "PASSED" : "FAILED";
    const duration = formatDuration(entry["durationMs"] as number | undefined);
    lines.push(`### ${name} — ${verdict} (exit code ${String(entry["exitCode"])} in ${duration})`);
    lines.push(`- Exit code: ${String(entry["exitCode"])}`);
    lines.push(`- Duration: ${duration}`);
  }
  if (input.command !== undefined) {
    lines.push(`- Command: \`${commandLine(input.command)}\``);
  }
  const report = entry["reportPath"];
  if (typeof report === "string" && report !== "") {
    lines.push(
      `- Report path: \`${report}\` (${entry["reportExists"] === true ? "present" : "NOT WRITTEN"})`,
    );
  }
  if (entry["passed"] === true) lines.push(GATE_WILL_REUSE);
  else if (state === "completed") lines.push(GATE_WILL_RUN_IT_AGAIN);
  lines.push("");
  return Object.freeze(lines);
}

/**
 * THE BLOCK OF `prestage-report` (F105-FR-039). The record is chosen from the
 * records of the run of THIS PHASE that carry the same plan hash, the most
 * recent phase attempt first; a phase attempt the caller names narrows the
 * choice, and where no record of that phase attempt exists the most recent one
 * of the phase is taken, as at the baseline (`:2032`).
 */
export function renderPrestageReport(input: {
  readonly plan: { readonly contentHash: string; readonly commands: readonly PlanCommand[] };
  readonly phase: number;
  /** The records of staged commands the caller read, with their places. */
  readonly found: readonly FoundDocument[];
  /** The phase attempt to prefer; absent takes the most recent. */
  readonly attempt?: number | undefined;
}): string {
  let documents = mostRecentFirst({
    found: input.found,
    planHash: input.plan.contentHash,
    phase: input.phase,
  });
  if (input.attempt !== undefined) {
    const narrowed = documents.filter((one) => attemptOf(one) === input.attempt);
    if (narrowed.length > 0) documents = narrowed;
  }
  const head = documents[0];
  if (head === undefined) return NOTHING_WHERE_NO_RECORD_EXISTS;
  const entries = head.document.commands ?? [];
  if (entries.length === 0) return NOTHING_WHERE_NO_RECORD_EXISTS;
  const byId = new Map(input.plan.commands.map((command) => [command.id, command]));
  const lines: string[] = [
    reportHeading(attemptOf(head)),
    DO_NOT_RE_RUN,
    evidenceLine(head.path),
    "",
  ];
  for (const entry of entries) {
    lines.push(
      ...reportLinesOfOneCommand({ entry, command: byId.get(String(entry["commandId"])) }),
    );
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}
