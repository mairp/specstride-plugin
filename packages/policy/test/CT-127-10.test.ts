/**
 * CT-127-10 (T039) — the characterization test of a DECLARED MAP on a fake
 * harness: with the map the fixture run pauses and the reject count stays
 * unchanged; without the map the same failure takes the error path
 * (F127-FR-008).
 *
 * The map is read through the harness port's `classify` (EP-02, annex C §C.1),
 * and the test also proves the last sentence of the requirement — "No shared
 * code MUST test a harness name" — by reading every source file of this
 * package and looking for a harness name in it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FAILURES, FAILURE_PATHS, FAILURE_WHEN_UNKNOWN } from "@specstride/contracts/ep/harness";
import {
  CLASS_OF_TYPED_FAILURE,
  TYPED_FAILURE_WHEN_UNKNOWN,
  classOfTypedFailure,
  classesOfADeclaredMap,
  classifyThroughTheHarnessPort,
  declaresALimitSignal,
  type HarnessClassifyPort,
} from "../src/quota/classify.ts";
import { actionFor, applyToConsecutiveErrors, AS_IS_ERROR_PATH } from "../src/quota/actions.ts";
import { enterPause, type RunCounts } from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

/* ---------------------------------------------------------------- *
 * The fake harness, with and without a declared limit signal.
 * ---------------------------------------------------------------- */

/**
 * The `failures` map of a fake harness descriptor (annex C §C.2, field
 * `failures`): the typed failure vocabulary of §C.1 against what signals it.
 * This map declares a LIMIT signal: status 429 is `quota_exhausted`.
 */
const WITH_THE_MAP: Readonly<Record<string, unknown>> = Object.freeze({
  quota_exhausted: { statuses: [429], bodyPatterns: ["usage limit"] },
  authentication_failed: { statuses: [401] },
});

/** The same descriptor WITHOUT the limit entry: it declares no quota signal. */
const WITHOUT_THE_MAP: Readonly<Record<string, unknown>> = Object.freeze({
  authentication_failed: { statuses: [401] },
});

/**
 * The generic harness adapter, as a fake: it reads the declared map and
 * answers in the vocabulary of §C.1. It is handed the MAP and never a harness
 * name, which is the shape F127-FR-008 requires.
 */
function genericAdapter(failures: Readonly<Record<string, unknown>>): HarnessClassifyPort {
  return {
    classify(seen) {
      for (const [failure, signal] of Object.entries(failures)) {
        const statuses = (signal as { statuses?: number[] }).statuses ?? [];
        if (seen.status !== undefined && statuses.includes(seen.status.code)) {
          return { failure };
        }
        const patterns = (signal as { bodyPatterns?: string[] }).bodyPatterns ?? [];
        if (
          seen.errorText !== undefined &&
          patterns.some((pattern) => seen.errorText?.includes(pattern))
        ) {
          return { failure };
        }
      }
      // "Failure of an implementation" of §C.1: `classify` gives `agent_failure`.
      return { failure: FAILURE_WHEN_UNKNOWN };
    },
  };
}

/** The failure the fixture produces: a 429 with a limit message. */
const THE_FAILURE = Object.freeze({
  status: { code: 429, headers: {} },
  errorText: "usage limit reached for this window",
  resetsAt: { header: new Date(DEFAULT_START_MS + 5 * 60 * 60 * 1000).toISOString() },
});

const COUNTS: RunCounts = Object.freeze({
  rejects: 2,
  passes: 5,
  malformedStreak: 0,
  errors: 0,
  wallClockMs: 1000,
  relaunches: 1,
});

test("CT-127-10: the typed failure vocabulary of §C.1 maps onto the classes of §Q.1", () => {
  for (const failure of FAILURES) {
    assert.ok(
      CLASS_OF_TYPED_FAILURE[failure] !== undefined,
      `the vocabulary member ${failure} has a class of §Q.1`,
    );
  }
  assert.equal(classOfTypedFailure("quota_exhausted"), "quota_window");
  assert.equal(classOfTypedFailure("authentication_failed"), "auth");
  assert.equal(classOfTypedFailure("rate_limited"), "rate_limit_transient");
  assert.equal(classOfTypedFailure("context_window_exceeded"), "context_window");
  assert.equal(TYPED_FAILURE_WHEN_UNKNOWN, FAILURE_WHEN_UNKNOWN, "§C.1's unknown-value rule");
  assert.equal(
    classOfTypedFailure("a_failure_no_vocabulary_holds"),
    "agent_failure",
    "an unknown failure is `agent_failure` (§C.1)",
  );
  assert.equal(FAILURE_PATHS.classify, "`agent_failure`", "and so is a `classify` that failed");
});

test("CT-127-10: the declared map of the fake harness declares a limit signal", () => {
  assert.deepEqual([...classesOfADeclaredMap(WITH_THE_MAP)], ["quota_window", "auth"]);
  assert.equal(declaresALimitSignal(WITH_THE_MAP), true);
  assert.deepEqual([...classesOfADeclaredMap(WITHOUT_THE_MAP)], ["auth"]);
  assert.equal(declaresALimitSignal(WITHOUT_THE_MAP), false);
  assert.equal(declaresALimitSignal(undefined), false);
});

test("CT-127-10: WITH the map, the failure is a `quota_window` read through the harness port", () => {
  const classified = classifyThroughTheHarnessPort(genericAdapter(WITH_THE_MAP), THE_FAILURE);
  assert.equal(classified.quotaClass, "quota_window");
  assert.equal(classified.confidence, "structured", "the adapter named the class itself");
  assert.equal(classified.retryable, true);
  assert.equal(
    classified.resetsAt,
    THE_FAILURE.resetsAt.header,
    "and the reset time the reply header gave",
  );
  assert.equal(classified.resetsAtSource, "header");
});

test("CT-127-10: WITH the map, the fixture run PAUSES and the reject count is unchanged", () => {
  const ports = testPorts();
  const classified = classifyThroughTheHarnessPort(genericAdapter(WITH_THE_MAP), THE_FAILURE);
  const decision = actionFor(classified.quotaClass);
  assert.equal(decision.action, "pause-role", "the action of §Q.1");

  const entry = enterPause(
    ports,
    {
      runId: "run-1",
      attemptId: "p1-a1",
      role: "proposer",
      harness: "stub-harness",
      classification: classified,
      since: ports.clock.nowIso(),
      resumeAt: new Date(DEFAULT_START_MS + 5 * 60 * 60 * 1000 + 60_000).toISOString(),
      ceilingAt: new Date(DEFAULT_START_MS + 24 * 60 * 60 * 1000).toISOString(),
      recordPath: ".specstride/runs/run-1/pause.record",
      counts: COUNTS,
    },
    PAIR_CLOSED,
  );

  assert.equal(entry.state, "paused-quota", "the run paused (F127-FR-008)");
  assert.equal(ports.fileWriter.exists(".specstride/runs/run-1/pause.record"), true);
  assert.deepEqual(ports.eventWriter.types(), ["quota.signal", "run.paused"]);
  assert.equal(entry.counts?.rejects, COUNTS.rejects, "the reject count stayed unchanged");
  assert.deepEqual(entry.counts, COUNTS, "and so did the other five");
  const applied = applyToConsecutiveErrors(COUNTS.errors, decision);
  assert.equal(applied.counter, COUNTS.errors, "and no error was counted");
});

test("CT-127-10: WITHOUT the map, the SAME failure takes the error path", () => {
  const ports = testPorts();
  const classified = classifyThroughTheHarnessPort(genericAdapter(WITHOUT_THE_MAP), THE_FAILURE);
  assert.equal(
    classified.quotaClass,
    "agent_failure",
    "no entry matched, so §C.1's rule gives `agent_failure`",
  );
  const decision = actionFor(classified.quotaClass);
  assert.equal(decision.action, "error-path", "the error path (F127-FR-008)");
  assert.equal(decision.countsAsAConsecutiveError, true);
  assert.equal(decision.spends, "yes");

  const applied = applyToConsecutiveErrors(COUNTS.errors, decision);
  assert.equal(applied.counter, COUNTS.errors + 1, "an error was counted");
  assert.equal(AS_IS_ERROR_PATH.stopReason, "proposer_consecutive_errors");
  assert.equal(AS_IS_ERROR_PATH.exitCode, 4);

  // And nothing of a pause happened.
  assert.deepEqual(ports.eventWriter.types(), []);
  assert.deepEqual(ports.fileWriter.writes, []);
});

test("CT-127-10: the two runs differ only by the declared map", () => {
  // One failure, two descriptors, two paths. No shared code changed.
  const withMap = classifyThroughTheHarnessPort(genericAdapter(WITH_THE_MAP), THE_FAILURE);
  const withoutMap = classifyThroughTheHarnessPort(genericAdapter(WITHOUT_THE_MAP), THE_FAILURE);
  assert.equal(actionFor(withMap.quotaClass).action, "pause-role");
  assert.equal(actionFor(withoutMap.quotaClass).action, "error-path");
  assert.notEqual(withMap.quotaClass, withoutMap.quotaClass);
});

test("CT-127-10: an entry of the map may state a weaker confidence, which §Q.2 probes", () => {
  const byText = classifyThroughTheHarnessPort(
    genericAdapter(WITH_THE_MAP),
    { errorText: "usage limit reached" },
    { confidence: "text" },
  );
  assert.equal(byText.quotaClass, "quota_window");
  assert.equal(byText.confidence, "text", "a text pattern of the descriptor states `text`");
});

test("CT-127-10: a harness port whose `classify` throws gives `agent_failure`", () => {
  const broken: HarnessClassifyPort = {
    classify() {
      throw new Error("the adapter is broken");
    },
  };
  const classified = classifyThroughTheHarnessPort(broken, THE_FAILURE);
  assert.equal(classified.quotaClass, "agent_failure", "the failure path of §C.1");
  assert.equal(actionFor(classified.quotaClass).action, "error-path");
});

/* ---------------------------------------------------------------- *
 * No shared code tests a harness name.
 * ---------------------------------------------------------------- */

/** Every `.ts` file under a directory, recursively. */
function sourceFiles(root: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("CT-127-10: no shared code of this feature tests a harness name", () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  const files = sourceFiles(src);
  assert.ok(files.length >= 12, `the package has ${files.length} source files`);

  // The harness names of Wave 1, and the names the as-is commands carry.
  const names = ["claude", "codex", "dsh", "gemini", "prime", "stub-harness"];
  const findings: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Comments are prose and may name a harness; code may not.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .toLowerCase();
    for (const name of names) {
      if (code.includes(`"${name}"`) || code.includes(`'${name}'`)) {
        findings.push(`${file} names the harness ${name}`);
      }
    }
  }
  assert.deepEqual(findings, [], "F127-FR-008: no shared code tests a harness name");
});

test("CT-127-10 (checkpoint): the read through the port touches no clock and no file", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  classifyThroughTheHarnessPort(genericAdapter(WITH_THE_MAP), THE_FAILURE);
  assert.equal(ports.clock.nowMs(), before);
  assert.deepEqual(ports.fileWriter.writes, []);
});
