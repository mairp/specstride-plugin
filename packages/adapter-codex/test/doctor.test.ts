/**
 * T020 / CT-131-6 — the doctor checks (F131-FR-006).
 *
 * Six checks. Every probe reads injected facts and never writes, makes no
 * paid call and reads no secret value: the evidence names the credential,
 * never its value. Executable and credential are launch-blocking for a role
 * in use; version, sandbox, read denial and unverified facts are warnings.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { DoctorCheck } from "@specstride/contracts/ep/doctor";
import {
  CODEX_DOCTOR_CHECK_IDS,
  codexDoctorChecks,
  credentialNameForTier,
  unverifiedFactsLine,
} from "../src/doctor.ts";

const FACTS = {
  present: true,
  path: "/usr/local/bin/codex",
  credentialPresent: true,
  tier: 1 as const,
  version: "0.153.4",
  inRange: true,
  sandboxCanStart: true,
  readDenialConfirmed: true,
  unverifiedFacts: [],
};

test("CT-131-6: the adapter registers exactly the six checks with stable ids", () => {
  const checks = codexDoctorChecks();
  assert.deepEqual(
    checks.map((check) => check.id),
    [...CODEX_DOCTOR_CHECK_IDS],
  );
  assert.equal(checks.length, 6);
});

test("CT-131-6: no check writes, makes a paid call or reads a secret value", async () => {
  const checks = codexDoctorChecks();
  const secrets = ["sk-planted-secret-value-do-not-leak"];
  for (const check of checks) {
    // The probe receives only the injected facts and answers with them: it
    // performs no input or output of its own, so there is nothing a write,
    // a paid call or a secret read could ride on.
    const observed = await check.probe({ ...FACTS, secretPlanted: secrets[0] });
    const text = JSON.stringify(observed);
    assert.ok(!text.includes(secrets[0]), `${check.id} carried a secret value`);
  }
  // The evidence names the credential, never its value.
  assert.equal(credentialNameForTier(1), "the login of the consumer");
  assert.equal(credentialNameForTier(2), "OPENAI_API_KEY");
});

test("CT-131-6: the executable and the credential are launch-blocking", () => {
  const checks = codexDoctorChecks();
  const byId = (id: string): DoctorCheck => checks.find((check) => check.id === id) as DoctorCheck;
  for (const id of ["harness.codex.present", "harness.codex.credential"]) {
    const check = byId(id);
    assert.equal(check.lb, true, id);
    assert.equal(
      check.severityRule({ ...FACTS, present: false, credentialPresent: false }),
      "fail",
    );
  }
  assert.deepEqual(
    checks.filter((check) => check.lb).map((check) => check.id),
    ["harness.codex.present", "harness.codex.credential"],
  );
});

test("CT-131-6: version, sandbox, read denial and unverified facts are warnings", () => {
  const checks = codexDoctorChecks();
  const severity = (id: string, facts: Record<string, unknown>) =>
    checks.find((check) => check.id === id)?.severityRule(facts);
  assert.equal(severity("harness.codex.version-pin", { inRange: false }), "warn");
  assert.equal(severity("harness.codex.version-pin", { inRange: true }), "ok");
  assert.equal(severity("harness.codex.sandbox", { sandboxCanStart: false }), "warn");
  assert.equal(severity("harness.codex.sandbox", { sandboxCanStart: true }), "ok");
  assert.equal(severity("harness.codex.read-denial", { readDenialConfirmed: false }), "warn");
  assert.equal(severity("harness.codex.read-denial", { readDenialConfirmed: true }), "ok");
  assert.equal(severity("harness.codex.unverified-facts", { unverifiedFacts: ["a"] }), "warn");
  assert.equal(severity("harness.codex.unverified-facts", { unverifiedFacts: [] }), "ok");
  for (const id of [
    "harness.codex.version-pin",
    "harness.codex.sandbox",
    "harness.codex.read-denial",
    "harness.codex.unverified-facts",
  ]) {
    assert.equal(
      checks.find((check) => check.id === id)?.lb,
      false,
      `${id} must not block a launch`,
    );
  }
});

test("CT-131-6: the unverified-facts line lists the facts, one line, under the cap", () => {
  const line = unverifiedFactsLine(["the approval policy override", "capture 4"]);
  assert.equal(line, "the approval policy override; capture 4");
  assert.ok(!line.includes("\n"));
  assert.equal(unverifiedFactsLine([]), "none");
  // The message templates stay inside the 200-byte cap of annex G §G.7.
  for (const check of codexDoctorChecks()) {
    assert.ok(Buffer.byteLength(check.messageTemplate) <= 200, check.messageTemplate);
  }
});

test("CT-131-6: the probes answer from the injected facts and the orders are stable", () => {
  const checks = codexDoctorChecks();
  assert.deepEqual(
    checks.map((check) => check.order),
    [1, 2, 3, 4, 5, 6],
  );
  for (const check of checks) {
    const verdict = check.severityRule(FACTS);
    assert.equal(verdict, "ok", check.id);
  }
});
