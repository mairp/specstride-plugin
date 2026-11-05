/**
 * T061 — contract tests CT-100-175 for State export, import and adopt
 * (annex B, §B.19; F100-FR-075).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHIVED_PARTS,
  SCHEMA_ID,
  STATE_COMMANDS,
  mayAdopt,
  mayInstall,
  refusalBesideALiveRun,
  type StateArchive,
} from "../src/records/state-archive.ts";

const archive = (): StateArchive => ({
  schema: SCHEMA_ID,
  feature: "100-specstride",
  approvals: [],
  ledger: [],
  learningLog: [],
  exportedAt: "2026-09-30T00:00:00.000Z",
  productVersion: "2.0.0",
  keyId: "k-1",
  sig: "s-1",
});

test("CT-100-175: the signed archive of one feature holds the approval records, the ledger and the learning log (F100-FR-075)", () => {
  assert.equal(SCHEMA_ID, "specstride.state-archive/1");
  assert.deepEqual([...ARCHIVED_PARTS], ["approvals", "ledger", "learningLog"]);
  const a = archive();
  for (const part of ARCHIVED_PARTS) {
    assert.ok(Array.isArray(a[part]), `the archive holds ${part}`);
  }
  // It is signed: `state import` verifies before it installs.
  assert.equal(mayInstall(a, true), true);
  assert.equal(mayInstall(a, false), false, "an archive whose signature fails is not installed");
  assert.equal(
    mayInstall({ ...a, schema: "specstride.state-archive/2" as never }, true),
    false,
    "a different major is not installed",
  );
});

test("CT-100-175: none of the three commands runs beside a live run (F100-FR-075)", () => {
  assert.deepEqual([...STATE_COMMANDS], ["state export", "state import", "state adopt"]);
  for (const command of STATE_COMMANDS) {
    assert.equal(refusalBesideALiveRun(command, false), undefined, `${command} runs with no run`);
    const refusal = refusalBesideALiveRun(command, true);
    assert.match(String(refusal), /does not run beside a live run/);
    assert.match(String(refusal), /F100-FR-075/);
    assert.match(String(refusal), new RegExp(command));
  }
});

test("CT-100-175: state adopt takes over the control plane of the same working tree at an old path", () => {
  assert.equal(
    mayAdopt({ workspaceRealPath: "/repo", oldControlRoot: "/old/control" }, "/repo"),
    true,
  );
  assert.equal(
    mayAdopt({ workspaceRealPath: "/other", oldControlRoot: "/old/control" }, "/repo"),
    false,
    "the working tree must be the same one",
  );
});
