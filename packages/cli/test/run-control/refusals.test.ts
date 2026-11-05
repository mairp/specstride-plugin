/**
 * T003 — the closed set of the refusals of `resume` and their exit codes
 * (F102-FR-012 to F102-FR-016, F102-FR-024; contracts/resume-refusals.md).
 *
 * The state check of annex G §G.4 (exit 1, a workspace without state) is NOT
 * a member of the closed set and comes before every member; each member
 * carries the exit code of the contract table, in the fixed order.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPARED_SOURCES,
  NO_STATE_EXIT,
  RESUME_REFUSALS,
  SOURCE_CHANGED_REFUSAL,
  WAYS_OUT_OF_SOURCE_CHANGED,
  isResumeRefusal,
  resumeRefusalEntry,
  resumeRefusalExit,
} from "../../../cli/src/run-control/refusals.ts";

test("T003: the closed set holds the six refusals of the contract table", () => {
  assert.deepEqual(
    RESUME_REFUSALS.map((entry) => entry.refusal),
    [
      "nothing-to-resume",
      "unsupported-record",
      "lock-held",
      "owner-survivors",
      "source-changed",
      "settings-invalid",
    ],
  );
});

test("T003: the exit codes are 3 or 5 per the contract table", () => {
  assert.equal(resumeRefusalExit("nothing-to-resume"), 3);
  assert.equal(resumeRefusalExit("unsupported-record"), 3);
  assert.equal(resumeRefusalExit("lock-held"), 5);
  assert.equal(resumeRefusalExit("owner-survivors"), 5);
  assert.equal(resumeRefusalExit("source-changed"), 3);
  assert.equal(resumeRefusalExit("settings-invalid"), 3);
  assert.equal(resumeRefusalExit("no-state"), undefined);
});

test("T003: the exit 1 of a workspace without state is not a member and comes first (F102-FR-012)", () => {
  assert.equal(NO_STATE_EXIT, 1);
  assert.equal(isResumeRefusal("no-state"), false);
  // Every member of the set has a positive order after the state check,
  // which runs before order 1 of the set.
  for (const entry of RESUME_REFUSALS) {
    assert.ok(entry.order >= 1, entry.refusal);
    assert.notEqual(entry.exit, NO_STATE_EXIT);
  }
});

test("T003: the fixed order of the checks is the order of research D-2", () => {
  const orders = RESUME_REFUSALS.map((entry) => entry.order);
  assert.deepEqual(orders, [1, 2, 3, 3, 4, 5]);
});

test("T003: each refusal names what the contract table says it names", () => {
  const entry = resumeRefusalEntry("source-changed");
  assert.ok(entry);
  assert.match(entry.names, /spec, plan, tasks/);
  assert.match(resumeRefusalEntry("settings-invalid")?.names ?? "", /key/);
  assert.match(resumeRefusalEntry("lock-held")?.names ?? "", /holder/);
  assert.match(resumeRefusalEntry("owner-survivors")?.names ?? "", /process groups/);
  assert.match(resumeRefusalEntry("nothing-to-resume")?.names ?? "", /logical name|finished/);
  assert.match(resumeRefusalEntry("unsupported-record")?.names ?? "", /major/);
});

test("T003: source-changed compares the three sources and has three ways out (F102-FR-024)", () => {
  assert.equal(SOURCE_CHANGED_REFUSAL, "source-changed");
  assert.deepEqual([...COMPARED_SOURCES], ["spec", "plan", "tasks"]);
  assert.deepEqual(
    [...WAYS_OUT_OF_SOURCE_CHANGED],
    ["revert the change", "resume --accept-source-change", "launch --new-run"],
  );
});
