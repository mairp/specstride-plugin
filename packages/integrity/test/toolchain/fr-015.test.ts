// CT-116-15 (F116-FR-015): basic protection without a profile; the doctor
// names the toolchain.
//
// A toolchain without a profile has the basic protection only: class A holds
// the executables and the files the check manifest names and the files its
// derivation reads, class B is empty, no cache is handled and no marker is
// counted. The doctor names the toolchains a run detected and which of them
// have no profile; the fact that the basic protection applied is recorded
// with the protected set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo } from "../protected/helpers.ts";
import { basicProtection } from "../../src/toolchain/basic.ts";
import {
  createToolchainDoctorCheck,
  toolchainFindings,
  DOCTOR_CHECK_ID,
  type ToolchainDoctorObserved,
} from "../../src/toolchain/doctor-check.ts";
import { detectToolchains } from "../../src/toolchain/load.ts";
import { captureAtLaunch } from "../../src/protected/entry.ts";

test("CT-116-15 the basic protection: class A from the manifest, class B empty, no cache, no marker", () => {
  const basic = basicProtection({
    manifestFiles: ["vitest.config.ts", "scripts/check.mjs"],
    derivationFiles: ["package.json"],
  });
  assert.equal(basic.basic, true);
  assert.deepEqual(basic.classA, ["package.json", "scripts/check.mjs", "vitest.config.ts"]);
  assert.deepEqual(basic.classB, []);
  assert.equal(basic.cachesHandled, false);
  assert.equal(basic.markersCounted, false);
});

test("CT-116-15 detection without a profile finds the toolchain by its manifest", () => {
  const detected = detectToolchains({
    files: ["package.json", "vitest.config.ts"],
    shippedProfiles: [],
  });
  assert.deepEqual(detected, [{ id: "vitest", fromProfile: null }]);
});

test("CT-116-15 the doctor names the toolchains detected and which have no profile", async () => {
  const observed: ToolchainDoctorObserved = {
    detected: ["vitest", "fictional-15"],
    withProfile: ["vitest"],
    withoutProfile: ["fictional-15"],
    projectConfigProfiles: [],
  };
  const findings = toolchainFindings(observed);
  assert.ok(
    findings.some((f) => f.includes("fictional-15") && f.includes("no profile")),
    JSON.stringify(findings),
  );
  assert.ok(findings.some((f) => f.includes("basic protection")));

  const check = createToolchainDoctorCheck();
  assert.equal(check.id, DOCTOR_CHECK_ID);
  assert.equal(check.lb, false);
  const probeOutcome = await check.probe({ observed });
  assert.deepEqual(probeOutcome, observed);
});

test("CT-116-15 the doctor warns of a profile given in project configuration", () => {
  const findings = toolchainFindings({
    detected: ["fictional-15"],
    withProfile: ["fictional-15"],
    withoutProfile: [],
    projectConfigProfiles: ["fictional-15"],
  });
  assert.ok(
    findings.some((f) => f.includes("project configuration") && f.includes("fictional-15")),
    JSON.stringify(findings),
  );
});

test("CT-116-15 the basic protection is recorded with the protected set", async () => {
  const root = makeRepo({});
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  writeFileSync(join(root, "tests", "a.test.ts"), "import { test } from 'node:test';\n");
  const basic = basicProtection({ manifestFiles: ["vitest.config.ts"], derivationFiles: [] });
  const record = await captureAtLaunch({
    phase: 1,
    root,
    profiles: [],
    basic: basic.basic,
  });
  assert.equal(record.basic, true);
});
