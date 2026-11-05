/**
 * T183 — contract tests CT-100-259 for the two kinds of run request (annex F,
 * §F.2; F100-FR-159), read from the key `runRequests` of
 * `data/process-model.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import processModelData from "../data/process-model.json" with { type: "json" };
import {
  ANNEX_SECTION,
  DATA_KEY,
  RUN_REQUEST_KINDS,
  SHARED_BY_BOTH_KINDS,
  acceptRunRequestKind,
  hasALaunchContract,
  isRunRequestKind,
  loadRunRequests,
  runRequestRow,
  runRequestRows,
  type EngineRunRequest,
  type PipelineRunRequest,
} from "../src/state/run-requests.ts";

test("CT-100-259: the runtime root accepts exactly the two kinds of §F.2", () => {
  assert.equal(ANNEX_SECTION, "annex F, §F.2");
  assert.equal(DATA_KEY, "runRequests");
  const raw = (processModelData as { runRequests: unknown[] }).runRequests;
  assert.equal(runRequestRows.length, raw.length);
  assert.equal(runRequestRows.length, 2);
  assert.deepEqual(loadRunRequests(), runRequestRows);
  assert.deepEqual([...RUN_REQUEST_KINDS], ["pipeline", "engine"]);
  assert.deepEqual(
    runRequestRows.map((r) => r.kind),
    ["pipeline", "engine"],
  );

  // Every row has what the table gives it.
  const pipeline = runRequestRow("pipeline");
  assert.equal(pipeline?.whatItIs, "A promoted launch contract");
  assert.match(pipeline?.producedBy ?? "", /specstride-run/);
  assert.equal(pipeline?.hasALaunchContractAndStages, true);
  const engine = runRequestRow("engine");
  assert.equal(engine?.whatItIs, "One engine start with its arguments");
  assert.match(engine?.producedBy ?? "", /specstride-reverse/);
  assert.equal(engine?.hasALaunchContractAndStages, false);

  // A kind the table does not hold is refused, and the message names the two.
  assert.equal(isRunRequestKind("pipeline"), true);
  assert.equal(isRunRequestKind("engine"), true);
  assert.equal(isRunRequestKind("stage"), false);
  assert.equal(runRequestRow("stage"), undefined);
  assert.equal(acceptRunRequestKind("pipeline").accepted, true);
  const refused = acceptRunRequestKind("stage");
  assert.equal(refused.accepted, false);
  assert.match(String(refused.message), /pipeline and engine/);
  assert.match(String(refused.message), /F100-FR-159/);
});

test("CT-100-259: F100-FR-159 — a request of kind `engine` shares everything but the contract", () => {
  assert.deepEqual([...SHARED_BY_BOTH_KINDS], ["lock", "lease", "relaunch classifier", "digest"]);
  assert.equal(hasALaunchContract("pipeline"), true);
  assert.equal(hasALaunchContract("engine"), false, "no launch contract to validate");

  // The two types, as a reader uses them.
  const request: PipelineRunRequest = {
    kind: "pipeline",
    pipelineId: "p-1",
    launchContract: "pipeline:<pipelineId>:contract",
    stages: ["setup", "specstride"],
  };
  assert.equal(request.kind, "pipeline");
  const start: EngineRunRequest = {
    kind: "engine",
    slug: "100-specstride",
    argv: ["--phase", "7"],
  };
  assert.equal(start.kind, "engine");
});
