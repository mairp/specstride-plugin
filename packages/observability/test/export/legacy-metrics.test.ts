/**
 * T050 — CT-128-10: the opt-in for the old metric names (F128-FR-032;
 * B-2320; B-2324).
 *
 * `telemetry.otel.legacyMetricNames` ADDS the six `ralph.*` metrics, derived
 * from the same records as the new metrics, and never instead of them: the
 * old metrics are appended AFTER the new ones in the `/v1/metrics` body. The
 * switch is off by default and off under the `parity` profile, and only the
 * literal `true` turns it on. No attribute of a new metric is renamed — the
 * derivation copies attribute values, it never writes into the new series.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MetricRecorder, METRIC_NAMES } from "@specstride/observability/export/metrics/recorder";
import {
  legacyMetricNamesOn,
  legacyMetricsFrom,
  appendLegacyMetrics,
  LEGACY_METRIC_NAMES,
  LEGACY_METRIC_NAMES_SWITCH,
  NEVER_RENAMES_AN_ATTRIBUTE,
} from "@specstride/observability/export/metrics/legacy";

/** A recorder holding one record of each family the old names are derived from. */
function recorderWithRecords(): MetricRecorder {
  const recorder = new MetricRecorder();
  recorder.record({
    name: "specstride.pass.duration",
    observedMs: 1200,
    attrs: { model: "claude-3" },
  });
  recorder.record({
    name: "specstride.cost.usd",
    value: 0.4,
    attrs: { model: "claude-3", role: "main" },
  });
  recorder.record({
    name: "specstride.tokens",
    value: 10,
    attrs: { type: "input", model: "claude-3" },
  });
  recorder.record({
    name: "specstride.tokens",
    value: 20,
    attrs: { type: "output", model: "claude-3" },
  });
  recorder.record({
    name: "specstride.tokens",
    value: 5,
    attrs: { type: "cache_read", model: "claude-3" },
  });
  recorder.record({
    name: "specstride.tokens",
    value: 7,
    attrs: { type: "cache_write", model: "claude-3" },
  });
  recorder.record({ name: "specstride.errors", value: 1, attrs: { model: "claude-3" } });
  recorder.record({ name: "specstride.tool.calls", value: 1, attrs: { tool: "bash" } });
  recorder.record({ name: "specstride.verdict", value: 1, attrs: { result: "APPROVED" } });
  return recorder;
}

/** The metric names of an exported `/v1/metrics` body, in order. */
function namesOf(metrics: readonly unknown[]): string[] {
  return (metrics as { name: string }[]).map((m) => m.name);
}

test("CT-128-10: the six old names, exactly (F128-FR-032)", () => {
  assert.deepEqual(
    [...LEGACY_METRIC_NAMES],
    [
      "ralph.iter.duration_ms",
      "ralph.cost_usd",
      "ralph.tokens",
      "ralph.errors",
      "ralph.tool_use",
      "ralph.gate",
    ],
  );
  assert.equal(LEGACY_METRIC_NAMES_SWITCH, "telemetry.otel.legacyMetricNames");
});

test("CT-128-10: the old metrics are derived from the SAME records as the new ones", () => {
  const recorder = recorderWithRecords();
  const legacy = legacyMetricsFrom((name) => recorder.seriesOf(name), {
    startUnixNano: recorder.startUnixNano,
    timeUnixNano: "42",
  });
  assert.deepEqual(namesOf(legacy), [...LEGACY_METRIC_NAMES]);
  // the same values the recorder holds, not copies with other values:
  const cost = (legacy as { name: string; sum?: { dataPoints: { asDouble?: number }[] } }[]).find(
    (m) => m.name === "ralph.cost_usd",
  )!;
  assert.equal(cost.sum!.dataPoints[0]!.asDouble, 0.4);
  const gate = (
    legacy as {
      name: string;
      sum?: {
        dataPoints: {
          asInt?: string;
          attributes: { key: string; value: { stringValue: string } }[];
        }[];
      };
    }[]
  ).find((m) => m.name === "ralph.gate")!;
  assert.equal(gate.sum!.dataPoints[0]!.asInt, "1");
  assert.equal(gate.sum!.dataPoints[0]!.attributes[0]!.value.stringValue, "APPROVED");
  // the histogram of ralph.iter.duration_ms is the pass-duration histogram:
  const iter = (
    legacy as {
      name: string;
      histogram?: {
        dataPoints: {
          count: string;
          sum: number;
          attributes: { key: string; value: { stringValue: string } }[];
        }[];
      };
    }[]
  ).find((m) => m.name === "ralph.iter.duration_ms")!;
  assert.equal(iter.histogram!.dataPoints[0]!.count, "1");
  assert.equal(iter.histogram!.dataPoints[0]!.sum, 1200);
  assert.equal(iter.histogram!.dataPoints[0]!.attributes[0]!.value.stringValue, "claude-3");
});

test("CT-128-10: the old metrics are ADDED, never instead of the new ones", () => {
  const recorder = recorderWithRecords();
  const newMetrics = (
    recorder.toOtlpMetrics("new") as {
      resourceMetrics: { scopeMetrics: { metrics: unknown[] }[] }[];
    }
  ).resourceMetrics[0]!.scopeMetrics[0]!.metrics;
  const before = namesOf(newMetrics);
  for (const name of LEGACY_METRIC_NAMES) {
    assert.equal(before.includes(name), false, `${name} is not one of the new metrics`);
  }
  const legacy = legacyMetricsFrom((name) => recorder.seriesOf(name), {
    startUnixNano: recorder.startUnixNano,
    timeUnixNano: "42",
  });
  const combined = appendLegacyMetrics(newMetrics, legacy);
  assert.deepEqual(
    namesOf(combined),
    [...before, ...LEGACY_METRIC_NAMES],
    "the old names come AFTER every new name, never before one",
  );
  // `appendLegacyMetrics` never drops or reorders a new metric:
  assert.deepEqual(namesOf(combined).slice(0, before.length), before);
});

test("CT-128-10: off by default, and off under the parity profile", () => {
  assert.equal(legacyMetricNamesOn({}), false, "off by default");
  assert.equal(legacyMetricNamesOn({}, "parity"), false, "off under parity");
  assert.equal(
    legacyMetricNamesOn({ [LEGACY_METRIC_NAMES_SWITCH]: true }, "parity"),
    false,
    "even the literal true does not turn it on under parity",
  );
  assert.equal(
    legacyMetricNamesOn({ [LEGACY_METRIC_NAMES_SWITCH]: "true" }),
    false,
    "only the literal true turns it on",
  );
  assert.equal(
    legacyMetricNamesOn({ [LEGACY_METRIC_NAMES_SWITCH]: 1 }),
    false,
    "only the literal true turns it on",
  );
  assert.equal(legacyMetricNamesOn({ [LEGACY_METRIC_NAMES_SWITCH]: true }), true);
  assert.equal(legacyMetricNamesOn({ [LEGACY_METRIC_NAMES_SWITCH]: true }, "dev"), true);
});

test("CT-128-10: no attribute of a new metric is renamed", () => {
  assert.equal(NEVER_RENAMES_AN_ATTRIBUTE, true);
  const recorder = recorderWithRecords();
  const newBefore = recorder.toOtlpMetrics("new") as {
    resourceMetrics: { scopeMetrics: { metrics: unknown[] }[] }[];
  };
  const legacy = legacyMetricsFrom((name) => recorder.seriesOf(name), {
    startUnixNano: recorder.startUnixNano,
    timeUnixNano: "42",
  });
  const combined = appendLegacyMetrics(
    newBefore.resourceMetrics[0]!.scopeMetrics[0]!.metrics,
    legacy,
  );
  // the new metrics in the combined body are deep-equal to what the recorder
  // exported alone — the derivation added names, it renamed nothing:
  const newAfter = (combined as { name: string }[]).filter((m) => METRIC_NAMES.includes(m.name));
  assert.deepEqual(newAfter, newBefore.resourceMetrics[0]!.scopeMetrics[0]!.metrics);
  // the old token type cache_write is read as the old name's cache_creation:
  const tokens = (
    legacy as {
      name: string;
      sum?: { dataPoints: { attributes: { key: string; value: { stringValue: string } }[] }[] };
    }[]
  ).find((m) => m.name === "ralph.tokens")!;
  const types = tokens
    .sum!.dataPoints.map((p) => p.attributes.find((a) => a.key === "type")!.value.stringValue)
    .sort();
  assert.deepEqual(types, ["cache_creation", "cache_read", "input", "output"]);
});

test("CT-128-10: a recorder with no records derives no old metrics either", () => {
  const recorder = new MetricRecorder();
  const legacy = legacyMetricsFrom((name) => recorder.seriesOf(name), {
    startUnixNano: recorder.startUnixNano,
    timeUnixNano: "42",
  });
  assert.deepEqual(legacy, []);
});
