/**
 * T031 and T032 of `specs/113-host-claude-code/tasks.md` (phase 8) — the
 * witness of the run of the seven checks on the BUILT package and of the
 * macOS record.
 *
 *  T031: `tests/ci-checks/run-context-budget.ts` builds the plugin directory
 *  with the build step of T021, runs the build's own strict validation, runs
 *  the seven checks of T025 on it and records `context-budget.json`. The task
 *  calls no model (`modelCalls: 0`); the run of the trigger suite is T037, a
 *  paid task of a person. This test RE-RUNS the runner and holds the committed
 *  record against it, so the file cannot drift from what the seven checks
 *  actually measure.
 *
 *  T032: the macOS runner run of the startup check is never run and never
 *  faked in this lane (owner's ruling of 2026-09-30). The record of it is the
 *  row `macos-startup-check` of `src/host-facts.ts`, `unverified` with the
 *  reason `macos`, until a macOS runner has passed it — and the same row is
 *  carried in `context-budget.json` under `macosRunner`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_COST_CHECKS } from "@specstride/contracts/ep/context-cost";
import { DECLARED_FACT_IDS, everyFactOf, factsByReason } from "../src/host-facts.ts";
import { CONTEXT_BUDGET_FILE, runContextBudget } from "../tests/ci-checks/run-context-budget.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = join(PKG, CONTEXT_BUDGET_FILE);
const RUNNER_PATH = join(PKG, "tests/ci-checks/run-context-budget.ts");

test("T031: the runner of the seven checks is on disk, beside the checks", () => {
  const source = readFileSync(RUNNER_PATH, "utf8");
  assert.match(source, /runAllChecks/, "the runner does not run the seven checks");
  assert.match(source, /writePluginPackaging/, "the runner does not BUILD the package");
  assert.match(source, /strictPluginValidation/, "the runner does not validate the build");
});

test("T031: the seven checks are run on the built package and all pass", () => {
  const record = runContextBudget();
  assert.equal(record.format, "context-budget/1");
  assert.equal(record.task, "T031");
  assert.equal(record.builtPackageValidated, true);
  assert.equal(record.allChecksPass, true, "a check of the run failed");
  // The seven checks of row 145, each with an outcome, in the set's order.
  const seen = new Set(record.report.lines.map((line) => line.check));
  for (const check of CONTEXT_COST_CHECKS) {
    assert.ok(seen.has(check), `the run holds no outcome for \`${check}\``);
  }
  // The report is the file F113-FR-037 asks for: bytes, tokens and limits.
  assert.equal(record.report.format, "context-cost-report/1");
  assert.ok(record.report.lines.length >= CONTEXT_COST_CHECKS.length);
  for (const line of record.report.lines) {
    if (line.verdict === "skip") continue;
    assert.equal(line.bytesPerToken, 2.8, `the line \`${line.subject}\` records no rate`);
    if (line.check === "static size" && line.subject.endsWith("body bytes")) {
      assert.ok(line.measuredBytes !== undefined, `\`${line.subject}\` records no bytes`);
      assert.ok(line.measuredTokens !== undefined, `\`${line.subject}\` records no tokens`);
      assert.ok(line.limit !== undefined, `\`${line.subject}\` records no limit`);
    }
  }
});

test("T031: the startup check is a MEASUREMENT of 30 runs of status on this machine", () => {
  const record = runContextBudget();
  assert.equal(record.startup.runs, 30);
  assert.equal(record.startup.percentile, 90);
  assert.equal(record.startup.limitMs, 150);
  assert.equal(record.startup.verdict, "pass", "the measured startup is over the limit");
  assert.ok(record.startup.measuredP90Ms <= record.startup.limitMs);
  assert.match(record.platform, /^linux/, "the hermetic run is measured on Linux");
});

test("T031: the host cross-check is the declared skip with its warning, never a fake pass", () => {
  const record = runContextBudget();
  const outcome = record.report.lines.find((line) => line.check === "host cross-check");
  assert.ok(outcome !== undefined);
  // Where the host CLI is absent the verdict is `skip`; the record carries the
  // warning of the check (F113-FR-037).
  assert.ok(["skip", "pass"].includes(outcome.verdict));
  assert.equal(record.allChecksPass, true);
});

test("T031: the task calls no model", () => {
  const record = runContextBudget();
  assert.equal(record.modelCalls, 0);
  const text = readFileSync(RECORD_PATH, "utf8").toLowerCase();
  for (const marker of ["model id", "modeljudge", "anthropic", "openai", "claude sonnet"]) {
    assert.ok(!text.includes(marker), `the record names a model (\`${marker}\`)`);
  }
});

test("T031: the committed record matches what the runner measures", () => {
  const committed = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as {
    format: string;
    task: string;
    modelCalls: number;
    allChecksPass: boolean;
    startup: { runs: number; percentile: number; limitMs: number; verdict: string };
    report: { lines: { check: string; verdict: string }[] };
  };
  const fresh = runContextBudget();
  assert.equal(committed.format, fresh.format);
  assert.equal(committed.task, fresh.task);
  assert.equal(committed.modelCalls, 0);
  assert.equal(committed.allChecksPass, true);
  assert.equal(committed.startup.runs, fresh.startup.runs);
  assert.equal(committed.startup.percentile, fresh.startup.percentile);
  assert.equal(committed.startup.limitMs, fresh.startup.limitMs);
  assert.equal(committed.startup.verdict, "pass");
  assert.equal(committed.report.lines.length, fresh.report.lines.length);
});

test("T032: the macOS runner run of the startup check is recorded `unverified`", () => {
  assert.ok(DECLARED_FACT_IDS.includes("macos-startup-check"));
  const fact = everyFactOf("macos-startup-check");
  assert.ok(fact !== undefined);
  assert.equal(fact.status, "unverified");
  assert.equal(fact.unverifiedReason, "macos");
  assert.equal(fact.verifiedOn, null);
  assert.ok(fact.requirements.includes("F113-FR-037"));
  assert.match(fact.reason, /T032/);
  assert.match(fact.reason, /never run and never faked/);
  // The row is the ONLY macOS row of the record, and it sits in the class of
  // F113-FR-035 for the macos reason.
  assert.deepEqual(
    factsByReason("macos").map((f) => f.id),
    ["macos-startup-check"],
  );
});

test("T032: the record carries the macOS row until a macOS runner has passed it", () => {
  const committed = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as {
    macosRunner: { task: string; status: string; reason: string };
  };
  assert.equal(committed.macosRunner.task, "T032");
  assert.equal(committed.macosRunner.status, "unverified");
  assert.match(committed.macosRunner.reason, /macOS runner/);
});
