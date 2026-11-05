/**
 * T022 — the witness tests of the `host.*` doctor checks (F113-FR-033) and of
 * the background isolation warning (F113-FR-032).
 *
 * The registry the checks are registered into is a MINIMAL registry built to
 * the `DoctorRegistry` shape of `@specstride/contracts/ep/doctor` — the real
 * registry belongs to EP-14 (feature 112), whose package is still a skeleton.
 * The checks are held against the contract types either way.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_PROTOCOL_VERSION } from "@specstride/contracts/ep/host";
import type { DoctorCheck, DoctorFinding, DoctorRegistry } from "@specstride/contracts/ep/doctor";
import { MESSAGE_TEMPLATE_CAP_BYTES } from "@specstride/contracts/ep/doctor";
import {
  BACKGROUND_ISOLATION_CHECK,
  BACKGROUND_ISOLATION_WARNING,
  BACKGROUND_JOB_MODE_REJECTED,
  BACKGROUND_JOB_MODE_REJECTED_BECAUSE,
  CHECKED_PLUGIN_DIRECTORY,
  CLI_FOUND_CHECK,
  HOST_CHECK_IDS,
  HOST_CHECK_PREFIX,
  HOST_HOOKS_LOADED_CHECK,
  LAUNCH_CHECK_IDS,
  PLUGIN_VERSION_CHECK,
  PROTOCOL_SUPPORTED_CHECK,
  STATE_ROOT_WRITABLE_CHECK,
  hostDoctorChecks,
  hostLaunchChecks,
  isolationWarns,
  registerHostChecks,
} from "../src/doctor.ts";
import { pluginVersion } from "../src/packaging.ts";

/** A registry of EP-14's shape, recording what it is given. */
function aRegistry(): DoctorRegistry & { findings(): DoctorFinding[] } {
  const registered: DoctorCheck[] = [];
  return {
    register(check: DoctorCheck): void {
      registered.push(check);
    },
    registered(): readonly DoctorCheck[] {
      return [...registered];
    },
    async run(): Promise<readonly DoctorFinding[]> {
      return [];
    },
    findings(): DoctorFinding[] {
      return [];
    },
  };
}

test("the six checks of F113-FR-033 are registered with the prefix host.", () => {
  const registry = aRegistry();
  const registered = registerHostChecks(registry);
  assert.equal(registry.registered().length, 6);
  assert.deepEqual(
    registered.map((c) => c.id),
    [...HOST_CHECK_IDS],
  );
  for (const id of HOST_CHECK_IDS) assert.ok(id.startsWith(HOST_CHECK_PREFIX));
});

test("only a missing CLI is a launch check (F113-FR-033)", () => {
  const checks = hostDoctorChecks();
  assert.deepEqual(
    checks.filter((c) => c.lb).map((c) => c.id),
    [...LAUNCH_CHECK_IDS],
  );
  assert.deepEqual(
    hostLaunchChecks().map((c) => c.id),
    ["host.cli-found"],
  );
  for (const check of checks) {
    assert.ok(Buffer.byteLength(check.messageTemplate, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES);
    assert.equal(typeof check.fixHint, "string");
    assert.ok(check.fixHint.length > 0);
  }
});

test("the message templates stay under the cap of annex G §G.7", () => {
  for (const check of hostDoctorChecks()) {
    assert.ok(
      Buffer.byteLength(check.messageTemplate, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES,
      `${check.id} is over the message cap`,
    );
  }
});

test("host.cli-found fails when the CLI is missing and passes when it is found", async () => {
  assert.equal(CLI_FOUND_CHECK.severityRule(true), "ok");
  assert.equal(CLI_FOUND_CHECK.severityRule(false), "fail");
  assert.equal(CLI_FOUND_CHECK.severityRule(undefined), "warn");
  // The probe is asynchronous (the shape of annex G §G.7), so it is awaited.
  assert.equal(await CLI_FOUND_CHECK.probe({ "cli-found": false }), false);
  assert.equal(await CLI_FOUND_CHECK.probe({ "cli-found": true }), true);
});

test("host.protocol-supported holds the observed protocol against the CLI protocol of the annex", () => {
  assert.equal(PROTOCOL_SUPPORTED_CHECK.severityRule(CLI_PROTOCOL_VERSION), "ok");
  assert.equal(PROTOCOL_SUPPORTED_CHECK.severityRule(99), "fail");
});

test("host.plugin-version holds the plugin version against the package version (F113-FR-030)", () => {
  assert.equal(PLUGIN_VERSION_CHECK.severityRule(pluginVersion()), "ok");
  assert.equal(PLUGIN_VERSION_CHECK.severityRule("9.9.9"), "fail");
});

test("host.host-hooks-loaded warns when nothing was observed", () => {
  assert.equal(HOST_HOOKS_LOADED_CHECK.severityRule(true), "ok");
  assert.equal(HOST_HOOKS_LOADED_CHECK.severityRule(false), "fail");
  assert.equal(HOST_HOOKS_LOADED_CHECK.severityRule(undefined), "warn");
});

test("host.state-root-writable warns on the unverified observation of F113-FR-028", () => {
  assert.equal(STATE_ROOT_WRITABLE_CHECK.severityRule("unverified"), "warn");
  assert.equal(STATE_ROOT_WRITABLE_CHECK.severityRule(true), "ok");
  assert.equal(STATE_ROOT_WRITABLE_CHECK.severityRule(false), "fail");
});

test("host.background-isolation WARNS when the host isolates the working tree (F113-FR-032)", () => {
  assert.equal(BACKGROUND_ISOLATION_CHECK.severityRule(true), "warn");
  assert.equal(BACKGROUND_ISOLATION_CHECK.severityRule(false), "ok");
  assert.equal(BACKGROUND_ISOLATION_CHECK.lb, false, "the isolation warning never blocks a launch");
  assert.equal(BACKGROUND_ISOLATION_CHECK.messageTemplate, BACKGROUND_ISOLATION_WARNING);
  assert.equal(isolationWarns(true), true);
});

test("the host's background job mode is rejected as the runtime (F113-FR-032)", () => {
  assert.equal(BACKGROUND_JOB_MODE_REJECTED, true);
  assert.match(BACKGROUND_JOB_MODE_REJECTED_BECAUSE, /--exec/);
  assert.equal(CHECKED_PLUGIN_DIRECTORY, "plugin");
});
