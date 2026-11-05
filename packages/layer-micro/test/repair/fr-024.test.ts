/**
 * CT-115-24 (T055, F115-FR-024) — characterization: the interrupted check —
 * first and second interruption.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkKeyOf,
  interruptionsOf,
  newInterruptionCounters,
  recordInterruption,
} from "../../src/caps/interrupted.ts";

test("CT-115-24: the first interruption counts neither as a cycle nor as a failure, and reruns", () => {
  const first = recordInterruption(newInterruptionCounters(), ["T010"]);
  assert.deepEqual(first.outcome, {
    status: "interrupted",
    times: 1,
    countedAsCycle: false,
    countedAsFailure: false,
    action: "rerun",
  });
  assert.equal(first.counters.cyclesSpent, 0);
});

test("CT-115-24: the second interruption of the same check counts as a cycle", () => {
  let counters = newInterruptionCounters();
  counters = recordInterruption(counters, ["T010"]).counters;
  const second = recordInterruption(counters, ["T010"]);
  assert.equal(second.outcome.times, 2);
  assert.equal(second.outcome.countedAsCycle, true);
  assert.equal(second.outcome.countedAsFailure, false);
  assert.equal(second.counters.cyclesSpent, 1);
});

test("CT-115-24: the check runs again after every interruption", () => {
  let counters = newInterruptionCounters();
  for (const expectedTimes of [1, 2, 3]) {
    const recorded = recordInterruption(counters, ["T010"]);
    counters = recorded.counters;
    assert.equal(recorded.outcome.action, "rerun");
    assert.equal(recorded.outcome.times, expectedTimes);
  }
});

test("CT-115-24 (IR-50): the counts are kept per task id", () => {
  let counters = newInterruptionCounters();
  counters = recordInterruption(counters, ["T010"]).counters;
  counters = recordInterruption(counters, ["T010"]).counters;
  counters = recordInterruption(counters, ["T011"]).counters;
  assert.equal(interruptionsOf(counters, ["T010"]), 2);
  assert.equal(interruptionsOf(counters, ["T011"]), 1);
  assert.equal(interruptionsOf(counters, ["T012"]), 0);
  assert.equal(checkKeyOf(["T010", "T011"]), "T010,T011");
});
