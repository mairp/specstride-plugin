/**
 * CT-127-9 (T021) — the characterization test of a HOST EVENT: it informs, it
 * never pauses by itself, and it is probed (F127-FR-007).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  A_HOST_FACT_BY_ITSELF,
  HOST_CONFIDENCE,
  HOST_EVENT_INBOX,
  HOST_EVENT_TYPE,
  INBOX_REQUEST_TYPES,
  SHARED_WINDOW_AUTH_TIER,
  classifyInputOf,
  decideOnAHostFact,
  estimateWindowUse,
  readHostEvent,
  type HostFact,
} from "../src/quota/host.ts";
import { classify, observe } from "../src/quota/classify.ts";
import { confirmingProbe, needsAConfirmingProbe, type ProbeRequest } from "../src/quota/probe.ts";
import { testPorts } from "./support/index.ts";

/** A host event as the inbox holds it (annex B §B.11). */
const REQUEST = Object.freeze({
  schema: "specstride.inbox/1",
  type: HOST_EVENT_TYPE,
  at: "2026-01-01T02:00:00.000Z",
  kind: "host-limit",
  data: Object.freeze({
    class: "quota_window",
    utilization: 0.8,
    resetsAt: "2026-01-01T05:00:00.000Z",
  }),
});

const PROBE_REQUEST: ProbeRequest = Object.freeze({
  role: "proposer",
  harness: "stub-harness",
  model: "stub-model",
  reason: "confirming-probe",
  usageId: "probe-host-1",
});

/* ---------------------------------------------------------------- *
 * The read of the inbox request.
 * ---------------------------------------------------------------- */

test("CT-127-9: the fact comes from the inbox request type `host-event`, with the source `host`", () => {
  assert.equal(HOST_EVENT_TYPE, "host-event");
  assert.ok((INBOX_REQUEST_TYPES as readonly string[]).includes(HOST_EVENT_TYPE));
  assert.equal(HOST_EVENT_INBOX, "inbox:host-events:<launchId>");
  const fact = readHostEvent(REQUEST);
  assert.ok(fact !== null);
  assert.equal(fact.source, "host", "the source of §Q.2");
  assert.equal(fact.kind, "host-limit");
  assert.equal(fact.at, "2026-01-01T02:00:00.000Z");
  assert.equal(fact.utilization, 0.8);
  assert.equal(fact.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(fact.resetsAtSource, "parsed_text", "a host reports a time, not a stream field");
  assert.equal(fact.namedClass, "quota_window");
});

test("CT-127-9: an inbox request of another type is not a host fact", () => {
  assert.equal(readHostEvent({ type: "stop" }), null);
  assert.equal(readHostEvent({ type: "hold-relaunch", hold: true } as never), null);
  assert.equal(readHostEvent(null), null);
  assert.equal(readHostEvent(undefined), null);
});

test("CT-127-9: a request that does not validate against `specstride.inbox/1` is refused", () => {
  const broken = { schema: "specstride.inbox/1", type: HOST_EVENT_TYPE, now: "not a truth value" };
  assert.equal(readHostEvent(broken as never), null, "the schema of feature 100 refuses it");
});

test("CT-127-9: a host fact with no utilization and no reset time is still a fact", () => {
  const fact = readHostEvent({ type: HOST_EVENT_TYPE, kind: "host-limit" });
  assert.ok(fact !== null);
  assert.equal(fact.utilization, null);
  assert.equal(fact.resetsAt, null);
  assert.equal(fact.resetsAtSource, null);
  assert.equal(fact.namedClass, null);
});

/* ---------------------------------------------------------------- *
 * It informs only.
 * ---------------------------------------------------------------- */

test("CT-127-9: a host fact informs only: it never pauses, stops or relaunches by itself", () => {
  assert.equal(A_HOST_FACT_BY_ITSELF.pausesTheRun, false);
  assert.equal(A_HOST_FACT_BY_ITSELF.stopsTheRun, false);
  assert.equal(A_HOST_FACT_BY_ITSELF.relaunchesTheRun, false);
  assert.equal(A_HOST_FACT_BY_ITSELF.needsTheConfirmingProbe, true);
  assert.equal(A_HOST_FACT_BY_ITSELF.isAnAlertInput, true);

  const fact = readHostEvent(REQUEST) as HostFact;
  const alone = decideOnAHostFact(fact);
  assert.equal(alone.pauses, false, "never a pause by itself (F127-FR-007)");
  assert.equal(alone.stops, false);
  assert.equal(alone.relaunches, false);
  assert.equal(alone.needsTheProbe, true, "the confirming probe comes first");
  assert.equal(alone.alertLevel, "warn", "and it is an alert input (§Q.4)");
});

test("CT-127-9: the confidence of a host fact is `host`, which §Q.2 puts behind a probe", () => {
  assert.equal(HOST_CONFIDENCE, "host");
  assert.equal(needsAConfirmingProbe(HOST_CONFIDENCE), true);
  const fact = readHostEvent(REQUEST) as HostFact;
  const classified = classify(classifyInputOf(fact));
  assert.equal(classified.quotaClass, "quota_window", "the class the host named");
  assert.equal(classified.confidence, "host", "and never `structured` (F127-FR-007)");
  assert.equal(classified.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(classified.resetsAtSource, "parsed_text");
  assert.equal(classified.utilization, 0.8);
});

/* ---------------------------------------------------------------- *
 * It is probed.
 * ---------------------------------------------------------------- */

test("CT-127-9: a host fact pauses only after a probe that confirms", async () => {
  const fact = readHostEvent(REQUEST) as HostFact;
  let calls = 0;
  const confirmed = await confirmingProbe(
    {
      probe() {
        calls += 1;
        return { ok: false, classification: classify({ structuredClass: "quota_window" }) };
      },
    },
    PROBE_REQUEST,
  );
  assert.equal(calls, 1, "one confirming probe");
  const decided = decideOnAHostFact(fact, confirmed);
  assert.equal(decided.pauses, true, "the probe confirmed, so the pause may begin");
  assert.equal(decided.needsTheProbe, false);
  assert.equal(decided.stops, false, "and it still never stops the run by itself");
});

test("CT-127-9: a host fact whose probe succeeds pauses nothing", async () => {
  const fact = readHostEvent(REQUEST) as HostFact;
  const refuted = await confirmingProbe({ probe: () => ({ ok: true }) }, PROBE_REQUEST);
  assert.equal(refuted.outcome, "refuted");
  const decided = decideOnAHostFact(fact, refuted);
  assert.equal(decided.pauses, false, "the run goes on (F127-FR-007)");
  assert.equal(decided.alertLevel, "warn", "the fact still informs");
});

/* ---------------------------------------------------------------- *
 * The window-use estimate under auth tier 1.
 * ---------------------------------------------------------------- */

test("CT-127-9: under auth tier 1 a host fact RAISES the estimate of the shared window", () => {
  assert.equal(SHARED_WINDOW_AUTH_TIER, 1);
  const fact = readHostEvent(REQUEST) as HostFact;
  const raised = estimateWindowUse(fact, { authTier: 1, previous: 0.1 });
  assert.equal(raised.sharedWithTheInteractiveSession, true);
  assert.ok(raised.used !== null);
  assert.ok(
    (raised.used as number) > 0.1,
    "the estimate rose: the host and the run share one window",
  );
  assert.equal(Number((raised.used as number).toFixed(10)), 0.9);
  assert.equal(Number(raised.raisedBy.toFixed(10)), 0.8);
  assert.equal(raised.alertLevel, "loud", "and the estimate is an alert input (§Q.4)");
});

test("CT-127-9: the estimate is capped at the whole window", () => {
  const fact = readHostEvent({
    type: HOST_EVENT_TYPE,
    kind: "host-limit",
    data: { utilization: 0.9 },
  }) as HostFact;
  const raised = estimateWindowUse(fact, { authTier: 1, previous: 0.5 });
  assert.equal(raised.used, 1, "a window cannot be more than used up");
});

test("CT-127-9: under any other auth tier the window is not shared and the estimate is unchanged", () => {
  const fact = readHostEvent(REQUEST) as HostFact;
  for (const authTier of [0, 2, 3, null]) {
    const unchanged = estimateWindowUse(fact, { authTier, previous: 0.1 });
    assert.equal(unchanged.sharedWithTheInteractiveSession, false, `tier ${String(authTier)}`);
    assert.equal(unchanged.used, 0.1, "the estimate stays where it was");
    assert.equal(unchanged.raisedBy, 0);
  }
});

test("CT-127-9: a host fact with no utilization leaves the estimate where it was", () => {
  const fact = readHostEvent({ type: HOST_EVENT_TYPE, kind: "host-limit" }) as HostFact;
  const same = estimateWindowUse(fact, { authTier: 1, previous: 0.4 });
  assert.equal(same.used, 0.4);
  assert.equal(same.raisedBy, 0);
  assert.equal(same.sharedWithTheInteractiveSession, true, "the window is still shared");
});

test("CT-127-9: `observe` reads a host fact as an alert input and never as a pause", () => {
  assert.equal(observe({ kind: "host-fact", fact: "host-limit" }), "warn");
});

test("CT-127-9 (checkpoint): reading a host fact touches no clock and no file", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const fact = readHostEvent(REQUEST) as HostFact;
  estimateWindowUse(fact, { authTier: 1 });
  decideOnAHostFact(fact);
  assert.equal(ports.clock.nowMs(), before, "the instant comes from the request's own field `at`");
  assert.deepEqual(ports.fileWriter.writes, []);
});
