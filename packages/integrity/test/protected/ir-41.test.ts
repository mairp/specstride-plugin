// CT-116-141 (IR-41; F116-FR-010): authorisation covers class A.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorisedPathsFromTasks, isAuthorised } from "../../src/protected/authorise.ts";
import { compareAgainstPhaseEntry } from "../../src/protected/compare.ts";

test("IR-41 an authorised class A change does not taint", () => {
  const authorised = authorisedPathsFromTasks([
    { id: "T9", text: "Bump config/settings.json to the new schema." },
  ]);
  assert.equal(isAuthorised(authorised, "T9", "config/settings.json"), true);
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry: ["config/settings.json"], now: ["config/settings.json"] },
    classB: { atEntry: [], now: [] },
    authorised,
    taskId: "T9",
    contentChanged: ["config/settings.json"],
  });
  assert.equal(verdict.tainted, false);
  assert.deepEqual(verdict.authorisedPaths, ["config/settings.json"]);
});

test("IR-41 an unauthorised class A change still taints", () => {
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry: ["config/settings.json"], now: ["config/settings.json"] },
    classB: { atEntry: [], now: [] },
    authorised: {},
    contentChanged: ["config/settings.json"],
  });
  assert.notEqual(verdict.tainted, false);
});
