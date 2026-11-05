/**
 * CT-115-150 (T069, IR-50, F115-FR-024) — characterization: interrupted
 * checks — the counts are kept per task id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interruptionsOf,
  newInterruptionCounters,
  recordInterruption,
} from "../../src/caps/interrupted.ts";

test("CT-115-150 (IR-50): the counts per task id continue across units and regroupings", () => {
  let counters = newInterruptionCounters();
  // Unit 1 (T010): interrupted twice — the second counts as a cycle.
  counters = recordInterruption(counters, ["T010"]).counters;
  counters = recordInterruption(counters, ["T010"]).counters;
  assert.equal(counters.cyclesSpent, 1);
  // Unit 2 regroups T010 with T012: a new check key, its own count.
  const grouped = recordInterruption(counters, ["T010", "T012"]);
  assert.equal(grouped.outcome.times, 1);
  assert.equal(grouped.outcome.countedAsCycle, false);
  assert.equal(grouped.counters.cyclesSpent, 1);
});

test("CT-115-150 (IR-50): the count of a task id survives the end of its unit", () => {
  let counters = newInterruptionCounters();
  counters = recordInterruption(counters, ["T010"]).counters;
  // The unit T010 ends; the counts of the attempt remain readable per task id.
  assert.equal(interruptionsOf(counters, ["T010"]), 1);
  // A unit that names T010 again continues the count: the second interruption counts.
  const second = recordInterruption(counters, ["T010"]);
  assert.equal(second.outcome.times, 2);
  assert.equal(second.outcome.countedAsCycle, true);
});

test("CT-115-150 (IR-50): only interruptions count — a clean check spends nothing", () => {
  const counters = newInterruptionCounters();
  assert.equal(counters.cyclesSpent, 0);
  assert.deepEqual(counters.byCheck, {});
});
