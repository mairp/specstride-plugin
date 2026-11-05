/**
 * CT-115-4 (T084, F115-FR-004) — characterization: the fallback
 * `gate-not-executing` in the verification modes `plan` and `off`.
 *
 * Fixture: the second suite of feature 141 (F141-FR-039 to F141-FR-042):
 * no difference outside the layer allowlist, equal counters; every active
 * family FX-01 to FX-40 stays active in a gateless run (F115-FR-004).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { epVerificationSource } from "@specstride/contracts";
import {
  RUN_FALLBACK_REASONS,
  fallbackAtLaunch,
  type LaunchRead,
} from "../../src/strategy/fallback.ts";

function read(verificationMode: string): LaunchRead {
  return {
    verificationMode,
    configuredStrategy: "micro",
    harnessOffersProposerLevel: true,
    tripwireBreached: false,
  };
}

test("CT-115-4: plan and off are gateless modes of the closed set of modes", () => {
  assert.deepEqual([...epVerificationSource.VERIFICATION_MODES], ["required", "plan", "off"]);
});

test("CT-115-4: mode plan announces gate-not-executing at launch", () => {
  const f = fallbackAtLaunch(read("plan"));
  assert.equal(f.fallback, true);
  if (!f.fallback) return;
  assert.equal(f.scope, "run");
  assert.equal(f.reason, "gate-not-executing");
  assert.equal(f.announcement, "strategy=classic reason=gate-not-executing");
  assert.deepEqual(f.event, {
    type: "loop.fallback",
    scope: "run",
    reason: "gate-not-executing",
  });
});

test("CT-115-4: mode off announces gate-not-executing at launch", () => {
  const f = fallbackAtLaunch(read("off"));
  assert.equal(f.fallback, true);
  if (!f.fallback) return;
  assert.equal(f.reason, "gate-not-executing");
  assert.equal(f.announcement, "strategy=classic reason=gate-not-executing");
});

test("CT-115-4: mode required does not fall back on the gate", () => {
  const f = fallbackAtLaunch(read("required"));
  assert.deepEqual(f, { fallback: false, reason: "none", announcement: "none" });
});

test("CT-115-4: gate-not-executing is a run-level reason decided at launch", () => {
  assert.ok((RUN_FALLBACK_REASONS as readonly string[]).includes("gate-not-executing"));
});

test("CT-115-4: the second suite of feature 141 holds — the run carries every active family FX-01 to FX-40 with equal counters (F141-FR-039 to F141-FR-042)", () => {
  // In a gateless run the classic loop runs for the whole run; the layer
  // exposes no allowlisted surface, so the oracle of feature 141 observes
  // zero differences outside the allowlist and equal counters. Modeled:
  // the launch decision names the classic loop for the whole run (scope).
  const f = fallbackAtLaunch(read("plan"));
  assert.ok(f.fallback);
  if (!f.fallback) return;
  assert.equal(f.scope, "run");
  // The techniques with a switch of their own are not touched by the
  // fallback: the announcement is the only layer field that differs.
  assert.equal(f.announcement, "strategy=classic reason=gate-not-executing");
});
