// CT-116-12 (F116-FR-012): comparison at phase entry: switch, event, facts,
// no block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePhaseEntry, PHASE_ENTRY_SWITCH_KEY } from "../../src/protected/phase-entry.ts";

test("CT-116-12 the comparison is its own switch, on by default", () => {
  assert.equal(PHASE_ENTRY_SWITCH_KEY, "integrity.phase_entry");
  assert.equal(
    comparePhaseEntry({ overrides: {}, entryTree: "a", approvedTree: "a", changedPaths: [] })
      .checked,
    true,
  );
});

test("CT-116-12 a difference raises an integrity event of kind phase-entry-mismatch", () => {
  const outcome = comparePhaseEntry({
    overrides: {},
    entryTree: "entry-tree",
    approvedTree: "approved-tree",
    changedPaths: ["toolchain/runner.json"],
  });
  assert.equal(outcome.event && outcome.event.kind, "phase-entry-mismatch");
  assert.deepEqual(outcome.event && outcome.event.paths, ["toolchain/runner.json"]);
});

test("CT-116-12 the differing protected paths are facts for the critic and the run goes on", () => {
  const outcome = comparePhaseEntry({
    overrides: {},
    entryTree: "e",
    approvedTree: "a",
    changedPaths: ["x.ts"],
  });
  assert.deepEqual(outcome.factsForCritic, { phaseEntryMismatch: ["x.ts"] });
  assert.equal(outcome.blocked, false);
});

test("CT-116-12 under parity the switch reads off and nothing happens", () => {
  const outcome = comparePhaseEntry({
    overrides: { "integrity.phase_entry": "off" },
    entryTree: "e",
    approvedTree: "a",
    changedPaths: ["x.ts"],
  });
  assert.equal(outcome.checked, false);
  assert.equal(outcome.event, null);
});
