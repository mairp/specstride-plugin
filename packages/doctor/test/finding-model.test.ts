/**
 * T004 (feature 112) — CT-112-1, the characterization of the finding model as
 * extracted from Lisa (F112-FR-001; research D-1): id, severity, message,
 * evidence, remedy; probes injected through the probe bag; the same result on
 * the same fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctorChecks, makeProbeBag, redactEvidence, renderMessage } from "../src/runner/run.ts";
import type { Check, ProbeBag } from "../src/registry/types.ts";

/** A fixture check that reads only the injected bag — never the real machine. */
const probeIdCheck: Check = {
  id: "fixture.probe-id",
  group: "env",
  lb: false,
  order: 10,
  messageTemplate: "probed {id}",
  fixHint: "set the id in the user configuration",
  severityRule: (observed: unknown) =>
    (observed as { id?: string })["id"] === "fixture" ? "ok" : "warn",
  probe: async (bag: Readonly<Record<string, unknown>>) => {
    // The check reads the fixture state out of the injected registry, never
    // from the file system, the network or the process environment.
    const ids = (bag as unknown as ProbeBag).registry.ids;
    return { id: ids[0] ?? "missing" };
  },
};

test("CT-112-1: the finding carries Lisa's model — id, severity, message, evidence, remedy", async () => {
  const bag = makeProbeBag({ registry: { ids: ["fixture"] } });
  const result = await runDoctorChecks({ checks: [probeIdCheck], bag });
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.deepEqual(
    Object.keys(finding).sort(),
    ["evidence", "id", "lb", "message", "remedy", "severity"].sort(),
  );
  assert.equal(finding.id, "fixture.probe-id");
  assert.equal(finding.severity, "ok");
  assert.equal(finding.message, "probed fixture");
  assert.equal(finding.remedy, "set the id in the user configuration");
  assert.deepEqual(finding.evidence, { id: "fixture" });
});

test("CT-112-1: probes are injected — the same fixture gives the same result, with no real machine", async () => {
  const fixtureBag = (): ProbeBag => makeProbeBag({ registry: { ids: ["fixture"] } });
  const first = await runDoctorChecks({ checks: [probeIdCheck], bag: fixtureBag() });
  const second = await runDoctorChecks({ checks: [probeIdCheck], bag: fixtureBag() });
  // Same fixture, same result: identical findings, byte for byte.
  assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
  assert.equal(first.exit, 0);

  // A different fixture changes the result: the probe read the injected bag.
  const other = await runDoctorChecks({
    checks: [probeIdCheck],
    bag: makeProbeBag({ registry: { ids: ["something-else"] } }),
  });
  assert.equal(other.findings[0].severity, "warn");
  assert.equal(other.findings[0].message, "probed something-else");
});

test("CT-112-1: the evidence is redacted and the message is bounded", () => {
  assert.deepEqual(
    redactEvidence({ status: "present", stdout: "raw process output", note: "a note" }),
    { status: "present" },
  );
  assert.equal(renderMessage("state is {state}", { state: "clear" }), "state is clear");
  const long = "x".repeat(300);
  assert.ok(Buffer.byteLength(renderMessage("state is {state}", { state: long }), "utf8") <= 201);
});
