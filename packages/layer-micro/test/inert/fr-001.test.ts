/**
 * CT-115-1 (T083, F115-FR-001) — characterization: the strategy is pinned at
 * launch and replayed on resume.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STRATEGY,
  LOOP_STRATEGIES,
  LAUNCH_LEVEL,
  recordStrategyForAttempt,
  replayStrategyOnResume,
  selectStrategyAtLaunch,
  type StrategyRecord,
} from "../../src/strategy/select.ts";

const RECORD: StrategyRecord = {
  runId: "run-1",
  strategy: "micro",
  level: "L1",
  manifestHashes: { "1": "h1" },
  source: "configured",
  replayedOnResume: false,
};

test("CT-115-1: the default strategy is micro, of the closed set classic|micro", () => {
  assert.equal(DEFAULT_STRATEGY, "micro");
  assert.deepEqual([...LOOP_STRATEGIES], ["classic", "micro"]);
});

test("CT-115-1: the strategy is chosen at launch, written to the run record", () => {
  const chosen = selectStrategyAtLaunch({ runId: "run-1" });
  assert.equal(chosen.ok, true);
  if (!chosen.ok) return;
  // Durable launch record: fields that did not exist before the launch read.
  assert.deepEqual(
    { ...chosen.record, manifestHashes: chosen.record.manifestHashes },
    {
      runId: "run-1",
      strategy: "micro",
      level: "L1",
      manifestHashes: {},
      source: "default",
      replayedOnResume: false,
    },
  );
  assert.equal(chosen.record.level, LAUNCH_LEVEL);
});

test("CT-115-1: an unknown configured strategy is a configuration error", () => {
  const chosen = selectStrategyAtLaunch({ runId: "r", configured: "turbo" });
  assert.equal(chosen.ok, false);
  if (chosen.ok) return;
  assert.equal(chosen.error, "configuration-error");
  assert.equal(chosen.value, "turbo");
});

test("CT-115-1: the strategy is recorded per phase attempt", () => {
  const at = recordStrategyForAttempt(RECORD, 2, 1);
  assert.equal(at.phase, 2);
  assert.equal(at.attempt, 1);
  assert.equal(at.strategy, "micro");
});

test("CT-115-1: a resume replays the recorded strategy and warns on a difference", () => {
  const same = replayStrategyOnResume({ recorded: RECORD, configured: "micro" });
  assert.equal(same?.strategy, "micro");
  assert.equal(same?.warning, undefined);

  const other = replayStrategyOnResume({ recorded: RECORD, configured: "classic" });
  assert.equal(other?.strategy, "micro"); // the recorded one applies
  assert.match(other?.warning ?? "", /pinned at launch as micro/);

  const none = replayStrategyOnResume({ recorded: RECORD });
  assert.equal(none?.strategy, "micro");
});
