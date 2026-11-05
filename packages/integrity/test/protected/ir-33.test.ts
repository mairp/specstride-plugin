// CT-116-133 (IR-33; F116-FR-012): tree at phase entry equals the approved tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePhaseEntry } from "../../src/protected/phase-entry.ts";

test("IR-33 an equal tree at phase entry raises no event", () => {
  const outcome = comparePhaseEntry({
    overrides: {},
    entryTree: "t",
    approvedTree: "t",
    changedPaths: [],
  });
  assert.equal(outcome.event, null);
  assert.equal(outcome.blocked, false);
});

test("IR-33 a differing tree raises phase-entry-mismatch and the run goes on", () => {
  const outcome = comparePhaseEntry({
    overrides: {},
    entryTree: "entry",
    approvedTree: "approved",
    changedPaths: ["toolchain/r.json", "test/a.test.ts"],
  });
  assert.equal(outcome.event && outcome.event.kind, "phase-entry-mismatch");
  assert.equal(outcome.blocked, false);
});
