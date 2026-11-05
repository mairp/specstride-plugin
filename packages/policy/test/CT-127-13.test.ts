/**
 * CT-127-13 (T026) — the characterization test of the SIX COUNTS UNCHANGED,
 * and of a LIMITED CRITIC with the MALFORMED streak unchanged (F127-FR-011).
 *
 * Acceptance scenario 5 of user story 1: given the critic is limited before it
 * returned a parseable verdict, when the engine reads the class, then the same
 * state applies and the MALFORMED streak is unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { A_QUOTA_CLASS_SPENDS } from "@specstride/contracts/ep/quota-classifier";
import {
  A_PAUSE_SPENDS,
  CRITIC_CALL_OUTCOME,
  PauseRecordError,
  THE_SIX_COUNTS_OF_A_RUN,
  countsAfterAPause,
  criticCallPaused,
  enterPause,
  type RunCounts,
  type EnterPauseInput,
} from "../src/quota/pause.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { classify } from "../src/quota/classify.ts";
import { actionFor } from "../src/quota/actions.ts";
import { emptyLedger } from "../src/budget/ledger.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const SINCE = new Date(DEFAULT_START_MS).toISOString();
const CEILING_AT = new Date(DEFAULT_START_MS + 24 * 60 * 60 * 1000).toISOString();

/** The counts as a run that has done some work holds them. */
const BEFORE: RunCounts = Object.freeze({
  rejects: 2,
  passes: 7,
  malformedStreak: 1,
  errors: 1,
  wallClockMs: 1_234_567,
  relaunches: 3,
});

function input(overrides: Partial<EnterPauseInput> = {}): EnterPauseInput {
  return {
    runId: "run-1",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification: classify({ structuredClass: "quota_window" }),
    since: SINCE,
    resumeAt: null,
    ceilingAt: CEILING_AT,
    recordPath: ".specstride/runs/run-1/pause.record",
    counts: BEFORE,
    ...overrides,
  };
}

test("CT-127-13: the six counts are the six of F127-FR-011", () => {
  assert.deepEqual(
    [...THE_SIX_COUNTS_OF_A_RUN],
    ["rejects", "passes", "malformedStreak", "errors", "wallClockMs", "relaunches"],
  );
  assert.equal(THE_SIX_COUNTS_OF_A_RUN.length, 6);
  // EP-12's own statement: a quota class spends none of them.
  assert.deepEqual(A_PAUSE_SPENDS, A_QUOTA_CLASS_SPENDS);
  for (const [what, spends] of Object.entries(A_PAUSE_SPENDS)) {
    assert.equal(spends, false, `a pause spends no ${what}`);
  }
});

test("CT-127-13: the six counts are unchanged by a pause", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.ok(entry.counts !== null);
  assert.deepEqual(entry.counts, BEFORE, "every one of the six is where it was");
  for (const name of THE_SIX_COUNTS_OF_A_RUN) {
    assert.equal(entry.counts[name], BEFORE[name], `${name} is unchanged (F127-FR-011)`);
  }
  assert.deepEqual(countsAfterAPause(BEFORE), BEFORE);
});

test("CT-127-13: the six counts are unchanged by many pauses in a row", () => {
  let counts = BEFORE;
  for (let pause = 0; pause < 20; pause += 1) counts = countsAfterAPause(counts);
  assert.deepEqual(counts, BEFORE, "twenty pauses cost nothing");
});

test("CT-127-13: the phase attempt is not counted as a rejection", () => {
  const ports = testPorts();
  const entry = enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(entry.passEnded.countedAsARejection, false);
  assert.equal(entry.counts?.rejects, BEFORE.rejects, "the reject count did not move");
  assert.equal(entry.passEnded.attemptStaysOpen, true, "the attempt is still open");
});

test("CT-127-13: the class of a pause counts as neither an error nor a rejection", () => {
  const decision = actionFor("quota_window");
  assert.equal(decision.countsAs, "neither", "§Q.1, the column `Counts as`");
  assert.equal(decision.spends, "no", "§Q.1, the column of the six");
  assert.equal(decision.countsAsAConsecutiveError, false);
  assert.equal(decision.spendsNothing, true);
});

test("CT-127-13: a pause spends no phase attempt of the ledger", () => {
  // The ledger counts phase attempts STARTED; a pause starts none.
  const ledger = emptyLedger("run-1");
  assert.equal(ledger.run.phaseAttempts, 0);
  const ports = testPorts();
  enterPause(ports, input(), PAIR_CLOSED);
  assert.equal(ledger.run.phaseAttempts, 0, "the pause touched no counter of the ledger");
});

/* ---------------------------------------------------------------- *
 * The limited critic.
 * ---------------------------------------------------------------- */

test("CT-127-13: a limited critic ends with the outcome `quota_pause`", () => {
  const paused = criticCallPaused(
    { malformedStreak: 2, criticUnavailable: 1 },
    { limitedCallNonce: "nonce-1", nextNonce: "nonce-2" },
  );
  assert.equal(paused.outcome, "quota_pause");
  assert.equal(paused.outcome, CRITIC_CALL_OUTCOME);
  assert.equal(paused.countsAsMalformed, false, "a limited critic is not a MALFORMED verdict");
});

test("CT-127-13: the MALFORMED streak and `critic_unavailable` are unchanged", () => {
  for (const malformedStreak of [0, 1, 2, 9]) {
    const paused = criticCallPaused(
      { malformedStreak, criticUnavailable: 4 },
      { limitedCallNonce: "nonce-1", nextNonce: "nonce-2" },
    );
    assert.equal(paused.malformedStreak, malformedStreak, "the streak is unchanged (F127-FR-011)");
    assert.equal(paused.criticUnavailable, 4, "and so is `critic_unavailable`");
  }
});

test("CT-127-13: the critic call is made again with a NEW nonce after the resume", () => {
  const paused = criticCallPaused(
    { malformedStreak: 1, criticUnavailable: 0 },
    { limitedCallNonce: "nonce-1", nextNonce: "nonce-2" },
  );
  assert.equal(paused.callMadeAgainAfterTheResume, true);
  assert.equal(paused.nextNonce, "nonce-2");
  assert.throws(
    () =>
      criticCallPaused(
        { malformedStreak: 1, criticUnavailable: 0 },
        { limitedCallNonce: "nonce-1", nextNonce: "nonce-1" },
      ),
    PauseRecordError,
    "the same nonce is refused: the call after a pause takes a new one",
  );
});

test("CT-127-13: a limited critic is the SAME state, with its own record and events", () => {
  const ports = testPorts();
  const entry = enterPause(
    ports,
    input({ role: "critic", classification: classify({ structuredClass: "quota_window" }) }),
    PAIR_CLOSED,
  );
  assert.equal(entry.state, "paused-quota", "the same state as a limited proposer (F127-FR-011)");
  assert.equal(entry.record.role, "critic");
  assert.deepEqual(ports.eventWriter.types(), ["quota.signal", "run.paused"]);
  assert.deepEqual(entry.counts, BEFORE, "and the six counts are still unchanged");
});

test("CT-127-13 (checkpoint): nothing of the critic pause reads a clock", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  criticCallPaused(
    { malformedStreak: 0, criticUnavailable: 0 },
    { limitedCallNonce: "a", nextNonce: "b" },
  );
  assert.equal(ports.clock.nowMs(), before);
});
