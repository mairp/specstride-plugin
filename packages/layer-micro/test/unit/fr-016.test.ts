/**
 * CT-115-16 (T021, F115-FR-016) — the outcomes kept, repair, unresolved,
 * with their directives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome, repairsLeftFor, UNIT_OUTCOMES } from "../../src/unit/outcome.ts";

const BUDGET = { repairsLeft: {}, defaultRepairsLeft: 2 };
const TASKS = ["T010"];

test("CT-115-16: kept — every command exits 0 with no condition", () => {
  const decision = decideOutcome(
    [
      { id: "a", exit: 0 },
      { id: "b", exit: 0 },
    ],
    { taskIds: TASKS, budget: BUDGET },
  );
  assert.deepEqual(decision, { outcome: "kept", directive: "keep" });
});

test("CT-115-16: repair — a failed command, or a conditioned one, with repairs left", () => {
  for (const results of [
    [{ id: "a", exit: 1 }],
    [{ id: "a", exit: 0, conditions: ["tainted"] }],
    [{ id: "a", exit: 0, conditions: ["cached"] }],
  ]) {
    const decision = decideOutcome(results, { taskIds: TASKS, budget: BUDGET });
    assert.deepEqual(decision, { outcome: "repair", directive: "repair" }, JSON.stringify(results));
  }
});

test("CT-115-16: unresolved — repairs spent, or the time cap of the unit reached", () => {
  const spent = decideOutcome([{ id: "a", exit: 1 }], {
    taskIds: TASKS,
    budget: { repairsLeft: { T010: 0 }, defaultRepairsLeft: 0 },
  });
  assert.deepEqual(spent, { outcome: "unresolved", directive: "unresolved" });
  const capped = decideOutcome([{ id: "a", exit: 0 }], {
    taskIds: TASKS,
    budget: BUDGET,
    timeCapReached: true,
  });
  assert.deepEqual(capped, { outcome: "unresolved", directive: "unresolved" });
});

test("CT-115-16: the repair count is the highest among the tasks of the unit", () => {
  assert.equal(
    repairsLeftFor(["T010", "T011"], {
      repairsLeft: { T010: 0, T011: 1 },
      defaultRepairsLeft: 0,
    }),
    1,
  );
});

test("CT-115-16: the outcome set is closed", () => {
  assert.deepEqual([...UNIT_OUTCOMES], ["kept", "repair", "unresolved", "unchecked"]);
});
