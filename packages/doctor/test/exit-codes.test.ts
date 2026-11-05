/**
 * T016 (feature 112) — CT-112-2 (F112-FR-027; DV-041): the exit codes.
 *
 * 0 when no finding is `fail`, 1 when the doctor could not run (a bad working
 * directory, a check that throws), 2 when at least one finding is `fail`, 3 on
 * a usage error. `--strict` makes a warning exit 2. A timed-out probe is a
 * warning and never above a warning. Lisa's exit 2 on any finding, and her
 * documented exit 3 that never existed, are NOT carried (DV-041).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXIT_OK,
  EXIT_COULD_NOT_RUN,
  EXIT_FINDINGS,
  EXIT_USAGE,
  exitCodeFor,
  exitCodeForRun,
} from "../src/runner/exit.ts";
import { runDoctorChecks, makeProbeBag } from "../src/runner/run.ts";
import type { Check, Finding } from "../src/registry/types.ts";

function finding(id: string, severity: Finding["severity"]): Finding {
  return { id, severity, lb: false, message: id, evidence: Object.freeze({}), remedy: "fix" };
}

function checkWith(id: string, severity: string): Check {
  return {
    id,
    group: "env",
    lb: false,
    order: 1,
    messageTemplate: id,
    fixHint: "fix",
    severityRule: () => severity as never,
    probe: async () => ({ state: severity }),
  };
}

test("CT-112-2: exit codes 0, 1 and 2 follow the findings table", () => {
  assert.equal(exitCodeFor([]), EXIT_OK);
  assert.equal(exitCodeFor([finding("a", "info"), finding("b", "warn")]), EXIT_OK);
  assert.equal(exitCodeFor([finding("a", "fail")]), EXIT_FINDINGS);
  // A doctor that could not run exits 1 even when findings were collected.
  assert.equal(
    exitCodeForRun({ exit: EXIT_COULD_NOT_RUN, findings: [finding("a", "fail")] }),
    EXIT_COULD_NOT_RUN,
  );
  assert.equal(exitCodeForRun({ exit: EXIT_COULD_NOT_RUN, findings: [] }), EXIT_COULD_NOT_RUN);
  assert.equal(EXIT_USAGE, 3);
});

test("CT-112-2: --strict makes a warning exit 2 (DV-041)", () => {
  assert.equal(exitCodeFor([finding("critic.diversity", "warn")]), EXIT_OK);
  assert.equal(exitCodeFor([finding("critic.diversity", "warn")], { strict: true }), EXIT_FINDINGS);
  // Strict changes nothing for a fail, and an info never exits 2.
  assert.equal(exitCodeFor([finding("a", "fail")], { strict: true }), EXIT_FINDINGS);
  assert.equal(exitCodeFor([finding("a", "info")], { strict: true }), EXIT_OK);
});

test("CT-112-2: a timed-out probe never exits above a warning", async () => {
  // A probe that never settles: the runner ends it at the bag's time limit.
  const slow: Check = {
    ...checkWith("slow.check", "ok"),
    probe: async () => {
      await new Promise(() => {});
      return {};
    },
  };
  const result = await runDoctorChecks({
    checks: [slow],
    bag: makeProbeBag({ clock: { now: () => 0, wait: () => Promise.resolve() } }),
  });
  assert.equal(result.exit, EXIT_OK);
  const timedOut = result.findings.find((f) => f.id === "slow.check");
  assert.ok(timedOut, "the timeout must produce a finding");
  assert.equal(timedOut?.severity, "warn");
  assert.equal(timedOut?.message, "probe timed out");
  assert.equal(exitCodeFor(result.findings), EXIT_OK);
  assert.equal(exitCodeFor(result.findings, { strict: true }), EXIT_FINDINGS);
});

test("CT-112-2: Lisa's exit 2 on any finding is not carried (DV-041)", () => {
  // A warning-only run exits 0 without --strict: the critic-diversity warning
  // fires routinely and must not fail the doctor.
  const lisaWouldFail = [finding("critic.diversity", "warn"), finding("terms.stale", "warn")];
  assert.equal(exitCodeFor(lisaWouldFail), EXIT_OK);
});
