/**
 * CT-115-22 (T053, F115-FR-022) — characterization: one test case per cap —
 * repairs, proposal time, unit time, cycles, unresolved units.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAP_DEFAULTS,
  capsFor,
  cyclesLeft,
  newCapsCounters,
  proposalCapReached,
  recordProposalMinutes,
  recordRepair,
  recordUnitMinutes,
  recordUnresolved,
  repairsLeftForUnit,
  repairsUsedFor,
  spendCycles,
  unresolvedCapReached,
  unitCapReached,
  cycleCapFor,
} from "../../src/caps/caps.ts";

test("CT-115-22: cap repairs — 2 per task id; the count of a unit is the highest among its tasks", () => {
  const caps = capsFor();
  assert.equal(caps.repairs, 2);
  assert.equal(CAP_DEFAULTS.repairs, 2);
  let counters = newCapsCounters();
  counters = recordRepair(counters, ["T010"]);
  assert.equal(repairsUsedFor(counters, "T010"), 1);
  assert.equal(repairsLeftForUnit(counters, ["T010", "T011"], caps), 2);
  counters = recordRepair(counters, ["T010", "T011"]);
  assert.equal(repairsLeftForUnit(counters, ["T010", "T011"], caps), 1);
});

test("CT-115-22: a new grouping of tasks does not reset a count", () => {
  const caps = capsFor();
  let counters = recordRepair(newCapsCounters(), ["T010"]);
  counters = recordRepair(counters, ["T010"]);
  // The unit regroups: T010 now travels with T012. The count of T010 stands,
  // and the unit carries the repairs left of its least-spent task.
  assert.equal(repairsUsedFor(counters, "T010"), 2);
  assert.equal(repairsLeftForUnit(counters, ["T010", "T012"], caps), 2);
});

test("CT-115-22: cap time per proposal — 20 minutes, applied once the layer is engaged", () => {
  const caps = capsFor();
  assert.equal(caps.proposalMinutes, 20);
  let counters = recordProposalMinutes(newCapsCounters(), 19);
  assert.equal(proposalCapReached(counters, caps), false);
  counters = recordProposalMinutes(counters, 1);
  assert.equal(proposalCapReached(counters, caps), true);
});

test("CT-115-22: cap time per unit — 30 minutes, proposals, repairs and checks together", () => {
  const caps = capsFor();
  assert.equal(caps.unitMinutes, 30);
  let counters = recordUnitMinutes(newCapsCounters(), ["T010"], 20);
  counters = recordUnitMinutes(counters, ["T010"], 9);
  assert.equal(unitCapReached(counters, ["T010"], caps), false);
  counters = recordUnitMinutes(counters, ["T010"], 1);
  assert.equal(unitCapReached(counters, ["T010"], caps), true);
});

test("CT-115-22: cap cycles — tasks plus 6, at least 12", () => {
  const caps = capsFor();
  assert.equal(caps.cyclesExtra, 6);
  assert.equal(caps.cyclesMin, 12);
  assert.equal(cycleCapFor(3, caps), 12);
  assert.equal(cycleCapFor(10, caps), 16);
  let counters = spendCycles(newCapsCounters(), 11);
  assert.equal(cyclesLeft(counters, 3, caps), 1);
  counters = spendCycles(counters, 1);
  assert.equal(cyclesLeft(counters, 3, caps), 0);
});

test("CT-115-22: cap unresolved units — 2 before the layer goes off", () => {
  const caps = capsFor();
  assert.equal(caps.unresolvedUnits, 2);
  let counters = recordUnresolved(newCapsCounters());
  assert.equal(unresolvedCapReached(counters, caps), false);
  counters = recordUnresolved(counters);
  assert.equal(unresolvedCapReached(counters, caps), true);
});
