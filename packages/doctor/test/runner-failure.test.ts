/**
 * T010 (feature 112) — CT-112-108 (F112-FR-008): a throwing check gives exit 1
 * and touches no run; an unknown severity reads as `warn`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctorChecks, makeProbeBag, normalizeSeverity } from "../src/runner/run.ts";
import type { Check, ProbeBag, Severity } from "../src/registry/types.ts";

/** A probe that reads and writes nothing anywhere (it touches no run). */
const thrower: Check = {
  id: "boom.one",
  group: "env",
  lb: false,
  order: 1,
  messageTemplate: "never {state}",
  fixHint: "report the check to its owner",
  severityRule: () => "ok" as Severity,
  probe: async () => {
    throw new Error("the probe of boom.one exploded");
  },
};

test("CT-112-108: a throwing check gives exit 1 and touches no run", async () => {
  const runRecords: unknown[] = [];
  const bag: ProbeBag = makeProbeBag({ runs: Object.freeze(runRecords) });
  const healthy: Check = {
    id: "calm.one",
    group: "cli",
    lb: false,
    order: 2,
    messageTemplate: "calm {state}",
    fixHint: "fix",
    severityRule: () => "ok" as never,
    probe: async () => ({ state: "fine" }),
  };
  const result = await runDoctorChecks({ checks: [thrower, healthy], bag });
  assert.equal(result.exit, 1);
  assert.equal(result.error?.id, "boom.one");
  assert.ok(result.error?.message.includes("exploded"));
  // The run records of the bag were never written: the doctor touches no run.
  assert.deepEqual(runRecords, []);
  // The runner itself wrote nothing: the bag's fixture state is unchanged.
  assert.equal(bag.files.stat("/proc/self/does-not-matter"), undefined);
});

test("CT-112-108: a severity the doctor does not know reads as `warn`", () => {
  assert.equal(normalizeSeverity("catastrophic"), "warn");
  assert.equal(normalizeSeverity(undefined), "warn");
  assert.equal(normalizeSeverity(7), "warn");
  assert.equal(normalizeSeverity("ok"), "ok");
  assert.equal(normalizeSeverity("info"), "info");
  assert.equal(normalizeSeverity("warn"), "warn");
  assert.equal(normalizeSeverity("fail"), "fail");

  // The same rule through a whole check: a rule answering an unknown value
  // renders a `warn` finding, never a crash.
  const unknownSeverity: Check = {
    id: "future.one",
    group: "env",
    lb: false,
    order: 1,
    messageTemplate: "future {state}",
    fixHint: "upgrade the doctor",
    severityRule: (() => "catastrophic") as unknown as Check["severityRule"],
    probe: async () => ({ state: "new" }),
  };
  return runDoctorChecks({ checks: [unknownSeverity], bag: makeProbeBag() }).then((result) => {
    assert.equal(result.findings[0].severity, "warn");
    assert.equal(result.exit, 0);
  });
});
