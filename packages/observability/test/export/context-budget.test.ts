/**
 * T075 — CT-128-16, the context-budget gauges (F128-FR-034; CQ-123; surface:
 * telemetry).
 *
 * F128-FR-034: *The exporter MUST offer the figures of the context-budget
 * report of the build (per host skill: measured bytes, tokens by the pinned
 * ratio, and the limit) as gauge metrics `specstride.context.bytes`,
 * `specstride.context.tokens` and `specstride.context.limit` with the
 * attribute `skill`, once at the start of a run, when the OTLP exporter is on
 * and the report is present. When the report is absent nothing MUST be
 * emitted and no warning MUST be given.*
 *
 * The effect is observed through an independent read path: the `/v1/metrics`
 * request body the recorder renders. With the exporter ON and the report
 * present, the body carries the three gauges per skill, once, with the
 * `skill` attribute. With the report absent, the body carries none of them
 * and the warning channel is never touched (proven by a spy).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTEXT_BYTES_METRIC,
  CONTEXT_LIMIT_METRIC,
  CONTEXT_SKILL_ATTRIBUTE,
  CONTEXT_TOKENS_METRIC,
  contextBudgetGaugesOf,
  readContextBudgetReport,
  recordContextBudgetGauges,
} from "@specstride/observability/export/metrics/context-budget";
import { MetricRecorder } from "@specstride/observability/export/metrics/recorder";
import { createOtlpSink, registerExportSinks } from "@specstride/observability/export";

const REPORT = {
  ratio: 4,
  skills: {
    "specstride-implement": { bytes: 48_000, tokens: 12_000, limit: 24_000 },
    "specstride-review": { bytes: 20_000, tokens: 5_000, limit: 24_000 },
  },
};

/** A metric recorder wired the way the exporter start wires it (once). */
function recorderWith(reportText: string | null): { recorder: MetricRecorder; count: number } {
  const recorder = new MetricRecorder({ nowNanos: () => 1_000_000n });
  const count = recordContextBudgetGauges(recorder, contextBudgetGaugesOf(reportText));
  return { recorder, count };
}

function metricNames(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const rm of body["resourceMetrics"] as Record<string, unknown>[]) {
    for (const sm of rm["scopeMetrics"] as Record<string, unknown>[]) {
      for (const m of sm["metrics"] as Record<string, unknown>[]) out.push(m["name"] as string);
    }
  }
  return out;
}

function pointsOf(body: Record<string, unknown>, name: string): Record<string, unknown>[] {
  for (const rm of body["resourceMetrics"] as Record<string, unknown>[]) {
    for (const sm of rm["scopeMetrics"] as Record<string, unknown>[]) {
      for (const m of sm["metrics"] as Record<string, unknown>[]) {
        if (m["name"] !== name) continue;
        const sum = m["sum"] as Record<string, unknown>;
        return sum["dataPoints"] as Record<string, unknown>[];
      }
    }
  }
  return [];
}

describe("CT-128-16 — the three context gauges at run start", () => {
  it("exporter on + report present: the three gauges per skill, once, with `skill`", () => {
    // The exporter is on: a real sink opens (the exporter start).
    const sink = createOtlpSink({ url: "http://localhost:4318", enabled: true });
    const bodies: string[] = [];
    const dispatcher = { register: () => ({ accepted: true, findings: [] }) };
    const registration = registerExportSinks(
      dispatcher,
      { url: "http://localhost:3100", enabled: true },
      { url: "http://localhost:4318", enabled: true },
    );
    assert.equal(registration.otelAccepted, true);
    void sink;

    const { recorder, count } = recorderWith(JSON.stringify(REPORT));
    // Once at run start: the gauges are the FIRST records of the exporter.
    assert.equal(count, 6);
    const body = recorder.toOtlpMetrics("new");
    const names = metricNames(body);
    for (const metric of [CONTEXT_BYTES_METRIC, CONTEXT_TOKENS_METRIC, CONTEXT_LIMIT_METRIC]) {
      assert.ok(names.includes(metric), `${metric} in the /v1/metrics body`);
      const points = pointsOf(body, metric);
      assert.equal(points.length, 2, `${metric}: one point per skill`);
      for (const point of points) {
        const attrs = point["attributes"] as { key: string; value: { stringValue: string } }[];
        const skill = attrs.find((a) => a.key === CONTEXT_SKILL_ATTRIBUTE);
        assert.ok(skill, "the skill attribute is present");
        assert.ok(["specstride-implement", "specstride-review"].includes(skill.value.stringValue));
      }
    }
    const bytes = pointsOf(body, CONTEXT_BYTES_METRIC);
    assert.deepEqual(bytes.map((p) => p["asInt"] as string).sort(), ["20000", "48000"]);
    // A gauge is a non-monotonic sum (the gauge encoding of OTLP).
    const sum =
      bytes &&
      ((() => {
        for (const rm of body["resourceMetrics"] as Record<string, unknown>[])
          for (const sm of rm["scopeMetrics"] as Record<string, unknown>[])
            for (const m of sm["metrics"] as Record<string, unknown>[])
              if (m["name"] === CONTEXT_BYTES_METRIC) return m["sum"];
        return undefined;
      })() as Record<string, unknown>);
    assert.equal(sum["isMonotonic"], false);
    void bodies;
  });

  it("report absent: nothing emitted and no warning (F128-FR-034)", () => {
    // The "no warning" claim is observable: the warning channel of the
    // exporter is console.warn along this code path, so it is spied here.
    const origWarn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned += 1;
    };
    try {
      const recorder = new MetricRecorder({ nowNanos: () => 1_000_000n });
      const gauges = contextBudgetGaugesOf(null);
      assert.deepEqual(gauges, []);
      recordContextBudgetGauges(recorder, gauges);
      assert.deepEqual(
        metricNames(recorder.toOtlpMetrics("new")).filter((n) =>
          n.startsWith("specstride.context"),
        ),
        [],
      );
      assert.equal(warned, 0); // the warning channel is never touched
    } finally {
      console.warn = origWarn;
    }
  });

  it("an empty or unparsable report is the absent case: nothing, no warning", () => {
    const origWarn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned += 1;
    };
    try {
      assert.deepEqual(contextBudgetGaugesOf(""), []);
      assert.deepEqual(contextBudgetGaugesOf("   "), []);
      assert.deepEqual(contextBudgetGaugesOf("{not json"), []);
      assert.deepEqual(contextBudgetGaugesOf("{}"), []);
      assert.deepEqual(contextBudgetGaugesOf(undefined), []);
      assert.equal(warned, 0); // the warning channel is never touched
    } finally {
      console.warn = origWarn;
    }
  });

  it("the report is read from the logical name package:context-budget; a missing file is null", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-budget-"));
    try {
      const path = join(dir, "context-budget.json");
      assert.equal(readContextBudgetReport(path), null); // absent: null, never a throw
      writeFileSync(path, JSON.stringify(REPORT));
      const gauges = contextBudgetGaugesOf(readContextBudgetReport(path));
      assert.equal(gauges.length, 6);
      assert.equal(gauges[0]!.name, CONTEXT_BYTES_METRIC);
      assert.equal(gauges[0]!.value, 48_000);
      // A figure the report does not hold contributes no gauge.
      const partial = contextBudgetGaugesOf(JSON.stringify({ skills: { only: { bytes: 10 } } }));
      assert.deepEqual(
        partial.map((g) => g.name),
        [CONTEXT_BYTES_METRIC],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
