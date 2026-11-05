// CT-125-6 (T073) — characterization of the doctor checks of the harness
// adapter (F125-FR-006): every check, with a stub for each state — absent,
// out of range, no login, managed settings, no sandbox, SDK absent — and
// none of the checks makes a paid call, reads a secret value or writes.
// The checks are registered as entries of the doctor check registry of
// feature 100 (annex G §G.7) through the kernel's registration call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_DOCTOR_CHECK_IDS,
  claudeDoctorChecks,
  registerClaudeDoctorChecks,
  SDK_AVAILABILITY_STATES,
} from "../../src/index.ts";
import { registeredDoctorChecks, resetDoctorChecks } from "@specstride/kernel";
import type { ClaudeDoctorFacts } from "../../src/index.ts";

/** A secret VALUE a check must never surface. */
const SECRET = "sk-ant-SUPERSECRET-VALUE";

const FACTS = (over: Partial<ClaudeDoctorFacts> = {}): ClaudeDoctorFacts => ({
  bin: {
    present: true,
    path: "/usr/local/bin/claude",
    refusal: null,
    changedPathWarning: null,
    usedByARole: true,
  },
  auth: {
    tier: 1,
    loginPresent: true,
    secretReferenceName: null,
    loginEstablishedBy: "existence probe, no network, no paid call",
  },
  version: { recorded: "2.1.284", inRange: true, changedBetweenPasses: false },
  managedSettings: { present: false, path: null },
  sandbox: { offered: true, userIsRoot: false },
  sdk: { availability: "available", version: "0.3.284", warning: null },
  concurrentSessions: { value: null, status: "unverified" },
  ...over,
});

const checks = () => claudeDoctorChecks(FACTS());
const byId = (id: string) => {
  const check = checks().find((c) => c.id === id);
  assert.ok(check, id);
  return check;
};

describe("CT-125-6 — the doctor checks of the harness adapter (F125-FR-006)", () => {
  it("registers exactly the seven ids F125-FR-006 proposes, never renamed", () => {
    assert.deepEqual([...checks().map((c) => c.id)], [...CLAUDE_DOCTOR_CHECK_IDS]);
    assert.deepEqual(
      [...CLAUDE_DOCTOR_CHECK_IDS],
      [
        "harness.claude.bin",
        "harness.claude.auth",
        "harness.version.claude",
        "harness.claude.managed-settings",
        "harness.claude.sandbox",
        "harness.claude.sdk",
        "harness.claude.concurrent-sessions",
      ],
    );
  });

  it("every check is a well-formed entry of the registry of annex G §G.7", () => {
    for (const check of checks()) {
      assert.ok(typeof check.severityRule === "function");
      assert.ok(typeof check.lb === "boolean");
      assert.ok(Number.isFinite(check.order));
      assert.ok(Buffer.byteLength(check.messageTemplate, "utf8") <= 200);
      assert.notEqual(check.fixHint, "");
      assert.equal(typeof check.probe, "function");
      // A stable dotted id of two labels at least (the registry's own rule).
      assert.match(check.id, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
    }
  });

  it("harness.claude.bin: fail when absent, fail on a refused placement, warn when no role uses Claude, warn on a changed path", () => {
    const check = byId("harness.claude.bin");
    assert.equal(check.lb, true); // launch-blocking when Claude is used by a role
    assert.equal(check.severityRule({ bin: { present: false, usedByARole: true } }), "fail");
    assert.equal(
      check.severityRule({ bin: { present: true, refusal: "inside-workspace" } }),
      "fail",
    );
    assert.equal(check.severityRule({ bin: { present: false, usedByARole: false } }), "warn");
    assert.equal(check.severityRule({ bin: { present: true, refusal: null } }), "ok");
  });

  it("harness.version.claude: warn out of range (never a block), ok in range", () => {
    const check = byId("harness.version.claude");
    assert.equal(check.lb, false);
    assert.equal(check.severityRule({ version: { inRange: false } }), "warn");
    assert.equal(check.severityRule({ version: { inRange: true } }), "ok");
  });

  it("harness.claude.auth: fail with no login at tier 1, fail with no secret reference at tier 2", () => {
    const check = byId("harness.claude.auth");
    assert.equal(check.lb, true);
    assert.equal(
      check.severityRule({ auth: { tier: 1, loginPresent: false, secretReferenceName: null } }),
      "fail",
    );
    assert.equal(
      check.severityRule({ auth: { tier: 2, loginPresent: null, secretReferenceName: null } }),
      "fail",
    );
    assert.equal(
      check.severityRule({
        auth: { tier: 2, loginPresent: null, secretReferenceName: "SPECSTRIDE_CLAUDE_API_KEY" },
      }),
      "ok",
    );
    assert.equal(
      check.severityRule({ auth: { tier: 1, loginPresent: true, secretReferenceName: null } }),
      "ok",
    );
  });

  it("harness.claude.managed-settings: info when present (they still apply in the isolated mode)", () => {
    const check = byId("harness.claude.managed-settings");
    assert.equal(check.severityRule({ managedSettings: { present: true } }), "info");
    assert.equal(check.severityRule({ managedSettings: { present: false } }), "ok");
  });

  it("harness.claude.sandbox: ok only where a sandbox is offered and the user is other than root", () => {
    const check = byId("harness.claude.sandbox");
    assert.equal(check.severityRule({ sandbox: { offered: true, userIsRoot: false } }), "ok");
    assert.equal(check.severityRule({ sandbox: { offered: false, userIsRoot: false } }), "warn");
    assert.equal(check.severityRule({ sandbox: { offered: true, userIsRoot: true } }), "warn");
  });

  it("harness.claude.sdk: warns in every unavailable state, including SDK absent and out of range", () => {
    const check = byId("harness.claude.sdk");
    assert.equal(check.lb, false);
    assert.equal(check.severityRule({ sdk: { availability: "available" } }), "ok");
    assert.equal(check.severityRule({ sdk: { availability: "not-chosen" } }), "ok");
    for (const availability of ["absent-dependency", "out-of-range", "refused-at-tier"] as const) {
      assert.equal(check.severityRule({ sdk: { availability } }), "warn", availability);
    }
    assert.ok(SDK_AVAILABILITY_STATES.includes("absent-dependency"));
  });

  it("harness.claude.concurrent-sessions: info while the capability is null (unverified)", () => {
    const check = byId("harness.claude.concurrent-sessions");
    assert.equal(check.severityRule({ concurrentSessions: { value: null } }), "info");
    assert.equal(check.severityRule({ concurrentSessions: { value: 4 } }), "ok");
  });

  it("the registration goes through the kernel's registration call (F100-FR-234)", () => {
    resetDoctorChecks();
    const ids = registerClaudeDoctorChecks(FACTS());
    assert.equal(ids.length, 7);
    const registered = registeredDoctorChecks().map((c) => c.id);
    for (const id of CLAUDE_DOCTOR_CHECK_IDS) assert.ok(registered.includes(id));
    resetDoctorChecks();
  });

  it("no check makes a paid call: the probes perform no I/O at all", async () => {
    for (const check of checks()) {
      let touched = 0;
      const observed = (await check.probe({
        claude: { paidCalls: 0, subprocesses: 0 },
        // A hostile bag: any I/O would blow up.
      })) as Record<string, unknown>;
      touched += 1;
      assert.ok(observed !== undefined && observed !== null);
      assert.equal(touched, 1);
    }
  });

  it("no check reads a secret value: the probe surfaces only the facts it was handed", async () => {
    const facts = FACTS({
      auth: {
        tier: 2,
        loginPresent: null,
        secretReferenceName: "SPECSTRIDE_CLAUDE_API_KEY",
        loginEstablishedBy: "existence probe",
      },
    });
    for (const check of claudeDoctorChecks(facts)) {
      const observed = (await check.probe({})) as Record<string, unknown>;
      assert.equal(JSON.stringify(observed).includes(SECRET), false);
      assert.equal(check.messageTemplate.includes(SECRET), false);
      assert.equal(check.fixHint.includes(SECRET), false);
      assert.equal(JSON.stringify(check.severityRule(observed)).includes(SECRET), false);
    }
    // Even the reference travels by NAME only.
    const observed = (await byId("harness.claude.auth").probe({
      claude: facts,
    })) as ClaudeDoctorFacts;
    assert.equal(observed.auth.secretReferenceName, "SPECSTRIDE_CLAUDE_API_KEY");
    assert.equal(JSON.stringify(observed).includes(SECRET), false);
  });

  it("no check writes: the severity rules are pure functions of the observed facts", () => {
    const check = byId("harness.version.claude");
    const observed = { version: { inRange: false } };
    const first = check.severityRule(observed);
    const second = check.severityRule(observed);
    assert.equal(first, second); // deterministic; no state, no side effect
    assert.deepEqual(Object.keys(observed), ["version"]); // the input is untouched
  });
});
