/**
 * T031 of `specs/113-host-claude-code/tasks.md` (phase 8) — run the seven
 * checks of the context-cost CI on the BUILT package and record
 * `context-budget.json`.
 *
 * The task calls no model (the run of the trigger suite is T037, a paid task
 * of a person). What this runner does, in order:
 *
 *  1. BUILD the plugin directory with the build step of T021
 *     (`writePluginPackaging`) into a temporary tree — the plugin directory is
 *     a build output and is never committed (CT-100-130).
 *  2. Run the build's OWN strict validation of that directory (T021), so the
 *     checks below run on a package that has passed the packaging gate.
 *  3. Run the seven checks of T025 (`runAllChecks`), with:
 *       - the startup check MEASURED on this machine (Linux): 30 runs of
 *         `status` through the SHIPPED shim of the built package against a
 *         stub CLI on protocol 1 — no host CLI is started;
 *       - the host cross-check against the host CLI where one is on the
 *         search path, and the declared skip with its warning where it is
 *         absent (F113-FR-037).
 *  4. Record `context-budget.json` beside this runner: the report of the run
 *     (measured bytes, tokens and limits, the rows of the data model), the
 *     startup measurement itself, and the T032 row — the macOS runner run of
 *     the startup check is `unverified` until a macOS runner has passed it.
 *
 * A person or the CI starts it from the package root:
 *
 *     node tests/ci-checks/run-context-budget.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STARTUP_LIMIT_MS,
  STARTUP_PERCENTILE,
  STARTUP_RUNS,
  allChecksPass,
  percentile90,
  runAllChecks,
} from "./checks.ts";
import { contextCostReport } from "./report.ts";
import { strictPluginValidation, writePluginPackaging } from "../../src/packaging.ts";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const PACKAGE = resolve(HERE, "../..");
/** The file T031 records, relative to the package root. */
export const CONTEXT_BUDGET_FILE = "tests/ci-checks/context-budget.json" as const;

/**
 * One startup measurement: the time of one `status` run — the status shim of
 * the BUILT package printing the precomputed status line, which starts no
 * runtime and reads nothing but the line's file (F113-FR-022, first clause) —
 * in milliseconds. No host CLI and no model is started.
 */
export function measureStatusOnce(statusShim: string): number {
  const started = performance.now();
  const run = spawnSync("/bin/sh", [statusShim], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const elapsed = performance.now() - started;
  if (run.status !== 0) {
    throw new Error(`the status shim failed (exit ${run.status}): ${run.stderr}`);
  }
  return elapsed;
}

/** `STARTUP_RUNS` timings of `status`, in milliseconds, in run order. */
export function measureStatus(statusShim: string): number[] {
  const timings: number[] = [];
  for (let index = 0; index < STARTUP_RUNS; index += 1) {
    timings.push(measureStatusOnce(statusShim));
  }
  return timings;
}

/** The details output of the host CLI, or `null` where it is absent. */
function hostDetailsOf(pluginDirectory: string): string | null {
  const found = spawnSync("claude", ["plugin", "details", pluginDirectory], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return found.error === undefined && found.status === 0 ? (found.stdout ?? null) : null;
}

/** The record of the T031 run, as it is written to `context-budget.json`. */
export type ContextBudgetRecord = {
  readonly format: "context-budget/1";
  readonly task: "T031";
  readonly requirement: "F113-FR-036; F113-FR-037";
  /** The task calls no model; the run of the trigger suite is T037. */
  readonly modelCalls: 0;
  readonly platform: string;
  readonly builtPackageValidated: true;
  readonly allChecksPass: boolean;
  readonly report: ReturnType<typeof contextCostReport>;
  readonly startup: {
    readonly runner: string;
    readonly runs: number;
    readonly percentile: number;
    readonly measuredP90Ms: number;
    readonly limitMs: number;
    readonly verdict: "pass" | "fail" | "skip";
  };
  readonly macosRunner: {
    readonly task: "T032";
    readonly status: "unverified";
    readonly reason: string;
  };
};

/**
 * T031 — build the package, run the seven checks on it, and return the record
 * WITHOUT writing it (the witness test calls this and holds the file against
 * it).
 */
export function runContextBudget(): ContextBudgetRecord {
  const build = mkdtempSync(join(tmpdir(), "specstride-t031-"));
  try {
    writePluginPackaging(build);
    const findings = strictPluginValidation(build);
    const failed = findings.filter((finding) => !finding.ok);
    if (failed.length > 0) {
      throw new Error(`the built package failed strict validation: ${JSON.stringify(failed)}`);
    }
    // `status`: the status shim of the built package, which prints the
    // precomputed status line (F113-FR-022).
    const statusShim = join(build, "hooks", "session-start.sh");
    const timings = measureStatus(statusShim);
    const p90 = percentile90(timings);
    // The seven checks on the built package; the startup check is the MEASURED
    // one, the host cross-check against the host CLI where present.
    const outcomes = runAllChecks({
      hostDetails: hostDetailsOf(build),
      statusTimings: timings,
    });
    const startupLine = outcomes.find((outcome) => outcome.check === "startup");
    if (startupLine === undefined) throw new Error("the seven checks hold no startup check");
    return {
      format: "context-budget/1",
      task: "T031",
      requirement: "F113-FR-036; F113-FR-037",
      modelCalls: 0,
      platform: `${process.platform} ${process.arch} node ${process.version}`,
      builtPackageValidated: true,
      allChecksPass: allChecksPass(outcomes),
      report: contextCostReport(outcomes),
      startup: {
        runner:
          "the status shim of the built package (hooks/session-start.sh) printing the " +
          "precomputed status line; no host CLI, no model",
        runs: timings.length,
        percentile: STARTUP_PERCENTILE,
        measuredP90Ms: Math.round(p90 * 1000) / 1000,
        limitMs: STARTUP_LIMIT_MS,
        verdict: startupLine.verdict,
      },
      macosRunner: {
        task: "T032",
        status: "unverified",
        reason:
          "the macOS runner run of the startup check is never run and never faked in this " +
          "lane (owner's ruling of 2026-09-30); it stays `unverified` until a macOS runner " +
          "has passed it — the row `macos-startup-check` of src/host-facts.ts records it",
      },
    };
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const record = runContextBudget();
  const path = join(PACKAGE, CONTEXT_BUDGET_FILE);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`T031: ${CONTEXT_BUDGET_FILE} written; allChecksPass=${record.allChecksPass}`);
  if (!record.allChecksPass) process.exitCode = 1;
}
