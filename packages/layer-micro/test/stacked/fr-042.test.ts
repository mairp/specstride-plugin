/**
 * CT-115-42 (T130, F115-FR-042) — characterization: beneath the layer of
 * parallel units, an integrated group enters the micro-loop as ONE kept
 * unit; a failed merge check charges one repair to every task of the unit;
 * with parallel units off, nothing changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERGE_CHECK_ID,
  chargeOneRepairPerTask,
  enterIntegratedGroup,
  groupTasks,
} from "../../src/unit/integrated-group.ts";
import { decideOutcome, type CheckResult } from "../../src/unit/outcome.ts";

const PASS = (id: string): CheckResult => ({ id, exit: 0 });
const FAIL = (id: string): CheckResult => ({ id, exit: 1 });

const MEMBERS = [
  { unitId: "m1", taskIds: ["T010", "T011"], results: [PASS("a"), PASS("b")] },
  { unitId: "m2", taskIds: ["T012"], results: [PASS("c")] },
];

const BUDGET = { repairsLeft: {}, defaultRepairsLeft: 2 };

test("CT-115-42: an integrated group enters as ONE kept unit", () => {
  const entry = enterIntegratedGroup({
    unitId: "g1",
    members: MEMBERS,
    mergeResult: PASS(MERGE_CHECK_ID),
    budget: BUDGET,
    parallelUnitsOn: true,
  });
  assert.equal(entry.entered, true);
  if (!entry.entered) return;
  // One unit, not one per member: the id of the group, the union of tasks.
  assert.equal(entry.unitId, "g1");
  assert.deepEqual(entry.tasks, ["T010", "T011", "T012"]);
  assert.deepEqual(groupTasks(MEMBERS), ["T010", "T011", "T012"]);
  assert.deepEqual(entry.decision, { outcome: "kept", directive: "keep" });
});

test("CT-115-42: a failed merge check sends the group into the repair path", () => {
  const entry = enterIntegratedGroup({
    unitId: "g1",
    members: MEMBERS,
    mergeResult: FAIL(MERGE_CHECK_ID),
    budget: BUDGET,
    parallelUnitsOn: true,
  });
  assert.ok(entry.entered);
  if (!entry.entered) return;
  assert.deepEqual(entry.decision, { outcome: "repair", directive: "repair" });
  // One repair charged to EVERY task of the unit.
  assert.deepEqual(entry.budget.repairsLeft, {
    T010: 1,
    T011: 1,
    T012: 1,
  });
});

test("CT-115-42: one repair per task, even when the members could not be told apart", () => {
  const charged = chargeOneRepairPerTask(["T010", "T011"], BUDGET);
  assert.deepEqual(charged.repairsLeft, { T010: 1, T011: 1 });
  assert.equal(charged.defaultRepairsLeft, 2);
  // A second failed merge check spends the second repair of every task:
  // every task of the unit stands at 0, and no default rescue applies.
  const twice = chargeOneRepairPerTask(["T010", "T011"], charged);
  assert.deepEqual(twice.repairsLeft, { T010: 0, T011: 0 });
  const spent = {
    repairsLeft: { ...twice.repairsLeft, T012: 0 },
    defaultRepairsLeft: twice.defaultRepairsLeft,
  };
  // A third failure cannot go to repair any more: the unit is unresolved.
  const third = enterIntegratedGroup({
    unitId: "g1",
    members: MEMBERS,
    mergeResult: FAIL(MERGE_CHECK_ID),
    budget: spent,
    parallelUnitsOn: true,
  });
  assert.ok(third.entered);
  if (third.entered) {
    assert.deepEqual(third.decision, { outcome: "unresolved", directive: "unresolved" });
    assert.deepEqual(third.budget.repairsLeft, { T010: 0, T011: 0, T012: 0 });
  }
});

test("CT-115-42: a merge check that passed but carried a condition is a failed merge check", () => {
  const entry = enterIntegratedGroup({
    unitId: "g1",
    members: MEMBERS,
    mergeResult: { id: MERGE_CHECK_ID, exit: 0, conditions: ["tainted"] },
    budget: BUDGET,
    parallelUnitsOn: true,
  });
  assert.ok(entry.entered);
  if (entry.entered) assert.equal(entry.decision.outcome, "repair");
});

test("CT-115-42: with parallel units off, nothing changes", () => {
  const entry = enterIntegratedGroup({
    unitId: "g1",
    members: MEMBERS,
    mergeResult: FAIL(MERGE_CHECK_ID),
    budget: BUDGET,
    parallelUnitsOn: false,
  });
  // The entry is not used: the members stand alone with their own decisions.
  assert.deepEqual(entry, {
    entered: false,
    decisions: {
      m1: { outcome: "kept", directive: "keep" },
      m2: { outcome: "kept", directive: "keep" },
    },
  });
  // And the decisions are exactly the ones the layer gives without a group.
  assert.deepEqual(
    entry.decisions.m1,
    decideOutcome(MEMBERS[0].results, {
      taskIds: MEMBERS[0].taskIds,
      budget: BUDGET,
    }),
  );
});
