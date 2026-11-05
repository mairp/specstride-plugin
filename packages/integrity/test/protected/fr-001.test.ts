// CT-116-1 (F116-FR-001): two classes of the protected set; single owner here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, stubProfile } from "./helpers.ts";
import { classAPatternsOf, classBFiles, matchClassA } from "../../src/protected/set.ts";

test("CT-116-1 class A is the files by which a check is defined", async () => {
  makeRepo({ "toolchain/runner.json": "{}", "src/app.ts": "export {};" });
  const patterns = classAPatternsOf([stubProfile]);
  assert.match(patterns.join("\n"), /toolchain\//);
  assert.equal(matchClassA(patterns, "toolchain/runner.json"), true);
  assert.equal(matchClassA(patterns, "src/app.ts"), false);
});

test("CT-116-1 class B is the test files that exist at phase entry", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass", "src/app.ts": "export {};" });
  const classB = await classBFiles(root, [stubProfile]);
  assert.deepEqual(
    classB.map((f) => f.path),
    ["test/a.test.ts"],
  );
  assert.match(classB[0].hash, /^[0-9a-f]{64}$/);
});

test("CT-116-1 a class B file is not in class A and the classes are disjoint", () => {
  const patterns = classAPatternsOf([stubProfile]);
  assert.equal(matchClassA(patterns, "test/a.test.ts"), false);
});
