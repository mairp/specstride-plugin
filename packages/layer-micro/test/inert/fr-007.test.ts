/**
 * CT-115-7 (T087, F115-FR-007) — characterization: time limits and runtime
 * commands equal the classic loop until engaged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptCheckpoint,
  createAttemptEngagement,
  effectiveCommands,
  effectiveTimeLimit,
} from "../../src/strategy/engaged.ts";

const CLASSIC_COMMANDS = ["npm test", "npm run lint", "tsc --noEmit"];

test("CT-115-7: not engaged, the time limit is the classic limit", () => {
  const inert = createAttemptEngagement();
  assert.equal(effectiveTimeLimit(inert, 600_000), 600_000);
});

test("CT-115-7: not engaged, the runtime commands are the classic commands", () => {
  const inert = createAttemptEngagement();
  assert.deepEqual(
    [...effectiveCommands(inert, CLASSIC_COMMANDS)],
    ["npm test", "npm run lint", "tsc --noEmit"],
  );
  // No command added, none removed, none reordered.
  assert.equal(effectiveCommands(inert, CLASSIC_COMMANDS).length, CLASSIC_COMMANDS.length);
});

test("CT-115-7: engaged, the classic basis is unchanged for both", () => {
  const engaged = acceptCheckpoint(createAttemptEngagement());
  assert.equal(effectiveTimeLimit(engaged, 600_000), 600_000);
  assert.deepEqual(
    [...effectiveCommands(engaged, CLASSIC_COMMANDS)],
    ["npm test", "npm run lint", "tsc --noEmit"],
  );
});

test("CT-115-7: a different classic budget is passed through untouched while inert", () => {
  const inert = createAttemptEngagement();
  assert.equal(effectiveTimeLimit(inert, 1_234), 1_234);
});
