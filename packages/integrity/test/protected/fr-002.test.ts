// CT-116-2 (F116-FR-002): class A is patterns; a new matching file taints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, stubProfile, writeFile } from "./helpers.ts";
import { classAPatternsOf, matchClassA } from "../../src/protected/set.ts";
import { compareAgainstPhaseEntry } from "../../src/protected/compare.ts";

test("CT-116-2 a new file that matches a class A pattern is detected at comparison", () => {
  const root = makeRepo({ "toolchain/old.json": "{}" });
  const patterns = classAPatternsOf([stubProfile]);
  writeFile(root, "toolchain/new.json", "{}"); // added after phase entry
  assert.equal(matchClassA(patterns, "toolchain/new.json"), true);
  const verdict = compareAgainstPhaseEntry({
    classAFiles: {
      atEntry: ["toolchain/old.json"],
      now: ["toolchain/old.json", "toolchain/new.json"],
    },
    classB: { atEntry: [], now: [] },
    authorised: {},
  });
  assert.notEqual(verdict.tainted, false);
  assert.deepEqual(verdict.changedPaths, ["toolchain/new.json"]);
});

test("CT-116-2 patterns are evaluated at every comparison, not frozen at entry", () => {
  // The pattern set is versioned data per toolchain: a changed pattern set is
  // picked up by the next comparison without any rebuild of the set.
  const before = classAPatternsOf([stubProfile]);
  const wider = classAPatternsOf([{ ...stubProfile, classA: ["toolchain/**", "ci/**"] }]);
  assert.notDeepEqual(before, wider);
  assert.equal(matchClassA(wider, "ci/pipeline.yml"), true);
  assert.equal(matchClassA(before, "ci/pipeline.yml"), false);
});

test("CT-116-2 a non-matching new file does not taint class A", () => {
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry: ["toolchain/old.json"], now: ["toolchain/old.json"] },
    classB: { atEntry: [], now: [] },
    authorised: {},
  });
  assert.equal(verdict.tainted, false);
});
