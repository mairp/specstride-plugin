/**
 * CT-115-109 (T029, IR-09, F115-FR-009) — a checkpoint is a claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheckpoint } from "../../src/unit/validate.ts";
import { decideOutcome } from "../../src/unit/outcome.ts";

test("CT-115-109: the claim is validated against the phase, not believed", () => {
  // The proposer declares the task done in the note; the declaration is a
  // claim and earns the unit nothing on its own.
  const claim = {
    schema: "specstride.checkpoint/1",
    tasks: ["T010"],
    note: "T010 is fully done, every test passes, please keep it",
  };
  const result = validateCheckpoint(claim, { phaseTaskIds: ["T010", "T011"] });
  assert.ok(result.ok);
  // The outcome still comes from the check results, not from the claim.
  const decision = decideOutcome([{ id: "a", exit: 1 }], {
    taskIds: result.tasks,
    budget: { repairsLeft: {}, defaultRepairsLeft: 2 },
  });
  assert.equal(decision.outcome, "repair");
});

test("CT-115-109: a claim naming nothing valid earns nothing", () => {
  const empty = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: [] },
    { phaseTaskIds: ["T010"] },
  );
  assert.deepEqual(empty, { ok: false, reason: "empty" });
  const foreign = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T999"] },
    { phaseTaskIds: ["T010"] },
  );
  assert.deepEqual(foreign, { ok: false, reason: "foreign-id" });
});

test("CT-115-109: a claim is never a verdict of the phase gate", () => {
  const result = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T010"] },
    { phaseTaskIds: ["T010"] },
  );
  assert.ok(result.ok);
  assert.equal("verdict" in result, false);
  assert.equal("approval" in result, false);
});
