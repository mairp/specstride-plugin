/**
 * CT-115-127 (T088, IR-27; F115-FR-001, F115-FR-005) — characterization of
 * the integrity rule IR-27: the strategy is pinned at launch; the fallback
 * is announced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replayStrategyOnResume,
  selectStrategyAtLaunch,
  type StrategyRecord,
} from "../../src/strategy/select.ts";
import {
  fallbackAtLaunch,
  fallbackWhenItOccurs,
  type LaunchRead,
} from "../../src/strategy/fallback.ts";

const RECORD: StrategyRecord = {
  runId: "run-27",
  strategy: "micro",
  level: "L1",
  manifestHashes: { "1": "h-27" },
  source: "configured",
  replayedOnResume: false,
};

const BASE: LaunchRead = {
  verificationMode: "required",
  configuredStrategy: "micro",
  harnessOffersProposerLevel: true,
  tripwireBreached: false,
};

test("IR-27: the strategy is pinned once at launch and lands in the record", () => {
  const chosen = selectStrategyAtLaunch({
    runId: "run-27",
    configured: "micro",
    manifestHashes: { "1": "h-27" },
  });
  assert.equal(chosen.ok, true);
  if (!chosen.ok) return;
  assert.equal(chosen.record.strategy, "micro");
  assert.equal(chosen.record.level, "L1");
  assert.equal(chosen.record.manifestHashes["1"], "h-27");
});

test("IR-27: a resume never changes the pinned strategy; a difference warns", () => {
  const replay = replayStrategyOnResume({ recorded: RECORD, configured: "classic" });
  assert.equal(replay?.strategy, "micro");
  assert.notEqual(replay?.warning, undefined);
  const relaunch = replayStrategyOnResume({ recorded: RECORD });
  assert.equal(relaunch?.record.strategy, "micro");
  assert.equal(relaunch?.record.manifestHashes["1"], "h-27");
});

test("IR-27: every fallback that happens is announced with its reason", () => {
  const launches = [
    fallbackAtLaunch({ ...BASE, verificationMode: "off" }),
    fallbackAtLaunch({ ...BASE, configuredStrategy: "classic" }),
    fallbackAtLaunch({ ...BASE, harnessOffersProposerLevel: false }),
    fallbackAtLaunch({ ...BASE, tripwireBreached: true }),
  ];
  for (const f of launches) {
    assert.ok(f.fallback);
    if (!f.fallback) continue;
    assert.match(f.announcement, /^strategy=classic reason=/);
    assert.equal(f.event.type, "loop.fallback");
  }
  const attempt = fallbackWhenItOccurs({
    phaseTasksAtLaunch: 1,
    firstCheckpointNamesEveryTask: false,
    innerCount: 2,
  });
  assert.ok(attempt.fallback);
  if (attempt.fallback) {
    assert.equal(attempt.announcement, "strategy=classic reason=single-unit");
  }
});

test("IR-27: no fallback, no announcement", () => {
  assert.equal(fallbackAtLaunch(BASE).announcement, "none");
});
