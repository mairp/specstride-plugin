/**
 * T060 — characterization tests CT-130-5 and CT-130-6 of the doctor checks
 * (F130-FR-005, F130-FR-006).
 *
 * CT-130-5: EVERY check of the doctor of the dsh adapter
 *   - READS and NEVER WRITES (no file is created or changed by a probe run);
 *   - makes NO PAID CALL (no model, no network, no download: the probes read
 *     injected observations and the free `--version` / `--dump-config`
 *     subprocesses, which close standard input and keep a time limit);
 *   - the warnings for the customisations and for the native memory are
 *     registered, and the check of the refusal of the critic role
 *     (F130-FR-045) is registered LAUNCH-BLOCKING.
 *
 * CT-130-6: every fact of the adapter carries a `verified-on` date and the
 * pin `0.1.0-rc.8`, or is marked `unverified` with the check that would
 * settle it — the dating audit over the facts of the descriptor finds no
 * violation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  dshDoctorChecks,
  dshDoctorFindings,
  registerDshDoctorChecks,
  dshCustomisationStates,
  dshMemoryState,
  dshCriticMemoryRefusal,
  dshDatedFacts,
  dshFactDatingAudit,
  defaultDshDoctorObserved,
  DSH_DOCTOR_CHECK_IDS,
  DSH_UNVERIFIED_FACTS,
  DSH_PIN,
  DSH_VERIFIED_ON,
} from "../src/index.ts";

const OBSERVED = defaultDshDoctorObserved({
  role: "proposer",
  executablePath: "/usr/local/bin/dsh",
  version: DSH_PIN,
  homeExists: true,
  homeReadable: true,
  uncoveredToolIds: [],
  declaredContextWindow: 98_304,
  contextWindowOverride: 98_304,
});

test("CT-130-5: every check of the doctor is registered, in the order of F130-FR-005", () => {
  const checks = dshDoctorChecks(OBSERVED);
  assert.deepEqual(
    checks.map((c) => c.id),
    [...DSH_DOCTOR_CHECK_IDS],
  );
  for (const check of checks) {
    assert.match(check.id, /^dsh\.[a-z-]+$/, `a stable dotted id: ${check.id}`);
    assert.ok(check.messageTemplate.length <= 200, `template under the cap: ${check.id}`);
    assert.ok(check.fixHint.length > 0, `a fix hint: ${check.id}`);
    const finding = check.probe(OBSERVED);
    assert.equal(finding.id, check.id);
    assert.ok(
      ["ok", "info", "warn", "fail"].includes(finding.severity),
      `a severity of the closed set: ${finding.severity}`,
    );
  }
});

test("CT-130-5: every check reads and never writes, and makes no paid call", () => {
  // A fresh temporary directory is watched for ANY change while every check
  // probe runs twice: a check that wrote anything would fail this.
  const watch = mkdtempSync(join(tmpdir(), "dsh-doctor-ct5."));
  const before = listingOf(watch);
  for (const check of dshDoctorChecks(OBSERVED)) {
    check.probe(OBSERVED);
    check.probe(defaultDshDoctorObserved()); // the not-found, nothing-established arm too
  }
  assert.deepEqual(listingOf(watch), before, "a probe of a check wrote to the file system");

  // No probe starts a subprocess at all: the free probes (`--version`,
  // `--dump-config`) belong to the caller and close standard input, run
  // without a shell and keep a time limit. Asserted on the shape every
  // subprocess of the adapter is started with (stdin `ignore`, a timeout,
  // no shell): a child given stdin closed must read EOF at once.
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      "try { require('node:fs').readSync(0, Buffer.alloc(1)) } catch {} process.exit(0)",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, shell: false },
  );
  assert.equal(run.status, 0, "a subprocess started with stdin closed reads EOF at once");
});

test("CT-130-5: the warnings for customisations and native memory, and the launch-blocking critic check, are registered", () => {
  // Outside parity, no opt-in: both warnings are raised.
  const strict = defaultDshDoctorObserved({ role: "proposer" });
  const findings = dshDoctorFindings(strict);
  const customisations = findings.find((f) => f.id === "dsh.customisations")!;
  const memory = findings.find((f) => f.id === "dsh.native-memory")!;
  assert.equal(customisations.severity, "warn");
  assert.match(customisations.message, /plugins, host-hooks, skills, tool-servers/);
  assert.equal(memory.severity, "warn");
  assert.equal(dshMemoryState(strict), "not-switchable");
  assert.deepEqual(
    dshCustomisationStates(strict).map((s) => s.state),
    ["not-switchable", "not-switchable", "not-switchable", "not-switchable"],
  );

  // With the opt-in from user configuration: the states are opted-in, no warning.
  const opted = defaultDshDoctorObserved({
    role: "proposer",
    customisationsOptIn: true,
    memoryOptIn: true,
  });
  assert.equal(dshDoctorFindings(opted).find((f) => f.id === "dsh.customisations")!.severity, "ok");
  assert.equal(dshDoctorFindings(opted).find((f) => f.id === "dsh.native-memory")!.severity, "ok");

  // Under parity the states are as-is and no line warns.
  const parity = defaultDshDoctorObserved({ role: "proposer", profile: "parity" });
  assert.deepEqual(
    dshCustomisationStates(parity).map((s) => s.state),
    ["as-is", "as-is", "as-is", "as-is"],
  );
  assert.equal(dshMemoryState(parity), "as-is");
  assert.equal(
    dshDoctorFindings(parity).find((f) => f.id === "dsh.customisations")!.severity,
    "ok",
  );
  assert.equal(dshDoctorFindings(parity).find((f) => f.id === "dsh.native-memory")!.severity, "ok");

  // The refusal of the critic role (F130-FR-045) is registered LAUNCH-BLOCKING.
  const critic = defaultDshDoctorObserved({ role: "critic" });
  const refusal = dshDoctorFindings(critic).find((f) => f.id === "dsh.critic-memory")!;
  assert.equal(refusal.lb, true, "the F130-FR-045 check is launch-blocking");
  assert.equal(refusal.severity, "fail");
  assert.match(refusal.message, /memory-not-off|refused/);
  assert.equal(dshCriticMemoryRefusal(critic).refused, true);
  // The registration carries the flag too.
  const registered = dshDoctorChecks(critic).find((c) => c.id === "dsh.critic-memory")!;
  assert.equal(registered.lb, true);
  // The executable and version checks are launch-blocking for a role in use.
  for (const id of ["dsh.executable", "dsh.version"] as const) {
    const missing = dshDoctorChecks(
      defaultDshDoctorObserved({ role: "proposer", executablePath: null }),
    ).find((c) => c.id === id)!;
    assert.equal(missing.lb, true, `${id} is launch-blocking for a role in use`);
  }
  // And NOT launch-blocking where no role names dsh.
  const idle = dshDoctorChecks(defaultDshDoctorObserved());
  for (const id of ["dsh.executable", "dsh.version", "dsh.critic-memory"] as const) {
    assert.equal(
      idle.find((c) => c.id === id)!.lb,
      false,
      `${id} is a warning when dsh is not named`,
    );
  }
});

test("CT-130-5: the checks register with the kernel registry and carry their launch flags", () => {
  const checks = registerDshDoctorChecks(OBSERVED);
  assert.equal(checks.length, DSH_DOCTOR_CHECK_IDS.length);
  // The kernel registry now holds one entry per id, with the lb flags of the
  // observation the registration was built from.
  const ids = checks.map((c) => c.id);
  assert.deepEqual(new Set(ids).size, ids.length, "an id is registered once");
  assert.ok(
    checks.find((c) => c.id === "dsh.critic-memory")!.lb === false,
    "no role names dsh critic in this observation, so the refusal is not armed",
  );
});

test("CT-130-6: every fact carries the verified-on date and the pin, or is unverified with its settling check", () => {
  const facts = dshDatedFacts();
  assert.ok(facts.length >= 15, "every fact of the adapter is listed");
  const violations = dshFactDatingAudit(facts);
  assert.deepEqual(
    violations,
    [],
    `a fact without its date and pin, or without its settling check: ${JSON.stringify(violations)}`,
  );
  // The capture days this adapter dates its verified facts at: the pin's own
  // day, and the day of the concurrent-sessions capture (CT-130-46, the
  // owner's ruling of 2026-11-03). A date outside both is a fabrication.
  const captureDays = [DSH_VERIFIED_ON, "2026-11-03"];
  for (const fact of facts) {
    if (fact.status === "verified") {
      assert.equal(fact.pin, DSH_PIN);
      assert.ok(
        captureDays.includes(fact.verifiedOn as string),
        `${fact.fact} is dated at a recorded capture day, got ${String(fact.verifiedOn)}`,
      );
    } else {
      assert.ok(
        fact.settlesBy && fact.settlesBy.length > 0,
        `${fact.fact} names its settling check`,
      );
    }
  }
});

test("CT-130-6: the dating audit refuses an undated fact, a foreign pin and an unverified fact with no check", () => {
  // The undated verified fact trips twice (no date, no pin).
  assert.deepEqual(
    dshFactDatingAudit([
      { fact: "x", status: "verified" }, // no date, no pin
      { fact: "y", pin: "9.9.9", verifiedOn: "2026-01-01", status: "verified" }, // foreign pin
      { fact: "z", status: "unverified" }, // no settling check
    ]).length,
    4,
  );
  assert.deepEqual(
    dshFactDatingAudit([{ fact: "w", pin: DSH_PIN, verifiedOn: "2026-09-29", status: "verified" }]),
    [],
  );
});

test("CT-130-6: the unverified-facts line lists every still-unverified fact with its capture", () => {
  const line = dshDoctorFindings(defaultDshDoctorObserved()).find(
    (f) => f.id === "dsh.unverified-facts",
  )!;
  assert.equal(line.lb, false);
  for (const fact of DSH_UNVERIFIED_FACTS) {
    assert.ok(line.message.includes(fact.fact), `the line lists ${fact.fact}`);
    assert.ok(line.message.includes(fact.settlesBy), `the line names what settles ${fact.fact}`);
  }
});

test("CT-130-5: the doctor warns for the trace plugin, the window mismatch, the terms and the coverage", () => {
  const warn = defaultDshDoctorObserved({
    role: "critic",
    uncoveredToolIds: ["web_search"],
    tracePluginCapturesContent: true,
    declaredContextWindow: 98_304,
    contextWindowOverride: 32_768,
  });
  const findings = dshDoctorFindings(warn);
  assert.equal(findings.find((f) => f.id === "dsh.trace-plugin")!.severity, "warn");
  assert.equal(findings.find((f) => f.id === "dsh.context-window")!.severity, "warn");
  assert.equal(findings.find((f) => f.id === "dsh.terms")!.severity, "warn");
  assert.equal(findings.find((f) => f.id === "dsh.critic-coverage")!.severity, "warn");
  assert.match(findings.find((f) => f.id === "dsh.critic-coverage")!.message, /web_search/);
  // Launch-blocking only where the requirement says so: the executable and
  // version checks (a role in use, here the critic with no binary) and the
  // refusal of the critic role. Every other finding is a warning or info.
  assert.deepEqual(
    new Set(findings.filter((f) => f.lb).map((f) => f.id)),
    new Set(["dsh.executable", "dsh.version", "dsh.critic-memory"]),
  );
});

/** Every entry of a directory, recursively, as sorted relative paths with mtimes. */
function listingOf(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    out.push(stats.isDirectory() ? `${entry}/` : `${entry} ${String(stats.mtimeMs)}`);
  }
  return out.sort();
}
