/**
 * CT-127-37 (T055) — the characterization test of the ENGINE AS THE ONLY
 * SOURCE and of the DELIVERY WITHOUT HOST HOOKS (F127-FR-039, §Q.5).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AN_ALERT_NEVER_STALLS_OR_FAILS_A_RUN,
  CHANNELS_BY_LEVEL,
  CHANNELS_WITHOUT_HOST_HOOKS,
  READERS,
  THE_ENGINE_IS_THE_ONLY_SOURCE,
  channelsFor,
  deliver,
  emptyAlertState,
  raiseFixedAlert,
  raiseThresholdAlerts,
} from "../src/budget/alerts.ts";
import { readCeiling, type Ceiling } from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger } from "../src/budget/ledger.ts";
import type { PolicyEvent } from "../src/quota/ports.ts";
import { testPorts } from "./support/index.ts";

const COST_CEILING: Ceiling = { scope: "role", role: "proposer", dimension: "costUsd", limit: 100 };

function spent(costUsd: number) {
  return applyUsageRecord(emptyLedger("run-1"), {
    usageId: `u-${costUsd}`,
    role: "proposer",
    billingMode: "api",
    costUsd,
    isCall: true,
  }).ledger;
}

/** A sink that records what it was handed. */
function recordingSink() {
  const seen: PolicyEvent[] = [];
  return { seen, sink: (event: PolicyEvent) => void seen.push(event) };
}

test("CT-127-37: the ENGINE is the only source; every other channel READS", () => {
  assert.equal(THE_ENGINE_IS_THE_ONLY_SOURCE, true);
  assert.deepEqual([...READERS], ["status", "digest", "doctor", "host-hooks"]);
});

test("CT-127-37: an alert reaches a reader ONLY as the event the engine wrote", () => {
  const ports = testPorts();
  const reading = readCeiling(COST_CEILING, { ledger: spent(80) });
  raiseThresholdAlerts(ports.eventWriter, {
    reading,
    state: emptyAlertState(),
    context: { billingMode: "api", scope: "role", dimension: "costUsd" },
  });
  // The whole of what a reader can see is the two `alert` events; the level,
  // the threshold, the value and the limit are all IN the payload, so no
  // reader needs to compute one.
  const events = ports.eventWriter.of("alert");
  assert.equal(events.length, 2);
  for (const event of events) {
    for (const field of ["kind", "level", "role", "threshold", "value", "limit", "dedupeKey"]) {
      assert.ok(field in event.payload, `${field} is in the payload the engine wrote`);
    }
  }
  // And the level is the engine's: a reader that recomputed it from the
  // percentage alone would get `warn` for 75 per cent, not `loud`.
  assert.equal(events[1].payload.threshold, 75);
  assert.equal(
    events[1].payload.level,
    "loud",
    "the engine knows the billing mode; a reader does not",
  );
});

test("CT-127-37: the channels of each level (§Q.4, §Q.5)", () => {
  assert.deepEqual([...CHANNELS_BY_LEVEL.info], ["status", "doctor"]);
  assert.deepEqual([...CHANNELS_BY_LEVEL.warn], ["status", "doctor", "digest"]);
  assert.deepEqual(
    [...CHANNELS_BY_LEVEL.loud],
    ["status", "doctor", "digest", "host-hooks", "announcement"],
  );
  // `info` reaches `status` and the doctor; `warn` ALSO the digest; `loud`
  // every channel.
  assert.ok(CHANNELS_BY_LEVEL.warn.includes("digest"));
  assert.ok(!CHANNELS_BY_LEVEL.info.includes("digest"));
  assert.ok(CHANNELS_BY_LEVEL.loud.includes("host-hooks"));
});

test("CT-127-37: WITHOUT HOST HOOKS a `loud` alert still reaches status, the digest and the doctor", () => {
  assert.deepEqual([...CHANNELS_WITHOUT_HOST_HOOKS], ["status", "digest", "doctor"]);
  const without = channelsFor("loud", { hasHostHooks: false });
  assert.ok(!without.includes("host-hooks"), "the channel the host does not have is dropped");
  for (const channel of CHANNELS_WITHOUT_HOST_HOOKS) {
    assert.ok(without.includes(channel), `${channel} still carries it`);
  }
  // With host hooks the channel is there.
  assert.ok(channelsFor("loud", { hasHostHooks: true }).includes("host-hooks"));
  assert.ok(
    channelsFor("loud").includes("host-hooks"),
    "a host that said nothing is read as having them",
  );
});

test("CT-127-37: the delivery on a host without host hooks loses no alert", () => {
  const ports = testPorts();
  const status = recordingSink();
  const digest = recordingSink();
  const doctor = recordingSink();
  const hostHooks = recordingSink();
  const result = raiseFixedAlert(ports.eventWriter, {
    kind: "billing-mode-change",
    role: "proposer",
    state: emptyAlertState(),
    limit: 25,
  });
  assert.notEqual(result.event, null);
  const delivered = deliver(
    result.event as PolicyEvent,
    result.level,
    {
      status: status.sink,
      digest: digest.sink,
      doctor: doctor.sink,
      "host-hooks": hostHooks.sink,
    },
    { hasHostHooks: false },
  );
  assert.deepEqual([...delivered.delivered], ["status", "doctor", "digest"]);
  assert.deepEqual([...delivered.failed], []);
  assert.equal(status.seen.length, 1);
  assert.equal(digest.seen.length, 1);
  assert.equal(doctor.seen.length, 1);
  assert.equal(hostHooks.seen.length, 0, "the host has none");
});

test("CT-127-37: an `info` alert does not reach the digest", () => {
  const ports = testPorts();
  const digest = recordingSink();
  const status = recordingSink();
  const reading = readCeiling(COST_CEILING, { ledger: spent(55) });
  const raised = raiseThresholdAlerts(ports.eventWriter, {
    reading,
    state: emptyAlertState(),
    context: { billingMode: "api", scope: "role", dimension: "costUsd" },
  });
  assert.equal(raised.raised[0].level, "info");
  const delivered = deliver(raised.events[0], "info", {
    status: status.sink,
    digest: digest.sink,
  });
  assert.deepEqual([...delivered.delivered], ["status"]);
  assert.equal(digest.seen.length, 0);
});

test("CT-127-37: an alert NEVER stalls or fails a run — a sink that throws is swallowed", () => {
  assert.equal(AN_ALERT_NEVER_STALLS_OR_FAILS_A_RUN, true);
  const ports = testPorts();
  const good = recordingSink();
  const result = raiseFixedAlert(ports.eventWriter, {
    kind: "spend-unmeasurable",
    role: "critic",
    state: emptyAlertState(),
  });
  const run = () =>
    deliver(result.event as PolicyEvent, result.level, {
      status: () => {
        throw new Error("the sink died");
      },
      digest: good.sink,
      doctor: good.sink,
    });
  assert.doesNotThrow(run);
  const delivered = run();
  assert.deepEqual([...delivered.failed], ["status"]);
  assert.deepEqual([...delivered.delivered], ["doctor", "digest"]);
  assert.equal(good.seen.length, 4, "the other channels still got it, on both runs");
});

test("CT-127-37: a channel with no sink configured is skipped and not an error", () => {
  const ports = testPorts();
  const result = raiseFixedAlert(ports.eventWriter, {
    kind: "ledger-unreadable",
    state: emptyAlertState(),
    anyHardCeilingSet: true,
  });
  const delivered = deliver(result.event as PolicyEvent, result.level, {});
  assert.deepEqual([...delivered.delivered], []);
  assert.deepEqual([...delivered.failed], []);
});
