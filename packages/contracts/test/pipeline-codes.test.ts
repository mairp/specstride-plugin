/**
 * T089 — contract tests CT-100-269 for the exit codes of the runtime root and
 * the pipeline entry (annex F, §F.8; F100-FR-168, F100-FR-169).
 *
 * The tests bind T090 to the key `runtimeRootAndPipelineEntry` of
 * `data/exit-codes.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import exitCodes from "../data/exit-codes.json" with { type: "json" };
import {
  ANNEX_SECTION,
  FAILURE_CLASSES,
  FAILURE_CLASS_CODES,
  PIPELINE_EXIT_CODES,
  ROOT_THAT_DOES_NOT_RELAUNCH,
  SIGNALS,
  SIGNAL_CODE_CELL,
  STAGE_CHILD_SIX_BECOMES,
  STAGE_CHILD_STATUS,
  codeOfFailureClass,
  finalCodeOfTheRoot,
  isPipelineExitCode,
  pipelineCodeOfStageChild,
  pipelineExitRow,
  pipelineExitRows,
  signalCode,
  signalOf,
  stageChildStatus,
} from "../src/codes/pipeline.ts";
import { commandCodeRow } from "../src/codes/commands.ts";
import { collisionsOf } from "../src/codes/doctor-and-collisions.ts";
import { relaunchOwner } from "../src/enums/sets-120-125.ts";

const RAW = (exitCodes as { runtimeRootAndPipelineEntry: Record<string, string>[] })
  .runtimeRootAndPipelineEntry;

test("CT-100-269: the table of §F.8 holds the codes 0, 2, 20 to 24 and 128+N", () => {
  assert.equal(ANNEX_SECTION, "annex F, §F.8");
  assert.equal(RAW.length, 8);
  assert.equal(pipelineExitRows.length, 8);
  assert.deepEqual(
    pipelineExitRows.map((r) => r.cell),
    RAW.map((r) => r.Code),
  );
  assert.deepEqual([...PIPELINE_EXIT_CODES], [0, 2, 20, 21, 22, 23, 24]);
  for (const code of PIPELINE_EXIT_CODES) {
    assert.ok(isPipelineExitCode(code), String(code));
    assert.notEqual(pipelineExitRow(code), undefined, String(code));
    assert.notEqual(pipelineExitRow(code)?.meaning.trim(), "", `${code} has a meaning`);
  }
  assert.equal(isPipelineExitCode(1), false);
  assert.equal(isPipelineExitCode(70), false);

  // The row `128+N` is a family and carries no single number.
  assert.equal(SIGNAL_CODE_CELL, "128+N");
  const family = pipelineExitRows.filter((r) => r.signalFamily);
  assert.equal(family.length, 1);
  assert.equal(family[0]?.code, undefined);
  assert.match(String(family[0]?.meaning), /Ended by the signal N/);
  for (const [name, n] of Object.entries(SIGNALS)) {
    assert.equal(signalCode(n), 128 + n, name);
    assert.equal(signalOf(128 + n), n, name);
  }
  assert.equal(signalOf(22), undefined);
  // The row of `pipeline run` of §G.4 names the same codes and the family.
  const row = commandCodeRow("pipeline run");
  assert.notEqual(row, undefined);
  assert.deepEqual([...(row?.numbers ?? [])], [...PIPELINE_EXIT_CODES]);
  assert.equal(row?.signalFamily, true);
});

test("CT-100-269: each class of failure of the launcher maps to one distinct code", () => {
  assert.deepEqual(FAILURE_CLASSES, {
    invalid: 20,
    preflight: 21,
    stage: 22,
    stale: 23,
    lock: 24,
  });
  assert.equal(new Set(FAILURE_CLASS_CODES).size, 5, "five distinct codes");
  assert.equal(codeOfFailureClass("invalid"), 20);
  assert.equal(codeOfFailureClass("preflight"), 21);
  assert.equal(codeOfFailureClass("stage"), 22);
  assert.equal(codeOfFailureClass("stale"), 23);
  assert.equal(codeOfFailureClass("lock"), 24);
  // The meaning of each code in the data file matches the class.
  assert.match(String(pipelineExitRow(20)?.meaning), /launch contract is invalid/);
  assert.match(String(pipelineExitRow(21)?.meaning), /preflight/);
  assert.match(String(pipelineExitRow(22)?.meaning), /stage failed/);
  assert.match(String(pipelineExitRow(23)?.meaning), /Stale sources/);
  assert.match(String(pipelineExitRow(24)?.meaning), /lock is held/);
});

test("CT-100-269: the status of a stage child, and the 6 that becomes 22 with `stopped`", () => {
  assert.equal(STAGE_CHILD_STATUS.timeout, 124);
  assert.equal(STAGE_CHILD_STATUS.cannotStart, 127);
  const record = stageChildStatus(124);
  assert.equal(record.status, 124);
  assert.equal(record.keptIn, "the record of the stage");

  assert.equal(STAGE_CHILD_SIX_BECOMES.childExitCode, 6);
  assert.equal(STAGE_CHILD_SIX_BECOMES.pipelineCode, 22);
  assert.equal(STAGE_CHILD_SIX_BECOMES.pipelineState, "stopped");
  assert.equal(pipelineCodeOfStageChild(6), 22);
  assert.equal(pipelineCodeOfStageChild(1), 22);
  assert.equal(pipelineCodeOfStageChild(0), 0);
  // The row of 22 of §F.8 says so, and the collisions table of §G.4 repeats it.
  assert.match(String(pipelineExitRow(22)?.meaning), /child exited 6 and the state is `stopped`/);
  const collisions = collisionsOf(6);
  assert.ok(collisions.length >= 1);
  assert.ok(
    collisions.some((row) =>
      /becomes the pipeline code 22 with the state `stopped`/.test(row.meaningsCell),
    ),
  );
});

test("CT-100-269: with `relaunch.owner: root` the root finally exits 22 after a failed stage", () => {
  // The two owners of relaunch (row 20 of §X.6).
  assert.deepEqual([...relaunchOwner.members], ["root", "supervise"]);
  assert.equal(ROOT_THAT_DOES_NOT_RELAUNCH.relaunchOwner, "root");
  assert.equal(ROOT_THAT_DOES_NOT_RELAUNCH.staysAliveAfterAFailedStage, true);
  assert.equal(ROOT_THAT_DOES_NOT_RELAUNCH.finalExitCodeWhenItDoesNotRelaunch, 22);
  assert.equal(ROOT_THAT_DOES_NOT_RELAUNCH.pipelineStateAndDigestEqualThoseOf, "supervise");
  assert.equal(
    ROOT_THAT_DOES_NOT_RELAUNCH.finalExitCodeWhenItDoesNotRelaunch,
    FAILURE_CLASSES.stage,
  );

  assert.equal(finalCodeOfTheRoot({ aStageFailed: true, relaunched: false }), 22);
  assert.equal(finalCodeOfTheRoot({ aStageFailed: true, relaunched: true }), 0);
  assert.equal(finalCodeOfTheRoot({ aStageFailed: false, relaunched: false }), 0);
});
