// CT-116-4 (F116-FR-004): fingerprints at launch and at phase entry, kept
// across phase attempts and resumes; stored under phase:<N>:protected-set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRepo, stubProfile, writeFile } from "./helpers.ts";
import {
  captureAtLaunch,
  captureAtPhaseEntry,
  protectedSetEntityName,
  writeProtectedSet,
  readProtectedSet,
} from "../../src/protected/entry.ts";

test("CT-116-4 the record carries atLaunch and atPhaseEntry, each with set and tree", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  const launch = await captureAtLaunch({ phase: 2, root, profiles: [stubProfile] });
  const entry = await captureAtPhaseEntry({ root, profiles: [stubProfile], prior: launch });
  assert.ok(entry.atPhaseEntry);
  assert.match(launch.atLaunch.tree, /^[0-9a-f]{64}$/);
  assert.match(launch.atLaunch.set, /^[0-9a-f]{64}$/);
  assert.match(entry.atPhaseEntry.tree, /^[0-9a-f]{64}$/);
  assert.equal(entry.atLaunch.set, launch.atLaunch.set); // kept across attempts
});

test("CT-116-4 the phase-entry fingerprint is kept across a resume even after a change", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  const launch = await captureAtLaunch({ phase: 2, root, profiles: [stubProfile] });
  const entry = await captureAtPhaseEntry({ root, profiles: [stubProfile], prior: launch });
  writeFile(root, "test/a.test.ts", "pass // changed");
  const resumed = await captureAtPhaseEntry({
    root,
    profiles: [stubProfile],
    prior: entry,
    resumed: true,
  });
  assert.ok(resumed.atPhaseEntry);
  assert.equal(resumed.atPhaseEntry.tree, entry.atPhaseEntry?.tree);
});

test("CT-116-4 storage under phase:<N>:protected-set survives a relaunch", async () => {
  const root = makeRepo({ "test/a.test.ts": "pass" });
  const controlRoot = mkdtempSync(join(tmpdir(), "integrity-116-control-"));
  assert.equal(protectedSetEntityName(3), "phase:3:protected-set");
  const record = await captureAtLaunch({ phase: 3, root, profiles: [stubProfile] });
  await writeProtectedSet(controlRoot, record);
  const read = await readProtectedSet(controlRoot, 3);
  assert.equal(read.schema, "specstride.protected-set/1");
  assert.deepEqual(read, record);
});
