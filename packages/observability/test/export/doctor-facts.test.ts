/**
 * T070 — CT-128-21, the facts of the check `telemetry.endpoint`
 * (F128-FR-041; CQ-126; surfaces: doctor).
 *
 * F128-FR-041: *The exporter MUST give the doctor the facts of its
 * configuration, and the doctor MUST NOT open a connection unless the
 * consumer asked for an online check: for each sink the address with no
 * credential, whether the sink is on, whether traces are on, whether content
 * capture is on, the receiver state of F128-FR-028 when probed, and the
 * version of the redaction pattern set in force. The check
 * `telemetry.endpoint` of the doctor MUST be able to present them with the
 * severity `info`, and `warn` when capture is on.*
 *
 * The test observes the facts from the outside: the probe is injected, so
 * the "no connection without an online request" claim is proven by a spy
 * that counts calls — zero without `online`, one per enabled sink with it —
 * and by the absence of `receiverState` whenever no probe ran.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TELEMETRY_ENDPOINT_CHECK_ID,
  addressWithoutCredential,
  telemetryEndpointFacts,
  severityForFacts,
  severityForInputs,
  type TelemetryEndpointFactsOptions,
} from "@specstride/observability/export/doctor/facts";
import { receiverStateOf } from "@specstride/observability/export/probe/state";
import { loadWidenedPatternSet, patternSetVersionOf } from "@specstride/kernel/redactor/patterns";

/** A spy probe: counts its calls, answers what the test asked for. */
function spyProbe(answer: boolean): {
  probe: NonNullable<TelemetryEndpointFactsOptions["probe"]>;
  calls: string[];
} {
  const calls: string[] = [];
  const probe = async (url: string) => {
    calls.push(url);
    return answer;
  };
  return { probe: probe as unknown as NonNullable<TelemetryEndpointFactsOptions["probe"]>, calls };
}

/** A resolved configuration with the OTLP exporter on, traces on, capture on. */
function tracesOnConfig(): TelemetryEndpointFactsOptions {
  const result = loadWidenedPatternSet();
  return {
    loki: { enabled: false, url: "http://localhost:3100" },
    otel: { enabled: true, url: "http://localhost:4318" },
    traces: true,
    content: "auto",
    patternSetVersion: result.ok === true ? patternSetVersionOf(result.loaded) : "baseline-v1",
  };
}

describe("CT-128-21 — the facts of telemetry.endpoint (F128-FR-041)", () => {
  it("shows the address, the sink on, traces on, capture on and the pattern set version", async () => {
    const { probe, calls: _calls } = spyProbe(false);
    const facts = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      probe,
    });
    assert.equal(facts.check, TELEMETRY_ENDPOINT_CHECK_ID);
    assert.equal(facts.check, "telemetry.endpoint");
    const otel = facts.sinks.find((s) => s.label === "otel");
    assert.ok(otel, "the facts hold one block per sink");
    assert.equal(otel.address, "http://localhost:4318");
    assert.equal(otel.enabled, true);
    const loki = facts.sinks.find((s) => s.label === "loki");
    assert.equal(loki?.enabled, false);
    assert.equal(facts.traces, true);
    assert.equal(facts.capture, true);
    assert.equal(typeof facts.patternSetVersion, "string");
    assert.ok(facts.patternSetVersion.length > 0, "the version of the pattern set is shown");
  });

  it("never shows a credential in an address", async () => {
    assert.equal(
      addressWithoutCredential("http://user:secret@localhost:4318"),
      "http://localhost:4318",
      "the user name and the password are stripped",
    );
    // and the facts of a configuration carry the stripped form
    const facts = await telemetryEndpointFacts({
      loki: { enabled: false, url: "http://localhost:3100" },
      otel: { enabled: true, url: "http://user:secret@localhost:4318" },
      traces: true,
      patternSetVersion: "baseline-v1",
    });
    const otel = facts.sinks.find((s) => s.label === "otel");
    assert.ok(otel);
    assert.ok(!otel.address.includes("user"), "no user name in the shown address");
    assert.ok(!otel.address.includes("secret"), "no password in the shown address");
  });

  it("opens no connection without an online request: no receiverState, no probe call", async () => {
    const { probe, calls } = spyProbe(true);
    const facts = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      probe,
    });
    assert.deepEqual(calls, [], "the probe never ran: the doctor asked no online check");
    for (const sink of facts.sinks) {
      assert.equal(
        sink.receiverState,
        undefined,
        `no receiver state of ${sink.label} without the online check`,
      );
    }
  });

  it("probes each enabled sink exactly once when the online check is asked, and shows the state", async () => {
    const { probe, calls } = spyProbe(true);
    const facts = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      online: true,
      probe,
    });
    assert.deepEqual(calls, ["http://localhost:4318"], "one probe, for the sink that is on");
    const otel = facts.sinks.find((s) => s.label === "otel");
    assert.equal(otel?.receiverState, "reachable");
    const loki = facts.sinks.find((s) => s.label === "loki");
    assert.equal(
      loki?.receiverState,
      undefined,
      "no state shown for a sink the online check does not probe",
    );
  });

  it("a refused probe and delivery records raise or lower the state by the proofs (F128-FR-028)", async () => {
    const refused = spyProbe(false);
    const down = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      online: true,
      probe: refused.probe,
    });
    assert.equal(
      down.sinks.find((s) => s.label === "otel")?.receiverState,
      "configured",
      "a dead collector leaves the state at the lowest that is proved",
    );

    const accepted = {
      sink: "otel",
      batchId: "otel-1-1",
      eventCount: 3,
      status: "accepted",
      queryVerified: false,
    } as const;
    const withRecords = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      online: true,
      probe: refused.probe,
      proofs: { otel: { enabled: true, sink: "otel", reachable: false, records: [accepted] } },
    });
    assert.equal(
      withRecords.sinks.find((s) => s.label === "otel")?.receiverState,
      "request_accepted",
      "an accepted record proves more than the probe",
    );
    // the same rule, straight from the state module, for cross-checking
    assert.equal(
      receiverStateOf({ enabled: true, sink: "otel", reachable: true, records: [accepted] }),
      "request_accepted",
    );
  });

  it("everything off: the facts say so, and capture follows traces (F128-FR-036)", async () => {
    const facts = await telemetryEndpointFacts({
      loki: { enabled: false, url: "http://localhost:3100" },
      otel: { enabled: false, url: "http://localhost:4318" },
      traces: false,
      patternSetVersion: "baseline-v1",
    });
    for (const sink of facts.sinks) assert.equal(sink.enabled, false);
    assert.equal(facts.traces, false);
    assert.equal(facts.capture, false, "traces off: nothing is captured, whatever the switch says");
  });

  it("capture off narrows the facts, and under `parity` capture is off", async () => {
    const off = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      content: "off",
    });
    assert.equal(off.capture, false);
    const parity = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      profile: "parity",
    });
    assert.equal(parity.capture, false, "capture is off under the parity profile");
  });

  it("the severity is `info` normally and `warn` when capture is on (F128-FR-041)", async () => {
    const facts = await telemetryEndpointFacts(tracesOnConfig());
    assert.equal(
      severityForFacts(facts),
      "warn",
      "capture on: the doctor warns what leaves the machine",
    );
    const quiet = await telemetryEndpointFacts({
      ...tracesOnConfig(),
      content: "off",
    });
    assert.equal(severityForFacts(quiet), "info");
    assert.equal(severityForInputs({ traces: true, content: "auto" }), "warn");
    assert.equal(severityForInputs({ traces: false }), "info");
  });

  it("the facts never throw, whatever the inputs", async () => {
    const facts = await telemetryEndpointFacts({
      loki: { enabled: true, url: "not a url at all" },
      otel: { enabled: false, url: "" },
      traces: true,
      content: 42,
      patternSetVersion: "",
    });
    assert.equal(facts.sinks[0]?.address, "", "an address that is not a URL shows nothing");
    assert.equal(facts.capture, false, "a garbage capture value narrows, never widens");
  });
});
