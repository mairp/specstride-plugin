/**
 * CT-115-5 (T085, F115-FR-005) — characterization: one test case per
 * fallback reason: gate-not-executing, config, harness, tripwire,
 * no-check, single-unit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTEMPT_FALLBACK_REASONS,
  FALLBACK_REASONS,
  RUN_FALLBACK_REASONS,
  announceAttemptFallback,
  fallbackAtLaunch,
  fallbackWhenItOccurs,
  type LaunchRead,
} from "../../src/strategy/fallback.ts";

test("CT-115-5: the closed set holds exactly the six reasons of row 59", () => {
  assert.deepEqual(
    [...FALLBACK_REASONS],
    ["gate-not-executing", "no-check", "single-unit", "harness", "config", "tripwire"],
  );
  assert.deepEqual(
    [...RUN_FALLBACK_REASONS],
    ["gate-not-executing", "harness", "config", "tripwire"],
  );
  assert.deepEqual([...ATTEMPT_FALLBACK_REASONS], ["no-check", "single-unit"]);
});

const BASE: LaunchRead = {
  verificationMode: "required",
  configuredStrategy: "micro",
  harnessOffersProposerLevel: true,
  tripwireBreached: false,
};

test("CT-115-5: gate-not-executing — the gate does not execute", () => {
  const f = fallbackAtLaunch({ ...BASE, verificationMode: "plan" });
  assert.ok(f.fallback);
  if (f.fallback) assert.equal(f.reason, "gate-not-executing");
});

test("CT-115-5: config — the configuration in force selects classic", () => {
  const f = fallbackAtLaunch({ ...BASE, configuredStrategy: "classic" });
  assert.ok(f.fallback);
  if (f.fallback) {
    assert.equal(f.reason, "config");
    assert.equal(f.announcement, "strategy=classic reason=config");
  }
});

test("CT-115-5: harness — the harness offers no proposer level", () => {
  const f = fallbackAtLaunch({ ...BASE, harnessOffersProposerLevel: false });
  assert.ok(f.fallback);
  if (f.fallback) assert.equal(f.reason, "harness");
});

test("CT-115-5: tripwire — a tripwire record stands", () => {
  const f = fallbackAtLaunch({ ...BASE, tripwireBreached: true });
  assert.ok(f.fallback);
  if (f.fallback) assert.equal(f.reason, "tripwire");
});

test("CT-115-5: single-unit — one task in the reading at launch", () => {
  const f = fallbackWhenItOccurs({
    phaseTasksAtLaunch: 1,
    firstCheckpointNamesEveryTask: false,
    innerCount: 3,
  });
  assert.ok(f.fallback);
  if (f.fallback) {
    assert.equal(f.scope, "attempt");
    assert.equal(f.reason, "single-unit");
  }
});

test("CT-115-5: single-unit — the first accepted checkpoint names every task", () => {
  const f = fallbackWhenItOccurs({
    phaseTasksAtLaunch: 4,
    firstCheckpointNamesEveryTask: true,
    innerCount: 3,
  });
  assert.ok(f.fallback);
  if (f.fallback) assert.equal(f.reason, "single-unit");
});

test("CT-115-5: no-check — the inner set of the phase is empty", () => {
  const f = fallbackWhenItOccurs({
    phaseTasksAtLaunch: 4,
    firstCheckpointNamesEveryTask: false,
    innerCount: 0,
  });
  assert.ok(f.fallback);
  if (f.fallback) {
    assert.equal(f.scope, "attempt");
    assert.equal(f.reason, "no-check");
    assert.equal(f.announcement, "strategy=classic reason=no-check");
  }
});

test("CT-115-5: no fallback — every reason absent, the layer runs", () => {
  assert.deepEqual(fallbackAtLaunch(BASE), {
    fallback: false,
    reason: "none",
    announcement: "none",
  });
  assert.deepEqual(
    fallbackWhenItOccurs({
      phaseTasksAtLaunch: 4,
      firstCheckpointNamesEveryTask: false,
      innerCount: 3,
    }),
    { fallback: false, reason: "none", announcement: "none" },
  );
});

test("CT-115-5: an attempt reason announced when it occurs carries its event", () => {
  const f = announceAttemptFallback("single-unit");
  assert.deepEqual(f.event, {
    type: "loop.fallback",
    scope: "attempt",
    reason: "single-unit",
  });
});
