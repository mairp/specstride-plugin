/**
 * T025 — the report file of the context-cost CI (F113-FR-037): "A report file
 * MUST record measured bytes, tokens and limits."
 *
 * The report is JSON, one entry per line of the seven checks, each with the
 * measured bytes, the tokens they measure at 2.8 bytes per token, and the
 * limit the check holds. The run of the CI on the BUILT package, which writes
 * `context-budget.json`, is T031 of `specs/113-host-claude-code/tasks.md`
 * (phase 8); this module is what that task calls.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BYTES_PER_TOKEN } from "../../src/render/index.ts";
import type { CheckOutcome, CheckLine } from "./checks.ts";
import { allChecksPass, runAllChecks } from "./checks.ts";

/** The name of the report file of the context-cost CI. */
export const CONTEXT_COST_REPORT_FILE = "context-cost-report.json" as const;

/** One line of the report file, as the data model draws a check result. */
export type ReportLine = {
  readonly check: string;
  readonly subject: string;
  readonly measuredBytes?: number;
  readonly measuredTokens?: number;
  readonly limit?: number;
  readonly unit?: string;
  readonly verdict: "pass" | "fail" | "skip";
  readonly bytesPerToken: number;
};

/** The report file of one run of the seven checks. */
export type ContextCostReport = {
  readonly format: "context-cost-report/1";
  readonly requirement: "F113-FR-036; F113-FR-037";
  readonly bytesPerToken: number;
  readonly allChecksPass: boolean;
  readonly lines: readonly ReportLine[];
};

function linesOf(outcomes: readonly CheckOutcome[]): readonly ReportLine[] {
  const lines: ReportLine[] = [];
  for (const outcome of outcomes) {
    const entries: readonly CheckLine[] =
      outcome.lines.length > 0
        ? outcome.lines
        : [{ check: outcome.check, subject: outcome.check, verdict: outcome.verdict }];
    for (const line of entries) {
      lines.push({
        check: line.check,
        subject: line.subject,
        measuredBytes: line.measuredBytes,
        measuredTokens: line.measuredTokens ?? tokensOf(line.measuredBytes),
        limit: line.limit,
        unit: line.unit,
        verdict: line.verdict,
        bytesPerToken: BYTES_PER_TOKEN,
      });
    }
  }
  return lines;
}

function tokensOf(bytes: number | undefined): number | undefined {
  return bytes === undefined ? undefined : Math.round(bytes / BYTES_PER_TOKEN);
}

/** The report of a run of the seven checks, in memory. */
export function contextCostReport(outcomes?: readonly CheckOutcome[]): ContextCostReport {
  const run = outcomes ?? runAllChecks();
  return {
    format: "context-cost-report/1",
    requirement: "F113-FR-036; F113-FR-037",
    bytesPerToken: BYTES_PER_TOKEN,
    allChecksPass: allChecksPass(run),
    lines: linesOf(run),
  };
}

/** Writes the report file into `directory` and returns its path. */
export function writeContextCostReport(
  directory: string,
  outcomes?: readonly CheckOutcome[],
): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, CONTEXT_COST_REPORT_FILE);
  writeFileSync(path, `${JSON.stringify(contextCostReport(outcomes), null, 2)}\n`, "utf8");
  return path;
}

/** The path the report of this package takes, relative to the package root. */
export const REPORT_TARGET = join("tests", "ci-checks", "out") as string;

/** The directory of this module on disk, for the build step of phase 8. */
export const HERE = dirname(import.meta.filename);
