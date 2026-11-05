/**
 * CT-115-134 (T089, IR-34; F115-FR-004) — characterization of the integrity
 * rule IR-34: the layer only where the verification gate executes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { epVerificationSource } from "@specstride/contracts";
import { gateDoesNotExecute } from "../../src/strategy/select.ts";
import {
  RUN_FALLBACK_REASONS,
  fallbackAtLaunch,
  type LaunchRead,
} from "../../src/strategy/fallback.ts";

function read(mode: string): LaunchRead {
  return {
    verificationMode: mode,
    configuredStrategy: "micro",
    harnessOffersProposerLevel: true,
    tripwireBreached: false,
  };
}

test("IR-34: the gate executes only in the mode required", () => {
  assert.equal(gateDoesNotExecute("required"), false);
  assert.equal(gateDoesNotExecute("plan"), true);
  assert.equal(gateDoesNotExecute("off"), true);
  assert.deepEqual([...epVerificationSource.VERIFICATION_MODES], ["required", "plan", "off"]);
});

test("IR-34: a gateless mode runs the classic loop for the whole run", () => {
  for (const mode of ["plan", "off"] as const) {
    const f = fallbackAtLaunch(read(mode));
    assert.ok(f.fallback);
    if (!f.fallback) continue;
    assert.equal(f.reason, "gate-not-executing");
    assert.equal(f.scope, "run"); // the whole run, not one attempt
  }
});

test("IR-34: a gateless run is a run-level fallback reason of the closed set", () => {
  assert.ok((RUN_FALLBACK_REASONS as readonly string[]).includes("gate-not-executing"));
});

test("IR-34: where the gate executes, no fallback is decided from the mode", () => {
  assert.deepEqual(fallbackAtLaunch(read("required")), {
    fallback: false,
    reason: "none",
    announcement: "none",
  });
});
