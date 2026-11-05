/**
 * T025 — contract tests CT-100-144, CT-100-145 and CT-100-147 for Identifiers
 * (annex B, §B.3; F100-FR-044, F100-FR-045, F100-FR-047).
 */
import test from "node:test";
import assert from "node:assert/strict";
import identifiers from "../data/identifiers.json" with { type: "json" };
import {
  IDENTIFIER_NAMES,
  RESET_COUNTS_IS_STORED_IN_SNAPSHOT,
  RESET_COUNTS_RANKS,
  continuationOfLaunch,
  identifierRow,
  identifierRows,
  mintedBy,
  ruleOf,
  scopeOf,
  type RunId,
} from "../src/ids/identifiers.ts";
import {
  ATTEMPT_DIRECTORY_NAME,
  ATTEMPT_NAME_PARAMETERS,
  attemptDirectoryName,
  attemptDirectoryNameWithSuffix,
  carriesAttemptParameters,
  parseAttemptDirectoryName,
} from "../src/ids/attempt-names.ts";
import { LOGICAL_NAMES } from "../src/ids/logical-names.ts";

test("CT-100-144: every identifier of §B.3 has a scope, a minting process and a rule", () => {
  // The table of the annex holds 11 rows; `workerId, groupId` share one, so
  // the package exports 12 identifiers.
  assert.equal((identifiers as { identifiers: unknown[] }).identifiers.length, 11);
  assert.equal(IDENTIFIER_NAMES.length, 12);
  for (const name of [
    "workspaceId",
    "pipelineId",
    "runId",
    "launchId",
    "engineStartId",
    "attemptId",
    "passId",
    "unitId",
    "jobId",
    "verdictId",
    "workerId",
    "groupId",
  ]) {
    assert.ok(IDENTIFIER_NAMES.includes(name), `${name} must have a row of §B.3`);
    assert.notEqual(scopeOf(name), undefined, `${name} must have a scope`);
    assert.notEqual(mintedBy(name), undefined, `${name} must name who mints it`);
    assert.notEqual(ruleOf(name), undefined, `${name} must have a rule`);
  }
  assert.equal(identifierRow("nothing"), undefined);
});

test("CT-100-144: the minting process and the scope are the ones the annex names", () => {
  assert.equal(scopeOf("runId"), "The logical run of one feature");
  assert.match(String(mintedBy("runId")), /CLI/);
  assert.match(String(ruleOf("runId")), /Stable across resume and relaunch/);
  assert.equal(scopeOf("workspaceId"), "Workspace");
  assert.match(String(ruleOf("workspaceId")), /Never read from a file inside the workspace/);
  assert.match(String(mintedBy("attemptId")), /engine/i);
  assert.match(String(ruleOf("attemptId")), /never reused/i);
  // Every row of the table is exported, in the order of the annex.
  assert.equal(identifierRows[0]?.identifier, "workspaceId");
});

test("CT-100-145: a launch continues the unfinished run unless --new-run (F100-FR-045)", () => {
  const unfinished = "run-7" as RunId;
  assert.deepEqual(continuationOfLaunch({ unfinishedRunId: unfinished }), {
    kind: "continue",
    runId: unfinished,
    resetCounts: false,
  });
  assert.deepEqual(continuationOfLaunch({ unfinishedRunId: unfinished, newRun: true }), {
    kind: "new-run",
    reason: "--new-run",
  });
  assert.deepEqual(continuationOfLaunch({}), { kind: "new-run", reason: "no-unfinished-run" });
  // Counts are reset only by --reset-counts.
  const reset = continuationOfLaunch({ unfinishedRunId: unfinished, resetCounts: true });
  assert.equal(reset.kind, "continue");
  if (reset.kind === "continue") assert.equal(reset.resetCounts, true);
  // --reset-counts is accepted from the command line only and is never stored
  // in the run snapshot.
  assert.deepEqual([...RESET_COUNTS_RANKS], ["flag"]);
  assert.equal(RESET_COUNTS_IS_STORED_IN_SNAPSHOT, false);
});

test("CT-100-147: the name of a phase attempt carries the phase, the engine start and the attempt (F100-FR-047)", () => {
  assert.equal(attemptDirectoryName(1, 4), "e1-a4");
  assert.match(attemptDirectoryName(12, 3), ATTEMPT_DIRECTORY_NAME);
  assert.deepEqual(parseAttemptDirectoryName("e2-a9"), {
    engineStartOrdinal: 2,
    attemptOrdinal: 9,
  });
  assert.equal(parseAttemptDirectoryName("phase-3"), undefined);
  // The as-is suffix rule: where a directory of that name exists, the run id
  // is appended.
  const existing = new Set(["e1-a1"]);
  assert.equal(
    attemptDirectoryNameWithSuffix(1, 1, "run-7", (n) => existing.has(n)),
    "e1-a1-run-7",
  );
  assert.equal(
    attemptDirectoryNameWithSuffix(1, 2, "run-7", (n) => existing.has(n)),
    "e1-a2",
  );
  assert.deepEqual(parseAttemptDirectoryName("e1-a1-run-7"), {
    engineStartOrdinal: 1,
    attemptOrdinal: 1,
    runId: "run-7",
  });
  // Every logical name of a phase attempt carries all three parameters, so
  // that the name stays unique when counts were reset.
  assert.deepEqual([...ATTEMPT_NAME_PARAMETERS], ["<N>", "<k>", "<n>"]);
  const attemptNames = LOGICAL_NAMES.filter((n) => n.startsWith("attempt:"));
  assert.ok(attemptNames.length > 0);
  for (const name of attemptNames) {
    assert.ok(carriesAttemptParameters(name), `${name} must carry <N>, <k> and <n>`);
  }
});
