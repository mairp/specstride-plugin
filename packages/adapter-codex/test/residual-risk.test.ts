/**
 * T041 / CT-131-23 — the exception and the residual risk of form (a)
 * (F131-FR-023).
 *
 * The descriptor, what `capabilities` reports for the form, and the doctor
 * all state that form (a) is a stated exception to Principles III and IX,
 * limited to reading project files, and state the residual risk: repository
 * text reaches this critic without passing the grounding snapshot. The
 * owner accepted the risk (ruling 57a; threat T-48).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORM_A_DOCTOR_STATEMENT, codexDoctorChecks } from "../src/doctor.ts";
import { criticFormARiskReport } from "../src/capabilities.ts";
import {
  FORM_A_EXCEPTION,
  FORM_A_RESIDUAL_RISK,
  formARiskStatement,
} from "../src/critic-readonly.ts";
import type { CodexDescriptor } from "../src/capabilities.ts";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESCRIPTOR = JSON.parse(
  readFileSync(join(PACKAGE, "data", "descriptor.json"), "utf8"),
) as CodexDescriptor;

function readonlySandboxForm(): Record<string, unknown> {
  const roles = DESCRIPTOR.roles as {
    critic: { forms: Record<string, Record<string, unknown>> };
  };
  return roles.critic.forms["readonly-sandbox"];
}

test("CT-131-23: the descriptor states the exception and the residual risk for form (a)", () => {
  const form = readonlySandboxForm();
  assert.equal(form["sandboxMode"], "read-only");
  assert.match(String(form["exception"]), /exception to Principles III and IX/);
  assert.match(String(form["exception"]), /reading project files/);
  assert.match(
    String(form["residualRisk"]),
    /repository text reaches this critic without passing the grounding snapshot/,
  );
  assert.equal(form["ruling"], "57a");
  assert.equal(form["threat"], "T-48");
  // The fact carries its date and pin, like every descriptor fact.
  assert.equal(form["verifiedOn"], "2026-09-29");
  assert.equal(form["pin"], "codex-cli 0.153.4");
});

test("CT-131-23: capabilities reports the exception and the residual risk for the form", () => {
  const report = criticFormARiskReport(DESCRIPTOR);
  assert.equal(report.form, "readonly-sandbox");
  assert.match(report.exception, /exception to Principles III and IX/);
  assert.match(report.residualRisk, /grounding snapshot/);
  assert.equal(report.ruling, "57a");
  assert.equal(report.threat, "T-48");
  assert.equal(report.source, "descriptor", "the report takes the descriptor's own statement");
});

test("CT-131-23: the doctor states the exception and the residual risk", () => {
  assert.match(FORM_A_DOCTOR_STATEMENT, /exception to Principles III and IX/);
  assert.match(FORM_A_DOCTOR_STATEMENT, /grounding snapshot/);
  assert.match(FORM_A_DOCTOR_STATEMENT, /57a/);
  assert.match(FORM_A_DOCTOR_STATEMENT, /T-48/);
  const check = codexDoctorChecks().find((one) => one.id === "harness.codex.read-denial");
  assert.ok(check, "the read-denial check is registered");
  assert.match(check!.fixHint, /Principles III and IX/);
  assert.match(check!.fixHint, /grounding snapshot/);
});

test("CT-131-23: the adapter's own statement matches the descriptor's, limited to reading project files", () => {
  const statement = formARiskStatement();
  assert.equal(statement.exception, FORM_A_EXCEPTION);
  assert.equal(statement.residualRisk, FORM_A_RESIDUAL_RISK);
  assert.match(FORM_A_EXCEPTION, /limited to reading project files/);
  const descriptor = readonlySandboxForm();
  // Same residual risk in the data and in the code.
  assert.ok(
    String(descriptor["residualRisk"]).includes("grounding snapshot") &&
      FORM_A_RESIDUAL_RISK.includes("grounding snapshot"),
  );
});
