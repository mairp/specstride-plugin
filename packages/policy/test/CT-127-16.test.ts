/**
 * CT-127-16 (T032) — the characterization test of the CEILING OF 24 HOURS and
 * of a RESUMED CALL THAT IS LIMITED AGAIN (F127-FR-014).
 *
 * Acceptance scenario 4 of user story 1: given a pause that reaches its
 * ceiling of 24 hours, when the ceiling passes, then the run rests in
 * `blocked-on-human` with the stop reason `paused_quota_ceiling` and exit 4.
 *
 * And decision D-3 (CQ-129): a resumed call that is limited again continues
 * the SAME episode, so the 24 hours are not restarted.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { STOP_REASONS } from "@specstride/contracts/codes/stop-reasons";
import { blockedReasonRow } from "@specstride/contracts/state/blocked-reasons";
import {
  CEILING_BLOCKED_REASON,
  CEILING_NEEDS,
  CEILING_STOP_REASON,
  CEILING_TRANSITION,
  DEFAULT_MAX_TOTAL_MS,
  EXIT_CODE_FROM_THE_TABLE,
  MAX_TOTAL_KEY,
  STATE_AT_THE_CEILING,
  STOP_REASON_FROM_THE_TABLE,
  atTheCeiling,
  ceilingAtOf,
  ceilingReached,
  ceilingReachedByRecord,
  ceilingTerminal,
  endEpisodeOnASuccess,
  remainingCeilingMs,
  startOrContinueEpisode,
} from "../src/quota/ceiling.ts";
import { enterPause, type EnterPauseInput } from "../src/quota/pause.ts";
import { classify } from "../src/quota/classify.ts";
import { PAIR_CLOSED } from "../src/quota/events.ts";
import { emptyLedger } from "../src/budget/ledger.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

/**
 * The one redactor of the product, as the composition root hands it to the
 * emitters. `needs` is a free-text field of `blocked`, so with no redactor
 * handed in it is dropped fail-closed (F127-FR-040, F100-FR-205); the last
 * assertion of the event test shows that too.
 */
const fakeRedact = (text: string, cap: number) => ({
  text: text.slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

const DAY = 24 * 60 * 60 * 1000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;

test("CT-127-16: the ceiling is `pause.maxTotalMs`, 24 hours by default", () => {
  assert.equal(MAX_TOTAL_KEY, "pause.maxTotalMs");
  assert.equal(DEFAULT_MAX_TOTAL_MS, DAY);
  assert.equal(DEFAULT_MAX_TOTAL_MS, 86_400_000, "24 hours (F127-FR-014)");
});

test("CT-127-16: the episode starts at the first pause and its ceiling is 24 hours later", () => {
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  assert.equal(episode.continued, false, "the first pause starts the episode");
  assert.equal(episode.startedAtMs, DEFAULT_START_MS);
  assert.equal(episode.ceilingAtMs, DEFAULT_START_MS + DAY);
  assert.equal(episode.maxTotalMs, DAY);
  assert.equal(ceilingAtOf(episode), new Date(DEFAULT_START_MS + DAY).toISOString());
});

test("CT-127-16: the consumer can set the ceiling lower", () => {
  const episode = startOrContinueEpisode({
    episodeStart: null,
    nowMs: DEFAULT_START_MS,
    maxTotalMs: 60 * 60 * 1000,
  });
  assert.equal(episode.maxTotalMs, 60 * 60 * 1000);
  assert.equal(episode.ceilingAtMs, DEFAULT_START_MS + 60 * 60 * 1000);
  // A figure of 0 or one that is not finite is no ceiling at all: the default stands.
  assert.equal(
    startOrContinueEpisode({ episodeStart: null, nowMs: 0, maxTotalMs: 0 }).maxTotalMs,
    DAY,
  );
  assert.equal(
    startOrContinueEpisode({ episodeStart: null, nowMs: 0, maxTotalMs: Number.NaN }).maxTotalMs,
    DAY,
  );
});

test("CT-127-16: the ceiling is not reached before 24 hours, and is reached at them", () => {
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  assert.equal(ceilingReached(episode, DEFAULT_START_MS), false);
  assert.equal(ceilingReached(episode, DEFAULT_START_MS + DAY - 1), false, "one millisecond short");
  assert.equal(remainingCeilingMs(episode, DEFAULT_START_MS + DAY - 1), 1);
  assert.equal(ceilingReached(episode, DEFAULT_START_MS + DAY), true, "at the ceiling");
  assert.equal(ceilingReached(episode, DEFAULT_START_MS + DAY + 1), true);
  assert.equal(remainingCeilingMs(episode, DEFAULT_START_MS + DAY + 1), 0);
});

test("CT-127-16: on a fake clock a pause of 24 hours reaches the ceiling", async () => {
  const ports = testPorts();
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: ports.clock.nowMs() });
  await ports.sleep.sleep(DAY);
  assert.equal(
    ceilingReached(episode, ports.clock.nowMs()),
    true,
    "and the test took microseconds",
  );
});

/* ---------------------------------------------------------------- *
 * What happens at the ceiling.
 * ---------------------------------------------------------------- */

test("CT-127-16: at the ceiling the run rests in `blocked-on-human`, by transition T8", () => {
  const ports = testPorts();
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  const outcome = atTheCeiling(ports.eventWriter, {
    episode,
    role: "proposer",
    nowMs: DEFAULT_START_MS + DAY,
  });
  assert.equal(outcome.state, "blocked-on-human");
  assert.equal(outcome.state, STATE_AT_THE_CEILING);
  assert.equal(outcome.transition, "T8");
  assert.equal(outcome.transition, CEILING_TRANSITION);
  assert.equal(outcome.releasesTheLock, true, "the lock is released");
  assert.equal(outcome.ends, true, "and the run ends");
  assert.equal(outcome.relaunched, false, "neither relaunch classifier table relaunches it");
});

test("CT-127-16: the event `blocked` carries the reason `quota-wait-ceiling` and the one-line need", () => {
  const ports = testPorts();
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  const outcome = atTheCeiling(
    ports.eventWriter,
    { episode, role: "proposer", nowMs: DEFAULT_START_MS + DAY },
    { redact: fakeRedact },
  );
  assert.deepEqual(ports.eventWriter.types(), ["blocked"]);
  const payload = ports.eventWriter.of("blocked")[0].payload;
  assert.equal(payload.reason, "quota-wait-ceiling");
  assert.equal(payload.reason, CEILING_BLOCKED_REASON);
  assert.equal(payload.needs, CEILING_NEEDS);
  assert.equal(outcome.needs, CEILING_NEEDS, "and the outcome carries it for the CLI to print");
  assert.ok(String(payload.needs).includes("pause.maxTotalMs"), "it says what to do, in one line");
  assert.equal(String(payload.needs).includes("\n"), false, "one line");

  // With no redactor handed in, the free-text field is dropped and never
  // carried in the clear (F127-FR-040, F100-FR-205).
  const bare = testPorts();
  atTheCeiling(bare.eventWriter, { episode, role: "proposer", nowMs: DEFAULT_START_MS + DAY });
  assert.equal(bare.eventWriter.of("blocked")[0].payload.needs, "[dropped: redactor-unavailable]");
});

test("CT-127-16: the terminal record is `paused_quota_ceiling`, exit 4, `retryable: false`", () => {
  const terminal = ceilingTerminal();
  assert.equal(terminal.stopReason, "paused_quota_ceiling");
  assert.equal(terminal.stopReason, CEILING_STOP_REASON);
  assert.equal(terminal.exitCode, 4);
  assert.equal(terminal.retryable, false);
  assert.equal(terminal.blockedReason, "quota-wait-ceiling");

  // And the three values are feature 100's own, from annex E §E.2.
  const row = blockedReasonRow("quota-wait-ceiling");
  assert.ok(row !== undefined);
  assert.equal(row.stopReason, "paused_quota_ceiling");
  assert.equal(row.engineExit, 4);
  assert.equal(row.retryable, false);
  assert.equal(STOP_REASON_FROM_THE_TABLE, "paused_quota_ceiling");
  assert.equal(EXIT_CODE_FROM_THE_TABLE, 4);
  assert.ok(
    (STOP_REASONS as readonly string[]).includes("paused_quota_ceiling"),
    "a member of the closed set of annex E §E.3",
  );
});

/* ---------------------------------------------------------------- *
 * A resumed call that is limited again.
 * ---------------------------------------------------------------- */

test("CT-127-16: a resumed call that is limited again CONTINUES the same episode", () => {
  // The first pause, at midnight.
  const first = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  assert.equal(first.continued, false);

  // The run resumes at five hours, is limited again at five hours and a minute.
  const again = startOrContinueEpisode({
    episodeStart: first.startedAt,
    nowMs: DEFAULT_START_MS + FIVE_HOURS + 60_000,
  });
  assert.equal(again.continued, true, "the same episode (decision D-3, CQ-129)");
  assert.equal(again.startedAtMs, first.startedAtMs, "its start did not move");
  assert.equal(again.ceilingAtMs, first.ceilingAtMs, "so the 24 hours were NOT restarted");

  // And a third pause, much later, is still the same episode.
  const third = startOrContinueEpisode({
    episodeStart: first.startedAt,
    nowMs: DEFAULT_START_MS + 20 * 60 * 60 * 1000,
  });
  assert.equal(third.ceilingAtMs, first.ceilingAtMs);
  assert.equal(
    remainingCeilingMs(third, DEFAULT_START_MS + 20 * 60 * 60 * 1000),
    4 * 60 * 60 * 1000,
  );
});

test("CT-127-16: five pauses of five hours reach the ceiling of the episode", async () => {
  const ports = testPorts();
  let episodeStart: string | null = null;
  let episode = startOrContinueEpisode({ episodeStart, nowMs: ports.clock.nowMs() });
  for (let round = 0; round < 5; round += 1) {
    episode = startOrContinueEpisode({ episodeStart, nowMs: ports.clock.nowMs() });
    episodeStart = episode.startedAt;
    await ports.sleep.sleep(FIVE_HOURS);
  }
  assert.equal(episode.continued, true, "one episode across all five pauses");
  assert.equal(
    ceilingReached(episode, ports.clock.nowMs()),
    true,
    "25 hours of pause reached the ceiling of 24 (F127-FR-014)",
  );
  const outcome = atTheCeiling(ports.eventWriter, {
    episode,
    role: "proposer",
    nowMs: ports.clock.nowMs(),
  });
  assert.equal(outcome.terminal.stopReason, "paused_quota_ceiling");
  assert.equal(outcome.terminal.exitCode, 4);
});

test("CT-127-16: the episode ends when a model call of the role succeeds", () => {
  assert.deepEqual(endEpisodeOnASuccess(), { episodeStart: null });
  // The next pause then starts a fresh 24 hours.
  const fresh = startOrContinueEpisode({
    episodeStart: endEpisodeOnASuccess().episodeStart,
    nowMs: DEFAULT_START_MS + 30 * 60 * 60 * 1000,
  });
  assert.equal(fresh.continued, false);
  assert.equal(fresh.ceilingAtMs, DEFAULT_START_MS + 30 * 60 * 60 * 1000 + DAY);
});

test("CT-127-16: the episode's start lives in the ledger, because the record is removed at a resume", () => {
  const ledger = emptyLedger("run-1");
  assert.equal(ledger.windows.episodeStart, null, "the field the ledger holds (annex B §B.20)");
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: DEFAULT_START_MS });
  const kept = { ...ledger, windows: { ...ledger.windows, episodeStart: episode.startedAt } };
  const again = startOrContinueEpisode({
    episodeStart: kept.windows.episodeStart,
    nowMs: DEFAULT_START_MS + FIVE_HOURS,
  });
  assert.equal(again.continued, true);
});

test("CT-127-16: the pause record's `ceilingAt` is the episode's ceiling, and is read back", () => {
  const ports = testPorts();
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: ports.clock.nowMs() });
  const input: EnterPauseInput = {
    runId: "run-1",
    attemptId: "p1-a1",
    role: "proposer",
    harness: "stub-harness",
    classification: classify({ structuredClass: "quota_window" }),
    since: ports.clock.nowIso(),
    resumeAt: null,
    ceilingAt: ceilingAtOf(episode),
    recordPath: ".specstride/runs/run-1/pause.record",
  };
  const entry = enterPause(ports, input, PAIR_CLOSED);
  assert.equal(entry.record.ceilingAt, episode.ceilingAt);
  assert.equal(ceilingReachedByRecord(entry.record, DEFAULT_START_MS + DAY - 1), false);
  assert.equal(ceilingReachedByRecord(entry.record, DEFAULT_START_MS + DAY), true);
});

test("CT-127-16 (checkpoint): the ceiling is computed with no clock of its own", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const episode = startOrContinueEpisode({ episodeStart: null, nowMs: before });
  ceilingReached(episode, before + DAY);
  assert.equal(ports.clock.nowMs(), before, "`now` is an argument");
});
