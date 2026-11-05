/**
 * CT-115-23 (T054, F115-FR-023) — characterization: the check time limit and
 * the 15 per cent share — the exclusions `slow` and `budget`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetExclusion,
  CHECK_SHARE_PERCENT_DEFAULT,
  CHECK_TIME_LIMIT_MS_DEFAULT,
  excludedResult,
  exclusionEvents,
  exclusionEvent,
  factBlockRows,
  slowExclusion,
} from "../../src/caps/exclusions.ts";

test("CT-115-23: a command has a time limit of 5 minutes by default", () => {
  assert.equal(CHECK_TIME_LIMIT_MS_DEFAULT, 5 * 60 * 1000);
});

test("CT-115-23: a command over its limit is excluded for the phase with the reason slow", () => {
  const exclusion = slowExclusion("lint", CHECK_TIME_LIMIT_MS_DEFAULT + 1);
  assert.deepEqual(exclusion, {
    id: "lint",
    reason: "slow",
    measuredMs: CHECK_TIME_LIMIT_MS_DEFAULT + 1,
    limitMs: CHECK_TIME_LIMIT_MS_DEFAULT,
  });
});

test("CT-115-23: a command inside its limit is not excluded", () => {
  assert.equal(slowExclusion("lint", CHECK_TIME_LIMIT_MS_DEFAULT), undefined);
  assert.equal(slowExclusion("lint", 1000), undefined);
});

test("CT-115-23: the result of an excluded command reads unchecked, not failed", () => {
  const result = excludedResult("lint");
  assert.equal(result.reads, "unchecked");
  assert.equal(result.exit, 0);
  assert.equal(result.excluded, true);
});

test("CT-115-23: from the third cycle a share over 15 per cent excludes the slowest command", () => {
  assert.equal(CHECK_SHARE_PERCENT_DEFAULT, 15);
  const candidates = [
    { id: "unit", measuredMs: 10_000 },
    { id: "lint", measuredMs: 60_000 },
  ];
  // Before the third cycle: nothing.
  assert.equal(budgetExclusion(candidates, { cycle: 2, checkSharePercent: 40 }), undefined);
  // Under the cap: nothing.
  assert.equal(budgetExclusion(candidates, { cycle: 3, checkSharePercent: 15 }), undefined);
  // From the third cycle over the cap: the slowest command, reason budget.
  assert.deepEqual(budgetExclusion(candidates, { cycle: 3, checkSharePercent: 40 }), {
    id: "lint",
    reason: "budget",
    measuredMs: 60_000,
    limitMs: 15,
  });
});

test("CT-115-23: every exclusion carries a reason and is recorded as check.excluded", () => {
  const slow = slowExclusion("lint", 400_000);
  if (slow === undefined) assert.fail("expected a slow exclusion");
  const event = exclusionEvent(slow);
  assert.equal(event.type, "check.excluded");
  assert.equal(event.reason, "slow");
  const budget = budgetExclusion([{ id: "unit", measuredMs: 5000 }], {
    cycle: 4,
    checkSharePercent: 50,
  });
  if (budget === undefined) assert.fail("expected a budget exclusion");
  const events = exclusionEvents([slow, budget]);
  assert.deepEqual(
    events.map((e) => [e.commandId, e.reason]),
    [
      ["lint", "slow"],
      ["unit", "budget"],
    ],
  );
});

test("CT-115-23: every exclusion is given to the builder of the fact block", () => {
  const slow = slowExclusion("lint", 400_000);
  if (slow === undefined) assert.fail("expected a slow exclusion");
  assert.deepEqual(factBlockRows([slow]), [{ commandId: "lint", reason: "slow" }]);
});
