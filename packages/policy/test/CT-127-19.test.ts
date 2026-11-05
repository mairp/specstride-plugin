/**
 * CT-127-19 (T037) — the characterization test of the THREE BLOCKED REASONS
 * and their STOP REASONS and EXIT CODES (F127-FR-017).
 *
 * The three values of each reason are compared with feature 100's own table of
 * annex E §E.2 (`@specstride/contracts/state/blocked-reasons`), read fresh in
 * this test, so neither the implementation nor the test can restate them
 * wrongly: `proposer_consecutive_errors` with 4 for `quota-credit` and `auth`,
 * `wall_budget` with 4 for `budget-cap`, each with `retryable: false`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { STOP_REASONS } from "@specstride/contracts/codes/stop-reasons";
import {
  BLOCKED_REASONS,
  blockedReasonRow,
  engineExitOf,
  mayRelaunch,
  stopReasonOf,
} from "@specstride/contracts/state/blocked-reasons";
import { CLASSES_THAT_BLOCK_ON_A_HUMAN } from "@specstride/contracts/ep/quota-classifier";
import {
  AUTH_TAKES_NO_FALLBACK,
  BLOCKED_STATE,
  BLOCKED_TRANSITION,
  BlockedCaseError,
  CREDIT_BLOCKS_WHEN_NO_FALLBACK_REMAINS,
  NEEDS,
  QUOTA_BLOCKED_REASONS,
  WALL_CLOCK_IS_NOT_BLOCKED,
  blockOnAHuman,
  reasonForClass,
  terminalOf,
  terminals,
  wallClockTrip,
} from "../src/quota/blocked.ts";
import { actionFor } from "../src/quota/actions.ts";
import { testPorts } from "./support/index.ts";

/** The one redactor of the product, as the composition root hands it over. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

/** §E.2, transcribed: the stop reason and the exit code of each of the three. */
const SECTION_E2 = Object.freeze({
  "quota-credit": { stopReason: "proposer_consecutive_errors", exitCode: 4, retryable: false },
  auth: { stopReason: "proposer_consecutive_errors", exitCode: 4, retryable: false },
  "budget-cap": { stopReason: "wall_budget", exitCode: 4, retryable: false },
});

test("CT-127-19: the three blocked reasons of this feature are members of §E.2", () => {
  assert.deepEqual([...QUOTA_BLOCKED_REASONS], ["quota-credit", "auth", "budget-cap"]);
  for (const reason of QUOTA_BLOCKED_REASONS) {
    assert.ok(
      (BLOCKED_REASONS as readonly string[]).includes(reason),
      `${reason} is a member of the closed set of annex E §E.2`,
    );
  }
  assert.deepEqual([...CLASSES_THAT_BLOCK_ON_A_HUMAN], ["quota_credit", "auth", "budget_cap"]);
});

test("CT-127-19: each reason carries the stop reason and the exit code of §E.2", () => {
  for (const reason of QUOTA_BLOCKED_REASONS) {
    const terminal = terminalOf(reason);
    const expected = SECTION_E2[reason];
    assert.equal(terminal.stopReason, expected.stopReason, `the stop reason of ${reason}`);
    assert.equal(terminal.exitCode, expected.exitCode, `the exit code of ${reason}`);
    assert.equal(terminal.retryable, false, `${reason} is not retryable`);

    // And feature 100's own table says the same.
    assert.equal(stopReasonOf(reason), expected.stopReason);
    assert.equal(engineExitOf(reason), expected.exitCode);
    assert.equal(blockedReasonRow(reason)?.retryable, false);
    assert.ok(
      (STOP_REASONS as readonly string[]).includes(terminal.stopReason),
      "the stop reason is a member of annex E §E.3",
    );
  }
  assert.equal(Object.keys(terminals()).length, 3);
});

test("CT-127-19: `quota-credit` blocks, and says in one line to add credit", () => {
  const ports = testPorts();
  const outcome = blockOnAHuman(
    ports.eventWriter,
    { reason: "quota-credit", role: "proposer", fallbackRemains: false },
    { redact: fakeRedact },
  );
  assert.equal(outcome.state, "blocked-on-human");
  assert.equal(outcome.state, BLOCKED_STATE);
  assert.equal(outcome.transition, "T9");
  assert.equal(outcome.transition, BLOCKED_TRANSITION);
  assert.equal(outcome.terminal.stopReason, "proposer_consecutive_errors");
  assert.equal(outcome.terminal.exitCode, 4);
  assert.equal(outcome.terminal.retryable, false);

  assert.deepEqual(ports.eventWriter.types(), ["blocked"]);
  const payload = ports.eventWriter.of("blocked")[0].payload;
  assert.equal(payload.reason, "quota-credit");
  assert.equal(payload.needs, NEEDS["quota-credit"]);
  assert.ok(String(payload.needs).includes("add credit"), "it says what to do");
  assert.equal(String(payload.needs).includes("\n"), false, "in one line");
});

test("CT-127-19: `auth` blocks, and says in one line to repair the login", () => {
  const ports = testPorts();
  const outcome = blockOnAHuman(
    ports.eventWriter,
    { reason: "auth", role: "critic" },
    { redact: fakeRedact },
  );
  assert.equal(outcome.terminal.stopReason, "proposer_consecutive_errors");
  assert.equal(outcome.terminal.exitCode, 4);
  const payload = ports.eventWriter.of("blocked")[0].payload;
  assert.equal(payload.reason, "auth");
  assert.ok(String(payload.needs).includes("repair the login"));
  assert.equal(AUTH_TAKES_NO_FALLBACK, true, "no retry and no fallback (§Q.1)");
  assert.equal(actionFor("auth").action, "blocked-on-human");
});

test("CT-127-19: `budget-cap` blocks, and says in one line to raise the cap", () => {
  const ports = testPorts();
  const outcome = blockOnAHuman(
    ports.eventWriter,
    { reason: "budget-cap", role: "proposer", ceilingKey: "budget.role.proposer.costUsd" },
    { redact: fakeRedact },
  );
  assert.equal(outcome.terminal.stopReason, "wall_budget", "the stop reason of §E.2 for the cap");
  assert.equal(outcome.terminal.exitCode, 4);
  assert.equal(outcome.terminal.retryable, false);
  const payload = ports.eventWriter.of("blocked")[0].payload;
  assert.equal(payload.reason, "budget-cap");
  assert.ok(String(payload.needs).includes("raise the cap"));
  assert.ok(
    String(payload.needs).includes("budget.role.proposer.costUsd"),
    "and names the ceiling that was reached",
  );
});

test("CT-127-19: every blocked run releases the lock, ends, and is never relaunched", () => {
  for (const reason of QUOTA_BLOCKED_REASONS) {
    const ports = testPorts();
    const outcome = blockOnAHuman(ports.eventWriter, { reason }, { redact: fakeRedact });
    assert.equal(outcome.releasesTheLock, true, `${reason} releases the lock`);
    assert.equal(outcome.ends, true, `${reason} ends`);
    assert.equal(outcome.relaunched, false, `${reason} is not relaunched`);
    assert.equal(mayRelaunch(reason, "relaunch-observe"), false);
    assert.equal(mayRelaunch(reason, "relaunch-root"), false);
  }
});

test("CT-127-19: `quota-credit` with a fallback entry left is refused: the engine switches instead", () => {
  const ports = testPorts();
  assert.equal(CREDIT_BLOCKS_WHEN_NO_FALLBACK_REMAINS, true);
  assert.throws(
    () =>
      blockOnAHuman(
        ports.eventWriter,
        { reason: "quota-credit", role: "proposer", fallbackRemains: true },
        { redact: fakeRedact },
      ),
    BlockedCaseError,
    "F127-FR-017 blocks only when no fallback entry remains",
  );
  assert.deepEqual(ports.eventWriter.types(), [], "and no `blocked` event was written");
});

test("CT-127-19: the class of each reason is the one §Q.1 names", () => {
  assert.equal(reasonForClass("quota_credit"), "quota-credit");
  assert.equal(reasonForClass("auth"), "auth");
  assert.equal(reasonForClass("budget_cap"), "budget-cap");
  assert.equal(reasonForClass("quota_window"), null, "a window is a pause, not a block");
  assert.equal(reasonForClass("provider_other"), null);
});

test("CT-127-19: a tripped wall-clock budget is NOT among the blocked cases", () => {
  const trip = wallClockTrip();
  assert.equal(trip.stopReason, "wall_budget");
  assert.equal(trip.exitCode, 4);
  assert.equal(trip.retryable, true, "retryable, unlike every blocked reason (F127-FR-027)");
  assert.equal(trip.blockedReason, null, "and it carries no blocked reason");
  assert.deepEqual(WALL_CLOCK_IS_NOT_BLOCKED, trip);
  // The hard cap of spend shares the stop reason, and differs in both other values.
  assert.equal(terminalOf("budget-cap").stopReason, trip.stopReason);
  assert.notEqual(terminalOf("budget-cap").retryable, trip.retryable);
  assert.notEqual(terminalOf("budget-cap").blockedReason, trip.blockedReason);
});

test("CT-127-19: a reason outside §E.2 is refused", () => {
  assert.throws(() => terminalOf("not-a-reason" as never), BlockedCaseError);
});

test("CT-127-19 (checkpoint): the block reads no clock and writes no file", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  blockOnAHuman(ports.eventWriter, { reason: "auth" }, { redact: fakeRedact });
  assert.equal(ports.clock.nowMs(), before);
  assert.deepEqual(ports.fileWriter.writes, [], "the terminal record is written by the engine");
});
