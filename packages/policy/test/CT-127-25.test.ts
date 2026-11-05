/**
 * CT-127-25 (T050) — the characterization test of the RETURN, `stay`, and
 * EVERY ENTRY LIMITED (F127-FR-023).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FALLBACK_RETURN,
  EVERY_USAGE_RECORD_CARRIES,
  EXHAUSTION_PAUSE_CLASS,
  EXHAUSTION_PAUSE_REASON,
  FALLBACK_RETURN_MODES,
  RETURN_AT,
  UsageRecordFactsError,
  assertEntryFacts,
  earliestResetOf,
  exhaustionDecision,
  missingEntryFacts,
  readFallbackReturn,
  recordOfEntry,
  restorePrimary,
  returnDecision,
} from "../src/budget/fallback-return.ts";
import { entryOf, walkFallback, type RolePlan } from "../src/budget/fallback.ts";
import { PAUSE_STATE } from "../src/quota/pause.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const NOW = DEFAULT_START_MS;
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const PRIMARY = entryOf(0, {
  harness: "stub-harness",
  model: "stub-base",
  billingMode: "subscription",
  provider: "stub-provider",
});
const FALLBACK = entryOf(1, {
  harness: "stub-api",
  model: "stub-metered",
  billingMode: "api",
  capUsd: 25,
  provider: "metered-provider",
});

function planOf(entries: readonly ReturnType<typeof entryOf>[]): RolePlan {
  return {
    role: "proposer",
    primary: PRIMARY,
    entries,
    resolvedHarnesses: ["stub-harness", "stub-api", "stub-api-two"],
  };
}

test("CT-127-25: the two modes, and `restore` is the default", () => {
  assert.deepEqual([...FALLBACK_RETURN_MODES], ["restore", "stay"]);
  assert.equal(DEFAULT_FALLBACK_RETURN, "restore");
  assert.equal(readFallbackReturn(undefined), "restore");
  assert.equal(readFallbackReturn(null), "restore");
  assert.equal(readFallbackReturn("stay"), "stay");
  assert.equal(readFallbackReturn("restore"), "restore");
  assert.equal(readFallbackReturn("something-else"), "restore", "an unknown value is the default");
  assert.equal(RETURN_AT, "phase-attempt-boundary");
});

test("CT-127-25: the role RETURNS at the first boundary after the primary's reset has passed", () => {
  const reset = iso(NOW + HOUR);
  const decision = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: reset,
    nowMs: NOW + HOUR + 1,
    atBoundary: true,
  });
  assert.equal(decision.act, "restore");
  assert.equal(decision.reason, "reset-passed-at-a-boundary");
  assert.equal(decision.entry.harness, "stub-harness", "back to the primary");
  assert.equal(decision.mode, "restore");
});

test("CT-127-25: before the reset, and between boundaries, it waits", () => {
  const reset = iso(NOW + HOUR);
  const early = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: reset,
    nowMs: NOW,
    atBoundary: true,
  });
  assert.equal(early.act, "wait");
  assert.equal(early.reason, "reset-not-passed");

  const noBoundary = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: reset,
    nowMs: NOW + 2 * HOUR,
    atBoundary: false,
  });
  assert.equal(noBoundary.act, "wait");
  assert.equal(noBoundary.reason, "no-boundary-yet");
  assert.equal(noBoundary.entry.harness, "stub-api", "the phase attempt keeps its entry");
});

test("CT-127-25: an unknown reset time waits", () => {
  const decision = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: null,
    nowMs: NOW + 10 * HOUR,
    atBoundary: true,
  });
  assert.equal(decision.act, "wait");
  assert.equal(decision.reason, "reset-unknown");
});

test("CT-127-25: `stay` keeps the entry and asks nothing else", () => {
  const decision = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: iso(NOW - HOUR),
    nowMs: NOW,
    atBoundary: true,
    mode: "stay",
  });
  assert.equal(decision.act, "stay");
  assert.equal(decision.reason, "stay-configured");
  assert.equal(decision.mode, "stay");
  assert.equal(decision.entry.harness, "stub-api", "it keeps the fallback entry");
});

test("CT-127-25: a role that never switched has nothing to return to", () => {
  const decision = returnDecision({
    primary: PRIMARY,
    current: PRIMARY,
    primaryResetsAt: iso(NOW - HOUR),
    nowMs: NOW,
    atBoundary: true,
  });
  assert.equal(decision.act, "stay");
  assert.equal(decision.reason, "not-on-a-fallback");
});

test("CT-127-25: `fallback.restored` is written on a return, and nothing on `stay`", () => {
  const ports = testPorts();
  const event = restorePrimary(ports.eventWriter, {
    role: "proposer",
    from: FALLBACK,
    to: PRIMARY,
    phaseAttempt: "phase-5/attempt-1",
  });
  assert.deepEqual([...ports.eventWriter.types()], ["fallback.restored"]);
  assert.equal(event.payload.from, "stub-api/stub-metered");
  assert.equal(event.payload.to, "stub-harness/stub-base");
  assert.equal(event.payload.role, "proposer");
  assert.equal(event.payload.phaseAttempt, "phase-5/attempt-1");
  assert.equal(event.payload.billingModeFrom, "api");
  assert.equal(event.payload.billingModeTo, "subscription");
  assert.equal(event.payload.at, "phase-attempt-boundary");

  // `stay` writes nothing: the caller never reaches `restorePrimary`.
  const second = testPorts();
  const stay = returnDecision({
    primary: PRIMARY,
    current: FALLBACK,
    primaryResetsAt: iso(NOW - HOUR),
    nowMs: NOW,
    atBoundary: true,
    mode: "stay",
  });
  if (stay.act === "restore")
    restorePrimary(second.eventWriter, {
      role: "proposer",
      from: FALLBACK,
      to: PRIMARY,
      phaseAttempt: "p",
    });
  assert.deepEqual([...second.eventWriter.types()], []);
});

test("CT-127-25: EVERY ENTRY LIMITED — the role pauses until the earliest reset", () => {
  const limitedOne = entryOf(1, {
    harness: "stub-api",
    billingMode: "api",
    capUsd: 25,
    resetsAt: iso(NOW + 5 * HOUR),
  });
  const limitedTwo = entryOf(2, {
    harness: "stub-api-two",
    billingMode: "api",
    capUsd: 25,
    resetsAt: iso(NOW + 2 * HOUR),
  });
  const ports = testPorts();
  const walk = walkFallback(planOf([limitedOne, limitedTwo]), [() => "limited"], {
    writer: ports.eventWriter,
  });
  assert.equal(walk.chosen, null);
  assert.equal(walk.exhausted, true);
  assert.equal(walk.skipped.length, 2);
  assert.deepEqual(
    walk.skipped.map((skip) => skip.reason),
    ["limited", "limited"],
  );
  assert.equal(ports.eventWriter.countOf("fallback.skipped"), 2);

  const decision = exhaustionDecision({
    primary: PRIMARY,
    walk,
    nowMs: NOW,
    primaryResetsAt: iso(NOW + 3 * HOUR),
  });
  assert.equal(decision.pause, true);
  assert.equal(decision.reason, EXHAUSTION_PAUSE_REASON);
  assert.equal(
    decision.earliestResetAt,
    iso(NOW + 2 * HOUR),
    "the earliest reset among the primary and the entries",
  );
  assert.equal(decision.waitMs, 2 * HOUR);
  assert.equal(EXHAUSTION_PAUSE_CLASS, "quota_window");
  assert.equal(PAUSE_STATE, "paused-quota", "it is the quota pause of US1");
});

test("CT-127-25: a walk that chose an entry raises no exhaustion pause", () => {
  const walk = walkFallback(planOf([FALLBACK]), [], {});
  assert.equal(walk.exhausted, false);
  const decision = exhaustionDecision({ primary: PRIMARY, walk, nowMs: NOW });
  assert.equal(decision.pause, false);
  assert.equal(decision.reason, null);
  assert.equal(decision.waitMs, 0);
});

test("CT-127-25: with no reset time anywhere the pause has none either", () => {
  const walk = walkFallback(planOf([FALLBACK]), [() => "limited"], {});
  const decision = exhaustionDecision({
    primary: PRIMARY,
    walk,
    nowMs: NOW,
    primaryResetsAt: null,
  });
  assert.equal(decision.pause, true);
  assert.equal(decision.earliestResetAt, null, "the unknown-reset pause of F127-FR-013 probes");
  assert.equal(decision.waitMs, 0);
});

test("CT-127-25: the earliest reset ignores an entry with none, and an unreadable one", () => {
  assert.equal(earliestResetOf([]), null);
  assert.equal(
    earliestResetOf([
      entryOf(0, { harness: "a", resetsAt: null }),
      entryOf(1, { harness: "b", resetsAt: iso(NOW + HOUR) }),
      entryOf(2, { harness: "c", resetsAt: "not-a-time" }),
      entryOf(3, { harness: "d", resetsAt: iso(NOW + 3 * HOUR) }),
    ]),
    iso(NOW + HOUR),
  );
});

test("CT-127-25: a reset already in the past waits not at all", () => {
  const walk = walkFallback(
    planOf([entryOf(1, { harness: "stub-api", resetsAt: iso(NOW - HOUR) })]),
    [() => "limited"],
    {},
  );
  const decision = exhaustionDecision({
    primary: PRIMARY,
    walk,
    nowMs: NOW,
    primaryResetsAt: null,
  });
  assert.equal(decision.waitMs, 0);
  assert.equal(decision.earliestResetAt, iso(NOW - HOUR));
});

test("CT-127-25: every usage record carries the harness, the provider and the billing mode", () => {
  assert.deepEqual([...EVERY_USAGE_RECORD_CARRIES], ["harness", "provider", "billingMode"]);
  const stamped = recordOfEntry({ usageId: "u-1", role: "proposer" }, FALLBACK);
  assert.equal(stamped.harness, "stub-api");
  assert.equal(stamped.provider, "metered-provider");
  assert.equal(stamped.billingMode, "api");
  assert.deepEqual([...missingEntryFacts(stamped)], []);
  assert.doesNotThrow(() => assertEntryFacts(stamped));
});

test("CT-127-25: a record that does not name its entry is refused", () => {
  assert.deepEqual(
    [...missingEntryFacts({ usageId: "u", role: "r" })],
    ["harness", "provider", "billingMode"],
  );
  assert.throws(() => assertEntryFacts({ usageId: "u", role: "r" }), UsageRecordFactsError);
  assert.throws(() => assertEntryFacts({ usageId: "u", role: "r" }), /spend per fallback entry/);
  // One missing fact is enough.
  assert.deepEqual(
    [...missingEntryFacts({ usageId: "u", role: "r", harness: "h", billingMode: "api" })],
    ["provider"],
  );
});
