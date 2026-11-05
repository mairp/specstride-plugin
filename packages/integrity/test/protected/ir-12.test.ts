// CT-116-112 (IR-12; F116-FR-010): authorisation from the task text at launch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorisedPathsFromTasks, isAuthorised } from "../../src/protected/authorise.ts";
import { compareAgainstPhaseEntry } from "../../src/protected/compare.ts";

test("IR-12 authorisation comes only from the task text read at launch", () => {
  const authorised = authorisedPathsFromTasks([
    { id: "T1", text: "Rewrite toolchain/runner.json for the new profile." },
  ]);
  assert.deepEqual(authorised.T1, ["toolchain/runner.json"]);
});

test("IR-12 an authorised change of a protected path does not taint and is listed", () => {
  const authorised = authorisedPathsFromTasks([{ id: "T1", text: "Edit toolchain/runner.json." }]);
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry: ["toolchain/runner.json"], now: ["toolchain/runner.json"] },
    classB: { atEntry: [], now: [] },
    authorised,
    taskId: "T1",
    contentChanged: ["toolchain/runner.json"],
  });
  assert.equal(verdict.tainted, false);
  assert.deepEqual(verdict.authorisedPaths, ["toolchain/runner.json"]);
});

test("IR-12 a path no task named stays unauthorised", () => {
  const authorised = authorisedPathsFromTasks([{ id: "T1", text: "Edit toolchain/runner.json." }]);
  assert.equal(isAuthorised(authorised, "T1", "secrets.key"), false);
});
