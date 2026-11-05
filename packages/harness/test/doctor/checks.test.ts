/**
 * T095 — CT-109-24: the three doctor checks per harness (F109-FR-024).
 *
 * Stable ids; three checks for every harness; the third check reports that no
 * pin exists for a harness that is not tested; no check makes a paid call and
 * no check carries a secret VALUE.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerDoctorCheck, resetDoctorChecks, registeredDoctorChecks } from "@specstride/kernel";
import {
  HARNESS_DOCTOR_CHECK_KINDS,
  findingOf,
  harnessDoctorCheckIds,
  harnessDoctorChecks,
  registerHarnessDoctorChecks,
  runHarnessDoctorChecks,
} from "../../src/doctor/checks.ts";

const TESTED = {
  harness: "example-cli",
  tested: true,
  present: true,
  credentialPresent: true,
  credentialName: "EXAMPLE_CLI_KEY",
  credentialFix: "set EXAMPLE_CLI_KEY in the environment the allow-list carries",
  version: "1.4.2",
  versionRange: ">=1.0.0 <2.0.0",
};

const UNTESTED = {
  harness: "my-harness",
  tested: false,
  present: true,
  credentialPresent: false,
  credentialName: "MY_HARNESS_KEY",
  credentialFix: "set MY_HARNESS_KEY in the environment the allow-list carries",
  version: "9.9.9",
  versionRange: null,
};

test("CT-109-24: three checks per harness, with stable ids derived from the harness id", () => {
  assert.deepEqual(HARNESS_DOCTOR_CHECK_KINDS, ["present", "credential", "version-pin"]);
  assert.deepEqual(harnessDoctorCheckIds("example-cli"), [
    "harness.example-cli.present",
    "harness.example-cli.credential",
    "harness.example-cli.version-pin",
  ]);
  // Stable: the id is a pure function of the harness id and the kind — two
  // calls, and the ids are the same.
  assert.deepEqual(harnessDoctorCheckIds("example-cli"), harnessDoctorCheckIds("example-cli"));
  // And every harness gets exactly three checks.
  assert.equal(harnessDoctorChecks(TESTED).length, 3);
  assert.equal(harnessDoctorChecks(UNTESTED).length, 3);
});

test("CT-109-24: registration registers the three checks of a harness", () => {
  resetDoctorChecks();
  const ids = registerHarnessDoctorChecks(registerDoctorCheck, TESTED);
  assert.deepEqual(ids, harnessDoctorCheckIds("example-cli"));
  const registered = registeredDoctorChecks().map((check) => check.id);
  assert.deepEqual(registered, harnessDoctorCheckIds("example-cli"));
  // Idempotent: registering again replaces, never duplicates.
  registerHarnessDoctorChecks(registerDoctorCheck, TESTED);
  assert.equal(registeredDoctorChecks().length, 3);
  resetDoctorChecks();
});

test("CT-109-24: the pin check of a harness that is not tested reports that no pin exists", async () => {
  const findings = await runHarnessDoctorChecks(UNTESTED);
  const pin = findings[2];
  assert.equal(pin.id, "harness.my-harness.version-pin");
  assert.equal(pin.severity, "info");
  assert.match(pin.message, /no version pin exists/);
  // The same check for a tested harness judges the range: inside is ok.
  const testedFindings = await runHarnessDoctorChecks(TESTED);
  assert.equal(testedFindings[2].severity, "ok");
  assert.match(testedFindings[2].message, /inside the pinned range/);
  // Outside the range it warns (never fails, never downloads).
  const outside = await runHarnessDoctorChecks({ ...TESTED, version: "3.0.0" });
  assert.equal(outside[2].severity, "warn");
  assert.match(outside[2].message, /outside the pinned range/);
});

test("CT-109-24: a missing executable or credential fails, and the fix is named", async () => {
  const missing = await runHarnessDoctorChecks({
    ...TESTED,
    present: false,
    credentialPresent: false,
  });
  assert.equal(missing[0].severity, "fail");
  assert.match(missing[0].message, /not present/);
  assert.equal(missing[1].severity, "fail");
  assert.match(missing[1].message, /EXAMPLE_CLI_KEY/);
  assert.match(missing[1].fix, /EXAMPLE_CLI_KEY/);
});

test("CT-109-24: no check makes a paid call and no check carries a secret value", async () => {
  const SECRET_VALUE = "sk-super-secret-value-9f2a";
  const facts = {
    ...TESTED,
    // The facts carry the NAME of the credential; a value has no field at all.
    credentialName: "EXAMPLE_CLI_KEY",
    credentialValue: SECRET_VALUE, // an unknown field a caller might add
  } as typeof TESTED & { credentialValue: string };
  const checks = harnessDoctorChecks(facts);
  // Every probe resolves over the injected facts alone: no awaitable I/O, no
  // network handle, nothing to pay with.
  for (const check of checks) {
    const observed = await check.probe({});
    const text = JSON.stringify({
      observed,
      fixHint: check.fixHint,
      template: check.messageTemplate,
    });
    assert.ok(!text.includes(SECRET_VALUE), `the check ${check.id} carried the secret value`);
    const finding = findingOf(check, observed, "x");
    assert.ok(
      !JSON.stringify(finding).includes(SECRET_VALUE),
      `the finding of ${check.id} carried the secret value`,
    );
  }
  const findings = await runHarnessDoctorChecks(facts);
  assert.ok(!JSON.stringify(findings).includes(SECRET_VALUE));
  // The evidence names the credential, not its value.
  assert.match(findings[1].evidence, /credential=EXAMPLE_CLI_KEY/);
});
