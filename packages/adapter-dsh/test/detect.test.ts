/**
 * T011 — characterization tests CT-130-2 and CT-130-3
 * (F130-FR-002, F130-FR-003).
 *
 * CT-130-2 — detection: the executable is resolved to an ABSOLUTE path
 * (F100-FR-080), the pin is the EXACT version `0.1.0-rc.8` (no range), each
 * pass records the harness version, a change of version between two passes of
 * one run is a warning, and a version other than the pin warns for the
 * proposer and fails for the critic. Not found is the result code 127 with the
 * as-is message. Detection is free of charge: only `--version` runs.
 *
 * CT-130-3 — the statement of `capabilities`: every capability is reported
 * with its provenance or as null, and a capability that no run has shown is
 * marked `unverified`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectDsh,
  dshPinState,
  dshVersionChangeWarning,
  dshVersionRecord,
  dshHomeState,
  DSH_PIN,
  DSH_VERIFIED_ON,
} from "../src/detect/index.ts";
import {
  dshCapabilities,
  dshCustomisations,
  dshIdentityOfQualifier,
} from "../src/descriptor/index.ts";

// ---------------------------------------------------------------- CT-130-2

test("CT-130-2: detection resolves the executable to an absolute path (F100-FR-080)", () => {
  const detection = detectDsh({
    path: "/usr/local/bin:/usr/bin",
    exists: (dir, name) => dir === "/usr/bin" && name === "dsh",
    probeVersion: () => DSH_PIN,
    home: "/tmp/fx-home",
  });
  assert.equal(detection.ok, true);
  assert.equal(detection.ok && detection.path, "/usr/bin/dsh");
  assert.ok(detection.ok && detection.path.startsWith("/"), "the path is absolute");
});

test("CT-130-2: detection reads the version with --version and nothing else", () => {
  let probes = 0;
  const detection = detectDsh({
    path: "/usr/bin",
    exists: () => true,
    probeVersion: (path) => {
      probes += 1;
      assert.equal(path, "/usr/bin/dsh");
      return "0.1.0-rc.8";
    },
    home: "/tmp/fx-home",
  });
  assert.equal(probes, 1, "exactly one version probe ran");
  assert.ok(detection.ok && detection.version === "0.1.0-rc.8");
});

test("CT-130-2: the pin is the exact version, verified-on 2026-09-29; no range", () => {
  assert.equal(DSH_PIN, "0.1.0-rc.8");
  assert.equal(DSH_VERIFIED_ON, "2026-09-29");
  assert.equal(dshPinState("0.1.0-rc.8", "proposer"), "pin");
  assert.equal(dshPinState("0.1.0-rc.8", "critic"), "pin");
  assert.equal(dshPinState("0.1.0-rc.9", "proposer"), "warn");
  assert.equal(dshPinState("0.1.0-rc.9", "critic"), "fail");
  assert.equal(dshPinState(null, "critic"), "fail");
});

test("CT-130-2: a version other than the pin warns for the proposer and fails for the critic", () => {
  const proposer = detectDsh({
    path: "/usr/bin",
    exists: () => true,
    probeVersion: () => "0.2.0",
    role: "proposer",
    home: "/tmp/fx-home",
  });
  const critic = detectDsh({
    path: "/usr/bin",
    exists: () => true,
    probeVersion: () => "0.2.0",
    role: "critic",
    home: "/tmp/fx-home",
  });
  assert.ok(proposer.ok && proposer.pinState === "warn");
  assert.ok(critic.ok && critic.pinState === "fail");
});

test("CT-130-2: the version is recorded per pass, with the pin", () => {
  const record = dshVersionRecord({
    path: "/usr/bin/dsh",
    version: "0.1.0-rc.8",
    role: "proposer",
  });
  assert.equal(record.recordedOnPass, true);
  assert.equal(record.path, "/usr/bin/dsh");
  assert.equal(record.version, "0.1.0-rc.8");
  assert.equal(record.pin, "0.1.0-rc.8");
  assert.equal(record.pinState, "pin");
});

test("CT-130-2: a change of version between two passes of one run is a warning", () => {
  const warning = dshVersionChangeWarning("0.1.0-rc.8", "0.1.0-rc.9");
  assert.ok(warning !== null);
  assert.match(warning!, /0\.1\.0-rc\.8 -> 0\.1\.0-rc\.9/);
  assert.equal(dshVersionChangeWarning("0.1.0-rc.8", "0.1.0-rc.8"), null);
  assert.equal(dshVersionChangeWarning(null, "0.1.0-rc.8"), null);
  assert.equal(dshVersionChangeWarning("0.1.0-rc.8", null), null);
});

test("CT-130-2: the executable not found is the result code 127 with the as-is message", () => {
  const detection = detectDsh({ path: "/usr/bin", exists: () => false });
  assert.equal(detection.ok, false);
  assert.ok(!detection.ok && "code" in detection && detection.code === 127);
  assert.ok(!detection.ok && detection.message === "DeepSeek Harness not found: dsh");
});

test("CT-130-2: detection reports the state of the configuration home, free of charge", () => {
  const state = dshHomeState("/tmp/ct130-home-does-not-exist");
  assert.equal(state.variable, "DSH_HOME");
  assert.equal(state.exists, false);
  assert.equal(state.readable, false);
  const present = dshHomeState(import.meta.dirname ?? ".");
  assert.equal(present.exists, true);
  assert.equal(present.readable, true);
});

// ---------------------------------------------------------------- CT-130-3

test("CT-130-3: every capability carries a provenance or a null value", () => {
  const { capabilities } = dshCapabilities({ qualifier: "deepseek/chat" });
  for (const capability of capabilities) {
    if (capability.value === null || capability.value === "unverified") {
      // A null/unverified value NEED NOT have a provenance: nothing established it.
      continue;
    }
    assert.ok(
      capability.provenance !== null,
      `${capability.id}: a stated value carries its provenance`,
    );
  }
});

test("CT-130-3: the ceiling C1 with the mark unverified, provenance adapter", () => {
  const ceiling = dshCapabilities().capabilities.find((c) => c.id === "containment.ceiling");
  assert.deepEqual(ceiling?.value, "C1");
  assert.equal(ceiling?.status, "unverified");
  assert.equal(ceiling?.provenance, "adapter");
});

test("CT-130-3: continuation none, usage source none, critic tool-less by config", () => {
  const byId = new Map(dshCapabilities().capabilities.map((c) => [c.id, c]));
  assert.equal(byId.get("continuation")?.value, "none");
  assert.equal(byId.get("usage.source")?.value, "none");
  assert.equal(byId.get("critic.toolless")?.value, "config");
  assert.equal(byId.get("critic.readOnlyTools")?.value, false);
});

test("CT-130-3: the identity is the qualifier where one names provider and model, else null", () => {
  assert.deepEqual(dshIdentityOfQualifier("deepseek/chat"), {
    provider: "deepseek",
    model: "chat",
  });
  assert.equal(dshIdentityOfQualifier(null), null);
  assert.equal(dshIdentityOfQualifier(""), null);
  assert.equal(dshIdentityOfQualifier("chat"), null);
  const unnamed = dshCapabilities().capabilities.find((c) => c.id === "identity");
  assert.equal(unnamed?.value, null);
  assert.equal(unnamed?.provenance, null);
});

test("CT-130-3: the native-memory switch is null and its existence is unverified (capture 6)", () => {
  const byId = new Map(dshCapabilities().capabilities.map((c) => [c.id, c]));
  assert.equal(byId.get("memory.native.switch")?.value, null);
  assert.equal(byId.get("memory.native.exists")?.value, "unverified");
  assert.equal(byId.get("memory.native.switch")?.status, "unverified");
});

test("CT-130-3: the switch of every kind of customisation is null (F130-FR-043)", () => {
  const kinds = dshCustomisations().map((customisation) => customisation.kind);
  assert.deepEqual(kinds, ["plugins", "host-hooks", "skills", "tool-servers"]);
  for (const customisation of dshCustomisations()) {
    assert.equal(customisation.switch, null, `${customisation.kind}: no switch`);
    assert.equal(customisation.status, "unverified");
  }
});

test("CT-130-3: cost unknown, window from configuration, nulls for sessions, limit, ladder", () => {
  const byId = new Map(
    dshCapabilities({ contextWindow: 128000 }).capabilities.map((c) => [c.id, c]),
  );
  assert.equal(byId.get("cost.class")?.value, "unknown");
  assert.equal(byId.get("contextWindow")?.value, 128000);
  assert.equal(byId.get("contextWindow")?.provenance, "user configuration");
  // The one capture that has landed (CT-130-46, the owner's ruling of
  // 2026-11-03): three concurrent sessions proven on the real harness, so
  // the capability carries the proven count, the adapter's provenance and
  // `verified`. Every other null of this row stays a null.
  assert.equal(byId.get("concurrentSessions")?.value, 3);
  assert.equal(byId.get("concurrentSessions")?.provenance, "adapter");
  assert.equal(byId.get("concurrentSessions")?.status, "verified");
  assert.equal(byId.get("spendingLimit.process")?.value, null);
  assert.equal(byId.get("tierLadder")?.value, null);
  assert.equal(dshCapabilities().betweenPasses, "continue");
});
