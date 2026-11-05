// CT-116-111 (IR-11; F116-FR-001, F116-FR-004, F116-FR-006): two classes,
// fingerprint at phase entry, tainted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, stubProfile, writeFile } from "./helpers.ts";
import { classAPatternsOf, classBFiles } from "../../src/protected/set.ts";
import { captureAtLaunch, captureAtPhaseEntry } from "../../src/protected/entry.ts";
import { compareAgainstPhaseEntry } from "../../src/protected/compare.ts";

test("IR-11 the protected set has two classes and is fingerprinted at phase entry", async () => {
  const root = makeRepo({ "toolchain/r.json": "{}", "test/a.test.ts": "pass" });
  const launch = await captureAtLaunch({ phase: 1, root, profiles: [stubProfile] });
  const entry = await captureAtPhaseEntry({ root, profiles: [stubProfile], prior: launch });
  assert.ok(entry.atPhaseEntry);
  assert.match(entry.atPhaseEntry.tree, /^[0-9a-f]{64}$/);
  assert.match(entry.atPhaseEntry.set, /^[0-9a-f]{64}$/);
  const classB = await classBFiles(root, [stubProfile]);
  assert.deepEqual(
    classB.map((f) => f.path),
    ["test/a.test.ts"],
  );
  assert.equal(classAPatternsOf([stubProfile]).length > 0, true);
});

test("IR-11 a changed class A file after phase entry gives tainted", async () => {
  const root = makeRepo({ "toolchain/r.json": "{}", "test/a.test.ts": "pass" });
  const atEntry = ["toolchain/r.json"];
  writeFile(root, "toolchain/r.json", '{"changed":true}');
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry, now: atEntry },
    classB: { atEntry: ["test/a.test.ts"], now: ["test/a.test.ts"] },
    authorised: {},
    contentChanged: ["toolchain/r.json"],
  });
  assert.notEqual(verdict.tainted, false);
  assert.equal((verdict.tainted as { reason: string }).reason, "protected-set-changed");
});

test("IR-11 a class B file changed without authorisation gives tainted", () => {
  const verdict = compareAgainstPhaseEntry({
    classAFiles: { atEntry: ["toolchain/r.json"], now: ["toolchain/r.json"] },
    classB: { atEntry: ["test/a.test.ts"], now: ["test/a.test.ts"] },
    authorised: {},
    contentChanged: ["test/a.test.ts"],
  });
  assert.notEqual(verdict.tainted, false);
});
