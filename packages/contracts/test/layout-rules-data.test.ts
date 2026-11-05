/**
 * T242 — contract tests CT-100-135, CT-100-137 to CT-100-142 for the layout
 * rules SL-1, SL-3 to SL-7 as data (annex B, §B.2; F100-FR-035,
 * F100-FR-037 to F100-FR-042).
 */
import test from "node:test";
import assert from "node:assert/strict";
import layout from "../data/layout.json" with { type: "json" };
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import {
  advisoryMarker,
  advisoryMarkerRefusal,
  carryOverNames,
  claimNames,
  claimsAreReadNoFollow,
  claimsDecideNothing,
  controlPlaneNames,
  eventStreamName,
  groundingRefusal,
  groundingRefusedNames,
  inboxNames,
  layoutVersion,
  layoutVersionName,
  mayBeWrittenFromOutsideAfterLaunch,
  outboxName,
  protectionByLevel,
  protectionFor,
  supervisionRecordName,
  treeStoreName,
  workerRootName,
  writtenFromOutsideAfterLaunch,
  CONTAINMENT_LEVELS,
  PROTECTION_VALUES,
} from "../src/ids/layout-rules.ts";
import { holdsLogicalName } from "../src/ids/logical-names.ts";

test("CT-100-135: the claims are read no-follow and decide nothing (SL-1, F100-FR-035)", () => {
  assert.equal(claimsDecideNothing, true);
  assert.equal(claimsAreReadNoFollow, true);
  // The two claims the rule names: the outbox and the phase evidence.
  assert.deepEqual([...claimNames], ["feature:<slug>:outbox", "gate:<N>:evidence"]);
  for (const name of claimNames) assert.ok(holdsLogicalName(name), `${name} must be in §B.5`);
});

test("CT-100-137: the refused paths of grounding are exactly the logical names the rule lists (SL-3, F100-FR-037)", () => {
  // Every name of the control plane, plus the event stream, the outbox, the
  // two carry-over files, the worker root and the tree store.
  const expected = new Set<string>([
    ...controlPlaneNames,
    eventStreamName,
    outboxName,
    ...carryOverNames,
    workerRootName,
    treeStoreName,
  ]);
  assert.deepEqual(new Set(groundingRefusedNames), expected);
  for (const name of groundingRefusedNames) {
    assert.ok(holdsLogicalName(name), `${name} must be a logical name of §B.5`);
  }
  // Each one the rule names by hand is in the list.
  for (const name of [
    eventStreamName,
    outboxName,
    workerRootName,
    treeStoreName,
    ...carryOverNames,
  ]) {
    assert.ok(groundingRefusedNames.includes(name), `${name} must be refused`);
  }
  // And every path under the project's repository directory is refused too.
  assert.equal(groundingRefusal.refusesRepositoryDirectory, true);
  assert.equal(groundingRefusal.byRealPath, true);
});

test("CT-100-138: the layout has a version and the table is one table (SL-4, F100-FR-038)", () => {
  assert.match(layoutVersion, /^\d+\.\d+$/);
  assert.equal(layoutVersion, (layout as { layoutVersion: string }).layoutVersion);
  // One table from logical names to locations.
  assert.ok((layout as { logicalNames: unknown[] }).logicalNames.length > 0);
});

test("CT-100-139: after launch only the inbox and the supervision record are written from outside (SL-5, F100-FR-039)", () => {
  assert.ok(inboxNames.length > 0);
  for (const name of inboxNames) assert.match(name, /^inbox:/);
  assert.deepEqual([...writtenFromOutsideAfterLaunch], [...inboxNames, supervisionRecordName]);
  for (const name of writtenFromOutsideAfterLaunch) {
    assert.ok(mayBeWrittenFromOutsideAfterLaunch(name), `${name} may be written from outside`);
    assert.ok(holdsLogicalName(name));
  }
  // Nothing else may be: the run record is written by the runtime tree.
  assert.ok(!mayBeWrittenFromOutsideAfterLaunch("run:<runId>:record"));
  assert.ok(!mayBeWrittenFromOutsideAfterLaunch("workspace:record"));
});

test("CT-100-140: protection is detect at C0 and C1, and prevent at C2 and above only on a confirmed denial (SL-6, F100-FR-040)", () => {
  const levels = (
    harnessTables as { containmentLevels: { Level: string }[] }
  ).containmentLevels.map((r) => r.Level);
  assert.deepEqual([...CONTAINMENT_LEVELS], levels);
  assert.deepEqual([...PROTECTION_VALUES], ["prevent", "detect"]);
  for (const confirmed of [true, false]) {
    assert.equal(protectionFor("C0", confirmed), "detect");
    assert.equal(protectionFor("C1", confirmed), "detect");
  }
  assert.equal(protectionFor("C2", true), "prevent");
  assert.equal(protectionFor("C2", false), "detect");
  assert.equal(protectionFor("C3", true), "prevent");
  assert.equal(protectionFor("C3", false), "detect");
  // A level outside the set is read as the safe value.
  assert.equal(protectionFor("C9", true), "detect");
  assert.deepEqual(protectionByLevel["C0"], { confirmed: "detect", unconfirmed: "detect" });
  assert.deepEqual(protectionByLevel["C2"], { confirmed: "prevent", unconfirmed: "detect" });
});

test("CT-100-141: the layout version file is a logical name of the workspace part (SL-7, F100-FR-041)", () => {
  assert.ok(holdsLogicalName(layoutVersionName));
  const row = (
    layout as { logicalNames: { logicalName: string; root: string }[] }
  ).logicalNames.find((n) => n.logicalName === layoutVersionName);
  assert.ok(row !== undefined);
  assert.match(row.root, /^workspace/);
});

test("CT-100-142: the advisory marker holds an owner record and foreign-owner is a refusal (F100-FR-042)", () => {
  assert.ok(holdsLogicalName(advisoryMarker.logicalName));
  assert.equal(advisoryMarker.holds, "owner-record");
  assert.equal(advisoryMarker.refusalWhenOwnerCannotBeProbed, "foreign-owner");
  assert.equal(advisoryMarkerRefusal, "foreign-owner");
  assert.equal(advisoryMarker.decidesNothingElse, true);
  assert.equal(advisoryMarker.removalIsIntegrityEvent, true);
  // The marker lies in the workspace part.
  const row = (
    layout as { logicalNames: { logicalName: string; root: string }[] }
  ).logicalNames.find((n) => n.logicalName === advisoryMarker.logicalName);
  assert.ok(row !== undefined);
  assert.match(row.root, /^workspace/);
});
